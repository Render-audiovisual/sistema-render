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

Integration58 adds a pure per-record personal-list save queue, synchronous dirty/navigation guard and mandatory owner/version CAS for list metadata/block PATCH. BIGSERIAL IDs are preserved as canonical decimal strings; versions/user IDs remain INTEGER. Structural operations flush pending writes; failures retain drafts without automatic reload/rebase. This requires coordinated frontend/backend rollout. An ambiguous committed request can retry409; CAS is not a replay receipt. Integration59 extends exact record IDs to MIA, pins destinations without fallback and revalidates proposal requester/current linked actor/DB role/active target inside confirmation transactions. The injected actor locker reuses the existing Wilson human-identity contract; no parallel identity algorithm. Signed HTTP tests cover UI↔MIA stale versions and a real concurrent downgrade barrier. Proposal generation itself is not one atomic authorization snapshot. Browser verification59 confirms save/error recovery/newer-draft retry/reload and mobile390px width; native navigation confirmation remains unverified.

Integration60 replaces Feedback's truncated text-search task candidates with `feedback-task-inventory.js` and `FeedbackTaskInventory.jsx`/`feedbackTaskInventory.js`, mounted by the canonical authenticated Express server. The paginated closed reader separates real editing artifacts/decisions from general shared notes, with no additional operational data source. History of corrections is not inferred pending or resolved; effective approval requires the latest exact artifact binding and compatible revision, not an orphan boolean. Real HTTP tests cover >100 records, all current roles, privacy and one complete editing lifecycle; browser checks cover URL filters, actual task context and mobile width. General notes still have their separate500-note cap. Next perform requirement-by-requirement master acceptance and prioritize remaining functional gaps; no new parallel dashboard/API/browser business store is justified by these fixes. No whole-system or production readiness is implied.

## Master acceptance checkpoint — integration61

This is an evidence map, not a declaration that the master objective is complete. Current source and executable assertions take precedence over older chronological statements in STATUS. The audit agents did not execute services; physical results are recorded by Main separately in STATUS. All implementation and verification remain local.

| Required operational area | Current canonical implementation / evidence family | Acceptance still missing or limited |
| --- | --- | --- |
| Personal home | `personal-home.js`, `QuickHome.jsx`/`personalHome.js`; personal/monthly/team/escalation HTTP suites | Complete role/device/keyboard matrix; providers and real roster not validated. |
| Tasks | One task table, ID assignments, task workflow and editing artifact/review modules; assignments/workflow/deliveries/reviews/cross-sector suites | Fine-grained capability policy approval, wider UI/network acceptance; no implication that final work is published. |
| Calendar | `calendar.js`, canonical calendar UI; calendar and calendar-projects HTTP suites | General personal reminders not unified into calendar; every responsive route not certified. |
| Productions | `production-registry.js`, `Productions.jsx`; registry/editorial/adoption/concurrency/full-workflow suites | Existing mixed visits, incremental historical reviews and true aggregate multi-video child disposition remain incomplete. Preservation/rejection is not resolution. |
| Clients and monthly objectives | `client-goals.js`, `ClientesObjetivos.jsx`; objective-link and editorial suites | Unsaved client/objective piece drafts need shared navigation protection; no real historical quota/financial reconciliation. |
| Development/web/chatbot projects | `projects.js`, `Projects.jsx`; projects and calendar-projects suites | Module exists with stages/milestones/deliverables/tasks. Full notifications and all-device acceptance not certified. Do not replace with monthly content quotas. |
| Stories, publications and approvals | Canonical editorial control/detail/publication APIs and UI; editorial-confirmation/piece-detail/control suites | Actual provider publishing/access not verified; only reliable integration or explicit authorized recording can establish publication. |
| My list | `personal-lists.js`, queue and canonical UI; CAS/persistence/MIA interoperability suites | Native navigation dialog runtime matrix; browser restart is not a durable draft promise. |
| Feedback | Shared notes plus `feedback-task-inventory.js` and dedicated component; receipts/inventory suites | General note cap500 remains; complete dirty-note native traversal not certified. Correction history is not a pending/resolved inference. |
| Reports | Principal operational reporting and closed DTOs; operational-privacy/production-reporting/cross-sector suites | Historical total reconciliation and provider evidence remain release gates. |
| Files and Drive | Existing Google Drive API/OAuth integration and canonical UI | No real account/token/provider connection/upload acceptance; do not claim live external storage verified. |
| Moodboards | API-backed `MoodboardPreview.jsx` despite its legacy filename | Editor dirty guards and isolation of late responses need completion; no reason to invent another mock/data source. |
| Finance | Existing PostgreSQL-backed admin routes and safe non-admin projections; privacy/session principal suites | Attribution aliases and actual financial history need explicit reconciliation, not automatic identity remapping. |
| Users and team | Server ID/current role/activity/session version; administration and identity suites | Real Franco/Agustin independent account roster/linkage/recovery not provisioned or externally verified by tests. |
| Profile/configuration | Canonical profile and session transport; profile-session HTTP/browser evidence | Global settings/real provider and complete account recovery acceptance remain unknown. |

Cross-cutting gates: browser bearer still lives in XSS-readable localStorage. Integration62 replaces disabled remote DB certificate verification with strict chain/hostname/IP verification, TLS1.2 minimum and optional bounded in-memory CA certificate bundle. Actual provider chain/configuration remains unverified; no remote connection was inspected. DEV DesignPreview still has isolated local operations and sandbox entry points: preserve it as reference until explicit quarantine/retirement and release-artifact exclusion are verified, never merge business records automatically. Existing App/Vite/preview dirt remains user-owned. Deployment, populated staging upgrade/restore, approved account/capability mapping and production authorization are separate gates.

Next historical contract is additive reviewed batches over an existing visit, not removal of409 guards: explicit UUID selection/new manual video descriptions, per-video disposition, observed source/visit revisions, immutable request receipts and latest-review-per-video proof. Hash changes revalidate only selected UUIDs, never the entire visit. Contextual aggregate evidence cannot become cloned individual deliveries/approvals. The integration61 persisted069 guard is only a prerequisite, not implementation of that batch contract. TLS/session hardening and draft-loss findings are independently actionable before release.

## Database transport and next browser-session boundary

`database-transport.js` is a pure parser/policy builder used by the one `db.js` pool. Explicit validated fields replace passing the URL into pg again: URL query/fragment and TLS/path/host overrides are rejected before driver parsing or file IO. Missing URL exports only an inert refusing query/connect interface, not a pool using ambient PGHOST. Exact loopback remains plaintext for the isolated development harness. Remote targets require native chain/expiry verification and destination identity; IPv6 IP SAN uses OpenSSL X509 verification because installed Node24's DNS-to-ASCII path does not support a bare IPv6 literal. No custom string matching or trust bypass. Empty URL password stays explicitly empty instead of falling back to PGPASSWORD/.pgpass. Optional `RENDER_DB_CA_PEM` accepts only bounded actual CA certificates; do not supply private keys. Certificate paths and verification-disabling environment options are not supported. There is no automatic retry without TLS or verification. Operator CA/credential setup must be reviewed before an approved staging rollout; this code change does not configure a provider or deploy it.

Next browser transport contract (design only, not implemented): reuse existing JWT/current-identity/session_version verification while moving browser credentials to HttpOnly same-origin cookies. Bootstrap must provide server-issued non-credential session context plus CSRF binding; mutation requests capture that context so an old A operation cannot execute using a newly installed B cookie. Do not fabricate token:'cookie' to satisfy token guards. Protect login, multipart and logout as well as ordinary JSON writes. Ordinary401/context errors must not issue Set-Cookie: the browser applies cookie changes before JavaScript can reject late responses. An old logout must not erase B's cookie. Keep external bearer and signed Wilson separate without ambiguous fallback, preserve Drive OAuth state, and migrate browser guards/storage/proxy/bootstrap together. No wildcard credentialed CORS or unreviewed trust-proxy change. This remains a release blocker until implemented and physically/browser verified.

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
