# 0.1.1 prototype verification

Date: October 26, 2026.

## Completed checks

| Check | Result | Evidence |
|---|---|---|
| Node automated tests | 38 passing | `npm test`: native embeds, source preservation, deduplication, Undo guards, graph changes, cancellation, rebinding, ambiguous writes, payload validation, and an English-copy regression check |
| Browser integration: source | 10 passing | Local `artifacts/browser-tests.json` |
| Browser integration: bundle | The same 10 checks passing | The bundle result in local `artifacts/browser-tests.json` |
| Browser-driven pointer drag | Trusted dragstart/drop events with dropEffect link | Local `artifacts/native-drag.json` |
| Undo button | Removes only the new entry; source and children remain | Pointer-drag record and Node tests |
| Read-only Roam compatibility | Required methods, Desk binding, parent/page metadata, and timestamps are present; graph name matches the native URL | Local `artifacts/read-only-compatibility.json`; no create/delete calls |
| Build and static checks | Passing; no added external network calls or source-block move/update calls | `npm run check` |
| English-only current content | No untranslated Chinese text in source, docs, fixtures, scripts, or decoded bundle; English sandbox image regenerated | English-copy test, browser UI inspection, and `assets/desk-drop-sandbox.png` |
| Reproducible build | Two builds produce the same hash | SHA256 below |

`extension.js` SHA256:

```text
c77eb7243e0a9276d75ef026de6c974e6840ed96cf6522bb5afdda3a3dbb8765
```

The build reused an existing esbuild 0.28.1 installation; no new dependencies were installed. Browser tests use a separate localhost in-memory graph. All simulated create/delete operations modify JavaScript memory only. The earlier read-only compatibility check did not load the extension into the live Roam page. This localization update did not perform live-graph writes.

`artifacts/` contains local verification output and is excluded from Git. The public repository includes rerunnable tests and the in-memory fixture. The screenshot at `assets/desk-drop-sandbox.png` contains sandbox data, not a production graph.

## Remaining release gates

- Compare plugin writes with native Add to Desk in a separate, authorized test graph, including live rendering and native removal.
- Run full drag-and-drop checks in Roam web and Electron clients.
- Test with the installed Drag References extension. Current tests verify modifier-key pass-through, not full coexistence.
- Test live read-only graphs, interrupted synchronization, and concurrent use across devices.

This remains a **prototype awaiting live test-graph validation**. Keep the Depot submission in Draft until these checks are complete. Publishing source or generating a PR preview is not a Marketplace release. The extension has not been installed in a production graph.

## Safety limits

The first version accepts one top-level block from an ordinary outline in the same window and graph. Public APIs do not provide atomic conditional deletion or a global unique-reference constraint, so preflight checks and per-instance queueing cannot replace distributed atomicity. Unloading cannot forcibly cancel a change already submitted to Roam.
