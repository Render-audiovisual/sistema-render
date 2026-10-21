# Observed versions — integration 95

## Contract

Approving or finalizing work must use the task revision observed by the action, including while waiting in the per-task queue. A conflict may fetch current data for review but cannot automatically approve/finalize that newer version. Ordinary disjoint-field edits retain their existing conditional retry; this is not a blanket removal of retries or a redesign of server workflow permissions. Completion still does not publish content.

Production visit/video/photo/editor-handoff drafts must own a visit revision. A refresh or a successful sibling form cannot silently relabel a dirty draft with the new aggregate revision. Clean forms may synchronize to verified data. A conflict preserves local fields and requires explicit discard/reload before another submission. Failed recovery preserves those fields. Confirmed writes and failed readback are distinct from unconfirmed requests. No browser business persistence, automatic resubmission, new authentication authority or schema transition is introduced.

## Ownership

Carson: canonical task callback boundary and focused regression. Descartes: production forms/model and focused regression. Coordinator: independent real HTTP/PostgreSQL callback/model tests and integration. Beauvoir independently reviews task behavior; Hypatia independently reviews production behavior. Shared server.js/App.jsx remain unchanged.

## Reproduction

- Frontend: `node --test`, `npm run build` from frontend.
- Backend regression: `node --test --test-concurrency=1 test/*.test.js` from backend.
- Actual callback/data proof: `RENDER2_RUN_LOCAL_INTEGRATION=true node --test test/render2-observed-review.integration.test.js` from backend. Uses the guarded brand-new principal harness only, port55717, two synthetic owner identities, and asserts fixture removal.

The physical test extracts the actual canonical task callbacks, not a replica of their retry policy. It checks stale non-editing approval, stale finalization, queued revision advancement, explicit fresh review, preserved ordinary retry and a production model against genuine API-created records. It does not mount React or emulate a browser dialog. Source/model coverage and native browser acceptance must be reported separately.

## Remaining boundaries

This scoped change is not a durable operation-receipt migration. In particular, the preexisting new-visit POST lacks an idempotency receipt for a lost response. A native browser/mobile matrix, provider acceptance, historical account/data reconciliation and authorized rollout remain separate gates. Existing backend current-authority/CAS contracts remain authoritative. Nothing here accesses a configured database or deploys production.

## Verified local evidence (2026-10-20)

- Final frontend1225 pass/1 explicit opt-in skip/0 fail and Vite production build pass. Logs `/private/tmp/render2-observed95-frontend-final.log` and `/private/tmp/render2-observed95-build-final.log`. Focused production model/actual callback/hook tests20 pass; task source callbacks6 pass. The injected hook scheduler is not a React concurrent-runtime certification.
- Actual principal HTTP/PostgreSQL7 pass/0 skips, including the queued finalization case and production refresh/recovery with fresh login/reload. Log `/private/tmp/render2-observed95-http-validated.log`. Fixture removal asserted.
- Native browser tab65 on a separate disposable PostgreSQL fixture55718: initial production deep link survived synthetic owner login; existing planned video opened; unsaved observations typed; separate fixture control performed genuine concurrent video PATCH to recorded/material; page Actualizar retained the exact local text/old planned state, showed current recorded header, conflict explanation and disabled Save. No hidden second submission occurred. At390×844 document width390, form fields/buttons298px, no document horizontal overflow. Screenshot `/private/tmp/render2-observed95-mobile.png` shows preserved text, explanation, explicit recovery control and disabled Save; desktop capture `/private/tmp/render2-observed95-desktop.png`.
- Native explicit discard/confirm acceptance, photos, handoff, all roles/devices and lost-network scenarios were not newly browser-tested. They have source/model coverage only. No new browser credential was created/changed. Existing Google button assets loaded; no Google sign-in/provider acceptance. Owned tab closed, viewport reset and fixture cleanup terminal0 (`OBSERVED95_FIXTURE_CLEANED`).
- Initial backend regression exposed six older source-fixture failures: missing hook/validator dependencies, obsolete literal handoff signature and obsolete partial-ACK success expectation. Fixtures now execute the real hook/model or real aggregate validator; retained material/guion/late-response assertions remain. Added incomplete-read rejection to actual deep-link loader. Final backend1460 pass/72 explicit opt-in skips/0 fail, sequential after owned physical/native fixtures stopped; log `/private/tmp/render2-observed95-backend-verified.log`. The skipped physical tests are not implied passed; only the new seven-case physical suite was rerun here.

Independent final read-only reviewers found no confirmed P1/P2 in the scoped frozen task/production delta after the incomplete-read and render-mutation findings were corrected. This is not an application-wide audit, master-phase completion or production readiness claim.
