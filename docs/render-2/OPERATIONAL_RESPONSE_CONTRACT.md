# Operational API response contract

Local implementation only; no deployment or historical data rewrite.

`backend/src/operational-dto.js` is a serialization boundary, **not authorization**. Every caller must still authenticate and authorize the resource/action before serializing. A verified principal `admin` role retains the original resource for compatibility with authorized management. Every other/missing/unknown role receives an explicit operational field schema. Wilson derives this role from its database-bound human identity; a system transport, display name or leader flag cannot grant financial passthrough.

| Resource | Shared function | Principal response boundaries |
| --- | --- | --- |
| Task | `taskOperationalDto` | list/detail/subtasks, linked-piece tasks, create/PATCH, approval, recording/correction/confirmation, recommendations |
| Editorial piece | `editorialOperationalDto` | histories/publications/pieces lists, piece detail and applicable writes |
| Client | `clientOperationalDto` | client list; operational quotas/schedule/configuration flags remain, private subscriptions do not |
| Wilson task context | same task DTO via integration wrappers | task reads, matches, review previews, duplicates, writes/retries, confirmation task results, web-chat task/priorities context |

Unknown top-level or nested structured fields are omitted by default. Nested collections have dedicated schemas: scripts/scenes, recording records and audit/allocation fields, Drive attachments, operational markers and comments. Objects cannot masquerade as permitted scalar values. Only own data properties are read; accessors/inherited roles cannot opt into passthrough. Non-finite numbers/invalid dates are rejected. Input objects are not mutated and unknown private properties remain stored in PostgreSQL; filtered client responses must not erase them during a merge PATCH.

All valid collection items retain their stored order, without silent DTO truncation. Outer endpoint pagination remains its own contract. When a known SQL JSON-text alias has its raw metadata source available, the source type is validated as well. Ordinary user-authored strings are not censored merely because they contain a financial term or JSON-looking text.

Compatibility evidence includes positive nonempty IDs/revisions, canonical work states, copy/guiones, scenes, production records/allocations and file links; there is no blanket removal of operational metadata. Admin financial controls verify that privacy success is not caused by deleting fixture data or returning empty lists.

## Explicit limits

This does not classify/redact financial information deliberately typed into briefs/comments/free text or contained in Drive files. It does not certify every resource/router: feedback object authorization, notification queue schemas, personal-list/chat-message metadata, publication-dispatch payloads and other independent resources need their own reviewed contracts. SQL write validation, fine-grained capability policy and real account/Drive permissions are separate gates. Do not claim all API financial privacy, deployment readiness or Phase 1 completion from this bounded work.

For reproducible synthetic PostgreSQL/HTTP evidence and cleanup, see `OPERATIONAL_PRIVACY_QA.md`. The signed Wilson wrappers have focused in-memory route tests plus prior signed-identity regression; this block does not claim synthetic financial injection through every external signed route.
