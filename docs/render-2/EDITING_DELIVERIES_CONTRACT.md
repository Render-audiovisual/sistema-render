# Editing deliveries — prospective integration contract

Local development only. This contract does not certify implementation or production. Preserve existing tasks, production videos, raw-material links, publications and historical approvals. No backfill from files/comments/state, no Drive fetch, no automatic publication.

## Purpose and boundaries

Each editing task receives explicit versioned delivery links independent of `material_referencia` (raw material). A production video keeps its existing canonical editing task; deliveries do not create tasks, videos, publications or quota slots. Any supported team member may read the shared Render OS task history; only a currently assigned member or current admin may deliver. Only tasks whose persisted workspace is `render_os` and `tipo_tarea` is `edicion` participate. Unsupported/archived/trashed tasks are not writable. Names never grant authority.

## Storage

Forward migration065 adds `task_editing_deliveries`, without altering historical rows. Immutable event fields: UUID `id`, positive `task_id` FK restrictive, positive `actor_id` FK restrictive, UUID `request_id`, SHA256 `payload_hash`, positive `task_revision` (revision returned by the atomic task update), `url` (HTTP/S, no credentials, max2000), `notes` (plain text max4000), `recorded_at` timestamptz. Unique `(actor_id,request_id)`; all event updates/deletes prohibited. No separate mutable “current” pointer: ordered history provides latest delivered event. An old delivery is history, not proof that today's content is approved.

## API

Mounted `/api/tareas-edicion/:id/entregas`; no query parameters accepted. ID strict positive int32. Current active supported human identity/session/role checked in the transaction.

GET uses repeatable-read/read-only, resolves persisted task scope and returns closed `{task:{id,revision,estado},deliveries:[{id,task_id,actor_id,task_revision,url,notes,recorded_at}],can_deliver}`. History ordered by recorded_at then id; archived/trash may not be accessed through this new surface. No arbitrary task metadata/financial fields. Administrators do not bypass the closed event DTO.

POST accepts exactly `{request_id,expected_revision,url,notes}`; revision positive safe int, UUID lowercased, strict trimmed HTTP(S) URL with no user/password, no control characters, notes string max4000/no NUL (empty allowed). Canonical intent includes task ID, expected revision, normalized URL and notes; never includes browser identity. New delivery allowed from `pendiente`, `en_progreso`, `en_revision` or `aprobada`, not finalized/legacy completed states. It atomically sets task `estado='en_revision'`, clears existing approval evidence using the established task workflow contract, increments task revision via existing trigger, and inserts one immutable delivery event. It does not change reference material, scripts, instructions, assignments, deadline or any editorial state/date.

Current actor/session validation and current task write membership precede replay. Exact actor/request replay with matching hash returns200 `{...GET,delivery_id,replayed:true}` with present task/history, even if task progressed after original acceptance. Wrong intent same key409. New acceptance201 with `replayed:false`; stale revision409, invalid input400, unauthorized401/403, unavailable task404. Never turn unexpected SQL errors into domain conflicts.

Lock order: actor SHARE → actor/request advisory → global `vinculo-objetivo-mensual` advisory → matching period/key advisory when present → existing tasks ascending via existing resource-lock helper → publication → goal slot → visit/video, consistent with task operation receipts. Revalidate access/state/revision after locks; payload lookup and replay before CAS/state rejection but after current authorization. Short transaction, no external calls. Failure to insert event rolls back state, approval and revision. Concurrent same-revision deliveries: one201, one409; exact concurrent retry:201+200 with one event.

## UI and acceptance

Shared task-detail section displays latest delivery and history, separate from raw references. Explicit link/notes and “Entregar versión y enviar a revisión”; uncertain retry retains exact UUID/body/revision and input,409 never auto-rebases; current session/context guards suppress obsolete responses. Existing generic task transitions remain compatible, but must never be described as evidence of a delivered artifact. A task without an event is “sin entrega registrada”, not inferred from an attachment or state. Review/corrections/approval remain the existing task workflow and comments; this does not yet introduce a separate correction-event system.

Required tests: migration populated invariance; strict inputs/closed DTO; homonym and revoked membership/session; explicit editor/admin allowed, other staff cannot deliver; exact retry/concurrent CAS; atomic insert failure rollback; original raw material/deadline/visit/script untouched; editorial publication state/date unchanged through submit/review/approve/finalize. Goal slot work state/completion continues to follow the existing task synchronization trigger; do not freeze it or confuse it with publication. Explicitly clear `revision_aprobada`, approval actor/name/time and `finalizada_at`, including residual metadata when submitting from review. Preserve unrelated metadata and historical editing credit. Persisted history on fresh login; browser desktop/mobile submit/reload. UI or rollout is incomplete until independently verified. New migration must be adopted in startup shape checks and fresh fixtures, never applied to an unknown or production DB.
