# Login identity local QA

## Coordinator execution record — 2026-10-19

Supersedes the historical authorship status below. Main executed the actual new suite:12 passed,0 skipped/failed, including the real held-row-lock case. Log `/private/tmp/render2-login-identity-http.log`. Physical root `/private/tmp/render2-local-6kgNiw` cleanup and absence verified. Combined all23 principal HTTP/PostgreSQL suites also executed:278 passed,0 skipped/failed, log `/private/tmp/render2-login-identity-all-http.log`, with owned cleanup asserted. Two initial setup attempts exposed invalid synthetic sentinel INSERT assumptions (missing required assignment label, then a nonexistent inline assignment-ID column); Main corrected test data to the actual task schema without changing application/schema requirements. Failed fixture cleanup was asserted by the hook; the diagnostic failed root `/private/tmp/render2-local-Eo6HHZ` absence was separately checked. Final successful sentinel remains deliberately historical/label-only, not an inferred user assignment.

Main also executed full backend1129 passed/30 explicit opt-in skipped/0 failed (`/private/tmp/render2-login-identity-final-backend.log`), full frontend337 passed/0 failed (`/private/tmp/render2-login-identity-frontend.log`), Vite130-module production build and diff check. Existing22 principal HTTP suites266 passed/0 skipped/failed after the ambiguity fixture was changed to a real configured Google-email collision; notification-only collision semantics are independently covered by the new suite. The combined23-suite execution above is a separate actual run, not arithmetic inferred from independent totals.

Poincare owned resolver+9 pure tests; Descartes independent SQL/HTTP suite and this original QA handoff; Hypatia Employees copy/no-prefill+3 source tests; Beauvoir final read-only security review, no confirmed P1/P2 in the scoped delta. Coordinator owned contracts/server wiring+2 tests, ambiguity compatibility fixture, setup correction, execution/build/cleanup/docs/commit. No concurrent server writer or worker fixture startup. Superpowers and Security Best Practices guided disjoint ownership, trusted-provider boundary and minimal non-provisioning correction. Preexisting App/Vite/preview dirt preserved and excluded.

Implementation and test-proven local behavior: notification routing no longer grants or shadows a login identifier; canonical username/configured Google-email password login remains unique and active; actual admin Google-email reset revokes previous sessions. Stable subject takes precedence over provider email attributes. First binding rechecks ID/email/version/activity/subject after an actual database row-lock wait; a concurrent reset/revocation/deactivation/competing subject cannot be overwritten. Current UPDATE RETURNING prevents stale name/role output. Real uniqueness conflicts return409 without retry; concurrent identical subject cannot duplicate users. Business history snapshots remained unchanged. These are actual principal HTTP tests for password/admin/current-session paths and actual exported-resolver SQL tests for Google linking, not a mock provider login endpoint.

Compatibility and release gate: notification-email-only password aliases stop working in the new local implementation. Before rollout, communicate/rehearse canonical username access or deliberately configure Google email; do not automatically copy notification email, generate aliases, rename users or backfill shared histories. No new real identities, accounts, credentials, providers, migrations or deployments were created. No real Google verification/browser journey was executed in this delta; existing actual Google library verification/audience check remains before resolver by source-wiring tests. No global DB timeout/TLS/session-transport hardening claim. Real independent roster/onboarding, recovery/relink policy, existing migrations/rollback, stable-browser validation and broader master consolidation remain gates. Goal remains active.

## Original independent author handoff

Status: READY — authored and frozen; runtime validation pending Main's explicit request. No database, harness or server started during authorship. No production/provider claims.

## Scope and execution gate

Owned files only: `backend/test/render2-login-identity.integration.test.js` and this document. Contract: `LOGIN_IDENTITY_CONTRACT.md`, read fully. No harness/server/schema edits or commits. Unrelated dirty files preserved.

Normal discovery skips the suite unless `RENDER2_RUN_LOCAL_INTEGRATION=true`. Resolver imports are inside the gated callback, before provisioning, so a missing helper fails before PostgreSQL startup. After Main explicitly authorizes execution:

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-login-identity.integration.test.js
```

The suite calls existing `startLocalHarness({ port: 55628 })` once. This creates a fresh physical local cluster, runs real migrations and serves the principal application on its own ephemeral HTTP port. Resolver SQL uses an explicit fixture-only pg pool, never environment database settings; physical identity is checked against the harness-generated data directory. Cleanup closes that pool, invokes harness cleanup and asserts the fixture directory is gone. Cleanup is authored, not yet runtime-confirmed.

## Coverage

- Actual HTTP password login: canonical and configured Google email, case normalization, incorrect password, notification-only denial, notification alias unable to shadow another canonical identifier, cross-column ambiguity denial.
- Actual admin HTTP email changes and permissions: notification routing preserves session identity; Google email change clears subject, increments version, invalidates old sessions and old email login; canonical login persists. Current role and deactivation are checked through `/api/sesion` and login.
- Exact exported helper contract: `findPasswordLoginIdentity(pool, identifier)` returns a unique row or null; `resolveGoogleLoginIdentity(pool, payload)` returns an identity row and uses status-bearing expected errors. Tests expect 401 invalid claims, 403 unknown/inactive, 409 stale or unique-subject binding races.
- Real SQL first binding and subject-first resolution despite provider email changing to another configured account. UPDATE RETURNING must reflect concurrent name/role changes, not stale lookup fields.
- A controlled pool.query wrapper executes all resolver SQL unchanged. After a real lookup, immediately before the first real binding UPDATE, it commits an admin email reset, version revocation, deactivation or competing subject through separate HTTP/SQL work. Each must fail 409 without retry and preserve the complete post-admin user row.
- One actual row-lock-wait regression uses dedicated locker, resolver and observer clients within the four-connection pool. The locker holds `BEGIN`/`SELECT FOR UPDATE`; a wrapper barrier confirms the candidate read and intercepts immediately before UPDATE. After releasing the barrier, fresh `pg_stat_activity`/`pg_locks` observations must identify that exact resolver UPDATE waiting on a non-granted lock with the locker PID in `pg_blocking_pids`. Only then does the locker change email and session version and COMMIT. The resumed resolver must return 409 and preserve the entire committed row without binding. An eight-second failure deadline, existing ten-second statement timeout, fifteen-second idle-transaction limit and finally rollback/drain/release bound failures; no sleep or assumed delay establishes blocking.
- Real PostgreSQL 23505 race: another account acquires the intended subject after lookup; resolver must return 409 and leave both accounts correct.
- Two simultaneous same-subject calls rendezvous before UPDATE. At least one must bind; any successful result must be the same account, any loser must fail 409. No duplicate subject or version change is permitted. A bounded barrier prevents indefinite waits.
- Nonempty task sentinel and full ordered snapshots of task/editorial/history/delivery tables must remain unchanged.

Unique Google email/subject indexes remain installed and authoritative; this suite never drops them or fabricates an impossible duplicate physical state. Duplicate-candidate fake-pool cases belong to the resolver unit suite. The wrapper does not fake query rows, SQL errors or resolver outcomes.

## Limits and pending evidence

### Separate self-profile/session acceptance — integration57

`render2-profile-session.integration.test.js` is a new actual principal HTTP suite, not execution of the Google resolver suite discussed above. Fresh disposable PG55670 proves: photo update/removal keeps the same ID/session version; wrong-current-password/duplicate/another-user bodies cause no account writes; username and password changes revoke both existing sessions, issue no replacement token, and require correct new credentials for the same ID. A real row-lock barrier revokes the actor after photo request authorization but before its UPDATE; ID/session-version/active CAS returns401 with no write. Backend self-profile routes no longer resolve a mutation target by a mutable username.

Both credential routes return machine code `current_password_invalid` for an incorrect current password. This is a form error, not evidence that the bearer session is revoked. The global frontend transport preserves explicitly supplied Authorization, captures the actual sent token/ID/role and clears only a still-matching current session on401. It inspects a clone only for the two credential-error paths, preserving the response for the caller; login failures do not clear another current account. Pure tests exercise late401 A→B, changed identity, anonymous/custom credentials, offline errors, API base/options and current-session invalidation. Bootstrap uses that tested helper. No claim all other asynchronous logout/account-switch interactions are certified.

Profile applies only a validated same-ID server photo DTO, normalizes server null photo to empty presentation while preserving ID/token/known activity, and ignores late/unmounted/different actor/token/role responses. Successful credential changes clear only the captured current local session and redirect to login rather than resaving a revoked token. Failure leaves form/session intact. Actual browser removed a synthetic photo, navigated Home, reloaded and reopened Profile with the same authenticated fictional identity; mobile width390 equals document width390. No username/password was changed through browser UI; those checks used only synthetic HTTP fixture accounts.

Final57 logs `/private/tmp/render2-profile-cross-sector-http-final.log` (12 tests including separate cross-sector suite), `/private/tmp/render2-profile-session-{backend,front,build,unit}.log`; screenshot `/private/tmp/render2-profile-session-mobile.png`. No real account, provider or production validation is implied.

The authored suite includes both committed read-to-update races and an observed PostgreSQL row-lock wait; neither has been executed by this author. Direct resolver payloads are synthetic claims, not external Google verification. No Google/Drive/provider requests, real accounts, roster/backfill, browser validation, production access or deployment. A passing run must not be described as provider/browser validation.

Main still needs to request the isolated run, record results and physical cleanup, and run the complete backend/frontend regressions and existing principal HTTP suites. READY freeze means no additional execution or edits without Main's direction.
