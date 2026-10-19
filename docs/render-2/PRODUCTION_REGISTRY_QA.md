# Per-video production registry: isolated QA

Status: final authorized isolated run **18 passed, 0 failed, 0 skipped** (17 assertion groups plus parent). Full three-video HTTP journey, all requested writer boundaries and bounded client-change/reuse race completed. Scope frozen. Owns only this document and `backend/test/render2-production-registry.integration.test.js`. No application, migration or harness edits.

## Isolation

Fresh guarded principal fixture only: PostgreSQL loopback 55601, ephemeral loopback HTTP, `deferProductionRegistryMigration:true`, explicitly allowlisted `supervisorEnabled:true` for inbound guard checks. Default discovery skips before provisioning. Normal backend startup and background schedulers remain disabled. No existing DB, real production data, inherited secrets or external requests. Suite timeout 180s plus bounded harness/request timeouts. Cleanup stops only its own exact cluster and asserts its directory absent.

Authorized exact-file command (never broad discovery or npm test):

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-production-registry.integration.test.js
```

The suite uses actual `/api/producciones` contracts and real task endpoints; no mocked registry writes or existing database are used.

## Prepared 059 invariance proof

The real `059_production_registry.sql` is deferred and its ledger entry must be absent. All four registry tables must be absent. Populate old client/editorial rows, a legacy counted visit, its old aggregate `origen_visita_id` editing task, normalized assignment, and goal/slot/event history. Snapshot every task/user/client/piece/goal row plus the old aggregate uniqueness index. Apply actual 059 unchanged, verify exact row/index invariance and four empty registry tables, then insert only the successful 059 ledger entry. No backfill, fusion, schema replacement or old-function swap.

Schema facts: `produccion_visitas`, `produccion_visita_participantes`, `produccion_videos`, `produccion_fotos`. Participants live in the normalized child table; API participant IDs are computed, not an array column. `produccion_videos.video_origen_id` must be a nullable real self-FK with unique `(visita_id,video_origen_id)` for explicit reuse. The upgrade block asserts its column, FK and unique index after actual SQL installation. New video tasks must use their explicit `origen_produccion_video_id` / visit registry identity; the old aggregate `origen_visita_id` index stays untouched.

## Actual HTTP assertions implemented

- Admin creates one visit with three planned videos. Any active team member reads/registers recorded videos, photos and pending/repeat work; only admin may manually hand off.
- Three recorded videos get three unique editing task IDs with explicitly selected editor IDs (91002, 91003 and another synthetic fixture user) and independent delivery dates. No inference from names; preserve legacy aggregate tasks.
- Persist normalized task bindings; selected employees see/edit their assigned work, move to review, admin approves/finalizes without editorial publication. Registry joins reflect real current task state.
- Employee handoff 403, stale visit revision 409 and unchanged snapshots, malformed IDs/date 400, repeats cannot duplicate, cross-visit video 404.
- Inject fixture-only binding INSERT failure after task creation: rollback visit/video revision, task and assignments. Remove trigger/function in `finally` and retry safely.
- Manual date change, month-filter reload and new login show persisted identities/dates; no browser-only state assumptions.
- Pending/repeat video from visit A is explicitly reused in visit B for the same client through `video_origen_id`, preserves its guion and lineage and leaves the original record/history unchanged. `/producciones/pendientes` must omit already-resumed sources; duplicate reuse within B and cross-client reuse reject without writes. No name/text matching or inferred fusion.
- Creating an actual production visit task through the normal task POST hook creates exactly one registry visit when client/date are valid, but zero invented video rows from planned counts. An explicit attempt to link the same source task cannot create a second visit (409 or documented idempotent result). Existing legacy tasks are never batch-imported.
- Selected editor must be active with current role `admin` or `edicion`; other active roles and inactive users are invalid. `tarea_estado` comes from the actual linked task, not a separately cached registry status.
- After linking, registry owns visit date/client. Task-only date/client/classification PATCH returns 409 with complete task/registry/participant snapshot invariance; source-task DELETE returns 409 and preserves all rows. Unrelated task priority update cannot overwrite or duplicate the linked registry record.
- Registry PATCH updates its own and source-task date/client/revisions in one transaction. Postponing a visit does not change existing video editing delivery dates. Client change after editing bindings rejects with 409. Linked editing task client change and DELETE reject with 409 and no changes. Source-task-before-visit lock ordering is an implementation contract, not directly measured by this single-request test.

Actual per-video backend workflow is now verified on synthetic data. Backend-only QA does not prove frontend calendar layout, external transport, production deployment or every concurrent lock interleaving.

Source-only inspection initially found a transient migration defect while main was editing. Main moved the nullable self-FK to `produccion_videos` before execution; actual 059 install/FK/index/history invariance passed.

## First actual execution

Passed: 059 history/index invariance; source task auto-registration with zero inferred videos, task-only date/client 409 and protected deletion; three-video planning and unassigned teammate media/status registration; role/revision/editor/date/scope handoff rejections; registry-to-source date/client synchronization; normalized media blocking legacy aggregate recording; same-client pending reuse with lineage/script/source preservation and latest-only intake; real binding-failure rollback/retry; final legacy aggregate snapshot preservation.

Initial mismatch reported to main: handoff admin task response serialized the PostgreSQL date as a raw timestamp, while the test assumed a date-only string. Coordinator confirmed the existing admin task DTO deliberately remains raw. Test shape was adjusted to compare the effective task day while requiring exact YYYY-MM-DD on video snapshot/current delivery fields, GET-task projection and persisted DB date. Wrong delivery dates still fail. Initial dependent lifecycle/delete failures were cascading setup failures, not independent application defects.

Own fixture `/private/tmp/render2-local-670nxA` stopped and its removal was asserted; no listener remained on 55601. Fixture-only binding SQL exception and legacy-mixing 409 logs are expected paths. Other clusters were untouched.

## Latest verified results

**13/13 passed**, no failures/skips. Three recorded videos created three unique task IDs bound to selected active admin/Edición users, each with independent dates. Assigned editors edited and reviewed; admin approved/finalized; registry `tarea_estado` reflected every actual transition and editorial rows remained unchanged. Visit postponement, month reload and fresh login persisted correctly without moving editing deliveries.

Reviewer guards passed: source-task reclassification and task-only date/client writes return 409 unchanged; editing task client change/deletion reject 409; inbound and outbound reuse lineage block client relabeling; current editor/date remain distinct from original handoff snapshots after reassignment, date change and idempotent replay. Source-hook idempotence, zero inferred videos, pending reuse/source preservation, mixed legacy rejection, real binding failure rollback/retry and old aggregate history preservation passed.

Final writer-boundary extension rerun: **15/15 passed**. Ephemeral RSA public key only is injected through the existing allowlisted harness option; private key stays in the opt-in test process. Actual signed Wilson PATCH date/client/classification attempts return 409, preserve registry/task/binding snapshots and roll back token consumption. Actual web-chat preparation obtains a pending token; confirming aggregate recording after normalized media exists returns 409 with unchanged token and snapshots, creating no aggregate editing task.

Coordinator added validated boolean `supervisorEnabled:true` to the guarded harness, enabling inbound supervisor behavior only in the fresh child while startup/schedulers remain disabled. Both actual signed supervisor date-reply and accepted-date-proposal endpoints returned 409 with the registry-specific Producciones error, not a 503/validation shortcut. Full snapshots of tasks, registry, participants, conversations, inbound messages, replies, proposals, comments and audits were unchanged.

Final bounded race used three fresh source/target pairs with concurrent real HTTP source-client PATCH and pending reuse POST, no sleeps or unbounded retries. Observed outcomes: (409,201) with one same-client lineage; (200,409) twice with no lineage. Direct committed DB joins verified no cross-client edge. This exercises both winning orders but does not claim exhaustive scheduling/model checking.

Final result **18/18 passed**. Cleanup stopped the exact own cluster and asserted `/private/tmp/render2-local-vbS29f` absent; port 55601 had no remaining listener. Other clusters were untouched. Syntax/whitespace checks and exact-file default-skip check passed. Only the two owned QA files changed; no broad test discovery/npm test was used.
