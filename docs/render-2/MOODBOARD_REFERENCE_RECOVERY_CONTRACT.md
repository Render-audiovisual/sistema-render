# Moodboard reference and task-link recovery

Integration101, local development. Canonical `/moodboards` uses PostgreSQL-backed reference and relation APIs. This change repairs partial-success handling without creating a preview-only store or changing backend authority.

## Creation is not the same operation as linking

The composer first creates a reference, then optionally links the task from the verified URL/board intent. Once the creation ACK has a valid positive ID and the original board ID, retain that identity. Never call reference creation again for that attempt after a confirmed creation, even if linking or refreshing fails.

An unknown creation outcome (lost transport, malformed ACK or5xx) is not a verified failure. Without a durable creation receipt, do not offer a blind retry or identify the created row by matching its title. Offer explicit read-only recovery to the saved board/list and state the uncertainty. A later user decision to create another reference is a new action, not a guaranteed replay.

## Link writes and observations

POST/DELETE `/api/moodboards/references/:id/tasks/:taskId` return204 after transaction commit. They enforce current actor/epoch/role and canonical task-read/client scope. They are set-idempotent but have neither CAS nor durable receipts. Repeating a lost POST can restore a newer unlink; repeating a lost DELETE can remove a newer relink.

Therefore uncertain link recovery is GET-only. The UI keeps the acknowledged reference ID, reports the uncertain/pending linkage and allows refreshing the current board/reference projection. A fresh deliberate checkbox action is distinct from repeating an old intent. A successful write followed by a failed reload offers only reload recovery, not another mutation. Do not recompute an old POST/DELETE from an optimistic checkbox state.

Displayed relationships come from `/boards/:id/references` and its `tareas` projection. `/boards/:id/tasks` is a candidate list capped at150, not an exhaustive relation inventory. A missing projected link can mean changed authorization/client compatibility; it does not prove physical deletion. Reload describes currently visible state, not historical attribution or a multi-query immutable snapshot.

## UI lifetime and failure handling

Capture the rendered genuine session, mounted lifetime and original board observation before dispatch. Account replacement, board ABA, unmount or obsolete context must prevent a second-stage write and late success/error/refresh callbacks. Never recapture a replacement account for an old form. Keep operational attempts only in component memory, not localStorage.

Busy state is synchronous and serializes submit/toggle actions. Checkbox writes preserve confirmed display until a successful current reload. Show errors in the panel, catch every promise, distinguish mutation failure from confirmed-write/refresh failure, and block another ambiguous write until recovery. A confirmed reference can remain saved without its optional task link; finishing must not delete or recreate it.

Owner-token registration blocks controlled board changes, initialization and other overlay openings while pending. It uses the application's shared navigation guard for global navigation, beforeunload and cancelable same-document traversal. Recovery states warn before abandoning in-memory context. Cleanup removes only its own token; obsolete callbacks cannot restore a stale dirty/busy guard. A browser escape that cannot be canceled must follow the actual URL and invalidate the old board epoch, without replacing earlier history entries. Such an escape can lose in-memory recovery; it does not cancel or roll back the request.

Finishing the creation/recovery explicitly consumes only the URL `task` intent, retaining client/board/other query/hash context, so reload does not reopen an empty creation form. Closing an unsent draft does not consume that intent. A definitive400 creation validation error precedes insertion in the existing API and permits an explicitly corrected form submission; this is different from an unknown creation outcome.

## Verification gates and limits

Verify confirmed create + failed link produces one reference, lost create blocks resubmission, lost POST + peer unlink and lost DELETE + peer relink recover by reads without restoring stale intent, write ACK + failed refresh does not repeat mutation, concurrent clicks serialize, and account/board/lifetime changes suppress old operations. Physical tests must use the actual API and a fresh disposable PostgreSQL fixture; native UI tests should cover partial-success copy, recovery, a fresh deliberate checkbox and reload persistence.

No backend schema or authentication change is implied. This is not durable exactly-once reference creation across browsers/reloads, not category-editor repair, not a full Moodboard mutation/security certification and not production rollout. Record exact executed results and remaining gates in STATUS.

Executed101:32 opted-in principal PostgreSQL/HTTP cases across recovery, coherent board reads and task-link scope/lock waits; full frontend1297pass/1optional skip; Vite build. The new recovery suite alone has12 physical cases. Native desktop and final styled390px mobile journeys use a loopback fault proxy: creation201 succeeds, first link returns synthetic503 without reaching upstream, recovery GET leaves one reference/unlinked state, a fresh deliberate checkbox writes204, and reload retains exactly one reference/link. New buttons measure44px high and document width390 at390. These native cases do not simulate an actually committed lost link; physical controller tests cover that case and peer unlink/relink. No provider login, external image upload, real business records or production database used.
