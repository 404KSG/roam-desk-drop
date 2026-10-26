import { createDeskCapture } from './desk-capture.js';
import { readDropPayload, hasRoamPayload, hasModifier } from './drop-payload.js';
import { sameContext, DeskDropError } from './roam-adapter.js';
import { createDeskDropUI } from './ui.js';

export const DESK_SELECTOR = '.roam-app > .roam-sidebar-container .rm-left-sidebar__desk';
const AMBIGUOUS = '.rm-reference-container,.rm-reference-item,.roam-query,.roam-query-content,.rm-embed-container';

export function createDeskDropRuntime({ windowRef, documentRef = windowRef.document, getAPI = () => windowRef.roamAlphaAPI }) {
  const capture = createDeskCapture({ getAPI });
  const controller = new AbortController();
  let loaded = false, stopped = false, session = null, context;
  const ui = createDeskDropUI({ documentRef, windowRef, onActionError: showError });

  function showError(error) {
    if (!loaded || error?.code === 'ABORTED') return;
    ui.show(error instanceof DeskDropError ? error.message : '操作未完成，请在 Desk 中核对；原 Block 未被本插件移动。', { kind: 'error', persistent: true });
  }
  function resetDrag() { session = null; ui.clearHighlight(); }
  function transferEffect(transfer) {
    const allowed = transfer?.effectAllowed || 'uninitialized';
    if (['all', 'uninitialized', 'link', 'copyLink', 'linkMove'].includes(allowed)) return 'link';
    if (['copy', 'copyMove'].includes(allowed)) return 'copy';
    return null;
  }
  function currentSession() {
    try { return session && sameContext(session.origin, capture.getContext()); }
    catch { return false; }
  }
  function targetOf(event) { return event.target?.closest?.(DESK_SELECTOR); }

  function onDragStart(event) {
    resetDrag();
    if (event.defaultPrevented || hasModifier(event)) return;
    const bullet = event.target?.closest?.('.rm-bullet');
    if (!bullet || bullet.closest(AMBIGUOUS) || !bullet.closest('.roam-article,.rm-sidebar-outline,.rm-sidebar-window')) return;
    try {
      session = {
        origin: capture.getContext(),
        sourceUid: bullet.closest('[data-block-uid]')?.getAttribute('data-block-uid') || undefined,
      };
    } catch (error) { showError(error); }
  }
  function onDragOver(event) {
    const target = targetOf(event), effect = transferEffect(event.dataTransfer);
    if (!target || !currentSession() || hasModifier(event) || !hasRoamPayload(event.dataTransfer) || !effect) {
      ui.clearHighlight(); return;
    }
    event.preventDefault(); event.dataTransfer.dropEffect = effect;
    ui.highlight(target);
  }
  function onDragLeave(event) {
    const row = ui.activeRow();
    if (!row || !row.contains(event.target)) return;
    if (event.relatedTarget && row.contains(event.relatedTarget)) return;
    const r = row.getBoundingClientRect();
    if (event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom) return;
    ui.clearHighlight();
  }
  async function onDrop(event) {
    const target = targetOf(event), source = session;
    resetDrag();
    if (!target || !source || event.defaultPrevented || hasModifier(event) || !hasRoamPayload(event.dataTransfer) || !transferEffect(event.dataTransfer)) return;
    // 仅在已确认的 Desk 接收区阻止原生 drop；其他区域和修饰键全部让行。
    event.preventDefault(); event.stopPropagation();
    try {
      if (!sameContext(source.origin, capture.getContext())) throw new DeskDropError('CONTEXT_CHANGED', '拖拽途中图谱或用户已改变，请重新拖动。');
      const uids = readDropPayload(event.dataTransfer, source.origin, source.sourceUid);
      ui.show('正在加入 Desk…', { persistent: true });
      const result = await capture.capture({ uids, origin: source.origin, signal: controller.signal });
      if (!loaded) return;
      const actions = [{ id: 'view', label: '查看', run: () => {
        if (!sameContext(result.context, capture.getContext())) throw new DeskDropError('CONTEXT_CHANGED', '请回到原图谱后查看 Desk。');
        const row = documentRef.querySelector(DESK_SELECTOR);
        if (!row) throw new DeskDropError('DESK_NOT_VISIBLE', '未找到原生 Desk 入口，请从左侧栏打开。');
        row.click();
      } }];
      if (result.receipt) actions.push({ id: 'undo', label: '撤销', run: async () => {
        await capture.undo(result.receipt, { signal: controller.signal });
        if (loaded) ui.show('已移除本次 Desk 入口，原文保留。');
      } });
      ui.show(result.status === 'existing' ? '已在 Desk，没有重复添加。' : '已加入 Desk，原文保留。', { actions });
    } catch (error) { showError(error); }
  }
  function onKeyDown(event) { if (event.key === 'Escape') resetDrag(); }
  function onHashChange() {
    resetDrag();
    try {
      const next = capture.getContext();
      if (!sameContext(context, next)) ui.clearNotice();
      context = next;
    } catch { ui.clearNotice(); }
  }
  const windowListeners = [['dragstart', onDragStart], ['dragend', resetDrag], ['blur', resetDrag], ['keydown', onKeyDown], ['hashchange', onHashChange]];
  const documentListeners = [['dragenter', onDragOver], ['dragover', onDragOver], ['dragleave', onDragLeave], ['drop', onDrop]];

  return {
    start() {
      if (loaded) return;
      if (stopped) throw new DeskDropError('ABORTED', '请创建新的插件实例后重启。');
      context = capture.getContext();
      loaded = true; ui.mount();
      for (const [type, listener] of windowListeners) windowRef.addEventListener(type, listener, true);
      for (const [type, listener] of documentListeners) documentRef.addEventListener(type, listener, true);
    },
    stop() {
      if (stopped) return;
      stopped = true; loaded = false; controller.abort(); capture.dispose();
      for (const [type, listener] of windowListeners) windowRef.removeEventListener(type, listener, true);
      for (const [type, listener] of documentListeners) documentRef.removeEventListener(type, listener, true);
      resetDrag(); ui.dispose();
    },
  };
}
