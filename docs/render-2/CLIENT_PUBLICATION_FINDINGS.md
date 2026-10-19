# Client publication metrics — unresolved business integration gate

Status: source audit only. The bounded Clientes loading fix does not change the metric helper or certify historical publication evidence. This document proposes the next dedicated, coordinated business integration under the existing master objective; it is not permission to rewrite commercial data or deploy.

## Historical evidence and its limits

- `backend/migrations/048_cliente_objetivos_mensuales.sql`, function `sincronizar_cliente_objetivo_tarea`: task transitions into legacy `publicada` could update linked `publicaciones.estado` to `publicada` and set `fecha_publicación_real` using `COALESCE(existing_date, now())`. Reopening could reset editorial state to `pendiente` and clear the date. These writes did not require an independent publication event.
- `backend/migrations/055_decouple_goal_publication.sql` replaces that function forward-only. It retains objective title/copy/responsible/state/completion/event synchronization and copy-only publication synchronization, but removes task-driven editorial state/date writes. It performs no historical backfill or repair. Later definitions in 058/060 retain that separation while changing task-state handling and lock order.
- `backend/src/piece-task-linking.js`, compatibility export `publishPieceLinkedToCompletedTask`, is a no-op. Task completion is not publication evidence.

Consequently, an existing editorial `publicada` state with a valid actual-date field is not sufficient to establish how that evidence originated. It may have been explicitly recorded or produced by older coupling. This audit does not establish which rows were affected or whether an external publication occurred. Do not infer provenance from IDs, creation/update dates, migration deployment dates, task completion, or mere presence of the timestamp.

## Current reads and metric semantics

`frontend/src/clientesStats.js`, `getResumenClientes`:

- Selects historias and publicaciones by `fecha_programada` month; publications are grouped through the existing shared-feed relationship.
- Counts a selected row when `estado === "publicada" || Boolean(fecha_publicación_real)`.
- Therefore accepts a published state without a date, any truthy malformed date, and a nonpublished state with a stale date. The expression is a legacy metric rule, not a verified-publication predicate.
- Reports the scheduled-month cohort. It does not measure publications whose actual date falls within that month. A piece scheduled in one month and recorded as published in another remains in the scheduled cohort.

The loading fix intentionally preserves this helper. Removing its unused completed-task request does not resolve the classification/provenance gate. Caption clarification must not be presented as a semantic repair.

## Authoritative backend fields and writer differences

- Both DB tables define the accented root column `fecha_publicación_real` as TIMESTAMPTZ in `backend/migrations/000_initial_schema.sql`. `backend/src/operational-dto.js` explicitly permits that root field for editorial records. Metadata fields are not substitutes for it.
- `GET /api/historias` in `backend/src/server.js` selects the raw actual timestamp and projects the editorial DTO. `GET /api/publicaciones` selects it using `to_char(..., 'YYYY-MM-DD HH24:MI')`; that string omits timezone/offset. Do not parse it as a timezone-independent instant. A future actual-date contract should return an unambiguous timestamp or explicitly defined Córdoba calendar date.
- Admin `PATCH /api/publicaciones/:id` records `now()` when entering `publicada` from another state, clears the date on an explicit nonpublished state, and otherwise preserves it. Repeating `publicada` does not fill an existing missing date. This records application state transitions, not independently verified platform publication.
- Admin `PATCH /api/historias/:id` updates editorial state but does not stamp or clear the root actual-publication date. Checklist-driven state changes therefore cannot establish a dated publication event; reopening may leave a historical date unchanged.
- Task `finalizada` and legacy task `publicada` denote closed work. Neither authorizes counting an editorial publication. Checklist flags, approval, finalized delivery, scheduled dates, objective completion and metadata dates must remain separate concepts.

## Recommended forward-only contract

Before changing the metric, agree on API, schema, UI labels and quota-period semantics together:

1. Introduce additive, server-controlled publication-event provenance for new explicit confirmations: stable piece identity/domain, authorized actor ID, unambiguous occurrence/recording times and a closed source/operation vocabulary. Separate a human-recorded confirmation from externally verified publication; do not label either interchangeably.
2. Existing rows default to unknown/unverified provenance. Do not backfill approval or publication authority from historical state/date/task/metadata values. Any manual reconciliation must be separately authorized and auditable, not an automatic migration.
3. Define consistent forward historia/publicacion confirmation, repeat, reopening and correction behavior. Update editorial state/date/provenance atomically; retries must not manufacture a new event time. Preserve historical evidence according to the agreed event policy rather than silently erasing or promoting it.
4. Distinguish read classifications: published state plus valid root date is a dated publication record, not proof of historical provenance; published without a valid date is uncertain/undated; a date with a nonpublished state is inconsistent. Provenance-qualified confirmed counts require the new evidence contract.
5. Keep scheduled-month planning/cohort reporting separate from actual-publication-month reporting. Define Córdoba calendar boundaries and which metric, if any, measures configured monthly quotas. Preserve feed deduplication and disclose coverage limits; do not silently relabel the existing cohort count as actual-month output.
6. Keep task completion and production registry counts independent. No task-triggered publication, automatic historical repair, new role grant or financial DTO expansion belongs in this change.

## Required tests for the dedicated integration

- Published state with valid date, missing date, malformed date, and nonpublished state with stale date; historical provenance remains unknown in every applicable case.
- Task-only completion/finalization, approval and checklist-only flags do not supply publication evidence.
- Scheduled month differs from actual month; timezone offsets and Córdoba month-boundary cases follow the declared date contract.
- Forward explicit confirmation, repeat/retry, reopening and correction have consistent historia/publicacion behavior and atomic rollback.
- Historical populated-upgrade snapshot remains unchanged: no editorial state/date/provenance promotion, deletion or backfill.
- Stable piece-ID deduplication, shared-feed quota deduplication, visible-data coverage and no invented global totals.
- DTOs carry only the approved evidence fields; client-supplied metadata cannot forge server-controlled provenance or broaden publication permissions.

No whole-phase or production readiness claim is made. The legacy metric/provenance and historia-writer issues remain explicitly unresolved until that integration has a reviewed contract, implementation and verification.

## Backend progress: explicit confirmation064

The new principal `/api/editorial-publicacion/:dominio/:id` contract now provides server-authorized manual confirmation/withdrawal, durable actor/request replay, observed revision checks and immutable provenance in additive064. Existing editorial rows are unchanged and initially have no confirmation. Relevant later legacy changes invalidate the new current reference; task completion cannot create one. See EDITORIAL_CONFIRMATION_CONTRACT.md and EDITORIAL_CONFIRMATION_QA.md for scope and actual test evidence.

This does not repair or certify old metric classification, old PATCH publication controls, or external publication verification. UI, client overview and report adoption must follow before this gate can close. No historical row is promoted by the new schema or read API.
