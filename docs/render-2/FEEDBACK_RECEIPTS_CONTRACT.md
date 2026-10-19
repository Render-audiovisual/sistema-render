# Feedback trusted provenance and durable retries

Approved implementation contract for this local block, not evidence of completed verification. Preserve shared-team notes; do not introduce creator-only access or change purge authorization.

## Boundary

Browser note business metadata: cliente, responsable, responsables, referencia, estado, vigencia, flujo. Server-owned reserved keys (at request root or in feedback) reject 400: origen, confirmado_por, confirmado_por_id, confirmado_at, provenance_version, wilson_idempotency_key. Browser PATCH merges normalized business fields into stored metadata atomically, preserving historical provenance. Historical JSON remains unverified and never grants authority or becomes a receipt. Integration explicitly constructs server provenance from current verified identity; never normalize caller provenance as trusted.

## Intention and confirmation

Wilson create and edit require a human stable user ID, current supported role/active external mapping and bounded nonempty idempotency key (trimmed string, maximum 200; header/body disagreement rejects 400, never truncate). Canonical versioned request-intent hash is pure, before live catalog/target lookup. Normalize business aliases and reject contradictory aliases; reject malformed types. PATCH distinguishes omission from explicit empty values, includes target ID and required expected_updated_at normalized ISO. Include permitir_duplicado and all effective business fields; exclude confirmation secrets/transport-only fields. No live-row merge in replay hash. Unknown business input must not affect mutation silently.

Both WhatsApp and explicitly mapped Telegram feedback mutations require an exact, expiring single-use token from /confirmaciones. Permit Telegram there only for feedback operations; other operation policies unchanged. Feedback confirmation hash binds stable actor ID, operation, target, canonical intention and idempotency key. Reject a stale PATCH base version before mutation. Existing unconsumed legacy feedback confirmations must be renewed after this change; do not reinterpret them. No token/key stored in editable note metadata or returned receipt.

Preserve the existing group-participant-only restriction for issuance, mutations and retries; a stable user mapping alone does not widen transport permissions. Use one client selector (ID or nonempty name), never silently resolve contradictory selectors. Canonicalize equivalent nested/root business values before checking agreement; require a valid timezone-bearing ISO version.

## Persistence and transaction

061 creates feedback_operation_receipts: id BIGSERIAL; actor_user_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT; operation constrained crear_feedback/editar_feedback; idempotency_key bounded 1..200; payload_hash lowercase SHA256; note_id BIGINT positive without note FK; note_updated_at TIMESTAMPTZ; committed_at TIMESTAMPTZ; unique(actor_user_id,operation,idempotency_key). No content snapshots, backfill, expiry, automated deletion or legacy key promotion. Immutable after insertion via application; retention review remains a rollout gate.

061 also installs a BEFORE UPDATE note trigger: updated_at is the greater of current clock time truncated to milliseconds and old updated_at truncated to milliseconds plus one millisecond. Existing rows are untouched. This makes the existing ISO timestamp compare-and-swap token strictly advance across all future writers, including rapid updates, archive and restore; SQL compares at that same millisecond precision.

Transaction order: lock current verified actor/mapping for scope revalidation, transaction advisory lock(actor ID,operation,key), lookup receipt; same hash replays, changed hash409. Revalidate active role/mapping before returning stored result. No receipt: lock note for PATCH, check exact version, validate business intent against live catalog, check duplicates, consume exact token, mutate note, audit and insert receipt in same transaction. For create enqueue existing private feedback notification rows using the transaction client before commit (no external delivery). Rollback must restore note/receipt/audit/token/outbox together; replay does not enqueue again. Existing browser creation notification gap is outside this bounded Wilson transaction change and must not be called fixed globally.

Token consumption first locks the exact scoped confirmation row without an expiry predicate, then conditionally updates unused/expiry using clock_timestamp(). This is required because NOW() is fixed at transaction start and even an UPDATE predicate using wall clock can run before an unchanged token-row lock wait. A token expiring during either note or token lock wait must reject without consumption. Actor IDs with receipts remain restrictive references; admin permanent-user deletion reports 409 with guidance to deactivate, never silently deletes the receipt or deactivates an account instead of the requested operation.

## Replay response

HTTP200, idempotent:true, created:false (create) or updated:false (edit), feedback_id, receipt:{operation,note_id,note_updated_at,committed_at}. No saved business content in receipt. If live nonarchived note exists, feedback is its current shared DTO and result_current:true, not a false original snapshot. Archived/purged note: feedback:null plus archived:true or deleted:true; never recreate or expose archived content in retry. Receipt lookup precedes target existence/catalog/version checks for exact retries. Authorization still precedes replay. Different actors/operations have separate scopes; key reuse with different target or patch conflicts within an operation.

## Ownership and acceptance

Main: server.js/browser normalizer and shared docs/harness. Archimedes: Wilson feedback handlers + feedback-receipts helper/pure tests. Arendt:061+schema tests. Herschel: browser payload allowlist compatibility/tests. Wegener: independent real HTTP/SQL suite (port55604) and QA doc. Confucius/Darwin: independent read-only contract/implementation review. No simultaneous server.js/App.jsx edits.

Acceptance: browser reserved rejection/preservation including legacy metadata; no JSON replay; exact create/edit retries, actor/key/hash isolation, concurrent one winner, stale version, malformed/oversized keys, alias contradictions, current role/mapping loss, rollback and retry with same token, edit/archive/purge survival, exactly one audit/notification enqueue, additive populated history invariance. New guarded fixtures only; no existing database, ordinary server, external transport or deployment.
