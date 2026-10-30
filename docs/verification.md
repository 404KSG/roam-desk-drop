# 0.2.2 verification

**Roam Drop 0.2.2** distinguishes newly added entries, content already on the destination, existing embeds, and real errors. It keeps the fixed far-right feedback slot, temporary count coverage, Daily Notes/Desk/starred destinations, and edited-block dragging. Depot PR [#1511](https://github.com/Roam-Research/roam-depot/pull/1511) remains **Draft**.

## Evidence boundaries

Automated write tests use the localhost in-memory SDK. Read-only inspection of the logged-in Roam client confirmed native sidebar selectors, shortcut page links, reference-count markup, and block identity attributes. No production graph was modified and no extension was installed there during this work.

The current client source's bullet drag-start handler bypasses native drag setup when editing state is active. The fixture models this condition with a textarea block and suppressed native setup; both synthetic pointer tests and trusted mouse tests are required for the fix.

## Reproduced baseline failures

Before implementation, the expanded capture suite had **23 failing checks out of 42**. The initial browser suite had **7 failing checks out of 18**, including starred destinations, today's DNP, the unchanged feedback slot, and edited-block pointer capture. A trusted mouse drag from the edited-block bullet to a starred row created no entry on the baseline, while preserving the editor value.

These counts refer to the initial 0.2.0 red suite. The 0.2.1 right-edge change reproduced **5 failures out of 27** before passing all 27. For 0.2.2, the outcome suite reproduced **4 failures out of 31** on 0.2.1: same-page drops appeared as errors, existing embeds lacked a distinct explanation, error reasons were not immediately visible, and contextual cleanup had no explanation to exercise. The revised implementation passes all 31. Local raw evidence is retained under ignored `artifacts/`; only sanitized aggregate evidence belongs in this repository.

## Acceptance coverage

The updated suites cover native embeds and unchanged source hierarchy; top insertion and per-page duplicates; missing/existing daily pages and conflicting identities; invalid targets; context switches and cancellation; uncertain write readback; edited-block pointers from main/right outlines; pointer/native exclusivity; modifier/multi-selection pass-through; success color, placement and timeout; count restoration; errors and pending announcements; and lifecycle cleanup.

## Completed checks

| Check | Result |
|---|---|
| Node tests | **56 passed**: capture, payload, source preservation, no-write same-page outcomes across all destination types, per-page deduplication, DNP identity/date, cancellation, and lifecycle |
| Browser source suite | **31 passed** |
| Browser bundle suite | **31 passed** |
| Browser bundle with reduced motion | **31 passed** |
| Trusted edited-block mouse drags | Today's source block returns an informational result; a repeated embed says Already added; both preserve the full graph snapshot; an unconfirmed write shows its reason |
| Native drag behavior | The 0.2.0 trusted native test reports `copy`; current source/bundle permission and drop suites pass |
| Feedback geometry | New-add, existing-content, and error icons keep the far-right slot; contextual explanations preserve row geometry |
| Feedback duration | New additions clear after 900ms, existing content after 1.8s; error explanations can be inspected again through focus/hover |
| Live sidebar UI check | A temporary UI-only preview confirms a neutral Already in today's note explanation, accessible tooltip association, viewport placement outside the sidebar clip, and a 10px right gap; no graph writes |
| Build/static checks | Pass; bundle exports valid; no network calls or source move/update/delete calls |
| Whitespace validation | `git diff --check` passes |

The compiled bundle SHA256 is:

```text
014f870e543b50c254e60ecd2be7df5ae6f8cf816cced51c02b3119c06017654
```

The build reused an existing esbuild 0.27.2 executable through `ESBUILD_BIN`. No dependencies were installed. Machine-readable browser and mouse results remain in ignored `artifacts/`. The [drag comparison](../assets/sidebar-drop-sandbox.png) shows hover and new-add feedback; the [outcome comparison](../assets/outcome-feedback-sandbox.png) shows same-page, duplicate, and unconfirmed-write explanations.

## Additional regressions resolved during verification

- An edited block can emit a canceled native `dragstart`; that event must not disable the pointer fallback.
- Capturing `blur` on the window also sees textarea blur. Only an actual window blur cancels the gesture.
- Native `block-input-*` IDs end in a nine-character UID that may contain hyphens or underscores. Splitting on the final hyphen loses identity.
- Daily Notes freezes the accepted date before queueing; a preceding write crossing midnight cannot redirect the drop.
- Abort/dispose during DNP lookup stops before page creation. Already submitted SDK writes remain outside cancellation control.
- Foreign-origin or malformed shortcut links are rejected.
- Right-edge feedback covers counts without changing their data, styles, or layout space. Pending/success, live updates, new counts, leaving, Escape, window blur, context changes, and unload all have coverage.
- A valid block already on the target page is acknowledged without a write, including Desk and today's DNP. It does not use an error warning.
- Existing embeds have a neutral circled check and immediate explanation. New additions alone use the green check.
- Error reasons are immediately visible and keyboard-accessible. Contextual explanations are removed on new drags, graph changes, scroll, Escape, and unload.

## Independent Grok review

Grok 4.7 independently reviewed the five core source modules for 0.2.0 and reported no high-confidence actionable correctness defects. Its follow-up review confirmed that abort/dispose during DNP lookup throws before `page.create` is called. That reviewed runtime is included in `4d7265d`.

The subsequent 0.2.1 presentation changes and 0.2.2 outcome classification and explanation changes were verified through the updated automated suite, trusted mouse drags, and UI-only live sidebar previews. The earlier review explicitly retained the limit that a page or embed write already submitted to Roam cannot be canceled retroactively. Machine-readable execution evidence and the original review transcript remain local.

## Remaining compatibility work

- A separate live test graph for full write/render/synchronization acceptance across Roam desktop and web clients.
- Full coexistence testing with installed drag extensions. Modifier pass-through and event ownership are covered in the isolated fixture; this is not an exhaustive coexistence matrix.
- Concurrent devices/instances, interrupted synchronization, and read-only graph permission failures.
- Broader themes and very narrow sidebar widths.

Native DOM structure and `:user/desk-page` remain compatibility dependencies. Avoiding same-page embeds does not provide global cycle detection. Instance-local queues cannot enforce distributed uniqueness. Unloading cannot cancel SDK writes already submitted.

## Earlier evidence

The author-recorded GIF and static fallback in `assets/` demonstrate the Desk-only interaction from 0.1.3. They do not show today's DNP, starred destinations, or the revised feedback. Third-party demo content retains its owners' rights. The author-approved MIT license remains in effect.

A Draft source PR and an updated Depot source commit are review artifacts. Marketplace availability requires the upstream maintainer's merge.
