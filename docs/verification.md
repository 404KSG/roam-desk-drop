# 0.2.1 verification

**Roam Drop 0.2.1** renames the extension and fixes feedback at the far-right edge, temporarily covering reference counts. Daily Notes, Desk, starred-page destinations, native embeds, and edited-block dragging remain supported. Depot PR [#1511](https://github.com/Roam-Research/roam-depot/pull/1511) remains **Draft**.

## Evidence boundaries

Automated write tests use the localhost in-memory SDK. Read-only inspection of the logged-in Roam client confirmed native sidebar selectors, shortcut page links, reference-count markup, and block identity attributes. No production graph was modified and no extension was installed there during this work.

The current client source's bullet drag-start handler bypasses native drag setup when editing state is active. The fixture models this condition with a textarea block and suppressed native setup; both synthetic pointer tests and trusted mouse tests are required for the fix.

## Reproduced baseline failures

Before implementation, the expanded capture suite had **23 failing checks out of 42**. The initial browser suite had **7 failing checks out of 18**, including starred destinations, today's DNP, the unchanged feedback slot, and edited-block pointer capture. A trusted mouse drag from the edited-block bullet to a starred row created no entry on the baseline, while preserving the editor value.

These counts refer to the initial 0.2.0 red suite. For the 0.2.1 right-edge change, the expanded browser suite reproduced **5 failures out of 27** on the prior implementation: left-shifted feedback and missing count coverage during hover, pending, success, cancellation, and dynamic insertion. The revised implementation passes all 27 checks. Local raw evidence is retained under ignored `artifacts/`; only sanitized aggregate evidence belongs in this repository.

## Acceptance coverage

The updated suites cover native embeds and unchanged source hierarchy; top insertion and per-page duplicates; missing/existing daily pages and conflicting identities; invalid targets; context switches and cancellation; uncertain write readback; edited-block pointers from main/right outlines; pointer/native exclusivity; modifier/multi-selection pass-through; success color, placement and timeout; count restoration; errors and pending announcements; and lifecycle cleanup.

## Completed checks

| Check | Result |
|---|---|
| Node tests | **53 passed**: capture, payload, source preservation, per-page deduplication, DNP identity/date, cancellation, and lifecycle |
| Browser source suite | **27 passed** |
| Browser bundle suite | **27 passed** |
| Browser bundle with reduced motion | **27 passed** |
| Trusted edited-block mouse drags | Starred rows with and without counts receive one embed; the original stays unchanged and feedback remains 10px from the right edge |
| Native drag behavior | The 0.2.0 trusted native test reports `copy`; the current source/bundle permission and drop suites also pass |
| Feedback geometry | Plus and green check share a fixed right-edge slot independent of count presence or width |
| Feedback duration | Success clears while the mouse remains over the row; counts reappear and the drag preview is removed |
| Live sidebar UI check | A real styled row's count changes from visible `64` to hidden and back to visible `64`; right gap is 10px, plus/check centers match, and row geometry is unchanged; no graph writes |
| Build/static checks | Pass; bundle exports valid; no network calls or source move/update/delete calls |
| Whitespace validation | `git diff --check` passes |

The compiled bundle SHA256 is:

```text
6fa9f36ac66ae28efaa557384c1a49f0766d15b9f012475084fc093c6e63fbc2
```

The build reused an existing esbuild 0.27.2 executable through `ESBUILD_BIN`. No dependencies were installed. Machine-readable browser and mouse results remain in ignored `artifacts/`; [the sanitized sandbox comparison](../assets/sidebar-drop-sandbox.png) shows the edited-block preview and the green check.

## Additional regressions resolved during verification

- An edited block can emit a canceled native `dragstart`; that event must not disable the pointer fallback.
- Capturing `blur` on the window also sees textarea blur. Only an actual window blur cancels the gesture.
- Native `block-input-*` IDs end in a nine-character UID that may contain hyphens or underscores. Splitting on the final hyphen loses identity.
- Daily Notes freezes the accepted date before queueing; a preceding write crossing midnight cannot redirect the drop.
- Abort/dispose during DNP lookup stops before page creation. Already submitted SDK writes remain outside cancellation control.
- Foreign-origin or malformed shortcut links are rejected.
- Right-edge feedback covers counts without changing their data, styles, or layout space. Pending/success, live updates, new counts, leaving, Escape, window blur, context changes, and unload all have coverage.

## Independent Grok review

Grok 4.7 independently reviewed the five core source modules for 0.2.0 and reported no high-confidence actionable correctness defects. Its follow-up review confirmed that abort/dispose during DNP lookup throws before `page.create` is called. That reviewed runtime is included in `4d7265d`.

The 0.2.1 naming and right-edge presentation changes were subsequently verified through the updated automated suite, trusted mouse drags, and the live sidebar UI check described above. The earlier review explicitly retained the limit that a page or embed write already submitted to Roam cannot be canceled retroactively. Machine-readable execution evidence and the original review transcript remain local.

## Remaining compatibility work

- A separate live test graph for full write/render/synchronization acceptance across Roam desktop and web clients.
- Full coexistence testing with installed drag extensions. Modifier pass-through and event ownership are covered in the isolated fixture; this is not an exhaustive coexistence matrix.
- Concurrent devices/instances, interrupted synchronization, and read-only graph permission failures.
- Broader themes and very narrow sidebar widths.

Native DOM structure and `:user/desk-page` remain compatibility dependencies. Same-page capture rejection does not provide global cycle detection. Instance-local queues cannot enforce distributed uniqueness. Unloading cannot cancel SDK writes already submitted.

## Earlier evidence

The author-recorded GIF and static fallback in `assets/` demonstrate the Desk-only interaction from 0.1.3. They do not show today's DNP, starred destinations, or the revised feedback. Third-party demo content retains its owners' rights. The author-approved MIT license remains in effect.

A Draft source PR and an updated Depot source commit are review artifacts. Marketplace availability requires the upstream maintainer's merge.
