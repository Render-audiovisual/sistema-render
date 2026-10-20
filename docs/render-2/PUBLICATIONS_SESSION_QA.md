# Integration 76 — publication lifetimes

## Scope and ownership

Coordinator owns integration, compatibility harnesses and real HTTP/PostgreSQL checks. Hypatia owns PublicationComposer/queue and adjacent session tests; Carson owns Publicaciones calendar/general/planilla/page and adjacent session tests. Beauvoir independently reviews frozen changes. Shared runtime, App/server/styles and existing user work excluded. Original Render 2.0 objective remains active.

## Contracts preserved

React/Vite continues using the canonical Express/PostgreSQL API. Preparation records remain shared dispatches; their simulated outbound state is not publication evidence. Delivery, scheduled date and real publication remain distinct. No Meta/Google provider invocation or automatic publication is enabled by this batch. Existing historical rows and quotas are not reinterpreted.

Requests must retain the genuine session captured before the operation. A late result cannot repaint another account or issue follow-up GETs under it. Publication selection/period/client context must likewise fence outdated results within the same account. Save acknowledgment and refresh outcome must be distinguished; a committed write is not rolled back by ignoring a late response.

## Physical evidence

Disposable PostgreSQL/actual HTTP verifies two authenticated owners share one dispatch, repeated key creates no duplicate, unauthorized employee GET/POST403, missing client404 creates no record, and editorial piece unchanged. Captured-request case commits under A, holds the actual response, switches observation to B, rejects the stale result and prevents another old-scope dispatch; persisted author remains A. Node transport observation is not mounted-browser cookie/cross-tab proof.

PATCH previously checked that the new client existed but did not check the selected publication belonged to that client. It now uses the same parameterized membership lookup as POST before any UPDATE/delete of assets. A physical foreign-client400 case asserts full dispatch/material/destination snapshots unchanged. First fixture seed omitted required scheduled date; corrected the seed and reran, not a server regression. Final four-suite HTTP run:38 passed/zero failures/skips, including this subtest. No configured database was accessed.

## Remaining gates

Global cookie activation stays off. Application-wide writer inventory, native cookie/locks/cross-tab/crash/HTTPS/proxy acceptance, provider upload acceptance, draft/navigation recovery and remaining premium design/unification phases are not established by this integration. No configured DB/provider, real accounts/commercial writes, dependency/schema/environment changes, push or deployment.

## Implementation and final verification

- Composer and queue retain exact session observations through plan/all files/chunks/progress, save/refresh/events; no recapture of replacement identity. Busy ref/disabled controls preserve pending intent. Validated ACK requires positive exact ID, expected status and previewOnly; BIGSERIAL IDs are not rounded. Failed refresh after successful ACK retains confirmed ID and warns honestly. Manual unchanged-intent retry retains frozen body/key; changed intent gets a new key, never automatic retry. Session-keyed remount scopes these in-memory receipts; recovery after reload/crash still pending.
- All raw fetch/JSON parsing in Publicaciones.jsx replaced by scoped parsed API requests (calendar/general/planilla/page). Context observations include month/client and selection generations (including A→B→A). Planilla captures body/actor before per-piece queue; latest A→B→A edit is not deduplicated away. Deletes cannot race that local queue. This does not provide cross-tab/shared-editor CAS.
- Independent review found selection closure race and busy stuck after changing month during generation; fixed and regressed. `captureLifetime` retains original mounted identity only for releasing busy; old rows/errors/selection remain context-fenced. Final independent review confirms no new P1/P2 in these narrow deltas, not global security/cookie approval. Security guidance informed the server membership boundary; React checklist informed effect/lifetime cleanup. Existing server-draft CAS remains a deployment blocker.
- Final frontend **760 passed/0 failed/0 skipped** (tracked tests plus Composer22 and Publicaciones13). Backend discovery **1336 passed/57 opt-in skipped/0 failed**. Four isolated principal HTTP/PG suites **38 passed/0 failed/0 skipped**. Production build and diff check pass. Logs `/private/tmp/render2-publications76-{frontend-final,backend,http-final,build-final}.log`. Initial source-compatible test needed new injected dispatchOperation ref; fixed harness without weakening failure assertions.
- Actual final default-bearer browser: QA Franco opens editorial piece, changes native date control20→21, reloads and sees piece21; publication remains unconfirmed. A DOM-only date fill changed visible control without committing React event; native stepper+Tab succeeded, so only native path is credited. Creates draft, reloads/selects exact draft#1 and recovers copy. Desktop calendar/draft screenshots `/private/tmp/render2-publications76-{calendar-reloaded,draft-reloaded}.jpg`; mobile390×844 `/private/tmp/render2-publications76-mobile.jpg`, clientWidth=scrollWidth390. No provider upload/publish used. Not mounted A→B cookie proof or exhaustive responsive acceptance.
- First pre-review browser fixture was stopped before rebuilt dist; final fixture also stopped, exact roots absent, owned tabs closed and viewport reset. User App20+/1-, Vite5+ and untracked references excluded. Local implemented/verified slice only, not prepared/deployed to production or full-goal completion.
