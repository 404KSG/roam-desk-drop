# 0.1.2 quiet interaction preview verification

Date: October 26, 2026. Validated locally for the existing [Depot Draft PR #1511](https://github.com/Roam-Research/roam-depot/pull/1511). A source push or PR preview does not replace live test-graph validation.

## Completed checks

| Check | Result | Evidence |
|---|---|---|
| Node automated tests | 38 passing | `npm test`: capture, source preservation, deduplication, Undo guards, graph changes, cancellation, rebinding, ambiguous writes, payload validation, and English-copy checks |
| Browser integration: source | 18 passing | Local `artifacts/quiet-browser-tests.json` |
| Browser integration: bundle | The same 18 checks passing in a focused document | Bundle results in `artifacts/quiet-browser-tests.json` |
| Browser-driven pointer drag | Trusted dragstart/drop events with dropEffect link | Local `artifacts/quiet-native-drag.json` |
| Native click on inline Undo | Removes only the new entry, preserves source and children, and does not trigger Desk navigation | Pointer-drag record; focused-button regression in the browser suite |
| Quiet feedback | No bottom-right panel; no instructional text during dragging; original label, icon, and row geometry preserved | Browser suite and actual sandbox screenshots |
| Compact dark sidebar | Label and action do not overlap in a 144px Desk row; native foreground preserved | `artifacts/quiet-presentation-checks.json` |
| Reduced motion | Spinner remains visible without animation | Presentation checks through browser media emulation |
| Cleanup and stale work | Pending and completed feedback cannot return after a graph switch or unload; original attributes restored | Browser suite |
| Read-only Roam compatibility | Earlier method and metadata inspection passed; no live write test | Local `artifacts/read-only-compatibility.json` |
| Build and static checks | Passing; no added network calls or source-block move/update calls | `npm run check` |
| Core data code | Identical to the published 0.1.1 source | Diff of `desk-capture.js`, `roam-adapter.js`, `drop-payload.js`, and `extension-entry.js` against `cf91526` |
| Reproducible build | Two builds produce the same hash | SHA256 below |

`extension.js` SHA256:

```text
5d55e48c72811ab8f4f2e85aeca9e499f3bc6e63c96201d7d6b37df27209de12
```

## Focus regression caught during verification

A real mouse click on Undo focuses its button before activation. Removing that focused button triggered a captured blur event, which called drag cleanup and re-entered the renderer. The second removal raised `NotFoundError` before Undo could run. A synthetic `.click()` in an unfocused document had missed the problem.

The minimal fix makes highlight cleanup a no-op when no drag highlight exists, so unrelated focus changes cannot repaint the feedback. The browser suite now requires a focused document and explicitly focuses Undo before activation. Its failure was reproduced before the fix, and both source and bundle checks plus a real mouse click passed afterward. Local red-run evidence is `artifacts/quiet-focused-undo-red.json`.

## Scope and evidence

The build reused an existing esbuild 0.28.1 installation; no dependencies were installed. Browser tests use a separate localhost in-memory graph. All simulated create/delete operations modify JavaScript memory only. The earlier read-only compatibility check did not load the extension into the live Roam page. This interaction revision did not perform live-graph writes, production installation, or a Marketplace release.

`artifacts/` holds local evidence and is excluded from Git. Public-source assets and fixtures contain sandbox data only. The four-state preview in `assets/desk-drop-interaction.png` uses actual sandbox screenshot crops, not a claim of live Roam rendering.

## Remaining release gates

- Compare plugin writes with native Add to Desk in a separate, authorized test graph, including rendering and native removal.
- Check the row feedback in actual Roam web and Electron clients and the installed theme.
- Test alongside the installed Drag References extension; current tests cover modifier pass-through, not full coexistence.
- Test live read-only graphs, interrupted synchronization, and concurrent devices.

Keep the Depot PR in Draft. A source push or PR preview is not a Marketplace release. The extension has not been installed in a production graph by this revision.

## Safety limits

The prototype accepts one top-level block from an ordinary outline in the same window and graph. Public APIs provide neither atomic conditional deletion nor a global unique-reference constraint. Preflight checks and per-instance queueing do not provide distributed atomicity. Dismissing feedback or unloading cannot cancel a write already submitted to Roam.
