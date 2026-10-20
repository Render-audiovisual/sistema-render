# Integration80 — canonical client objectives and content write boundary

## Scope and ownership

Coordinator owns client-goals.js, physical principal QA and integration. Carson owns ClientesObjetivos.jsx and adjacent session tests. Hypatia audits the API/business contract; Beauvoir reviews independently. Preserve user App20+/1-, Vite5+ and all untracked reference work. No configured DB/provider/real commercial records, environment change or deployment.

## Server boundary

The shared objectives content endpoint previously accepted any authenticated user without checking the task's ID-based write scope. Shared read access does not authorize mutation. editGoalContent now receives req.auth and uses the same buildTaskAccessClause as canonical task writes under the existing task lock, retaining render_os/nonarchive/nontrash checks. Missing membership is404. A required positive integer expected_revision is checked alongside the existing timestamp CAS; malformed/extra fields fail400, stale revisions409. ACK returns updated_at/revision only. No name authorization, reassignment, state bypass or publication recording introduced.

## Physical verification

Use only the guarded principal loopback fixture:

```
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-goals-content.integration.test.js test/render2-cross-sector-workflow.integration.test.js
node --test test/*.test.js
```

Fifteen physical cases passed: two owners prepare exactly one quota (2reels/1carousel), employee cannot change monthly assignments; repeated shared reads do not mutate rows or expose a real synthetic cliente_abonos monetary sentinel; nonmember content PATCH404 unchanged; renamed assigned user remains authorized by ID; content persists across other accounts; missing/malformed/stale integer revision rejected; competing editors one200/one409; responsible and collaborator removal revoke content access, explicit collaborator membership permits it. Editing approved design invalidates approval and returns en_revision; premature finalization409. Existing cross-sector delivery/correction/approval/finalization verifies Home/Reports/objective updates without inventing editorial publication. Each fixture asserts generated-root absence after cleanup.

Backend discovery1385 passed/60 explicit opt-in skips/0failed. Logs `/private/tmp/render2-goals80-http-final.log` and `/private/tmp/render2-goals80-backend.log`. Initial fixture used a nonexistent clientes.abono column; corrected to actual cliente_abonos table, not schema. Null malformed-body400 emits expected parser diagnostics in the isolated log. Independent backend review found no confirmed P1/P2 in the bounded change.

## Frontend adoption and final evidence

Canonical session/context binding replaces all raw fetch/JSON readers. Original action scope spans request and callback; identity/lifetime/ABA invalidation rejects stale continuation. Modals are keyed by period/client/piece/task, defer polling rather than replacing held observations, and freeze selected context. Principal loading owns the first read; polling waits until it completes, avoiding a reviewed skeleton race. Malformed/duplicate period URL values reject; popstate defers a new month while a modal is open and keeps the displayed period in URL until close. Dirty content/responsible discard requires confirmation; pending writes cannot close. These local guards do not claim global navigation/crash recovery.

Content begin-edit displays the freshly read actual task and captures both timestamp/integer revision; save validates an advanced revision ACK and preserves draft on409 without retry/rebase. Finalize/reopen instead sends the original piece's observed task revision directly, not GET→fresh-revision authorization. Finalize is disabled until approved; copy-edit text correctly explains that changing approved work requires another review.

Final frontend804 passed/0failed/skipped, including13 new tests executing actual extracted hook/callback code with injected effects, not mounted React. Backend final1385 pass/60 opt-in skips/0fail. Build passed. Existing canonical-task-reader source assertion updated to require held-piece revision for finish and captured-task revision for content, not weaken the concurrency contract. Logs `/private/tmp/render2-goals80-frontend.log`, `/private/tmp/render2-goals80-backend-final.log`, `/private/tmp/render2-goals80-build.log`. Independent frozen review found no confirmed P1/P2 within scope.

Actual browser fixture: Franco opens approved synthetic carousel → edits local copy → Agustín independently updates via actual HTTP → Franco save conflicts and visibly retains full local text. Stale finalization is rejected by backend approval rules. Explicitly opening edit again displays the current server text/version; subsequent save succeeds. Reloaded detail retains final copy and En revisión, with Requiere aprobación disabled. Document width/scrollWidth both390 at390×844; mobile screenshot visually inspected. Direct November URL and browser Back/Forward show matching October/November periods. Screenshots `/private/tmp/render2-goals80-conflict-desktop.jpg`, `/private/tmp/render2-goals80-reloaded-desktop.jpg`, `/private/tmp/render2-goals80-reloaded-mobile.jpg`.

Native-confirm interruption caused browser focus timeouts; control recovered via the selected-tab handle, without process restart. The eventual editor exit does not prove the Cancel branch, so mounted reject-discard acceptance remains unverified (callback tests do pass). Native month fill/picker automation also failed to confirm a month selection; only direct URLs/Back/Forward were verified, not native-picker acceptance. No unsupported synthetic DOM mutation used. Owned tab closed, viewport reset, original fixture PTY stopped; `/private/tmp/render2-local-EwAZPt` checked absent before commit. No broad kill or cleanup.

## Remaining gates

Sequential assignment revocation proves only sequential denial, not a complete concurrent-reassignment barrier. Generic content operation receipts/uncertain-transport idempotency, global draft/navigation recovery, cookie activation and native cross-device/proxy/provider acceptance remain separate gates. No historical task or publication semantics reinterpreted. No new migration/dependency in this batch. Not full Render2 completion or production readiness.
