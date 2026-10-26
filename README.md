# Desk Drop

Drag a block onto the existing **Desk** item in Roam's left sidebar to add a native embed. The original block stays in place, with its content and children intact.

> **Draft prototype, not a Roam Depot release.** Local sandbox tests pass, but live test-graph writes, native Desk rendering, Electron behavior, and coexistence with installed drag extensions still need validation. The extension, documentation, tests, and demo now use English throughout.

## How it works

1. Drag a block's bullet without holding a modifier key.
2. Hover over the entire Desk row. A highlight confirms the drop target.
3. Drop to add this native-format entry at the top of your bound Desk page:

```text
{{embed-path: ((BLOCK_UID)) closed}}
```

4. After readback confirms the entry, choose **View** or **Undo** if needed. The plugin does not navigate automatically or change the clipboard.

The entry is an embed, not a separate copy. Repeated drops do not add duplicates or reorder existing entries. Entries remain native Roam content after the plugin is uninstalled.

## Sandbox demonstration

![Desk Drop in the local in-memory test harness](https://raw.githubusercontent.com/404KSG/roam-desk-drop/main/assets/desk-drop-sandbox.png?v=0.1.1)

This screenshot shows the local test harness, **not a live Roam graph**. The source block remains unchanged while the simulated Desk receives the native embed string.

## Prototype scope

- One top-level block at a time, including its existing children.
- Ordinary blocks in the main outline or right-sidebar outline, within the same window and graph.
- Modifier-key drags are left alone: Option, Command, Control, and Shift are not intercepted.
- Multi-block selections, whole pages, external text/files, cross-window or cross-graph drops, linked-reference lists, query results, and embedded views are not supported yet.
- The current user's `:user/desk-page` binding identifies the destination. The plugin does not guess a page name, create a Desk, or alter the binding.
- Missing or invalid bindings require the user to initialize or recover Desk through Roam.

## Data safeguards

- Capture creates a Desk entry; it does not move, update, or delete the source block.
- Undo can delete only an entry created by the current plugin instance. It checks the entry's text, edit time, parent, children, and backlinks first, and refuses if the entry has changed. It does not call global Undo.
- Failed writes are checked by their pre-generated UID. If the result cannot be confirmed, repeat attempts for that block are paused for the current instance rather than blindly retried.
- Queueing and deduplication are local to one plugin instance. They are not distributed transactions or atomic conditional deletes.
- Unloading removes listeners, highlights, notices, and injected styles. It cannot forcibly cancel an operation already submitted to Roam.
- No AI service, additional API key, analytics, or extra network requests are used. Graph changes still use Roam's own synchronization and permissions. A personal Desk is not a separate privacy boundary.
- Direct Desk self-embedding and blocks already inside a Desk page are rejected. This prototype does not guarantee global cycle detection for complex dynamic renderers or cross-block embeds.

## Validation

- **38 automated tests** pass for capture, source preservation, deduplication, undo guards, graph changes, cancellation, rebinding, ambiguous write outcomes, payload validation, and untranslated-copy detection.
- **10 browser integration checks** pass against both the source entry point and the compiled bundle in an in-memory fixture.
- A browser-driven pointer drag produced trusted `dragstart` and `drop` events; the fixture received an embed, and Undo removed only the new entry.
- Read-only inspection of a live Roam client confirmed the required methods and metadata shapes. **No live-graph create/delete test has been performed.**

See [verification details](https://github.com/404KSG/roam-desk-drop/blob/main/docs/verification.md) for the remaining checks. Event-level modifier tests are not a substitute for testing alongside the actual Drag References extension.

## Files

- `extension.js`: the prebuilt Roam Depot ES module.
- `src/desk-capture.js`: capture validation, deduplication, readback, and guarded Undo.
- `src/roam-adapter.js`: public SDK calls and the Desk compatibility layer.
- `src/drop-payload.js`: native drag-payload validation.
- `src/runtime.js` and `src/ui.js`: the drop target, notices, and lifecycle cleanup.
- `test/fixtures/`: the isolated in-memory browser harness.
- `docs/design.md` and `docs/verification.md`: scope, test interfaces, and verification status.

## Development

Node.js 20 or later is required. Tests use built-in Node modules:

```bash
npm test
npm run fixture
```

Open `http://127.0.0.1:4381/` to test the source entry point, or `http://127.0.0.1:4381/?bundle=1` to test `extension.js`. The fixture uses in-memory data and does not connect to a real Roam graph.

To build, use esbuild 0.28.1 from the project's development dependencies, or point to an existing executable:

```bash
ESBUILD_BIN=/absolute/path/to/esbuild npm run build
npm run check
```

The build script does not install dependencies automatically. The repository includes a prebuilt `extension.js`, so the Depot submission does not need a root `build.sh`.

## Before marking the Depot PR ready

- [ ] Load the module only in a separately authorized test graph with an initialized native Desk.
- [ ] Compare a native Add to Desk operation with a plugin drop, including a block with children.
- [ ] Verify live Desk rendering, source identity and hierarchy, native removal, and guarded Undo.
- [ ] Test Roam web and desktop clients, read-only graphs, sync failures, and graph switching.
- [ ] Test alongside the installed Drag References extension.

`extension.js` is a Roam Depot ES module. Do not paste it into `roam/css` or treat it as a plain `roam/js` snippet.

## Compatibility basis

The Desk binding and embed format were inspected in Roam client `0.13.13-2e4c3c7d`. They are not a documented, stable Desk-specific API contract and require revalidation after relevant Roam updates. The plugin uses public `roamAlphaAPI.data` methods, not minified internal function names.

- [Official developer graph](https://roamresearch.com/#/app/developer-documentation)
- [Machine-readable documentation mirror](https://roamdocs.fyi/developer-documentation/llms-full.txt)
- [Current client Desk implementation](https://roamresearch.com/js/compiled/main.js)
