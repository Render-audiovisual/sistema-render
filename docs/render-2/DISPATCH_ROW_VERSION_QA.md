# Integration79 — version every future dispatch-row write

## Scope and decision

Coordinator: migration, actual principal HTTP/PostgreSQL QA and integration. Hypatia: four source/DDL contract tests. Beauvoir: independent source review. Carson: readonly inventory for the next canonical client/objective session-adoption batch. No concurrent shared-file edits.

Inspection did not find an active API that reassigns publicaciones.cliente_id; the previously recorded reassignment race is a future/external-writer boundary, not a confirmed current API bypass. A concrete defect was confirmed instead: deleting a publication through DELETE or calendar reconciliation invokes the existing FK SET NULL on publicacion_envios without advancing updated_at. A client could hold an apparently current CAS snapshot after the linkage changed.

071 installs a BEFORE UPDATE row trigger that computes GREATEST(clock_timestamp(), OLD.updated_at +1 microsecond). It intentionally versions every update, including no-ops, matching the conservative existing note-version pattern. It ignores caller timestamps, preserves opaque six-digit API precision and covers FK-generated updates. No historical rows are rewritten; no FK, deletion semantics, publication evidence, role or outbound-provider behavior changes.

## Evidence and reproduction

Run from backend with an authorized disposable loopback PostgreSQL fixture:

```
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-dispatch-revision-writers.integration.test.js test/render2-dispatch-persistence.integration.test.js test/render2-stories.integration.test.js
node --test test/*.test.js
```

Physical cases: installation over populated rows preserves exact records/revision; direct row writer with a backdated timestamp advances revision; stale PATCH409 leaves data unchanged; POST replay after mutation returns DISPATCH_REPLAY_CHANGED; parent API deletion preserves material/target rows but invalidates CAS; explicit refreshed unlinked save succeeds; future timestamp/no-op progresses by exactly1us; two updates within one transaction produce distinct versions; rejected FK statement rolls back version too; calendar reconciliation's removal of an unused automatic slot also invalidates the dispatch snapshot. Existing two-editor and BIGSERIAL tests remain active. Fixture-only trigger suspension seeds historical future timestamps, is restored with finally before APIs, and is never a rollout instruction.

Initial sandbox initdb could not allocate shared memory; no application assertion ran there. Approved loopback retry ran physically. Initial regression exposed a synthetic timestamp seeding assumption from before071; preparation was updated, not the precision assertions. Initial new replay test expected MISMATCH but the established correct code for an edited original receipt is CHANGED; expectation corrected. These failed attempts are not counted as final passes.

Final isolated sequential suites:18 passed, zero failed/skipped, with generated-root absence asserted by each cleanup. Backend discovery:1385 passed,59 explicit opt-in skips, zero failed; four new DDL tests included. Logs `/private/tmp/render2-dispatch79-http-final.log` and `/private/tmp/render2-dispatch79-backend.log`. Independent frozen review found no confirmed P1/P2 in this bounded delta.

## Boundaries and rollout

No frontend/CSS change: no fresh browser or build claim for this backend-only batch. This trigger versions the dispatch parent row, not independent direct SQL mutations of child materials/targets. Current endpoints already update the parent inside the same transaction. It does not enforce publication/client composite identity against future/external reassignments. created_at tampering by privileged SQL and trigger bypass remain outside the application contract. No automatic backfill/reconciliation/retry, provider publication or historical evidence promotion.

Migration applied only to disposable fresh test clusters and simulated populated upgrade there. Deployment requires the existing explicit identity/plan-hash migration approval on a known nonproduction target, operational review and production authorization. No configured database, real records/accounts, provider, push or deployment used. Full master objective remains active.
