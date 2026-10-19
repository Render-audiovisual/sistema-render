# Explicit task-close discard confirmation

Scope: replace only TaskDetail's native `window.confirm` on explicit close/backdrop/Escape with an accessible in-app confirmation. Shared SPA link/traversal protocol, new-task modal, destructive task actions and browser `beforeunload` remain unchanged.

## Invariants

- Clean close retains existing animation and URL behavior.
- Dirty close opens confirmation without clearing drafts, changing URL/history, setting closeApprovedRef or writing any API data.
- "Seguir editando" and Escape cancel confirmation only, preserve all task/coordination/review/comment drafts, and return focus to a connected enabled invoker or the detail panel.
- "Descartar cambios" is explicit. Recheck current write/archive/closing state before granting close; busy disables discard. Never infer consent from dismissal, cancel, backdrop or component cleanup.
- While confirmation is open, shared navigation guard reports busy before same-task shortcuts. No compensating history writes or new global navigation protocol.
- Native HTML dialog provides top-layer modal behavior, focus trapping and inert background in supported browsers. Dialog click/Escape propagation must not reach the task drawer/backdrop. Existing parent handles final board-focus restoration on approved close.
- No persistent data or localStorage changes. Successful discard loses only the unsaved test/user draft after explicit consent; the persisted task is unchanged.

## Verification

Independent structural contracts cannot prove browser interaction. Required browser cases: dirty coordination close -> keep -> draft and URL retained; reopen -> Escape -> same retained; explicit discard -> board -> reopen -> persisted value unchanged. Confirm safe initial focus, repeated opening, desktop/mobile sizing, no horizontal overflow and absence of native confirm for this action. Busy/session/race behavior needs source/model tests plus relevant runtime evidence; do not claim universal navigation protection.

Render 2.0 completion and legacy-dashboard retirement remain separate gates. No production writes or deployment.
