# Canonical task workflow: isolated HTTP QA

Status: latest authorized isolated run with shared DB approval-invalidation guard completed: **10 passed, 0 failed, 0 skipped** (9 assertion groups plus parent). Owned files only: `backend/test/render2-task-workflow.integration.test.js` and this document. No application, schema, harness or older test edits.

## Isolation / execution

Uses the guarded principal harness with `port:55598,deferTaskStateMigration:true`. A fresh disposable PostgreSQL cluster binds only to loopback; principal HTTP is manually bound to another ephemeral loopback port, default startup/schedulers disabled, inherited secrets absent, external fetch rejected. All identities and content are synthetic. Only this suite's exact fixture is stopped/removed; cleanup asserts that directory is absent. Never use production or an existing database.

```sh
RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-task-workflow.integration.test.js
```

Default test discovery skips before PostgreSQL provisioning. Suite timeout 150s; bounded HTTP/SQL/startup/cleanup are inherited from the harness.

## Verified assertions

- Actual 058 upgrade over populated legacy `publicada`/`programada` tasks, editorial real-date history and goal/slot/event history. Compare all rows before/after applying unchanged SQL, then record only successful 058 in the migration ledger. No old function swaps or backfills.
- Real logins: admin, assigned editor, Community finalizer, Production employee. Canonical HTTP progression `pendiente → en_progreso → en_revision → aprobada → finalizada`, with current integer revisions on each write.
- Generic approval is admin-only and requires review; dedicated approval supports non-video tasks, publisher ID handoff and revision checks; repeat approval rejects.
- No skipped approval, employee approval/finalization, initial approved/finalized POST, stale revision or missing state-write revision. Rejected requests preserve task/binding snapshots where applicable.
- Client `revision_aprobada` metadata cannot approve a review-state task; rejected or sanitized input must leave approval false and finalization blocked.
- Reopen approved work clears approval identity/timestamp metadata and requires another approval.
- Editing approved material via assigned-employee HTTP returns the task to `en_revision`, clears verified approval fields and blocks finalization. After admin reapproval, direct SQL changes to instructions/copy trigger the same invalidation and block finalization again. Only fresh admin approval permits completion; editorial state/date remain unchanged.
- Legacy API final write `publicada` stores canonical `finalizada`; raw historical SQL rows remain untouched by 058.
- Completing/reopening a linked task never publishes/unpublishes or changes the editorial real date. Only the actual existing editorial publication route marks it published and sets its real date.
- Exception is restricted to actual Production visits: incomplete visit cannot finish; actual recording endpoint supplies completion before Production owner can finalize without approval. Generic production work still requires approval. No Phase 2 per-video implementation claim.
- Omitted-workspace regression: admin PATCH of an incomplete persisted Render OS visit without `?workspace=` must still return 400; full task/metadata/revision/binding snapshots must remain unchanged. Query omission cannot select a weaker historical path.

Main owns semantic updates to prior Phase 1/assignment suites: old API-completion assertions expecting task `publicada` must use canonical `finalizada`, and prior approval setup may need actual state approval rather than trusting client metadata. This QA task does not edit those files.

## Results

Ran against coordinator READY implementation with actual migration 058 deliberately deferred, populated legacy history snapshotted, real SQL applied and ledger recorded only after invariance assertions. All nine groups passed, including exact canonical persisted states, stale-write snapshots, metadata forgery rejection/sanitization, actual editorial publication date, non-video dedicated approval, the production visit exception via real recording HTTP and shared approval invalidation through HTTP/raw SQL. Installing the new BEFORE UPDATE guard still preserved every historical row snapshot.

The first run stopped the production group at a test expectation mismatch: a production employee was correctly rejected with 403 for generic production work, not a transition-status error. The test now asserts that exact 403 and separately checks an admin is rejected for missing approval; the subsequent full run passed 9/9. No application behavior was changed or approval invariant relaxed.

Latest rerun including omitted-workspace rejection: **10/10 passed**, no failures/skips. Admin finalization without a workspace query returned 400 and preserved the complete incomplete-visit snapshot. Cleanup stopped the exact own fixture and asserted `/private/tmp/render2-local-NESuQ3` no longer exists; port 55598 had no remaining listener. Other fixture clusters were not touched. Syntax/whitespace checks passed. This does not claim per-video Phase 2 production completion, every historical workflow writer, or frontend verification.

P2 compare-and-swap protection on specialized production recording remains explicitly pending and is not claimed by this suite's normal recording-flow checks.
