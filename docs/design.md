# Desk Drop 0.1: confirmed baseline

Decision confirmed on October 26, 2026: dropping onto Desk adds a native embed. The original block stays in place; its text is not copied.

## Scope

- An independent Roam Depot extension for dragging one ordinary top-level block from the main or right-sidebar outline onto the existing Desk row.
- Resolve the current user's `:user/desk-page` binding. Do not guess the page name, create a Desk, or modify the binding.
- Create `{{embed-path: ((uid)) closed}}` at the top of Desk. Do not add another entry when a matching embed or embed-path entry already exists.
- Preserve the source UID, text, parent, order, and children. Do not move or update the source.
- Preserve the native Desk click behavior. Do not navigate automatically or write to the clipboard after capture.
- Clicking the original Desk row opens native Desk. Inline Undo may remove only an entry created by this instance that has not been changed, referenced, or given children. Do not call global Undo.
- Keep interaction feedback local to the Desk row, with no bottom-right toast or full-row instructional text. See [quiet interaction design](quiet-interaction.md) for the visual contract and sources.

## Test interfaces

1. `DeskCapture.capture` and `undo`: connect the real adapter to a simulated Roam SDK and check observable graph results and source preservation.
2. `createDeskDropRuntime.start/stop`: exercise browser events to verify the drop target, native/modifier drag pass-through, cancellation, and unload cleanup.
3. Roam SDK adapter: mock only the external SDK, not this project's modules. Check actual call shapes and error handling.

Start with a failing test, implement that behavior, and add safety cases incrementally. Browser integration tests use a local in-memory graph fixture, not writes to a production Roam graph.

## Out of scope

Multiple top-level blocks; web-page, file, or cross-window drops; cross-graph capture; automatic sidebar expansion; mobile touch gestures; automatic classification; AI; production installation; and release. Linked-reference, query, and embed surfaces are not handled in the first version because their source identity needs separate validation.

## Compatibility basis

The native Desk entry format and `:user/desk-page` binding were inspected in client `0.13.13-2e4c3c7d`. They are not a published, stable Desk API contract. Validate them in a separate test graph before connecting the extension to a production graph.

Official drag payloads: `roam/block-uid-list-only-parents`, `roam/block-uid-list`, and `roam/roam-uri-list`. Use public `roamAlphaAPI.data.block.create/delete`, `data.pull/q`, `user.uid()`, `graph`, and `util.generateUID()`. Do not call minified internal functions.

Sources:

- https://roamdocs.fyi/developer-documentation/llms-full.txt
- https://roamresearch.com/js/compiled/main.js
- https://roamresearch.com/js/compiled/route-app.js

Deduplication is local to the current browser instance, not a distributed atomic guarantee. Read back uncertain writes before retrying; do not create again blindly.
