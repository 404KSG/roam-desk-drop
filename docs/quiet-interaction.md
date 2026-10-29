# Quiet sidebar interaction

Keep collection feedback in the destination row. Preserve native page navigation, the original label and icon, and the sidebar's visual rhythm.

```text
Idle       [native icon] Page name
Drop       [native icon] Page name           +
Writing    [native icon] Page name           spinner
Added      [native icon] Page name           green check
Existing   [native icon] Page name           green check
Error      [native icon] Page name           warning
```

## Visual contract

- The plus, spinner, check, and warning occupy the same right-hand slot. No success icon appears before the page label.
- Success is green and lasts approximately 900ms, including while hovered. There is no Undo button or hover extension of the timer.
- Keep the 14px line icon and a faint foreground-derived target tint, with a 6px radius and no inset frame or shadow. Background transition: 100ms.
- Keep native starred-page reference counts visible and place the feedback slot to their left with a measured gap.
- Keep original labels, icons, font, foreground, row height, and adjacent navigation geometry. No instructional row text, global toast, label motion, or automatic navigation.
- Reduced motion disables the target transition and spinner animation.

## Behavior and accessibility

The native row click remains navigation. A bullet drag can collect an ordinary block while its editor has a cursor. The pointer fallback shows a small text preview and a grabbing cursor after the movement threshold; release or cancellation removes both. Grabbing text inside the editor retains selection/editing behavior. Modifiers preserve existing gestures.

The row shows pending feedback until readback confirms the entry. A hidden polite live region announces progress, success, duplicate detection, and errors. Errors remain available through a focusable warning with full tooltip and accessible label. Escape dismisses local feedback; it cannot undo an already submitted SDK write.

A newer drag/drop, graph change, or unload prevents older completions from restoring stale feedback. No graph entry is deleted by this extension.

## Cursor permissions

Prefer `dropEffect: copy` when the native source permits copy, retain `link` for link-only sources, and reject move-only, none, or unknown permissions. The data operation is always an embed referencing the original, regardless of cursor artwork. The browser and OS choose the native cursor image.

- [MDN: DataTransfer.dropEffect](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/dropEffect)
- [Apple: Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices)

Synthetic DataTransfer tests model permissions because constructed transfers can keep native effect fields at `none`. Trusted pointer tests cover actual event behavior separately.

## Validation boundary

The fixture includes native-shaped Desk/Daily Notes rows, ancestor page links, reference counts, ordinary blocks, and an edited textarea block whose native drag setup is suppressed. Check source and bundle, reduced motion, real mouse gestures, duplicate prevention, pending/errors, context changes, cancellation, and unload.

Read-only live-client inspection establishes DOM and native-handler compatibility. Automated graph-write acceptance uses only the isolated in-memory fixture. Live cross-client, synchronization, concurrent-device, and full extension-coexistence checks remain separate work.
