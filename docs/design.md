# Desk Drop 0.1: confirmed baseline

Decision confirmed on October 26, 2026: dropping onto Desk adds a native embed. The original block stays in place; its text is not copied.

## Scope

- An independent Roam Depot extension for dragging one ordinary top-level block from the main or right-sidebar outline onto the existing Desk row.
- Resolve the current user's `:user/desk-page` binding. Do not guess the page name, create a Desk, or modify the binding.
- Create `{{embed-path: ((uid)) closed}}` at the top of Desk. Do not add another entry when a matching embed or embed-path entry already exists.
- Preserve the source UID, text, parent, order, and children. Do not move or update the source.
- Preserve the native Desk click behavior. Do not navigate automatically or write to the clipboard after capture.
- Clicking the original Desk row opens native Desk. Inline Undo checks the receipt-owned entry's text, edit time, parent, children, and backlinks. It refuses changed, referenced, or child-bearing entries and never calls global Undo.
- Keep interaction feedback local to the Desk row, with no bottom-right toast or full-row instructional text. See [quiet interaction design](quiet-interaction.md) for the visual contract and sources.

## Test interfaces

1. `DeskCapture.capture` and `undo`: connect the real adapter to a simulated Roam SDK and check observable graph results and source preservation.
2. `createDeskDropRuntime.start/stop`: exercise browser events to verify the drop target, native/modifier drag pass-through, cancellation, and unload cleanup.
3. Roam SDK adapter: mock only the external SDK, not this project's modules. Check actual call shapes and error handling.

Start with a failing test, implement that behavior, and add safety cases incrementally. Browser integration tests use a local in-memory graph fixture, not writes to a production Roam graph.

## Out of scope

Multiple top-level blocks; web-page, file, or cross-window drops; cross-graph capture; automatic sidebar expansion; mobile touch gestures; automatic classification; AI; automatic production installation; and automatic Marketplace release. Linked-reference, query, and embed surfaces are not handled in the first version because their source identity needs separate validation.

## Compatibility basis

The native Desk entry format and `:user/desk-page` binding were inspected in client `0.13.13-2e4c3c7d`. They are not a published, stable Desk API contract. Validate them in a separate test graph before connecting the extension to a production graph.

Official drag payloads: `roam/block-uid-list-only-parents`, `roam/block-uid-list`, and `roam/roam-uri-list`. Use public `roamAlphaAPI.data.block.create/delete`, `data.pull/q`, `user.uid()`, `graph`, and `util.generateUID()`. Do not call minified internal functions.

Sources:

- https://roamdocs.fyi/developer-documentation/llms-full.txt
- https://roamresearch.com/js/compiled/main.js
- https://roamresearch.com/js/compiled/route-app.js

## Data and lifecycle limits

- Missing or invalid bindings must be initialized or recovered through native Roam Desk. The extension does not create a replacement or alter the binding.
- Writes use a pre-generated UID and readback. If completion cannot be confirmed, repeat attempts for that block are paused for the current instance rather than blindly retried.
- Queueing and deduplication are instance-local, not distributed transactions or atomic conditional deletes.
- Direct Desk self-embedding and blocks already inside a Desk page are rejected. Global cycle detection across dynamic renderers or cross-block embeds is not guaranteed.
- Graph changes use Roam's own synchronization and permissions. A personal Desk is not a separate privacy boundary. The extension adds no AI service, API key, analytics, or extra network requests.
- Unloading removes listeners, highlights, feedback, the live region, and injected styles. Native Desk entries remain. Already submitted SDK writes cannot be forcibly canceled.

## Development

Node.js 20+ is required. Tests use built-in Node modules; building uses esbuild 0.28.1 from development dependencies or an existing executable.

```bash
npm test
ESBUILD_BIN=/absolute/path/to/esbuild npm run build
npm run check
npm run fixture
```

The build does not install dependencies automatically. The repository includes the prebuilt `extension.js`, so Depot does not need a root `build.sh`.

Open `http://127.0.0.1:4381/` for source tests or `http://127.0.0.1:4381/?bundle=1` for bundle tests. Focus the page before running integration checks: background documents can miss real focus/blur behavior. The fixture modifies in-memory data only and does not connect to a real graph.

`extension.js` is a Roam Depot ES module, not a plain `roam/js` snippet. Do not paste it into `roam/css`.

### Code map

- `src/desk-capture.js`: validation, deduplication, readback, and guarded Undo.
- `src/roam-adapter.js`: public SDK calls and Desk compatibility details.
- `src/drop-payload.js`: native drag-payload validation.
- `src/runtime.js` and `src/ui.js`: target handling, feedback, and lifecycle cleanup.
- `test/fixtures/`: isolated in-memory browser harness.

[Interaction details](quiet-interaction.md) · [Verification and remaining coverage](verification.md)
