# Changelog

## 0.1.0 — Draft prototype

- Add a drop target to the existing left-sidebar Desk row for a single ordinary block.
- Create native `embed-path` entries without moving or copying the source content.
- Add deduplication, write readback, optional navigation, and guarded Undo.
- Leave modifier-key drags and drops outside Desk to the existing handlers.
- Clean up listeners and transient UI on unload.

Validation covers automated tests and a local in-memory browser fixture. Live test-graph writes, native Desk rendering, desktop-client behavior, and integration with installed drag extensions remain pending.
