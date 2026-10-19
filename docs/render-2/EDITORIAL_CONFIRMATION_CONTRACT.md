# Explicit editorial publication — principal backend contract

Status: principal backend implemented and verified locally; UI/metric adoption remains open. This contract is not whole-phase completion or rollout authority. Preserve all existing commercial records and historical publication state/dates. No inference/backfill from task status, metadata, names, existing dates or migration dates. Read CLIENT_PUBLICATION_FINDINGS.md first.

## Ownership and scope

- Coordinator owns this contract, shared server mount/startup readiness/harness, integration and verification.
- Schema worker owns064 SQL and its focused schema tests only.
- Backend worker owns editorial-publication.js and focused pure tests only.
- Independent QA owns the new opt-in principal HTTP/PostgreSQL suite and QA document only.
- No concurrent server.js/App.jsx edits. Old UI/PATCH endpoints remain operational during staged adoption, but cannot create a new confirmation. Subsequent UI/metric adoption is required before calling the editorial workflow complete.

## API

Mount `createEditorialPublicationRouter({express,pool})` at `/editorial-publicacion` after current-identity middleware. Domain path values are exactly `historia` or `publicacion`; positive int32 piece IDs. Supported current human roles may read; only current admin may confirm/withdraw (matching current editorial mutation authority). Revalidate active stable actor/session/role inside each transaction, writes holding actor FOR SHARE. No username privilege or local selector authority. GET transactions use consistent read-only snapshots; writes READ COMMITTED. Write lock order: actor → actor/request advisory → active client FOR SHARE → editorial piece FOR UPDATE → version. Discover client ID without a piece lock first and recheck it after locking the piece (changed association409); do not invert client→piece because existing client deletion cascades into pieces. This prevents deactivation during a waiting confirmation. Exclude inactive clients and metadata.archivado_tablero=true pieces with404. No task access bypass.

- `GET /:dominio/:id`: safe current status DTO.
- `POST /:dominio/:id/confirmar`: closed JSON `{request_id:UUID, expected_revision:nonnegative safe integer, occurred_at:ISO8601 with explicit Z/offset}`. Normalize to UTC milliseconds, reject invalid normalized dates and future instants. Human explicitly declares actual publication time; scheduled date is unchanged. Source is server-fixed `manual`, never externally verified.
- `POST /:dominio/:id/retirar`: closed JSON `{request_id:UUID, expected_revision:nonnegative safe integer}`. Requires a current confirmation; no-op/absent confirmation409. Sets editorial state to `lista`, clears actual date, removes current confirmation but retains immutable events. No task/goal status changes.

Confirmation sets piece state `publicada` and root `fecha_publicación_real` to normalized occurred_at, records immutable actor/event and current reference atomically. Explicit confirmation of an old unverified row is allowed only through this user action, never a migration. A currently confirmed piece requires withdrawal before another confirmation; repeated intent uses its original request UUID.

Both writes require observed revision and durable actor/request UUID/canonical intention hash. Hash includes domain, ID, action, normalized business input and expected revision. Actor/request reuse with different intent409. Current identity/access is rechecked before replay; same intent returns current status plus operation ID/action, `replayed:true,changed:false`, never recreates an event or claims withdrawn publication is still current. New writes return201 (confirmation) /200 (withdrawal), `replayed:false,changed:true`. Invalid400, inactive/revoked401, unsupported role/nonadmin write403, invisible404, stale/duplicate/domain SQL constraint409; unexpected errors500 and rollback. JSON no-store.

DTO: `piece:{id,dominio,cliente_id,estado,revision,fecha_programada,fecha_publicacion_real}` (unambiguous ISO instant or null), `classification` one of `confirmada_manualmente`, `historica_sin_confirmacion`, `no_publicada`; `current_confirmation` null or `{id,actor_id,occurred_at,recorded_at,source:'manual'}`; `can_confirm` boolean. Historical classification means an old state/date exists without this new event, not verified actual output. `operation` only on writes, minimal `{id,action}` plus replay/change flags. No finance, arbitrary metadata, scripts, private task content or user secrets. Existing title/copy are unnecessary here.

## Additive064 persistence (no historical DML/column rewrite)

Two new tables; existing stories/publications gain AFTER UPDATE trigger definitions only. No backfilled version/event rows.

1. `editorial_publicacion_versiones`: `dominio TEXT`, `pieza_id INTEGER`, `historia_id INTEGER NULL`, `publicacion_id INTEGER NULL`, `revision BIGINT NOT NULL CHECK>=1`, `current_event_id UUID NULL`; PK(dominio,pieza_id). Exactly one piece FK set, matching declared domain/id. Piece FKs ON DELETE CASCADE for versions without history; event FKs independently restrict deleting confirmed history.
2. `editorial_publicacion_eventos`: `id UUID PK`, domain/piece/FK tuple as above, `cliente_id INTEGER FK clientes RESTRICT` (client observed at this operation, not inferred later), `actor_id INTEGER FK usuarios RESTRICT`, `action` confirmar/retirar, `source` manual only, `request_id UUID`, `intent_hash TEXT64hex`, `expected_revision BIGINT CHECK>=0`, `occurred_at TIMESTAMPTZ NULL` (required confirmar, null retirar), `recorded_at TIMESTAMPTZ default clock_timestamp()`, `previous_event_id UUID NULL FK self RESTRICT`. UNIQUE(actor_id,request_id), UNIQUE(id,dominio,pieza_id), same-piece composite FK for previous-event lineage. Piece/client history never cascades away. No arbitrary content payload.

Current reference is composite FK(current_event_id,dominio,pieza_id) to matching event. A guard requires referenced event action confirmar, matching actor/piece/domain and current piece state/date, never a withdrawal event. Event UPDATE/DELETE is forbidden by a named constraint error; ordinary database ownership/superuser remains outside application threat guarantees. Runtime least privilege still required.

Every future piece UPDATE upserts/increments version once (initial post-upgrade revision1; missing row reads revision0), ignoring any attempted direct revision provenance input. Preserve current reference on unrelated title/copy/date-planning changes; clear it on changed client/type/editorial state/actual timestamp or changed archive flag. Later restoration must not reactivate old evidence automatically. No trigger sets editorial state/date or inserts confirmation events. Do not acquire reverse task/goal/advisory locks. Trigger and service always use piece→version lock order. Versions can be updated by service only to attach a matching event after the piece UPDATE has advanced the observed revision. New receipt/events and attachment must commit/rollback with the piece.

Named constraints prefixed `editorial_publicacion_` allow bounded409 mapping; no blanket conversion of unexpected SQL errors. FKs/checks reject cross-piece/domain/actor evidence. Schema tests must document trigger/DDL and no historical DML. Actual populated-upgrade tests prove existing row JSON unchanged and both new tables empty. Startup/harness dependencies handled by coordinator before runtime tests.

## Verification gates

Fresh guarded PostgreSQL fixture only. Confirm/withdraw/replay/CAS/concurrent same-key requests, independent IDs/homonyms, immediate revocation/nonadmin denial, invalid/malformed dates/fields, hidden records/clients, transaction fault rollback and same-key retry, immutable history/restrictive deletion, changed/reverted legacy state/date invalidates current reference, unrelated copy preserves it, task completion never creates evidence, scheduled date unchanged, historical row snapshots unchanged. Both domains must behave equivalently. No migration/deployment/real account or external provider use authorized by these tests.

Backend-only completion is not full UI adoption. Principal content controls, reports and client overview must later use the evidence DTO and clearly separate planned-cohort output, actual-publication-month output and unknown historical coverage; until then CLIENT_PUBLICATION_FINDINGS remains unresolved. No external verification claim and no whole-phase/master completion.
