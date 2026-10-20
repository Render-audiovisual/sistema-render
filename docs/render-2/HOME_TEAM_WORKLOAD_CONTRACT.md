# Connected team workload — integration contract

`GET /api/inicio/equipo` is an administrator-only operational read. It is not a financial report, editorial workload estimator or named-person home. Current active identity, role and session version are rechecked in a read-only repeatable-read transaction. An administrator label in React or an alias URL grants nothing.

## Selection and attribution

Only render_os tasks, outside archive/trash and with an active/non-false client (or no client), enter the summary. Finalizada and historical publicada are completed work and excluded. A strict boolean revision_aprobada on en_revision is projected as aprobada, separately from review. Neither completion nor approval creates an editorial publication.

Global open/overdue counts include every selected task exactly once, including historical tasks without an assignment ID. Overdue means due date before the statement's current Córdoba calendar day; undated tasks remain open but not overdue. There is no month limit or truncated frontend task download.

Each current tarea_asignaciones membership counts a task once per user, whether responsible or collaborator. Homonyms stay separate IDs. Inactive accounts with assigned open work remain visible and labeled inactive. Users with zero open work are not listed. Per-person totals may overlap and must not be summed as the global task total. Tasks without **any** ID membership enter the explicit unassigned bucket; textual names do not resolve or grant identity.

## Pagination and DTO

Only offset (default0,0..1000000) and limit (default20,1..50) are accepted as canonical scalar decimal strings. Same validation as escalations; repeated, unknown or invalid parameters fail400. People sort by overdue DESC, open DESC, ID ASC. Global counts and total_people are independent of page offset and computed in the same read snapshot. No cross-request immutable snapshot is promised.

Closed projection: version1, today, offset, limit, total_tasks, total_overdue, total_people, has_more, unassigned:{open,overdue}, items:[{user:{id,nombre,activo},open,overdue,review,approved}]. No roles, salaries, income, client fees, descriptions, scripts, metadata bags or arbitrary user records. Cache-Control:no-store.

## Principal interface

An administrator-only card in connected Inicio uses20-row pages and safe links to the board's stable responsible=id:ID filter. That board link displays the user's tasks under existing board semantics, not exclusively the open subset of this card. It does not switch session identity. Current totals include unassigned work; an unassigned-specific board filter is not invented.

Typed parsing closes nested projections, validates counts/pages/order/IDs and dates. Session identity, token, role, active flag, abort and generation guards suppress late data across logout, replacement requests and disposal. Errors clear totals rather than retain misleading prior data. Focus/online/visibility refresh uses the existing bounded subscription. No local operational persistence, new theme, migration, backfill or auto-write.

## Legacy disposition

This replaces the task-based global workload capability with corrected definitions. The old getResumenEquipo hardcodes four names, includes all task states in its cargaTotal and falls back to editorial items when no tasks match. Those are **not** copied into this task summary. Combined editorial overdue/blocked/today attention remains a separate replacement gate. The Lider dashboard must stay mounted until that capability and remaining runtime equivalence are verified. Finance stays in the authorized finance module. Verification evidence belongs in STATUS; implementation alone is not a release certificate.
