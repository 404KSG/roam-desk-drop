# Changelog

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
