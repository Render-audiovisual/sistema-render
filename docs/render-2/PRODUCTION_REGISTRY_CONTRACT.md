# Shared audiovisual registry — integration contract

Local principal application only: React/Vite → authenticated Express API → PostgreSQL. No browser business-data store, production deployment, legacy bulk import or automatic script interpretation. Implementation readiness is determined by `PRODUCTION_REGISTRY_QA.md` and `STATUS.md`, not by this contract alone.

## Data and permissions

Forward migration 059 adds visits, normalized participant membership, individual videos and photo records. UUID identities and foreign keys preserve origin and editing-task links; restrictive deletes protect history. Every visit has an integer revision. Team members may read and record shared production content using their server-verified identity. Only current administrators may explicitly hand a video to editing. No authority comes from a display name or local profile.

Each video retains its title, script, filming result (`planificado`, `grabado`, `pendiente`, `repetir`), material link and observations. Editing task state is separate and read from the linked real task. Photo records use type, result and Drive link, not a mandatory count. Visit date and editing delivery date are different fields.

| Endpoint under `/api/producciones` | Purpose |
| --- | --- |
| `GET /?mes=YYYY-MM` | Shared calendar with visits and content summaries |
| `POST /` | Explicit new visit or reviewed link to a source visit task |
| `GET /:id`, `PATCH /:id` | Read/edit visit with expected revision |
| `POST /:id/videos`, `PATCH /:id/videos/:videoId` | Record one planned/recorded/pending/repeat video |
| `POST /:id/fotos`, `PATCH /:id/fotos/:photoId` | Record/edit a photo type and its result/material |
| `GET /pendientes` | Latest unresolved scripts, optionally filtered by client |
| `POST /:id/videos` with `video_origen_id` | Explicitly reuse a pending script in a same-client visit, preserving original history |
| `POST /:id/videos/:videoId/enviar-edicion` | Admin chooses active editor ID and manual delivery date; creates exactly one real editing task for that video |

Nested writes and handoff require the visible visit's `expected_revision`; conflicts must not silently rebase or automatically retry. Handoff validates recorded state, usable material URL (video or visit), editor role/identity, delivery date and existing task link inside one transaction. Task insertion, normalized assignments, video linkage and visit revision form one commit. Each of three handed-off videos must produce a different task, even if recorded during the same visit.

## Source tasks and historical safety

New valid production-visit tasks can register their visit through the task persistence transaction hook. Counts and free-form source text do not invent video identities or split scripts automatically. Existing commercial tasks/records are not backfilled or rewritten.

Once a source visit task is linked, registry date/client govern that visit. An isolated source-task date/client change must conflict; explicit registry changes synchronize the source task transactionally. Editing delivery dates do not move when a visit is rescheduled. Client changes after editing tasks exist require conflict/manual review. Lock order must be source task → visit → video.

Linked sources cannot be reclassified out of the visit/workspace contract. Archiving a source does not remove the independent production history or prevent registry corrections; archived, unlinked tasks are not automatically imported. Both incoming and outgoing pending-video lineage prevent independent client changes. Explicit task reassignment/deadline changes remain possible: `editor_handoff_id` / `fecha_entrega_handoff` describe the original handoff, while `editor_actual_id` / `fecha_entrega_actual` join the current task. The UI labels these separately. A linked editing task cannot be moved to a different client by ordinary task PATCH.

The principal legacy recording/correction/confirmation and Wilson web recording paths reject mixing aggregate quantities into a visit with normalized video/photo rows. Wilson task editing uses the same transactional registry hook; supervisor date changes reject a divergent date on a linked source. These guards preserve old standalone records rather than deleting or silently converting them.

New per-video tasks use `origen_produccion_video_id` and `produccion_visita_id`, not the old per-visit aggregate `origen_visita_id` unique key. A legacy aggregate must not be silently reused, deleted or interpreted as individual videos. Any incompatible old aggregate/source logs require explicit review. Legacy endpoints remain preserved during replacement verification; their final consolidation is a separate integration gate, not proof supplied by adding these tables.

### Historical conversion boundary (integration50)

Ordinary task edits must not create a new registry from an unlinked aggregate source. The shared `hasLegacyProductionSource` predicate detects nonempty or malformed `produccion_registros`, `produccion_confirmada_at`, or an existing legacy child task with `origen_visita_id`. The task sync hook returns without conversion; metadata, counts, confirmations and children remain intact. Existing linked-visit synchronization is unchanged. Empty/null record collections without other legacy evidence still allow normal fresh registration.

Explicit POST creation with a historical source rejects409 before changing the source date or inserting a visit. This prevents creating a mixed registry whose legacy and per-video handoffs would both reject operation. It does not convert or erase an already-existing mixed registry. Existing complete aggregate legacy confirmation/single-edit flow is not retired by this protection.

The next reconciliation operation is **not implemented yet**. It must require an actual current administrator, explicit identified videos (never `quantity=N`→N recorded videos), source/visit/task revisions, durable per-video provenance and an idempotent request receipt. Preserve original aggregate metadata and any existing child's comments, assignments, deliveries and approvals. An existing aggregate editing task cannot be cloned across several videos; ambiguous mappings must remain409/manual review. Do not erase legacy flags to bypass guards or globally authorize all videos after a partial reconciliation. New per-video handoff remains a separate deliberate editor/date choice. Reuse the established advisory/task/visit/video lock order; task sync and legacy writers already serialize through the source task row.

## UX acceptance

The connected `/producciones` route appears in normal navigation and survives reload/direct links. Desktop presents calendar + selected-day agenda; mobile provides a compact readable agenda. Choosing a day shows recorded video names/results and photo types, with detail/editing available separately. Pending scripts can be deliberately resumed into another visit. Changes use backend revisions; entered drafts survive conflicts. No fictional metrics, duplicate aggregate editing task, or automatic publication may be substituted for this flow.
