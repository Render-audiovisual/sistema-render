# Personal monthly work and named dashboard replacement

Source: additive `monthly_progress` in existing GET `/api/inicio`, computed inside the current read-only identity-verified snapshot. No new database, migrations, backfill or local business store.

## Meaning

- Current ID assignment: owner or collaborator through EXISTS, each task once. This is not historical authorship or an individual production/video counter. Reassignment can change the summary.
- Same visible render_os tasks as personal home: no archived/trash or inactive-client work. Even admin receives their own assigned work, not global operation.
- Month is the current Córdoba calendar month. Attribution uses task due date; only when absent, last update converted to Córdoba date. Editing an undated historical task may move it between months. This is a schedule/update attribution, not an asserted delivery/completion date or monthly objective quota. Reports may separately prioritize recorded finalization dates; their explanation remains explicit.
- Completed means work state finalizada or historical task alias publicada. Approved work is not completed. No piece is marked published or counted as a published deliverable from this metric.
- Sectors retain all six real types: diseno, edicion, produccion, community, administracion, desarrollo. Only NULL becomes sin_sector. No role/name inference.
- Closed aggregate `{period,total,completed,by_sector:[{sector,total,completed}]}` with deterministic sector order. No text metadata, people bags, financial data or inferred publications. Totals include all rows, not just bounded home cards. Frontend validates sums/counts and projects only this contract.

## Replacement policy and gate

Old Augusto/Luciano homes expose next work, monthly counters and generic assigned-task controls. Principal personal home/task board/material context and guarded task workflows are candidate replacements, with this monthly aggregate filling the remaining counter gap. Old "Videos editados"/"Diseños entregados" labels counted tasks, not physical artifacts; do not reproduce that incorrect claim.

Named route aliases, if approved after tests, resolve only to the authenticated identity or one valid task context. They never resolve a person's name to an ID or transfer named filters. Admin inspection of another person uses explicit ID rows in Reportes > Trabajo por persona (ID shown and used by data helpers), not a legacy nominal home. Board name filters alone do not establish homonym equivalence or authority.

No route retirement is approved by this document alone. Require HTTP current-ID/homonym/collaboration/date/visibility/state tests, actual UI and unchanged task/detail flows, independent review and explicit recorded gate decision. Preserve old source until replacement is verified. Germán, Oriana and Líder remain separate, unresolved replacement gates.

Integration 34 records the bounded gate decision: those tests/runtime checks and independent review passed for Augusto/Luciano only; their App imports/mounts are removed and references remain. Broader consolidation, all-browser matrices and production release remain unapproved.

## Additive production client breakdown (integration46)

`monthly_progress.production` is `{total,completed,client_count,clients:[{client:null|{id,nombre},total,completed}]}`. It filters the same current-ID `monthly_work` to literal sector `produccion`; being an administrator does not make this a global summary. Shared assignments count a task once. Dates, visibility and historical completion aliases retain the rules above. No normalized visit/video or editorial publication is inferred from a task.

Groups use client ID, not display name; null is its own group. The actual physical schema enforces unique client names, so hypothetical identical display-name handling is parser coverage, not a physical-database homonymous-client claim. Homonymous user accounts remain an actual ID isolation test.

Full totals and actual `client_count` include all groups. `clients` contains the first20 ordered total descending, client ID ascending NULLS LAST. The frontend validates positive row counts, unique IDs, deterministic ordering, sector reconciliation and full/partial sum consistency, and drops undocumented nested fields. Old responses without this additive field remain accepted; malformed supplied fields fail closed. Native disclosure keeps the current light shared design compact, labels this as tasks, and states the visible/full group count if truncated. No additional browser persistence or business writes.

**Not a Germán retirement approval:** the old per-client table had no20-group limit. A complete paginated client breakdown/navigation is still needed before replacing that capability. Source preservation and route retention continue until that gap, production subset/workflow equivalence and independent full cutover gates pass. This is a verified shared-data building block, not a narrower definition of the final requested system.

## Full client pagination (integration47)

The20-group access gap above is now resolved by `GET /api/inicio/produccion-mensual?period=YYYY-MM&offset=0&limit=20`. Period is required (real month, years0001–9999); only period/offset/limit are accepted, offset0–1000000, limit1–50. User identity/role/name cannot be selected by query. Same shared SQL fragments as home supply assignment visibility, month attribution and production grouping; each call verifies current DB role/activity/session within a repeatable-read readonly transaction, with no-store response.

Closed response: `{version:1,user:{id},period,today,offset,limit,total,completed,client_count,has_more,clients:[{client:null|{id,nombre},total,completed}]}`. Count totals cover the requested period, not only its page. Null client participates in ordering normally. Historical task completion remains independent of piece publication. Every request has its own snapshot: edits between pages can change membership/order; no stable multi-request snapshot/export is claimed. Explicit period prevents a month rollover from silently changing the requested dataset.

Shared `HomeProductionMonthly` initially uses the already verified home page with no extra request. Anterior/Siguiente fetch20-row pages; each response checks ID/period/offset/limit, ordering/count consistency and closed projection. Late, superseded, disposed or changed-session responses cannot repaint. Loading/error clears old rows; retry preserves requested offset and Primera página recovers if membership shrank. Parent refresh, session or period change resets the local page. Page is not persisted or represented in URL yet; reload returns page1 and can traverse again. UI remains a compact native disclosure using existing shared styles and44px buttons. No business localStorage.

Actual PostgreSQL and desktop/mobile evidence is in STATUS integration47. This closes pagination only, NOT final Germán retirement: production subset/workflow, source material/coordinated timing, reviews and complete cutover tests remain required. No migration, configured DB or deployment.
