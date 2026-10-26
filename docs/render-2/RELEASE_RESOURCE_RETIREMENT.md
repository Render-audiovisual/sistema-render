# Resource retirement and release gate — 2026-10-26

## User request and implemented scope

User requests publishing the new system while preserving existing tasks/data, and removing Drive and Moodboards because they will not be used. Main retires those sections from canonical navigation, Home, client/task shortcuts and App lazy mounts. Existing bookmarks use the existing authenticated/unsaved-navigation legacy replacement mechanism: Inicio, or a valid task context. No new redirect privilege or local business store.

Retirement is deliberately non-destructive. Existing PostgreSQL tables, reference links, provider configuration, files, backend APIs and upload/attachment support remain. This does not claim to uninstall the Drive provider or disable every API. Operational uploads currently depend on that provider; deleting it would change task/publication functionality beyond removing the two sections. Uncertain-upload recovery now links explicitly to external Google Drive for manual inspection; it does not infer confirmation by name or pretend to reconnect OAuth. Reconnection failures request administration assistance. No external link was followed.

## Publication is NOT performed

Read-only git remote inspection and fetch identify origin/hostinger-deploy at43f02707e299293c5b0c2bb6f12386bd4642746b, newer than cached d88ec07. Before this retirement commit, local HEAD190101b and this remote diverge by400local/32remote commits. Remote contains live-fix history including atomic production handoff, PostgreSQL recovery and linked editing from partial visits. No force-push, merge or replacement is safe merely because the local build succeeds.

There are conflicting migration histories: remote054_cierre_reportes_septiembre_2026.sql and055_cierre_reportes_identidad_septiembre_2026.sql versus local054_verified_user_sessions.sql and055_decouple_goal_publication.sql. The same numeric prefix is not proof of equivalent applied schema. Actual ledger, names, hashes and data need inspection. Never rename applied migrations or fabricate a baseline to satisfy startup.

Read-only SHA256 comparison of repository SQL:93 local files,58 remote,53 shared names with identical bytes,5 remote-only (050 editing ledger,051 progress audit,052 backfill relocation,054/055 report closures),40 local-only. This is a repository inventory, not evidence of what the deployed database applied. The current ledger identifies full filenames and does not store SQL hashes, so inventory alone cannot certify a live schema.

docs/DEPLOY.md and the migration CLI explicitly reject production apply, and canonical startup rejects pending/unknown migration history. Historical044_eliminar_tareas_finalizadas_actuales.sql contains destructive cleanup. Do not run the historical chain against an existing database, disable guards, misclassify production as test, or use setup/seed to prepare it.

Repository documentation mentions sistema.rendercorrientes.com and Hostinger; actual current destination, deployment mechanism, database identity and backup/restore access remain unconfirmed. Static build:hosting and full Node hostinger-dist are different outputs. No configured DB or provider was connected. Existing private/environment values were not printed.

## Safe release sequence still required

1. Confirm actual hosting/app/database/storage destination and current deployed commit with user/admin.
2. Obtain consistent database AND persistent-file backup; verify restoration in an isolated environment and retain previous artifact/configuration securely.
3. Inspect actual migration ledger and schema read-only; compare remote fixes and local changes. Reconcile contracts on an isolated copy, preserving historical tasks/comments/IDs and publication facts.
4. Produce a forward-only approved release plan, including any genuinely required schema changes, account cutover, rollback compatibility and pause/restore plan. Current local-only migration tooling is not an approved production migrator.
5. Rehearse the exact release on restored data, including counts/relations, login, employee financial privacy, tasks, productions, publication separation, persistence and files.
6. Only then publish the coordinated frontend/backend artifact, restart the process (index is captured at startup), verify served hash and run bounded smoke checks. Keep seeds/jobs off unless separately authorized.

Harvey performs independent release audit; Hilbert reviews retirement links/permission impact. Main integrates owned frontend files and tests only. Automated results and remaining limits are recorded in CURRENT_ACCEPTANCE.md. No deployed claim, database backup claim or completed master acceptance.

## Local verification

Initial full suite found4 obsolete expectations (retired lazy chunks, removed fifth client action and retired login destination). After updating those contracts, one stale chunk dereference remained; corrected without weakening uploader CSS closure checks. Final frontend3328PASS/1opt-inSKIP/0FAIL of3329, terminal0 (/private/tmp/render2-retire-resources-frontend-final2.log). Build B1UabfNq succeeds, terminal0 (/private/tmp/render2-retire-resources-build-final.log). New4tests cover all-role menu retirement, guarded bookmark destinations, no lazy page/shortcuts and honest external recovery links. No native browser, live login, database rehearsal or backend suite renewed in this change.
