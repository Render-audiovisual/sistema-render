# Current master review147 and client-catalog authority fix

## Executive status

Local development only, based on current source after146 (`a373d98`), not
stale STATUS entries. Render2 is NOT certified complete or production-ready.
The canonical app no longer imports the parallel preview/sandbox applications;
source preservation is not an operational duplicate. Project milestones are
already connected to the calendar. Do not reimplement either from older notes.

Main coordinated current-source review, implemented client-catalog snapshot and
server wiring, and ran checks. Beauvoir reviewed identity/finance and final SQL
parity; Poincare reviewed business contracts and authored five unit tests;
Hypatia authored isolated physical tests; Carver reviewed live UI persistence.
Structured/security skills guided evidence boundaries and the fresh-actor
authorization check. No agent simultaneously edited server.js.

## Evidence that changes next work

| Master area | Current evidence | What it establishes / does not establish |
| --- | --- | --- |
| One canonical app | App.jsx/main.jsx/Vite source and fresh canonical-entry + legacyRouteIntegration tests:17pass | Preview/local wrappers are absent from runtime import graph. Reference sources retained. Not full functional release approval. |
| Shared PostgreSQL operation | Current tasks, productions, projects, editorial, lists, feedback use server APIs; reviewed active storage uses are preferences/notification reads/position | No current commercial-localStorage source confirmed in these inspected canonical modules. Not an exhaustive scan of every reachable sink. |
| Task vs publication | editorial-publication.js:88-124; editing-deliveries.js:107-116; master-editorial-journey physical test:79-140 | Explicit confirmation/event separate from work completion, stale delivery approval rejected. Source/test coverage inspected, physical suite not rerun147. |
| Per-video editing | production-registry.js:301-328; editing-deliveries.js:44-56,98-107; production-full-workflow test:225-279 | Admin handoff, one linked editing task per video and replay/actor contracts exist. Not renewed native A-F acceptance. |
| Projects/objectives | projects.js:172-180,244-270; project-deliverable-approvals.js:40-60; client-goals.js; goal-quota-reconciliation test:88-196 | CAS, explicit deliverable approval and deduplicated quota reconciliation exist. No blind recreation or migration justified. |
| Milestone calendar | calendar.js CALENDAR_MILESTONE_SQL and calendarModel.js hito decoder/link | Already present; older statement “unintegrated” is historical. |
| Finance/identity | Report snapshot and financial-authority contracts; new catalog tests below | Fresh catalog revocation boundary verified. Other pending route races below prevent blanket authority approval. |
| Design/navigation/quality | Prior145/146 runtime evidence plus current source review | Incremental design progress, not uniform all-module/mobile/role acceptance. Native drag cancellation144 remains unproven. |

## Security findings — bounded, evidence-based

### S147-01 — Medium / P2: stale client-catalog administrative projection — FIXED locally

Rule: REACT-AUTHZ-001 / server authorization lifecycle. Original GET `/clientes`
projected query results through `clientOperationalDto(row, req.auth)` after a
pool query, relying on pre-query middleware authority. A valid prior admin
whose role/epoch/activity changed before the domain read could retain the
old financial projection. This was not anonymous access or ordinary employee
access to abonos.

Fix: `backend/src/client-catalog.js:36` captures immutable ID/role/epoch before
leasing. Its read-only repeatable-read transaction reads and validates actor
first, then commercial rows, then projects with that actor. Server route at
`backend/src/server.js:1146` retains period normalization and adds no-store.
Original columns, quota/config/abono effective-date selection, feed and ordering
remain; no new role whitelist or grant. Actor mismatches reject401 before
catalog query. Rollback errors discard the lease without replacing the cause.

Authorization is point-in-time at first snapshot: revocation after that
snapshot does not retroactively invalidate an old-consistent read. Next read
with old epoch rejects. Do not claim zero-time revocation after response begins.

### S147-02 — Medium / P2: administrative user catalog can retain stale projection — OPEN

Rule: REACT-AUTHZ-001. `backend/src/server.js:412-418` chooses administrative
email/link/revision fields from captured req.auth and executes a direct pool
query. It lacks a fresh actor/data boundary equivalent to Reportes/catalog.
Prerequisite: valid prior admin whose authority changes while request waits.
Proposed fix: actor + user projection in one verified read snapshot; preserve
operational staff catalog semantics. Reproduce with a pre-read barrier and
separate committed downgrade/revocation before declaring fixed. Source finding
only; no new physical exploit proof or change to this route147.

### S147-03 — Medium / P2: structure write lacks in-transaction authority retention — OPEN

Rule: server authorization lifecycle. `backend/src/server.js:1001-1022` checks
requireRole before direct UPSERT into estructura_cliente. A previously
authenticated admin can lose authority while waiting before domain DML.
Fix should retain validated actor authority during the write transaction,
with current input/resource checks, not simply add a React condition.
Need physical pre-DML authority barrier and zero-write assertion; not executed
or fixed147. Do not infer that a revocation after a valid serialized write
must undo already-authorized work.

No new claim about production TLS/proxy configuration, dependency advisories,
secrets or external accounts: these were not queried. Existing untracked
security_best_practices_report.md was preserved, not overwritten.

## Current operational/UI gaps — source-confirmed, not native reproductions

1. P1 data-loss protection: Historias.jsx:1351 guards creation only. Ordinary
   controlled-cell changes at1459 and queued save1471-1496 are not represented
   as dirty/busy/uncertain. A failed PATCH then sidebar navigation can lose the
   local text. Highest next implementation priority: parent-owned draft/baseline
   and intent generations, dirty before blur, queued busy, exact ACK clearing,
   preserve errors/uncertainty and block blind retry. Do not just add queue.size:
   the queue is removed when a failed callback settles. Keep CAS/session guards.
2. P2 read failure vs absence: Publicaciones.jsx:91-108 maps linked-task GET
   failure to[]; detail482-489 displays “No hay tareas vinculadas”. Add distinct
   unavailable/retry state, not invented empty success.
3. P2 context: Control-publications filters and selected personal-list page
   remain local state rather than shareable/reload-restored URL context.
4. P2 accessibility: PersonalLists.jsx:78 template modal lacks the shared modal
   focus/Escape/dialog contract. Needs runtime keyboard coverage.

## Fresh validation of S147-01

- Five focused unit tests plus existing DTO/report/read-snapshot tests:72pass,
  zero failed/skipped; `/private/tmp/render2-catalog147-pure-final.log`.
- Physical actual-schema PostgreSQL + HTTP suite:7pass (parent +6 cases), zero
  failed/skipped; `/private/tmp/render2-catalog147-physical.log`.
- Owner retains exact September/October/November quota/abono behavior. Employee
  and custom-role responses omit private amount/revision fields. Anonymous401;
  actual HTTP cache-control no-store. All read snapshots leave rows unchanged.
- Before-first-snapshot committed role downgrade, epoch revocation and inactivity
  each reject401 without executing commercial SELECT. Pre-lease caller mutation
  cannot switch actor. After-snapshot revocation + fee change yields only the
  old-consistent result; next old epoch denied, fresh epoch sees new fee.
- Syntax and diff checks pass. Frontend unchanged; no new frontend build or
  all-master physical journey execution claimed. Canonical entry17pass log
  `/private/tmp/render2-audit147-entry.log` is source/import-graph evidence.
- Fresh own fixtureWeOxK6/PG55797 only, explicit identity verified, all migrations
  confined to generated empty DB, no external fetch. Exit0/cleanup ENOENT and
  root absence confirmed. Only disposable fixture data removed. No commercial
  database, real accounts/providers, production writes, push or deployment.

Remaining findings and native/all-device/full-journey gates keep the full master
goal ACTIVE. This report is a bounded current review and one verified fix,
not an exhaustive completion audit or overall phase/release sign-off.
