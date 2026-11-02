# Instagram report latency

## 1. Objective

Reduce report opening time on desktop and mobile without operational data writes, weaker authorization, stale shared caches or changes to automatic Instagram synchronization.

## 2. Assumptions

The connected system remains authoritative. Static JavaScript may load before authentication finishes; report data still requires the existing verified session. Missing accounts or Meta values are not fabricated.

## 3. Plan

Reuse current-period media and account-bound cover evidence from the same authorized repeatable-read snapshot. Batch covers into the report input read. Warm only the static report module on Instagram routes while retaining lazy routing and retry after a failed preload.

## 4. Risks and limits

Preserve account/client/month binding, trusted proof membership, current effective quotas, cover expiry, public response allowlists, historical records, revocation and owner-profile validation. Do not change client-goal business rules, session bootstrap, database schema or automation settings. Preloading stores code, never report data or sessions.

## 5. Acceptance

Reports use five database calls instead of seven, retaining BEGIN/authorization/COMMIT and two data reads. Report outputs match existing reference behavior for individual and grouped clients. Static preload neither fetches an API nor permits unauthorized rendering. Compare real production timings on the same three client/month routes before/after release.

## 6. Execution

58 focused tests passed, eight fresh PostgreSQL integration tests passed, and the actual HTTP team-access integration passed. Production frontend build passed with 278 modules. Local temporary databases were created solely for these tests; no production migrations were run.

## 7. Review

Before release, mobile 375px browser network measurements for Bendita/Lavalle/Moketa showed report responses 1187/1203/1192ms and document-to-report-data 2479/2318/2211ms. These are real browser network event measurements on the available connection, not a simulation of cellular latency. Record post-release observations separately; do not claim a gain until measured.
