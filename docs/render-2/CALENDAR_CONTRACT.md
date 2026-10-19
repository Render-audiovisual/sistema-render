# Principal shared calendar contract

Local implementation target, not completion evidence. React/Vite principal `/calendario`, Express/PostgreSQL source, no migration or external calendar. Existing editorial planning modules remain editing destinations against the same data; preview/sandbox data must never be merged or used as fallback.

## Read API

`GET /api/calendario` accepts only `desde`, `hasta` (strict YYYY-MM-DD, half-open range1..62 days), optional `scope=mine|team` (defaultmine), `kind=all|tarea|visita|programacion|publicacion` (defaultall), and optional positive int32 `cliente_id`. Reject duplicate/array/object/unknown inputs, impossible dates and invalid ranges400. Current active supported human ID/session/role is verified inside a repeatable-read/read-only transaction; all six supported roles may read. Unknown profiles403, revoked/inactive401. No financial endpoints/amounts/raw metadata or provider requests.

Sources and meanings are independent:

1. `tarea`: persisted Render OS task `fecha_vencimiento`, including completed work with its real work state; no archived/trash, no private workspace, inactive clients excluded. An origin task represented by a normalized production visit is not a second deadline event (its date is the visit date); editing-task deadlines remain distinct. Labels “Entrega de tarea”.
2. `visita`: normalized production visit `fecha`, supported team registry scope. Labels “Visita de producción”. No inferred editing deadline or aggregate legacy task production.
3. `programacion`: historia/publicacion scheduled date. Active clients/nonarchived pieces, labels “Programación editorial”; scheduling is not publication.
4. `publicacion`: current manual confirmation only, through existing `annotateEditorialEvidence` on observed rows within the same snapshot; historical state/date alone never makes this event. Use confirmed occurrence instant in America/Argentina/Cordoba for date. Label “Publicación confirmada manualmente”, not external platform verification. Preserve scheduled/real date distinction; do not duplicate delivery/task/goal credit.

Mine uses stable current ID membership: tasks via tarea_asignaciones; visits via participant IDs or shared origin-task membership; editorial via linked shared Render OS task membership. Never infer from names, roles, copied JSON, display labels or historical editor name. Team shows the same shared operational records any supported team member can already read, not private tasks or money. Client filtering narrows those sources, never broadens access. Active-client option list is explicit id/name only. Null-client shared tasks are allowed without a client filter. Project milestones/personal-list reminders are not yet a calendar source in this integration; no all-module calendar completion claim.

Closed response:
`{range:{desde,hasta},scope,kind,timezone:'America/Argentina/Cordoba',clients:[{id,nombre}],events:[{key,kind,source,source_id,date,title,cliente_id,cliente_nombre,estado,href,responsable_ids,evidence}],truncated:boolean}`.
Kinds as above; source tarea|visita|historia|publicacion; source_id integer or visitUUID. key stable type/domain/ID (same numeric story/publication must not collide). Text title bounded160, names bounded250; IDs valid, scalar/null states. Evidence is null except manual real-publication events, where it is the existing closed `{classification:'confirmada_manualmente',revision,confirmation:{id,actor_id,occurred_at,recorded_at,source:'manual'}}` projection, never raw metadata. Real editorial titles may use explicitly string-valued idea/Idea or bounded copy; never stringify object metadata or expose raw descriptions/scripts/private financial bags. Task and visit hrefs point to existing direct detail URLs. Editorial links preserve actual source client and scheduled month with existing `tab=calendario` or `vista=checklist` URL context, labelled as module context rather than falsely claiming a piece-detail deep link.

Bound work: fetch at most2001 candidates per task/visit/editorial domain, annotate bounded editorial batches, sort by date/kind/key and return at most2000 events. If any source or final event list exceeds limit, truncated=true even if filtering leaves fewer. No silent total/count completeness claims; UI discloses that users must narrow client/type/range when truncated. This is a bounded operational view, not a financial/reporting aggregation or unlimited export.

## UI/navigation

Every supported role sees Calendar in personal navigation and may reach `/calendario` directly/reload. Replace old publications alias with a single shared principal calendar page; keep `/planificacion-publicaciones` and structure links functional. Main owns App and navigation changes, preserving existing App/Vite dirt with selective staging.

Light restrained page, month grid Monday-first, previous/next/current month, selected-day agenda. Mobile renders legible day buttons and selected-day list, no overflowing seven-column dense cards. Date, month, mine/team, kind and client selection live in URL so reload/back/forward/share match the view; default mine/current Córdoba day. Day selection must list actual events and offer safe contextual links, not modify dates or states by clicking. Correct date-only arithmetic independent of browser timezone; no browser business-data storage.

Request lifetime: abort/generation/current session ID/token/role guards prevent late response/error/callback from replacing a new selection/session. Distinct loading/error/empty/truncated states, explicit retry, no simulated data or zero-success fallback on API error. Closed DTO decoder verifies source/IDs/date/range/kind/hrefs and drops unsupported metadata. Client/date/kind changes reset or preserve day coherently; deep links outside displayed month normalize deliberately. No fabricated counts, drag mutation or recurrence inference.

## Verification and ownership

Architect owns new backend router/model/tests; frontend owner new CalendarPage JSX/CSS/model/tests; independent QA owns new real HTTP/SQL suite. Coordinator server/App/navigation integration and final tests/browser. Reviewer checks scope/privacy/date/evidence/navigation races. Tests cover all roles, namesakes, mine vs team/private, visit-origin dedup, source identity, deadlines/schedule/real Córdoba month, forged metadata, inactive/archive/trash, read-only SQL invariance, filters/bounds, failed/obsolete session reads, date edits reflected after refetch and fixture cleanup. Desktop/mobile/back/forward/reload verified on built principal with synthetic users only. Local success is not deployment or global master completion.
