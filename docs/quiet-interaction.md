# Quiet sidebar interaction

Keep collection feedback in the destination row. Preserve native page navigation, the original label and icon, and the sidebar's visual rhythm.

```text
Idle       [native icon] Page name           reference count
Drop       [native icon] Page name           +
Writing    [native icon] Page name           spinner
Added      [native icon] Page name           green check
Existing   [native icon] Page name           neutral circled check + explanation
Error      [native icon] Page name           warning + specific reason
```

## Visual contract

- The plus, spinner, check, and warning occupy a fixed slot 10px from the row's right edge, whether or not the page has a reference count. No success icon appears before the page label.
- A newly added entry gets a green check for approximately 900ms, including while hovered. Existing content gets a neutral circled check and a short explanation for 1.8 seconds. There is no Undo button or hover extension of these timers.
- Keep the 14px line icon and a faint foreground-derived target tint, with a 6px radius and no inset frame or shadow. Background transition: 100ms.
- Cover starred-page reference counts only while feedback is visible. Preserve their layout space, styles, and live values; restore them when feedback clears. The icon never moves left to accommodate a count. Counts added during feedback follow the same rule.
- Keep original labels, icons, font, foreground, row height, and adjacent navigation geometry. Explain outcomes in a small contextual tooltip beside the destination, preserving the row label and layout. No global toast or automatic navigation.
- Reduced motion disables the target transition and spinner animation.

## Behavior and accessibility

The native row click remains navigation. A bullet drag can collect an ordinary block while its editor has a cursor. The pointer fallback shows a small text preview and a grabbing cursor after the movement threshold; release or cancellation removes both. Grabbing text inside the editor retains selection/editing behavior. Modifiers preserve existing gestures.

The row shows pending feedback until readback confirms the entry. A hidden polite live region announces progress, success, existing-content outcomes, and errors.

- A source block already on the destination page is a normal no-write outcome: **Already in today's note** or **Already on this page**.
- An existing embed says **Already added**. It does not use the new-add green check or an error warning. Hovering or focusing the indicator reveals the full explanation.
- An error immediately shows the full reason beside the destination. The automatic explanation closes after 2.2 seconds when its indicator is neither hovered nor focused; the warning remains focusable and reveals the details again on hover or keyboard focus.

Tooltips use `role="tooltip"` and are linked to their focusable indicators. Interactive result indicators omit native `title` tooltips to avoid competing explanations. They are placed within the viewport, outside the sidebar's clipping container, and do not intercept pointer input. Scroll, resize, a newer drag, a context change, or unload removes stale tooltip content. Escape dismisses feedback; it cannot undo an already submitted SDK write.

A newer drag/drop, graph change, or unload prevents older completions from restoring stale feedback. No graph entry is deleted by this extension.

## Cursor permissions

Prefer `dropEffect: copy` when the native source permits copy, retain `link` for link-only sources, and reject move-only, none, or unknown permissions. The data operation is always an embed referencing the original, regardless of cursor artwork. The browser and OS choose the native cursor image.

- [MDN: DataTransfer.dropEffect](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/dropEffect)
- [Apple: Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices)

Synthetic DataTransfer tests model permissions because constructed transfers can keep native effect fields at `none`. Trusted pointer tests cover actual event behavior separately.

## Validation boundary

The fixture includes native-shaped Desk/Daily Notes rows, ancestor page links, reference counts, ordinary blocks, and an edited textarea block whose native drag setup is suppressed. Check source and bundle, reduced motion, real mouse gestures, duplicate prevention, pending/errors, context changes, cancellation, and unload.

Read-only live-client inspection establishes DOM and native-handler compatibility. Automated graph-write acceptance uses only the isolated in-memory fixture. Live cross-client, synchronization, concurrent-device, and full extension-coexistence checks remain separate work.
