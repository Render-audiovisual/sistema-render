# Existing-task coordination — principal integration

Scope: preserve explicit `propiedades_extra.horario` (free text) and `coordinada` (boolean) on existing tasks. These are not normalized visit dates, delivery dates, completion evidence, publication confirmations or inferred identities. No migration/backfill.

## API and authority

- Reuse PATCH `/api/tareas/:id`, optionally `?workspace=render_os`. Send only changed coordination keys inside `propiedades_extra`, with positive integer `expected_revision` (and existing timestamp precondition when available).
- Admin uses current verified server role. Production employees must still pass the final UPDATE's current ID-based `tarea_asignaciones` predicate; owner/collaborator grants are existing policy. No name matching, broader read access, or global-finalizer exception for coordination.
- Other employee roles cannot patch these fields, including mixed payloads and query changes.
- Every coordination patch, including admin/historical/query-omitted requests, requires an observed revision. Atomic existing revision WHERE and trigger decide concurrency; one matching version wins. Do not automatically retry a stale coordination draft.
- `horario` must be string <=2000 characters. Empty text is explicit clearing; no coercion, date parsing or forced timezone. `coordinada` must be boolean; false is a valid explicit reset. Existing malformed historical values remain stored/read-only rather than being rewritten.
- JSONB merge preserves unrelated metadata. No task-state or editorial mutation is implied by this patch. Actual changes to status/date still obey their independent contracts.

## UI integration

Compact editor beside recorded context; use existing shared styles. Capture task revision and session at edit start, send only changed keys and use the strict observedRevision argument of the principal update queue. Keep local draft on conflict or failure; explicit cancel/reopen is required before using a refreshed baseline. Never silently adopt another writer's revision.

Report dirty/busy to the task detail's existing navigation/close guard. Do not add competing leave prompts. Keep unset boolean distinguishable; unsupported historical values are not automatically stringified or reset.

## Verification gates

Pure validation/role/model tests, opted-in HTTP on a new guarded physical PostgreSQL cluster, same-version concurrent writes, unrelated metadata preservation, unauthorized users, stale revision, malformed types, query omission and reload. Browser desktop/mobile and dirty-navigation evidence must be recorded separately; pure/source tests alone do not prove runtime rendering.

Five old dashboards stay live until B1 and B3 plus broader replacement equivalence are verified. Implementing this contract alone is not permission to retire them or claim Render 2.0 complete.
