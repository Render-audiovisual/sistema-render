# Integration145 — coherent scheduled editorial agenda

## Defect and scope

Previous144 diagnostic is verified evidence, not an application drag fix.
Tracked tree clean at145 start. Main moved to independent editorial work,
Beauvoir reviewed semantics and implementation, Hypatia authored ten new
pure/actual-memo/SSR regressions in a disjoint file. Structured workflow
separates scheduled agenda from publication evidence and monthly quota credit.

Calendar today/tomorrow previously used type-filtered rows, while month and
week used all rows. The alleged week counted today through today+7 inclusive,
eight dates. This could show a Reel-only calendar with Carrusels still in
the month/week totals. Labels also implied publication instead of planning.

## Local implementation

- All four metrics use one helper and the actual visible type-filtered cohort.
- Month bucket uses selected scheduled month. Today/tomorrow and next-seven
  buckets are explicitly relative to today, independent of selected month.
- Seven dates exactly: today through today+6, UTC arithmetic over calendar
  strings, without DST shifts. Impossible dates/IDs are ignored, duplicate
  positive IDs count once, original rows and arrays remain unchanged.
- Labels: Planificadas del mes, Agenda de hoy, Agenda de mañana, Próximos7días.
  Accessible description explicitly says these are not publication evidence.
- Existing client confirmation counter now explicitly names scheduled cohort;
  its query/credit semantics are not changed into actual-month publication.
- No changes to publishing actions, approval permissions, task transitions,
  evidence, goal quotas, backend, schema, environment or dependencies.

## Automated and runtime evidence

Full frontend2046passed/0failed/0skipped:
`/private/tmp/render2-editorial145-frontend-final.log`.
Ten new regressions cover exact7date boundary, year/leap rollover, invalid
inputs, deduplication, no mutation/actual-evidence inference, actual filtered
memo/dependencies and actual summary JSX rendered with real helper.
Three explicit pure backend files (editorial-evidence-dto,
editorial-publication-boundaries, task-workflow):12passed; no physical backend
workflow rerun claimed. Log `render2-editorial145-backend-contract.log`.
Build passes, `index-BEA3BVvm.js`; initial and final browser-tested build
identical despite removal of unused source import.

Fresh fixture0dXRXl PostgreSQL55796/HTTP52782, owner cookie login, four SQL-
seeded synthetic pieces: video+carousel today2026-10-23, videos on29and30.
Actual calendar all-types counts4/2/0/3 (month/today/tomorrow/seven); Reels
filter3/1/0/2. Day30 is eighth date and remains excluded from rolling bucket.
Next-month navigation changes month to0 while today1/seven2 remain visibly
relative to today with Reels selected. Mobile390x844 preserves those values;
documentwidth=scrollwidth390. This verifies this viewport, not physical iOS.
Images `render2-editorial145-desktop.jpg` and `render2-editorial145-mobile.jpg`
under `/private/tmp`. No claim of type-filter persistence across reload.

## Safety and remaining gates

Initial permission-review timeout did not start a process or create a log;
one retry started the sole145 fixture. Final SQL preserves four pending
pieces with null actual dates and zero publication events. Browser actions
were read-only after seed. Exit0, cleanup marker/root absence confirmed;
tab124 closed and viewport reset. Only own disposable data/cluster removed.
Log `/private/tmp/render2-editorial145-native.log`.

Desktop screenshot also shows preexisting crowded calendar toolbar near its
right edge; no all-design acceptance claimed. Native drag cancellation144,
broader approval/account/device/concurrency matrix, design consolidation,
provider onboarding and full release audit remain. No configured/commercial
DB, external provider account, production write, push or deploy. This P2 is
implemented and verified locally; Render2 master goal remains active.
