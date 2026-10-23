# Integration142 — shared Tasks filter controls

Local development only. Previous accepted commit: `23df4a5`. No backend,
schema, environment, dependency, operational data or production changes.

## Ownership and implementation

- Main: Tasks JSX, responsible/manual-order compatibility tests, integration and browser QA.
- Poincare: existing WorkspaceReadOnly/TaskHeader CSS, removing obsolete filter presentation only.
- Hypatia: five new AST/SSR/CSS regressions, including every unchanged raw task selector.
- Beauvoir: remaining Apple-layer exclusions and narrow visual fingerprint compatibility.

Seven controls now use the existing FilterSelect: order, state, area,
responsible, client, sector and priority. All original options, values,
callbacks, invalid placeholders and disabled states remain. The twelve raw
detail/create/card selectors are unchanged. Shared controls own typography,
height, arrow spacing and focus; filter grid, buttons, ordering layout,
card state styles and motion remain in their existing layers. The design
skills guided reuse of the established light tokens and 44px controls,
not a new theme or parallel application.

The visual guard projects only the reviewed migrated-control declarations
and exact selector exclusions. Baselines were computed from pre-change HEAD
with the same projection once; tests do not consult Git. Identity hashes and
unrelated layout/motion guards remain. No new CSS layer or important flags.

## Verification

- Full frontend: 2,036 passed, zero failed/skipped.
  `/private/tmp/render2-taskfilters142-final.log`
- Explicit pure backend files: report-access, task-workflow,
  task-workflow-contract and report-ui-contract: 52 passed.
  `/private/tmp/render2-taskfilters142-contracts.log`
- Build passed: `index-6JKbWIRt.js`.
  `/private/tmp/render2-taskfilters142-build.log`
- Browser cookie login on synthetic owner account, actual compiled app,
  fresh fixture PostgreSQL55795/HTTP52781. Three API-seeded tasks.
  Responsible ID91003 selects only QA142 Video. Mobile reload preserves
  `responsible=id:91003`; filters expand and show the same selected ID.
  Adding low priority yields the expected empty intersection. Clear resets
  all controls; return of all rows was not awaited and is not claimed here.
- Desktop1280: all seven selects14px/44px, 36px right padding and arrow12px
  inward. Mobile390x844: all seven16px/44px; available document width375
  equals scroll width375. This is not physical iPhone acceptance. Mobile
  full-page image still shows existing sticky header/title interaction;
  global mobile design acceptance remains open.
- Screenshots: `/private/tmp/render2-taskfilters142-desktop.jpg` and
  `/private/tmp/render2-taskfilters142-mobile.jpg`.
- Final SQL preserves three tasks at revision1/pendiente, original priorities
  and assignments. Browser actions did not mutate business records.

## Cleanup and limits

The first fixture started before build completion and cached the prior index;
it was stopped and cleaned before the final fixture. Its teardown diagnostic
query used a nonexistent assignment column, producing exit1 after successful
cleanup. Corrected the temporary script, not application code. Final fixture
DPY709 exited0 with correct SQL snapshot and cleanup marker; tab121 closed,
viewport reset. No configured database, real provider account, production
write, push or deploy. Only own disposable fixture data was removed.

Global unification, native same-column manual ordering, full mobile/role/
concurrency/draft coverage, provider validation and authorized rollout gates
remain. This change is locally implemented and verified within this scope;
it does not certify Render2 as complete or ready for production.
