# Changelog

## 0.1.2 - Quiet interaction draft update

- Remove the bottom-right notification panel and the full-row instructional overlay.
- Preserve the native Desk label and icon while showing a subtle drop target and a small plus.
- Keep progress, success, and error feedback in the Desk row. Reveal guarded Undo on hover or keyboard focus.
- Keep native Desk navigation instead of adding a separate View button.
- Retain full error details in the warning's native tooltip and accessible label, plus a visually hidden live region.
- Discard stale visual feedback after a newer drop, graph switch, or dismissal. Keep the capture engine and source-preservation safeguards unchanged.
- Add browser coverage for geometry, quiet feedback, pending writes, errors, queued Undo ownership, attribute restoration, and compact/dark sidebars.

## 0.1.1 - English-only draft update

- Translate all interface messages, errors, documentation, comments, test descriptions, and fixture content into English.
- Regenerate the sandbox screenshot with English UI text.
- Add a regression check for untranslated text, including Unicode escapes in the compiled bundle.
- Keep capture, deduplication, Undo safeguards, and native embed syntax unchanged.

## 0.1.0 - Draft prototype

- Add a drop target to the existing left-sidebar Desk row for a single ordinary block.
- Create native `embed-path` entries without moving or copying the source content.
- Add deduplication, write readback, optional navigation, and guarded Undo.
- Leave modifier-key drags and drops outside Desk to the existing handlers.
- Clean up listeners and transient UI on unload.

Validation covers automated tests and a local in-memory browser fixture. Live test-graph writes, native Desk rendering, desktop-client behavior, and integration with installed drag extensions remain pending.
