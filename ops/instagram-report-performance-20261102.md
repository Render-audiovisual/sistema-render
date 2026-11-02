# Instagram report performance — 2026-11-02

## 1. Objective

Reduce the wait when opening a client report and returning to the client list, without weakening authentication or changing operational records.

## 2. Evidence and assumptions

One authenticated production-browser reload of the October EOS report recorded approximately 1,425 ms for `/api/sesion` and 2,667 ms for its report request. This is a single observed baseline, not a percentile or an after-change benchmark. Cached JavaScript was not the dominant wait in this sample.

A proposed direct server invocation using a database-selected administrator was rejected by the safety control and **was not executed**. Baseline measurements were instead collected through the existing authenticated browser session, without exporting credentials.

## 3. Implementation

- Ordinary internal report/back links now use the existing application navigation protocol. Modified clicks, downloads, external destinations and new-tab behavior remain native.
- Canceled navigation cannot fall through to a document reload.
- A client report batches independent reads into one PostgreSQL query and scopes client, account and media inputs to its requested client/group. It no longer calculates team assignments, alert baselines or all other clients' media.
- Four data reads, authorization and transaction boundaries total seven queries instead of sixteen for an ordinary non-delegated report.
- Existing quota rules and public report allowlists remain shared. No operational response cache was introduced.

## 4. Risks and boundaries

The browser must still verify a session on an actual full reload. The report still reads fresh data from PostgreSQL. No production code, database schema, records, automation settings or permissions were changed by this work. Automatic Instagram synchronization is a separate unresolved concern; this performance patch does not claim to repair it.

## 5. Quality criteria

Preserve authorized read-only snapshots, session fencing, client isolation, original captions, cover expiry, monthly counts, owner-confirmed attribution and shared-feed quota semantics. Preserve keyboard/link and browser-history behavior.

## 6. Validation

- 70 focused frontend/backend/navigation tests passed.
- Seven real PostgreSQL integration tests passed in a freshly generated local fixture; the initial restricted invocation could not create shared memory, and the approved local-only invocation succeeded.
- Integration compares optimized report totals, quotas and followers with the unchanged full-panel reader, including shared accounts and month-end follower boundaries.
- Production frontend build passed (277 modules).
- `git diff --check` passed.

## 7. Handoff

Implemented and tested locally on `codex/instagram-report-speed-20261102`. Not deployed. Publishing and an authenticated production before/after measurement remain necessary before claiming an actual hosted latency improvement. No migrations are required.
