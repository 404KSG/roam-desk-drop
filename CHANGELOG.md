# Changelog

## 0.2.2 - Clear outcomes

- Treat blocks already on the destination page as an informational result with no graph write. Daily Notes explicitly says **Already in today's note**.
- Distinguish existing embeds with a neutral circled check and **Already added**, reserving the green check for newly added entries.
- Show short, destination-anchored explanations for existing content for 1.8 seconds. Explain real failures immediately for 2.2 seconds, with details available again on hover or keyboard focus.
- Keep the fixed far-right feedback slot, count coverage/restoration, native navigation, and 900ms new-add confirmation.
- Remove contextual explanations on new drags, Escape, graph changes, scroll/resize, or unload; retain accessible labels and the live region.
- Add no-write same-page coverage and browser regressions for distinct outcomes, immediate explanations, focus access, and cleanup.

## 0.2.1 - Roam Drop and far-right feedback

- Rename the extension to **Roam Drop**. Retain the existing Depot identifier and runtime key so the same listing and preview continue to work.
- Fix the feedback slot 10px from the row's right edge, with or without a reference count. The plus, spinner, green check, and warning share that slot.
- Temporarily cover reference counts while feedback is visible, preserving their layout space, styles, and current values. Restore them on completion, leaving, cancellation, context changes, or unload.
- Cover counts added or updated while feedback is active, without shifting the icon or overwriting count data.
- Strengthen browser regressions for far-right placement, count coverage/restoration, and unchanged row geometry. Refresh the sandbox image to show the new name and placement.

## 0.2.0 - Sidebar page destinations

- Extend collection to Daily Notes, native Desk, and starred pages in the left sidebar. Daily Notes uses today's local date; starred pages use their linked page identity.
- Keep the same native embed and source hierarchy. Deduplicate independently per destination and reject captures into the source page itself.
- Support bullet dragging while a block's editor has a cursor, with a pointer fallback, text preview, and grabbing cursor for the native client's suppressed drag setup.
- Keep the hover plus; show a green success check in exactly the same slot for approximately 900ms, including while hovered.
- Remove inline Undo, receipts, and the entry-delete action.
- Freeze the Daily Notes date before queueing; check cancellation during DNP resolution before creating a missing page.
- Preserve shortcut reference counts, native navigation, modifier gestures, cancellation, and unload cleanup.
- Add destination, DNP, edited-block, pointer/native interaction, feedback, and lifecycle regression coverage. Keep Depot PR #1511 in Draft for continued review.

## 0.1.3 - Copy feedback and background-only target

- Prefer native `copy` feedback for ordinary accepted drags instead of the macOS link/alias cursor. The data operation remains a native embed, not a source-text copy or move.
- Respect source permissions: retain `link` only when copying is unavailable, reject move-only drags, and leave other targets and modifier gestures unchanged.
- Remove the target's inset frame. Keep the small plus and a 100ms background-only transition, disabled for reduced motion.
- Scope active Desk paint strongly enough to survive important sidebar theme hover rules without changing other navigation rows.
- Add regression coverage for cursor permissions, unchanged native gestures, background-only decoration, and theme precedence.
- Add a privacy-redacted, author-recorded desktop GIF and a reduced-motion static fallback to the README. Prepare the existing Depot submission for formal maintainer review without changing runtime JavaScript.
- Add the author-approved MIT license, package metadata, and README license notice. Third-party demonstration content retains its owners' rights.
- Shorten the README to the demo, basic use, and scope; move implementation safeguards and development instructions to the technical documentation. Runtime behavior is unchanged.

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

Validation uses automated tests and an in-memory browser fixture. An earlier author-recorded demonstration covers the Desk-only interaction from 0.1.3. Live cross-client and synchronization checks, concurrent devices, and full coexistence with installed drag extensions remain follow-up work.
