# Feedback trusted provenance and durable retries

Approved implementation contract for this local block, not evidence of completed verification. Preserve shared-team notes; do not introduce creator-only access or change purge authorization.

## Explicit operational responsible IDs — cut257

Optional `responsable_ids` is a shared browser/Wilson business field, not an ACL or authentication mechanism. Omission retains historical label-only metadata; an explicit array never falls back to names. Accept at most20 distinct positive int32 numeric IDs, sorted/copied without coercion. New or changed selections require active catalogue rows locked FOR SHARE in the writer transaction. Server derives display labels; caller names cannot select identities. Feedback requires at least one ID when present.

Unchanged stored IDs may survive unrelated edits after an account becomes inactive/unavailable, preserving stored labels, without authorizing new delivery. Changed labels without IDs on an ID-bound note reject409. Legacy notes are not backfilled. Closed DTOs retain optional IDs and reject malformed stored IDs. Captured requests/retries clone arrays and preserve presence; Wilson hashes IDs only when supplied, leaving historical omission hashes unchanged.

Canonical UI selects numeric IDs, distinguishing homonyms by name/login/ID. Historical text never infers checked identities. Missing/inactive selections remain visible/removable; unavailable catalogues do not erase them. New drafts require an ID, while unchanged legacy edits remain possible. Shared-note permissions, provenance and creation-only notifications remain unchanged. Explicit active IDs drive new notices; legacy absent IDs retain the unique-active-label resolver below.

This extends the older metadata/DTO boundary below to include optional responsable_ids. No migration, notice lifecycle policy or provider guarantee is implied. Cut258 verifies the explicit-ID Wilson flow with signed local HTTP/PostgreSQL and native desktop/mobile create/edit/reload for the canonical picker; evidence and remaining limits are recorded in FEEDBACK_RECEIPTS_QA.md.

## New notification identity and browser atomicity — cut256 (historical, extended above)

Operational responsible fields remain display text, not ACLs. For new notices, resolve each normalized label against active users' username/name with no precedence. Deduplicate matches by positive int32 ID; admit only one distinct ID per label. Unknown/ambiguous labels omit that destination without rejecting the shared note or fanning out. Multiple labels for one account produce one destination. This compatibility boundary does not let the UI select between homonyms; that requires a later explicit-ID business contract.

Every admitted new notice stores `detalles.destinatario_usuario_id`. Verified writers also supply `actorId`, validate it and exclude that exact ID; stored `actor_usuario_id` is internal delivery evidence, not editable note metadata. A caller without actorId retains legacy name-based author exclusion. New fingerprints use `feedbackFingerprint(['feedback-recipient-id-v1',noteId,recipientId,eventVersion])`. Existing notices are not backfilled, reassigned or re-emitted; no retroactive deduplication between legacy and v1 fingerprints is claimed.

Browser create with flujo=feedback now awaits enqueue on the same leased transaction client, after note readback and before receipt/COMMIT. Remove route-level postresponse scheduling. Queue INSERT failure rolls back note/outbox/receipt; exact replay returns before enqueue. Plain notes, edits, trash, restore and purge do not create these creation notices. Wilson retains its existing atomic enqueue and passes the verified actor ID. No external transport runs inside either transaction. Public DTOs and note permissions remain unchanged.

The existing delivery predicate checks ID-bound notices against current account activity, WhatsApp eligibility and unambiguous key ownership; Feedback must not acquire task-membership requirements. This is a delivery-time read observation, not a lock through external delivery. Old unbound notices remain legacy. Changing responsible text, deleting a note or revoking access after the final check needs separate lifecycle policy. Tests/evidence in FEEDBACK_RECEIPTS_QA.md; this contract alone is not acceptance or deployment.

## Boundary

Browser note business metadata: cliente, responsable, responsables, referencia, estado, vigencia, flujo. Server-owned reserved keys (at request root or in feedback) reject 400: origen, confirmado_por, confirmado_por_id, confirmado_at, provenance_version, wilson_idempotency_key. Browser PATCH merges normalized business fields into stored metadata atomically, preserving historical provenance. Historical JSON remains unverified and never grants authority or becomes a receipt. Integration explicitly constructs server provenance from current verified identity; never normalize caller provenance as trusted.

## Intention and confirmation

Wilson create and edit require a human stable user ID, current supported role/active external mapping and bounded nonempty idempotency key (trimmed string, maximum 200; header/body disagreement rejects 400, never truncate). Canonical versioned request-intent hash is pure, before live catalog/target lookup. Normalize business aliases and reject contradictory aliases; reject malformed types. PATCH distinguishes omission from explicit empty values, includes target ID and required expected_updated_at normalized ISO. Include permitir_duplicado and all effective business fields; exclude confirmation secrets/transport-only fields. No live-row merge in replay hash. Unknown business input must not affect mutation silently.

Both WhatsApp and explicitly mapped Telegram feedback mutations require an exact, expiring single-use token from /confirmaciones. Permit Telegram there only for feedback operations; other operation policies unchanged. Feedback confirmation hash binds stable actor ID, operation, target, canonical intention and idempotency key. Reject a stale PATCH base version before mutation. Existing unconsumed legacy feedback confirmations must be renewed after this change; do not reinterpret them. No token/key stored in editable note metadata or returned receipt.

Preserve the existing group-participant-only restriction for issuance, mutations and retries; a stable user mapping alone does not widen transport permissions. Use one client selector (ID or nonempty name), never silently resolve contradictory selectors. Canonicalize equivalent nested/root business values before checking agreement; require a valid timezone-bearing ISO version.

## Persistence and transaction

061 creates feedback_operation_receipts: id BIGSERIAL; actor_user_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT; operation constrained crear_feedback/editar_feedback; idempotency_key bounded 1..200; payload_hash lowercase SHA256; note_id BIGINT positive without note FK; note_updated_at TIMESTAMPTZ; committed_at TIMESTAMPTZ; unique(actor_user_id,operation,idempotency_key). No content snapshots, backfill, expiry, automated deletion or legacy key promotion. Immutable after insertion via application; retention review remains a rollout gate.

061 also installs a BEFORE UPDATE note trigger: updated_at is the greater of current clock time truncated to milliseconds and old updated_at truncated to milliseconds plus one millisecond. Existing rows are untouched. This makes the existing ISO timestamp compare-and-swap token strictly advance across all future writers, including rapid updates, archive and restore; SQL compares at that same millisecond precision.

Transaction order: lock current verified actor/mapping for scope revalidation, transaction advisory lock(actor ID,operation,key), lookup receipt; same hash replays, changed hash409. Revalidate active role/mapping before returning stored result. No receipt: lock note for PATCH, check exact version, validate business intent against live catalog, check duplicates, consume exact token, mutate note, audit and insert receipt in same transaction. For create enqueue private feedback notification rows using the transaction client before commit (no external delivery). Rollback must restore note/receipt/audit/token/outbox together; replay does not enqueue again. The original browser gap was outside that Wilson change; cut256 adds the bounded browser atomicity contract above, not global delivery guarantees.

Token consumption first locks the exact scoped confirmation row without an expiry predicate, then conditionally updates unused/expiry using clock_timestamp(). This is required because NOW() is fixed at transaction start and even an UPDATE predicate using wall clock can run before an unchanged token-row lock wait. A token expiring during either note or token lock wait must reject without consumption. Actor IDs with receipts remain restrictive references; admin permanent-user deletion reports 409 with guidance to deactivate, never silently deletes the receipt or deactivates an account instead of the requested operation.

## Replay response

HTTP200, idempotent:true, created:false (create) or updated:false (edit), feedback_id, receipt:{operation,note_id,note_updated_at,committed_at}. No saved business content in receipt. If live nonarchived note exists, feedback is its current shared DTO and result_current:true, not a false original snapshot. Archived/purged note: feedback:null plus archived:true or deleted:true; never recreate or expose archived content in retry. Receipt lookup precedes target existence/catalog/version checks for exact retries. Authorization still precedes replay. Different actors/operations have separate scopes; key reuse with different target or patch conflicts within an operation.

## Ownership and acceptance

Main: server.js/browser normalizer and shared docs/harness. Archimedes: Wilson feedback handlers + feedback-receipts helper/pure tests. Arendt:061+schema tests. Herschel: browser payload allowlist compatibility/tests. Wegener: independent real HTTP/SQL suite (port55604) and QA doc. Confucius/Darwin: independent read-only contract/implementation review. No simultaneous server.js/App.jsx edits.

Acceptance: browser reserved rejection/preservation including legacy metadata; no JSON replay; exact create/edit retries, actor/key/hash isolation, concurrent one winner, stale version, malformed/oversized keys, alias contradictions, current role/mapping loss, rollback and retry with same token, edit/archive/purge survival, exactly one audit/notification enqueue, additive populated history invariance. New guarded fixtures only; no existing database, ordinary server, external transport or deployment.
