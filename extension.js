// src/roam-adapter.js
var DeskDropError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeskDropError";
    this.code = code;
  }
};
var sameContext = (a, b) => Boolean(a && b && a.graphName === b.graphName && a.graphType === b.graphType && a.userUid === b.userUid);
var field = (entity, key) => entity?.[`:${key}`] ?? entity?.[key] ?? entity?.[key.split("/").at(-1)];
var uids = (values) => (values ?? []).map((value) => field(value, "block/uid")).filter(Boolean);
var BLOCK = "[:block/uid :node/title :block/string :edit/time {:block/page [:block/uid]} {:block/_children [:block/uid]} {:block/children [:block/uid]} {:block/_refs [:block/uid]}]";
var DESK = "[:block/uid :node/title {:block/children [:block/uid :block/string]}]";
function createRoamDeskAdapter({ getAPI }) {
  function api() {
    const value = getAPI?.();
    if (!value?.data?.pull || !value?.data?.block?.create || !value?.user?.uid || !value?.util?.generateUID) {
      throw new DeskDropError("UNSUPPORTED_API", "This Roam version does not expose the required public APIs.");
    }
    return value;
  }
  function getContext() {
    const value = api();
    const context = { graphName: value.graph?.name, graphType: value.graph?.type, userUid: value.user.uid() };
    if (!context.graphName || !context.graphType || !context.userUid) {
      throw new DeskDropError("NO_CONTEXT", "Sign in and open a Roam graph to use Desk Drop.");
    }
    return Object.freeze(context);
  }
  function assertContext(context) {
    if (!sameContext(getContext(), context)) throw new DeskDropError("CONTEXT_CHANGED", "The graph or user changed. Operation stopped; check the original graph if you just dropped a block.");
  }
  async function readBlock(uid) {
    const entity = await api().data.pull(BLOCK, [":block/uid", uid]);
    if (!entity || !field(entity, "block/uid")) return null;
    return {
      uid: field(entity, "block/uid"),
      title: field(entity, "node/title"),
      string: field(entity, "block/string"),
      edited: field(entity, "edit/time"),
      pageUid: field(field(entity, "block/page"), "block/uid"),
      parentUids: uids(field(entity, "block/_children")),
      childUids: uids(field(entity, "block/children")),
      referrerUids: uids(field(entity, "block/_refs"))
    };
  }
  async function resolveDesk(context) {
    assertContext(context);
    const user = await api().data.pull("[:user/desk-page]", [":user/uid", context.userUid]);
    assertContext(context);
    const uid = field(user, "user/desk-page");
    if (typeof uid !== "string" || !uid) {
      throw new DeskDropError("DESK_UNBOUND", "Open native Desk once before dropping a block.");
    }
    const page = await api().data.pull(DESK, [":block/uid", uid]);
    assertContext(context);
    if (field(page, "block/uid") !== uid || typeof field(page, "node/title") !== "string") {
      throw new DeskDropError("DESK_MISSING", "The bound Desk page is missing or invalid. Recover it through native Desk first.");
    }
    return {
      uid,
      entries: (field(page, "block/children") ?? []).map((entry) => ({ uid: field(entry, "block/uid"), string: field(entry, "block/string") }))
    };
  }
  return {
    getContext,
    assertContext,
    readBlock,
    resolveDesk,
    isDeskPage: async (uid) => {
      if (typeof api().data.q !== "function") throw new DeskDropError("UNSUPPORTED_API", "This Roam version lacks the query API required for safety checks.");
      return await api().data.q("[:find ?u . :in $ ?pageUid :where [?u :user/desk-page ?pageUid]]", uid) != null;
    },
    generateUID: () => api().util.generateUID(),
    deleteEntry: (uid) => {
      if (typeof api().data.block.delete !== "function") throw new DeskDropError("UNSUPPORTED_API", "This Roam version lacks the API required to remove an entry safely.");
      return api().data.block.delete({ block: { uid } });
    },
    createEntry: ({ deskUid, uid, string }) => api().data.block.create({
      location: { "parent-uid": deskUid, order: "first" },
      block: { uid, string }
    })
  };
}

// src/desk-capture.js
var isSafeUid = (uid) => typeof uid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
function embeddedBlockUid(string) {
  if (typeof string !== "string") return null;
  return string.match(/^\s*\{\{\s*(?:embed(?:-path)?|\[\[embed(?:-path)?\]\])\s*:\s*\(\(([A-Za-z0-9_-]+)\)\)(?=\s|\}\})[^{}]*\}\}/)?.[1] ?? null;
}
function createDeskCapture({ getAPI }) {
  const adapter = createRoamDeskAdapter({ getAPI });
  const pendingWrites = /* @__PURE__ */ new Map();
  const interrupted = (error) => ["ABORTED", "CONTEXT_CHANGED", "NO_CONTEXT"].includes(error?.code);
  const unconfirmed = () => new DeskDropError("WRITE_UNCONFIRMED", "Could not confirm the result. Further attempts for this block are paused; check Desk first.");
  let receipts = /* @__PURE__ */ new WeakMap(), tail = Promise.resolve(), disposed = false;
  function active(signal) {
    if (disposed || signal?.aborted) throw new DeskDropError("ABORTED", "Desk Drop has stopped; this operation will not continue.");
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
    const next = tail.then(() => {
      active();
      return fn();
    });
    tail = next.catch(() => {
    });
    return next;
  }
  async function captureOne({ uids: uids2, origin, signal }) {
    const run = (fn) => guarded(origin, fn, signal);
    active(signal);
    adapter.assertContext(origin);
    if (!Array.isArray(uids2) || uids2.length !== 1) throw new DeskDropError("SINGLE_BLOCK_ONLY", "This version accepts one top-level block at a time. Drag blocks individually.");
    const sourceUid = uids2[0];
    if (!isSafeUid(sourceUid)) throw new DeskDropError("INVALID_UID", "Could not safely identify the block UID.");
    const desk = await run(() => adapter.resolveDesk(origin));
    if (sourceUid === desk.uid) throw new DeskDropError("DESK_SOURCE", "Desk cannot be added to itself.");
    const source = await run(() => adapter.readBlock(sourceUid));
    if (!source || source.uid !== sourceUid) throw new DeskDropError("SOURCE_MISSING", "The source block no longer exists. Nothing was added to Desk.");
    if (typeof source.title === "string" || typeof source.string !== "string") throw new DeskDropError("NOT_A_BLOCK", "This version accepts blocks, not whole pages.");
    if (!source.pageUid) throw new DeskDropError("SOURCE_METADATA", "Could not identify the source page. Nothing was added to Desk.");
    if (await run(() => adapter.isDeskPage(source.pageUid))) throw new DeskDropError("DESK_SOURCE", "Notes already inside a Desk page cannot be added again.");
    const currentDesk = await run(() => adapter.resolveDesk(origin));
    if (currentDesk.uid !== desk.uid) throw new DeskDropError("DESK_CHANGED", "The Desk binding changed. Please drag the block again.");
    const key = JSON.stringify([origin.graphName, origin.graphType, origin.userUid, desk.uid, sourceUid]);
    const existing = currentDesk.entries.find((entry2) => embeddedBlockUid(entry2.string) === sourceUid);
    if (existing) {
      pendingWrites.delete(key);
      return { status: "existing", entryUid: existing.uid, sourceUid, deskUid: desk.uid, context: origin };
    }
    const string = `{{embed-path: ((${sourceUid})) closed}}`;
    const validEntry = (entry2, expectedUid) => entry2?.uid === expectedUid && entry2.string === string && entry2.parentUids.length === 1 && entry2.parentUids[0] === desk.uid;
    const pending = pendingWrites.get(key);
    if (pending) {
      const entry2 = await run(() => adapter.readBlock(pending));
      if (!validEntry(entry2, pending)) throw unconfirmed();
      pendingWrites.delete(key);
      return { status: "existing", entryUid: pending, sourceUid, deskUid: desk.uid, context: origin };
    }
    const uid = adapter.generateUID();
    if (!isSafeUid(uid)) throw new DeskDropError("UNSUPPORTED_API", "Roam returned a UID that cannot be used safely.");
    pendingWrites.set(key, uid);
    try {
      await run(() => adapter.createEntry({ deskUid: desk.uid, uid, string }));
    } catch (error) {
      if (interrupted(error)) throw error;
    }
    let entry;
    try {
      entry = await run(() => adapter.readBlock(uid));
    } catch (error) {
      if (interrupted(error)) throw error;
      throw unconfirmed();
    }
    if (!validEntry(entry, uid)) throw unconfirmed();
    pendingWrites.delete(key);
    let receipt;
    if (Number.isFinite(entry.edited)) {
      receipt = Object.freeze({ entryUid: uid });
      receipts.set(receipt, { entry, deskUid: desk.uid, context: origin });
    }
    return { status: "added", entryUid: uid, sourceUid, deskUid: desk.uid, context: origin, receipt };
  }
  async function undoOne(receipt, signal) {
    active(signal);
    const saved = receipt && receipts.get(receipt);
    if (!saved) throw new DeskDropError("INVALID_RECEIPT", "Undo is no longer available for this entry.");
    const run = (fn) => guarded(saved.context, fn, signal);
    const desk = await run(() => adapter.resolveDesk(saved.context));
    if (desk.uid !== saved.deskUid) throw new DeskDropError("DESK_CHANGED", "The Desk binding changed. Please handle this entry manually.");
    const current = await run(() => adapter.readBlock(saved.entry.uid));
    if (!current) {
      receipts.delete(receipt);
      return { status: "already-removed" };
    }
    if (current.string !== saved.entry.string || current.edited !== saved.entry.edited || current.parentUids.length !== 1 || current.parentUids[0] !== saved.deskUid || current.childUids.length || current.referrerUids.length || typeof current.title === "string") {
      throw new DeskDropError("UNDO_UNSAFE", "This entry has changed or is in use. Please review it in Desk.");
    }
    try {
      await run(() => adapter.deleteEntry(current.uid));
    } catch (error) {
      if (interrupted(error)) throw error;
    }
    if (await run(() => adapter.readBlock(current.uid))) throw new DeskDropError("UNDO_UNCONFIRMED", "Could not confirm Undo. Check Desk before trying again.");
    receipts.delete(receipt);
    return { status: "undone" };
  }
  return {
    getContext() {
      active();
      return adapter.getContext();
    },
    capture(request = {}) {
      const origin = Object.freeze({ graphName: request.origin?.graphName, graphType: request.origin?.graphType, userUid: request.origin?.userUid });
      const uids2 = Array.isArray(request.uids) ? [...request.uids] : request.uids;
      return enqueue(() => captureOne({ uids: uids2, origin, signal: request.signal }));
    },
    undo: (receipt, { signal } = {}) => enqueue(() => undoOne(receipt, signal)),
    dispose() {
      disposed = true;
      receipts = /* @__PURE__ */ new WeakMap();
      pendingWrites.clear();
    }
  };
}

// src/drop-payload.js
var lines = (value) => typeof value === "string" ? [...new Set(value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean))] : [];
var hasRoamPayload = (transfer) => Array.from(transfer?.types ?? []).some((type) => ["roam/block-uid-list-only-parents", "roam/block-uid-list"].includes(type));
var hasModifier = (event) => Boolean(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
function readDropPayload(transfer, origin, expectedSourceUid) {
  if (!hasRoamPayload(transfer) || typeof transfer.getData !== "function") throw new DeskDropError("INVALID_PAYLOAD", "Only native block drags from Roam are accepted.");
  const uids2 = lines(transfer.getData("roam/block-uid-list-only-parents") || transfer.getData("roam/block-uid-list"));
  if (uids2.length !== 1) throw new DeskDropError("SINGLE_BLOCK_ONLY", "This version accepts one top-level block at a time. Drag blocks individually.");
  if (!isSafeUid(uids2[0])) throw new DeskDropError("INVALID_UID", "Could not safely identify the dragged block.");
  if (expectedSourceUid && expectedSourceUid !== uids2[0]) throw new DeskDropError("SOURCE_CHANGED", "The drag source does not match its payload. Clear the selection and try again.");
  const uris = lines(transfer.getData("roam/roam-uri-list"));
  if (!uris.length || uris.length > 1e3) throw new DeskDropError("INVALID_PAYLOAD", "Could not confirm the source graph. Nothing was added to Desk.");
  const parsed = uris.map((uri) => {
    try {
      const url = new URL(uri);
      const trusted = url.protocol === "roam:" && !url.hostname || url.protocol === "https:" && ["roamresearch.com", "www.roamresearch.com"].includes(url.hostname);
      const match = url.hash.match(/^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)\/?(?:\?.*)?$/);
      if (!trusted || !match) throw new Error("Unsupported URI");
      return { type: match[1] === "app" ? "hosted" : "offline", graph: decodeURIComponent(match[2]), uid: decodeURIComponent(match[3]) };
    } catch {
      throw new DeskDropError("INVALID_PAYLOAD", "Could not recognize the native Roam link. Nothing was added to Desk.");
    }
  });
  if (parsed.some((item) => item.graph !== origin?.graphName || item.type !== origin?.graphType)) {
    throw new DeskDropError("CROSS_GRAPH", "Cross-graph drops are not supported in this version.");
  }
  if (!parsed.some((item) => item.uid === uids2[0])) throw new DeskDropError("INVALID_PAYLOAD", "The drag link does not match the block UID.");
  return uids2;
}

// src/ui.js
var CSS = `
[data-rr-desk-drop="ready"] { position: relative; }
.rr-desk-drop-hint { position:absolute; inset:0; display:flex; align-items:center; box-sizing:border-box; padding:0 10px; border:1px solid #a7b6c2; border-radius:6px; background:#f5f8fa; color:#5c7080; font:inherit; font-size:12px; white-space:nowrap; pointer-events:none; }
.rr-desk-drop-notice { position:fixed; right:20px; bottom:80px; z-index:20; max-width:min(390px,calc(100vw - 40px)); padding:12px 14px; box-sizing:border-box; border:1px solid #e1e8ed; border-radius:8px; background:#fff; color:#202b33; box-shadow:0 2px 10px rgba(16,22,26,.12); font:14px/1.5 system-ui,sans-serif; }
.rr-desk-drop-notice[data-kind="error"] { border-color:#d99e0b; }
.rr-desk-drop-notice__actions { display:flex; gap:6px; margin-top:8px; }
.rr-desk-drop-notice button { border:1px solid #e1e8ed; border-radius:4px; padding:3px 8px; background:#f5f8fa; color:#202b33; font:inherit; cursor:pointer; }
.rr-desk-drop-notice button:focus-visible { outline:2px solid #137cbd; outline-offset:2px; }
.rr-desk-drop-notice button:disabled { opacity:.6; cursor:wait; }
`;
function createDeskDropUI({ documentRef, windowRef, onActionError }) {
  let style, row, hint, oldMarker, notice, timer, mounted = false;
  function clearHighlight() {
    hint?.remove();
    hint = null;
    if (row) {
      if (oldMarker === null) row.removeAttribute("data-rr-desk-drop");
      else row.setAttribute("data-rr-desk-drop", oldMarker);
    }
    row = null;
  }
  function clearNotice() {
    windowRef.clearTimeout(timer);
    notice?.remove();
    notice = null;
  }
  return {
    mount() {
      if (mounted) return;
      mounted = true;
      style = documentRef.createElement("style");
      style.dataset.rrDeskDropStyle = "true";
      style.textContent = CSS;
      documentRef.head.appendChild(style);
    },
    highlight(target) {
      if (!mounted || row === target && hint?.isConnected) return;
      clearHighlight();
      row = target;
      oldMarker = row.getAttribute("data-rr-desk-drop");
      row.setAttribute("data-rr-desk-drop", "ready");
      hint = documentRef.createElement("span");
      hint.className = "rr-desk-drop-hint";
      hint.textContent = "Add to Desk \xB7 keep original";
      hint.setAttribute("aria-hidden", "true");
      row.appendChild(hint);
    },
    clearHighlight,
    activeRow: () => row,
    clearNotice,
    show(message, { kind = "success", actions = [], persistent = false } = {}) {
      if (!mounted) return;
      clearNotice();
      notice = documentRef.createElement("div");
      notice.className = "rr-desk-drop-notice";
      notice.dataset.kind = kind;
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      const text = documentRef.createElement("div");
      text.textContent = message;
      notice.appendChild(text);
      const buttons = documentRef.createElement("div");
      buttons.className = "rr-desk-drop-notice__actions";
      for (const action of [...actions, { id: "dismiss", label: "Dismiss", run: clearNotice }]) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.dataset.rrDeskDropAction = action.id;
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          button.disabled = true;
          windowRef.clearTimeout(timer);
          try {
            await action.run();
          } catch (error) {
            onActionError?.(error);
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        });
        buttons.appendChild(button);
      }
      notice.appendChild(buttons);
      documentRef.body.appendChild(notice);
      if (!persistent) {
        const current = notice;
        const arm = () => {
          windowRef.clearTimeout(timer);
          timer = windowRef.setTimeout(() => {
            if (notice === current) clearNotice();
          }, 12e3);
        };
        notice.addEventListener("mouseenter", () => windowRef.clearTimeout(timer));
        notice.addEventListener("mouseleave", arm);
        notice.addEventListener("focusin", () => windowRef.clearTimeout(timer));
        notice.addEventListener("focusout", (event) => {
          if (!notice?.contains(event.relatedTarget)) arm();
        });
        arm();
      }
    },
    dispose() {
      mounted = false;
      clearHighlight();
      clearNotice();
      style?.remove();
      style = null;
    }
  };
}

// src/runtime.js
var DESK_SELECTOR = ".roam-app > .roam-sidebar-container .rm-left-sidebar__desk";
var AMBIGUOUS = ".rm-reference-container,.rm-reference-item,.roam-query,.roam-query-content,.rm-embed-container";
function createDeskDropRuntime({ windowRef, documentRef = windowRef.document, getAPI = () => windowRef.roamAlphaAPI }) {
  const capture = createDeskCapture({ getAPI });
  const controller = new AbortController();
  let loaded = false, stopped = false, session = null, context;
  const ui = createDeskDropUI({ documentRef, windowRef, onActionError: showError });
  function showError(error) {
    if (!loaded || error?.code === "ABORTED") return;
    ui.show(error instanceof DeskDropError ? error.message : "Could not complete the operation. Check Desk; Desk Drop has not moved the original block.", { kind: "error", persistent: true });
  }
  function resetDrag() {
    session = null;
    ui.clearHighlight();
  }
  function transferEffect(transfer) {
    const allowed = transfer?.effectAllowed || "uninitialized";
    if (["all", "uninitialized", "link", "copyLink", "linkMove"].includes(allowed)) return "link";
    if (["copy", "copyMove"].includes(allowed)) return "copy";
    return null;
  }
  function currentSession() {
    try {
      return session && sameContext(session.origin, capture.getContext());
    } catch {
      return false;
    }
  }
  function targetOf(event) {
    return event.target?.closest?.(DESK_SELECTOR);
  }
  function onDragStart(event) {
    resetDrag();
    if (event.defaultPrevented || hasModifier(event)) return;
    const bullet = event.target?.closest?.(".rm-bullet");
    if (!bullet || bullet.closest(AMBIGUOUS) || !bullet.closest(".roam-article,.rm-sidebar-outline,.rm-sidebar-window")) return;
    try {
      session = {
        origin: capture.getContext(),
        sourceUid: bullet.closest("[data-block-uid]")?.getAttribute("data-block-uid") || void 0
      };
    } catch (error) {
      showError(error);
    }
  }
  function onDragOver(event) {
    const target = targetOf(event), effect = transferEffect(event.dataTransfer);
    if (!target || !currentSession() || hasModifier(event) || !hasRoamPayload(event.dataTransfer) || !effect) {
      ui.clearHighlight();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = effect;
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
    event.preventDefault();
    event.stopPropagation();
    try {
      if (!sameContext(source.origin, capture.getContext())) throw new DeskDropError("CONTEXT_CHANGED", "The graph or user changed during the drag. Start a new drag.");
      const uids2 = readDropPayload(event.dataTransfer, source.origin, source.sourceUid);
      ui.show("Adding to Desk...", { persistent: true });
      const result = await capture.capture({ uids: uids2, origin: source.origin, signal: controller.signal });
      if (!loaded) return;
      const actions = [{ id: "view", label: "View", run: () => {
        if (!sameContext(result.context, capture.getContext())) throw new DeskDropError("CONTEXT_CHANGED", "Return to the original graph to view Desk.");
        const row = documentRef.querySelector(DESK_SELECTOR);
        if (!row) throw new DeskDropError("DESK_NOT_VISIBLE", "The native Desk entry was not found. Open Desk from the left sidebar.");
        row.click();
      } }];
      if (result.receipt) actions.push({ id: "undo", label: "Undo", run: async () => {
        await capture.undo(result.receipt, { signal: controller.signal });
        if (loaded) ui.show("Removed this Desk entry. Original block kept.");
      } });
      ui.show(result.status === "existing" ? "Already on Desk. No duplicate added." : "Added to Desk. Original kept in place.", { actions });
    } catch (error) {
      showError(error);
    }
  }
  function onKeyDown(event) {
    if (event.key === "Escape") resetDrag();
  }
  function onHashChange() {
    resetDrag();
    try {
      const next = capture.getContext();
      if (!sameContext(context, next)) ui.clearNotice();
      context = next;
    } catch {
      ui.clearNotice();
    }
  }
  const windowListeners = [["dragstart", onDragStart], ["dragend", resetDrag], ["blur", resetDrag], ["keydown", onKeyDown], ["hashchange", onHashChange]];
  const documentListeners = [["dragenter", onDragOver], ["dragover", onDragOver], ["dragleave", onDragLeave], ["drop", onDrop]];
  return {
    start() {
      if (loaded) return;
      if (stopped) throw new DeskDropError("ABORTED", "Create a new plugin instance before restarting.");
      context = capture.getContext();
      loaded = true;
      ui.mount();
      for (const [type, listener] of windowListeners) windowRef.addEventListener(type, listener, true);
      for (const [type, listener] of documentListeners) documentRef.addEventListener(type, listener, true);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      loaded = false;
      controller.abort();
      capture.dispose();
      for (const [type, listener] of windowListeners) windowRef.removeEventListener(type, listener, true);
      for (const [type, listener] of documentListeners) documentRef.removeEventListener(type, listener, true);
      resetDrag();
      ui.dispose();
    }
  };
}

// src/extension-entry.js
var KEY = /* @__PURE__ */ Symbol.for("404ksg.roam-desk-drop.runtime");
function createExtensionLifecycle(windowRef = globalThis.window) {
  let runtime;
  return {
    onload() {
      if (!windowRef?.document) throw new Error("Desk Drop requires a Roam browser environment.");
      windowRef[KEY]?.stop?.();
      runtime?.stop();
      delete windowRef[KEY];
      const next = createDeskDropRuntime({ windowRef });
      try {
        next.start();
        runtime = next;
        windowRef[KEY] = next;
      } catch (error) {
        next.stop();
        runtime = null;
        throw error;
      }
    },
    onunload() {
      const current = runtime;
      runtime = null;
      current?.stop();
      if (windowRef && windowRef[KEY] === current) delete windowRef[KEY];
    }
  };
}
var extension_entry_default = createExtensionLifecycle();
export {
  createExtensionLifecycle,
  extension_entry_default as default
};
