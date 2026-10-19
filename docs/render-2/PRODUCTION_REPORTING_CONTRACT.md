# Shared production reporting and task discovery

Development contract after the normalized registry integration. No historical identity inference, migration or commercial-data backfill.

## Read boundaries

- `GET /api/producciones/tareas/:taskId` returns `{vinculo:null}` or the related registry UUID, date/revision, origin/editing kind and media counts. Real source/editing foreign keys determine linkage; task JSON cannot spoof it. Only verified active sessions reach the route. Invalid IDs return 400.
- `GET /api/reportes/datos` adds `producciones:{desde,hasta,visitas:[...]}` using explicit operational projections. Visits expose IDs/client/date/title/participant IDs, videos expose recording state and joined current editing state/identity/deadline, photos expose type/state. No raw JSON, scripts, Drive credentials, payroll or amounts are queried by the production projection.
- Explicit `desde`/`hasta` require both valid ISO dates, inclusive start/exclusive end, 1–366 days. Otherwise the selected configuration month determines calendar bounds.
- Normalized registry data remains shared with all server-verified active identities, consistent with the registry itself. An unknown active role receives no legacy task/editorial/client/delivery authority, only this sanitized shared registry and its own public user row. Missing/inactive identities receive no report data. Financial APIs remain independently server-authorized.

## Identity and attribution

Report task rows are batch-annotated from `tarea_asignaciones`. Owner/collaborator IDs and the server-stored editor-credit ID determine attribution; first-name matching and hardcoded client/person lists are removed. Historical name-only tasks remain unattributed. Legacy editing deliveries lack a persistent editor ID: employees do not receive those rows by inferred name, while authorized admins retain the unchanged historical management data. Adding an approved ID mapping for those records remains a separate transition.

Non-admin summaries aggregate only the already scoped task rows. Histories/publications used for personal reporting follow explicit task links (`historia_id`, `publicacion_id`), with different ID namespaces. Structured-finance filtering remains an allowlist at every new nested level. Quotas are nonnegative explicit client/feed configuration values, not role-based capacity guesses.

## Counting rules

- A UUID counts once per media registry projection. A repeated visit/video record is not declared a unique editorial piece, quota completion or publication.
- Source report rows carry a DB-computed `produccion_registro_individual` flag based on media existence across all dates. Legacy quantity reporting excludes those sources even when a visit moves outside the selected range. Historical and normalized figures remain separate, never silently summed.
- Finalized tasks represent completed work. Actual dated-publication reporting requires the editorial `publicada` state plus a valid stored `fecha_publicación_real`; legacy published rows without a valid date are shown separately. No task transition invents an editorial date.
- Monthly feed quotas are grouped once by feed ID. Missing/conflicting values remain unavailable. Visible editorial counts are labeled as permission-scoped, not global feed fulfillment; rolling windows are not prorated monthly quotas.

## UI discovery and navigation

The task drawer looks up real registry context, blocks legacy production writes while loading/on error, and offers a retry. Individual-media visits suppress the aggregate recording form; empty verified visits preserve the untouched legacy flow during transition. Source client/date fields are edited in Producciones. Editing-task client remains tied to the visit while its delivery date remains editable. Focus/visibility refresh the lookup without resetting an unsaved task draft.

`/producciones?visita=UUID` opens the actual detail/month/day and supports reload/back/forward. Report period buttons preserve URL history. Task material does not fabricate a copied registry Drive value; linked origins direct the user to the visit's material instead of falsely warning that Drive is absent.

## Implementation map and remaining gates

- `backend/src/production-reporting.js`: bounded range, production projection, task-context relation.
- `backend/src/server.js`: authenticated routes, report memberships/client/editorial fields.
- `backend/src/report-access.js`: safe schemas, ID scoping, post-authorization aggregation.
- `frontend/src/pages/WorkspaceReadOnly.jsx`: verified link/read-only origin fields/legacy guard UI.
- `frontend/src/pages/Productions.jsx`: deep-link restoration.
- `frontend/src/pages/Reportes.jsx`, `ReportProductionRegistry.css`, `shared/reports/production-registry-report.js`: real metrics, period/history, person drilldowns, editorial/quotas, separate history.

Still open: explicit video→editorial publication→objective linkage that reuses one canonical delivery task; normalized visit closure/source-task completion policy; personal backend dashboard and broad navigation/design consolidation. Linking must not silently replace an objective's publication with null, generate a second task, infer pieces from counts or publish from task completion. External publication/Drive verification and real-account mapping are not proven here.
