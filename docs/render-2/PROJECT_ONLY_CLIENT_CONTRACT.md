# Client identity without an editorial agreement

Integration105 uses the canonical client/project APIs, not a new client type, parallel screen or browser database. Verification status belongs in `STATUS.md`; this contract alone is not evidence that a test passed.

## Creation

- The monthly-editorial creation flow is retained. A separate explicit creation choice sends only `{nombre}` to existing `POST /api/clientes`.
- Basic creation must not send hidden form leftovers: rubro, period, quotas, days, designer, fee or a UI mode. Presence of some of these keys activates the existing full-agreement contract even when their values are empty.
- PostgreSQL stores the basic client's stable ID, active status, zero default quotas and null industry/start date. It creates no configuration, fee, goal, content, production or project implicitly. These are database defaults, not a fictitious zero-cost contract.
- A real web/chatbot project can subsequently reference this active client ID through the existing project API. Project kind belongs to the project, not the client. No project or responsibility is inferred from a name.

## Presentation and identity maintenance

Absence of monthly configuration does not reclassify legacy positive quotas, shared feeds, fees or historical records. Show an unconfigured agreement only when the observed DTO explicitly has no configuration, dates, feed, quotas, days or fee. Missing monetary data is not a `$0` fee, and `0/0` is not proof of monthly compliance. Preserve actual historical commercial/operational information.

Basic identity edits use only `PATCH /api/clientes/:id` with name/active status and the exact observed `expected_revision`. Do not call configuration or next-month-fee endpoints to rename/deactivate a basic client. The ACK is a delta; do not erase unrelated existing fields. A monthly agreement must never be inferred from such an edit. A future conversion to a monthly service needs its own explicit, complete agreement flow rather than fake defaults.

## Authorization and concurrency

Both creation and canonical client PATCH capture immutable ID/session epoch before waiting for a pool connection, then lock the current active database administrator with `FOR SHARE`. The actor lock precedes administration advisory lock8142,1, matching quota reconciliation. Client PATCH then retains existing client/group version locks and CAS. Hold authority through commit; read audit labels from the current actor, not historical transport names. A previously committed revocation rejects the operation. A revocation queued behind an already-authorized transaction waits for that transaction before denying subsequent work.

## Unconfirmed results

Client creation has no durable request receipt. A failed response or malformed acknowledgment is not evidence of rollback and must not enable an automatic second POST. Recovery is an explicit read under the original session/context; finding a same-name row is not an acknowledgment. Duplicate-name409 is not a successful result. The exact known-rejection pairs400/`CLIENT_CREATE_INPUT_INVALID` and409/`CLIENT_NAME_EXISTS` allow explicit correction and a new manual submission, preserving the draft; no automatic retry occurs. Untyped errors remain uncertain. Unknown-attempt recovery is memory-only and can be lost on forced exit; the PostgreSQL client record, if committed, persists independently. Current permission denial must remove administrative/financial data and disable attempt recovery rather than retain it behind stale admin UI.

## Release limits

No schema migration or real account change is required by105. Coordinated backend/frontend rollout, real account/provider acceptance and approved production authorization are still separate gates. Do not call a temporary PostgreSQL/browser test a production deployment or full cross-device acceptance.
