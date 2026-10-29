import { createRoamDeskAdapter, DeskDropError } from './roam-adapter.js';

export const isSafeUid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);

function embeddedBlockUid(string) {
  if (typeof string !== 'string') return null;
  return string.match(/^\s*\{\{\s*(?:embed(?:-path)?|\[\[embed(?:-path)?\]\])\s*:\s*\(\(([A-Za-z0-9_-]+)\)\)(?=\s|\}\})[^{}]*\}\}/)?.[1] ?? null;
}

function snapshotDestination(destination) {
  if (destination == null) return { kind: 'desk' };
  const kind = destination.kind;
  if (kind === 'desk') return { kind };
  if (kind === 'daily') return { kind, acceptedAt: Date.now() };
  if (kind === 'page') return { kind, uid: destination.uid, title: typeof destination.title === 'string' ? destination.title : undefined };
  return { kind: typeof kind === 'string' ? kind : 'unknown' };
}

export function createDeskCapture({ getAPI }) {
  const adapter = createRoamDeskAdapter({ getAPI });
  const pendingWrites = new Map();
  const interrupted = error => ['ABORTED', 'CONTEXT_CHANGED', 'NO_CONTEXT'].includes(error?.code);
  const unconfirmed = () => new DeskDropError('WRITE_UNCONFIRMED', 'Could not confirm the result. Further attempts for this block are paused; check that page first.');
  let tail = Promise.resolve(), disposed = false;

  function active(signal) {
    if (disposed || signal?.aborted) throw new DeskDropError('ABORTED', 'Roam Drop has stopped; this operation will not continue.');
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
  async function resolveDestination(origin, destination, signal) {
    if (destination.kind === 'desk') return guarded(origin, () => adapter.resolveDesk(origin), signal);
    if (destination.kind === 'daily') return guarded(origin, () => adapter.resolveDaily(origin, destination.acceptedAt, () => active(signal)), signal);
    if (destination.kind === 'page') {
      if (destination.uid != null && !isSafeUid(destination.uid)) throw new DeskDropError('INVALID_UID', 'Could not safely identify the destination page.');
      return guarded(origin, () => adapter.resolvePinnedPage(origin, destination), signal);
    }
    throw new DeskDropError('DESTINATION_UNSUPPORTED', 'This sidebar target is not a page Roam Drop can write to.');
  }

  async function captureOne({ uids, origin, destination, signal }) {
    const run = fn => guarded(origin, fn, signal);
    active(signal);
    adapter.assertContext(origin);
    if (!Array.isArray(uids) || uids.length !== 1) throw new DeskDropError('SINGLE_BLOCK_ONLY', 'This version accepts one top-level block at a time. Drag blocks individually.');
    const sourceUid = uids[0];
    if (!isSafeUid(sourceUid)) throw new DeskDropError('INVALID_UID', 'Could not safely identify the block UID.');
    const source = await run(() => adapter.readBlock(sourceUid));
    if (!source || source.uid !== sourceUid) throw new DeskDropError('SOURCE_MISSING', 'The source block no longer exists. Nothing was added.');
    if (typeof source.title === 'string' || typeof source.string !== 'string') throw new DeskDropError('NOT_A_BLOCK', 'This version accepts blocks, not whole pages.');
    if (!source.pageUid) throw new DeskDropError('SOURCE_METADATA', 'Could not identify the source page. Nothing was added.');
    const page = await resolveDestination(origin, destination, signal);
    if (sourceUid === page.uid || source.pageUid === page.uid) {
      throw new DeskDropError(page.kind === 'desk' ? 'DESK_SOURCE' : 'SOURCE_ON_PAGE', page.kind === 'desk'
        ? 'Notes already inside a Desk page cannot be added again.'
        : 'This block is already on that page. Nothing was added.');
    }
    if (page.kind === 'desk' && await run(() => adapter.isDeskPage(source.pageUid))) {
      throw new DeskDropError('DESK_SOURCE', 'Notes already inside a Desk page cannot be added again.');
    }
    const current = await resolveDestination(origin, destination, signal);
    if (current.uid !== page.uid) throw new DeskDropError(page.kind === 'desk' ? 'DESK_CHANGED' : 'DESTINATION_CHANGED', page.kind === 'desk'
      ? 'The Desk binding changed. Please drag the block again.'
      : 'The destination changed. Please drag the block again.');
    const key = JSON.stringify([origin.graphName, origin.graphType, origin.userUid, current.uid, sourceUid]);
    const string = `{{embed-path: ((${sourceUid})) closed}}`;
    const validEntry = (entry, expectedUid) => entry?.uid === expectedUid && entry.string === string && entry.parentUids.length === 1 && entry.parentUids[0] === current.uid;
    const existing = current.entries.find(entry => embeddedBlockUid(entry.string) === sourceUid);
    if (existing) {
      pendingWrites.delete(key);
      return { status: 'existing', entryUid: existing.uid, sourceUid, pageUid: current.uid, ...(current.kind === 'desk' ? { deskUid: current.uid } : {}), context: origin };
    }
    const pending = pendingWrites.get(key);
    if (pending) {
      const entry = await run(() => adapter.readBlock(pending));
      if (!validEntry(entry, pending)) throw unconfirmed();
      pendingWrites.delete(key);
      return { status: 'existing', entryUid: pending, sourceUid, pageUid: current.uid, ...(current.kind === 'desk' ? { deskUid: current.uid } : {}), context: origin };
    }
    const uid = adapter.generateUID();
    if (!isSafeUid(uid)) throw new DeskDropError('UNSUPPORTED_API', 'Roam returned a UID that cannot be used safely.');
    pendingWrites.set(key, uid);
    try { await run(() => adapter.createEntry({ parentUid: current.uid, uid, string })); }
    catch (error) { if (interrupted(error)) throw error; }
    let entry;
    try { entry = await run(() => adapter.readBlock(uid)); }
    catch (error) { if (interrupted(error)) throw error; throw unconfirmed(); }
    if (!validEntry(entry, uid)) throw unconfirmed();
    pendingWrites.delete(key);
    return { status: 'added', entryUid: uid, sourceUid, pageUid: current.uid, ...(current.kind === 'desk' ? { deskUid: current.uid } : {}), context: origin };
  }

  return {
    getContext() { active(); return adapter.getContext(); },
    capture(request = {}) {
      const origin = Object.freeze({ graphName: request.origin?.graphName, graphType: request.origin?.graphType, userUid: request.origin?.userUid });
      const uids = Array.isArray(request.uids) ? [...request.uids] : request.uids;
      const destination = snapshotDestination(request.destination);
      return enqueue(() => captureOne({ uids, origin, destination, signal: request.signal }));
    },
    dispose() { disposed = true; pendingWrites.clear(); },
  };
}
