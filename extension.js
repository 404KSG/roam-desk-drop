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
var ROW = ".roam-app > .roam-sidebar-container .rm-left-sidebar__desk[data-rr-desk-drop]";
var CSS = `
${ROW} { position:relative; }
${ROW}[data-rr-desk-drop="ready"] {
  background-color:color-mix(in srgb,currentColor 7%,transparent) !important;
  box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 16%,transparent) !important;
  border-radius:6px;
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
@media (prefers-reduced-motion:reduce) { .rr-desk-drop-spinner { animation:none; } .rr-desk-drop-undo { transition:none; } }
`;
function createDeskDropUI({ documentRef, windowRef, onActionError }) {
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
    restore(row, "data-rr-desk-drop", marker, state);
    if (state === "pending") restore(row, "aria-busy", busy, "true");
    painted = null;
  }
  function icon(state) {
    if (state === "pending") {
      const spinner = documentRef.createElement("span");
      spinner.className = "rr-desk-drop-spinner";
      spinner.setAttribute("aria-hidden", "true");
      return spinner;
    }
    const svg = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "rr-desk-drop-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", state === "ready" ? "M8 3v10M3 8h10" : state === "error" ? "M8 5v3M8 11h.01M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12" : "m3 8 3 3 7-7");
    svg.appendChild(path);
    return svg;
  }
  function paint() {
    clearPaint();
    const model = dragRow ? { row: dragRow, state: "ready" } : feedback;
    if (!mounted || !model?.row?.isConnected) return;
    const { row } = model, state = model.running ? "pending" : model.state;
    const accessory = documentRef.createElement("span");
    accessory.className = "rr-desk-drop-accessory";
    painted = { row, accessory, marker: row.getAttribute("data-rr-desk-drop"), busy: row.getAttribute("aria-busy"), state };
    row.setAttribute("data-rr-desk-drop", state);
    if (state === "pending") row.setAttribute("aria-busy", "true");
    const status = documentRef.createElement("span");
    status.appendChild(icon(state));
    if (model.message) status.title = model.message;
    if (state === "error") {
      status.className = "rr-desk-drop-error";
      status.tabIndex = 0;
      status.setAttribute("role", "img");
      status.setAttribute("aria-label", model.message);
    }
    accessory.appendChild(status);
    if (!dragRow && model.undo && !model.running) {
      const undo = documentRef.createElement("button");
      undo.type = "button";
      undo.className = "rr-desk-drop-undo";
      undo.dataset.rrDeskDropAction = "undo";
      undo.textContent = "Undo";
      undo.title = "Undo last add to Desk";
      undo.setAttribute("aria-label", undo.title);
      undo.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (feedback !== model || model.running) return;
        model.pause();
        model.running = true;
        paint();
        live.textContent = "Removing Desk entry.";
        try {
          await model.undo();
        } catch (error) {
          if (mounted && feedback === model) onActionError?.(error, row);
        } finally {
          if (mounted && feedback === model) {
            model.running = false;
            paint();
            model.arm();
          }
        }
      });
      accessory.appendChild(undo);
    }
    row.appendChild(accessory);
  }
  function clearHighlight() {
    if (!dragRow) return;
    dragRow = null;
    paint();
  }
  function clearFeedback() {
    feedback?.cleanup();
    feedback = null;
    if (live) live.textContent = "";
    paint();
  }
  return {
    mount() {
      if (mounted) return;
      mounted = true;
      style = documentRef.createElement("style");
      style.dataset.rrDeskDropStyle = "true";
      style.textContent = CSS;
      documentRef.head.appendChild(style);
      live = documentRef.createElement("div");
      live.className = "rr-desk-drop-live";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      live.setAttribute("aria-atomic", "true");
      documentRef.body.appendChild(live);
    },
    highlight(target) {
      if (!mounted || dragRow === target && painted?.accessory.isConnected) return;
      dragRow = target;
      paint();
    },
    clearHighlight,
    activeRow: () => dragRow,
    clearFeedback,
    show(message, { target, state = "added", undo, persistent = false } = {}) {
      if (!mounted || !target?.isConnected) return;
      clearFeedback();
      let timer;
      const current = { row: target, state, message, undo };
      current.pause = () => windowRef.clearTimeout(timer);
      current.arm = () => {
        current.pause();
        if (persistent || current.running || target.matches(":hover") || target.contains(documentRef.activeElement)) return;
        timer = windowRef.setTimeout(() => {
          if (feedback === current) clearFeedback();
        }, undo ? 8e3 : 1800);
      };
      const focusOut = (event) => {
        if (!target.contains(event.relatedTarget)) current.arm();
      };
      const listeners = [["mouseenter", current.pause], ["mouseleave", current.arm], ["focusin", current.pause], ["focusout", focusOut]];
      current.cleanup = () => {
        current.pause();
        for (const [type, listener] of listeners) target.removeEventListener(type, listener);
      };
      for (const [type, listener] of listeners) target.addEventListener(type, listener);
      feedback = current;
      live.textContent = message;
      paint();
      current.arm();
    },
    dispose() {
      mounted = false;
      dragRow = null;
      clearFeedback();
      clearPaint();
      style?.remove();
      live?.remove();
      style = null;
      live = null;
    }
  };
}

// src/runtime.js
var DESK_SELECTOR = ".roam-app > .roam-sidebar-container .rm-left-sidebar__desk";
var AMBIGUOUS = ".rm-reference-container,.rm-reference-item,.roam-query,.roam-query-content,.rm-embed-container";
function createDeskDropRuntime({ windowRef, documentRef = windowRef.document, getAPI = () => windowRef.roamAlphaAPI }) {
  const capture = createDeskCapture({ getAPI });
  const controller = new AbortController();
  let loaded = false, stopped = false, session = null, context, feedbackVersion = 0;
  const ui = createDeskDropUI({ documentRef, windowRef, onActionError: showError });
  function showError(error, target = documentRef.querySelector(DESK_SELECTOR)) {
    if (!loaded || error?.code === "ABORTED") return;
    ui.show(error instanceof DeskDropError ? error.message : "Could not complete the operation. Check Desk; Desk Drop has not moved the original block.", { target, state: "error", persistent: true });
  }
  function clearFeedback() {
    feedbackVersion++;
    ui.clearFeedback();
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
    clearFeedback();
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
    const version = ++feedbackVersion;
    try {
      if (!sameContext(source.origin, capture.getContext())) throw new DeskDropError("CONTEXT_CHANGED", "The graph or user changed during the drag. Start a new drag.");
      const uids2 = readDropPayload(event.dataTransfer, source.origin, source.sourceUid);
      ui.show("Adding to Desk.", { target, state: "pending", persistent: true });
      const result = await capture.capture({ uids: uids2, origin: source.origin, signal: controller.signal });
      if (!loaded || version !== feedbackVersion) return;
      const undo = result.receipt ? async () => {
        await capture.undo(result.receipt, { signal: controller.signal });
        if (loaded && version === feedbackVersion) ui.show("Removed this Desk entry. Original block kept.", { target, state: "removed" });
      } : void 0;
      ui.show(result.status === "existing" ? "Already on Desk. No duplicate added." : "Added to Desk. Original kept in place.", { target, state: result.status === "existing" ? "existing" : "added", undo });
    } catch (error) {
      if (version === feedbackVersion) showError(error, target);
    }
  }
  function onKeyDown(event) {
    if (event.key === "Escape") {
      resetDrag();
      clearFeedback();
    }
  }
  function onHashChange() {
    resetDrag();
    try {
      const next = capture.getContext();
      if (!sameContext(context, next)) clearFeedback();
      context = next;
    } catch {
      clearFeedback();
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
