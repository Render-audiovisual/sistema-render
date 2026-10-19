# Editorial confirmation adoption — integration contract

Goal: use the existing064 principal confirmation service in existing content controls and read indicators, not a parallel screen. Preserve historical data, planned cohorts/quotas/shared feeds and task/publication separation. Backend-only confirmation is not enough; old state/date/checklist flags must not earn new confirmed-publication counts.

## Shared read field

Existing GET historias/publicaciones and report dataset rows gain server-generated `publicacion_evidencia`:
`{classification:'confirmada_manualmente'|'historica_sin_confirmacion'|'no_publicada',revision:nonnegative safe integer,confirmation:null|{id:UUID,actor_id:positive integer,occurred_at:UTC ISO,recorded_at:UTC ISO,source:'manual'}}`.

Root actual-publication timestamp on publication list becomes an unambiguous ISO instant (remove timezone-less to_char projection); planned YYYY-MM-DD remains unchanged. Never read evidence from metadata. Closed DTO projection for every role, including nested finance-sentinel tests. A missing or malformed field means no confirmed credit, not manufactured zero historical records. Historical classification records coverage uncertainty, not age or proof of external publication.

Backend helper `annotateEditorialEvidence(db,domain,rows)` queries current principal tables/064 evidence in one bounded query per nonempty domain (IDs deduplicated), no per-piece N+1, no writes. Server owns route/DTO/report wiring. Attach proof only if domain/ID/client/state/actual instant match both immutable event/current reference AND the base observed row; archived/inactive/inconsistent/missing rows never receive confirmation. No optimistic mixing of an old base row and newer proof. Unconfirmed observed state/date maps to historical unknown, otherwise no_publicada. No new migration required.

## Existing content controls

Shared `EditorialPublicationControl` reads the principal singular status on opening; displays historical uncertainty/current manual actor/time; permits admin explicit confirmation/withdrawal via064 endpoints. A date/time input explicitly uses Córdoba UTC-03:00; require an explicit human confirmation that publication actually occurred. Source remains manual, never externally verified. Read-only staff may inspect status but cannot mutate.

Mutation uses the observed revision and one UUID per exact intention; retain it across uncertain network retry, never silently fetch/rebase after409. Show explicit reload/review action while preserving input. No localStorage operational persistence. Current session/selection changes cancel reads/discard late responses; prevent duplicate submits. After success, refresh the actual parent dataset or merge explicit server status/evidence safely. Do not lose a saved backend result if refresh fails. Keyboard focus/escape cleanup,44px touch controls, compact white/gray/blue system-font styling, mobile bounds.

Existing single-piece publish controls must open this control instead of directly PATCHing state. Day/client checklist markers may remain planning annotations but cannot count as confirmed pieces or silently create confirmation events; each actual piece needs its own explicit record. Any still-unconverted batch/checklist path must be labelled legacy/planning and excluded from confirmed metrics. No automatic mass publication confirmation.

## Indicators and periods

One shared predicate on the server-generated closed field accepts only valid manual confirmation (UUID/actor/source/UTC actual date) with root piece state/date identity consistency; absent/legacy/malformed fields never credit confirmed counts. Preserve legacy/unknown coverage separately, not silently reinterpret stored rows. Stable domain/piece-ID deduplication and existing shared-feed quota deduplication remain.

Client quota progress uses confirmed pieces in the existing scheduled-month cohort; explicitly label this cohort. A separate actual-publication-period measure uses confirmation occurred_at interpreted in Córdoba, not scheduled date or task deadline/update. Reports already expose planned/actual columns: upgrade confirmed actual counts and separate dated/undated historical coverage rather than call any old state/date "confirmed". No change to contracted quotas, salary calculation, financial permissions or automatic task/goal states.

## Ownership

- Coordinator: contract, shared server/read DTO/report wiring, Reportes.jsx/Clientes.jsx labels/coverage, final actual verification/integration.
- Backend worker: new editorial-evidence-read.js plus focused tests only.
- Content UI worker: Historias.jsx, Publicaciones.jsx, new shared control/model/styles and their tests only; do not edit App/server/metrics helpers/Modal.
- Metrics worker: clientesStats.js, shared/reports/production-registry-report.js, shared pure evidence predicate and metric tests only; coordinate shared predicate name with UI/coordinator.
- Independent QA: new principal HTTP/SQL adoption test plus QA doc only; no servers/fixtures started by subagents.

Verification: actual confirm→normal list/report DTO→metrics→reload→withdraw; both domains, roles/privacy, stale/changed-source invalidation, historical flags/task finalization no credit, no double feed/piece counts, Córdoba cross-month boundary, no query-per-row, conflict/uncertain retry/selection races, existing content creation/editing, desktop/mobile. New control alone does not certify every legacy content view or master completion. Use fresh guarded principal fixtures only; no production/deploy/external account.
