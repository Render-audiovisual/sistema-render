# Full task review queue

Integration106 is implemented and tested locally in the scope recorded in `STATUS.md`, not deployed. This contract alone is not runtime evidence or completion of the full master goal.

## One task system

Home remains a small summary. Its review section links to the canonical task workspace in list view, with only `review_scope=team` or `review_scope=personal`. It does not link to Feedback or create a second approval system. Each row opens the original task/detail and retains its ordinary editing/review permissions. Viewing a queue never grants approval, task finalization or publication authority.

The canonical `GET /api/tareas?workspace=render_os` gains an optional review scope. Team scope requires current database admin; personal scope is current actor ownership or collaboration by ID, including for an administrator explicitly selecting personal scope. Names never grant membership. Additional ordinary filters are intersections, not a way to broaden scope. Initial Home links clear unrelated filters so their unfiltered total matches the same Home observation semantics.

## Shared business predicate

Home and the full queue share live RenderOS visibility and effective review semantics: exclude archived/trash tasks and inactive clients, include tasks without a client, require `en_revision` and exclude legacy JSON boolean `revision_aprobada=true`. String `"true"` is not that boolean. There is no month/date restriction, delivery requirement or task-type restriction. Do not reinterpret historical approvals or certify a version that lacks editing evidence.

Order is delivery date ascending/null last, then task ID ascending, matching Home. A full queue may contain much more than eight records. Return the existing operational task DTO and actual total; preserve financial redaction for employees. General task status filters use the same effective legacy-approved interpretation while retaining the finalized-task alias `publicada`. No stored record is migrated or implicitly published.

## Observation and navigation

Each review page reads current actor identity, collection signature, count, page and assignment annotation in one repeatable-read read-only transaction. This is a consistent observation, not a long-lived lock against subsequent revocation. An opaque `X-Task-Review-Snapshot` binds actor/epoch/role, exact filter query and ordered ID/revision/membership signature. Subsequent offsets require `expected_review_snapshot`; changed scope, filters, state, membership or collection return409 rather than silently skipping/duplicating tasks. No raw financial metadata enters the signature.

Review mode is incompatible with manual ordering or archived/trash scope. The frontend makes those differences explicit; leaving review mode restores the ordinary task views without changing tasks. Scope and status round-trip through URL, reload and browser navigation. Each context/session change cancels obsolete observations and resets pagination. A changed snapshot blocks load-more until an explicit refresh from the first page; never refresh behind an unsaved task editor. Infinite-load position itself is not promised as a durable/shared URL cursor.

Confirmed local writes invalidate the review observation immediately. Unconfirmed writes can also invalidate it without claiming success or rollback. Keep the old total explicitly labeled as an earlier observation until refresh; a pending task creation does not invent another review item. Explicit refresh uses navigation context `type=refresh`, not the harmless same-task link exemption: pending writes block it and dirty drafts require confirmation. Refresh failure retains the editor and data rather than replacing the workspace with an error screen. Generation fencing must also end loading after invalidation, so an obsolete GET cannot leave an indefinite spinner.

The review list has no silent500-row cutoff: every explicitly loaded page remains reachable. Existing caps in other view types point users to the complete list. A visible review counter is retained on mobile even where the ordinary task toolbar hides its summary. Displaying a legacy effective-approved status neither rewrites the raw state nor certifies a delivery version; rows with differing display/backend order columns cannot offer invalid manual anchors.

Malformed/repeated scope/status/snapshot arguments fail closed. A forbidden scope or malformed review response must not fall back to the general shared board. The ordinary manual-order snapshot also binds its exact filtered query, including empty collections, without changing the global order writer or interpreting filtered end as global membership.

## Safety and acceptance

No migration, external provider, configured database or real-user modification is needed. Tests use new guarded PostgreSQL fixtures and synthetic accounts. Acceptance includes more than50 review tasks, team/personal/collaborator/homonym boundaries, effective approval/visibility exclusions, exact ordering, additional filters, empty last pages with real total, snapshot conflicts and session replacement. Native desktop/mobile navigation must be distinguished from mocked callback tests and real-device/provider acceptance. Nothing is deployed by passing these checks.
