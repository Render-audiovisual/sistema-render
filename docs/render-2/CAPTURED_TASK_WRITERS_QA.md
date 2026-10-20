# Integration 74 — captured task writers and Drive lifetimes

## Scope and team

Local adoption batch, not completion of Render 2.0. Coordinator owns shared captured-request, coordination/reconciliation, Drive browser, integration and QA; Carson owns canonical Workspace callbacks; Hypatia owns Drive transport/uploader and extracted callback harnesses; Beauvoir independently reviews frozen changes. Agents returned ownership before final integration. App.jsx user20+/1-, vite.config.js user5+ and untracked reference implementations excluded.

## Implementation

- `shared/session/captured-request.js` pins the original registered session binding before queues, dispatch and response effects. Cookie DTOs remain exact, legacy bearer remains compatible; obsolete observations never acquire replacement identity.
- Workspace writes, conflict GET/eligible CAS retry, activity, comments, approvals, production, bulk actions, catalogs and pagination use captured scopes. Existing workflow/publication distinction, permissions, draft and retry rules remain. Already committed server writes are not falsely described as rolled back after identity changes.
- TaskCoordination captures the original binding on opening. ProductionReconciliation retains binding and exact frozen retry body/UUID.
- Drive upload planning/chunks/retries/progress and post-upload task reload use the original upload scope. Blob/range/signal preserved; transient retries bounded, session/abort/4xx not retried. UI overlap and lifecycle fences added. Provider authorization still belongs to backend.
- Drive browser scopes rows/loading to folder/query/session; stale upload callbacks cannot cancel a newer reload. OAuth redirect allowlisted. Two independent-review P2 races corrected before freeze.
- Actual browser reload exposed a third lifecycle issue: parent Workspace passive mount flag lagged behind child subtask effect. Layout-lifetime setup now precedes child passive reads, including StrictMode replay; regression assertion added. Genuine obsolete-session blocking remains.

## Verification

- Final frontend suite: 690 passed, zero failures/skips. `/private/tmp/render2-writers74-frontend-complete.log`.
- Backend discovery: 1336 passed, 56 explicitly opt-in skips, zero failures. `/private/tmp/render2-writers74-backend-final.log`.
- Isolated real HTTP/PostgreSQL: 35 passed, zero failures/skips. Sequential opt-in browser-client/task-workflow/task-coordination suites. `/private/tmp/render2-writers74-http.log`.
- Physical suite executes actual Workspace update/activity callbacks: PATCH409→GET→PATCH with same original identity, preserving concurrent priority; late successful A result cannot repaint B; queued A write cannot dispatch as B. Node cookie jar/locks and injected state setters are not mounted-browser cookie proof.
- Final production build and diff check pass. Focused post-browser lifecycle regression: 19/19; all tracked frontend tests 643/643, then complete suite rerun.
- Actual canonical default-bearer UI with synthetic Franco: created/assigned task, edited title, saved comment/coordination, reloaded and recovered all values from disposable PostgreSQL. Initial build reproduced false session warning; final rebuilt fixture repeated creation/comment/coordination/reload without warning.
- Desktop screenshot `/private/tmp/render2-writers74-final-desktop.jpg`; mobile390×844 `/private/tmp/render2-writers74-final-mobile.jpg`. clientWidth=scrollWidth=390. Mobile task pane looks too narrow/dense: NOT complete responsive/design acceptance.
- Both owned fixture roots and sandbox-failed-init root verified absent; final owned tab closed, viewport reset, owned PTY stopped. No shared servers stopped.

## Remaining gates

No actual Drive provider upload/connect/trash performed. Drive21 transport tests and browser7 extracted callback/source tests do not establish provider acceptance. No file chooser used in this batch. Other auxiliary writers (GoalTaskLink/Wilson), all-app token inventory, draft recovery/refresh/navigation, native locks, cross-tab cookies/crash and HTTPS/proxy acceptance remain. Global cookie activation stays off; application still defaults to bearer/localStorage. Do not infer deployment readiness from local unit/build success. Master phases and premium responsive unification remain incomplete.

No configured DB/provider, real account/commercial record changes, new schema/migration/dependency/environment, push or deployment. Implemented and verified locally within these boundaries only.
