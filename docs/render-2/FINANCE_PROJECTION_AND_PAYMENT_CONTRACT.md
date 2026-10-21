# Financial projections and actual payments

## Current connected behavior (integration110)

`GET /api/sueldos?periodo=YYYY-MM` is an administrator-only **projection**. Its existing salary, fixed expense and contract formulas remain unchanged. It is not a bank ledger, payroll settlement, invoice or payment receipt. Contract billing still uses its existing whole-peso proration rule; rendering two decimal places does not change that business rule.

- The only accepted query field is one exact `periodo`, from2026-09 inclusive. Repeated, object/array, unknown and malformed parameters are rejected rather than coerced.
- Capture immutable actor ID/session epoch before asynchronous provider/pool waits. Fetch the exchange rate before acquiring the database connection. Its fallback/provenance remains visible; an external quote is not part of the PostgreSQL snapshot.
- A single REPEATABLE READ READ ONLY transaction validates the current active administrator and epoch, then supplies **all** contract, expense, both payroll periods and history inputs from that connection. Callback results are returned only after commit. Failure rolls back; a failed rollback discards the connection.
- Authority is observed at the transaction's first account read. This is a point-in-time read authorization, not a claim that revocation committed after that boundary cancels an already-running response. No row lock, global mutex or business write is introduced by this GET.
- Response is no-store. Existing six-field DTO remains unchanged. The UI labels expected income, calculated salaries, planned expenses and projected result; it explicitly says that they do not prove money received or paid. It retains two display decimals and the separate contract editor/session guards.

## Historical payment gap at110

Integration111 introduces a separate manual ledger under the [team-payment contract](TEAM_PAYMENT_LEDGER_CONTRACT.md). The following describes the pre111 state and its design constraints, not a claim that the new ledger is missing. Actual implementation/acceptance evidence and remaining limits belong in STATUS.md.

Migration020 defines `empleado_pagos_mensuales` and `empleado_pagos_historial`. The former associates a legacy employee key/month with a final amount and a textual confirmer. `applyCompensations` can use such an amount as a payable override, but the canonical summary currently passes an empty final-payment collection. No current connected payment writer or independent employee-ID payment ledger was found in `backend/src`.

Neither a calculation nor an old row in this table proves an executed transfer. Do **not** backfill it as payment evidence, infer recipient identity from a name, set a paid flag from task completion, subtract projections as actual outflows, or relabel historical records as verified payments.

The next implementation must provide a separate, explicit authorized recording flow:

1. Stable recipient user ID, recording actor ID, actual payment date and exact decimal currency/amount. Payroll work month and transfer date remain different fields.
2. An explicit manual attestation/reference and optional safe evidence link; a Drive link alone is not independent bank verification. Store provenance as manual rather than claiming provider confirmation.
3. Immutable payment identity, duplicate-request protection, observed revision for corrections and non-destructive audited reversal/correction. A timeout must not silently send a second payment record.
4. Current server authority at mutation time, employee privacy across API/report DTOs, no frontend selector as authentication, and transactionally consistent audit/evidence rows.
5. Separate projections from recorded movements in finance totals and UI. Partial/multiple payments must not be collapsed into the existing one-row-per-key/month override.
6. Explicit treatment of unlinked historical names; no automatic account assignment or recalculation of past commercial facts.
7. New additive migration inspected and tested only on harness-owned PostgreSQL. No configured database startup, migration or production deployment is authorized by local test success.

Acceptance must exercise two independent synthetic owners, employee denials, exact cents, explicit evidence/provenance, lost ACK/idempotency, concurrent corrections, reload and read from another authorized session. Then perform native desktop/mobile verification of the real connected recording UI. These are remaining requirements, not test results claimed here.

## Evidence110

- `backend/test/finance-snapshot.test.js`: strict query/authority, immutable capture, same-connection transaction, denied callback, commit/read rollback and discarded uncertain connection.
- `backend/test/render2-finance-snapshot.integration.test.js`: actual PostgreSQL RR/read-only settings; a second physical connection commits contract/expense changes while the first keeps the original snapshot; subsequent HTTP sees new values. All-table snapshots prove GET/denials do not create payments or content. Pre-lease revocation uses a controlled pool gate and actual account changes, not a claim of a database row-lock race.
- `frontend/src/pages/sueldos-projection.test.js`: actual JSX static render with injected hook state verifies visible projection disclaimer, cents and escaped names. It is not mounted-browser or payment-write acceptance.

No new migration, dependency, configured account/provider write, real payment or deployment is performed by110.
