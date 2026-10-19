# Stable task assignment HTTP QA

Status: latest main-authorized isolated run on 2026-10-19 with migration 057: **15 passed, 0 failed, 0 skipped** (14 assertion groups plus parent). Integer-revision, stale-approval and automatic piece-task binding regressions executed successfully. Owned files are only this document and `backend/test/render2-assignments.integration.test.js`. No application, migration or harness edits by this QA task.

## Isolation and execution

Uses the existing guarded principal harness with a brand-new disposable `render2_local_test` cluster under `/private/tmp`, PostgreSQL bound to `127.0.0.1:55595` (separate from Phase 1's 55594). The principal HTTP listener is an ephemeral loopback port. Sanitized child environment, disabled default server start/schedulers, absent external credentials and external-fetch rejection remain inherited from the harness. No existing DB, production server or external service is used. Cleanup runs through `t.after`, including assertion failures.

After main says ready, from repository root:

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-assignments.integration.test.js
```

Without the opt-in, the test skips before provisioning. The suite timeout is 150 seconds; HTTP, SQL, startup and shutdown timeouts come from the guarded harness.

## Assertions

- Real password logins for admin, owner, collaborator and same-name impostor. Owner 92001 and impostor 92002 have identical display names but distinct usernames/IDs; collaborator 92003 is separate; 92004 is inactive; active 92005 is reserved for an intentional SQL failure. Fixture password hashes are copied only within the disposable DB from the harness fixture.
- POST by IDs persists normalized owner/collaborator bindings. Create, list, detail, PATCH and subtask responses expose `asignado_a_id` and `colaborador_ids`; multiple list rows check batch annotation output.
- Real admin POST `/piezas` for historia, carrusel and video uses `responsable_id` while two accounts still have the exact same display name. Each creates exactly one linked task with the selected normalized owner ID; the owner's real HTTP edit succeeds and the homonym's fails. For each format, nonexistent and inactive IDs return 400 with unchanged historias/publicaciones/tareas/asignaciones counts. This checks invalid-recipient rejection, not an injected post-insert failure of the piece transaction. Legacy production auto-task writers are not exercised.
- Both owner and collaborator can edit; same-name impostor cannot. Unauthenticated list/detail/create/PATCH is rejected. RENDER OS authenticated shared read is intentionally not treated as an ownership denial.
- Rename through the real admin user API, relogin after session-version invalidation, then prove old label no longer matters: ID-bound editing persists.
- Assignment PATCH without version fields returns 400. Stale version returns 409. Whole-task and normalized-row snapshots remain unchanged, including labels/metadata/title and timestamps.
- Revision follow-up: each PATCH helper fetches detail once and sends the matching `expected_revision` and legacy `expected_updated_at`; all annotated DTOs must expose a positive integer revision. A current timestamp plus stale integer revision must return 409, and rollback snapshots include the integer revision itself. Requests with no version fields still expect 400.
- Exact-timestamp regression: observe task revision/timestamp, directly UPDATE its title with `updated_at=updated_at`, assert revision increments by one while the returned timestamp is identical, then submit the old ownership revision/timestamp. HTTP 409 must leave the full task and bindings unchanged.
- A fixture-only BEFORE INSERT trigger on `tarea_asignaciones` raises for sentinel ID 92005 after the base task UPDATE. HTTP must return 500 and snapshots must show the base task and all deleted/replaced bindings rolled back. Trigger/function cleanup is in nested `finally` blocks; a subsequent owner edit succeeds. The expected `QA sentinel assignment failure` server log is deliberate, not a failed assertion.
- Inactive owner/collaborator IDs return 400. Real foreign keys reject nonexistent task/user IDs; snapshots remain unchanged.
- Remove collaborator, deliberately retain its old name in legacy JSON, then prove its next edit is denied and the owner still works. This catches name-based ACL fallback.
- Legacy name-only tasks remain unbound and uneditable by matching non-admin names, until an explicit admin ID binding grants access.
- Real `EXPLAIN (FORMAT JSON)` for ID ACL and batched annotation verifies planner/type compatibility. Does **not** claim index usage or representative performance from tiny fixture data, nor instrument HTTP query counts.
- Actual approval POST rejects non-admin/inactive-publisher requests without mutation, then selects publisher 91002 by `responsable_publicacion_id`. Response/detail show the new normalized owner, original editor and collaborator retained, and verified approver/editor/publisher IDs in metadata. Publisher, editor and collaborator edits work; the impostor remains denied; repeat approval returns 409.
- Approval helper sends revision and timestamp from one detail response. A separate test observes an approval revision, removes the collaborator through HTTP, then restores the old visible timestamp using fixture SQL while retaining the newer revision and `en_revision` state. Submitting the old approval revision returns 409 with identical task/binding snapshots and continued denial of the removed collaborator. Verified with 057.

## Real 056 upgrade proof

The main-owned harness now supports `deferAssignmentMigration:true`; the suite explicitly enables it on 55595. Before any assignment API/table usage it verifies the relation and 056 ledger entry are absent, creates legacy parent/child tasks with name-only assignments, a published editorial row with real historical date, goal/slot/event history, then snapshots every row in usuarios, clientes, tareas, historias, publicaciones and all three goal tables. It executes the unchanged `056_task_assignments.sql`, proves snapshots identical and `tarea_asignaciones` empty, and inserts only the real 056 migration ledger entry after successful assertions. It neither reruns 055 nor drops/recreates tables. This replaces the earlier missing-proof skip with an executed passing upgrade test.

Legacy production auto-task helpers remain outside this suite's scope.

## Latest verified results

All principal baseline migrations through `057_task_revision.sql` applied successfully to the new fixture (056 deliberately deferred and applied during its upgrade-invariance subtest). Actual HTTP assertions passed for owner/collaborator binding, duplicate display names with distinct accounts, impostor denial, rename/relogin, annotated create/list/detail/PATCH/subtasks, next-edit revocation despite legacy JSON, explicit legacy binding, inactive users and missing/stale-version rollback. Actual SQL foreign-key rejection preserved the task/assignment snapshots. Query planner accepted both SQL patterns: ACL root `Nested Loop`, batch root `Sort`. These are compatibility observations, not an assertion of production index/performance behavior.

Forward-upgrade invariance, post-base-UPDATE SQL rollback (including revision), publisher-ID handoff, exact-timestamp stale ownership rejection, stale approval after collaborator revocation and `/piezas` generated-task ID ownership all passed. Other concurrently running harness fixtures are not owned, inspected or removed by this test. No existing DB or external service was used. Syntax and whitespace checks passed. The production visit writer remains outside this suite and no per-video Phase 2 completeness claim is made.

Final regression after main's active-ID revalidation/`FOR SHARE` transaction change: ran this assignment suite and the original `render2-phase1.integration.test.js` together. **17 passed, 0 failed, 0 skipped** (assignments 15, original Phase 1 2). No application or test-contract changes were needed. The expected injected sentinel SQL error remains intentional. Both suites' fixture cleanup completed; assignment cleanup explicitly verified `/private/tmp/render2-local-mNuPGl` absent, and neither owned test port 55594 nor 55595 had a remaining listener. This does not claim a global absence of other clusters or directly stress-test the deactivation race itself.
