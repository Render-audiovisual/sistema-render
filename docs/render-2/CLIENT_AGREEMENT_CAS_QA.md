# Integration82 — persistent client agreement CAS

## Ownership and scope

Coordinator:072 migration, client-agreement helper, server/DELETE integration, validator tests, compatibility and final QA. Hypatia: ClienteModals and callback tests. Carson: isolated principal agreement suite. Beauvoir: independent backend/frontend source review. No App/Vite/reference edits included; existing user App20+/1-,Vite5+ preserved. Only disposable loopback PostgreSQL and synthetic accounts/amounts used.

## Contract

072 adds server-owned INTEGER agreement_version(default1,positive) to clientes and grupos_feed. Every future root/group UPDATE sets OLD+1, ignoring caller version. Configurations/fees AFTER INSERT/UPDATE/DELETE advance affected client versions, sorted by ID for transfers. No amount, quota, task or editorial state is rewritten by installation. Counters may advance multiple times per operation; never assume +1. Integer exhaustion fails closed. Unlike a content hash, an A→B→A change cannot revive an earlier observation.

Admin GET `/clientes` projects the client, effective monthly data and opaque `agreement_revision` from one SQL statement/snapshot. Token `a1:<clientId>:<clientVersion>:<groupIdOr0>:<groupVersionOr0>` binds the resource and shared group; all parts canonical int32, client ID/version positive and group/version both zero or both positive. No financial value is encoded. Employee allowlist omits both private fields and this observation.

POST configurations, PATCH client/activation/shared quotas, POST next-month fee and DELETE require body `expected_revision`: absent428, malformed400, stale/cross-resource409 CLIENT_AGREEMENT_CONFLICT before business DML. Admin role remains mandatory; a version is not authentication. All app client writers, including create and DELETE, acquire the same transaction advisory lock before client→group row locks. This intentionally coarse protocol avoids inconsistent shared-feed lock ordering. ACKs read post-trigger revision before COMMIT; create also returns its committed revision. No migration runs on startup against unknown targets.

Modal retains the original account/client/period and initial observation. Every confirmed step uses only the validated advanced revision from the preceding ACK. A conflict, ambiguous failure or partial commit stops the chain and blocks repeating the whole save. Draft remains visible until the explicit “Descartar mis cambios y cargar versión guardada” action reads the same client/period under the still-current session. No automatic GET/rebase/retry. Legacy next fee remains next actual server month; historical monthly configuration remains the explicitly selected period. DELETE carries the held observation too.

## Evidence

```
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-client-agreement.integration.test.js test/render2-client-admin.integration.test.js test/render2-goals-content.integration.test.js
node --test test/*.test.js
```

Actual principal/HTTP/PostgreSQL36 pass/0fail/0skip:16 new agreement subcases plus parent, prior administration/history-safety10 and goal content9. Covers missing/invalid/resource-bound observations; two owners/one winner; root/config/fee interleaving; shared-group invalidation across members; global lock taken before rows; SQL root/config/fee ABA; period projection coherence; partial chain stopped by another owner; stale DELETE; employee privacy/role denial. All fixture cleanups assert generated-root absence. The old administration suite now explicitly prepares a fresh observation for each independent command; that fixture-only adapter is not a production retry policy or evidence of stale-intent rejection. The new suite deliberately holds observations.

Final backend1391 pass/62 explicit opt-in skips/0fail, including6 new validator/lock/DDL unit cases. Frontend868 pass/0fail/0skip, including50 modal callback/model tests (not mounted React). Production build and diff check pass. Strict zero/group/newline token parser mismatch found during source review was corrected and re-run. Independent frozen review found no confirmed P1/P2 within this delta.

Logs `/private/tmp/render2-agreement82-http.log`, `/private/tmp/render2-agreement82-backend-final.log`, `/private/tmp/render2-agreement82-frontend-final.log`, `/private/tmp/render2-agreement82-build-final.log`.

Mounted browser: Franco opens quota2/fee12345 and drafts quota3. Agustín commits quota4/fee45678 via actual API with his own observed revision. Franco save409 keeps quota3/fee12345 and disables Save, offering explicit recovery. On mobile explicit load shows quota4/fee45678; subsequent quota5 save succeeds. Reload retains quota5/fee45678 and the correct monthly story quota. These are entirely fictitious amounts. Document width/scrollWidth390 at390×844; screenshot visually inspected. Evidence `/private/tmp/render2-agreement82-conflict-desktop.jpg`, `/private/tmp/render2-agreement82-reloaded-mobile.jpg`. Owned tab closed, viewport reset, original PTY stopped, `/private/tmp/render2-local-ZjgG9T` checked absent.

## Remaining gates and deployment distinction

No configured DB/provider/real commercial write, push or deployment. Migration applied only through guarded disposable fixtures. Release requires known environment identity, approved plan hash/backup and coordinated migration/API/frontend rollout; old writers without a precondition now fail closed. Full historical upgrade/native-cookie/HTTPS/proxy/device/provider acceptance and global draft/crash recovery remain incomplete. No claim of production readiness or full phase/master completion.

SQL external writers and offline setup-demo do not acquire the app advisory lock: triggers invalidate committed changes but arbitrary lock orders may cause deadlocks/transaction rejection. Privileged trigger bypass/concurrent DDL are outside this protocol. This does not protect independent `contratos_financieros`, salaries, expenses or exchange-rate edits. Those resources require their own ID-based contracts/CAS and must not borrow a client token by matching names. Durable idempotency after an uncertain create/financial response is also a separate gate.
