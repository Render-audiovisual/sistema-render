# Workflow transition audit and integration handoff

Audit date: 2026-10-19. Scope: read-only source inspection and isolated unit QA; this document is the only file changed in this audit turn. Paths/line anchors below describe the inspected working tree, not a deployed database. Other contributors are editing shared files; re-resolve anchors before patching.

## Status and critical finding

The application-wide phase-1 contract is **not complete**. `workflow-contract.js` is additive vocabulary/policy, not an adopted server transition engine. `server.js`, `task-workflow.js`, client goals and frontend still use legacy task `publicada`. No deployment, actual schema state, migration execution or historical data was inspected.

The compatibility `publishPieceLinkedToCompletedTask` helper is now a zero-write no-op. That prevents its former direct writes, **but does not establish that task completion cannot publish a piece**:

- `backend/migrations/048_cliente_objetivos_mensuales.sql:43` defines `sincronizar_cliente_objetivo_tarea`; its block at lines 66–73 writes linked `publicaciones.estado='publicada'` and `fecha_publicación_real` when a goal-linked task completes. Reopening the task writes editorial `pendiente` and clears the real-publication timestamp.
- The `cliente_objetivo_tarea_cambio` trigger at line 82 fires on task state/title/assignee/metadata updates. A task write bypassing the helper, including an assistant write, still reaches this DB path if this migration is installed.
- Existing `backend/test/client-goals.integration.test.js:54` explicitly expects reopening a task to reset its publication to `pendiente`. This expectation must change; green current unit tests do not cover the trigger.

Request main prioritize a **new forward migration replacing the trigger function**, not editing migration 048 or assuming the helper removed all coupling. Preserve goal completion tracking and separately decide whether copy synchronization should remain. State/date synchronization must be removed in both directions of task completion/reopening.

## Current meanings and proposed next-phase contract

| Domain | Current representation | Next-phase meaning/storage |
| --- | --- | --- |
| Task review | `en_revision`, optional boolean `revision_aprobada` in `propiedades_extra` | Explicit persisted `aprobada`; authorized review event with actor/time/version |
| Task done | `publicada`, optional `finalizada_at` | Persist `finalizada` for new authorized transitions; legacy task `publicada` remains readable as finalized only |
| Editorial ready | `lista` | Ready, not actual publication and not inferred task approval |
| Editorial published | `publicada`, sometimes `fecha_publicación_real` | Explicit publication confirmation, separately authorized, with evidence/provenance and timestamp policy |
| Goal slot done | Mirrors task `estado`; `publicada` sets `completada_at` | Delivery completion, distinct from publication; dual-read finalized aliases without rewriting old slots/events |

Current helper policy permits confirmed editorial publication to finalize an **approved** linked auto-task, while still writing legacy task `publicada` for compatibility. Approval is state `aprobada` or strict JSON boolean `revision_aprobada:true`; string `"true"` is not approval. Already-finalized tasks are excluded. This policy is explicit, not approval inference from publication. Main must decide whether to retain this compatibility behavior or make publication entirely independent of task transitions in the next phase.

The contract constants are not an exhaustive legacy state enumerator: server/DB also contain historical `programada` and editorial accent variants (`en_revision`, `en_revisión`). Unknown legacy values must be preserved, not coerced to pending or approved.

## Exact integration patch sites and proposed owners

Owners below are requests to main, not assignments/messages already sent.

| Requested owner | Patch sites / source anchors | Required integration |
| --- | --- | --- |
| Main / DB owner | `backend/migrations/048_cliente_objetivos_mensuales.sql:43` and trigger at 82; task CHECK in `006_tareas_flujo_publicacion.sql:32` | New forward migration: remove task-driven editorial state/date writes; expand task constraint for `aprobada`/`finalizada`, retaining legacy values. Keep audit/slot updates, make finalized-alias recognition explicit. Do not execute here. |
| Main / server owner | `backend/src/server.js:2010` POST `/tareas`, `:2138` `ESTADOS_TAREA_VALIDOS`, `:2218` PATCH `/tareas/:id`, `:2340` finalization marker, `:2424` compatibility helper call | Adopt domain-aware validation and canonical new-write states. Preserve legacy API compatibility deliberately; derive workspace from stored task rather than trusting query flags for transition policy. Enforce approval where required and server-owned approval metadata. Completion/reopen must never mutate editorial publication/date. |
| Main / approval owner | `backend/src/server.js:2477` POST `/tareas/:id/aprobar-publicacion`; `backend/src/task-workflow.js` `isTaskLeader`, `isTaskFinalizer`, `getStateNotification` | Approval currently keeps `en_revision`, changes assignee and writes boolean/actor/time metadata; only video-editing tasks qualify. Persist explicit approved state with concurrency checks, define carousel/other task policy, revoke approval on material changes/rework. Approval must not finalize or publish. Adapt notifications separately. |
| Main / editorial owner | `backend/src/server.js:1632` PATCH `/historias/:id`, `:1798` PATCH `/publicaciones/:id`, `:3510` PATCH `/piezas/:id`; each route's `completeLinkedAutoTasks` calls | Route all actual-publication confirmations through one policy/transaction. Publications route sets/clears real date; generic piece route and story route do not implement equivalent timestamp handling. Preserve dates on non-publication updates and define explicit correction/retraction semantics. Avoid ID collision fallback selecting publication before story. |
| Main / transaction owner | Same editorial routes + `completeLinkedAutoTasks` | Current piece UPDATE and task UPDATE are separate pool operations. Define atomic commit/rollback and lock ordering with goal triggers; failures must not return an ambiguous partial success. Do not finalize unapproved tasks on content-only edits of an already-published piece. |
| Main / goals owner | `backend/src/client-goals.js:163–200` `prepareGoal`, `:340` `goalLinkTask`, `:421–427` `linkGoalTask` | Current task ranking, child eligibility, slot completion timestamps/counts depend on task `publicada`. Dual-read legacy/canonical task finalization; never infer task approval/finalization from editorial status when preparing new work. Existing preparation at line 190 seeds task `publicada` from published editorial rows: requires an explicit historical-import policy, not silent reinterpretation. Preserve family dedup, month/client/format matching and optimistic locking. |
| Main / frontend owner | `frontend/src/features/render-os/constants.js:3–14`, `utils/task-state.js:54–66`, `utils/production-visits.js:49`; `frontend/src/pages/WorkspaceReadOnly.jsx:203,225,431,444,1081` | Separate approval, finalization and publication labels/actions. Accept legacy done aliases on reads; send canonical new task states after backend/schema support. Retain production handoff checks; production completion is not editorial approval. |
| Main / goals UI owner | `frontend/src/pages/ClientesObjetivos.jsx:6,16,189`; `frontend/src/features/render-os/GoalTaskLink.jsx:84,90` | Finalize/reopen currently PATCH tasks with `publicada`/`pendiente`. Count delivery completion, not actual publication; show independent publication state when needed. Read both finalized representations, preserve goal history and deleted-task records. |
| Main / metrics owner | `frontend/src/pages/Clientes.jsx:102,326`, `frontend/src/clientesStats.js:84–118` `getResumenClientes`; `backend/src/report-access.js:37–47` | Client stats infer linked story/publication publication from finalized tasks even when editorial state is not published, and count unlinked completed content tasks, with dedup. Report daily summary calls task completion `publicadas`. Separate delivery/approval/publication counters and month attribution. Merely relabeling task cards does not fix metrics. |
| Main / auxiliary workflow owner | `backend/src/mia-supervisor-policy.js:112`, `mia-group-digest.js:4,129`; `backend/src/publication-dispatch.js:121` router | Audit parent-completion aliases and digest meanings. Dispatch destinations are simulated and stored with `simulado=TRUE`; scheduled/simulated sends are not actual publication evidence. Require provider confirmation/manual attestation policy before feeding editorial state. |

## Forward migration: no historical reinterpretation

1. Inventory actual installed constraints/triggers in a separately authorized QA environment. This audit did not connect to any database. Do not modify migration 048 in place; integration fixtures must stop reinstalling its old function after applying the new migration.
2. Add supported new states/schema without rewriting existing task, editorial, goal-slot or event rows. Replace trigger definitions prospectively; migration itself must issue no historical state/date DML.
3. Adopt dual-read/single-new-write task semantics: legacy task `publicada` means finalized, not proof of approval/publication. New transitions use `aprobada`/`finalizada` only after all validation/constraint consumers support them. Old records retain original stored values/timestamps unless a user explicitly transitions them later.
4. Store new approval provenance (actor/time/revision) and publication provenance independently. Never populate approval from existing finalization, or real publication dates from completion timestamps, scheduled dates, simulated sends, or migration execution time.
5. Existing editorial `publicada`/real dates may already have been inferred by the old helper/trigger. Preserve them as legacy/unverified provenance where evidence is absent; neither certify nor reset them automatically. Any correction/backfill requires a separately approved reconciliation with evidence and an audit trail.
6. Goal slots/events remain delivery history; do not rewrite historical event names/times or recalculate monthly quotas. Preserve October tracking boundary, prior months, deleted-task snapshots, publication links and dedup behavior.
7. Define reopening/rework transitions prospectively: invalidate review approval as policy requires, but do not unpublish real content or erase real-publication dates. Rollback must not reinstall coupling or coerce new canonical values into publication claims.

## Required integration acceptance tests (not executed here)

These are test requirements for main/QA, not claims of implemented coverage. PostgreSQL trigger behavior cannot be established by mockDB SQL-string assertions.

1. **Critical DB regression:** with a goal slot linked to task/publication, complete task via legacy `publicada` and canonical `finalizada`; publication state/date remain byte-for-byte unchanged. Reopen task and repeat title/copy/assignee/metadata updates; no editorial state/date changes. Test direct SQL writes as well as API writes, with installed forward trigger.
2. **All entry points:** POST task, PATCH task, goals UI completion/reopen, production completion and authorized assistant paths cannot publish editorial records. Cover stories, publications, both links, absent links, child tasks, non-goal tasks and goal-linked tasks. Goal slot may complete independently.
3. **Approval:** unauthorized approval/finalization denied; approved transition records actor/time/version exactly once. Forged metadata, string booleans, stale versions, invalid prior states and mismatched workspaces rejected. Review approval alone does not finalize or publish. Test editing and carousel policies, production exceptions, and approval revocation after material changes.
4. **Actual publication:** each story/publication/generic-piece route enforces the same explicit confirmation rules. Unapproved linked auto-tasks remain unfinished; approved eligible auto-tasks follow the documented policy only. Manual/historical/other-workspace tasks remain untouched. Already-finalized timestamps stable. Content-only updates cannot create a publication event or retroactively complete work.
5. **Atomicity/concurrency:** failure in linked-task/goal synchronization rolls back publication confirmation as defined; retries idempotent; approval/reopen racing publication cannot bypass approval checks or deadlock across task/slot/publication locks. Avoid duplicate events/notifications.
6. **Dates and identity:** generic `/piezas/:id` publication and story branches use explicit origin identity; same numeric story/publication IDs cannot target the wrong record. Publication date created only on genuine confirmation, not scheduling/review/completion; repeated confirmation stable; explicit corrections audited.
7. **Migration invariance:** fixture snapshots of old task/goal/editorial values, JSON, dates/events and older periods unchanged across forward migration, including previously coupled suspicious records. Canonical new states persist successfully; legacy states still readable. No inferred historical approval or publication verification.
8. **Goals:** preparation/linking a finalizada task fills one delivery slot, never publishes. Preparation from already-published editorial rows must follow the separately agreed import policy without inventing approval. Reopening never unpublishes; dedup, stale-version 409s, deleted-task history, account/feed scope and counts remain correct. Update `client-goals.integration.test.js` and `client-goal-links.integration.test.js`; replace assertions that entrench coupling.
9. **Frontend/metrics:** completion/reopen actions call task-only transition paths; approval action distinct from publication confirmation; legacy/canonical completed records render consistently after reload. Completed carousel task with unpublished/no linked publication increments delivery only, not published totals. Goals count completed delivery independently. Scheduled/simulated/partial dispatch is not publication.
10. **Authorization boundary:** exercise these through full production middleware with current identity/role/session checks, not router-only fixtures that trust old JWT role claims. Server transitions must use persisted workspace/capabilities even if query parameters are absent or forged.

## Bounded financial default-deny verification

`backend/src/report-access.js:51–102` uses scalar allowlisted DTOs before every non-admin/default branch of `filterReportDataForUser`. Unknown roles also pass through that allowlist. Admin intentionally receives original data. This is a **report-only guarantee**, not a global response sanitizer.

Verified by isolated in-memory sentinel check: nested financial metadata, an object under the otherwise allowed `revision_aprobada` key, editorial metadata and unknown top-level `finance` were removed for six cases (missing role, unknown role, community, design, production, editing). No database/network/env access. Existing report tests do not themselves include these financial sentinel assertions.

Other inspected operational routes:

- `/clientes` (`server.js:1275–1320`) explicitly omits `abono_mensual` and `abono_vigente_desde` for non-admins, but uses a denylist/rest spread rather than a future-proof DTO. Current SELECT does not include raw client metadata. `/contratos` and `/sueldos` are admin-gated.
- Client-goal public reads (`client-goals.js:49–85`, `goalLinkOptions`) project explicit operational fields; no raw task JSON or financial columns in their returned shape was found in these inspected paths. Internal `t.*` candidate queries do not by themselves prove a response leak.
- `/historias` (`server.js:1755–1792`) returns raw `h.metadata`; `/publicaciones` (`:1941–1979`) returns raw `p.metadata` to authenticated users without a report DTO.
- `/tareas` (`:2842` SELECT, response near 2998), `/tareas/:id` (`:3028–3065`) and `/tareas/:id/subtareas` (`:3071–3120`) return raw `propiedades_extra` after access scoping. Task-row authorization does not sanitize nested metadata. PATCH task responses also require the same DTO review.
- `/piezas` list (`:3205`) projects selected metadata keys, and `/piezas/:id` (`:3266`) projects operational columns without raw metadata; this is stronger than raw-bag routes but is not proof for every other router.

Conclusion: no claim that actual stored financial values leaked is justified without inspecting fixtures/data; nevertheless the requested application-wide “no raw metadata financial leaks” guarantee **is not established**, because source shows channels that would return such values if present. No global financial default function wrapping these operational responses was found in the inspected paths.

Request main/API-privacy owner introduce role-aware operational DTOs at these exact response boundaries (preserving needed operational keys), then add nested/top-level financial sentinels to list/detail/subtask/PATCH responses for every non-admin and unknown-role case. Include arrays, objects under allowed keys, prototype-like keys, and new unknown columns; verify read permissions and full middleware too. Do not fix by hiding fields only in frontend or by dropping all workflow metadata. Broader routers, free-text content, real stored records and deployed behavior remain outside this bounded verification.

## QA performed and limits

Executed only:

```sh
node --test backend/test/piece-task-linking.test.js backend/test/workflow-contract.test.js backend/test/report-access.test.js backend/test/task-workflow-contract.test.js backend/test/clientes-stats.test.js
```

Result: **25 passed, 0 failed**, pure/mockDB/static-source tests. One additional ephemeral in-memory report DTO sentinel check passed all six non-admin/default cases. Current client-stat test deliberately counts completed carousel tasks as publication: passing documents existing behavior, not acceptance of the new semantic split.

Not executed: server boot, integration test files, migrations, PostgreSQL, environment inspection, network/provider calls, frontend/browser flows or deployment checks. Existing integration tests can migrate/update a local QA database when enabled, so were read only. The migration-048 trigger finding and operational raw-metadata paths remain unresolved integration blockers. Only this new document was edited in this audit turn.
