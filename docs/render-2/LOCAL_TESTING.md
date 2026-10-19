# Principal backend: isolated local HTTP QA

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

Startup guard: 2 passed. Opt-in principal HTTP integration: 1 passed, covering all assertions above; every principal migration through 054 applied successfully without prerequisite manual seeds. Financial privacy uses a dedicated 987654.32 delivery visible in the admin response and an actual nonempty employee DTO without `importe`. Completion uses schema-supported `en_revision` plus `revision_aprobada=true`, not the not-yet-migrated `aprobada` state. No listener on 55594 or generated fixture directory remained afterward.

The restricted execution sandbox denied PostgreSQL shared memory (`shmget`); the authorized local fixture run required execution outside that sandbox. No existing database was connected or modified. Earlier fixture-only failures (missing publication date, unsupported task state, identity label mismatch) were corrected without changing the principal application or schema.

Follow-up 055 regression: the earlier unlinked-task check alone did not exercise the goal trigger from 048. The expanded opt-in suite verifies the real forward upgrade on populated history and both linked-task mutation paths; the original result must not be interpreted as having covered goal-linked tasks.

Latest verification (2026-10-19): expanded integration **2 passed, 0 failed** (parent Phase 1 plus linked-goal trigger subtest); no-DB startup guard **2 passed**. Upgrade snapshots include an existing historical goal event and a non-null real publication date. API and direct SQL each complete/reopen two goal-linked cases, checking full editorial-row invariance, goal status/completion timestamp and four new audit transitions per slot. HTTP also rejects last-active-admin role downgrade/delete and self-deactivation with 409, preserving the real login session. Final cleanup check found no fixture listener on 55594 and no `/private/tmp/render2-local-*` directory. No production or other existing DB was used.
