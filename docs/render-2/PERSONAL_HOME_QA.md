# Principal personal home HTTP QA

Status: **PASS — actual coordinator eight-test run reported; QA files frozen**. `PERSONAL_HOME_CONTRACT.md` read completely. Owned files only: `backend/test/render2-personal-home.integration.test.js` and this document. No app/module/schema/harness edits or new migration. No fixture/server started by author.

Main executed the exact principal home suite: **8 passed, 0 failed, 0 skipped** (seven subtests plus parent), then the combined thirteen-suite regression: **151 passed, 0 failed, 0 skipped**. Coordinator confirmed owned fixture cleanup, including `/private/tmp/render2-local-zyJ9Fc` and final home fixture `/private/tmp/render2-local-eZlFYL`. This is attributed coordinator HTTP/SQL evidence, not an author execution.

Separate coordinator browser evidence: synthetic employee login landed on Inicio, opened task1, sent it to review, returned/reloaded and observed review count1→2. Mobile menu Inicio/Actualizar worked; viewport/document width both390px. Main inspected screenshots and saved `/private/tmp/render2-personal-home-desktop.png` and `/private/tmp/render2-personal-home-mobile.png`. Coordinator closed the browser, reset viewport and confirmed separate interactive fixture `/private/tmp/render2-local-jXNgyz` cleaned. These UI checks are separate from fixture55607 and do not imply complete frontend race/accessibility verification.

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-personal-home.integration.test.js
```

Exact file, explicit opt-in, fresh guarded principal PostgreSQL **55607**, `clusterOnly:true` followed by tracked `launchActual({entry:'server'})` at loopback PORT0. Wait for completed frontend build (`frontend/dist/index.html`) before coordinator run. Fixture-only role timezone is deliberately chosen so its current day differs from Córdoba; app connections inherit it. Home must still use the explicit Córdoba calendar. No .env, existing DB, real account, inherited integration credentials, scheduled jobs, outbound service, ordinary configured server or production write.

## Coordinator-verified checks: seven subtests + parent = eight tests

- Real logins for two homonymous employees (104001/104002), collaborator 104003 and separate admin. Normalize membership only through ID table. Duplicate collaborator input is deduplicated; same-name and unmapped legacy labels confer no access. Independent JS model reads physical fixture rows/memberships, not the home SQL/helper, and checks exact summary counts, task ordering, client aggregates, review scopes and list totals.
- Populate more than 12 open tasks, eight clients/visits/activity rows and eight team reviews. All five list bounds asserted; no duplicate task/visit IDs; repeat HTTP reads have deterministic lists/totals. Task/review state projection and hrefs are explicit. Clientless work remains visible. Closed finalizada/publicada remain excluded from open totals but included in current-task activity.
- Admin personal counts stay at its single assigned task and one personal visit, while team review is independently bounded with exact team total. Employee review is assigned work only, never team expansion.
- Conflicting actual DB timezone versus generated_at Córdoba day. Date boundaries: overdue, today, +1, +7 inclusive upcoming, +8 outside summary window, undated and historical programada kept open. Legacy en_revision + JSON revision_aprobada true projects aprobada, not review, without rewriting the original row/flag.
- Exclude non-RenderOS/private/missing workspace, archive/trash boolean/string flags and inactive clients. Visits today..+7 use participant/source/edit-task ID paths and deduplicate OR matches. Inactive-client and outside-range visits absent. Both participant and editing-assignment branches reject visits with existing private/archived/trashed source; sourceless visits remain allowed. No admin agency-wide visit grant.
- Actual principal HTTP POST creates task with repeated collaborator IDs; actual PATCH changes date/state, then reassigns by ID/removes collaborators. Repeated GET and fresh login show current membership/counts. Editorial rows remain unchanged; task review is not publication. These authored API assertions are distinct from the coordinator's browser journey above.
- No token →401; all query selectors/limit/date params →400; current unsupported role →403; actual access deactivation and logout revocation →401, per coordinator clarification matching existing current-identity middleware. Fresh login recovers normal current home.
- Twelve concurrent real SQL-error responses after a fixture-only assignment-column rename must be safe JSON500, no stuck idle transaction. Restore column in finally; home immediately recovers. More requests than the default app pool limit exercise release rather than merely proving one error returns.

Every top-level/nested task/review/client/visit/activity/user/capability DTO key is allowlisted. Synthetic financial scalar/JSON bags, object under scalar, private descriptions and visit/video scripts are never returned, including admin home. A real nonempty fixture finance row prevents empty-source privacy claims. Generated timestamp/day, positive task revisions and real navigation anchors are verified.

PostgreSQL statement logging on new app connections proves actual BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY and no operational DML/DDL attempts during repeated home reads. Full principal data snapshots remain identical across read groups. Logs stay inside the own temporary root, not printed. Fixture preparation and explicit POST/PATCH/auth actions are intentionally outside the read-only observation window.

## Bounds / pending evidence

Syntax/default skip are separate from attributed coordinator actual HTTP/SQL verification above. Parent 180s, request5s, harness statement/query/start/stop bounds apply. All actual child processes tracked by cleanup; own cluster/root absence asserted, no foreign/global cleanup. Only synthetic fixture schema is temporarily renamed for fault injection and restored in finally.

The authored suite verifies backend HTTP/SQL; coordinator's separately attributed browser smoke is recorded above. Modifier-click behavior, full accessibility, abort/race handling in React and production readiness are not certified. Existing unrelated work is not edited. Role timezone/logging changes exist only in this newly generated disposable cluster. No clock is mocked: an execution spanning Córdoba midnight would require a fresh fixture run rather than changing product expectations. Coordinator owns actual run/regression and browser evidence. No new execution was performed for this documentation update.
