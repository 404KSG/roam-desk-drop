import { createDeskCapture, isSafeUid } from './desk-capture.js';
import { readDropPayload, hasRoamPayload, hasModifier } from './drop-payload.js';
import { sameContext, DeskDropError } from './roam-adapter.js';
import { createDeskDropUI } from './ui.js';

export const DESK_SELECTOR = '.roam-app > .roam-sidebar-container .rm-left-sidebar__desk';
const DESTINATION_SELECTOR = '.roam-app > .roam-sidebar-container :is(.rm-left-sidebar__daily-notes, .rm-left-sidebar__desk, .starred-pages .page)';
const SOURCE_SURFACE = '.roam-article, .rm-sidebar-outline, .rm-sidebar-window, #right-sidebar';
const AMBIGUOUS = '.rm-reference-container,.rm-reference-item,.roam-query,.roam-query-content,.rm-embed-container';
const PAGE_HASH = /^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)\/?(?:\?.*)?$/;
const DRAG_THRESHOLD = 8;

const parsePageHref = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try { url = new URL(value, 'https://roamresearch.com'); }
  catch { return null; }
  const trusted = (url.protocol === 'roam:' && !url.hostname) || (url.protocol === 'https:' && ['roamresearch.com', 'www.roamresearch.com'].includes(url.hostname));
  if (!trusted) return null;
  const match = url.hash.match(PAGE_HASH);
  if (!match) return null;
  try {
    return { type: match[1] === 'app' ? 'hosted' : 'offline', graph: decodeURIComponent(match[2]), uid: decodeURIComponent(match[3]) };
  } catch { return null; }
};
const attributeValue = (node, names) => {
  for (const name of names) {
    const value = node?.getAttribute?.(name);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

export function createDeskDropRuntime({ windowRef, documentRef = windowRef.document, getAPI = () => windowRef.roamAlphaAPI }) {
  const capture = createDeskCapture({ getAPI });
  const controller = new AbortController();
  let loaded = false, stopped = false, session = null, gesture = null, context, feedbackVersion = 0, swallowClick = false;
  const ui = createDeskDropUI({ documentRef, windowRef });

  function showError(error, target = documentRef.querySelector(DESK_SELECTOR)) {
    if (!loaded || error?.code === 'ABORTED') return;
    ui.show(error instanceof DeskDropError ? error.message : 'Could not complete the operation. Check the page; Roam Drop has not moved the original block.', { target, state: 'error', persistent: true });
  }
  function clearFeedback() { feedbackVersion++; ui.clearFeedback(); }
  function resetDrag() { session = null; ui.clearHighlight(); }
  function cancelGesture() { gesture = null; ui.clearHighlight(); ui.clearPointerDrag(); }
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
  function rowFrom(node) {
    const row = node?.closest?.(DESTINATION_SELECTOR);
    if (row) return row;
    // Live shortcuts are a[href] > div.page. A hit on the anchor itself still belongs to that page.
    const link = node?.closest?.('.roam-app > .roam-sidebar-container .starred-pages > a[href]');
    return link?.querySelector(':scope > .page') ?? null;
  }
  function dropZone(row) {
    const link = row?.closest?.('a[href]');
    return link?.contains(row) ? link : row;
  }
  function uidFromTextarea(id) {
    if (typeof id !== 'string' || !id.startsWith('block-input-')) return null;
    // Native block-input IDs end in a nine-character UID, which may itself contain hyphens.
    const uid = id.slice(-9);
    return id.length > 'block-input-'.length + 9 && isSafeUid(uid) ? uid : null;
  }
  function sourceUidFrom(bullet) {
    const row = bullet.closest('.rm-block-main');
    const container = bullet.closest('.roam-block-container,.rm-block');
    const attr = container?.getAttribute('data-block-uid') || row?.getAttribute('data-block-uid');
    if (isSafeUid(attr)) return attr;
    const root = row || container || bullet.parentElement;
    return uidFromTextarea(root?.querySelector?.('[id^="block-input-"]:not(#block-input-ghost)')?.id);
  }
  function sourceBullet(target) {
    if (target?.closest?.('textarea, input, select, [contenteditable="true"]')) return null;
    const bullet = target?.closest?.('.rm-bullet');
    if (!bullet || bullet.closest(AMBIGUOUS) || !bullet.closest(SOURCE_SURFACE)) return null;
    return bullet;
  }
  function multipleSelection(bullet) {
    if (!bullet?.closest?.('.block-highlight-blue')) return false;
    return documentRef.querySelectorAll('.block-highlight-blue').length > 1;
  }
  function pageIdentity(row) {
    // Confirmed client DOM is .starred-pages > a[href="/#/app/GRAPH/page/UID"] > div.page.
    // The page row has no href, so identity has to climb to that ancestor before any nested link.
    const ancestor = row.closest('a[href]');
    const links = [ancestor && ancestor !== row ? ancestor : null, row.querySelector('a[href]'), row.matches('a[href]') ? row : null].filter(Boolean);
    for (const link of links) {
      const parsed = parsePageHref(link.getAttribute?.('href') || link.href);
      if (parsed) return parsed;
    }
    const uid = attributeValue(row, ['data-link-uid', 'data-page-uid']) || attributeValue(row.querySelector('[data-link-uid], [data-page-uid]'), ['data-link-uid', 'data-page-uid']);
    const title = attributeValue(row, ['data-link-title', 'data-page-title']) || attributeValue(row.querySelector('[data-link-title], [data-page-title]'), ['data-link-title', 'data-page-title']);
    if (isSafeUid(uid) || title) return { uid: isSafeUid(uid) ? uid : undefined, title };
    return null;
  }
  function destinationFrom(row, origin) {
    if (!row) return null;
    if (row.matches('.rm-left-sidebar__daily-notes')) return { kind: 'daily' };
    if (row.matches('.rm-left-sidebar__desk')) return { kind: 'desk' };
    if (!row.matches('.starred-pages .page')) return null;
    const identity = pageIdentity(row);
    if (!identity) return { invalid: true, code: 'DESTINATION_UNSUPPORTED' };
    if (identity.graph && (identity.graph !== origin?.graphName || identity.type !== origin?.graphType)) return { invalid: true, code: 'CROSS_GRAPH' };
    if (identity.uid && !isSafeUid(identity.uid)) return { invalid: true, code: 'INVALID_UID' };
    if (!identity.uid && !identity.title) return { invalid: true, code: 'DESTINATION_UNSUPPORTED' };
    return { kind: 'page', uid: identity.uid, title: identity.title };
  }
  function rowLabel(row, fallback = 'page') {
    if (row?.matches?.('.rm-left-sidebar__daily-notes')) return 'Daily Notes';
    if (row?.matches?.('.rm-left-sidebar__desk')) return 'Desk';
    const copy = row.cloneNode(true);
    copy.querySelectorAll('.rr-sidebar-ref-count, .rr-desk-drop-accessory, [class*="ref-count"]').forEach(node => node.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim() || fallback;
  }
  function hitRow(event) {
    return rowFrom(documentRef.elementFromPoint?.(event.clientX, event.clientY)) || rowFrom(event.target);
  }

  async function complete(target, origin, uids, sourceUid) {
    const version = ++feedbackVersion;
    const label = rowLabel(target);
    try {
      if (!sameContext(origin, capture.getContext())) throw new DeskDropError('CONTEXT_CHANGED', 'The graph or user changed during the drag. Start a new drag.');
      const destination = destinationFrom(target, origin);
      if (!destination || destination.invalid) {
        throw new DeskDropError(destination?.code || 'DESTINATION_UNSUPPORTED', destination?.code === 'CROSS_GRAPH'
          ? 'Cross-graph drops are not supported in this version.'
          : 'Only Daily Notes, Desk, and pinned pages can receive a block.');
      }
      if (sourceUid && !isSafeUid(sourceUid)) throw new DeskDropError('INVALID_UID', 'Could not safely identify the dragged block.');
      ui.show(`Adding to ${label}.`, { target, state: 'pending', persistent: true });
      const result = await capture.capture({ uids, origin, destination, signal: controller.signal });
      if (!loaded || version !== feedbackVersion) return;
      ui.show(result.status === 'existing' ? `Already on ${label}. No duplicate added.` : `Added to ${label}. Original kept in place.`, { target, state: result.status === 'existing' ? 'existing' : 'added' });
    } catch (error) { if (version === feedbackVersion) showError(error, target); }
  }

  function onDragStart(event) {
    const bullet = sourceBullet(event.target);
    if (gesture && bullet === gesture.bullet) {
      // Edited blocks may emit dragstart without a payload, or cancel it later.
      // Keep their pointer stream alive instead of mistaking that event for a native drag.
      if (gesture.editing && !hasModifier(event)) {
        event.preventDefault(); resetDrag(); return;
      }
      gesture.native = true;
      ui.clearPointerDrag();
    }
    resetDrag();
    if (event.defaultPrevented || hasModifier(event) || !bullet) return;
    clearFeedback();
    try { session = { origin: capture.getContext(), sourceUid: sourceUidFrom(bullet) || undefined }; }
    catch (error) { showError(error); }
  }
  function onDragOver(event) {
    const target = rowFrom(event.target), effect = transferEffect(event.dataTransfer);
    const destination = target && currentSession() ? destinationFrom(target, session.origin) : null;
    if (!destination || destination.invalid || hasModifier(event) || !hasRoamPayload(event.dataTransfer) || !effect) {
      ui.clearHighlight(); return;
    }
    event.preventDefault(); event.dataTransfer.dropEffect = effect;
    ui.highlight(target);
  }
  function onDragLeave(event) {
    const row = ui.activeRow();
    const zone = dropZone(row);
    if (!row || !zone?.contains(event.target)) return;
    if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
    const bounds = zone.getBoundingClientRect();
    if (event.clientX >= bounds.left && event.clientX < bounds.right && event.clientY >= bounds.top && event.clientY < bounds.bottom) return;
    ui.clearHighlight();
  }
  async function onDrop(event) {
    const target = rowFrom(event.target), source = session;
    resetDrag();
    if (!target || !source || event.defaultPrevented || hasModifier(event) || !hasRoamPayload(event.dataTransfer) || !transferEffect(event.dataTransfer)) return;
    const destination = destinationFrom(target, source.origin);
    if (!destination) return;
    // Intercept only confirmed sidebar destinations; leave Depot, headings, and other targets alone.
    event.preventDefault(); event.stopPropagation();
    if (destination.invalid) {
      showError(new DeskDropError(destination.code, destination.code === 'CROSS_GRAPH'
        ? 'Cross-graph drops are not supported in this version.'
        : 'Only Daily Notes, Desk, and pinned pages can receive a block.'), target);
      return;
    }
    try {
      if (!sameContext(source.origin, capture.getContext())) throw new DeskDropError('CONTEXT_CHANGED', 'The graph or user changed during the drag. Start a new drag.');
      const uids = readDropPayload(event.dataTransfer, source.origin, source.sourceUid);
      await complete(target, source.origin, uids, source.sourceUid);
    } catch (error) { showError(error, target); }
  }
  function onPointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false || event.pointerType === 'touch' || hasModifier(event) || event.defaultPrevented) return;
    const bullet = sourceBullet(event.target);
    // Roam paints each block in a multi-selection with block-highlight-blue and may not emit dragstart.
    if (!bullet || multipleSelection(bullet)) return;
    const sourceUid = sourceUidFrom(bullet);
    if (!isSafeUid(sourceUid)) return;
    try {
      gesture = {
        pointerId: event.pointerId, bullet, x: event.clientX, y: event.clientY,
        armed: false, native: false, sourceUid, origin: capture.getContext(),
        editing: Boolean(bullet.closest('.roam-block-container,.rm-block-main')?.querySelector('textarea[id^="block-input-"]')),
      };
    } catch { cancelGesture(); }
  }
  function onPointerMove(event) {
    if (!gesture || gesture.native || event.pointerId !== gesture.pointerId) return;
    if (hasModifier(event) || event.buttons !== 1) { cancelGesture(); return; }
    try { if (!sameContext(gesture.origin, capture.getContext())) { cancelGesture(); return; } }
    catch { cancelGesture(); return; }
    if (!gesture.armed) {
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      gesture.armed = true;
      clearFeedback();
    }
    ui.movePointerDrag(gesture.bullet, event.clientX, event.clientY);
    const target = hitRow(event);
    const destination = target ? destinationFrom(target, gesture.origin) : null;
    if (destination && !destination.invalid) ui.highlight(target);
    else ui.clearHighlight();
  }
  function onPointerUp(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const current = gesture;
    gesture = null;
    ui.clearHighlight(); ui.clearPointerDrag();
    if (!current.armed || current.native || hasModifier(event)) return;
    const target = hitRow(event);
    const destination = target ? destinationFrom(target, current.origin) : null;
    if (!target || !destination || destination.invalid) return;
    event.preventDefault(); event.stopPropagation();
    swallowClick = true;
    windowRef.setTimeout(() => { swallowClick = false; }, 0);
    if (!isSafeUid(current.sourceUid)) {
      showError(new DeskDropError('INVALID_UID', 'Could not safely identify the dragged block.'), target);
      return;
    }
    complete(target, current.origin, [current.sourceUid], current.sourceUid);
  }
  function onClick(event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault(); event.stopPropagation();
  }
  function onWindowBlur(event) {
    // Capture listeners also see the editor's blur when a bullet is grabbed.
    // Cancel only when the browser window itself loses focus.
    if (event.target !== windowRef) return;
    resetDrag(); cancelGesture();
  }
  function onKeyDown(event) { if (event.key === 'Escape') { resetDrag(); cancelGesture(); clearFeedback(); } }
  function onHashChange() {
    resetDrag(); cancelGesture();
    try {
      const next = capture.getContext();
      if (!sameContext(context, next)) clearFeedback();
      context = next;
    } catch { clearFeedback(); }
  }
  const windowListeners = [['dragstart', onDragStart], ['dragend', () => { resetDrag(); cancelGesture(); }], ['pointerdown', onPointerDown], ['pointermove', onPointerMove], ['pointerup', onPointerUp], ['pointercancel', cancelGesture], ['click', onClick], ['blur', onWindowBlur], ['keydown', onKeyDown], ['hashchange', onHashChange]];
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
      resetDrag(); cancelGesture(); ui.dispose();
    },
  };
}
