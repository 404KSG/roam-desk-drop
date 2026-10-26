# 0.1.3 verification and submission evidence

Date: October 26, 2026. Prepared for formal maintainer review in [Depot PR #1511](https://github.com/Roam-Research/roam-depot/pull/1511), as requested by the author. Automated write tests use the in-memory fixture; a separately supplied author-recorded desktop demonstration adds observational evidence for the basic live interaction.

## Completed checks

| Check | Result | Evidence |
|---|---|---|
| Author-recorded desktop demonstration | A right-sidebar block is dropped onto Desk; the count changes from 4 to 5, the new card appears, and its native viewer opens | `assets/desk-drop-demo.gif`; not a full source-identity or failure-mode audit |
| Public GIF validation | 1280 x 686, 157 frames, 10.47s, 15fps, looping, 2,541,922 bytes; sRGB, no audio or source metadata | Local `artifacts/demo-publication-check.json`; all 157 frames checked by local OCR plus manual key-frame review |
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

The build reused esbuild 0.28.1; video conversion used the existing FFmpeg installation. No dependencies were installed. Agent-run browser create/delete operations affect an isolated localhost in-memory SDK only. The agent did not install the extension or execute a write test in a live graph. Earlier read-only Roam API and metadata inspection remains in local `artifacts/read-only-compatibility.json`.

The author supplied the desktop recording and explicitly requested its publication. It visibly demonstrates the normal drop and card-opening path, but does not establish UID-level source preservation, live Undo safety, cross-client compatibility, or failure recovery. Runtime JavaScript is unchanged by the media/documentation update.

`artifacts/` is excluded from Git. `assets/desk-drop-demo.gif` and its static fallback are cropped, privacy-redacted derivatives of the author recording. System chrome, graph identifiers, sidebar context, and unrelated note content are omitted or covered. Existing sandbox images remain labeled as sandbox evidence. The raw video and earlier diagnostic screenshot are not published.

## Remaining verification work

- Extend the observed desktop cursor/tint behavior to the supported Roam web/desktop clients and themes; one recording is not a compatibility matrix.
- Compare plugin writes with native Add to Desk in a separate, authorized test graph, including rendering and native removal.
- Test coexistence with the installed Drag References extension; existing tests cover modifier pass-through, not full coexistence.
- Test live read-only graphs, interrupted synchronization, and concurrent devices.

The author requested formal review rather than continuing in Draft. The gaps above remain open and are not marked as passed. A source push or a Ready-for-review PR is not a Marketplace release; listing requires the upstream maintainer's merge. The author explicitly approved the MIT license. The standard license is included in `LICENSE`, and `package.json` declares `MIT`; runtime JavaScript is unchanged by this licensing update.

## Safety limits

Only one top-level block from an ordinary outline in the same window and graph is supported. Public APIs provide neither atomic conditional deletion nor a global unique-reference constraint. Per-instance queueing does not provide distributed atomicity. Dismissing feedback or unloading cannot cancel a write already submitted to Roam.
