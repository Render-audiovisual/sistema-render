# Shared production reporting / task context HTTP QA

Status: **PASS**, executed against principal HTTP on 2026-10-19 after Arendt READY. Owned files only: `backend/test/render2-production-reporting.integration.test.js` and this document. No app/module/harness edits.

Latest isolated run: **7 tests passed, 0 failed, 0 skipped** (six HTTP subtests plus parent), exit 0. Test assertions unchanged from the failing run. All groups below passed, including financial controls, homonym ID isolation, shared sanitized production data/ranges and own user ID for active unknown roles.

Previous run had three failed subtests: unknown-role handling discarded actual production data/range fields and its own user. These are now verified fixed without changing expectations; the range loader itself was not the cause.

Exact final fixture `/private/tmp/render2-local-grhsL0` was stopped and removed by cleanup, with directory absence asserted. Port 55602 had no listener after completion. Default invocation separately verified one skipped parent without provisioning. Initial attempt stopped before HTTP because a concurrent frontend build temporarily lacked `frontend/dist/index.html`; final run checked that file existed before provisioning. No application files were altered.

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-production-reporting.integration.test.js
```

Exact-file execution only. Fresh guarded fixture on PostgreSQL loopback 55602 and ephemeral loopback HTTP; default skip occurs before provisioning. No existing DB, inherited credentials, external calls, scheduled jobs or production data. Only synthetic markers/amounts. Suite timeout 180s plus bounded harness/request timeouts. Cleanup stops only the exact own cluster and verifies its directory absent.

## Actual HTTP assertions

- Create a real source visit task; its auto-linked registry gets three videos and one photo through the real router. An active unassigned teammate and an unknown-role user can register shared media. One recorded video is handed off to an explicitly ID-selected editor.
- `/reportes/datos` has a shared `producciones` block with exact operational allowlists, stable UUIDs, three total/two recorded videos and one photo; every active role, including a same-name nonowner and unknown role, receives identical registry data.
- Ordinary historical/Render OS task report rows use normalized ownership IDs. Homonyms and retained JSON names cannot expose another user's or unmapped task. Non-admin usuarios contains only its own ID. Actual persisted nested financial poison is absent; admin retains a nonempty financial control.
- `/producciones/tareas/:taskId` source/editing linkage uses real relations only, returns exact small context fields/counts and never raw metadata/money. Spoofed registry IDs in unrelated task JSON and nonexistent positive tasks return null; invalid positive-ID inputs return 400.
- Employee editing → review → admin approval/finalization appears through live report task joins without changing video recording state or any actual editorial publication row/date.
- Manual visit postponement moves it between inclusive-start/exclusive-end monthly ranges after a fresh login while registry/media IDs remain stable, source date updates and editing delivery date remains unchanged.
- Explicit range requires both real ISO dates and 1–366 days; default selected-calendar-month bounds are exact. Invalid/incomplete/reversed/oversized ranges return 400.

This is backend HTTP/DB evidence, not frontend chart/layout proof. Financial assertions concern structured columns/JSON, not censorship of ordinary user text. SQL is used only for synthetic fixtures and independent persistence/privacy controls; production registry/report interactions use principal HTTP.
