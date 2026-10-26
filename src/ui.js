const ROW = '.roam-app > .roam-sidebar-container .rm-left-sidebar__desk[data-rr-desk-drop]';
// Outrank important sidebar hover paint only while this exact Desk row accepts a drop.
const READY_ROW = '.roam-body .roam-app > .roam-sidebar-container .roam-sidebar-content div.log-button.rm-left-sidebar__desk[data-rr-desk-drop="ready"]';
const CSS = `
${ROW} { position:relative; }
${READY_ROW} {
  background-color:color-mix(in srgb,currentColor 7%,transparent) !important;
  border-radius:6px;
  transition:background-color 100ms ease;
}
.rr-desk-drop-accessory { position:absolute; right:10px; top:50%; transform:translateY(-50%); display:flex; align-items:center; gap:6px; height:20px; color:inherit; pointer-events:none; }
.rr-desk-drop-icon { display:block; width:14px; height:14px; flex:none; opacity:.8; }
.rr-desk-drop-error { color:var(--rr-desk-drop-warning,#a87936); pointer-events:auto; cursor:help; border-radius:3px; }
.rr-desk-drop-undo { all:unset; box-sizing:border-box; padding:2px 3px; border-radius:3px; color:inherit; font:inherit; font-size:11px; line-height:16px; cursor:pointer; opacity:0; pointer-events:none; transition:opacity 100ms ease; }
${ROW}:hover .rr-desk-drop-undo, ${ROW}:focus-within .rr-desk-drop-undo { opacity:.8; pointer-events:auto; }
${ROW} .rr-desk-drop-undo:hover { opacity:1; text-decoration:underline; text-underline-offset:3px; }
.rr-desk-drop-undo:focus-visible, .rr-desk-drop-error:focus-visible { outline:2px solid currentColor; outline-offset:2px; opacity:1; }
.rr-desk-drop-spinner { display:block; box-sizing:border-box; width:13px; height:13px; border:1.5px solid currentColor; border-right-color:transparent; border-radius:50%; opacity:.65; animation:rr-desk-drop-spin 800ms linear infinite; }
.rr-desk-drop-live { position:absolute !important; top:0 !important; left:0 !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important; overflow:hidden !important; clip-path:inset(50%) !important; white-space:nowrap !important; border:0 !important; }
@keyframes rr-desk-drop-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { ${READY_ROW} { transition:none; } .rr-desk-drop-spinner { animation:none; } .rr-desk-drop-undo { transition:none; } }
`;

export function createDeskDropUI({ documentRef, windowRef, onActionError }) {
  let style, live, dragRow, feedback, painted, mounted = false;
  const restore = (node, name, oldValue, ownValue) => {
    if (node.getAttribute(name) !== ownValue) return;
    if (oldValue === null) node.removeAttribute(name);
    else node.setAttribute(name, oldValue);
  };
  function clearPaint() {
    if (!painted) return;
    const { row, accessory, marker, busy, state } = painted;
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
    svg.setAttribute('class', 'rr-desk-drop-icon'); svg.setAttribute('viewBox', '0 0 16 16');
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
    const { row } = model, state = model.running ? 'pending' : model.state;
    const accessory = documentRef.createElement('span'); accessory.className = 'rr-desk-drop-accessory';
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
    if (!dragRow && model.undo && !model.running) {
      const undo = documentRef.createElement('button'); undo.type = 'button';
      undo.className = 'rr-desk-drop-undo'; undo.dataset.rrDeskDropAction = 'undo';
      undo.textContent = 'Undo'; undo.title = 'Undo last add to Desk'; undo.setAttribute('aria-label', undo.title);
      undo.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation();
        if (feedback !== model || model.running) return;
        model.pause(); model.running = true; paint();
        live.textContent = 'Removing Desk entry.';
        try { await model.undo(); }
        catch (error) { if (mounted && feedback === model) onActionError?.(error, row); }
        finally {
          if (mounted && feedback === model) { model.running = false; paint(); model.arm(); }
        }
      });
      accessory.appendChild(undo);
    }
    row.appendChild(accessory);
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
    activeRow: () => dragRow,
    clearFeedback,
    show(message, { target, state = 'added', undo, persistent = false } = {}) {
      if (!mounted || !target?.isConnected) return;
      clearFeedback();
      let timer;
      const current = { row: target, state, message, undo };
      current.pause = () => windowRef.clearTimeout(timer);
      current.arm = () => {
        current.pause();
        if (persistent || current.running || target.matches(':hover') || target.contains(documentRef.activeElement)) return;
        timer = windowRef.setTimeout(() => { if (feedback === current) clearFeedback(); }, undo ? 8000 : 1800);
      };
      const focusOut = event => { if (!target.contains(event.relatedTarget)) current.arm(); };
      const listeners = [['mouseenter', current.pause], ['mouseleave', current.arm], ['focusin', current.pause], ['focusout', focusOut]];
      current.cleanup = () => { current.pause(); for (const [type, listener] of listeners) target.removeEventListener(type, listener); };
      for (const [type, listener] of listeners) target.addEventListener(type, listener);
      feedback = current; live.textContent = message; paint(); current.arm();
    },
    dispose() {
      mounted = false; dragRow = null; clearFeedback(); clearPaint();
      style?.remove(); live?.remove(); style = null; live = null;
    },
  };
}
