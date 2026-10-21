# Client identity without an editorial agreement

Integration105 uses the canonical client/project APIs, not a new client type, parallel screen or browser database. Verification status belongs in `STATUS.md`; this contract alone is not evidence that a test passed.

## Creation

- The monthly-editorial creation flow is retained. A separate explicit creation choice sends only `{nombre}` to existing `POST /api/clientes`.
- Basic creation must not send hidden form leftovers: rubro, period, quotas, days, designer, fee or a UI mode. Presence of some of these keys activates the existing full-agreement contract even when their values are empty.
- PostgreSQL stores the basic client's stable ID, active status, zero default quotas and null industry/start date. It creates no configuration, fee, goal, content, production or project implicitly. These are database defaults, not a fictitious zero-cost contract.
- A real web/chatbot project can subsequently reference this active client ID through the existing project API. Project kind belongs to the project, not the client. No project or responsibility is inferred from a name.

## Presentation and identity maintenance

Absence of monthly configuration does not reclassify legacy positive quotas, shared feeds, fees or historical records. Show an unconfigured agreement only when the observed DTO explicitly has no configuration, dates, feed, quotas, days or fee. Missing monetary data is not a `$0` fee, and `0/0` is not proof of monthly compliance. Preserve actual historical commercial/operational information.

Basic identity edits use only `PATCH /api/clientes/:id` with name/active status and the exact observed `expected_revision`. Do not call configuration or next-month-fee endpoints to rename/deactivate a basic client. The ACK is a delta; do not erase unrelated existing fields. A monthly agreement must never be inferred from such an edit. Integration109 supplies the separate explicit first-agreement flow below.

## Authorization and concurrency

Both creation and canonical client PATCH capture immutable ID/session epoch before waiting for a pool connection. Since integration108 the client-administration advisory8142,1 precedes the current active administrator's `FOR SHARE` lock; this supersedes105's original actor-first ordering. Client PATCH then retains existing client/group version locks and CAS. Hold authority through commit; read audit labels from the current actor, not historical transport names. A revocation committed while waiting for the client mutex rejects the operation. A revocation queued behind an already-authorized held actor waits for that transaction before denying subsequent work.

## Explicit first monthly agreement — integration109

GET `/api/clientes/:id/acuerdo-mensual/iniciar` uses a fresh RR READ ONLY observation and current administrator ID/epoch/active/role validation. It returns only `{version:1,eligible:true,agreement_revision,cliente:{id,nombre,activo:true,rubro,fecha_inicio:null}}`. It accepts no query filters. An inactive client, nonzero base quotas, feed, start/end date or **any** historical/future configuration/fee makes the first-agreement endpoint ineligible409. Existing project/task history is not a new monthly contract and is not rewritten. Employees cannot read this administrative context or invoke the write.

POST to the same path has a closed payload: `vigente_desde` exact non-year-zero YYYY-MM, numeric integer quotas0..100, `abono_mensual` explicit canonical decimal string within NUMERIC(14,2), required numeric weekday arrays (history nonempty, optional-format preferences may explicitly be empty), existing `disenador_responsable` catalogue reference, nonempty `rubro`, and the observed resource-bound `expected_revision`. Blank/null/boolean/exponential/over-precision money is not zero. Chosen explicit zero quotas and fee remain valid. The legacy design reference is not a task identity or permission; operational assignees are selected separately through ID-backed goal/task preparation.

The transaction takes the client mutex, revalidates the current administrator under SHARE, locks/checks the client/group agreement CAS, then rereads all-time eligibility. It INSERTs one configuration and fee, updates the previously-null monthly start to the explicit selected month plus operational quotas/rubro, and reads the persisted values/new revision before commit. There is no UPSERT that could replace an existing agreement through this endpoint. It does not rename/deactivate the client, create tasks/objectives/content, record cash/payment, or enable a scheduler. An agreed recurring fee is not evidence of a received payment. Any failed statement/readback/commit rolls back or reports an uncertain failure; no constructed-input-only ACK is accepted.

Success is `{version:1,cliente:{id,nombre,activo,rubro,fecha_inicio,cuota_reels,cuota_carruseles,grupo_feed_id:null,configuracion_completa:true,configuracion_vigente_desde,abono_vigente_desde,abono_mensual,dias_historias,dias_reels,dias_carruseles,disenador_responsable,agreement_revision}}`, with fixed-two decimal money and sorted arrays. Missing revision428, malformed input400, changed CAS409, ineligible409, unknown client404. Responses are no-store. This is first-write CAS/history protection, not a durable replay receipt.

The canonical client detail exposes a separate admin-only “Configurar acuerdo mensual” action. It fresh-checks server eligibility, starts with empty draft values, requires explicit acknowledgment and verifies the complete ACK before showing success. Shared dirty/busy navigation guards protect the draft and in-flight request. Unknown/malformed responses preserve the draft and block a second POST; closing triggers a fresh portfolio read rather than assuming rollback or treating another writer's record as this attempt's receipt. A future-month ACK is never merged into the parent period's monthly projection. Existing identity editing remains separate and sibling editors cannot open over this operation.

Monthly catalogue fallback does not apply a newly stored base quota to months before `fecha_inicio`: absent an effective historical configuration, a later start month yields zero quota for the earlier selected month. Actual effective configurations still take precedence, null starts retain legacy fallback and a midmonth legacy start remains in its own month. No historical stored quota is rewritten by this projection. The detail identifies a known future start and does not offer first-agreement onboarding again. Canonical card/detail/create-preview fee presentation retains two decimals and fee inputs accept cent precision; unknown fee remains absent, never a fabricated zero.

Integration109 also revalidates the current administrator inside the transaction for existing monthly configuration, next-month fee and empty-client deletion. All use client mutex → held actor → agreement/domain locks; original CAS and complete history-safe deletion rules remain. Existing configuration numeric-string quotas, duplicate-day normalization and omitted optional weekday preferences remain compatible, but explicit blank/null/boolean monetary/quota/day coercions, malformed write months and unknown configuration fields are rejected. The read-only period fallback is unchanged. Next-month fee still means next server month, not the selected historical UI month; it now validates explicit decimal input and uses the current DB actor label. These protections do not claim that a fee agreement is a payment receipt.

## Unconfirmed results

Client creation has no durable request receipt. A failed response or malformed acknowledgment is not evidence of rollback and must not enable an automatic second POST. Recovery is an explicit read under the original session/context; finding a same-name row is not an acknowledgment. Duplicate-name409 is not a successful result. The exact known-rejection pairs400/`CLIENT_CREATE_INPUT_INVALID` and409/`CLIENT_NAME_EXISTS` allow explicit correction and a new manual submission, preserving the draft; no automatic retry occurs. Untyped errors remain uncertain. Unknown-attempt recovery is memory-only and can be lost on forced exit; the PostgreSQL client record, if committed, persists independently. Current permission denial must remove administrative/financial data and disable attempt recovery rather than retain it behind stale admin UI.

## Release limits

No schema migration or real account change is required by105. Coordinated backend/frontend rollout, real account/provider acceptance and approved production authorization are still separate gates. Do not call a temporary PostgreSQL/browser test a production deployment or full cross-device acceptance.
