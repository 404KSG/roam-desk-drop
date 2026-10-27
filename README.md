# Desk Drop

Drag a block onto **Desk** in Roam's sidebar to add a live embed. The original stays in place.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="https://raw.githubusercontent.com/404KSG/roam-desk-drop/main/assets/desk-drop-demo-still.png">
  <img src="https://raw.githubusercontent.com/404KSG/roam-desk-drop/main/assets/desk-drop-demo.gif" alt="Dragging a block onto Desk, then opening its new card." width="1280">
</picture>

Recorded in Roam desktop; personal details hidden. [Static preview](https://raw.githubusercontent.com/404KSG/roam-desk-drop/main/assets/desk-drop-demo-still.png).

## Use

1. Open Roam's native Desk once to initialize it.
2. Drag a block's bullet onto **Desk**, without modifier keys.
3. Hover the row for **Undo**, or click **Desk** to view it.

Repeated drops don't add duplicates. Undo only removes the new Desk entry, never the original.

## Scope

One block at a time from the main or right-sidebar outline, within the same graph and window. Selections, pages, external drops, and reference/query/embed views aren't supported.

[Roam Depot review](https://github.com/Roam-Research/roam-depot/pull/1511) is pending; broader compatibility checks remain open.
PR preview: `404KSG+roam-desk-drop+1511`.

[Technical details](https://github.com/404KSG/roam-desk-drop/blob/main/docs/design.md) · [Verification](https://github.com/404KSG/roam-desk-drop/blob/main/docs/verification.md) · [MIT license](https://github.com/404KSG/roam-desk-drop/blob/main/LICENSE)

Third-party demo content retains its owners' rights.
