# Líder-only consolidation and deliberate counting corrections

The active first return of the preserved Lider dashboard contains reads/links, not unique mutations. Its unreachable second return is historical reference and not a live-feature retirement gate. Only Líder's App lazy import/mount are removed in this integration; source is preserved and Germán remains live.

## Surviving capabilities

- Global open/overdue work, including unassigned tasks: administrator HomeTeamWorkload with exact unpaginated totals and per-ID owner/collaborator pages; principal board remains available.
- Pending/in-progress/review/approved escalations: separate HomeEscalations queue, not an invented synonym for the review queue.
- Today, overdue, blocked and future-ready editorial content: shared paginated buckets, exact root content/clarifications, existing manual publication confirmation/withdrawal.
- Personal work/review, monthly work, projects and client context: current-session Inicio; team review stays separate from personal membership.
- Financial result, margin, billing, payroll and fixed expenses: existing authorized Finanzas/Sueldos for the same collection period and same `/api/sueldos` DTO. Payroll rows remain in the Equipo detail; the old standalone person-count caption is not a separate new KPI. Operational home endpoints do not gain private financial fields.
- Report detail: explicit current-ID rows, with existing role-based financial projection. No named-person identity is transplanted.

## Corrections deliberately retained

Completed work, archive/trash and inactive-client filtering follow current operational visibility, not legacy counts. Do not sum overlapping overdue/escalated/editorial buckets as unique attention items. The old hardcoded four-name team helper included finished tasks in cargaTotal and fell back to editorial responsible TEXT when it found no tasks. That fallback is abandoned: textual names are not assignment IDs or evidence of an employee's workload.

The current task CHECK (058) admits pending/in-progress/review/approved/finalized and preserved scheduled/published aliases, not bloqueada. Migration006 converted that former state to review while preserving historical metadata. Do not invent a task-blocked counter or resurrect that state from metadata. Editorial blocking remains visible through the global blocked bucket and exact aclaraciones; attributing editorial blockers per person requires explicit valid relationships, not name matching. This is a deliberate semantics correction, not literal legacy numerical parity.

## Financial boundary and proof scope

Both old and surviving finance views use collection period P and the same existing backend calculation, billing work P−1. Actual contracts are contratos_financieros; cliente_abonos alone does not prove those metrics. Existing migration-seeded fixture rows mean totals are not assumed zero. Compare rendered metrics to that fixture's real endpoint snapshot, not invented arithmetic or external exchange quotes. Local harness blocks external fetch; fallback=true/source=backup is asserted. This is no claim that historical payroll keys, contract activation semantics or the full financial business model have completed their final audit.

`/lider` now aliases to the current authenticated Inicio or a single valid explicit task context. Nominal user/role/assignee/client parameters are discarded; the alias grants no administration. Admin-only financial API denial and UI access gates remain in force. Keep arbitrary history state and clean Back/Forward/reload behavior. Source/actual HTTP/browser evidence is recorded in STATUS. No production deployment or permission change is implied.
