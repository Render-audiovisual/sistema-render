# Explicit monthly quota reconciliation

Integration100, local development. Source configuration and a prepared monthly objective are different records: editing a client agreement must not silently reinterpret already prepared work. This feature makes the difference visible and provides an explicit administrative review, reusing the existing generator rather than creating a parallel task system.

## Reads and review

GET `/api/cliente-objetivos?periodo=YYYY-MM` retains all existing objectives/pieces. Each client additionally exposes `cuota_actual:{reels,carruseles}|null`, `cuota_desactualizada:boolean`, `cuota_revision:string|null`; each piece exposes `en_cuota:boolean`. The opaque revision is64 lowercase hex characters. No amount, salary, income, expense or raw client record is part of this projection.

The read uses one repeatable-read read-only observation when called with a pool. Revision inputs include effective operational source quotas, stable account IDs, monotonic agreement versions, prepared objective and piece/task observations. A current configuration missing or with different account membership cannot be automatically mapped onto the old objective. Shared-feed quota remains one quota, not multiplied by account count.

POST `/api/cliente-objetivos/reconciliar` is administration-only, including a current DB actor/role/active/session-version check inside its transaction. Body uses the existing prepare contract (`periodo`, `clave`, `responsables`, `responsables_por_formato`, optional `responsables_por_cuenta`) plus the exact observed `expected_quota_revision`. It never accepts a client-supplied replacement quota. The server rereads the effective configuration and compares the full observation after relevant locks. Changed source, task, piece or membership produces a conflict, not an automatic rebase.

Normal `/preparar` and the monthly scheduler do not apply quota drift. They report the need for administrative review. Review reuses the generator in the same transaction: update prepared quota, append audit, then create/reuse only genuinely missing slots/tasks. Failure rolls back the entire operation. A duplicate stale confirmation must not apply a newer agreement; explicit fresh review is required. This is not a durable lost-response receipt API.

## Reductions and reversibility

Quota membership is derived from stored piece type/number against the accepted objective quota, never from array index or work state. A reduction leaves every piece ID, task, publication, copy, assignment and history intact. Pieces beyond the accepted quota are additional content: visible and operable, but excluded from the quota numerator and denominator. Increasing again reuses those same slots without resetting their state or creating duplicate work.

Additional pieces remain exclusive: their existing task/publication cannot become an unclaimed candidate for a second quota. Existing editorial associations and their corrections/approvals continue to operate. New goal/production-editorial selections exclude additional slots and the write path rechecks membership, so a stale candidate cannot bypass a reduction. Completed work is not evidence of real publication; no publication state/date is modified by reconciliation.

## Coordination and storage

Reconciliation lock order: current reviewer SHARE, client-administration advisory domain, global objective-link advisory, period/key advisory, objective, existing tasks ascending, existing pieces ascending. This shares the established client writer and task/link domains. No provider call occurs while locks are held.

Migration077 is additive audit only: `cliente_objetivo_cuota_revisiones` records objective ID, stable actor ID, before/after operational quotas, opaque source fingerprint and commit time. No task/objective historical backfill and no deletion. The guarded fixture can defer077 explicitly or when testing the older pre-goal schema. Production migration/deployment is not authorized by local test success.

## Verification gates

Required evidence: unchanged populated rows on migration; prepare2→edit3→review→accept creates only one missing slot; reduce1 preserves work but excludes extras from quota and new-link candidates; expand3 reuses IDs; unauthorized employee/community denied; current role/revocation and stale observations denied; concurrent confirmations have no duplicate slots/audit; failed audit/generation rolls back; another identity/refetch sees the same shared data. UI must preserve choices on failure, block ambiguous resubmission until fresh review and keep additional content accessible. Exact results belong in STATUS only after execution. Native device acceptance and production rollout remain separate gates.

Executed100: full backend1561pass/80opt-in skips, full frontend1262pass/1optional skip,36 opted-in fresh PostgreSQL/HTTP cases including existing goal/editorial regressions, Vite build. The populated077 upgrade fixture proves no historical rewrite; a real task-lock wait observed through `pg_blocking_pids` followed by committed content change produces409 without applying quota/audit. Native final-build owner review2→3 on desktop and3→1 at390px, reload, additional-piece detail access and synthetic audit were observed. Changes of source quota for that native-only fixture were controlled SQL setup, not claimed client-edit UI coverage. See STATUS100 for exact logs, fixture adjustments and remaining scope limits.
