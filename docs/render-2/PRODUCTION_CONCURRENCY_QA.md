# Specialized production concurrency: isolated principal HTTP QA

Status: latest authorized isolated run against READY hooks/helper: **10 passed, 0 failed, 0 skipped** (9 assertion groups plus parent). Owns only this document and `backend/test/render2-production-concurrency.integration.test.js`; no application, harness or schema edits.

## Run / isolation

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-production-concurrency.integration.test.js
```

Fresh guarded fixture only, PostgreSQL loopback port 55599 and ephemeral loopback principal HTTP. No existing database, inherited secrets, real integration credentials, normal backend startup, schedulers or external requests. An ephemeral RSA keypair is generated only inside the opt-in test; its public key is injected through the allowlisted harness Wilson configuration, its private key remains in process memory, and a synthetic WhatsApp actor is linked to the fixture admin. Defaults skip before provisioning; 150s suite timeout plus bounded harness/HTTP/SQL/shutdown timeouts. `t.after` cleans only its own exact cluster and asserts its directory is absent. Never scan-and-stop other clusters.

## Assertions

- Real owner, collaborator, homonym and admin logins; owner/impostor have the same display name but distinct IDs. Explicit synthetic editor ID is configured in the fixture. All writes use the actual principal production endpoints.
- Two concurrent adds with one expected revision: exactly one 201 and one 409; revision increments once, prior record remains identical and no JSON record is lost.
- Two concurrent corrections with one revision: exactly one 200 and one 409; winner persists and unrelated records retain every original field. The shared helper's intentional derived monthly allocations are verified separately, rather than incorrectly requiring absent derived keys to stay absent.
- Removed collaborator and same-name impostor cannot add/correct even with the collaborator's old name retained in legacy JSON. Full tasks/bindings snapshots remain unchanged.
- Missing, noninteger, nonpositive, string, object and unsafe revisions return 400 on all three specialized endpoints, with no writes.
- Stale confirmation returns 409 without an editing task. Successful confirmation increments revision, exposes stable IDs and creates exactly one aggregate editing task bound to the configured editor. Stale/fresh retries cannot duplicate it.
- Correcting a confirmed complete visit below its target clears completion/confirmation and returns it to progress; reconfirmation is blocked until actual completion, then preserves the single aggregate editing task.
- An ID-assigned designer cannot correct/reopen a finalized visit (403, identical task/binding snapshots). The Production owner can correct it, clearing verified approval fields and finalization date. Admin correction also clears an existing legacy review-state approval flag prepared by fixture INSERT without disabling any UPDATE guard.
- A fixture-only BEFORE INSERT trigger raises for the target aggregate editing task. HTTP 500 must roll back confirmation metadata, visit revision, task creation and bindings together. Trigger/function are dropped in nested `finally`; retry with the same revision must work.
- Actual v2/full-target RSA-signed WhatsApp confirmation obtains a real token through `/confirmaciones`. A fixture audit trigger raises on `confirmar_grabacion` after the production callback writes. HTTP 500 must leave `used_at` NULL and all token/task/revision/binding/audit snapshots unchanged. After dropping the trigger/function, the same token and revision commit exactly once, producing one ID-bound aggregate task and one audit record; reuse returns 409 without additional writes.

This scope proves direct principal HTTP CAS/ACL, aggregate handoff atomicity and the exercised signed Wilson confirmation-token/callback/audit shared transaction. It does not prove per-video tasks, the unimplemented per-video workflow, frontend behavior or every production writer. Both deliberately injected SQL errors are expected server log output, not test failures when rollback assertions pass.

## Results

Actual HTTP races produced exactly one accepted write and one 409 for both add and correction. Revision increments, winning JSON, append preservation, identity ACL, invalid-version rejection, stale/duplicate confirmation, configured editor binding, partial-correction reset/reconfirmation and injected aggregate-editing rollback all passed. The injected `QA aggregate editing insert failure` error is deliberate; retry after removing the fixture trigger succeeded.

Initial correction assertion incorrectly required the untouched record's whole JSON to remain identical, including absent derived allocation fields. After coordinator clarification, the test preserves every original field and separately verifies recomputed monthly allocations; original append JSON remains strictly identical. No single-winner, identity, quantity or rollback assertion was relaxed.

Latest extended run: **10/10 passed**, including the finalized-visit role/approval regression and actual signed Wilson audit-failure rollback/same-token retry. The cleanup hook stopped the exact own fixture and asserted `/private/tmp/render2-local-rXrBl6` no longer exists. Port 55599 had no remaining listener. Other fixtures/clusters were untouched; no production DB or external integration was used. Syntax/whitespace checks passed. Per-video workflow remains outside this suite's evidence.
