# 0.1.3 cursor and background verification

Date: October 26, 2026. Validated locally for the existing [Depot Draft PR #1511](https://github.com/Roam-Research/roam-depot/pull/1511). No production installation or live-graph write test is included.

## Completed checks

| Check | Result | Evidence |
|---|---|---|
| Node automated tests | 38 passing | `npm test`: capture, source preservation, deduplication, Undo guards, context changes, cancellation, ambiguous writes, payload validation, and English-copy checks |
| Browser integration: source | 21 passing | Local `artifacts/cursor-browser-tests.json` |
| Browser integration: bundle | The same 21 checks passing in a focused document | Bundle results in the same report |
| Reduced-motion suite | All 21 bundle checks passing with reduced motion enabled | `artifacts/cursor-reduced-motion-tests.json` |
| Trusted pointer drag | Actual drop and drag-end events report `dropEffect: copy` for an ordinary uninitialized source | `artifacts/cursor-native-drag.json` |
| Data and inline Undo | A native embed is created; source and children remain unchanged; a real mouse click on Undo removes only the new entry without navigation | Native pointer report |
| Cursor permissions | Copy preferred when permitted; link retained only when copy is unavailable; move-only/none/unknown inputs rejected | Browser permission matrix; other-target and modifier checks |
| Background-only feedback | No target shadow; only Desk and the plus are visible during dragging; transition is 100ms | `artifacts/cursor-presentation.json` and screenshots |
| Sidebar-theme compatibility | Target tint survives later important normal/hover rules; other rows stay unchanged; native hover paint returns afterward | Browser theme-precedence regression |
| Reduced-motion background | Target transition becomes 0s | Presentation report and full reduced-motion suite |
| Core data code | Identical to published 0.1.2 | Diff of `desk-capture.js`, `roam-adapter.js`, `drop-payload.js`, and `extension-entry.js` against `5315bb0` |
| Build and static checks | Passing; no added network calls or source-block move/update calls | `npm run check` |
| Reproducible build | Repeated builds produce the same hash | SHA256 below |

`extension.js` SHA256:

```text
3ac06d1a398cc218d669ecb411c01519ab968c4232c522afce99cbd39a581807
```

## Regressions reproduced before the fixes

- **Cursor:** an ordinary source allowing all operations requested `link`, which selects macOS link/alias feedback. The regression now observes a request for `copy`, while verifying that the resulting entry is still exactly a native embed and the original block is unchanged. Red-run evidence: `artifacts/cursor-red.json`.
- **Decoration:** the active row had an inset frame rather than only a background. Red-run evidence: `artifacts/background-red.json`.
- **Theme precedence:** important sidebar hover rules could override the target tint. The regression uses equivalent public-theme specificity, including a later stylesheet and hover transition. The fix qualifies only the active Desk row; it does not change the theme or other navigation rows.

Constructed DataTransfer objects in the test browser keep their native effect fields at `none`. Synthetic tests model permissions and record the requested drop effect at that browser boundary. Trusted pointer tests separately verify the browser's actual `copy` effect on drop and drag end. The OS still owns cursor artwork; page screenshots do not capture it. Link-only sources may still use the platform's link cursor.

## Retained focused-Undo regression

The 0.1.2 mouse test exposed a focused-button removal that triggered blur and re-entered highlight cleanup. Idle cleanup is now a no-op, preventing a second removal before Undo runs. Tests still require a focused document and explicitly focus Undo before activation. The earlier red evidence remains in `artifacts/quiet-focused-undo-red.json`.

## Scope and evidence

The build reused the existing esbuild 0.28.1 installation; no dependencies were installed. Browser create/delete operations affect an isolated localhost in-memory SDK only. No live-graph writes, production installation, or Marketplace release were performed for this revision. Earlier read-only Roam API and metadata inspection remains in local `artifacts/read-only-compatibility.json`.

`artifacts/` is excluded from Git. Images in `assets/` contain only sandbox data. The user-provided diagnostic screenshot is not included in the repository. The four-state preview uses actual sandbox screenshot crops, not a claim of live Roam or OS-cursor rendering.

## Remaining release gates

- Confirm cursor appearance and target tint in the actual Roam Electron/web client and installed theme after an authorized test installation.
- Compare plugin writes with native Add to Desk in a separate, authorized test graph, including rendering and native removal.
- Test coexistence with the installed Drag References extension; existing tests cover modifier pass-through, not full coexistence.
- Test live read-only graphs, interrupted synchronization, and concurrent devices.

Keep the Depot PR in Draft. A source push or PR preview is not a Marketplace release.

## Safety limits

Only one top-level block from an ordinary outline in the same window and graph is supported. Public APIs provide neither atomic conditional deletion nor a global unique-reference constraint. Per-instance queueing does not provide distributed atomicity. Dismissing feedback or unloading cannot cancel a write already submitted to Roam.
