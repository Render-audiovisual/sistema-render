# Bounded task collection and preserved full-array readers

GET `/api/tareas` always paginates: default limit100/offset0, limit1..500, offset0..1000000. Explicit values must be canonical decimal strings; malformed, repeated, zero/negative limits, excessive values and coercion inputs return400. The principal builder validates numeric options with default50. No schema migration or authentication policy change.

Existing name/ID/workspace/access/archive/search/client/sector/priority filters remain unchanged. Every SELECT binds LIMIT/OFFSET. When an offset beyond the last row produces no window-count row, a separate COUNT over the exact pre-pagination query and parameters supplies X-Total-Count instead of inventing zero. These are separate read snapshots, not atomic page/export evidence under mutation.

## Preserved full-array consumers

German, current/historical Lider, TareasAsignadasGenericas and preserved reference TareasTablero/Augusto/Luciano now call shared `fetchAllTaskPages` before aggregating. It preserves filters, uses sequential pages of500, validates total headers, exact page sizes and globally unique positive IDs, rejects changing totals/failures/abort and returns only the entire validated array. Maximum100000 rows is explicit: exceeding it throws instead of silently truncating.

These callers remain legacy source/reference implementations; this adapter does not authorize their continued duplication as the final architecture. It prevents regressions during the staged retirement. Principal task board remains page-based and Feedback suggestions remain deliberately capped at100, not a claimed exhaustive task inventory. Wilson task CLI uses its separate integration route contract and is unchanged.

Equal totals and unique IDs do not establish an immutable snapshot: edits that change ordering between pages can still change the observed set. No versioned export, historical snapshot, keyset pagination or current-identity refresh is claimed. Existing legacy component request-lifecycle limitations remain separate gates.

## Verification

Pure parser/builder/helper tests; source coverage of six consumers/seven reads; opted-in fresh physical PostgreSQL test with625 rows, exact default/max/filtered pages, beyond-end counts, DTO privacy, current ACL and actual full-array adapter across500+125 rows. Role/financial protections remain independently enforced by backend. Browser live-legacy counts and principal load-more require their own recorded evidence. No production DB or deployment.

## Integration98: shared manual presentation order

The preceding default/date and legacy-reader limitations remain unchanged. Canonical active Render OS tasks additionally support `sort=manual&workspace=render_os`. URL state retains the sort. Migration076 adds a singleton presentation vector and actor/request-scoped durable receipts; it does not rewrite tasks or historical order. Newly eligible tasks append by the existing due-date/id fallback. Children participate. Archived/trash tasks cannot be moved.

Manual GET pages use a single REPEATABLE READ READ ONLY transaction for current actor, order, filtered collection signature, page and assignment projection. Headers are `X-Total-Count`, `X-Task-Order-Revision` (positive canonical BIGINT string) and `X-Task-Order-Snapshot` (opaque lowercase SHA256). Continuations require the original `expected_snapshot`; changed collection/order/assignment observations return409, never a silently mixed page. The SQL expands the stored vector once with ordinality before pagination. This is observation consistency, not a historical export or a revocation lock held after the request.

POST `/api/tareas/orden` accepts only `request_id`, `task_id`, `expected_revision`, `before_id`, `expected_before_revision`, `expected_order_revision`. IDs/revisions are validated; nullable anchor means explicit column end. The order revision is a string to preserve BIGINT precision. Current actor, global order and task locks serialize authorization and compare-and-swap. The moved task requires current write scope; an anchor requires current read scope and the same canonical state column. Unknown/inaccessible tasks return404; stale versions or cross-column anchors return409.

Only one task is spliced; other relative ordering is retained globally, not normalized against a particular employee's filtered list. No task revision, state, history, approval, quota or publication field is changed. Effective no-ops record a receipt without rewriting the vector or incrementing its revision. Actual moves normalize against all eligible IDs; more than100000 eligible rows fails413 without truncation or receipt. The read API remains paginated rather than silently dropping additional rows.

ACK contains only `task_id`, `before_id`, `order_revision`, `replayed`, `changed`. Explicit verification repeats the identical captured body/UUID/session after an uncertain response. Replay rechecks current authority, returns the original proof and never restores old ordering. The frontend validates exact revision increment/no-op and reloads the first page after confirmation; it does not apply an old receipt as the current list. No automatic conflict rebase/retry and no localStorage operational order.

UI provides date/manual selection, same-column drop anchors, accessible up/down controls and explicit “Al final”. Partial loaded boundaries are not treated as global column end. Cross-column moves retain the existing business-state workflow. Desktop/mobile native interaction and drag geometry remain separate verification gates; source callback tests are not native browser certification.

Verification98:32 backend unit cases;15 new frontend model/API/callback cases;13 fresh PostgreSQL/HTTP cases across normal and pre076 upgrade fixtures. Physical cases include concurrent CAS, replay after later reorder, distinct-user shared reads, pagination invalidation, membership revocation, preserved business rows, >JS-safe BIGINT and explicit100001-row overflow. Production migration/deployment not performed.

Verification99 adds actual native desktop arrow/mobile end actions, reload persistence, independent owner read, native date/manual selection and390/1280px layout measurement. The compact order toolbar is44px high with a closed optional help disclosure. Same-column native drag did not produce an observable reorder in two automation gestures and remains unverified; do not conflate the passing callback tests with native drag acceptance. See STATUS integration99 for exact fixture sequence and cleanup evidence.
