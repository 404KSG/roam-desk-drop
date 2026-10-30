# Sidebar collection design

Roam Drop 0.2.2 collects blocks into page destinations in Roam's left sidebar. The extension was previously named Desk Drop.

## Destinations

| Sidebar row | Destination |
|---|---|
| Daily Notes | Today's daily note page, using Roam's local-date utilities at drop time |
| Desk | The current user's `:user/desk-page` binding, including a renamed Desk |
| Starred page | The page UID in the shortcut's native link |

Resolve identities from native selectors and links, then verify the target through `roamAlphaAPI.data.pull`. Never use the row's whole visible text as a page title: themes or other extensions can append counts. Functional navigation, shortcut headings, foreign graph links, and links to blocks are not page destinations. Native Desk must already be initialized. Only Daily Notes may create a missing page, using the public page-create API.

A drop freezes its destination before joining the write queue. Entries use `{{embed-path: ((uid)) closed}}` at the top. Existing matching embed/embed-path entries are deduplicated per target page. The source UID, text, parent, order, and children remain unchanged. A block already on the destination page returns an informational `existing` result with reason `source-on-page`; it performs no graph write. An existing embed returns `existing` with its entry UID. A Desk-owned block may be collected into another page.

## Drag sources

Support one ordinary block from the main or right-sidebar outline, in the same graph and window. Native drag payloads are `roam/block-uid-list-only-parents`, `roam/block-uid-list`, and `roam/roam-uri-list`; read protected data only on drop. Reject ambiguous reference/query/embed views, multiple top-level blocks, external input, modifiers, and cross-graph/user changes.

Roam's current bullet drag-start handler skips native drag setup while the block is being edited. A pointer fallback starts from the bullet, after a movement threshold, to cover that state. Resolve source identity from the block container or its own `block-input-*` element. Editor text itself keeps native editing and selection. Pointer and native event streams must produce a single capture. Escape, pointer cancellation, blur, navigation, and unload clear the gesture.

## Write safeguards

- Validate source and destination before creating an entry.
- Serialize instance-local writes and use a pre-generated entry UID.
- Read the entry back and verify its UID, content, and parent before reporting success.
- If a write outcome is uncertain, pause further attempts for that source/destination pair rather than blindly retrying.
- Recheck graph/user context around asynchronous SDK calls. An already submitted write cannot be canceled forcibly.
- Provide no Undo/delete action. Existing entries remain native Roam blocks after unload.

This is not a distributed transaction. Concurrent devices or instances may still race. Rejecting same-page captures does not provide global cycle detection across other dynamic embeds. A personal Desk is not a separate privacy boundary.

## Interface and lifecycle

Keep feedback local to the destination row in a fixed slot 10px from its right edge: plus on accepted hover, spinner while writing, a green check for a new entry, a neutral circled check for existing content, and a warning for an error. New additions clear after 900ms; existing content gets a short explanation for 1.8 seconds. Errors show their full reason immediately, then remain inspectable through hover/focus on the warning. Contextual tooltips are attached to the document body and positioned next to the destination, avoiding sidebar clipping; scroll and resize hide them. Reference counts are temporarily hidden only while the row contains feedback, preserving layout and live values. Preserve native navigation, labels, and row geometry. See [interaction details](quiet-interaction.md).

Unload removes listeners, drag state, temporary attributes, feedback, live region, and injected styles. No clipboard changes, automatic navigation, analytics, network calls, source moves/updates/deletes, or dependencies are introduced.

## Development

Node.js 20+ is required. Tests use built-in modules. The build uses an existing esbuild executable and does not install dependencies automatically.

```bash
npm test
ESBUILD_BIN=/absolute/path/to/esbuild npm run build
npm run check
npm run fixture
```

Open `http://127.0.0.1:4381/` for source tests or `http://127.0.0.1:4381/?bundle=1` for bundle tests. Focus the page before running integration checks. The fixture uses an in-memory SDK and never connects to a real graph.

`extension.js` is a Depot ES module, not a plain `roam/js` snippet or CSS. Depot uses the committed bundle; no root `build.sh` is needed.

## Compatibility evidence

Read-only inspection on October 29, 2026 confirmed `.rm-left-sidebar__daily-notes`, `.rm-left-sidebar__desk`, and `.starred-pages > a[href] > .page` in the live client. Shortcut reference counts may be supplied by another extension as `.rr-sidebar-ref-count`. Current client source also confirms that editing state bypasses native bullet drag setup. These DOM details and the Desk binding are compatibility dependencies, not a stable public UI API.

- [Roam developer documentation](https://roamdocs.fyi/developer-documentation/llms-full.txt)
- [Current client source](https://roamresearch.com/js/compiled/route-app.js)
- [Verification and limits](verification.md)

Multiple blocks, cross-window input, touch/mobile dragging, automatic sidebar expansion, classification, AI, production installation, and Marketplace publication are outside this change.
