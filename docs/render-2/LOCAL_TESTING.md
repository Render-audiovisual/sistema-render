# Principal backend: isolated local HTTP QA

## Fixed core acceptance cohort (integration368)

From backend run `npm run qa:core:local`. The fixed coordinator executes33 principal-system integration files serially with a clean child environment (expanded384 with personal-block creation receipts and the populated093 upgrade rehearsal). It accepts no flags, database URLs or fixture overrides. Each file owns a disposable PostgreSQL cluster and verifies its cleanup; never substitute a configured development/production database.

In addition to the cross-sector, audiovisual, identity/finance, project, task and personal-list journeys, the cohort includes editorial control/detail/adoption and editing deliveries/reviews/approval. Editorial confirmation was already required. Adoption verifies evidence propagation into ordinary lists/reports, stable-ID/feed quotas and no implicit publication from task completion; its bearer/SQL fixtures and eight-table value snapshots do not prove browser behavior, all-table immutability or physical rollback failure. Keep those claims separate from cookie/native suites and injected pool-discard tests.

Passing this command is a local regression gate, not global acceptance, deployment readiness or publication to hosting. See CURRENT_ACCEPTANCE.md for current results and external gates.

## Browser build identity and post-login snapshots (integration361)

Build before starting the owned HTTP fixture. The principal SPA fallback captures index.html at server startup; rebuilding frontend/dist and reloading a deep link does not replace that in-memory manifest. The root static route may behave differently. Verify the actual module script hash in the browser DOM against the build log before attributing native results to a change. If it differs, close/verify cleanup of only the owned fixture and start a fresh one after the build. Do not restart or migrate a configured database or production server for this check.

For read-only UI journeys, take the immutable database baseline once after the explicit QA login has completed. Login legitimately changes auth_login_buckets. Do not silently exclude this table, reset the baseline after interactions, or declare a pre-login full-table comparison successful. Keep failed attempts and cleanup evidence separate from the final run. These rules do not turn a UI snapshot into proof of all authentication/provider/device behavior.

## Existing model binding adoption QA (integration69)

```sh
node --test frontend/src/shared/session/session-binding.test.js frontend/src/pages/personalListSaveQueue.test.js frontend/src/components/homeEditorialControl.test.js frontend/src/components/homeEscalations.test.js frontend/src/components/homeProductionPage.test.js frontend/src/components/homeTeamWorkload.test.js frontend/src/components/editorialPieceDetail.test.js frontend/src/pages/feedbackTaskInventory.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 backend/test/render2-browser-client.integration.test.js backend/test/render2-personal-list-persistence.integration.test.js
```

Both integration filenames above are real files; Node test selection can silently ignore an unmatched path when another path exists, so check selected subtest names/counts rather than assuming all requested paths ran. Final69 combined run has17 cases. The fresh guarded55682 browser-client fixture now imports actual existing loaders, editorial guard and personal-list queue: five loaders parse real principal cookie responses without writes; nested guard/queue transport persists exact private-list CAS; queued A/cookie B cannot write or retry as B. Separate55672 personal-list persistence fixture retains concurrent/BIGSERIAL/reorder proof. All fixtures are disposable and cleanup is asserted. Node Cookie jar is simulated; JSX wrappers are not switched or browser-certified. Legacy-mode compilation and frontend unit runs do not authorize enabling cookie mode before remaining caller migration.

## Serialized browser session controller QA (integration68)

```sh
node --test frontend/src/shared/session/browser-session-controller.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 backend/test/render2-browser-controller.integration.test.js backend/test/render2-browser-client.integration.test.js backend/test/render2-browser-sessions.integration.test.js
```

Controller tests inject a cooperative FIFO Web Locks-compatible manager and a simulated Cookie jar; they do not prove native browser lock/cookie policy. The new principal suite uses only fresh guarded55683 PostgreSQL with actual passwords/server responses, withholding login fetch resolution **after** real Set-Cookie is observed to prove logical cancellation cannot prematurely release the lock or restore local authentication. It verifies stale logout does not revoke B and normal current logout is confirmed. All pending gates, responses, controllers and own fixture cleanup are bounded by the test lifecycle. Unit tests separately cover reentrant disposal/logout and the verified-publication commit point. Real cross-tab notifications/page close/crash/network-hang recovery, mounted UI and HTTPS/proxy remain unverified; do not activate based solely on these tests.

## Frontend memory/intent boundary against principal (integration67)

```sh
node --test frontend/src/shared/session/browser-session-state.test.js frontend/src/shared/session/browser-api-fetch.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 backend/test/render2-browser-client.integration.test.js backend/test/render2-browser-sessions.integration.test.js
```

The new browser-client suite uses a fresh guarded55682 PostgreSQL cluster, actual principal password verification and a **simulated Node Cookie jar** adapter limited to its own API. It imports the exact frontend modules, verifies persisted private-list rows and all-table digest invariance on denied operations, and controls deferred header/body barriers. It tests cookieB/memoryA reads without exposing B JSON, unchanged captured mutation intent, stale clones/body consumers and late401 isolation. Bootstrap proof and cancellation are also unit tested. This does not install the modules in main/App, test a browser cookie policy or demonstrate successful cross-tab login/HTTPS/proxy deployment. Full UI migration remains necessary. Owned native response branches, gates, HTTP/PG fixtures and generated directories are cleaned; no existing database/provider is accessed.

## Principal browser-session integration (integration66)

```sh
node --test backend/test/browser-session-config.test.js backend/test/login-handlers.test.js backend/test/login-identity-wiring.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-browser-sessions.integration.test.js
```

The new harness option `browserSessions:true` is boolean-only and sets a fixed public test Origin `http://127.0.0.1:5195` in the sanitized child environment. The API still listens on an ephemeral numeric-loopback HTTP port; PostgreSQL is a fresh guarded55680 cluster. No arbitrary env or existing DB is accepted. The test explicitly provides Cookie/Origin/context/CSRF headers rather than a browser cookie jar. It verifies actual principal password/bcrypt/roster/rate checks and business persistence, but not real Google, TLS/proxy configuration, successful uploads or frontend cutover. Full-table digests distinguish operational invariance from documented rate reservations. Cleanup asserts exact own-root removal.

Runtime opt-in is off by default. Do not set RENDER_BROWSER_SESSIONS=true on an operator environment until the frontend no longer relies on bearer guards/localStorage and login concurrency/proxy/HTTPS acceptance is complete. Unit fixtures may inject a synthetic Google verifier; this is not a provider identity verification result. No token:'cookie' compatibility shim is permitted.

## Read-only resources regression (integration65)

```sh
node --test backend/test/moodboard-initialization.test.js backend/test/wilson-chat.test.js frontend/src/shared/session/moodboard-initialization.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-readonly-resources.integration.test.js
```

Physical opt-in uses only a fresh guarded PostgreSQL cluster on numeric loopback55679. It snapshots full public-table rows/timestamps via digests around actual principal GETs, tests explicit initialization, concurrent actors and held-lock revocation, preserves existing references and asserts exact own-root cleanup. It never connects a configured database or provider. The explicit initializer does not create example references; migration045 legacy seed content is intentionally unchanged. Separate recorded browser QA used its own disposable fixture and synthetic client, desktop and390x844 viewport; no claim of exhaustive accessibility/device acceptance or all-app GET invariance.

## Browser-session transport module QA (integration64)

From the repository root, using installed dependencies:

```sh
node --test backend/test/browser-session-transport.test.js
RENDER2_RUN_LOCAL_BROWSER_TRANSPORT=true node --test backend/test/browser-session-transport-http.test.js
```

The10 unit tests open no sockets. The9 opt-in HTTP cases create only their own ephemeral numeric127.0.0.1 Express listener, synthetic in-memory account query fixture and write counters; cleanup closes/asserts only owned sockets/listener. Ordinary discovery skips this HTTP fixture without creating a listener. Sandbox may require explicit permission for loopback listen. This does not start the principal server, connect PostgreSQL, read dotenv/configured credentials, authenticate Google/passwords or change data. It explicitly is not a browser cookie-jar/TLS deployment test. Controlled delayed logout verifies no response Set-Cookie can overwrite a newer session. The module is not mounted in principal server yet; principal/frontend cutover and GET side-effect removal remain required.

## Current startup/runner update (2026-10-19)

Ordinary server startup no longer authorizes migrations, seeds or default schedulers. See `STARTUP_SAFETY_CONTRACT.md` / `STARTUP_SAFETY_QA.md`. It requires explicit DATABASE_URL and RENDER_DB_ENVIRONMENT, ready ledger/core public schema, and rejects demo startup. Default CLI is help without a connection; migration apply requires reviewed local target identity and current plan. No production apply override is provided. Do not infer permission to connect an existing DB from these command capabilities.

The harness now reads actual identity/status and computes the real filtered plan before calling `runMigrations(pool,logger,{approval,deferredMigrations})`. Approval purpose isolated-fixture requires matching generated cwd/data directory and empty public schema; no fake ledger rows hide deferred files. Runtime defaults remain inert through RENDER_DISABLE_SERVER_START=true. Existing deferred-upgrade tests still apply the actual SQL and verify populated synthetic history.

`startLocalHarness({clusterOnly:true})` returns base:null and no imported/listening app. `launchActual({entry:'server'|'migrate',args,env,omitDatabaseUrl})` launches only those actual principal entrypoints in a sanitized, tracked child against the owned fixture. Arbitrary DB/key/host/Node-option overrides are rejected; even omitted URL uses fixture-only PG fallback to contain regressions. `ready`, `done`, `stop`, output and observed interval registrations are available. Cleanup stops every launched child before its exact cluster. This is test infrastructure, not another operational Render implementation.

Latest verification: **830 backend tests passed / 18 opt-in skipped; 129 isolated HTTP/SQL/process tests passed across eleven suites / zero skipped**, frontend pages152 passed and build passed. Startup guard5 and core-schema4 pure cases are included in backend totals. The 13-case actual startup suite verifies no implicit SQL attempts/intervals, schema failures, approved concurrent apply and rollback/lock recovery. External services/production not tested. Historical results below remain prior snapshots, not current totals.

Legacy `RENDER_GOALS_TEST_DATABASE=true` runners and `preview-client-goals.js` now reject before connecting; their historical assertions/code are preserved, not represented as current passing QA. Use guarded principal suites instead. Do not reactivate those paths or replay their historical functions on an existing database.

This is **not** the sandbox schema. `backend/scripts/render2-local-test.js` starts a new PostgreSQL cluster under `/private/tmp/render2-local-*`, bound only to `127.0.0.1:55594`, and creates only `render2_local_test` as `render2_fixture`. It never accepts an existing DATABASE_URL, database, or cluster directory. A busy port fails; it does not reuse the listener.

Before migrations the child checks its generated working directory, exact loopback URL, PostgreSQL database/user/address/port/data_directory and an empty public schema. Direct `--fixture-child` invocation with ordinary application environment is rejected. This is an accident-prevention boundary, not a sandbox against a malicious local OS user.

The child receives an environment allowlist, a newly generated JWT secret, `DOTENV_CONFIG_PATH=/dev/null`, and `RENDER_DISABLE_SERVER_START=true`. Existing secrets, Google/MIA/email credentials and PG connection overrides are not inherited. External `fetch` is rejected. This fetch guard does not intercept arbitrary raw socket clients; do not add integration credentials. The principal app is manually bound to an ephemeral loopback HTTP port, without the server's scheduled jobs.

## Baseline risks

All principal SQL migrations run in filename order, including commercial seeds and hardcoded historical changes: 007 merges/deletes historical administrative accounts, 023/026 rewrite Mariano identities, 033/038/039 deactivate commercial clients and 044 deletes completed tasks. These are permitted **only in this brand-new disposable DB**. No production dump is loaded. A baseline failure must be reported with its migration name; do not silently skip SQL, replace the schema with sandbox tables or run against an existing DB. Migration 054 must supply `usuarios.activo` and `session_version`; the harness checks their existence rather than adding fallback columns.

Fixtures are inserted after migrations with stable IDs: 91001 `qa_franco` (admin), 91002 `qa_agustin` (independent admin), 91003 `qa_luciano` (edicion), 91004 `qa_designer` (diseno). All use the local-only password `Local-only-fixture-2026!`, have NULL Google identities, and start active with session version 1. Inserts do not overwrite baseline identities; any collision fails. User sequence is advanced afterward.

## Commands (repository root)

No-DB startup guard:

```sh
node --test backend/test/render2-startup-guard.test.js
```

After main review/authorization, isolated Phase 1 integration:

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-phase1.integration.test.js
```

Ordinary `node --test` skips integration. HTTP assertions cover actual login sessions/8h issuer+audience tokens, separate leaders, legacy rejection, role downgrade on an existing token, non-admin money DTO privacy, inactive login/session rejection, logout revocation of all account sessions, and task completion without publication.

Interactive HTTP QA (expires after ten minutes; Ctrl-C cleans up):

```sh
node backend/scripts/render2-local-test.js
```

Reusable exports: `startLocalHarness({port, deferGoalMigration})`, `request`, fixture credentials, pure `assertFixtureIdentity`. Always use `try/finally { await fixture.cleanup(); }`. The returned query helper addresses only the child fixture pool; do not log the returned test JWT secret. HTTP requests time out after 5s; SQL after 15s, IPC after 20s, startup after 90s. PostgreSQL commands also have bounded timeouts.

`deferGoalMigration` defaults to false (normal full baseline). Only the upgrade test sets it true: the migration runner leaves 055 unapplied with the original 048 trigger attached, without writing a false ledger record. The test creates linked goal/slot/task/publication fixtures and snapshots every row of publications, stories, tasks, goals, slots and goal events; it then applies the actual `055_decouple_goal_publication.sql`, asserts byte-equivalent JSON row snapshots and records successful application. No old-function swap or sandbox schema is used. Both API and direct SQL complete/reopen paths must update goal status, completion timestamp and event history while leaving the full editorial row unchanged. Cases include an unpublished piece and an already-published piece with a historical real-publication date.

Cleanup stops the HTTP child (SIGKILL fallback), then stops the exact generated PostgreSQL data directory before removing it. Ambiguous shutdown retains the directory and reports its path; inspect `postgres.log` and use `/opt/homebrew/bin/pg_ctl -D <exact-reported-root>/data -m immediate -w stop` before removing that one fixture. Never target a shared directory or stop a cluster by port. Abrupt OS/process SIGKILL can bypass JS cleanup; use the same exact-directory recovery procedure. Normal completion should leave no fixture process/listener.

## Verified 2026-10-19

Historical results below are chronological. Current complete-suite results and limits are in STATUS.md.

Startup guard: 2 passed. Opt-in principal HTTP integration: 1 passed, covering all assertions above; every principal migration through 054 applied successfully without prerequisite manual seeds. Financial privacy uses a dedicated 987654.32 delivery visible in the admin response and an actual nonempty employee DTO without `importe`. Completion uses schema-supported `en_revision` plus `revision_aprobada=true`, not the not-yet-migrated `aprobada` state. No listener on 55594 or generated fixture directory remained afterward.

The restricted execution sandbox denied PostgreSQL shared memory (`shmget`); the authorized local fixture run required execution outside that sandbox. No existing database was connected or modified. Earlier fixture-only failures (missing publication date, unsupported task state, identity label mismatch) were corrected without changing the principal application or schema.

Follow-up 055 regression: the earlier unlinked-task check alone did not exercise the goal trigger from 048. The expanded opt-in suite verifies the real forward upgrade on populated history and both linked-task mutation paths; the original result must not be interpreted as having covered goal-linked tasks.

Latest verification (2026-10-19): expanded integration **2 passed, 0 failed** (parent Phase 1 plus linked-goal trigger subtest); no-DB startup guard **2 passed**. Upgrade snapshots include an existing historical goal event and a non-null real publication date. API and direct SQL each complete/reopen two goal-linked cases, checking full editorial-row invariance, goal status/completion timestamp and four new audit transitions per slot. HTTP also rejects last-active-admin role downgrade/delete and self-deactivation with 409, preserving the real login session. Final cleanup check found no fixture listener on 55594 and no `/private/tmp/render2-local-*` directory. No production or other existing DB was used.

## Database transport verification — integration62

Ordinary unit discovery does not open TLS sockets or generate keys. Pure configuration tests inspect the installed pg client parameters without connecting. A child-process inert-import test forbids every net.Socket connection and confirms that missing DATABASE_URL rejects query/connect even with an inherited PGHOST. New code does not use that inherited target.

Opt-in TLS test, from repository root:

```sh
RENDER2_RUN_LOCAL_TLS=true node --test backend/test/render2-database-tls.integration.test.js
```

Requires the installed `/opt/homebrew/bin/openssl` (verified OpenSSL3.6.3) and permission to listen on temporary127.0.0.1 ports. Generates its own public CA/leaf certificates and disposable private keys under an exclusively created, mode0700 `/private/tmp/render2-tls-*` directory; keys are mode0600 and never printed/committed. Only case-owned sockets/listeners are destroyed; the exact validated directory is removed and absence asserted. No DNS lookup or remote connection occurs: a test-only socket routes the original remote destination to the numeric loopback listener while preserving pg's destination/SNI/verification. The production builder exposes no routing override.

This uses installed pg's actual SSLRequest/TLS and synthetic AuthenticationOk/ReadyForQuery, not a PostgreSQL database or real password/SCRAM/SQL test. It proves certificate trust, expiry and destination identity checks before Startup, including IPv6 IP SAN. It does not validate provider certificates, account credentials, network/firewall configuration or cloud deployment. Existing principal PostgreSQL suites independently exercise the real schema/business persistence on plaintext exact loopback; neither proof substitutes for the other.

Combined isolated regression, only after reviewing the current harness/tests:

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true RENDER2_RUN_LOCAL_TLS=true node --test --test-concurrency=1 backend/test/render2-*.integration.test.js
```

Rollout gate: use an explicit PostgreSQL TCP URL without query/fragment; do not depend on PGHOST/PGPASSWORD fallback or pg SSL URL parameters. For a private issuer, configure the reviewed **public CA certificate bundle** in RENDER_DB_CA_PEM; never put a private key there. Empty/malformed/non-CA PEM fails closed. Remove conflicting PGSSL* and verification-disabling Node options. Remote verification never downgrades or retries in plaintext. No operator environment, existing database, provider connection or production setup is changed by this test workflow.

## Build/fixture ordering

When the principal QA harness serves `frontend/dist`, finish `npm run build` before starting that harness or its HTTP suites. Vite replaces `dist` during build; concurrent startup can fail reading `dist/index.html` and does not establish an application regression. Do not rebuild underneath a running browser fixture. Stop only the fixture created for the current test and verify its exact generated directory was removed.
