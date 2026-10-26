# Editing progress v1 — frozen sidecar draft

Status: NOT INTEGRATED. No route mount, writer hook, migration, configured DB,
production access or deployment is included. Main owns critical-file integration
and schema reservation. 051/052 are recognition-only: never replay their data
operations. This unit's mock tests are separate from Main's reported b65d8d3
core 387/backend 2923 passing baseline, which excludes these drafts.

## Checkpoint verification — 2026-10-26

Main repeated the 24 unit tests successfully. The offline CLI now exposes
`editing-audit --period YYYY-MM [--editor-id ID]`; its 21-test contract suite
passes, without signing or sending requests to a provider. Default scope stays
historical, never implicitly user9.

The proposed DDL was tested on a fresh isolated PostgreSQL fixture55990:
9 PASS, 0 FAIL, 0 SKIP, including exact catalog deparse, paired historical
evidence, wrong-task delivery FK rejection and incompatible-schema rejection.
Publication bytes/xmin/ctid and the existing migration ledger remain unchanged;
fixture cleanup verified ENOENT. This is synthetic proposed-schema validation,
NOT an upgrade rehearsal or verification on all supported database versions.
Initial test failures were fixed in synthetic data/expectations (required
assignee, unsupported assumption about unique-subset references, and isolating
one check failure at a time); no source guard was relaxed to pass the test.

General suite with these drafts:2,948 PASS/185 opt-in SKIP/0 FAIL of3,133.
Physical checks were run separately; skips are not counted as verification.
Logs: `/private/tmp/render-editing-progress-schema-main.log` and
`/private/tmp/render-refresh-backend-with-audit-draft.log`.

No integration was enabled: delivery writes, existing routes and production
schema are untouched. Still required: safely generated migration, old-trigger
replacement, preserved-data upgrade test, canonical writer/router integration,
end-to-end audit and regression, then a new deployment candidate.

## Public imports

From `backend/src/editing-progress-ledger.js`:

```js
EDITING_PROGRESS_TIMEZONE // America/Argentina/Buenos_Aires
EDITING_PROGRESS_SCHEMA   // { columns, constraints }, strict catalog handshake
assertEditingProgressSchema(db)
normalizeEditingProgressQuery({ periodo, editor_id? }) // frozen { periodo, editorId }
recordEditingProgressDelivery(db, { taskId, deliveryId, expectedTaskRevision })
// => { taskId, replayed }
projectEditingProgressTask(db, { taskId, expectedTaskRevision })
// => { taskId, changed }
loadEditingProgressAudit(db, { periodo, editor_id? })
```

From `backend/src/wilson-editing-progress-audit.js`:

```js
createWilsonEditingProgressAuditRouter({ express, pool })
```

Registers `GET /auditoria-edicion` only. Explicitly WhatsApp-only; no Telegram
resolver/API. Mount AFTER canonical signature-v2 validation and
`resolveWilsonUser`; do not replace either middleware. The route captures the
resolved ID, rechecks external binding uniqueness, active status and current
`admin` role inside its REPEATABLE READ READ ONLY snapshot. Requires human
private WhatsApp context; system/group/other transports are denied. Snapshot
authorization does not serialize revocations committed after snapshot creation.

## Writer preconditions and ordering

Caller owns authenticated authority, open transaction and canonical resource
locks, including serialization of assignment replacement by task. Helpers do not
open/commit transactions, acquire earlier-resource locks or send notifications.
Any failure must roll back the caller's complete operation.

Delivery helper: invoke ONLY in actual-new-delivery branch after canonical task
UPDATE/CAS and INSERT into `task_editing_deliveries`, before commit. The supplied
artifact must be the latest persisted artifact for that task and exactly match
its current revision and `en_revision` state. Transport replay stays handled by
existing receipts; helper replay is mutation-free for the same current revision.

Projection helper: invoke after persisted post-trigger task validation AND any
required canonical approval/correction evidence. It is a projection, not an
approval authorizer; it never creates a row. Main must retain approval/artifact
checks and hook every relevant mutation path or install the projection trigger.

Missing schema blocks writers with 503. Do NOT install hooks before DDL: current
fixtures without this schema would otherwise fail delivery operations globally.

## Credit and preserved history

Exactly one row per `tarea_id`, including versions. For a new canonical row,
credit explicit positive integer `edicion_responsable_id` only if it belongs to a
current task assignment and active user; otherwise, if no explicit ID exists,
use the unique assigned `responsable`. Ambiguous/inactive/missing/inconsistent
assignment: 409 `editing_progress_assignment_required`. Never select by name,
actor, nominal role, or arbitrary collaborator. No hardcoded person-ID mapping.

Canonical `editor_clave` is `user:<id>`; credit is `editor_user_id`, not this
display key. First artifact `recorded_at` fixes `entregada_at` for counting.
Later versions/reassignments never transfer original credit or move that date.

Historical rows keep `origen_registro=NULL`, `editor_user_id=NULL`, original
editor key, first stored delivery date, client and title snapshots. New activity
may update state/activity and exact artifact/revision pair, never assign that
history to today's owner. Pair must be both NULL or both complete with positive
revision. Projection leaves revision NULL while delivery_id remains NULL.

Task state `publicada` normalizes to task `finalizada`, never editorial evidence.
Review/approved/finalized are active; pending/in-progress, trash and leaving
editing/render_os deactivate without deleting. Archive alone does not deactivate.
Existing inactive historical rows are not reactivated on schema installation.
Prospective actual task changes may update activity. No FK to live `tareas`;
purged historical tasks remain reportable. Canonical artifact FKs retain their
own existing deletion restrictions.

## Exact schema handshake

`EDITING_PROGRESS_SCHEMA.columns` is the authoritative map of required column
type and nullability. Existing legacy columns retain their 051 types: bigint
id/task; text key/title/state; integer nullable client; timestamptz delivery,
created/updated and nullable baja; boolean active. New columns:

| Column | Type | Nullable |
| --- | --- | --- |
| editor_user_id | integer | yes |
| origen_registro | text | yes |
| delivery_id | uuid | yes |
| task_revision | integer | yes |

`EDITING_PROGRESS_SCHEMA.constraints` exports the exact expected PostgreSQL
deparse definitions under six names: `editing_progress_v1_source`,
`editing_progress_v1_identity`, `editing_progress_v1_state`,
`editing_progress_v1_task_unique`, `editing_progress_v1_editor_fk`,
`editing_progress_v1_delivery_fk`. Every constraint must be validated and
nondeferrable. Whitespace alone is ignored; predicate/grouping/type/target/action
changes fail closed. Source allows NULL or canonical_delivery only. Historical
identity remains NULL with nullable-or-complete artifact pair; canonical identity
and pair are mandatory. Composite FK binds `(tarea_id,delivery_id)` to
`task_editing_deliveries(task_id,id)` with RESTRICT update/delete. Editor FK
references usuarios(id) with RESTRICT delete. Unique task constraint is mandatory.

Catalog absence/incompatibility: 503 `editing_progress_schema_unavailable`.
Missing expected relation/columns is also unavailable; unexpected SQL failures
propagate. This is not a runner, repair, backfill or physical certification.
Strict pg_get_constraintdef spelling/search_path must be confirmed in PG16/18
before integration. Fermat owns ONLY the new physical integration-test file;
this sidecar owns `editing-progress-ledger-schema.test.js` unit tests.

Main/Hilbert must remove the old state CHECK that admits only en_revision and
publicada, and remove/replace trigger051 atomically. Replacement only projects
existing ledger rows on actual task changes; no INSERT, name lookup, credit,
snapshot or delivery-date rewriting. Its task_revision expression must be
`CASE WHEN delivery_id IS NOT NULL THEN NEW.revision ELSE NULL END` so historical
rows without a canonical artifact do not violate the pair constraint.

## GET and report DTO

Closed query: required scalar `periodo=YYYY-MM`, optional scalar positive decimal
`editor_id` within int32. Unknown/repeated/array/invalid inputs return 400.
No selector means exact historical key luciano with NULL origin only, labeled
"Registro histórico, clave luciano; identidad no verificada". ID selector returns
only canonical_delivery rows with that credited ID. Historical rows never join
by name into user 9 (or any other ID).

Month uses half-open Argentina local-midnight bounds applied to entregada_at,
not due date, update time, approval time, server timezone or payroll dates.
No truncation/limit; unique task constraint prevents version inflation; duplicate
task rows in returned evidence fail rather than silently alter totals.

Response keeps periodo, editor, finalizadas_registradas, en_revision_actuales,
total_operativo, entregas, revisiones; adds contrato=editing-progress-v1,
zona_horaria, alcance={tipo,editor_clave,editor_id}, aprobadas_actuales and
desglose_origen={historicas,canonicas}. Total is finalized + review + approved.
revisiones is exactly the review subset. Row DTO: id/tarea_id are decimal strings
(BIGINT safe), editor_clave, titulo_snapshot, estado_actual, fecha_entrega,
cliente_nombre, editor_user_id, origen_registro, atribucion, estado_canonico,
delivery_id, task_revision. Attribution is historica_no_verificada or asignacion_id.
No URLs, notes, payload hashes, identity secrets or financial values cross this DTO.

Only a validated, available empty ledger/selection yields 200 and zero counts.
An absent source/schema is NEVER presented as zero. Responses are no-store.
No query/write to financial entregas_edicion; existing report financial field
must stay separate. Any later report integration uses a dedicated authorized
progresoEdicion field and this same loader, never name/title/date deduplication.

## Verification and release boundary

Run only the three new unit test files with node --test. Tests use memory mocks,
not configured DB/environment/credentials. Coverage includes catalog weakening,
wrong types/nullable/FK/unique definitions, historical pair rules, assignments,
exact evidence, replays, state categories, scope changes, closed DTO/query and
fresh WhatsApp identity. Month SQL boundaries are inspected, not physically
executed. PostgreSQL deparse/upgrade/concurrency remain external acceptance gates.
No route/writer mount until approved DDL and its physical evidence are complete.
