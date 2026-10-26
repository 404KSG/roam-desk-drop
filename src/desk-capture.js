import { createRoamDeskAdapter, DeskDropError } from './roam-adapter.js';

export const isSafeUid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);

function embeddedBlockUid(string) {
  if (typeof string !== 'string') return null;
  return string.match(/^\s*\{\{\s*(?:embed(?:-path)?|\[\[embed(?:-path)?\]\])\s*:\s*\(\(([A-Za-z0-9_-]+)\)\)(?=\s|\}\})[^{}]*\}\}/)?.[1] ?? null;
}

export function createDeskCapture({ getAPI }) {
  const adapter = createRoamDeskAdapter({ getAPI });
  const pendingWrites = new Map();
  const interrupted = error => ['ABORTED', 'CONTEXT_CHANGED', 'NO_CONTEXT'].includes(error?.code);
  const unconfirmed = () => new DeskDropError('WRITE_UNCONFIRMED', '添加结果尚未确认，已暂停同一块的重试；请先查看 Desk。');
  let receipts = new WeakMap(), tail = Promise.resolve(), disposed = false;

  function active(signal) {
    if (disposed || signal?.aborted) throw new DeskDropError('ABORTED', '插件已停止，本次操作已取消。');
  }
  async function guarded(context, fn, signal) {
    active(signal);
    adapter.assertContext(context);
    const result = await fn();
    active(signal);
    adapter.assertContext(context);
    return result;
  }
  function enqueue(fn) {
    const next = tail.then(() => { active(); return fn(); });
    tail = next.catch(() => {});
    return next;
  }

  async function captureOne({ uids, origin, signal }) {
    const run = fn => guarded(origin, fn, signal);
    active(signal);
    adapter.assertContext(origin);
    if (!Array.isArray(uids) || uids.length !== 1) throw new DeskDropError('SINGLE_BLOCK_ONLY', '第一版只支持一个顶层 Block，请逐块拖入。');
    const sourceUid = uids[0];
    if (!isSafeUid(sourceUid)) throw new DeskDropError('INVALID_UID', '无法安全识别这个 Block 的 UID。');
    const desk = await run(() => adapter.resolveDesk(origin));
    if (sourceUid === desk.uid) throw new DeskDropError('DESK_SOURCE', '不能把 Desk 再次放进它自己。');
    const source = await run(() => adapter.readBlock(sourceUid));
    if (!source || source.uid !== sourceUid) throw new DeskDropError('SOURCE_MISSING', '源 Block 已不存在，未加入 Desk。');
    if (typeof source.title === 'string' || typeof source.string !== 'string') throw new DeskDropError('NOT_A_BLOCK', '第一版只接受 Block，不接受整个页面。');
    if (!source.pageUid) throw new DeskDropError('SOURCE_METADATA', '无法确认源 Block 所属页面，未加入 Desk。');
    if (await run(() => adapter.isDeskPage(source.pageUid))) throw new DeskDropError('DESK_SOURCE', 'Desk 内部的笔记不需要再次加入 Desk。');
    const currentDesk = await run(() => adapter.resolveDesk(origin));
    if (currentDesk.uid !== desk.uid) throw new DeskDropError('DESK_CHANGED', 'Desk 绑定刚刚改变，请重新拖入。');
    const key = JSON.stringify([origin.graphName, origin.graphType, origin.userUid, desk.uid, sourceUid]);
    const existing = currentDesk.entries.find(entry => embeddedBlockUid(entry.string) === sourceUid);
    if (existing) {
      pendingWrites.delete(key);
      return { status: 'existing', entryUid: existing.uid, sourceUid, deskUid: desk.uid, context: origin };
    }
    const string = `{{embed-path: ((${sourceUid})) closed}}`;
    const validEntry = (entry, expectedUid) => entry?.uid === expectedUid && entry.string === string && entry.parentUids.length === 1 && entry.parentUids[0] === desk.uid;
    const pending = pendingWrites.get(key);
    if (pending) {
      const entry = await run(() => adapter.readBlock(pending));
      if (!validEntry(entry, pending)) throw unconfirmed();
      pendingWrites.delete(key);
      return { status: 'existing', entryUid: pending, sourceUid, deskUid: desk.uid, context: origin };
    }
    const uid = adapter.generateUID();
    if (!isSafeUid(uid)) throw new DeskDropError('UNSUPPORTED_API', 'Roam 返回了无法安全使用的新 UID。');
    pendingWrites.set(key, uid);
    try {
      await run(() => adapter.createEntry({ deskUid: desk.uid, uid, string }));
    } catch (error) {
      if (interrupted(error)) throw error;
      // SDK 报错不等于事务未发生；必须按预先生成的 UID 读回。
    }
    let entry;
    try { entry = await run(() => adapter.readBlock(uid)); }
    catch (error) { if (interrupted(error)) throw error; throw unconfirmed(); }
    if (!validEntry(entry, uid)) throw unconfirmed();
    pendingWrites.delete(key);
    let receipt;
    if (Number.isFinite(entry.edited)) {
      receipt = Object.freeze({ entryUid: uid });
      receipts.set(receipt, { entry, deskUid: desk.uid, context: origin });
    }
    return { status: 'added', entryUid: uid, sourceUid, deskUid: desk.uid, context: origin, receipt };
  }

  async function undoOne(receipt, signal) {
    active(signal);
    const saved = receipt && receipts.get(receipt);
    if (!saved) throw new DeskDropError('INVALID_RECEIPT', '这个撤销凭据不存在或已经失效。');
    const run = fn => guarded(saved.context, fn, signal);
    const desk = await run(() => adapter.resolveDesk(saved.context));
    if (desk.uid !== saved.deskUid) throw new DeskDropError('DESK_CHANGED', 'Desk 绑定已改变，请人工处理这个入口。');
    const current = await run(() => adapter.readBlock(saved.entry.uid));
    if (!current) {
      receipts.delete(receipt);
      return { status: 'already-removed' };
    }
    if (current.string !== saved.entry.string || current.edited !== saved.entry.edited ||
        current.parentUids.length !== 1 || current.parentUids[0] !== saved.deskUid ||
        current.childUids.length || current.referrerUids.length || typeof current.title === 'string') {
      throw new DeskDropError('UNDO_UNSAFE', '入口已被编辑、移动或引用，请在 Desk 中人工处理。');
    }
    try { await run(() => adapter.deleteEntry(current.uid)); }
    catch (error) { if (interrupted(error)) throw error; }
    if (await run(() => adapter.readBlock(current.uid))) throw new DeskDropError('UNDO_UNCONFIRMED', '尚未确认撤销结果，请查看 Desk。');
    receipts.delete(receipt);
    return { status: 'undone' };
  }

  return {
    getContext() { active(); return adapter.getContext(); },
    capture(request = {}) {
      const origin = Object.freeze({ graphName: request.origin?.graphName, graphType: request.origin?.graphType, userUid: request.origin?.userUid });
      const uids = Array.isArray(request.uids) ? [...request.uids] : request.uids;
      return enqueue(() => captureOne({ uids, origin, signal: request.signal }));
    },
    undo: (receipt, { signal } = {}) => enqueue(() => undoOne(receipt, signal)),
    dispose() { disposed = true; receipts = new WeakMap(); pendingWrites.clear(); },
  };
}
