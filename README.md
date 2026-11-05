# Roam Drop

Collect an existing Roam block on another page by dragging its bullet onto a supported row in the **left sidebar**. Roam Drop adds a **live embed at the top of the destination page**, rather than moving the original or copying its text into an independent block.

The original block, its children, and its position in your outline stay unchanged. The embed refers to that same block, so it remains connected to the source.

For example, collect an action item from meeting notes in today's Daily Notes, save a reading excerpt to Desk for later, or gather related blocks on a starred project page without reorganizing the source notes.

![Local sandbox comparison: a plus appears on the starred Build row during a drag, followed by a green check after an embed is added; the original block stays in place](https://raw.githubusercontent.com/404KSG/roam-desk-drop/8b1e35255424d09fe4c6e2265be45a9bc7acf6d2/assets/sidebar-drop-sandbox.png)

*Sidebar feedback shown in a synthetic 0.2.2 sandbox, not a production graph. Version 0.2.3 fixes native dragging while a block editor has focus; its separate regression evidence is in [Verification](docs/verification.md).*

## Install or preview

Roam Drop is a **Roam Depot extension**. Enable it through Roam Depot when it is available in the catalog. Before [Depot PR #1511](https://github.com/Roam-Research/roam-depot/pull/1511) is merged, use Roam Depot's developer-mode preview with this shorthand:

```text
404KSG+roam-desk-drop+1511
```

The current runtime version is **0.2.3**. The package ID remains `roam-desk-drop` for compatibility with the earlier Desk Drop name.

No API key, local Helper, or separate service is needed. `extension.js` is a Depot ES module, not a snippet to paste into a `roam/js` block.

## First drop

1. Open a Roam graph and make the **left sidebar** visible. Locate Daily Notes, Desk, or a starred page. To use another existing page, star it in Roam first.
2. Grab **one block's bullet**, not its text, in the main outline or right-sidebar outline. You can start while its editor has focus.
3. Drag onto the destination's sidebar row **without holding Shift, Command, Control, or Alt/Option**. A plus at the row's right edge marks a drop target; release there.
4. Wait for the result indicator. A green check confirms that an embed was added. Open the destination page normally to view it; Roam Drop does not navigate there automatically.

Text selection is unchanged. Reordering within the outline stays with Roam; Roam Drop collects a block only when you release it over a supported left-sidebar row. Clicking a sidebar page still opens it normally.

## Where can I drop a block?

| Left-sidebar row | Destination and behavior |
| --- | --- |
| **Daily Notes** | Today's daily page, using the date when you drop the block, not whichever dated note you happen to be viewing. Roam Drop may create today's page if it does not exist. |
| **Desk** | Roam's native Desk page bound to your current user, even if it has been renamed. Open native Desk once before the first drop so Roam can initialize it. |
| **Starred page** | The existing page represented by that sidebar shortcut. The extension does not create a missing starred page. |

Navigation items such as Roam Depot and shortcut headings are not destinations. A starred shortcut must point to a page in the current graph, not to a block or another graph.

## What the indicators mean

Feedback appears at the right edge of the destination row. If a reference count occupies that space, it is temporarily hidden, not changed.

| Indicator | Meaning |
| --- | --- |
| **Plus** | A sidebar drop target is active. Source and destination checks still apply when you release. |
| **Spinner** | The entry is being added and checked. |
| **Green check** | A new embed was created and read back successfully. The check clears after about a second. |
| **Neutral circled check** | Nothing new was needed: **Already added**, **Already on this page**, or **Already in today's note**. This is not an error. |
| **Warning** | The drop was rejected or its result could not be confirmed. Read the explanation beside the row; hover or keyboard-focus the warning to see it again. |

## Repeated drops and source preservation

- If the source block already belongs to the destination page, nothing is added.
- Otherwise, Roam Drop checks the destination's **top-level embed and embed-path blocks** for that source. A matching entry produces **Already added** instead of another embed.
- Plain `((uid))` references and nested embeds do not count as matching entries. Checks are per destination, not graph-wide: the same source can be collected on different pages, and simultaneous writes from other devices may still create duplicates.
- Roam Drop never moves, updates, or deletes the source block. Disabling the extension does not remove entries already created.

There is **no inline Undo**. Escape can cancel an unfinished gesture or dismiss feedback, but it cannot reverse a write already submitted to Roam. If a warning says the result could not be confirmed, inspect the destination page first; further attempts for that source/destination pair are paused rather than blindly retried.

## Supported scope and common problems

This version supports **one ordinary block per drag, in one graph and one window**, using a desktop pointer. Whole pages, multi-block selections, external content, cross-window/graph drops, touch dragging, and blocks shown inside references, queries, or embeds are not supported.

- **No plus appears:** expose the left sidebar yourself, grab the bullet rather than editor text, release modifier keys, and choose a supported page row. Roam Drop does not expand a collapsed sidebar automatically.
- **Desk is unavailable:** open native Desk once. If its bound page is missing, recover it through Roam's native Desk first.
- **A Desk block will not drop onto Desk:** dropping it back on its own Desk gives **Already on this page**, with no write. A block from another Desk is rejected. Desk blocks can still be collected onto a different non-Desk page.
- **Nothing new appears after a drop:** check for an existing-content explanation. A source already on that page or a matching top-level embed is a normal no-write result.

## Privacy and technical details

Roam Drop uses Roam's APIs in the current graph. The extension makes no external network requests, sends no analytics, and does not access the clipboard. Roam's own synchronization and access rules still apply; a personal Desk is **not an additional privacy boundary** created by this extension.

The runtime depends on Roam's native sidebar and block structure. Automated graph-write tests use an isolated in-memory fixture; live-client synchronization, concurrent-device behavior, and exhaustive theme/extension coexistence remain separate acceptance work.

For implementation details and contributor checks, see [Design and development](docs/design.md), [Interaction behavior](docs/quiet-interaction.md), and [Verification and limits](docs/verification.md).

## License

[MIT](LICENSE). Third-party demo content retains its owners' rights.
