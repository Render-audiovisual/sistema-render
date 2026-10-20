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
