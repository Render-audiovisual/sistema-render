# Render 2.0 — local rescue log

## Scope and safety

- Branch: `codex/render-2-rescue-local`, created from detached `dcc676c`.
- Existing modifications to `frontend/src/App.jsx`, `frontend/vite.config.js` and existing untracked preview/sandbox/review files were left in place. They are not new rescue work and must not be swept into a rescue commit.
- Pre-change source archive: `/private/tmp/render-rescue-backup.CYIqi6/source-before-rescue.tar.gz`. Excludes Git metadata, dependencies/builds, backend sandbox runtime and local environment secrets. This is a temporary source backup, **not** a production database backup or a durable disaster-recovery guarantee.
- This checkout has no `backend/.env` or `.env.local`, no inherited database/JWT variables; frontend production env declares a public Google client ID. No secret values were printed.
- Production database identity/hosting version remain unknown and were not queried. Sandbox configuration declares its dedicated loopback cluster; it was not reused.
- Ordinary backend startup/migrations/seeding/schedulers are not used for QA. Principal-schema integration must use the guarded, brand-new disposable fixture only.
- No deployments or commercial record changes are authorized/performed.

## Coordination

| Owner | Exclusive implementation scope |
| --- | --- |
| Main coordinator | `server.js`, `auth.js`, `db.js`, migration 054, current-identity and account-administration guards/tests, integration review |
| Finance/permissions agent | Report safe DTOs/tests; name-free task privilege predicates and production identity predicates/tests |
| Workflow agent | Piece/task decoupling, additive workflow vocabulary, unit tests and transition handoff |
| Architecture/session agent | Architecture/permission contracts; exact frontend identity and confirmed logout transport/tests |
| Independent QA agent | Guarded PostgreSQL harness and principal HTTP integration tests |

No agent owns `App.jsx` in this first integration. No visual rewrite or preview-to-production switch has happened.

## Implemented locally in first integration

- Non-admin report serialization uses explicit allowlists, including nested task metadata; administrator data is preserved.
- The application helper no longer marks linked content published or creates a real publication timestamp. Review also found a second coupling in migration 048's goal trigger; forward migration 055 removes it without changing historical rows. The expanded real PostgreSQL test confirms completion/reopening through API and SQL preserves unpublished and historically published editorial rows while retaining goal tracking/audit.
- Actual publication only auto-finalizes explicitly approved linked automatic tasks; legacy state storage is retained.
- New login tokens carry stable user ID and session version, HS256, issuer/audience and eight-hour expiry, not authority copied from names.
- Principal operational routes reload current account/role, reject inactive/revoked/deleted/legacy sessions and fail closed on database error.
- Logout invalidates all sessions of that account. Password, role/login and Google-link changes bump the version.
- Access/role/removal changes serialize protection of the last active administrator.
- Frontend retains exact server identity instead of renaming Agustín to Líder; logout attempts server revocation with a finite timeout and reports unconfirmed offline revocation.
- Real first Google subject binding is conditional and rejects conflicting/ambiguous accounts; external Google authentication has not been tested.

## Deliberately incomplete / gates before later phases

Phase 1 is not fully closed merely by these patches. Stable ID-based task ownership/collaborators, explicit five-state task storage and transitions, fine-grained review/publication capabilities and complete HTTP privacy coverage still need integration. Existing assignment/report grouping still contains historical name-based compatibility rules.

Franco/Agustín real accounts are **not provisioned or externally verified**. Only disposable synthetic accounts are permitted for tests; real roster/linkage needs an approved data-preserving transition. Existing sessions will require a new login when migration 054 and the API changes are applied together.

The existing bearer storage remains XSS-readable. HttpOnly sessions/CSRF and login abuse protection need a coordinated compatibility pass, not a silent cookie/CORS change.

No API-backed audiovisual registry/per-video editing, projects, personal-dashboard replacement, global light design or preview retirement has been delivered yet. These are subsequent phases, not examples to be reported as completed.

## Verification

Results are recorded after integration below; unit/static checks are not equivalent to database, browser, Drive or production validation. Existing opt-in database tests remain skipped unless explicitly run against the new isolated fixture.

- Backend regression run: 421 passed, 8 opt-in integration cases skipped, zero failures.
- Frontend page regression suite: 152 passed, zero failures.
- Frontend production build: passed locally; nothing uploaded.
- Independent principal HTTP/PostgreSQL fixture run: 2 passed (parent plus goal-boundary subtest); fresh migration chain through 054 and forward 055 upgrade of populated fixture history, real password login for distinct synthetic owner IDs, current-role downgrade, last-admin protection, nonempty financial sentinel privacy, inactive-account rejection, logout revocation and no publication/timestamp from task completion/reopening. Snapshot invariance and goal audit were checked. Fixture cluster stopped/removed. See `LOCAL_TESTING.md` for reproduction and limitations.
- Pure startup/isolation guards verify disabled principal import does not start listeners, database queries, timers or external fetch.

## Next integration (still phase 1)

1. Add nullable task-owner/collaborator ID relations and explicit, reviewed legacy-mapping support; do not reinterpret shared historical assignments.
2. Route task authorization and new assignment writes through IDs; update operational UI/API DTOs together and prove rename/collaborator-removal tests with PostgreSQL.
3. Adopt independent approval/finalization transition storage and explicit authorized publication recording, preserving original historical state values.
4. Expand HTTP role/privacy and last-admin concurrency coverage, then close phase 1 before connecting dependent production/project modules.
