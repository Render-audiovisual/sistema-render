# Stable-ID task responsible filters

Principal URL state uses `responsible=all` or `responsible=id:123`. Requests use `asignado_a_id=123`, never a name. User IDs are canonical positive decimal integers within PostgreSQL integer range 1..2147483647. Malformed/duplicate ID filters reject; the frontend service refuses unresolved selection instead of sending an unfiltered request.

Membership is existing owner/collaborator ID binding. Local filtering uses DTO `asignado_a_id`/`colaborador_ids`, never `asignado_a` or historical collaborator labels. Options show current catalog labels/login/ID, preserve missing-catalog IDs explicitly, and never invent accounts from task names. Shared read access remains existing policy; filtering grants no write or financial permission.

## Existing links

- Valid ID tokens survive missing/renamed/inactive catalog entries; no silent reset to all.
- Old nominal values wait for catalog success. Admin sees the complete users catalog and can recover only an exact unique ID across name/login matches, deduplicated by ID. Multiple/no matches stay blocked with a choose-again notice.
- Employee catalog excludes inactive users, so it cannot establish global uniqueness. It never automatically migrates old names, even apparently unique ones; explicit selection is required once. The selected ID then persists in URL/reload normally.
- Duplicate responsible URL parameters become a blocked invalid selection. No first-value guessing, fuzzy name normalization, name-based identity or database backfill.

## Navigation and concurrency

Popstate synchronizes all parent filters and child view/month, preserving canonical task context. A blocked list remains empty but retains/fetches its explicit task detail separately; it must not discard an open editor. Direct-only context does not count as a filtered card/page row.

List generations invalidate stale load-more rows/totals/errors/loading cleanup after filter changes. Both success and failure of direct-task fetch check effect activity, generation and current URL task before merging or mutating URL. This is not an atomic DB snapshot: list selection and assignment annotation remain separate reads and can briefly disagree during reassignment.

## Verification and remaining scope

Pure/model/source tests plus opted physical PostgreSQL HTTP fixture cover homonyms, collaborators, exact pagination/totals, rename stability, missing IDs, privacy and unchanged write ACL. Browser role/reload/history/ambiguous-detail evidence is recorded in STATUS; source guards are not a latency-injected live React test.

Backend legacy name filters remain supported for preserved reference callers. Unknown-query rejection remains separate work. Integration36 replaces the permissive unbounded limit/offset behavior with strict bounded pages and adapts full-array readers; see TASK_PAGINATION_CONTRACT.md. No production deployment, auth changes, schema migrations or real records are authorized here.
