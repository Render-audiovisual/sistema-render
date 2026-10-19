# Production → editorial delivery contract

Local implementation contract, not completion evidence. Preserve historical data; no backfill, inference by names/titles, automatic publication or second delivery task.

## Data

Forward migration 060 adds nullable `publicacion_id`, `tarea_entrega_id`, `cliente_editorial_id` to `produccion_videos`. All three null or all three positive; unique publication and canonical delivery task per linked video. Actual `tarea_edicion_id` remains the handoff binding; when an editorial link exists it must equal `tarea_entrega_id` if present.

Composite foreign keys preserve the tuple across **all writers**:

- `(publicacion_id,cliente_editorial_id)` → `publicaciones(id,cliente_id)`;
- `(tarea_entrega_id,publicacion_id,cliente_editorial_id)` → `tareas(id,publicacion_id,cliente_id)`;
- `(visita_id,cliente_editorial_id)` → `produccion_visitas(id,cliente_id)`.

Referenced unique tuples include each table's existing unique ID; they do not reinterpret historical identities. Restrictive deletes/updates preserve linked history. A narrowly scoped trigger on objective slots prevents replacing or clearing a linked video's canonical task/publication and requires the same tuple when a new slot uses a bound publication/task. It never rewrites states or dates. Validate video publication format reel/video at link/handoff; guard subsequent publication type changes while linked. Old video lineage is not automatically assigned a publication; reject associations when a predecessor or descendant is already linked.

A unique expression index on `COALESCE(tarea_entrega_id,tarea_edicion_id)` prevents claims across the two columns, including an old unlinked handoff claimed by another video's planned canonical delivery. The equality check makes the coalesced key cover all cases. Additional explicitly created workflow tasks may reference the same editorial piece (the agency supports multi-stage work); they are not a second canonical video delivery and must not create another quota slot.

## API under `/api/producciones`

All association writes and candidate reads require current server admin. Existing team registry reads remain shared and contain only safe linkage IDs, not raw editorial metadata.

`GET /:id/videos/:videoId/vinculo?periodo=YYYY-MM` → `{actual:null|{publicacion_id,tarea_entrega_id,objetivo_pieza_id?},publicaciones:[{publicacion_id,titulo,fecha_programada,publicacion_updated_at,tarea_id,tarea_revision,objetivo_pieza_id?,objetivo_updated_at?,periodo?}],casilleros:[{objetivo_pieza_id,titulo,numero,periodo,objetivo_updated_at,tarea_id,tarea_revision}]}`.

Only compatible current-client video/reel pending publications with exactly one usable pending canonical workspace task are candidates; never guess which duplicate task should survive. Pending objective video slots with a pending canonical task and no publication are offered separately. Existing begun/completed/published/duplicate/incompatible records are not silently adopted. Current association is visible even after normal editorial/task progress.

`POST /:id/videos/:videoId/vincular-pieza` body `{expected_revision,publicacion_id,expected_publicacion_updated_at,tarea_id,expected_tarea_revision,objetivo_pieza_id?,expected_objetivo_updated_at?}`. Existing linked goal slot, if present, must be explicitly acknowledged with its version; it cannot be omitted. Reuse only its canonical task, preserve its publication and goal row, do not create another task or slot. Exact repeat returns existing result without mutation; incompatible/stale/conflicting writes return 409.

`POST /:id/videos/:videoId/vincular-objetivo` body `{expected_revision,objetivo_pieza_id,expected_objetivo_updated_at,tarea_id,expected_tarea_revision,fecha_programada}`. Explicit selection of an empty pending video slot creates **one draft publication** with manual programming date, current client and video title, using the slot's copy (never assume guion is editorial copy). Set that same publication on its existing canonical task/slot and the video, atomically. No second task, changed work state or actual publication timestamp. Exact retry after association returns the existing result if the IDs/date agree; stale/incompatible retry conflicts.

Both return `{visita,publicacion_id,tarea_id,objetivo_pieza_id,created}`. Association does not set `tarea_edicion_id`/editor/deadline: that is a separately authorized manual handoff.

## Handoff and other writers

Existing `/enviar-edicion` payload is unchanged: admin chooses current active editor ID and explicit delivery date/material. A linked video adopts its **existing pending canonical task**, updates owner/deadline/material/type to editing, preserves piece/goal/copy and binds the handoff. No INSERT task for this path. A begun or incompatible task rejects. An unlinked video retains existing creation behavior. A previous handoff can associate only with its exact existing delivery task; never fuse two task IDs. Dates of visit, delivery and editorial programming remain separate.

Lock order for association/adoption: global objective-link advisory → matching objective period/key advisory when applicable → involved existing tasks in ascending ID order (including source) → publication → objective slot → visit → video, followed by revalidation. Unlinked legacy-free handoff retains source task → visit → video → new task. Recheck unlocked discovery after locks. Keep compatible with existing goal preparation/linking locks; do not add arbitrary reverse task locks while holding a visit/video.

Pending continuation creation also acquires the same global objective-link advisory **before any task/visit/video lock**; association then rechecks the entire ancestor/descendant chain. Existing goal preparation locks tasks/publications by ascending ID and ranks returned candidates separately, preserving completed-first reuse without inconsistent lock order. Forward migration 060 reorders the task-to-goal copy-sync function to acquire publication before slot (matching publication-to-slot copy sync), preserving all 058 state/copy/event semantics and leaving historical rows unchanged.

Normal task, piece and goal APIs must not bypass tuple integrity. Domain FK/check/goal-conflict errors return 409, not raw SQL or success. Do not mutate old publication/goal references to accommodate a conflicting request.

## UI and verification

Linked editorial lineage currently rejects continuation with 409, including the source itself. An explicit audited transfer policy remains future work; never silently create another delivery identity. Scoped linked production/editorial task editing keeps scripts/instructions separate from editorial copy and omits copy from script-only PATCHes, preserving publication/goal copy. Other legacy task content normalization is unchanged.

Progressive disclosure on each video: admin “Vincular pieza u objetivo”, choose month/candidate, show existing task, explicit date only for creating a slot draft. Load/error/409 preserve entered choices, never auto-retry association; refresh versions deliberately. Shared team sees the resulting link. Existing assignment/deadline handoff remains manual.

QA: fresh migration populated-history invariance; existing piece/task/goal adoption with unchanged task/slot count; empty slot creates one draft and zero tasks; two videos cannot claim one publication/task; stale/duplicate/concurrent writes; employee denied; cross-client/format/period mismatch; rollback after injected binding failure; ordinary writer attempts cannot break tuple; handoff uses chosen editor/date; task review/approve/finalize leaves actual publication/date unchanged; goal counts one slot; persisted state after reload/fresh session. Only brand-new guarded fixtures; no ordinary startup, deployment or real data.
