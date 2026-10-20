# Render2 phase 0/1 architecture contract

Status: source inspection, not a production certification. No database queried, service started, migration run, or secret/runtime account file read. Authentication and finance/state implementation belongs to the main agents. Targets below are acceptance criteria, not claims of shipped behavior.

This document captures the pre-rescue architecture review. Subsequent local patches and guarded fixture executions are tracked in `STATUS.md` and `LOCAL_TESTING.md`; use those for current implementation and verification status.

Current startup delta (2026-10-19): start/dev/hosting entrypoints no longer migrate or seed, and jobs are opt-in behind target approval. Runtime inspects ledger/core public schema before listening. Migration runner requires explicit approved identity/plan and one locked client; fixtures require fresh physical isolation. Legacy goal opt-ins/preview bootstrap are quarantined before DB use. See `STARTUP_SAFETY_CONTRACT.md` and actual coordinator evidence in `STARTUP_SAFETY_QA.md`. No production rollout or overall security completion is implied; task mutation replay P1 remains documented in `TASK_REPLAY_FINDINGS.md`.

## Current → target

| Area | Observed source | Phase 0/1 contract |
| --- | --- | --- |
| Principal API | `backend/src/server.js`, PostgreSQL `public` tables, integer user IDs; password/Google login signs 30-day JWT containing name/role | Keep routes and existing IDs; validate claims strictly and resolve active identity/current privileges server-side. Never authorize from display names. |
| Reference sandbox | `backend/sandbox/README.md`, `config.js`: separate `render_security_test`, `render_test`, port 55486; UUID identities, sessions and version checks | Reference behavior only. Do not replace principal schema, redirect its connection, copy fixtures, or reuse sandbox SQL as production migration. |
| Preview | `previewLocalProfiles.js`: selectable local profiles; browser/demo data alongside sandbox adapter | Profile selection is presentation, never authentication. Display source and persistence status; no silent fallback from API failure to demo success. |
| Ownership | `task-access.js` matches names and JSON collaborators; shared Render OS reads | Add user-ID relations while retaining legacy text for history. Private scope stays private; shared board visibility is not write permission. |
| Finance | `finance-calculation.js` maps person aliases; `automatic-finance.js` computes periods/proration; contracts and operational abonos are separate | Preserve source separation. Reject invalid/nonfinite amounts and periods; distinguish unknown from zero. Document currency/rounding and work-month vs payment-month; do not silently restate settled history. |
| State | Principal workflow differs from sandbox; principal task changes can invoke linked-piece publication | Explicit authorized transitions; scheduled date is not completion, production readiness is not publication. Persist task/piece effects atomically with stale-write rejection. |

## Data-preserving sequence

1. Inventory schema versions and legacy identity references in an approved staging copy; obtain a recoverable backup and prove restore. Capture counts, IDs, orphan checks, monthly piece totals and financial totals before changes. No production reads/writes are authorized by this document.
2. Add nullable ID-based owner/collaborator and session/identity structures; preserve integer `usuarios.id`, client/task/piece IDs, original names, amounts, dates and JSON. If public UUIDs are needed, add unique alternate IDs, not replacement PKs.
3. Approve a mapping ledger: legacy value/record ID → person ID, evidence, approver, effective date. Auto-map only exact unambiguous approved entries. Leave collisions/shared-account history unresolved, not assigned to whoever logs in first. Retain legacy snapshots and distinguish current assignee from historical actor/payee.
4. Backfill in bounded restartable batches with conflict/orphan reports. Reconcile before/after counts and period totals; add/validate FK and uniqueness constraints after duplicates are resolved. Names/aliases may support compatibility display, never establish new access.
5. Dual-read comparison in staging, then switch authorization to ID relations. Unresolved assignments fail closed for writes while authorized historical readers retain visibility. Revoke old sessions at auth cutover; rehearse login/recovery and rollback before switching traffic.
6. Roll back application routing/feature flags without dropping additive columns or deleting new records. Keep audit and mapping ledger. Remove legacy authorization only after parity tests and owner approval.

Do not replay all historical migrations against existing data as an upgrade shortcut. `044_eliminar_tareas_finalizadas_actuales.sql` deletes published Render OS tasks; 023/026 also encode identity corrections. Fresh-schema replay is a different test from preservation of a populated upgrade. Do not invent lost rows or completion timestamps.

## Isolated principal-schema PostgreSQL harness (proposal, not executed)

Available read-only discovery: `/opt/homebrew/opt/postgresql@16/bin/{initdb,pg_ctl,postgres}`; `postgres --version` returned **16.14**. No new package is needed: principal backend already depends on `pg`, Express and JWT.

Smallest useful future harness: one Node test coordinator with a new `mktemp`-style private directory, fresh PostgreSQL cluster, private Unix socket and TCP disabled. Use a unique database such as `render2_principal_qa`, separate owner/application roles, synthetic fixtures and a random identity marker. Never read `.env`, `DATABASE_URL`, sandbox `.runtime`, or production exports. Construct a sanitized child environment, explicit socket/database/role configuration, and verify current database/user, socket cluster path and marker before any SQL. Fail closed on any mismatch; no existing cluster reuse.

Two layers: (a) use `runMigrations(injectedPool,logger,{approval,deferredMigrations})` solely in the verified fresh disposable database with its actual approved identity/plan to prove the principal chain builds; inspect deterministic synthetic defaults and establish the pre-fixture baseline; (b) insert fictional fixtures and test actual principal routers/queries. Test new upgrade SQL separately against a pre-change synthetic populated schema, asserting preserved IDs, archives, amounts and periods. Do not rerun historic destructive migrations on populated fixtures.

Prefer an injected Express app factory. Existing `RENDER_DISABLE_SERVER_START=true` suppresses principal startup/migrations/schedulers, but importing `server.js` still loads dotenv and global dependencies: it is **not** an isolation boundary. Avoid that import until environment/connection injection and external-integration stubs are verified. `db.js` derives TLS from whether a URL contains `localhost`; explicit socket pool injection also avoids its `127.0.0.1` TLS mismatch. Harness lifecycle must stop only its verified cluster, close pools, and retain failure logs without tokens; no broad cleanup command.

`client-goals.integration.test.js` is an existing narrower reference: explicit opt-in plus localhost and `/render_goals_qa` checks. It runs migrations/writes and is not a general safe test command or a substitute for the new marker/path guards. Do not enable it on an existing database.

## QA gates and safe commands

### Current local acceptance checkpoint — integration57 (2026-10-20)

This is a current-state checkpoint, not a completion declaration or replacement of the phased master objective. Earlier sections describe the original audit; STATUS.md records subsequent implementation chronologically.

| Master area | Current evidence | Remaining gate |
| --- | --- | --- |
| Canonical application/data | React root → relative `/api` → Express → `pg`; canonical navigation and personal home are connected. Source inspection found API usage in every canonical module inspected, not an identified browser-only business module. | Full per-module/role/runtime audit still required. DEV preview wrappers and sandbox proxy/source remain separate references; final disposition is not yet closed. Preserve user App/Vite dirt. |
| Identity/privacy | Current server IDs/roles/session versions; financial DTO boundaries;57 self-profile CAS and token-bound401 transport. Physical cross-user editing workflow and profile revocation tests passed in fresh PG. | Approved real roster/Google/provider onboarding and historical identity mapping not established; localStorage bearer remains XSS-readable; no claim HttpOnly/CSRF migration is finished. |
| Work/editorial/quotas |57 actual API task create/assignment → employee delivery → another owner correction → second delivery → exact approval → completion agrees with personal home, report task/count and objective DTO at every step. Piece remains `lista`, real publication date null, no publication event. | Piece/objective setup in this test is synthetic SQL, not API creation/publication E2E. Publication-provider execution and the whole A–F acceptance matrix are not certified by this one editing path. |
| Production | Canonical per-video registry, manual editor/deadline handoff, explicit historical identification and56 one-task/one-video adoption with retained delivery/review IDs. | True multi-video aggregate disposition, multiple/non-workspace children, mixed visits and reviewed rescope/partial extensions remain. |
| Other operational modules | Drive, moodboards, lists, clients, feedback, financial/user routes have backend calls in inspected source. | Read-only audit found candidate P2s: PersonalLists650ms autosave timers can be cancelled on unmount without flush/guard; Feedback fetches first100 text-search `q=feedback` tasks, not a complete structured correction inventory. Neither is fixed or browser-proven by57. |
| Navigation/design | Shared canonical sidebar, nominal dashboard aliases retired, common light UI; repeated scoped mobile checks, including57 Profile390px with no document overflow. | No claim every screen/control/mobile breakpoint is verified or visually uniform. |
| Rollout/integrations | Local source commits and disposable PG tests only; no configured database/provider/production writes or deployment. | Actual deployment identity, backup/migration plan, provider access, release checklist and explicit approval still required. Local passing tests are not a published system. |

Next integration should first resolve and verify pending personal-list edits on navigation, then replace Feedback's incomplete text-search candidate inventory with an explicit scoped/paginated operational contract. Do not create another dashboard, generic parallel API or browser business store to address these gaps.

Read-only/pure regression candidates, from repository root with dependencies already installed:

```sh
node --check backend/src/auth.js
node --check backend/src/server.js
node --test backend/test/task-access.test.js backend/test/finance-calculation.test.js backend/test/salary-calculation.test.js
/opt/homebrew/opt/postgresql@16/bin/postgres --version
```

Commands are recommendations, not results from this original review. Reinspect tests if other agents change imports. Do not use broad discovery with privileges, start ordinary configured services, seed scripts, sandbox suites or integration opt-ins without isolating effects. Originally start/server auto-start migrated and scheduled jobs; the startup-safety integration above removes those implicit paths. This does not authorize other legacy mutating CLIs or workers.

Required harness cases: duplicate/retried requests; two writers with the same expected version (one commit, one 409); transaction rollback without partial piece/finance updates; forged/stale identity; renamed/shared account; archived completed contribution; missing vs zero payment; invalid date/month and year rollover; mixed currencies and proration boundary; financial fields absent from employee DTOs. Static route-regex tests are not HTTP authorization proof.

## Production readiness and dependencies (separate gates)

**Phase readiness:** source/static/unit checks plus isolated principal-schema HTTP/SQL tests, identity mapping design and historical-total parity. Sandbox success proves only sandbox behavior. No production readiness implied.

**Production gate:** approved identity/capability roster; verified Google linkage/recovery; revocation and HTTPS session/CSRF policy; populated staging upgrade/restore rehearsal; privacy/authorization HTTP tests; observed transaction/concurrency behavior; historical count/financial reconciliation; deployment rollback and monitoring owner. Account and workflow policy disagreements block cutover, not documentation work.

**Dependencies:** main auth agent supplies validated principal identity/current-role lookup; finance/state agent supplies transaction and calculation contracts; owners approve ambiguous identity splits and publication capabilities; PostgreSQL harness needs explicit permission to create/start a third disposable cluster. Real Google/Drive, email/WhatsApp, production DB and sandbox replacement are outside phase 0/1 verification.
