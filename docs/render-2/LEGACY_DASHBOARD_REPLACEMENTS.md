# Legacy dashboard replacement inventory — bounded Worker B handoff

Status: READY / FROZEN inventory, **NOT a cutover approval**.

The full `LEGACY_ROUTES_CONTRACT.md` was read. Exploration stopped at the coordinator's request. This is source inspection only: no services, database queries, browser, build, application edits, or commits. Only this new document is written for this inventory task. Existing code changes in the worktree belong to other work.

## Immediate cutover blockers

| ID | Existing reachable capability | Principal implementation inspected | Gap and required disposition |
| --- | --- | --- | --- |
| B1 | `dashboards/German.jsx:194`, `DetalleProduccionGermanModal.handleCoordinarFecha`: prompts for free-text timing and PATCHes `/api/tareas/:id` with `propiedades_extra: { horario, coordinada: true }`. Pending cards show the coordinated timing; the modal shows `motivo_bloqueo ?? horario`. | `WorkspaceReadOnly.jsx` task editor changes due dates and selected metadata, but has no `horario/coordinada` control. `Productions.jsx` creates/edits a distinct normalized visit with a calendar date, participants, Drive URL and observations. | A normalized visit date is not replacement for updating these fields on an existing task. No equivalent read/write control was found. Main must resolve this capability before retiring `/german`; do not infer or migrate visit identity from names. Historical endpoint success under current permissions was not exercised. |
| B2 | `components/TareasAsignadasGenericas.jsx` renders `propiedades_extra.material || Material`, `feedback || motivo_bloqueo` for assigned tasks. This component is mounted by Augusto, Luciano, Germán and Oriana. | `features/render-os/utils/task-content.js:getUnifiedTaskContent` reads `aclaraciones`, `guiones`, `copy_trabajo` (with a linked-editorial exception). Task material UI reads `material_referencia`, Drive attachments and URLs from `aclaraciones`. `Feedback.jsx:100` fetches only the first 100 `q=feedback` task matches; `feedbackEntries` maps `aclaraciones` and `material_referencia`, not the legacy metadata fields. | Existing task metadata can become invisible although it remains stored/projected. Neither opening the task nor using Feedback establishes equivalent access. Main must provide a readable replacement or establish an explicit, evidence-backed disposition; no data migration or copying was done. Applies to all four employee dashboard retirements. |
| B3 | Reachable leader home uses `getAprobacionesLider` for its attention count. `utils.jsx:222` selects unfinished tasks with metadata `escalada_a` equal to `Líder`, `Agustín`, or `Franco`, without requiring `estado=en_revision`. | `backend/src/personal-home.js` builds its administrator review queue from visible tasks in `en_revision`; `QuickHome.jsx` renders that queue. Task approval UI also requires `en_revision`. No dedicated escalation queue or escalation reason readout was found in inspected principal modules. | A pending escalated task can be absent from the replacement review queue. A generic team board is not equivalent escalation triage. Hold `/lider` retirement until this is resolved. These strings describe historical selection only, never identity/authorization. |

These are source-level capability gaps, not claims that particular production rows exist. Actual legacy requests may now fail stricter backend checks; that must be established separately, not assumed to make a live capability dispensable. The contract explicitly blocks retirement when replacement is missing.

## What was actually inspected

The active render paths of all five dashboard components, the generic task component, current App route branches, QuickHome and its parser/loader, personal-home SQL, task content/state helpers, and relevant principal task/production/report/editorial/finance code were inspected. Large modules were inspected by targeted sections and references, **not fully audited**. Lider's active first return was distinguished from its unreachable second return and historical helper exports.

Source references below are repository-relative; line references are an inspection snapshot and may shift during coordinator edits. A matching route or title is not evidence of functional equivalence.

## Dashboard reads, actions, and candidate replacements

### Líder — `frontend/src/pages/dashboards/Lider.jsx`

- Live `cargarPanorama` reads `/api/clientes`, `/api/historias`, `/api/publicaciones`, `/api/tareas?workspace=render_os`, and current-period `/api/sueldos?periodo=YYYY-MM`. Refreshes every 30 seconds and on return to visible document.
- Active first return (starts line 106) shows overdue tasks, escalation-selected approval count, overdue/blocked editorial pieces, up to six scheduled stories/publications today, team load/status, and financial result/margin/billing/payroll/fixed expenses. Actions in that active return are links to the task board, publication planning, reports, and finance—not inline approval writes.
- `/inicio` is current-identity personal work, not a replacement global operations summary. Its own overdue count excludes finished, archived/trashed and inactive-client work; leader's legacy overdue filter only excludes `ESTADO_FINAL_TAREA` (`publicada`). These counts are not equal.
- `/reportes-historias` (`Reportes.jsx`) reads `/api/reportes/datos` with an explicit period. It provides ID-attributed task totals/review/approved/finalized/overdue, editorial records, quotas, normalized production and separate historical aggregates. It does **not** reproduce `getResumenEquipo`'s fixed four-name, task-or-editorial fallback and all-item load calculation. Global workload/attention replacement remains a Main inspection/decision item, not certified coverage.
- `/calendario` uses `/api/calendario` with mine/team scope, event kind, client and date range; stories/publications are navigable through editorial modules. This is a candidate scheduled-content destination, not proof of an identical today list or blocked/late editorial attention summary.
- Financial values have a concrete surviving home: `Sueldos.jsx:170` reads the same period endpoint and renders result/margin, billing, salaries, fixed expenses and details. Backend `server.js:718` guards `/sueldos` with `requireRole("admin")`; principal navigation exposes finance only to admin. Do not add finance to personal-home DTO or grant access through aliases. Same-period rendering and access were not executed.
- **B3 blocks replacement approval**; global overdue/load and combined editorial attention coverage are not fully established.

Historical/non-live code: `LiderDashboard` has an unconditional first return; its second return at line 219 contains client panorama/search/detail, quota-related UI, resolved-escalation PATCH, `GestionLiderPanel`, and the generic Líder/Agustín/Franco task component. They are not reachable through that component's active return. `GestionLiderPanel` and `RevisionPiezaModal` reference editorial approval (`lista`), correction (`pendiente` plus annotation), unblock (`en_revision` plus resolution), escalation task creation, and name-based task assignment. Reference search found their usages within Lider's historical subtree, not another live principal mount. Preserve their source; do not report them as newly lost active actions. Client quota modal references also exist in `Clientes.jsx`; full client-management equivalence was not audited.

### Augusto — `frontend/src/pages/dashboards/Augusto.jsx`

- Reads `/api/tareas?workspace=render_os&asignado_a=Augusto&tipo_tarea=diseno`, sorts by due-date string, shows next non-`publicada` design, designs overdue/due today, and delivered/total this month. Month uses `fecha_vencimiento || updated_at`; numerator uses exactly `estado === publicada`.
- Mounts generic assigned-design task controls below that summary; there are no other inline mutations in the summary.
- `/inicio` supplies next/current-user open work and due buckets; the task board has responsible/sector/client/priority/area/search/status controls and task detail. **It must not inherit the named Augusto filter from `/augusto`.** An administrator's old named-person view is not the same as administrator personal home; explicit authorized board/report selection is the candidate team destination.
- Reports offer per-ID period tasks and per-format totals, counting both `finalizada` and historical `publicada`, and using due date, then finalization date, then update date. That is related progress reporting, not the legacy design-only monthly fraction. Exact monthly/type summary parity remains unapproved.
- Generic metadata readability **B2 blocks retirement** until resolved.

### Luciano — `frontend/src/pages/dashboards/Luciano.jsx`

- Reads `/api/tareas?workspace=render_os&asignado_a=Luciano&tipo_tarea=edicion`, due-date sorts, shows next non-`publicada` edit and its `requiere_aprobacion` notice, plus monthly delivered/total using the same legacy date fallback/state equality as Augusto.
- Mounts generic assigned-edit controls, including material/feedback reads. Summary itself has no mutation.
- Candidate destinations: `/inicio` for current-user next work/review; `/workspace/tareas` editing tasks, material/parent-task warning, guarded state changes, editing deliveries/reviews and administrator approval; reports for ID-attributed period work.
- Task approval is not proven merely by having a review heading: `WorkspaceReadOnly.jsx:283` computes allowed transitions, and its approval path observes task revision/delivery before approval. Exact legacy monthly editing count is not certified.
- **B2 blocks retirement**. No named-person impersonation or automatic historical assignment resolution is acceptable.

### Germán — `frontend/src/pages/dashboards/German.jsx`

- Reads `/api/tareas?workspace=render_os&asignado_a=Germ%C3%A1n&tipo_tarea=produccion`; displays next/pending production tasks, coordinated timing, review-state tasks and client-level/month totals. Month uses due date then update date. The displayed “quota” is actually number of monthly tasks per client, not a configured deliverable quota; completion is exactly task state `publicada`.
- Pending/next cards open `DetalleProduccionGermanModal`. Writes: coordination metadata (**B1**) and `estado: publicada` through `/api/tareas/:id` (“Marcar material entregado”). Generic production task selector is also mounted.
- Its agenda is explicitly a placeholder, not an implemented calendar that needs preservation.
- `/producciones` has real normalized visits, video/photo states, scripts, material, pending/repeat bank, editorial associations and explicit editor/date handoff. These are distinct records/endpoints; they are not automatically historical tasks with equivalent names.
- `/workspace/tareas` retains aggregate legacy production registration/correction/confirmation paths, subject to registry linkage and production completion checks; normalized source tasks link to their actual visit. Those conditions are not equivalent to the old unconditional material-delivered PATCH. Do not bypass the newer checks to mimic it.
- Reports separate normalized video records from historical aggregate filmations; neither establishes the same old client “published tasks / monthly tasks” fraction. Preserve that semantic distinction; full progress-replacement decision remains open.
- **B1 and B2 block retirement**.

### Oriana — `frontend/src/pages/dashboards/Oriana.jsx`

- Reads `/api/historias` and `/api/publicaciones`, combines them by domain+ID, and keeps only `lista`, `publicada`, `bloqueada`. Renders today's pieces, unpublicized overdue pieces, up to ten future ready pieces, blocked pieces with `aclaraciones`, and today's published/total progress. Its “Esperando aprobación” number is actually the remainder after ready/published within that restricted state set; do not reproduce that label as proof of review semantics.
- Clicking today's ready piece opens a three-line **decorative** checklist (visual checkmarks, no checkbox validation/persistence). Only admins get the actual publication action. It PATCHes the correct story/publication endpoint with `estado: publicada`, then updates local state. Generic assigned-task controls are also mounted.
- Publication work survives in `/planificacion-historias` and `/planificacion-publicaciones`: `EditorialPublicationControl` is actually mounted in these pages. It reads `/api/editorial-publicacion/{historia|publicacion}/ID`; admin confirmation/withdrawal POSTs carry revision and request ID, with actual Córdoba occurrence time and acknowledgment. Historical `publicada` without evidence remains explicitly historical, not a new confirmation. This is a concrete manual-publication successor with stronger semantics, not social-network delivery verification.
- `/calendario` provides scoped scheduled and confirmed editorial events and links to those modules. It does not by itself certify the old combined blocked/overdue/next-ten triage, especially undated blocked pieces. Equivalent access across editorial modules requires Main's remaining inspection.
- `PublicationComposer` has separate draft/simulation routes under `/api/publicacion-envios`; its “Probar publicar” actions must not be called equivalent manual confirmation or actual external publication.
- **B2 blocks retirement**; combined editorial triage/progress coverage remains unapproved, not assumed absent solely because the layout differs.

## Generic assigned tasks and principal task behavior

`frontend/src/components/TareasAsignadasGenericas.jsx`:

- Admin queries one or more explicit provided responsible names; non-admin instead uses current `sesion.usuario.id` via `asignado_a_id`. Optional type filter; combines/deduplicates by task ID and sorts by due date.
- Reads title/client/due date/priority, approval flag, material and feedback metadata. Overdue excludes `finalizada` and `publicada`.
- State selector PATCHes `/api/tareas/:id?workspace=render_os` with `estado`, `expected_revision`, `expected_updated_at`, then reloads. `publicada` is displayed as `finalizada`. Approval/final options are disabled for non-admin when `requiere_aprobacion` is true. Server authorization is still required.
- Principal task board uses paginated `/api/tareas?workspace=render_os&limit=...&offset=...` through `render-os-api.js`, catalogs `/api/clientes` and `/api/usuarios`, direct-ID task fetch, detail comments/subtasks, and guarded revision-aware writes. It preserves valid task context separately from list pagination; opening a task is not proof of authorization.
- `features/render-os/utils/task-state.js` authorizes writes using user IDs, primary/collaborator IDs and roles. Admin approval requires review; finalization normally requires approval, with explicit completed-production exceptions. The generic selector's formerly offered transitions are not all valid successors. Keep authoritative current checks; do not port a looser selector as equivalence.
- Board responsible labels/filtering use names for an explicit presentation filter; that must not become alias-derived identity or a new grant. Backend `task-access.js` distinguishes shared render-os reads from scoped writes. This is source evidence only, not a fresh HTTP authorization proof.
- `/inicio` uses `/api/inicio` with no accepted query filters. Backend derives current identity from authenticated user ID and assignment rows; admin team review is distinct from personal work. Bounded lists (12 next tasks, eight reviews/context entries) expose totals and links; they are not exhaustive named-person dashboard copies.

## Historical data and metadata must remain intact

- No deletion, backfill, renaming, assignment mapping, or fabricated identity is proposed. Preserve raw `asignado_a`, IDs/collaborators, due dates, state aliases, approval flags, `escalada_a`, `motivo`, `motivo_bloqueo`, `feedback`, `material/Material`, `horario/coordinada`, editorial links, production origin/registry links and report provenance.
- `backend/src/operational-dto.js:73` explicitly projects these legacy task metadata fields. Their presence in a DTO does not mean the replacement UI displays them (**B2**), nor that the coordinator may reinterpret their meaning.
- Keep old dashboard source/reference files, including unreachable leader UI. Finance remains protected and must not be copied into personal-home or operational report DTOs.
- Route aliases must resolve to current-session home (or one valid task context), never to the person named by the old route. No filters/names/roles may be transplanted as authorization.

## Remaining inspection and execution — handed to Main

Not completed; do not mark these mapped or tested:

1. Full replacement for B1/B2/B3, including existing legacy rows whose identities are unmapped, completed/archived/trashed tasks and metadata-only information. No live data was inspected.
2. Complete global leader attention/workload and combined editorial overdue/blocked/today/future coverage, including undated blockers and records outside selected month/range. Reports' different counting definitions must be reviewed explicitly.
3. Exact monthly sector/client progress disposition for Augusto/Luciano/Germán; report helpers were inspected, not every payload path or expected historical fixture.
4. Full audit of large WorkspaceReadOnly/Projects/Productions/Feedback/Clientes/Historias/Publicaciones modules and their server handlers. Relevant sections were inspected; not every nested form, permission branch, pagination edge, DTO projection or failure path. Personal lists, Drive, moodboards and profile were not inspected as replacement candidates.
5. Full historical leader subtree and all quota/client modal internals were not exhaustively audited; active-vs-unreachable distinction and representative historical handlers were inspected. No claim that all historical exports are replaced.
6. Actual alias/history/draft behavior, session/access matrix, administrator/non-admin publication/production writes, same-task deep-link reload, mobile rendering and browser navigation. No browser or HTTP/DB test ran.
7. Route policy/helper/integration tests and final App removal/build/chunk inspection belong to other owners. This inventory did not run them or review their final integration. App was observed still mounting the five old dashboards during inspection; it was not edited.

Recommendation: **hold blanket cutover**. This document is a bounded functional gate handoff, not a retirement sign-off. Main owns remaining inspection and resolution under the contract; no missing equivalence was forced.
