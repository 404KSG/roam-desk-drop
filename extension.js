// src/roam-adapter.js
var DeskDropError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RoamDropError";
    this.code = code;
  }
};
var sameContext = (a, b) => Boolean(a && b && a.graphName === b.graphName && a.graphType === b.graphType && a.userUid === b.userUid);
var field = (entity, key) => entity?.[`:${key}`] ?? entity?.[key] ?? entity?.[key.split("/").at(-1)];
var uids = (values) => (values ?? []).map((value) => field(value, "block/uid")).filter(Boolean);
var BLOCK = "[:block/uid :node/title :block/string :edit/time {:block/page [:block/uid]} {:block/_children [:block/uid]} {:block/children [:block/uid]} {:block/_refs [:block/uid]}]";
var PAGE = "[:block/uid :node/title {:block/children [:block/uid :block/string]}]";
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
      throw new DeskDropError("NO_CONTEXT", "Sign in and open a Roam graph to use Roam Drop.");
    }
    return Object.freeze(context);
  }
  function assertContext(context) {
    if (!sameContext(getContext(), context)) throw new DeskDropError("CONTEXT_CHANGED", "The graph or user changed. Operation stopped; check the original graph if you just dropped a block.");
  }
  function pageView(entity, uid) {
    if (!entity || field(entity, "block/uid") !== uid) return null;
    const title = field(entity, "node/title");
    return {
      uid,
      title: typeof title === "string" ? title : void 0,
      entries: (field(entity, "block/children") ?? []).map((entry) => ({ uid: field(entry, "block/uid"), string: field(entry, "block/string") }))
    };
  }
  async function pullPage(uid) {
    return pageView(await api().data.pull(PAGE, [":block/uid", uid]), uid);
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
    if (typeof uid !== "string" || !uid) throw new DeskDropError("DESK_UNBOUND", "Open native Desk once before dropping a block.");
    const page = await pullPage(uid);
    assertContext(context);
    if (!page?.title) throw new DeskDropError("DESK_MISSING", "The bound Desk page is missing or invalid. Recover it through native Desk first.");
    return { kind: "desk", ...page };
  }
  async function resolveDaily(context, acceptedAt, assertActive) {
    const check = () => {
      assertActive();
      assertContext(context);
    };
    check();
    const value = api();
    const today = new Date(acceptedAt);
    const uid = value.util?.dateToPageUid?.(today);
    const title = value.util?.dateToPageTitle?.(today);
    if (typeof value.util?.dateToPageUid !== "function" || typeof value.util?.dateToPageTitle !== "function" || typeof value.data?.page?.create !== "function" || typeof uid !== "string" || !uid || typeof title !== "string" || !title.trim()) {
      throw new DeskDropError("UNSUPPORTED_API", "This Roam version cannot resolve or create today\u2019s Daily Notes page.");
    }
    let page = await pullPage(uid);
    check();
    if (page?.title) return { kind: "daily", ...page };
    if (page) throw new DeskDropError("DNP_CONFLICT", "Today\u2019s Daily Notes UID already belongs to a block. Nothing was added.");
    const titled = await value.data.pull(PAGE, [":node/title", title]);
    check();
    const titledUid = field(titled, "block/uid");
    if (titledUid && titledUid !== uid) throw new DeskDropError("DNP_CONFLICT", "Today\u2019s Daily Notes title already belongs to another page. Nothing was added.");
    try {
      await value.data.page.create({ page: { title, uid } });
    } catch (error) {
      if (error instanceof DeskDropError) throw error;
    }
    check();
    page = await pullPage(uid);
    check();
    if (page?.title !== title) throw new DeskDropError("DNP_UNCONFIRMED", "Could not confirm today\u2019s Daily Notes page. Nothing was added.");
    return { kind: "daily", ...page };
  }
  async function resolvePinnedPage(context, destination) {
    assertContext(context);
    let uid = destination.uid;
    if (!uid && typeof destination.title === "string" && destination.title.trim()) {
      const titled = await api().data.pull(PAGE, [":node/title", destination.title.trim()]);
      assertContext(context);
      uid = field(titled, "block/uid");
    }
    if (typeof uid !== "string" || !uid) throw new DeskDropError("DESTINATION_MISSING", "The starred page is missing. Nothing was added.");
    const page = await pullPage(uid);
    assertContext(context);
    if (!page) throw new DeskDropError("DESTINATION_MISSING", "The starred page is missing. Nothing was added.");
    if (!page.title) throw new DeskDropError("DESTINATION_NOT_PAGE", "Only a pinned page can receive this block. Nothing was added.");
    return { kind: "page", ...page };
  }
  return {
    getContext,
    assertContext,
    readBlock,
    resolveDesk,
    resolveDaily,
    resolvePinnedPage,
    isDeskPage: async (uid) => {
      if (typeof api().data.q !== "function") throw new DeskDropError("UNSUPPORTED_API", "This Roam version lacks the query API required for safety checks.");
      return await api().data.q("[:find ?u . :in $ ?pageUid :where [?u :user/desk-page ?pageUid]]", uid) != null;
    },
    generateUID: () => api().util.generateUID(),
    createEntry: ({ parentUid, uid, string }) => api().data.block.create({
      location: { "parent-uid": parentUid, order: "first" },
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
function snapshotDestination(destination) {
  if (destination == null) return { kind: "desk" };
  const kind = destination.kind;
  if (kind === "desk") return { kind };
  if (kind === "daily") return { kind, acceptedAt: Date.now() };
  if (kind === "page") return { kind, uid: destination.uid, title: typeof destination.title === "string" ? destination.title : void 0 };
  return { kind: typeof kind === "string" ? kind : "unknown" };
}
function createDeskCapture({ getAPI }) {
  const adapter = createRoamDeskAdapter({ getAPI });
  const pendingWrites = /* @__PURE__ */ new Map();
  const interrupted = (error) => ["ABORTED", "CONTEXT_CHANGED", "NO_CONTEXT"].includes(error?.code);
  const unconfirmed = () => new DeskDropError("WRITE_UNCONFIRMED", "Could not confirm the result. Further attempts for this block are paused; check that page first.");
  let tail = Promise.resolve(), disposed = false;
  function active(signal) {
    if (disposed || signal?.aborted) throw new DeskDropError("ABORTED", "Roam Drop has stopped; this operation will not continue.");
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
  async function resolveDestination(origin, destination, signal) {
    if (destination.kind === "desk") return guarded(origin, () => adapter.resolveDesk(origin), signal);
    if (destination.kind === "daily") return guarded(origin, () => adapter.resolveDaily(origin, destination.acceptedAt, () => active(signal)), signal);
    if (destination.kind === "page") {
      if (destination.uid != null && !isSafeUid(destination.uid)) throw new DeskDropError("INVALID_UID", "Could not safely identify the destination page.");
      return guarded(origin, () => adapter.resolvePinnedPage(origin, destination), signal);
    }
    throw new DeskDropError("DESTINATION_UNSUPPORTED", "This sidebar target is not a page Roam Drop can write to.");
  }
  async function captureOne({ uids: uids2, origin, destination, signal }) {
    const run = (fn) => guarded(origin, fn, signal);
    active(signal);
    adapter.assertContext(origin);
    if (!Array.isArray(uids2) || uids2.length !== 1) throw new DeskDropError("SINGLE_BLOCK_ONLY", "This version accepts one top-level block at a time. Drag blocks individually.");
    const sourceUid = uids2[0];
    if (!isSafeUid(sourceUid)) throw new DeskDropError("INVALID_UID", "Could not safely identify the block UID.");
    const source = await run(() => adapter.readBlock(sourceUid));
    if (!source || source.uid !== sourceUid) throw new DeskDropError("SOURCE_MISSING", "The source block no longer exists. Nothing was added.");
    if (typeof source.title === "string" || typeof source.string !== "string") throw new DeskDropError("NOT_A_BLOCK", "This version accepts blocks, not whole pages.");
    if (!source.pageUid) throw new DeskDropError("SOURCE_METADATA", "Could not identify the source page. Nothing was added.");
    const page = await resolveDestination(origin, destination, signal);
    if (sourceUid === page.uid || source.pageUid === page.uid) {
      throw new DeskDropError(page.kind === "desk" ? "DESK_SOURCE" : "SOURCE_ON_PAGE", page.kind === "desk" ? "Notes already inside a Desk page cannot be added again." : "This block is already on that page. Nothing was added.");
    }
    if (page.kind === "desk" && await run(() => adapter.isDeskPage(source.pageUid))) {
      throw new DeskDropError("DESK_SOURCE", "Notes already inside a Desk page cannot be added again.");
    }
    const current = await resolveDestination(origin, destination, signal);
    if (current.uid !== page.uid) throw new DeskDropError(page.kind === "desk" ? "DESK_CHANGED" : "DESTINATION_CHANGED", page.kind === "desk" ? "The Desk binding changed. Please drag the block again." : "The destination changed. Please drag the block again.");
    const key = JSON.stringify([origin.graphName, origin.graphType, origin.userUid, current.uid, sourceUid]);
    const string = `{{embed-path: ((${sourceUid})) closed}}`;
    const validEntry = (entry2, expectedUid) => entry2?.uid === expectedUid && entry2.string === string && entry2.parentUids.length === 1 && entry2.parentUids[0] === current.uid;
    const existing = current.entries.find((entry2) => embeddedBlockUid(entry2.string) === sourceUid);
    if (existing) {
      pendingWrites.delete(key);
      return { status: "existing", entryUid: existing.uid, sourceUid, pageUid: current.uid, ...current.kind === "desk" ? { deskUid: current.uid } : {}, context: origin };
    }
    const pending = pendingWrites.get(key);
    if (pending) {
      const entry2 = await run(() => adapter.readBlock(pending));
      if (!validEntry(entry2, pending)) throw unconfirmed();
      pendingWrites.delete(key);
      return { status: "existing", entryUid: pending, sourceUid, pageUid: current.uid, ...current.kind === "desk" ? { deskUid: current.uid } : {}, context: origin };
    }
    const uid = adapter.generateUID();
    if (!isSafeUid(uid)) throw new DeskDropError("UNSUPPORTED_API", "Roam returned a UID that cannot be used safely.");
    pendingWrites.set(key, uid);
    try {
      await run(() => adapter.createEntry({ parentUid: current.uid, uid, string }));
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
    return { status: "added", entryUid: uid, sourceUid, pageUid: current.uid, ...current.kind === "desk" ? { deskUid: current.uid } : {}, context: origin };
  }
  return {
    getContext() {
      active();
      return adapter.getContext();
    },
    capture(request = {}) {
      const origin = Object.freeze({ graphName: request.origin?.graphName, graphType: request.origin?.graphType, userUid: request.origin?.userUid });
      const uids2 = Array.isArray(request.uids) ? [...request.uids] : request.uids;
      const destination = snapshotDestination(request.destination);
      return enqueue(() => captureOne({ uids: uids2, origin, destination, signal: request.signal }));
    },
    dispose() {
      disposed = true;
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
  if (!uris.length || uris.length > 1e3) throw new DeskDropError("INVALID_PAYLOAD", "Could not confirm the source graph. Nothing was added.");
  const parsed = uris.map((uri) => {
    try {
      const url = new URL(uri);
      const trusted = url.protocol === "roam:" && !url.hostname || url.protocol === "https:" && ["roamresearch.com", "www.roamresearch.com"].includes(url.hostname);
      const match = url.hash.match(/^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)\/?(?:\?.*)?$/);
      if (!trusted || !match) throw new Error("Unsupported URI");
      return { type: match[1] === "app" ? "hosted" : "offline", graph: decodeURIComponent(match[2]), uid: decodeURIComponent(match[3]) };
    } catch {
      throw new DeskDropError("INVALID_PAYLOAD", "Could not recognize the native Roam link. Nothing was added.");
    }
  });
  if (parsed.some((item) => item.graph !== origin?.graphName || item.type !== origin?.graphType)) {
    throw new DeskDropError("CROSS_GRAPH", "Cross-graph drops are not supported in this version.");
  }
  if (!parsed.some((item) => item.uid === uids2[0])) throw new DeskDropError("INVALID_PAYLOAD", "The drag link does not match the block UID.");
  return uids2;
}

// src/ui.js
var MARK = ":is(div.log-button.rm-left-sidebar__daily-notes, div.log-button.rm-left-sidebar__desk, .starred-pages .page)";
var ROW = `.roam-app > .roam-sidebar-container ${MARK}[data-rr-desk-drop]`;
var READY_ROW = `.roam-body .roam-app > .roam-sidebar-container .roam-sidebar-content ${MARK}[data-rr-desk-drop="ready"]`;
var CSS = `
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
function createDeskDropUI({ documentRef, windowRef }) {
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
    svg.setAttribute("class", state === "added" || state === "existing" ? "rr-desk-drop-icon rr-desk-drop-success" : "rr-desk-drop-icon");
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
    const { row } = model, state = model.state;
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
    row.appendChild(accessory);
  }
  function clearPointerDrag() {
    if (!pointerGhost) return;
    pointerGhost.remove();
    pointerGhost = null;
    restore(documentRef.documentElement, "data-rr-desk-drop-pointer", pointerMarker, "true");
  }
  function movePointerDrag(bullet, x, y) {
    if (!mounted) return;
    if (!pointerGhost) {
      const row = bullet.closest(".rm-block-main,.roam-block-container");
      pointerGhost = documentRef.createElement("div");
      pointerGhost.className = "rr-desk-drop-pointer-ghost";
      pointerGhost.setAttribute("aria-hidden", "true");
      pointerGhost.textContent = (row?.querySelector("textarea")?.value || row?.querySelector(".rm-block-text")?.textContent || "Block").trim().slice(0, 120);
      pointerMarker = documentRef.documentElement.getAttribute("data-rr-desk-drop-pointer");
      documentRef.documentElement.setAttribute("data-rr-desk-drop-pointer", "true");
      documentRef.body.appendChild(pointerGhost);
    }
    const left = Math.max(0, Math.min(x + 14, windowRef.innerWidth - pointerGhost.offsetWidth - 4));
    const top = Math.max(0, Math.min(y + 14, windowRef.innerHeight - pointerGhost.offsetHeight - 4));
    pointerGhost.style.transform = `translate(${left}px,${top}px)`;
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
    clearPointerDrag,
    movePointerDrag,
    activeRow: () => dragRow,
    clearFeedback,
    show(message, { target, state = "added", persistent = false } = {}) {
      if (!mounted || !target?.isConnected) return;
      clearFeedback();
      let timer;
      const current = { row: target, state, message };
      current.cleanup = () => windowRef.clearTimeout(timer);
      feedback = current;
      live.textContent = message;
      paint();
      if (!persistent) timer = windowRef.setTimeout(() => {
        if (feedback === current) clearFeedback();
      }, 900);
    },
    dispose() {
      mounted = false;
      dragRow = null;
      clearPointerDrag();
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
var DESTINATION_SELECTOR = ".roam-app > .roam-sidebar-container :is(.rm-left-sidebar__daily-notes, .rm-left-sidebar__desk, .starred-pages .page)";
var SOURCE_SURFACE = ".roam-article, .rm-sidebar-outline, .rm-sidebar-window, #right-sidebar";
var AMBIGUOUS = ".rm-reference-container,.rm-reference-item,.roam-query,.roam-query-content,.rm-embed-container";
var PAGE_HASH = /^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)\/?(?:\?.*)?$/;
var DRAG_THRESHOLD = 8;
var parsePageHref = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value, "https://roamresearch.com");
  } catch {
    return null;
  }
  const trusted = url.protocol === "roam:" && !url.hostname || url.protocol === "https:" && ["roamresearch.com", "www.roamresearch.com"].includes(url.hostname);
  if (!trusted) return null;
  const match = url.hash.match(PAGE_HASH);
  if (!match) return null;
  try {
    return { type: match[1] === "app" ? "hosted" : "offline", graph: decodeURIComponent(match[2]), uid: decodeURIComponent(match[3]) };
  } catch {
    return null;
  }
};
var attributeValue = (node, names) => {
  for (const name of names) {
    const value = node?.getAttribute?.(name);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};
function createDeskDropRuntime({ windowRef, documentRef = windowRef.document, getAPI = () => windowRef.roamAlphaAPI }) {
  const capture = createDeskCapture({ getAPI });
  const controller = new AbortController();
  let loaded = false, stopped = false, session = null, gesture = null, context, feedbackVersion = 0, swallowClick = false;
  const ui = createDeskDropUI({ documentRef, windowRef });
  function showError(error, target = documentRef.querySelector(DESK_SELECTOR)) {
    if (!loaded || error?.code === "ABORTED") return;
    ui.show(error instanceof DeskDropError ? error.message : "Could not complete the operation. Check the page; Roam Drop has not moved the original block.", { target, state: "error", persistent: true });
  }
  function clearFeedback() {
    feedbackVersion++;
    ui.clearFeedback();
  }
  function resetDrag() {
    session = null;
    ui.clearHighlight();
  }
  function cancelGesture() {
    gesture = null;
    ui.clearHighlight();
    ui.clearPointerDrag();
  }
  function transferEffect(transfer) {
    const allowed = transfer?.effectAllowed || "uninitialized";
    if (["all", "uninitialized", "copy", "copyLink", "copyMove"].includes(allowed)) return "copy";
    if (["link", "linkMove"].includes(allowed)) return "link";
    return null;
  }
  function currentSession() {
    try {
      return session && sameContext(session.origin, capture.getContext());
    } catch {
      return false;
    }
  }
  function rowFrom(node) {
    const row = node?.closest?.(DESTINATION_SELECTOR);
    if (row) return row;
    const link = node?.closest?.(".roam-app > .roam-sidebar-container .starred-pages > a[href]");
    return link?.querySelector(":scope > .page") ?? null;
  }
  function dropZone(row) {
    const link = row?.closest?.("a[href]");
    return link?.contains(row) ? link : row;
  }
  function uidFromTextarea(id) {
    if (typeof id !== "string" || !id.startsWith("block-input-")) return null;
    const uid = id.slice(-9);
    return id.length > "block-input-".length + 9 && isSafeUid(uid) ? uid : null;
  }
  function sourceUidFrom(bullet) {
    const row = bullet.closest(".rm-block-main");
    const container = bullet.closest(".roam-block-container,.rm-block");
    const attr = container?.getAttribute("data-block-uid") || row?.getAttribute("data-block-uid");
    if (isSafeUid(attr)) return attr;
    const root = row || container || bullet.parentElement;
    return uidFromTextarea(root?.querySelector?.('[id^="block-input-"]:not(#block-input-ghost)')?.id);
  }
  function sourceBullet(target) {
    if (target?.closest?.('textarea, input, select, [contenteditable="true"]')) return null;
    const bullet = target?.closest?.(".rm-bullet");
    if (!bullet || bullet.closest(AMBIGUOUS) || !bullet.closest(SOURCE_SURFACE)) return null;
    return bullet;
  }
  function multipleSelection(bullet) {
    if (!bullet?.closest?.(".block-highlight-blue")) return false;
    return documentRef.querySelectorAll(".block-highlight-blue").length > 1;
  }
  function pageIdentity(row) {
    const ancestor = row.closest("a[href]");
    const links = [ancestor && ancestor !== row ? ancestor : null, row.querySelector("a[href]"), row.matches("a[href]") ? row : null].filter(Boolean);
    for (const link of links) {
      const parsed = parsePageHref(link.getAttribute?.("href") || link.href);
      if (parsed) return parsed;
    }
    const uid = attributeValue(row, ["data-link-uid", "data-page-uid"]) || attributeValue(row.querySelector("[data-link-uid], [data-page-uid]"), ["data-link-uid", "data-page-uid"]);
    const title = attributeValue(row, ["data-link-title", "data-page-title"]) || attributeValue(row.querySelector("[data-link-title], [data-page-title]"), ["data-link-title", "data-page-title"]);
    if (isSafeUid(uid) || title) return { uid: isSafeUid(uid) ? uid : void 0, title };
    return null;
  }
  function destinationFrom(row, origin) {
    if (!row) return null;
    if (row.matches(".rm-left-sidebar__daily-notes")) return { kind: "daily" };
    if (row.matches(".rm-left-sidebar__desk")) return { kind: "desk" };
    if (!row.matches(".starred-pages .page")) return null;
    const identity = pageIdentity(row);
    if (!identity) return { invalid: true, code: "DESTINATION_UNSUPPORTED" };
    if (identity.graph && (identity.graph !== origin?.graphName || identity.type !== origin?.graphType)) return { invalid: true, code: "CROSS_GRAPH" };
    if (identity.uid && !isSafeUid(identity.uid)) return { invalid: true, code: "INVALID_UID" };
    if (!identity.uid && !identity.title) return { invalid: true, code: "DESTINATION_UNSUPPORTED" };
    return { kind: "page", uid: identity.uid, title: identity.title };
  }
  function rowLabel(row, fallback = "page") {
    if (row?.matches?.(".rm-left-sidebar__daily-notes")) return "Daily Notes";
    if (row?.matches?.(".rm-left-sidebar__desk")) return "Desk";
    const copy = row.cloneNode(true);
    copy.querySelectorAll('.rr-sidebar-ref-count, .rr-desk-drop-accessory, [class*="ref-count"]').forEach((node) => node.remove());
    return copy.textContent?.replace(/\s+/g, " ").trim() || fallback;
  }
  function hitRow(event) {
    return rowFrom(documentRef.elementFromPoint?.(event.clientX, event.clientY)) || rowFrom(event.target);
  }
  async function complete(target, origin, uids2, sourceUid) {
    const version = ++feedbackVersion;
    const label = rowLabel(target);
    try {
      if (!sameContext(origin, capture.getContext())) throw new DeskDropError("CONTEXT_CHANGED", "The graph or user changed during the drag. Start a new drag.");
      const destination = destinationFrom(target, origin);
      if (!destination || destination.invalid) {
        throw new DeskDropError(destination?.code || "DESTINATION_UNSUPPORTED", destination?.code === "CROSS_GRAPH" ? "Cross-graph drops are not supported in this version." : "Only Daily Notes, Desk, and pinned pages can receive a block.");
      }
      if (sourceUid && !isSafeUid(sourceUid)) throw new DeskDropError("INVALID_UID", "Could not safely identify the dragged block.");
      ui.show(`Adding to ${label}.`, { target, state: "pending", persistent: true });
      const result = await capture.capture({ uids: uids2, origin, destination, signal: controller.signal });
      if (!loaded || version !== feedbackVersion) return;
      ui.show(result.status === "existing" ? `Already on ${label}. No duplicate added.` : `Added to ${label}. Original kept in place.`, { target, state: result.status === "existing" ? "existing" : "added" });
    } catch (error) {
      if (version === feedbackVersion) showError(error, target);
    }
  }
  function onDragStart(event) {
    const bullet = sourceBullet(event.target);
    if (gesture && bullet === gesture.bullet) {
      if (gesture.editing && !hasModifier(event)) {
        event.preventDefault();
        resetDrag();
        return;
      }
      gesture.native = true;
      ui.clearPointerDrag();
    }
    resetDrag();
    if (event.defaultPrevented || hasModifier(event) || !bullet) return;
    clearFeedback();
    try {
      session = { origin: capture.getContext(), sourceUid: sourceUidFrom(bullet) || void 0 };
    } catch (error) {
      showError(error);
    }
  }
  function onDragOver(event) {
    const target = rowFrom(event.target), effect = transferEffect(event.dataTransfer);
    const destination = target && currentSession() ? destinationFrom(target, session.origin) : null;
    if (!destination || destination.invalid || hasModifier(event) || !hasRoamPayload(event.dataTransfer) || !effect) {
      ui.clearHighlight();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = effect;
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
    event.preventDefault();
    event.stopPropagation();
    if (destination.invalid) {
      showError(new DeskDropError(destination.code, destination.code === "CROSS_GRAPH" ? "Cross-graph drops are not supported in this version." : "Only Daily Notes, Desk, and pinned pages can receive a block."), target);
      return;
    }
    try {
      if (!sameContext(source.origin, capture.getContext())) throw new DeskDropError("CONTEXT_CHANGED", "The graph or user changed during the drag. Start a new drag.");
      const uids2 = readDropPayload(event.dataTransfer, source.origin, source.sourceUid);
      await complete(target, source.origin, uids2, source.sourceUid);
    } catch (error) {
      showError(error, target);
    }
  }
  function onPointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false || event.pointerType === "touch" || hasModifier(event) || event.defaultPrevented) return;
    const bullet = sourceBullet(event.target);
    if (!bullet || multipleSelection(bullet)) return;
    const sourceUid = sourceUidFrom(bullet);
    if (!isSafeUid(sourceUid)) return;
    try {
      gesture = {
        pointerId: event.pointerId,
        bullet,
        x: event.clientX,
        y: event.clientY,
        armed: false,
        native: false,
        sourceUid,
        origin: capture.getContext(),
        editing: Boolean(bullet.closest(".roam-block-container,.rm-block-main")?.querySelector('textarea[id^="block-input-"]'))
      };
    } catch {
      cancelGesture();
    }
  }
  function onPointerMove(event) {
    if (!gesture || gesture.native || event.pointerId !== gesture.pointerId) return;
    if (hasModifier(event) || event.buttons !== 1) {
      cancelGesture();
      return;
    }
    try {
      if (!sameContext(gesture.origin, capture.getContext())) {
        cancelGesture();
        return;
      }
    } catch {
      cancelGesture();
      return;
    }
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
    ui.clearHighlight();
    ui.clearPointerDrag();
    if (!current.armed || current.native || hasModifier(event)) return;
    const target = hitRow(event);
    const destination = target ? destinationFrom(target, current.origin) : null;
    if (!target || !destination || destination.invalid) return;
    event.preventDefault();
    event.stopPropagation();
    swallowClick = true;
    windowRef.setTimeout(() => {
      swallowClick = false;
    }, 0);
    if (!isSafeUid(current.sourceUid)) {
      showError(new DeskDropError("INVALID_UID", "Could not safely identify the dragged block."), target);
      return;
    }
    complete(target, current.origin, [current.sourceUid], current.sourceUid);
  }
  function onClick(event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }
  function onWindowBlur(event) {
    if (event.target !== windowRef) return;
    resetDrag();
    cancelGesture();
  }
  function onKeyDown(event) {
    if (event.key === "Escape") {
      resetDrag();
      cancelGesture();
      clearFeedback();
    }
  }
  function onHashChange() {
    resetDrag();
    cancelGesture();
    try {
      const next = capture.getContext();
      if (!sameContext(context, next)) clearFeedback();
      context = next;
    } catch {
      clearFeedback();
    }
  }
  const windowListeners = [["dragstart", onDragStart], ["dragend", () => {
    resetDrag();
    cancelGesture();
  }], ["pointerdown", onPointerDown], ["pointermove", onPointerMove], ["pointerup", onPointerUp], ["pointercancel", cancelGesture], ["click", onClick], ["blur", onWindowBlur], ["keydown", onKeyDown], ["hashchange", onHashChange]];
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
      cancelGesture();
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
      if (!windowRef?.document) throw new Error("Roam Drop requires a Roam browser environment.");
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
