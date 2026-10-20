# Shared editorial control — connected read contract

Purpose: replace the live legacy combined story/publication attention summaries without treating completed work as real publication. The new service is part of the existing authenticated Express application and the same PostgreSQL source. It introduces no separate operational app, browser storage, migration or write route.

## Access and selection

GET `/api/editorial-control` is team-wide operational reading for current active SYSTEM_USER_ROLES, consistent with the existing shared editorial/calendar access. It does not grant approval or publication writes. ID, active status, role and session version are checked against current database identity inside a repeatable-read read-only transaction, after principal authentication middleware. Unknown roles and revoked/inactive accounts fail closed.

Stories and publications keep separate domain+integer-ID keys. Only records joined to a visible active/non-false client and not marked `metadata.archivado_tablero=true` (boolean or string) are included. No task assignment/name is interpreted as piece identity. Editorial records do not inherit task archive status as an invented filter.

Four exact buckets, using current Córdoba calendar date:

- `today`: scheduled date equals today, all states. A historical published row can appear but is not confirmation evidence.
- `overdue`: scheduled date before today and state neither publicada nor rechazada. Undated records are not guessed overdue.
- `blocked`: estado=bloqueada regardless of date, including undated and far-future records.
- `upcoming_ready`: estado=lista and scheduled date after today, without an arbitrary month or seven-day cutoff.

Buckets overlap. Summary counts must not be summed as unique exceptions. `lista` means ready in the existing editorial model, not confirmed externally published or a new inferred approval record. Historical publicada rows are preserved, not automatically reopened or relabeled as published today.

Schema limitation discovered during implementation: migration000 currently requires fecha_programada NOT NULL in both editorial tables; no subsequent relaxation was found. The blocked query deliberately adds no date predicate, and projection must tolerate a future nullable date, but this is **not** proof the current application can save an undated piece. Physical QA must not relax that constraint just to claim a pass. Nullable scheduling, its authoring controls and its effect on confirmation evidence require a separate reviewed transition before claiming end-to-end undated-blocker support.

The legacy overdue rule also excludes rechazada, but current editorial CHECK constraints do not admit that state. The exclusion is retained as a defensive read rule, not a claim that a rejected-state authoring transition exists. Tests must preserve that constraint too.

## Page and projection

Closed query: bucket defaults to today; offset defaults0, canonical scalar decimal0..1000000; limit defaults20, canonical scalar decimal1..50. Unknown/duplicate/malformed query keys fail400. Deterministic order: scheduled date ASC NULLS LAST, domain ASC, ID ASC. Global summary and selected-bucket total are computed from the same snapshot, independently of page offset; beyond-end returns empty items and intact totals. Pages across requests are not an immutable snapshot.

DTO: version1, today, bucket, offset, limit, total, has_more, summary:{today,overdue,blocked,upcoming_ready}, items:[{domain,id,titulo,estado,tipo,cliente:{id,nombre},fecha_programada,publication_classification}]. Titles use the established bounded editorial idea/copy projection. No arbitrary metadata, task bags, credentials, client fees, payroll or whole-row JSON is returned. Responses use no-store.

Evidence is annotated with the existing `annotateEditorialEvidence` helper inside that same transaction, only for paged records, before closing the DTO. Allowed classification: no_publicada, historica_sin_confirmacion, confirmada_manualmente. Forged metadata cannot become evidence. Confirmed classification requires the existing authoritative current-event checks; no new independent SQL approximation or new publication counter is introduced.

## Integration gate

Integration40 adds the connected HomeEditorialControl card after personal next-work/review sections in principal Inicio. Four button views,20-row pagination, refresh/error/empty states, closed parsing and captured-session/generation/abort guards are implemented. Client/month planning-context links are explicitly named as such; they do not promise selection of a specific piece. Bucket/page selection currently resets to today/0 on remount or reload; persistent per-user/URL context remains open. Source tests are not browser race simulations. Runtime scope and screenshots are in STATUS.

Integration41 adds exact-piece **publication-record access** using the existing EditorialPublicationControl, not a new mutation path. Minimal list identity/context maps to id/cliente_id/estado/fecha_programada; the compact classification never becomes a manufactured proof or timestamp. Shared control fetches authoritative domain/ID status and verifies client before any mutation. Its optional hideSummary/openLabel/onOpenChange props are presentation/lifecycle only; default consumers keep the existing summary/button. The dialog explicitly identifies domain, piece ID and client ID.

While a record is open, both the card and parent Inicio suspend manual/background refresh so a list reload cannot unmount the active publication draft. Existing session guards remain authoritative; successful saves deliberately reload the card from the backend. Employee reads and administrator confirmation/withdrawal use the same previously verified role/revision/request-id path. This does not add a full piece-content editor, shareable exact-piece URL, persisted view/page or unsaved-navigation protection for every route. Legacy retirement still requires those remaining workflow/equivalence gates.

This service is a prerequisite, not by itself the completed replacement UI. Principal controls must expose each bucket, pagination, loading/error/empty states, session-safe refresh, and navigable detail/context for dated **and undated** records. The existing module context links are not guaranteed to select a specific piece; do not claim deep-link completion without real navigation evidence. Keep Líder/Oriana mounted until the connected rendered replacement and existing publication controls are verified. Do not recreate Oriana's decorative checklist or inaccurate “waiting for approval” subtraction. No external publication or production deployment is authorized by this work.
