const MARK = ':is(div.log-button.rm-left-sidebar__daily-notes, div.log-button.rm-left-sidebar__desk, .starred-pages .page)';
const ROW = `.roam-app > .roam-sidebar-container ${MARK}[data-rr-desk-drop]`;
// Outrank important sidebar hover paint only while this exact row accepts a drop.
const READY_ROW = `.roam-body .roam-app > .roam-sidebar-container .roam-sidebar-content ${MARK}[data-rr-desk-drop="ready"]`;
const CSS = `
${ROW} { position:relative; }
${ROW}:has(> .rr-desk-drop-accessory) :is(.rr-sidebar-ref-count, [class*="ref-count"]) { visibility:hidden !important; }
${READY_ROW} {
  background-color:color-mix(in srgb,currentColor 7%,transparent) !important;
  border-radius:6px;
  transition:background-color 100ms ease;
}
.rr-desk-drop-accessory { position:absolute; right:10px; top:50%; transform:translateY(-50%); display:flex; align-items:center; justify-content:center; width:14px; height:20px; color:inherit; pointer-events:none; }
.rr-desk-drop-icon { display:block; width:14px; height:14px; flex:none; opacity:.8; }
.rr-desk-drop-success { color:#1f8a4c; opacity:1; }
.rr-desk-drop-error { color:var(--rr-desk-drop-warning,#a87936); pointer-events:auto; cursor:help; border-radius:3px; }
.rr-desk-drop-error:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.rr-desk-drop-spinner { display:block; box-sizing:border-box; width:13px; height:13px; border:1.5px solid currentColor; border-right-color:transparent; border-radius:50%; opacity:.65; animation:rr-desk-drop-spin 800ms linear infinite; }
.rr-desk-drop-pointer-ghost { position:fixed; left:0; top:0; max-width:240px; padding:4px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:12px/20px system-ui; color:CanvasText; background:Canvas; border:1px solid color-mix(in srgb,currentColor 18%,transparent); border-radius:4px; opacity:.85; pointer-events:none; z-index:2147483647; }
html[data-rr-desk-drop-pointer] * { cursor:grabbing !important; }
.rr-desk-drop-live { position:absolute !important; top:0 !important; left:0 !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important; overflow:hidden !important; clip-path:inset(50%) !important; white-space:nowrap !important; border:0 !important; }
@keyframes rr-desk-drop-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { ${READY_ROW} { transition:none; } .rr-desk-drop-spinner { animation:none; } }
`;

export function createDeskDropUI({ documentRef, windowRef }) {
  let style, live, dragRow, feedback, painted, pointerGhost, pointerMarker, mounted = false;
  const restore = (node, name, oldValue, ownValue) => {
    if (node.getAttribute(name) !== ownValue) return;
    if (oldValue === null) node.removeAttribute(name);
    else node.setAttribute(name, oldValue);
  };
  function clearPaint() {
    if (!painted) return;
    const { row, accessory, marker, busy, state } = painted;
    painted = null;
    accessory.remove();
    restore(row, 'data-rr-desk-drop', marker, state);
    if (state === 'pending') restore(row, 'aria-busy', busy, 'true');
    painted = null;
  }
  function icon(state) {
    if (state === 'pending') {
      const spinner = documentRef.createElement('span');
      spinner.className = 'rr-desk-drop-spinner'; spinner.setAttribute('aria-hidden', 'true');
      return spinner;
    }
    const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', state === 'added' || state === 'existing' ? 'rr-desk-drop-icon rr-desk-drop-success' : 'rr-desk-drop-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', state === 'ready' ? 'M8 3v10M3 8h10' : state === 'error' ? 'M8 5v3M8 11h.01M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12' : 'm3 8 3 3 7-7');
    svg.appendChild(path); return svg;
  }
  function paint() {
    clearPaint();
    const model = dragRow ? { row: dragRow, state: 'ready' } : feedback;
    if (!mounted || !model?.row?.isConnected) return;
    const { row } = model, state = model.state;
    const accessory = documentRef.createElement('span');
    accessory.className = 'rr-desk-drop-accessory';
    painted = { row, accessory, marker: row.getAttribute('data-rr-desk-drop'), busy: row.getAttribute('aria-busy'), state };
    row.setAttribute('data-rr-desk-drop', state);
    if (state === 'pending') row.setAttribute('aria-busy', 'true');
    const status = documentRef.createElement('span');
    status.appendChild(icon(state));
    if (model.message) status.title = model.message;
    if (state === 'error') {
      status.className = 'rr-desk-drop-error'; status.tabIndex = 0;
      status.setAttribute('role', 'img'); status.setAttribute('aria-label', model.message);
    }
    accessory.appendChild(status);
    row.appendChild(accessory);
  }
  function clearPointerDrag() {
    if (!pointerGhost) return;
    pointerGhost.remove(); pointerGhost = null;
    restore(documentRef.documentElement, 'data-rr-desk-drop-pointer', pointerMarker, 'true');
  }
  function movePointerDrag(bullet, x, y) {
    if (!mounted) return;
    if (!pointerGhost) {
      const row = bullet.closest('.rm-block-main,.roam-block-container');
      pointerGhost = documentRef.createElement('div');
      pointerGhost.className = 'rr-desk-drop-pointer-ghost'; pointerGhost.setAttribute('aria-hidden', 'true');
      pointerGhost.textContent = (row?.querySelector('textarea')?.value || row?.querySelector('.rm-block-text')?.textContent || 'Block').trim().slice(0, 120);
      pointerMarker = documentRef.documentElement.getAttribute('data-rr-desk-drop-pointer');
      documentRef.documentElement.setAttribute('data-rr-desk-drop-pointer', 'true');
      documentRef.body.appendChild(pointerGhost);
    }
    const left = Math.max(0, Math.min(x + 14, windowRef.innerWidth - pointerGhost.offsetWidth - 4));
    const top = Math.max(0, Math.min(y + 14, windowRef.innerHeight - pointerGhost.offsetHeight - 4));
    pointerGhost.style.transform = `translate(${left}px,${top}px)`;
  }
  function clearHighlight() {
    // Removing a focused accessory dispatches blur. Without an active drag,
    // resetting it must not re-enter paint and remove that node a second time.
    if (!dragRow) return;
    dragRow = null; paint();
  }
  function clearFeedback() {
    feedback?.cleanup(); feedback = null;
    if (live) live.textContent = '';
    paint();
  }
  return {
    mount() {
      if (mounted) return;
      mounted = true;
      style = documentRef.createElement('style');
      style.dataset.rrDeskDropStyle = 'true'; style.textContent = CSS; documentRef.head.appendChild(style);
      live = documentRef.createElement('div'); live.className = 'rr-desk-drop-live';
      live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
      documentRef.body.appendChild(live);
    },
    highlight(target) {
      if (!mounted || (dragRow === target && painted?.accessory.isConnected)) return;
      dragRow = target; paint();
    },
    clearHighlight,
    clearPointerDrag, movePointerDrag,
    activeRow: () => dragRow,
    clearFeedback,
    show(message, { target, state = 'added', persistent = false } = {}) {
      if (!mounted || !target?.isConnected) return;
      clearFeedback();
      let timer;
      const current = { row: target, state, message };
      current.cleanup = () => windowRef.clearTimeout(timer);
      feedback = current; live.textContent = message; paint();
      // Success leaves on its own, including while the pointer is still over the row.
      if (!persistent) timer = windowRef.setTimeout(() => { if (feedback === current) clearFeedback(); }, 900);
    },
    dispose() {
      mounted = false; dragRow = null; clearPointerDrag(); clearFeedback(); clearPaint();
      style?.remove(); live?.remove(); style = null; live = null;
    },
  };
}
