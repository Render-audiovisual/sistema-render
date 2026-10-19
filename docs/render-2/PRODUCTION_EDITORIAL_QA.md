# Production → editorial HTTP QA

Status: **prior coordinator regression PASS; new script-only preservation assertion awaiting coordinator rerun**. Contract read completely: `PRODUCTION_EDITORIAL_CONTRACT.md`. No application, schema or harness edits.

Latest authorized test-only addition stays inside the existing handoff subtest (still 16 tests): owner PATCH sends `aclaraciones` and `propiedades_extra: {guiones: ''}` with no `copy_trabajo` key. Assert saved empty task script, unchanged nonempty publication/goal copy, and retained original production-video script. Existing later concurrent copy-writer test remains intact. Syntax/default-skip checks only for this addition; no cluster started. Previous 100/100 coordinator result below predates this addition and does not verify it or the frontend UI fix.

Coordinator executed the frozen exact suite on 2026-10-19 and reported **16 tests passed, 0 failed, 0 skipped** (15 subtests plus parent). Coordinator reported fixture `/private/tmp/render2-local-y0QWhZ` stopped/removed with absence asserted. This is attributed coordinator evidence, not a claim that the QA author executed that run. Both lineage winning orders and the full A→B→C sequence passed in that run; earlier author-run lineage failure is superseded by this coordinator result after application fixes.

Passing coordinator coverage includes populated-history 060 application, both canonical paths, rollback after synthetic SQL XX000, same-publication race, copy writers in separate concurrent HTTP transactions, cross-column canonical uniqueness, active old-owner/collaborator preservation, association after prior handoff, and three bounded simultaneous association/continuation attempts preserving at most one linked identity. Application errors printed for XX000 are intentional injection evidence, not unexpected test failures.

Final coordinator run on 2026-10-19: **all nine HTTP suites 100/100 passed, 0 skipped**, including this suite **16/16** with the added membership assertions. Verified by coordinator execution: homonym ID 101002 removed through the real assignment API is not regranted from stale JSON; deactivated collaborator 101004 is excluded; active old owner 91003 and collaborator 101003 remain alongside new owner 101001; removed homonym edit is denied. Coordinator reports all fixture cleanup hooks completed. No additional fixture was started by the QA author for this closing update.

Additional coordinator-reported regression: backend units **750 passed / 16 skipped**, frontend **152 passed**, build passed. Coordinator also reports unexpected P0001 faults return 500 rather than being masked as domain conflicts; this authored suite's explicit rollback injection uses XX000. These are attributed coordinator results, not additional author executions. This is local synthetic HTTP/static/unit/build evidence only: no production database, production server, deployment or live-data validation is claimed.

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-production-editorial.integration.test.js
```

Only a newly generated guarded fixture, PostgreSQL loopback **55603**, ephemeral loopback HTTP. Explicit `deferProductionEditorialMigration:true`; verify no 060 ledger entry, populate historical publication/task/goal/registry rows, apply the single actual 060 SQL file, compare all existing values (excluding only new nullable video linkage columns), then insert its ledger entry. No historical inference/backfill. No real database, inherited credentials or external integrations. Default invocation skips before provisioning. Parent timeout 180s; HTTP requests bounded at 5s; harness bounds startup/shutdown. Cleanup checks exact own root removed, never other clusters.

## Verified assertions

- Admin-only candidate reads and writes; candidates expose canonical task/goal IDs. Staff denied without mutation.
- Existing piece and goal adopt their existing task: unchanged task/slot counts, no automatic handoff, exact retry mutation-free.
- Empty goal creates one draft publication and zero tasks, preserves slot copy instead of video script, no actual publication timestamp. Exact retry returns existing association; changed-date retry conflicts.
- Independent stale visit/task/publication/goal versions and omitted goal acknowledgement conflict atomically.
- Two distinct visits racing for one publication/canonical task have exactly one successful association and one 409.
- Cross-client/format candidates excluded and forced links rejected; wrong-period goal candidates absent.
- Fixture-only video binding trigger throws after draft creation; full snapshot rollback covers publication, goal, task, ownership and visit revision. Drop trigger/function in `finally`; same request succeeds afterward.
- Manual handoff adopts canonical task without INSERT, explicit editor ID distinguishes homonyms, inactive editor and noneditor rejected; previous owner and collaborators retain normalized collaborator bindings. Visit/delivery/programming dates remain separate. Owner edits/reviews, admin approves/finalizes without actual publication. Goal retains one slot, fresh login still sees stable association.
- Ordinary task/publication/goal writer attempts cannot sever tuple or delete canonical identity. Direct SQL checks composite client FK and slot-clear guard; no raw SQL mutations allowed to escape.
- Concurrent task-copy/publication-copy HTTP requests both complete within request bounds, goal copy matches piece copy, no editorial state/date or goal completion changes.
- Cross-column delivery-vs-prior-handoff uniqueness: planned canonical task is not already a handoff; assigning it to another video's handoff fails. Other workflow tasks sharing a publication remain legal.
- Association after prior handoff accepts precisely its existing task; a different canonical task conflicts without fusion.
- Three bounded simultaneous association/continuation attempts use real HTTP transactions; any resulting ancestor/descendant cannot claim a second publication.
- Explicit A→B→C continuation chain assertions cover both winning orders; coordinator's frozen-suite run passed both sequences.

## Verification limits

Coordinator final rerun after the script-copy preservation assertion: all nine principal isolated HTTP/PostgreSQL suites passed together, **100 passed, zero failures/skips**, including this suite's 16 tests. Backend principal regression: **757 passed, 16 opt-in skipped**, zero failures; frontend build passed. This supersedes earlier pending-rerun notes, but does not certify global browser behavior.

Default invocation verified skip before provisioning. Syntax checks pass. Any mismatch remains a failure for coordinator review, not a reason to weaken assertions. Full existing eight-suite regression is not run by this block.

Authorized compatibility-only edit to `render2-production-registry.integration.test.js`: after its actual 059 invariance assertions and ledger insertion, apply deferred 060 and insert its ledger before any subsequent API interactions. No other old-suite behavior changed.

This is backend HTTP/SQL QA, not browser UI verification. Historical/atomic assertions do not constitute production-data testing. Early runs corrected only synthetic fixture requirements (asignado_a and goal cuentas), task copy payload shape and injection SQLSTATE; no business assertions were relaxed.
