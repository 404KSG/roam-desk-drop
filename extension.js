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
      throw new DeskDropError("UNSUPPORTED_API", "\u5F53\u524D Roam \u7248\u672C\u7F3A\u5C11\u9700\u8981\u7684\u516C\u5F00\u63A5\u53E3\u3002");
    }
    return value;
  }
  function getContext() {
    const value = api();
    const context = { graphName: value.graph?.name, graphType: value.graph?.type, userUid: value.user.uid() };
    if (!context.graphName || !context.graphType || !context.userUid) {
      throw new DeskDropError("NO_CONTEXT", "\u8BF7\u5728\u5DF2\u767B\u5F55\u7684 Roam \u56FE\u8C31\u4E2D\u4F7F\u7528\u3002");
    }
    return Object.freeze(context);
  }
  function assertContext(context) {
    if (!sameContext(getContext(), context)) throw new DeskDropError("CONTEXT_CHANGED", "\u56FE\u8C31\u6216\u7528\u6237\u5DF2\u6539\u53D8\uFF0C\u64CD\u4F5C\u5DF2\u505C\u6B62\uFF1B\u5982\u521A\u677E\u624B\uFF0C\u8BF7\u56DE\u539F\u56FE\u8C31\u6838\u5BF9\u7ED3\u679C\u3002");
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
      throw new DeskDropError("DESK_UNBOUND", "\u8BF7\u5148\u6253\u5F00\u4E00\u6B21\u539F\u751F Desk\uFF0C\u518D\u5C1D\u8BD5\u62D6\u5165\u3002");
    }
    const page = await api().data.pull(DESK, [":block/uid", uid]);
    assertContext(context);
    if (field(page, "block/uid") !== uid || typeof field(page, "node/title") !== "string") {
      throw new DeskDropError("DESK_MISSING", "Desk \u7ED1\u5B9A\u7684\u9875\u9762\u5DF2\u5931\u6548\uFF0C\u8BF7\u5148\u901A\u8FC7\u539F\u751F Desk \u6062\u590D\u3002");
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
      if (typeof api().data.q !== "function") throw new DeskDropError("UNSUPPORTED_API", "\u5F53\u524D Roam \u7F3A\u5C11\u5B89\u5168\u6821\u9A8C\u6240\u9700\u7684\u67E5\u8BE2\u63A5\u53E3\u3002");
      return await api().data.q("[:find ?u . :in $ ?pageUid :where [?u :user/desk-page ?pageUid]]", uid) != null;
    },
    generateUID: () => api().util.generateUID(),
    deleteEntry: (uid) => {
      if (typeof api().data.block.delete !== "function") throw new DeskDropError("UNSUPPORTED_API", "\u5F53\u524D Roam \u7F3A\u5C11\u5B89\u5168\u79FB\u9664\u5165\u53E3\u7684\u63A5\u53E3\u3002");
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
  const unconfirmed = () => new DeskDropError("WRITE_UNCONFIRMED", "\u6DFB\u52A0\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\uFF0C\u5DF2\u6682\u505C\u540C\u4E00\u5757\u7684\u91CD\u8BD5\uFF1B\u8BF7\u5148\u67E5\u770B Desk\u3002");
  let receipts = /* @__PURE__ */ new WeakMap(), tail = Promise.resolve(), disposed = false;
  function active(signal) {
    if (disposed || signal?.aborted) throw new DeskDropError("ABORTED", "\u63D2\u4EF6\u5DF2\u505C\u6B62\uFF0C\u672C\u6B21\u64CD\u4F5C\u5DF2\u53D6\u6D88\u3002");
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
    if (!Array.isArray(uids2) || uids2.length !== 1) throw new DeskDropError("SINGLE_BLOCK_ONLY", "\u7B2C\u4E00\u7248\u53EA\u652F\u6301\u4E00\u4E2A\u9876\u5C42 Block\uFF0C\u8BF7\u9010\u5757\u62D6\u5165\u3002");
    const sourceUid = uids2[0];
    if (!isSafeUid(sourceUid)) throw new DeskDropError("INVALID_UID", "\u65E0\u6CD5\u5B89\u5168\u8BC6\u522B\u8FD9\u4E2A Block \u7684 UID\u3002");
    const desk = await run(() => adapter.resolveDesk(origin));
    if (sourceUid === desk.uid) throw new DeskDropError("DESK_SOURCE", "\u4E0D\u80FD\u628A Desk \u518D\u6B21\u653E\u8FDB\u5B83\u81EA\u5DF1\u3002");
    const source = await run(() => adapter.readBlock(sourceUid));
    if (!source || source.uid !== sourceUid) throw new DeskDropError("SOURCE_MISSING", "\u6E90 Block \u5DF2\u4E0D\u5B58\u5728\uFF0C\u672A\u52A0\u5165 Desk\u3002");
    if (typeof source.title === "string" || typeof source.string !== "string") throw new DeskDropError("NOT_A_BLOCK", "\u7B2C\u4E00\u7248\u53EA\u63A5\u53D7 Block\uFF0C\u4E0D\u63A5\u53D7\u6574\u4E2A\u9875\u9762\u3002");
    if (!source.pageUid) throw new DeskDropError("SOURCE_METADATA", "\u65E0\u6CD5\u786E\u8BA4\u6E90 Block \u6240\u5C5E\u9875\u9762\uFF0C\u672A\u52A0\u5165 Desk\u3002");
    if (await run(() => adapter.isDeskPage(source.pageUid))) throw new DeskDropError("DESK_SOURCE", "Desk \u5185\u90E8\u7684\u7B14\u8BB0\u4E0D\u9700\u8981\u518D\u6B21\u52A0\u5165 Desk\u3002");
    const currentDesk = await run(() => adapter.resolveDesk(origin));
    if (currentDesk.uid !== desk.uid) throw new DeskDropError("DESK_CHANGED", "Desk \u7ED1\u5B9A\u521A\u521A\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u62D6\u5165\u3002");
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
    if (!isSafeUid(uid)) throw new DeskDropError("UNSUPPORTED_API", "Roam \u8FD4\u56DE\u4E86\u65E0\u6CD5\u5B89\u5168\u4F7F\u7528\u7684\u65B0 UID\u3002");
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
    if (!saved) throw new DeskDropError("INVALID_RECEIPT", "\u8FD9\u4E2A\u64A4\u9500\u51ED\u636E\u4E0D\u5B58\u5728\u6216\u5DF2\u7ECF\u5931\u6548\u3002");
    const run = (fn) => guarded(saved.context, fn, signal);
    const desk = await run(() => adapter.resolveDesk(saved.context));
    if (desk.uid !== saved.deskUid) throw new DeskDropError("DESK_CHANGED", "Desk \u7ED1\u5B9A\u5DF2\u6539\u53D8\uFF0C\u8BF7\u4EBA\u5DE5\u5904\u7406\u8FD9\u4E2A\u5165\u53E3\u3002");
    const current = await run(() => adapter.readBlock(saved.entry.uid));
    if (!current) {
      receipts.delete(receipt);
      return { status: "already-removed" };
    }
    if (current.string !== saved.entry.string || current.edited !== saved.entry.edited || current.parentUids.length !== 1 || current.parentUids[0] !== saved.deskUid || current.childUids.length || current.referrerUids.length || typeof current.title === "string") {
      throw new DeskDropError("UNDO_UNSAFE", "\u5165\u53E3\u5DF2\u88AB\u7F16\u8F91\u3001\u79FB\u52A8\u6216\u5F15\u7528\uFF0C\u8BF7\u5728 Desk \u4E2D\u4EBA\u5DE5\u5904\u7406\u3002");
    }
    try {
      await run(() => adapter.deleteEntry(current.uid));
    } catch (error) {
      if (interrupted(error)) throw error;
    }
    if (await run(() => adapter.readBlock(current.uid))) throw new DeskDropError("UNDO_UNCONFIRMED", "\u5C1A\u672A\u786E\u8BA4\u64A4\u9500\u7ED3\u679C\uFF0C\u8BF7\u67E5\u770B Desk\u3002");
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
  if (!hasRoamPayload(transfer) || typeof transfer.getData !== "function") throw new DeskDropError("INVALID_PAYLOAD", "\u53EA\u63A5\u53D7 Roam \u5185\u90E8 Block \u7684\u539F\u751F\u62D6\u62FD\u3002");
  const uids2 = lines(transfer.getData("roam/block-uid-list-only-parents") || transfer.getData("roam/block-uid-list"));
  if (uids2.length !== 1) throw new DeskDropError("SINGLE_BLOCK_ONLY", "\u7B2C\u4E00\u7248\u53EA\u652F\u6301\u4E00\u4E2A\u9876\u5C42 Block\uFF0C\u8BF7\u9010\u5757\u62D6\u5165\u3002");
  if (!isSafeUid(uids2[0])) throw new DeskDropError("INVALID_UID", "\u65E0\u6CD5\u5B89\u5168\u8BC6\u522B\u62D6\u52A8\u7684 Block\u3002");
  if (expectedSourceUid && expectedSourceUid !== uids2[0]) throw new DeskDropError("SOURCE_CHANGED", "\u62D6\u62FD\u6765\u6E90\u4E0E\u8F7D\u8377\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u53D6\u6D88\u9009\u62E9\u540E\u91CD\u8BD5\u3002");
  const uris = lines(transfer.getData("roam/roam-uri-list"));
  if (!uris.length || uris.length > 1e3) throw new DeskDropError("INVALID_PAYLOAD", "\u65E0\u6CD5\u786E\u8BA4\u6765\u6E90\u56FE\u8C31\uFF0C\u672A\u52A0\u5165 Desk\u3002");
  const parsed = uris.map((uri) => {
    try {
      const url = new URL(uri);
      const trusted = url.protocol === "roam:" && !url.hostname || url.protocol === "https:" && ["roamresearch.com", "www.roamresearch.com"].includes(url.hostname);
      const match = url.hash.match(/^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)\/?(?:\?.*)?$/);
      if (!trusted || !match) throw new Error("Unsupported URI");
      return { type: match[1] === "app" ? "hosted" : "offline", graph: decodeURIComponent(match[2]), uid: decodeURIComponent(match[3]) };
    } catch {
      throw new DeskDropError("INVALID_PAYLOAD", "\u65E0\u6CD5\u8BC6\u522B\u539F\u751F Roam \u94FE\u63A5\uFF0C\u672A\u52A0\u5165 Desk\u3002");
    }
  });
  if (parsed.some((item) => item.graph !== origin?.graphName || item.type !== origin?.graphType)) {
    throw new DeskDropError("CROSS_GRAPH", "\u7B2C\u4E00\u7248\u4E0D\u63A5\u53D7\u8DE8\u56FE\u8C31\u62D6\u62FD\u3002");
  }
  if (!parsed.some((item) => item.uid === uids2[0])) throw new DeskDropError("INVALID_PAYLOAD", "\u62D6\u62FD\u94FE\u63A5\u4E0E Block UID \u4E0D\u4E00\u81F4\u3002");
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
      hint.textContent = "\u653E\u5165 Desk \xB7 \u539F\u6587\u4FDD\u7559";
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
      for (const action of [...actions, { id: "dismiss", label: "\u5173\u95ED", run: clearNotice }]) {
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
    ui.show(error instanceof DeskDropError ? error.message : "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u5728 Desk \u4E2D\u6838\u5BF9\uFF1B\u539F Block \u672A\u88AB\u672C\u63D2\u4EF6\u79FB\u52A8\u3002", { kind: "error", persistent: true });
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
      if (!sameContext(source.origin, capture.getContext())) throw new DeskDropError("CONTEXT_CHANGED", "\u62D6\u62FD\u9014\u4E2D\u56FE\u8C31\u6216\u7528\u6237\u5DF2\u6539\u53D8\uFF0C\u8BF7\u91CD\u65B0\u62D6\u52A8\u3002");
      const uids2 = readDropPayload(event.dataTransfer, source.origin, source.sourceUid);
      ui.show("\u6B63\u5728\u52A0\u5165 Desk\u2026", { persistent: true });
      const result = await capture.capture({ uids: uids2, origin: source.origin, signal: controller.signal });
      if (!loaded) return;
      const actions = [{ id: "view", label: "\u67E5\u770B", run: () => {
        if (!sameContext(result.context, capture.getContext())) throw new DeskDropError("CONTEXT_CHANGED", "\u8BF7\u56DE\u5230\u539F\u56FE\u8C31\u540E\u67E5\u770B Desk\u3002");
        const row = documentRef.querySelector(DESK_SELECTOR);
        if (!row) throw new DeskDropError("DESK_NOT_VISIBLE", "\u672A\u627E\u5230\u539F\u751F Desk \u5165\u53E3\uFF0C\u8BF7\u4ECE\u5DE6\u4FA7\u680F\u6253\u5F00\u3002");
        row.click();
      } }];
      if (result.receipt) actions.push({ id: "undo", label: "\u64A4\u9500", run: async () => {
        await capture.undo(result.receipt, { signal: controller.signal });
        if (loaded) ui.show("\u5DF2\u79FB\u9664\u672C\u6B21 Desk \u5165\u53E3\uFF0C\u539F\u6587\u4FDD\u7559\u3002");
      } });
      ui.show(result.status === "existing" ? "\u5DF2\u5728 Desk\uFF0C\u6CA1\u6709\u91CD\u590D\u6DFB\u52A0\u3002" : "\u5DF2\u52A0\u5165 Desk\uFF0C\u539F\u6587\u4FDD\u7559\u3002", { actions });
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
      if (stopped) throw new DeskDropError("ABORTED", "\u8BF7\u521B\u5EFA\u65B0\u7684\u63D2\u4EF6\u5B9E\u4F8B\u540E\u91CD\u542F\u3002");
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
      if (!windowRef?.document) throw new Error("Desk Drop \u9700\u8981 Roam \u6D4F\u89C8\u5668\u73AF\u5883\u3002");
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
