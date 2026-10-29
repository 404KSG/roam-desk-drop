# 0.2.0 verification

Desk Drop 0.2 expands sidebar collection to Daily Notes and starred pages, removes inline Undo, and adds edited-block dragging. Depot PR [#1511](https://github.com/Roam-Research/roam-depot/pull/1511) remains **Draft**.

## Evidence boundaries

Automated write tests use the localhost in-memory SDK. Read-only inspection of the logged-in Roam client confirmed native sidebar selectors, shortcut page links, reference-count markup, and block identity attributes. No production graph was modified and no extension was installed there during this work.

The current client source's bullet drag-start handler bypasses native drag setup when editing state is active. The fixture models this condition with a textarea block and suppressed native setup; both synthetic pointer tests and trusted mouse tests are required for the fix.

## Reproduced baseline failures

Before implementation, the expanded capture suite had **23 failing checks out of 42**. The initial browser suite had **7 failing checks out of 18**, including starred destinations, today's DNP, the unchanged feedback slot, and edited-block pointer capture. A trusted mouse drag from the edited-block bullet to a starred row created no entry on the baseline, while preserving the editor value.

These counts refer to the initial red suite. Additional regression cases were added afterward. Local raw evidence is retained under ignored `artifacts/`; only sanitized aggregate evidence belongs in this repository.

## Acceptance coverage

The updated suites cover native embeds and unchanged source hierarchy; top insertion and per-page duplicates; missing/existing daily pages and conflicting identities; invalid targets; context switches and cancellation; uncertain write readback; edited-block pointers from main/right outlines; pointer/native exclusivity; modifier/multi-selection pass-through; success color, placement and timeout; count restoration; errors and pending announcements; and lifecycle cleanup.

## Completed checks

| Check | Result |
|---|---|
| Node tests | **53 passed**: capture, payload, source preservation, per-page deduplication, DNP identity/date, cancellation, and lifecycle |
| Browser source suite | **24 passed** |
| Browser bundle suite | **24 passed** |
| Browser bundle with reduced motion | **24 passed** |
| Trusted edited-block mouse drags | Desk, Daily Notes, and starred page each receive exactly one native embed; source text stays unchanged |
| Trusted native mouse drag | Ordinary block creates exactly one Desk embed; drop and drag-end report `copy` |
| Feedback geometry | Plus and green check have identical center coordinates for all three target types |
| Feedback duration | Success clears while the mouse remains over the row; drag preview is removed on release |
| Build/static checks | Pass; bundle exports valid; no network calls or source move/update/delete calls |
| Whitespace validation | `git diff --check` passes |

The compiled bundle SHA256 is:

```text
fa2f5c1c4216525f185a8d324c7694489c9078e4cccb7305a4df481ccb10d702
```

The build reused an existing esbuild 0.27.2 executable through `ESBUILD_BIN`. No dependencies were installed. Machine-readable browser and mouse results remain in ignored `artifacts/`; [the sanitized sandbox comparison](../assets/sidebar-drop-sandbox.png) shows the edited-block preview and the green check.

## Additional regressions resolved during verification

- An edited block can emit a canceled native `dragstart`; that event must not disable the pointer fallback.
- Capturing `blur` on the window also sees textarea blur. Only an actual window blur cancels the gesture.
- Native `block-input-*` IDs end in a nine-character UID that may contain hyphens or underscores. Splitting on the final hyphen loses identity.
- Daily Notes freezes the accepted date before queueing; a preceding write crossing midnight cannot redirect the drop.
- Abort/dispose during DNP lookup stops before page creation. Already submitted SDK writes remain outside cancellation control.
- Foreign-origin or malformed shortcut links are rejected.

## Independent Grok review

Grok 4.7 independently reviewed the five core source modules with read-only tools and reported no high-confidence actionable correctness defects. Its follow-up review confirmed that abort/dispose during DNP lookup throws before `page.create` is called. The reviewed runtime is included in `4d7265d`; the bundle hash above is unchanged by this documentation update.

This was source review, not a second execution of the browser suite. The reviewer explicitly retained the limit that a page or embed write already submitted to Roam cannot be canceled retroactively. Machine-readable execution evidence and the original review transcript remain local; the Draft source PR records this review disposition.

## Remaining compatibility work

- A separate live test graph for full write/render/synchronization acceptance across Roam desktop and web clients.
- Full coexistence testing with installed drag extensions. Modifier pass-through and event ownership are covered in the isolated fixture; this is not an exhaustive coexistence matrix.
- Concurrent devices/instances, interrupted synchronization, and read-only graph permission failures.
- Broader themes and very narrow sidebar widths.

Native DOM structure and `:user/desk-page` remain compatibility dependencies. Same-page capture rejection does not provide global cycle detection. Instance-local queues cannot enforce distributed uniqueness. Unloading cannot cancel SDK writes already submitted.

## Earlier evidence

The author-recorded GIF and static fallback in `assets/` demonstrate the Desk-only interaction from 0.1.3. They do not show today's DNP, starred destinations, or the revised feedback. Third-party demo content retains its owners' rights. The author-approved MIT license remains in effect.

A Draft source PR and an updated Depot source commit are review artifacts. Marketplace availability requires the upstream maintainer's merge.
