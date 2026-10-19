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

## Second integration — stable task membership (2026-10-19)

Implemented locally: migration 056 adds normalized owner/collaborator IDs without inferring historical membership; migration 057 adds an integer revision incremented on every task update. Principal task ACLs use IDs, and assignment replacement is transactional with active-recipient revalidation. Stale assignment edits and stale approval handoffs return conflicts rather than restoring revoked collaborators. Main task DTOs and workspace pickers carry IDs/revisions; duplicate display names remain distinguishable.

New automatic task writes from pieces, goals, legacy production visits and Wilson now persist normalized bindings. Wilson retains legacy name-based integration policy/filtering: this is a documented unresolved boundary, not a claim of full authorization unification. Production visits still create a legacy aggregate editing task; per-video creation remains Phase 2 work.

Coordinator integrated server/API/transactions; Arendt supplied assignment helpers and independent review; Herschel integrated the operational workspace; Archimedes integrated goal and Wilson writers; Wegener independently exercised isolated HTTP/PostgreSQL regressions. Shared server changes remained coordinator-owned.

Verified after integration:

- Backend regression: **461 passed, 9 opt-in cases skipped, 0 failures**.
- Independent disposable PostgreSQL/HTTP suites: **17 passed, 0 failed, 0 skipped**. Includes original security/publication regression, migration 056 preservation of populated history, ID ownership with homonyms, rename, next-edit collaborator revocation, explicit legacy binding, inactive-recipient rejection, injected SQL rollback, exact-revision conflicts, publisher-ID approval handoff and automatic piece-task ownership. See `ASSIGNMENTS_QA.md` for scope and reproducible commands.
- Frontend production build passed locally. No upload or deployment.
- Browser smoke on the principal app with disposable accounts: create a task, assign owner/collaborator, reload, log in as editor, edit and reload. Desktop and 390px mobile checked; no document-width overflow in that mobile route. This smoke preceded the final integer-revision guard; it is not a complete post-change browser E2E suite or global responsive certification.

Important rollout gate: historical name-only tasks deliberately remain unbound/read-only for non-admin mutation until explicitly assigned by an administrator. No real roster was mapped and no real accounts were provisioned. Forward migrations are prepared and verified only in disposable development fixtures, not applied to a commercial database. The active-recipient locking path passed regression, but concurrent deactivation was not directly stress-tested. Wilson transaction wiring has unit/static coverage, not a dedicated real PostgreSQL integration test.

The principal app and preview have not yet been consolidated visually or operationally. Phase 1 remains open: five-state storage/transitions, explicit review/publication capabilities, remaining integration authorization boundaries and broader privacy/concurrency coverage must be resolved before claiming the core contracts complete. No production change has occurred.

## Third integration — external identity and supervisor boundaries (2026-10-19)

Implemented locally: Wilson human requests now resolve one active database identity, including explicit numeric Telegram actor bindings. Current DB admin role replaces hardcoded external owner/name privilege. Task reads/writes/review use normalized membership even in groups; review confirmation rechecks membership after task locks. Transport claims never grant a role. The service actor is limited to existing service endpoints. V2 signatures bind the full request target, including query, and both Python clients were adapted together.

Supervisor snapshot/task loads use ID membership and active users. Replays for replies, agreed dates and blocker responses now check current identity, operation, task and permissions before returning a previous result; legacy unscoped hashes fail closed. Authorized completed-task replay does not repeat writes. Employee follow-ups remain available, rather than hiding the supervisor behind an admin-only gate.

Archimedes implemented Wilson, Herschel migrated supervisor identity/replay, Arendt performed independent read-only review, Wegener exercised signed HTTP QA, and the coordinator integrated harness/client changes and regressions. QA found a real title-only PATCH failure with homonyms; the fix preserves omitted memberships without re-resolving historical labels. Renamed owners were then verified over HTTP on both channels.

Verification:

- Full backend: **501 passed, 10 opt-in cases skipped, 0 failures**.
- Signed Wilson HTTP/PostgreSQL: **12 passed, 0 failed, 0 skipped**, repeated after final readiness. Independent RSA framing and actual current-role, disabled/ambiguous-account, homonym, group, revoked membership, review and rename checks. See `WILSON_QA.md`.
- Existing supervisor PostgreSQL integration: **19 passed, 0 failed, 0 skipped**, run with a fresh guarded harness on 55597 and an isolated synthetic schema; exact fixture cleanup completed. New relink/replay-specific cases use mocked transaction tests, not a claim of real HTTP replay coverage.
- Original session/financial/publication and assignment HTTP/PostgreSQL regressions rerun: **17 passed, 0 failed, 0 skipped**. Injected assignment SQL error is intentional rollback coverage.
- Python signing-framing test invokes only a pure function: no keys, credentials, network or external transports used. No visual changes or new browser certification in this block.

This is **implemented and tested in development**, not production-ready as a whole. Before an authorized release, real account mappings and a coordinated server/client signing cutover are required. No mappings of real people were invented. `WILSON_IDENTITY.md` records compatibility gates and unresolved feedback ACL, durable replay, idempotency, capability and callback-transaction work. Phase 1 remains open; canonical task transitions, audiovisual per-video persistence, shared projects/dashboard, unified navigation/design and retirement of parallel operational implementations remain pending. Nothing has been deployed.

## Fourth integration — canonical work states (2026-10-19)

Implemented locally: task storage/API/workspace now support `pendiente → en_progreso → en_revision → aprobada → finalizada`. Legacy task `publicada` is readable as finalized and compatible final-state input becomes canonical, without rewriting historical rows. Forward migration 058 expands the CHECK, preserves historical snapshots and updates goal completion tracking without touching editorial publication state/date.

Approval is admin-only from review with server actor/time evidence and an integer revision. Finalizing ordinary work requires actual approved state. A complete actual production visit retains its explicit authorized completion exception; other production work cannot skip approval. The server derives production validation from persisted workspace even if the query parameter is omitted. Rework clears approval evidence; the shared database trigger also invalidates approval on changed instructions, material or work copy, including non-UI writers. Client-supplied approval metadata cannot establish approval.

The operational workspace shows five columns and canonical list/calendar filters. Generic approval does not require assigning a publisher; the existing optional publisher-ID handoff remains available. Goals, reports, task priorities, delivery calculations, notifications, supervisor and integration readers recognize canonical and historical completed work while keeping approved distinct. Client publication statistics no longer infer an editorial publication from a completed task. No destructive retention predicate was expanded.

Coordinator owned server/contracts/migration and integration; Herschel handled operational task UI; Archimedes handled goals/linking/integration consumers and independent server review; Arendt handled cross-module readers/metrics and task controls; Wegener independently tested PostgreSQL/HTTP. Review identified and corrected the omitted-workspace production bypass and approval invalidation gap.

Latest verification:

- Backend: **529 passed, 11 opt-in cases skipped, zero failures**.
- Frontend page suite: **152 passed**, zero failures; build passed.
- Four principal disposable HTTP/PostgreSQL suites together: **39 passed, zero failures/skips** (sessions/privacy/publication, assignments, Wilson identity, canonical workflow). Workflow suite contributes 10 tests, including populated-history migration invariance, exact canonical states, approval permissions/revisions/forgery, rework, actual separate editorial publication, production exception and omitted-workspace denial.
- Browser smoke on principal app, not preview: created a fictitious editor task, moved through progress/review, approved, finalized and reloaded; persisted `Finalizada` visible. Desktop and mobile 390×844 detail inspected, document width 390. Screenshots: `/private/tmp/render2-canonical-task-desktop.png`, `/private/tmp/render2-canonical-task-mobile.png`. No global responsive/accessibility certification is claimed.
- Exact interactive fixture `/private/tmp/render2-local-ebiFQu` stopped/removed by its harness; automated fixture cleanup hooks completed. No real data or external service was used.

Still a development integration, **not a completed Phase 1 or production rollout**. Open gates include specialized production-record correction/confirmation concurrency, finalized-content locking/reopen policy, finer review/publication capabilities, feedback ACL/durable replay/idempotency, equivalent operational response privacy and consistent editorial publication provenance across routes. Live financial payroll equivalence and real historical account mapping require an approved staging rehearsal; unit handling of canonical delivery states is not production payroll validation. The API-backed per-video audiovisual registry, projects/dashboard, consolidated navigation/design and preview retirement remain pending. No deployment occurred.

## Fifth integration — production write concurrency (2026-10-19)

Implemented locally in the principal API: specialized recording add, correction and confirmation require a positive integer `expected_revision`. Task locks and normalized assignment ACLs precede mutation; stale revisions return 409 without overwriting JSON. Responses carry the updated revision and ID memberships. Correction previously lacked both an ownership predicate and the task-type fields needed to recognize a visit; these are now checked on the locked row.

Corrections preserve original record IDs/quantities/dates and audit the selected change with a verified user ID. Derived current-month/advance allocation is recalculated in stored order for all records, avoiding stale allocations after an earlier correction. Correction resets confirmation/approval/finalization evidence and recomputes progress. Reopening finalized visits also uses the canonical transition policy, so assigned designers/editors cannot bypass finalizer restrictions through this endpoint. Membership-scoped recording by verified team members remains available before finalization.

Confirmation can participate in an externally owned transaction. The Wilson confirmation token, locked visit update, existing aggregate editing-task insertion, assignment bindings and audit now commit or roll back together; notifications occur only after commit. Wilson task detail/intake exposes revisions, and the Python confirmation command now requires `--expected-revision` (the same revision must be present in the confirmation proposal payload).

Workspace sends the revision of the task visible to the user, not an automatically newer hidden ref. On 409 it refreshes the task but preserves entered values/buffer and never automatically retries a non-idempotent recording operation. A subsequent deliberate attempt uses the refreshed visible revision.

Coordinator owned server/CLI integration and regressions; Herschel handled UI/version behavior; Archimedes handled the Wilson transaction adapter; Arendt implemented the pure allocation correction helper and independently reviewed the server; Wegener performed independent concurrent HTTP/PostgreSQL and signed-transaction fault injection.

Verification: **567 backend tests passed**, 12 opt-in cases skipped, no failures; **152 frontend tests passed** and build succeeded. Five disposable principal HTTP/PostgreSQL suites together: **49 passed, no failures/skips**. The production suite contributes 10 tests and was repeated after the last progress-counting adjustment. Real races produce one success and one conflict; revoked membership/homonyms, malformed versions, stale/duplicate confirmation, correction rework/finalizer policy and task-insert rollback are covered. A real signed Wilson audit failure after the callback proves the token, task revision, editing task and bindings all roll back; retrying the same token/revision succeeds once. See `PRODUCTION_CONCURRENCY_QA.md` for exact evidence and cleanup.

No new schema migration, existing database, external transport or production deployment was used. This block has build and isolated HTTP coverage, **not a new browser/mobile recording-flow certification**. The current handoff is still the legacy aggregate editing task per visit: per-video IDs, individual editor/deadline selection, normalized shared production registry and its replacement UI remain unimplemented Phase 2 work, not completion claims. Fine-grained capabilities, operational DTO privacy, remaining Feedback/replay gates and the rest of the master goal remain open. Historical real quantities/allocations were not bulk recalculated.

## Sixth integration — operational structured-finance privacy (2026-10-19)

Implemented locally: shared role-aware operational DTOs for task, editorial and client resources. Non-admin/missing/unknown-role responses use explicit top-level and nested field schemas; authorized current admins preserve their management data. Unknown structured financial bags and objects hidden beneath allowed scalar names do not pass through. Valid histories/files/scripts are not silently truncated, and serialization never deletes hidden source data from storage.

Principal wiring covers task list/detail/subtask/create/PATCH/production/approval/recommendations and linked tasks; editorial histories/publications/pieces read/applicable write responses; client list. Wilson task reads/matches/previews/duplicates/writes/retries/confirmation and web-chat task context use the same boundary. Verified human DB role—not transport name or system actor—controls any admin bypass. Existing permissions still run independently.

Coordinator owned principal routing and regression adaptation; Arendt implemented/reviewed shared schemas; Archimedes integrated Wilson and independently reviewed touched response paths; Herschel audited actual frontend metadata compatibility; Wegener performed synthetic financial fault-injection HTTP QA. QA found an `_req`/`req` wiring error in two editorial handlers; the handlers were corrected and the unchanged privacy/success assertions rerun.

Verification: **599 backend tests passed**, 13 opt-in cases skipped, no failures; **152 frontend page tests passed**. Six disposable principal HTTP/PostgreSQL suites together: **59 passed, no failures/skips**. New privacy suite contributes 10 tests across six real non-admin/unknown-role sessions, read/write and production DTOs, a BEFORE INSERT poison trigger proving nonempty create data is actually filtered, and authorized admin raw/finance controls. Legitimate revisions, ID memberships, copy/scripts/scenes, recording records and attachment links remain visible. Fixtures stopped/removed via their exact cleanup hooks; no existing database or real financial data was inspected.

No new schema migration, frontend design change, external service call or deployment. Browser compatibility is not newly certified by this backend block. See `OPERATIONAL_RESPONSE_CONTRACT.md` and `OPERATIONAL_PRIVACY_QA.md` for resource scope and exclusions. This is **not an application-wide privacy certification or Phase 1 completion**: feedback ACLs, independent message/notification/dispatch payload schemas, durable replay/idempotency, capability policy, finalized-content handling and real account/Drive verification still need work. Free text and file contents are not automatically classified or redacted. Per-video production, projects, personal dashboard, consolidated navigation/design and preview retirement remain pending master-goal requirements.

## Original next-integration checklist (items 1–3 now partly implemented as above)

1. Add nullable task-owner/collaborator ID relations and explicit, reviewed legacy-mapping support; do not reinterpret shared historical assignments.
2. Route task authorization and new assignment writes through IDs; update operational UI/API DTOs together and prove rename/collaborator-removal tests with PostgreSQL.
3. Adopt independent approval/finalization transition storage and explicit authorized publication recording, preserving original historical state values.
4. Expand HTTP role/privacy and last-admin concurrency coverage, then close phase 1 before connecting dependent production/project modules.
