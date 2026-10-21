# Manual team-payment ledger — integration111

## Boundary

One canonical Express/PostgreSQL module, mounted at `/api/finanzas/pagos`. It records an administrator's explicit statement of a payment already made; it neither sends money nor independently verifies a bank transfer. Currency initially ARS. Do not infer an amount, recipient or paid state from a calculated salary, name, completed task, legacy override or commercial agreement.

The projection endpoint `/api/sueldos` keeps its existing formulas and six-field DTO. Recorded movements remain visibly separate. Actual payment date determines ledger month; work month is an independent field. Several partial payments to one person/month are valid.

## API contract

All endpoints require authenticated current administrator authority. No-store responses. Stable user IDs, not the local leader selector, identify recipients/actors.

- `GET /contexto`, no query: `{version:1,recipients:[{id,nombre,usuario,rol}]}`. Active real accounts only; includes owners, without salary/private account credentials.
- `GET /?periodo=YYYY-MM`: exact single closed query, any real calendar month with nonzero four-digit year. Unlike the legacy salary projection, the ledger must also make explicitly entered older payment dates reachable. `{version:1,periodo,items,total_recorded_ars}`. Cohort is actual payment month; newest date/ID first. Includes voided records for history but excludes them from the exact decimal-string sum. No silent truncation.
- `POST /`: closed required fields `operation_key` (lowercase UUIDv4), `recipient_id` (positive int32), `fecha_pago` (actual nonfuture calendar date), `periodo_trabajo` (YYYY-MM), `moneda:'ARS'`, `importe` (positive canonical decimal string, NUMERIC14,2), `referencia` (3–500 trimmed characters), `drive_url` (null or safe HTTPS drive.google.com link) and `attestation:true`.
- `POST /:id/anular`: closed required fields `operation_key`, `expected_revision`, `reason` (3–500 characters), `attestation:true`. This voids the **record**, not the bank transfer. Original amount/date/recipient/reference remain intact; a replacement is a separate manual operation. No destructive DELETE or overwrite PATCH.
- Mutation result `{version:1,payment,replayed:boolean}`. Create201, replay200, void200. An exact retry returns the current record, which may already be voided; do not present an old successful create as currently active.

`payment` fields:

`id`, `recipient_id`, `recipient_name`, `recorded_by_id`, `recorded_by_name`, `fecha_pago` (YYYY-MM-DD), `periodo_trabajo` (YYYY-MM), `moneda`, `importe` (fixed-two-decimal string), `referencia`, `drive_url`, `provenance:'manual'`, `status` (recorded/voided), `revision` (pay1:ID:VERSION), `created_at` (ISO), `voided_at` (ISO/null), `voided_by_id` (ID/null), `void_reason` (string/null).

Names are actual database account snapshots for historical readability, never authorization. Original financial facts are immutable. Missing revision428, malformed input400, stale/cross-record revision409, incompatible reused key409. Idempotency scope is actor ID plus operation key; the normalized hash binds operation, target and exact intent. A revoked actor cannot replay an old receipt.

## Persistence and authority

Migration081 only creates the new empty `team_payments`, `team_payment_events` and `team_payment_receipts` tables, restrictive user/history FKs, indexes and an original-history guard. It performs no legacy backfill. Every create/void, audit event and receipt belongs to one transaction. Rollback failure discards the connection. Duplicate recovery performs no new business/audit/receipt DML.

Write ordering: capture ID/session epoch before lease → BEGIN → existing account-administration mutex20261019,1 → current active administrator SHARE → recipient SHARE or payment UPDATE → write/audit/receipt/verified readback → COMMIT. This order matches account changes instead of holding an actor while waiting for their mutex. Read context/list use the existing current-admin RR READ ONLY snapshot helper; read authority is observed at its initial account read.

The history trigger permits only recorded→voided with version+1 and intact original fields, and rejects payment DELETE. Receipt/event references prevent orphaning. No real file is uploaded by a link field; a manually supplied Drive link is not payment-provider evidence.

## Interface and recovery

The canonical Finance page hosts the ledger, not a parallel preview. Blank explicit payment form; recipient comes from the restricted context endpoint. Always show manual provenance and distinct payment/work periods. The void action requests a reason and explicit acknowledgment.

Use identity/context-scoped requests and the shared dirty/busy navigation guard. Prevent simultaneous finance editors and period replacement while a draft or mutation is active. A lost/invalid acknowledgment must preserve the original operation key and captured request for an explicit same-intent retry; never silently create another record or claim an unverified success. Do not store business records in localStorage.

## Acceptance / release

Prove exact decimals, partial payments, independent owners, employee denial across reads/writes, current role/epoch after waits, one-record retry, incompatible key conflicts, concurrent void CAS, audit preservation, all-table no-DML GET, legacy preservation and reload through real PostgreSQL/HTTP. Controller/render tests do not replace native desktop/mobile verification. Migration/deployment against a configured or production database remains separately gated by identity, approved plan, backup/restore and authorization.

This document defines the contract; completion is established only by the corresponding recorded test results in STATUS.md.
