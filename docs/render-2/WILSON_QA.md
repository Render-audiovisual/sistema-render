# Wilson stable external identity: isolated HTTP QA

Status: **latest authorized run passed: 12 tests, 0 failures, 0 skips** (11 assertion groups plus parent), after the main/agent P1 fix. Earlier write regressions are now resolved without relaxing assertions. Owned files only: `backend/test/render2-wilson-access.integration.test.js` and this document. No harness, application or migration edits.

## Isolation

The existing guarded principal harness starts a fresh disposable PostgreSQL fixture on `127.0.0.1:55596`, and an ephemeral loopback HTTP listener. Existing DB URLs/secrets are not inherited; default backend startup/schedulers are disabled and external fetch is rejected. A fresh RSA-2048 keypair is generated only inside the opt-in test. Only its public key enters the server through the coordinator's strictly allowlisted `wilson` option; the private key stays in test-process memory. All actors, groups, task data and bindings are synthetic. No real WhatsApp/Telegram account or network service is contacted.

The test implements v2 canonical-JSON signing independently, with a fresh nonce and current timestamp per HTTP request. It signs the full request target (pathname plus exact encoded query string), matching the required `req.originalUrl` verifier contract. Query tampering after signature generation must return 401; both channels must reject version 1 and an empty/missing version. WhatsApp mutation confirmation tokens are obtained via actual signed HTTP, not inserted directly into confirmation tables. Telegram edits use the existing explicit confirmation body contract.

## Run only after readiness

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-wilson-access.integration.test.js
```

Without the opt-in, the suite skips before creating keys or PostgreSQL. Suite timeout: 150 seconds; signed HTTP timeout: 5 seconds. The harness supplies bounded startup, SQL and shutdown timeouts. Cleanup stops only the exact fixture created by this test and asserts its own directory is gone; never remove other fixture directories or stop clusters by a global scan.

## Coverage prepared

- Actual ephemeral RSA signatures accepted; invalid signatures rejected.
- Exact query-bearing v2 signatures accepted on both channels; changing only the query after signing rejected. Version 1 or empty version is rejected instead of falling back to the legacy signature protocol.
- Distinct active users 94001/94002 share one exact display name. Only the normalized owner ID can detail/list/write/review the target; the homonym can still see its own separate task.
- Allowed WhatsApp group membership does not bypass task IDs or lack of linked identity. Signed actor display names deliberately impersonate a leader but must not grant authority.
- Signed `/supervisor/contexto` stays available to employees, includes ID-owned tasks and excludes the homonym's task; a revoked collaborator cannot regain context access from legacy JSON. Employee `/supervisor/tick` remains denied as system-only.
- Disabled/inactive WhatsApp links are denied. A single synthetic actor is deliberately linked across both supported DB link sources to two different active users; ambiguity must fail closed without dropping UNIQUE indexes.
- Removing a normalized collaborator leaves its old JSON name intact. Detail/edit/review preview must deny it. A review token issued before removal must not let it confirm afterward, even when task timestamps/state did not change.
- Real owner review preview and confirmation perform the intended `en_revision` transition.
- An allowlisted Telegram actor with an owner-looking signed name but no explicit JSON binding is denied: `WILSON_ALLOWED_TELEGRAM_IDS` is never identity proof. Explicit actor-to-user-ID binding permits only current ID-owned detail/list/write.
- WhatsApp and Telegram admin authority is reloaded from current DB role: downgrade immediately removes access without relying on header name or historical default leader identities.
- Rename follow-up passed: change the owner's current DB display name while keeping the historical task label, then detail/PATCH through the same WhatsApp and Telegram identity bindings. Owner ID remains unchanged; the old-name impostor still cannot edit. Signed display labels are deliberately stale.

The task fixtures and identity links are created directly in the guarded disposable DB to isolate external-identity ACL testing from the separate task-creation UI/assignment tests. This is not coverage of every Wilson endpoint, delivery worker, external transport, production visit flow or personal-list feature. Identity revalidation and task membership on the exercised routes must be supplied by the main implementation; the test does not weaken the expected denials to match legacy name fallback.

## Earlier failure evidence (resolved)

Two authorized runs against the current/agent-ready implementation reproduced the same issue: owner WhatsApp title PATCH and explicitly ID-mapped Telegram owner title PATCH return 422 (`Elegí al menos una persona responsable que exista en el sistema.`), expected 200. Detail/list/denial checks pass. Cause visible in source: `buildWilsonTaskUpdate` reconstructs untouched assignment labels and feeds `currentTask.asignado_a` to `buildWilsonTask`; `exactWilsonUser` correctly rejects duplicate names before the unchanged ID binding can be preserved. No permission or success assertion was relaxed.

Before the supervisor follow-up additions, each run reported 7 passing subtests and 2 failing subtests (plus the failed parent: Node total 7 pass / 3 fail). Passing groups: real signature and v2 query hardening, group isolation, inactive/disabled/ambiguous mapping denial, collaborator revocation including pending review token, successful owner review, and current-DB admin-role downgrade. Latest own fixture `/private/tmp/render2-local-uQ2KQI` stopped and removed through the test cleanup hook; 55596 had no remaining listener. Other clusters were untouched. This is not a complete pass claim.

The earlier run with supervisor coverage had **8 passing subtests, 2 failing subtests**, plus failed parent (Node total 8 pass / 3 fail; no skips). Supervisor employee context distinguished same-name owner/impostor by IDs, excluded the revoked collaborator despite retained JSON and denied employee tick access. At that point both original title-only PATCH 422 regressions remained. Exact own fixture `/private/tmp/render2-local-o1CziD` was stopped and its removal asserted. No application edits or relaxed assertions.

## Latest verified results

After coordinator readiness for the omitted-assignment P1 fix, reran the unchanged strict suite plus rename follow-up: **12 passed, 0 failed, 0 skipped**. Actual signed HTTP verified RSA/v2/full-query hardening, same-name ID isolation across detail/list/write/review, group non-bypass, supervisor employee context/system-only tick, inactive/disabled/ambiguous links, revoked-collaborator edit/review denial including an already-issued review token, successful owner review transition, explicit Telegram binding/default denial, current-DB admin downgrade and renamed-owner edits on both channels. Both former 422 regressions now return the expected 200.

Repeated once more after the coordinator explicitly confirmed both agents terminal READY: again **12 passed, 0 failed, 0 skipped**. The cleanup hook stopped the exact own fixture and asserted `/private/tmp/render2-local-DgnwT7` no longer exists; no listener remained on 55596. No other clusters were touched. Syntax and whitespace checks passed. Supervisor relink/replay hardening has separate main-owned test coverage and is **not** claimed to be proven by this suite's context-only assertions.
