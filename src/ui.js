const CSS = `
[data-rr-desk-drop="ready"] { position: relative; }
.rr-desk-drop-hint { position:absolute; inset:0; display:flex; align-items:center; box-sizing:border-box; padding:0 10px; border:1px solid #a7b6c2; border-radius:6px; background:#f5f8fa; color:#5c7080; font:inherit; font-size:12px; white-space:nowrap; pointer-events:none; }
.rr-desk-drop-notice { position:fixed; right:20px; bottom:80px; z-index:20; max-width:min(390px,calc(100vw - 40px)); padding:12px 14px; box-sizing:border-box; border:1px solid #e1e8ed; border-radius:8px; background:#fff; color:#202b33; box-shadow:0 2px 10px rgba(16,22,26,.12); font:14px/1.5 system-ui,sans-serif; }
.rr-desk-drop-notice[data-kind="error"] { border-color:#d99e0b; }
.rr-desk-drop-notice__actions { display:flex; gap:6px; margin-top:8px; }
.rr-desk-drop-notice button { border:1px solid #e1e8ed; border-radius:4px; padding:3px 8px; background:#f5f8fa; color:#202b33; font:inherit; cursor:pointer; }
.rr-desk-drop-notice button:focus-visible { outline:2px solid #137cbd; outline-offset:2px; }
.rr-desk-drop-notice button:disabled { opacity:.6; cursor:wait; }
`;

export function createDeskDropUI({ documentRef, windowRef, onActionError }) {
  let style, row, hint, oldMarker, notice, timer, mounted = false;
  function clearHighlight() {
    hint?.remove(); hint = null;
    if (row) {
      if (oldMarker === null) row.removeAttribute('data-rr-desk-drop');
      else row.setAttribute('data-rr-desk-drop', oldMarker);
    }
    row = null;
  }
  function clearNotice() {
    windowRef.clearTimeout(timer);
    notice?.remove(); notice = null;
  }
  return {
    mount() {
      if (mounted) return;
      mounted = true;
      style = documentRef.createElement('style');
      style.dataset.rrDeskDropStyle = 'true'; style.textContent = CSS;
      documentRef.head.appendChild(style);
    },
    highlight(target) {
      if (!mounted || (row === target && hint?.isConnected)) return;
      clearHighlight(); row = target;
      oldMarker = row.getAttribute('data-rr-desk-drop');
      row.setAttribute('data-rr-desk-drop', 'ready');
      hint = documentRef.createElement('span'); hint.className = 'rr-desk-drop-hint';
      hint.textContent = '放入 Desk · 原文保留'; hint.setAttribute('aria-hidden', 'true');
      row.appendChild(hint);
    },
    clearHighlight,
    activeRow: () => row,
    clearNotice,
    show(message, { kind = 'success', actions = [], persistent = false } = {}) {
      if (!mounted) return;
      clearNotice();
      notice = documentRef.createElement('div'); notice.className = 'rr-desk-drop-notice';
      notice.dataset.kind = kind; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
      const text = documentRef.createElement('div'); text.textContent = message; notice.appendChild(text);
      const buttons = documentRef.createElement('div'); buttons.className = 'rr-desk-drop-notice__actions';
      for (const action of [...actions, { id: 'dismiss', label: '关闭', run: clearNotice }]) {
        const button = documentRef.createElement('button'); button.type = 'button';
        button.textContent = action.label; button.dataset.rrDeskDropAction = action.id;
        button.addEventListener('click', async event => {
          event.preventDefault(); event.stopPropagation(); button.disabled = true;
          windowRef.clearTimeout(timer);
          try { await action.run(); } catch (error) { onActionError?.(error); }
          finally { if (button.isConnected) button.disabled = false; }
        });
        buttons.appendChild(button);
      }
      notice.appendChild(buttons); documentRef.body.appendChild(notice);
      if (!persistent) {
        const current = notice;
        const arm = () => { windowRef.clearTimeout(timer); timer = windowRef.setTimeout(() => { if (notice === current) clearNotice(); }, 12000); };
        notice.addEventListener('mouseenter', () => windowRef.clearTimeout(timer));
        notice.addEventListener('mouseleave', arm);
        notice.addEventListener('focusin', () => windowRef.clearTimeout(timer));
        notice.addEventListener('focusout', event => { if (!notice?.contains(event.relatedTarget)) arm(); });
        arm();
      }
    },
    dispose() {
      mounted = false; clearHighlight(); clearNotice(); style?.remove(); style = null;
    },
  };
}
