import { createDeskCapture } from './desk-capture.js';
import { readDropPayload, hasRoamPayload, hasModifier } from './drop-payload.js';
import { sameContext, DeskDropError } from './roam-adapter.js';
import { createDeskDropUI } from './ui.js';

export const DESK_SELECTOR = '.roam-app > .roam-sidebar-container .rm-left-sidebar__desk';
const AMBIGUOUS = '.rm-reference-container,.rm-reference-item,.roam-query,.roam-query-content,.rm-embed-container';

export function createDeskDropRuntime({ windowRef, documentRef = windowRef.document, getAPI = () => windowRef.roamAlphaAPI }) {
  const capture = createDeskCapture({ getAPI });
  const controller = new AbortController();
  let loaded = false, stopped = false, session = null, context, feedbackVersion = 0;
  const ui = createDeskDropUI({ documentRef, windowRef, onActionError: showError });

  function showError(error, target = documentRef.querySelector(DESK_SELECTOR)) {
    if (!loaded || error?.code === 'ABORTED') return;
    ui.show(error instanceof DeskDropError ? error.message : 'Could not complete the operation. Check Desk; Desk Drop has not moved the original block.', { target, state: 'error', persistent: true });
  }
  function clearFeedback() { feedbackVersion++; ui.clearFeedback(); }
  function resetDrag() { session = null; ui.clearHighlight(); }
  function transferEffect(transfer) {
    const allowed = transfer?.effectAllowed || 'uninitialized';
    // Prefer additive cursor feedback, not the macOS link/alias arrow. The
    // capture engine still creates a live embed and never copies source text.
    if (['all', 'uninitialized', 'copy', 'copyLink', 'copyMove'].includes(allowed)) return 'copy';
    if (['link', 'linkMove'].includes(allowed)) return 'link';
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
    clearFeedback();
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
    // Intercept only confirmed Desk drops; leave other targets and modifier-key drags alone.
    event.preventDefault(); event.stopPropagation();
    const version = ++feedbackVersion;
    try {
      if (!sameContext(source.origin, capture.getContext())) throw new DeskDropError('CONTEXT_CHANGED', 'The graph or user changed during the drag. Start a new drag.');
      const uids = readDropPayload(event.dataTransfer, source.origin, source.sourceUid);
      ui.show('Adding to Desk.', { target, state: 'pending', persistent: true });
      const result = await capture.capture({ uids, origin: source.origin, signal: controller.signal });
      if (!loaded || version !== feedbackVersion) return;
      const undo = result.receipt ? async () => {
        await capture.undo(result.receipt, { signal: controller.signal });
        if (loaded && version === feedbackVersion) ui.show('Removed this Desk entry. Original block kept.', { target, state: 'removed' });
      } : undefined;
      ui.show(result.status === 'existing' ? 'Already on Desk. No duplicate added.' : 'Added to Desk. Original kept in place.', { target, state: result.status === 'existing' ? 'existing' : 'added', undo });
    } catch (error) { if (version === feedbackVersion) showError(error, target); }
  }
  function onKeyDown(event) { if (event.key === 'Escape') { resetDrag(); clearFeedback(); } }
  function onHashChange() {
    resetDrag();
    try {
      const next = capture.getContext();
      if (!sameContext(context, next)) clearFeedback();
      context = next;
    } catch { clearFeedback(); }
  }
  const windowListeners = [['dragstart', onDragStart], ['dragend', resetDrag], ['blur', resetDrag], ['keydown', onKeyDown], ['hashchange', onHashChange]];
  const documentListeners = [['dragenter', onDragOver], ['dragover', onDragOver], ['dragleave', onDragLeave], ['drop', onDrop]];

  return {
    start() {
      if (loaded) return;
      if (stopped) throw new DeskDropError('ABORTED', 'Create a new plugin instance before restarting.');
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
