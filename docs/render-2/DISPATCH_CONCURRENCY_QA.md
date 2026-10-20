# Integration 77 — shared draft concurrency

## Contract and ownership

Coordinator owns canonical backend, physical integration tests, compatibility/docs and final QA. Hypatia owns Composer and callback tests; Carson owns isolated registered-router tests; Beauvoir independently reviews frozen source. Existing user App20+/1-, Vite5+ and untracked reference implementations excluded. No schema migration, environment/dependency changes or production access.

DTO adds `revision`, exact opaque UTC text with six microseconds derived by PostgreSQL from existing updated_at. PATCH requires `expectedRevision`: missing428, malformed400, stale409/DISPATCH_REVISION_CONFLICT; row locked before revision/state comparison, membership and DML. Non-draft409, missing404. Timestamp update uses GREATEST(clock_timestamp(),old+1microsecond). Clients must not parse/round this token through JavaScript Date. Dispatch BIGSERIAL path IDs remain canonical decimal strings through SQL, including above Number.MAX_SAFE_INTEGER.

Both successful POST/PATCH select their DTO while holding the transaction lock before COMMIT; failure cannot emit a successful ACK. Duplicate POST key locks the existing row, requires original actor and normalized equivalent payload and an intact row; edited row409/DISPATCH_REPLAY_CHANGED, different author/intent409/DISPATCH_REPLAY_MISMATCH. This prevents adopting a later editor's revision as the original request's ACK. No new receipt table or automatic retry.

Frontend pins the opened/saved revision and sends it unchanged for PATCH. Conflict preserves draft/revision, blocks silent retry/rebase and offers explicitly labeled discard/load. Server copy validated before local replacement; failed recovery preserves local changes. Loading another source prompts before discarding edits. Exact BIGSERIAL comparisons, existing session scopes/upload and ACK-vs-refresh semantics preserved. Uncertain PATCH replay may return conflict, requiring explicit inspection rather than claiming rollback or silently adopting current revision.

## Physical evidence

Actual HTTP/disposable PostgreSQL exercises two simultaneous owners against one revision: exactly one200 and one409; unchanged body/material/destination snapshots for rejected operations; explicit fresh revision works. Future synthetic timestamp advances .123456→.123457 despite clock being behind; rounded .123000 conflicts. Adjacent BIGSERIAL9007199254740992/3 remain distinct; invalid range/noncanonical IDs rejected. Original publication evidence unchanged, employee denied, original captured-session late result fenced. No provider request.

## Remaining gates

This is local concurrency protection for the canonical dispatch API, not proof that arbitrary direct SQL/external writers advance updated_at. Publication/client reassignment race and all-app writer adoption remain review gates. Global cookie activation off; native cookie/cross-tab/crash/proxy/HTTPS and provider acceptance, draft navigation/crash recovery and remaining design/master phases not complete. No deployment or push.

## Final verification and interruption recovery

- Frontend **773 passed/0 failed/0 skipped**; backend **1353 passed/57 opt-in skips/0 failed**; four real isolated HTTP/PostgreSQL suites **41 passed/0 failed/0 skipped**. New registered-router tests execute actual handlers against synthetic clients (17 cases), not physical SQL; physical suite independently covers PostgreSQL behavior. Build/diff checks pass. Logs `/private/tmp/render2-dispatch77-{frontend,backend,http-final,build}.log`.
- Independent frozen-source review: no confirmed new P1/P2 in CAS/replay/frontend; this is narrow review, not global activation approval. Matching original author and normalized intent added after replay-review feedback. Existing failure tests inject the new frontend conflict fields without removing original no-fabricated-ACK checks.
- Actual built default-bearer UI: Franco opens revision A and edits local copy; independent HTTP login as synthetic Agustín saves B; Franco's update receives409, retains exact local copy and blocks mutation controls. Explicit discard/load on mobile retrieves B. Franco edits again, saves successfully, reloads, selects draft#1 and recovers final text. Second writer is actual API/PG, not two browser-cookie contexts. No real accounts/provider calls.
- Screenshot `/private/tmp/render2-dispatch77-conflict-desktop.jpg` shows rejection/recovery control; `/private/tmp/render2-dispatch77-resolved-mobile.jpg` records recovered state; mobile clientWidth=scrollWidth390. No visual redesign or complete responsive acceptance claimed.
- Turn interruption occurred after final save/reload. Resumed existing PTY96297, confirmed terminal, then inspected existing browser48 (no restarted server). Ready page's recovered draft verified exact final text. Fixture root `/private/tmp/render2-local-MIgOGd` confirmed absent; owned tab closed and viewport reset. Non-TTY stdin was closed, so second writer used separate local HTTP command; no broad kill or deletion performed. Temporary script lives outside repository and is not staged.
- No schema migration/data backfill, production/configured DB, environment/dependency change, push or deployment. User App20+/1-, Vite5+ and reference files preserved/excluded. Local implemented/verified batch, full objective active.
