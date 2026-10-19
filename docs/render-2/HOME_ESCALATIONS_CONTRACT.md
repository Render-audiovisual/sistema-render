# Direction escalation triage

The active legacy leader dashboard counted unfinished tasks whose historical `escalada_a` string was exactly `Líder`, `Agustín` or `Franco`. This differs from `en_revision`; pending, blocked, in-progress and approved escalations must not disappear into a review-only query. Historical labels select records, never user identity or authority.

## Principal contract

GET `/api/inicio/escalaciones?offset=0&limit=20` is a read-only administrative queue. Current active DB user, session version and current `admin` role are checked inside the read-only repeatable-read transaction. Claimed token role, display name and query cannot grant access. Employees receive no queue or global counts.

Only offset (0..1000000) and limit (1..50, default20) are accepted, canonical decimal strings. Extra keys, duplicates/arrays, signs and malformed values reject. No identity/name/scope/client filters.

Response: `{version:1,offset,limit,total,has_more,items}`. Each item explicitly projects ID, title (`titulo`), state, priority, revision, due date, minimal client and canonical task link. No raw metadata, escalation reason, feedback, financial objects, credentials or assignments are copied. No writes, approval permission or automatic state change occurs.

Selection: render_os, nonfinal/nonhistorically-final (`finalizada`/`publicada` excluded), exact string target from the legacy list, not archived/trashed and no inactive client. Last visibility exclusions deliberately follow principal operation policy and differ from the historical helper; do not certify exact historical-count equality. Legacy boolean approval gets the same read-only state projection as the personal home.

Ordering is due date ascending (undated last), priority alta/media/other, ID. Total is unbounded by page limit; has_more uses total and observed page. A newer page is a new read snapshot, not a frozen cross-request export.

UI: separate "Escaladas a dirección" section in principal home, current positive-ID admin only, actual paged endpoint with refresh/error/empty states and canonical links. Identity changes invalidate previous data and requests. Frontend visibility never replaces server authorization.

## Release gates

Independent pure and physical PostgreSQL HTTP tests must establish current-DB-role authority, revocation, no identity by name, pending/review overlap, exclusions, deterministic multi-page coverage and closed financial-safe DTO. Browser desktop/mobile, reload and real links are separate evidence. Preserve old dashboards until remaining operational/global/editorial equivalence and B1/B3 runtime gates pass. No production deployment is authorized.
