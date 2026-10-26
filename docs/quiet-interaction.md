# Quiet Desk interaction

## Brief

Reduce English copy during dragging, use a restrained Linear-inspired interaction, and remove bottom-right notifications. Preserve native Desk behavior and source-block safety. This is a draft prototype revision, not a production installation or a Marketplace release.

## First-party references

- [A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh), March 12, 2026: Linear describes reducing the visual weight of navigation, using fewer and smaller icons, softening borders, and moving toward less saturated gray palettes.
- [Personalized sidebar](https://linear.app/changelog/2024-12-18-personalized-sidebar), December 18, 2024: Linear documents direct sidebar reordering with drag and drop, optional notification dots, and hiding less-used navigation items.

Both pages were read directly. These sources support restraint and local, direct manipulation. They do not establish that Linear uses this exact Desk-like drop interaction or avoids all toasts. The no-toast requirement comes from the user.

## Alternatives and choice

1. **Local icon feedback (selected):** preserve the destination label; show only the current state beside it. A user can confirm the result without looking elsewhere.
2. **Completely silent capture:** visually simpler, but provides no assurance that a drop succeeded or failed.
3. **A smaller floating confirmation:** still pulls attention away from Desk and conflicts with the no-toast request.

## Visual contract

```text
Idle       [native icon] Desk
Drop       [native icon] Desk           +
Writing    [native icon] Desk           spinner
Added      [native icon] Desk           check [Undo on hover/focus]
Existing   [native icon] Desk           check
Error      [native icon] Desk           warning
```

- Preserve native icon, label, foreground, font, row height, and adjacent navigation geometry. Do not swap the word Desk for instructions.
- Use a 6px radius only for the active drop target, a 7% foreground-derived fill, and a 16% foreground-derived inset hairline. These inherit the host theme rather than adding a white overlay or a saturated accent.
- Use 14px line icons with a 1.5px stroke. Use the native font for the 11px Undo action. This is a navigation detail, not an opportunity to introduce a second typeface or a new application theme.
- The neutral reference palette is ink `#262626`, muted `#737373`, line `#ececee`, and surface `#f6f6f7`. Actual row colors come from the host. Warning uses `#a87936`, overridable through `--rr-desk-drop-warning`.
- No large shadows, extra cards, global borders, label motion, or bottom-right panel. The only fade is a short Undo reveal. Reduced-motion preferences disable that transition and the spinner animation.

## Behavior and accessibility

- Dragging onto Desk adds only an icon and a faint target treatment. Leaving or canceling the drag restores the row.
- After readback, a check confirms success. A compact Undo action appears on row hover or keyboard focus, with an eight-second idle timeout that pauses on hover/focus. Existing entries never receive Undo.
- Clicking the original Desk entry remains the navigation action; there is no separate View button. Undo prevents bubbling into native navigation.
- Failures retain a local warning. Pointer users can inspect the native tooltip; keyboard and screen-reader users receive a focusable warning with the full accessible label. A visually hidden polite live region announces progress and outcomes without adding visible prose.
- Escape dismisses feedback. It does not cancel an already submitted SDK write. A graph change, newer accepted operation, or unload prevents stale completions from restoring feedback.
- Only the latest accepted drop owns the visible Undo. Its receipt is still validated by the unchanged capture engine.
- No source updates, moves, clipboard changes, automatic navigation, analytics, new dependencies, or production-graph writes are introduced by this revision.

## Validation boundary

Use real browser events and the compiled bundle against the in-memory fixture. Verify row geometry, native navigation, inline Undo, errors, pending writes, queued operations, graph switches, cleanup, compact and dark styles, and reduced motion. Live native Desk acceptance and coexistence with installed extensions remain separate release gates.
