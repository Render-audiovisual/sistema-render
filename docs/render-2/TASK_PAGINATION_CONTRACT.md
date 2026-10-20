# Bounded task collection and preserved full-array readers

GET `/api/tareas` always paginates: default limit100/offset0, limit1..500, offset0..1000000. Explicit values must be canonical decimal strings; malformed, repeated, zero/negative limits, excessive values and coercion inputs return400. The principal builder validates numeric options with default50. No schema migration or authentication policy change.

Existing name/ID/workspace/access/archive/search/client/sector/priority filters remain unchanged. Every SELECT binds LIMIT/OFFSET. When an offset beyond the last row produces no window-count row, a separate COUNT over the exact pre-pagination query and parameters supplies X-Total-Count instead of inventing zero. These are separate read snapshots, not atomic page/export evidence under mutation.

## Preserved full-array consumers

German, current/historical Lider, TareasAsignadasGenericas and preserved reference TareasTablero/Augusto/Luciano now call shared `fetchAllTaskPages` before aggregating. It preserves filters, uses sequential pages of500, validates total headers, exact page sizes and globally unique positive IDs, rejects changing totals/failures/abort and returns only the entire validated array. Maximum100000 rows is explicit: exceeding it throws instead of silently truncating.

These callers remain legacy source/reference implementations; this adapter does not authorize their continued duplication as the final architecture. It prevents regressions during the staged retirement. Principal task board remains page-based and Feedback suggestions remain deliberately capped at100, not a claimed exhaustive task inventory. Wilson task CLI uses its separate integration route contract and is unchanged.

Equal totals and unique IDs do not establish an immutable snapshot: edits that change ordering between pages can still change the observed set. No versioned export, historical snapshot, keyset pagination or current-identity refresh is claimed. Existing legacy component request-lifecycle limitations remain separate gates.

## Verification

Pure parser/builder/helper tests; source coverage of six consumers/seven reads; opted-in fresh physical PostgreSQL test with625 rows, exact default/max/filtered pages, beyond-end counts, DTO privacy, current ACL and actual full-array adapter across500+125 rows. Role/financial protections remain independently enforced by backend. Browser live-legacy counts and principal load-more require their own recorded evidence. No production DB or deployment.
