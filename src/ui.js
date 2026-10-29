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
.rr-desk-drop-result { pointer-events:auto; cursor:help; border-radius:3px; }
.rr-desk-drop-error { color:var(--rr-desk-drop-warning,#a87936); }
.rr-desk-drop-result:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.rr-desk-drop-tooltip { position:fixed; box-sizing:border-box; max-width:min(260px,calc(100vw - 16px)); padding:6px 9px; border:1px solid color-mix(in srgb,CanvasText 16%,Canvas); border-radius:5px; color:CanvasText; background:Canvas; box-shadow:0 2px 8px rgb(0 0 0 / .12); font:12px/1.5 system-ui; overflow-wrap:anywhere; pointer-events:none; z-index:2147483647; }
.rr-desk-drop-spinner { display:block; box-sizing:border-box; width:13px; height:13px; border:1.5px solid currentColor; border-right-color:transparent; border-radius:50%; opacity:.65; animation:rr-desk-drop-spin 800ms linear infinite; }
.rr-desk-drop-pointer-ghost { position:fixed; left:0; top:0; max-width:240px; padding:4px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:12px/20px system-ui; color:CanvasText; background:Canvas; border:1px solid color-mix(in srgb,currentColor 18%,transparent); border-radius:4px; opacity:.85; pointer-events:none; z-index:2147483647; }
html[data-rr-desk-drop-pointer] * { cursor:grabbing !important; }
.rr-desk-drop-live { position:absolute !important; top:0 !important; left:0 !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important; overflow:hidden !important; clip-path:inset(50%) !important; white-space:nowrap !important; border:0 !important; }
@keyframes rr-desk-drop-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { ${READY_ROW} { transition:none; } .rr-desk-drop-spinner { animation:none; } }
`;
let tooltipSequence = 0;

export function createDeskDropUI({ documentRef, windowRef }) {
  let style, live, dragRow, feedback, painted, pointerGhost, pointerMarker, tooltip, tooltipAnchor, mounted = false;
  const restore = (node, name, oldValue, ownValue) => {
    if (node.getAttribute(name) !== ownValue) return;
    if (oldValue === null) node.removeAttribute(name);
    else node.setAttribute(name, oldValue);
  };
  function hideTooltip() {
    if (tooltipAnchor && tooltip && tooltipAnchor.getAttribute('aria-describedby') === tooltip.id) tooltipAnchor.removeAttribute('aria-describedby');
    tooltip?.remove(); tooltip = null; tooltipAnchor = null;
  }
  function showTooltip(model, status, details = false) {
    if (!mounted || feedback !== model || painted?.status !== status || dragRow || !model.row.isConnected) return;
    hideTooltip();
    tooltip = documentRef.createElement('div'); tooltip.className = 'rr-desk-drop-tooltip';
    tooltip.id = `rr-desk-drop-tooltip-${++tooltipSequence}`; tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = details ? model.message : model.hint || model.message;
    tooltipAnchor = status; status.setAttribute('aria-describedby', tooltip.id); documentRef.body.appendChild(tooltip);
    const row = model.row.getBoundingClientRect(), width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    let left = row.right + 8;
    if (left + width > windowRef.innerWidth - 8) left = row.left - width - 8;
    tooltip.style.left = `${Math.max(8, Math.min(left, windowRef.innerWidth - width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(row.top + (row.height - height) / 2, windowRef.innerHeight - height - 8))}px`;
  }
  function clearPaint() {
    hideTooltip();
    if (!painted) return;
    const { row, accessory, marker, busy, state } = painted;
    painted = null;
    accessory.remove();
    restore(row, 'data-rr-desk-drop', marker, state);
    if (state === 'pending') restore(row, 'aria-busy', busy, 'true');
  }
  function icon(state) {
    if (state === 'pending') {
      const spinner = documentRef.createElement('span');
      spinner.className = 'rr-desk-drop-spinner'; spinner.setAttribute('aria-hidden', 'true');
      return spinner;
    }
    const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', state === 'added' ? 'rr-desk-drop-icon rr-desk-drop-success' : 'rr-desk-drop-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', state === 'ready' ? 'M8 3v10M3 8h10' : state === 'error' ? 'M8 5v3M8 11h.01M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12' : state === 'existing' ? 'M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M5 8l2 2 4-4' : 'm3 8 3 3 7-7');
    svg.appendChild(path); return svg;
  }
  function paint() {
    clearPaint();
    const model = dragRow ? { row: dragRow, state: 'ready' } : feedback;
    if (!mounted || !model?.row?.isConnected) return;
    const { row, state } = model;
    const accessory = documentRef.createElement('span'); accessory.className = 'rr-desk-drop-accessory';
    const status = documentRef.createElement('span'); status.appendChild(icon(state));
    painted = { row, accessory, status, marker: row.getAttribute('data-rr-desk-drop'), busy: row.getAttribute('aria-busy'), state };
    row.setAttribute('data-rr-desk-drop', state);
    if (state === 'pending') row.setAttribute('aria-busy', 'true');
    if (model.message && state !== 'error' && state !== 'existing') status.title = model.message;
    if (state === 'error' || state === 'existing') {
      status.className = `rr-desk-drop-result${state === 'error' ? ' rr-desk-drop-error' : ''}`; status.tabIndex = 0;
      status.setAttribute('role', 'img'); status.setAttribute('aria-label', model.message);
      const reveal = () => showTooltip(model, status, true);
      const dismiss = () => {
        if (painted?.status === status && !model.autoHint && documentRef.activeElement !== status && !status.matches(':hover')) hideTooltip();
      };
      status.addEventListener('mouseenter', reveal); status.addEventListener('focus', reveal);
      status.addEventListener('mouseleave', dismiss); status.addEventListener('blur', dismiss);
    }
    accessory.appendChild(status); row.appendChild(accessory);
    if (model.autoHint) showTooltip(model, status);
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
      windowRef.addEventListener('resize', hideTooltip);
      documentRef.addEventListener('scroll', hideTooltip, true);
    },
    highlight(target) {
      if (!mounted || (dragRow === target && painted?.accessory.isConnected)) return;
      dragRow = target; paint();
    },
    clearHighlight,
    clearPointerDrag, movePointerDrag,
    activeRow: () => dragRow,
    clearFeedback,
    show(message, { target, state = 'added', hint, persistent = false } = {}) {
      if (!mounted || !target?.isConnected) return;
      clearFeedback();
      let timer, hintTimer;
      const current = { row: target, state, message, hint, autoHint: state === 'existing' || state === 'error' };
      current.cleanup = () => { windowRef.clearTimeout(timer); windowRef.clearTimeout(hintTimer); };
      feedback = current; live.textContent = message; paint();
      // New additions stay brief; existing content gets enough time for its short explanation.
      if (!persistent) timer = windowRef.setTimeout(() => { if (feedback === current) clearFeedback(); }, state === 'existing' ? 1800 : 900);
      if (state === 'error') hintTimer = windowRef.setTimeout(() => {
        current.autoHint = false;
        const status = painted?.status;
        if (feedback === current && (!status || (documentRef.activeElement !== status && !status.matches(':hover')))) hideTooltip();
      }, 2200);
    },
    dispose() {
      mounted = false; dragRow = null;
      windowRef.removeEventListener('resize', hideTooltip);
      documentRef.removeEventListener('scroll', hideTooltip, true);
      clearPointerDrag(); clearFeedback(); clearPaint();
      style?.remove(); live?.remove(); style = null; live = null;
    },
  };
}
