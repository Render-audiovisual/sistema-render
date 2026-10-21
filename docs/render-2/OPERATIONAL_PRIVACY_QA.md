# Operational structured-finance privacy: isolated HTTP QA

## Integration 97 — moodboard linked-task disclosure (2026-10-20)

Scoped finding **MBD-001 / Medium (P2), fixed locally**. In pre-fix commit dfceba5, `backend/src/moodboards.js` board-task GET (around116), linked-reference task aggregation (around104), and relation POST (around181) authenticated the caller but did not apply the canonical task read scope. An employee could obtain a nonmember historical task ID/title through Moodboards even when the canonical historical task endpoint denied it. The link route also accepted task IDs from another board client. Authentication middleware alone was not object-level authorization. This finding concerns task identity/title disclosure, not proof of a new structured-finance response leak.

Current fix: `buildMoodboardTaskReadPredicate` in `backend/src/moodboard-task-access.js` reuses the canonical ID-membership clause: valid administrators read all; exact render_os remains shared; every other marker, including NULL and explicit historical markers, requires employee membership. Both Moodboards task projections additionally require the task client to belong to that board. Existing invalid links remain stored but return no hidden task ID/title. No automatic deletion or identity inference from display names.

POST/DELETE task links now run a short transaction with current actor ID/activity/epoch/DB role held through commit, then reference, task and board/client membership locks. Authorization uses task READ scope because linking a reference must not grant task edit rights. Only `moodboard_reference_tasks` changes. Invalid/missing/unreadable/cross-client targets return generic404; malformed numeric identifiers400. Failed rollback discards the connection. Other Moodboard writers, upload handling and initialization remain unchanged and are not certified by this fix.

Security guidance shaped server-side object checks and parameterized closed predicates; PostgreSQL guidance shaped short transactions and consistent lock order. Descartes owned implementation/unit tests, Hypatia independent physical privacy tests, Beauvoir read-only review, Carson frontend compatibility audit, coordinator independent physical concurrency/integration. No confirmed scoped P1/P2 remained in final source review.

Focused evidence:31 new helper/router unit cases pass;7 actual HTTP/PostgreSQL privacy cases pass (fixture55722);9 actual concurrency cases pass (fixture55723). The latter holds real locks, confirms requests wait, commits revocation/inactivation/role downgrade or removal of historical assignment, and verifies POST/DELETE cannot mutate links afterward. Physical privacy tests retain hidden and cross-client historical links in PostgreSQL while checking both response shapes, homonyms/rename, explicit markers, permitted link/reload and revoked sessions. Both owned fixtures assert removal. Logs `/private/tmp/render2-cross97-moodboard-unit.log`, `/private/tmp/render2-cross97-moodboard-authority.log`; final full-suite results are recorded in STATUS.

Final complete69-file principal integration run (both local integration and local TLS flags enabled, sequential)687 pass/0 fail/0 skip; `/private/tmp/render2-cross97-http-verified.log`. One prior complete attempt had an initdb setup timeout in assignments before migrations; after authoritative terminal exit, unchanged isolated assignment15 pass and then full687 pass. Initial failure is retained, not rewritten as green. TLS uses a synthetic local protocol peer; provider/real DB authentication is not certified. Vite actual canonical-entry HTTP1 pass separately. Broad backend regression is recorded in STATUS.

Frontend remains source-compatible with `tareas: []`; it neither fetches hidden tasks nor deletes hidden associations. Existing checkbox mutation-error UX, create-reference/link partial success, and authorized cleanup of old cross-client links remain separate gaps. No native browser/device test or visual change in this integration. This does not establish application-wide privacy/security certification. The original10-case structured-finance result below is historical, not the latest global regression count.

Status: latest authorized isolated HTTP run **10 passed, 0 failed, 0 skipped** after main corrected the editorial handlers. Owns only this document and `backend/test/render2-operational-privacy.integration.test.js`; no application/harness/module edits.

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-operational-privacy.integration.test.js
```

Uses the guarded principal harness with a fresh disposable PostgreSQL fixture on loopback 55600 and ephemeral loopback HTTP. No existing DB or real financial data/secrets; no external calls, schedulers or normal backend startup. Only synthetic marker `QA_PRIVATE_FINANCE_SENTINEL_55600` and amount 876543.21 are injected. Cleanup stops only the exact own cluster and asserts its directory absent. Suite timeout 180s; other bounded timeouts come from the harness. Default discovery skips before provisioning.

## Verified evidence

- Real sessions for diseno, edicion, produccion, community, programacion and a persisted unknown role. All have explicit normalized task membership, not inferred display-name access.
- Synthetic SQL task properties, editorial metadata and client configuration/abono include scalar financial fields, arbitrary future bags, nested objects, object-under-allowed-scalar, and array wrappers. Recursively assert neither marker/amount nor named financial/default-unknown keys reach a non-admin response.
- Actual list/detail/subtask/PATCH/create/production-add/production-correction/recommendation/linked-task responses, editorial histories/publications/pieces/detail and clients. Editorial employee PATCH remains 403, not a new privilege. Finance endpoint remains admin-role guarded.
- Positive nonempty assertions retain integer revision, normalized owner/collaborator IDs, copy, plain and structured scripts/scenes, production record IDs/counts and attachment IDs/name/URL. Valid day/quota client fields remain visible.
- A fixture-only BEFORE INSERT trigger injects financial fields into new task rows, proving create serialization filters data actually present in RETURNING/DB; it is removed in nested `finally` blocks. Admin reread proves injection persisted.
- Admin raw task/editorial responses and authorized client finance values retain the synthetic data, ruling out an empty-fixture or blanket-deletion false pass.

Scope is structured fields/JSON serialization, not censoring comments, briefs or other ordinary free text. No assertion requires redacting a user string merely because it contains a financial word. This test does not claim every API, SQL write authorization, signed Wilson response wiring or browser behavior; signed Wilson post-confirmation coverage may be added only after its coordinator wiring is ready. No real keys are printed or used.

## Results

Initial run (resolved): Node total **2 pass / 8 fail** (6 role-read groups and admin control failed, plus failed parent). Non-admin task PATCH, production add/correction and DB-injected create response groups passed for all six roles. Earlier assertions in the read groups passed task list/detail/subtask/recommendation and linked-task checks before reaching the editorial error.

Resolved main wiring defect: `GET /historias` declared `_req` while the new DTO mapping accessed `req.auth`, raising `ReferenceError: req is not defined` and returning 500; `GET /piezas` had the same pattern. Main corrected both handlers. Success/privacy assertions remained unchanged and this QA task did not edit the server.

Admin control also initially used the wrong query parameter for `/sueldos` (`mes` instead of required `periodo`) and got 400. After correcting the test to `periodo=2026-10`, the authorized admin control passed. No external exchange-rate call can escape the child's existing fetch guard; the endpoint uses its fallback when that guard rejects.

Latest rerun: **10/10 passed**, including admin raw/finance controls, all six role read groups, PATCH/production and database-poisoned create responses. Financial scalar/nested/object/array markers were absent from non-admin HTTP responses while legitimate revisions, IDs, copy/scripts/scenes, records and attachments remained. Exact own fixture `/private/tmp/render2-local-jmR5JE` was stopped and its removal asserted; port 55600 had no remaining listener. No other clusters were touched. Syntax/whitespace checks passed. Signed Wilson response coverage remains outside this suite's current evidence.
