# Integration 71 — document-owned application session runtime

Historical evidence below describes integration71, not today's entrypoint. Integration124 at the end records the canonical browser cutover; do not use the older bearer wiring as current architecture.

Local only. The previous integration was progress (commit `108e86e`); this batch continues the same full Render 2.0 objective, without marking it achieved.

## Implemented

- Hypatia owns `frontend/src/shared/session/application-session.js` and its tests. The coordinator owns `main.jsx`, entrypoint/source contracts, principal HTTP extension and these docs. Beauvoir independently reviewed the frozen runtime and tests without confirmed P1/P2.
- One factory composes the existing bearer transport or browser store/controller/transport. No separate app, substitute auth implementation or new dependency. Main constructs one instance outside React StrictMode and assigns its fetch to `window.fetch`.
- Main explicitly selects **bearer**, preserving existing Login/App/utils behavior. No public cookie-mode flag is added. Browser mode rejects API-base redirection, requires the existing lock manager contract and does not consult Web Storage. Browser controller lifetime is document-owned, not Login-page-owned.
- `start()` is **initial-only**: one Promise installed before synchronous subscriber reentry, cached even on failure. It is not refresh or current identity. After login B, its old result A must never be restored; `getSnapshot()/getSession()/subscribe` are the authority for current observations. A separate retry/revalidation design is still required for the actual cutover.
- Subscribers unsubscribe independently; global disposal removes runtime subscriptions and cancels the controller. It is not a verified server logout. Legacy subscriptions emit only after fetch, not on login/logout/storage events; do not present this as a complete reactive provider.

## Tests and evidence

- Frontend: **591 passed /0 failed /0 skipped**, tracked tests plus two new files. Ten runtime tests exercise actual composed controller/store/transport with synthetic responses and simulated FIFO locks; one entrypoint AST test proves module-level construction before the real StrictMode root, literal bearer mode and a single fetch installation. Logs `/private/tmp/render2-runtime71-frontend.log`, `/private/tmp/render2-runtime71-focused.log`.
- Backend discovery: **1325 passed /56 explicit opt-in skips /0 failed**, final result in `/private/tmp/render2-runtime71-backend-final.log`.
- Isolated principal HTTP/PostgreSQL: **18 passed /0 failed /0 skipped**, log `/private/tmp/render2-runtime71-http-verified.log`. The new runtime test bootstraps Luciano, logs in Franco, reads real personal Home with unchanged business-table digests, logs in Agustín, proves the old guard returns no result and sends zero requests, then logs out. Uses actual principal password verification and a Node cookie jar/simulated lock adapter, not native browser cookie/Web Locks proof.
- Production frontend build passed; `/private/tmp/render2-runtime71-build-final.log`.
- First HTTP attempt had an incorrect test assertion: the existing stale editorial guard returns `undefined`, not rejection. Corrected to require `undefined`, invalid guard and no dispatch. A second run raced Vite's dist replacement and failed while reading `dist/index.html`. Final run was executed **after** build, passed, and cleaned every owned fixture. Do not run build and a dist-serving harness concurrently.

## Actual browser walkthrough

Used CUA against the canonical built frontend served by the guarded disposable principal backend, not Preview/Sandbox. No CLI/browser dependency installed. Only synthetic fixture accounts/data were used; no real Google/Drive/account flow was performed.

1. Initial build, fixture `/private/tmp/render2-local-h4j4s9`: login `qa_franco`; create `QA71 tarea exclusiva de Franco` as task #1 assigned to stable ID 91001; open detail; return to Home. Home shows one assigned task and one open/undated task. Reload retains that data. Logout through UI and login `qa_luciano`: personal Home shows zero own tasks, no Franco task, no Finance link or owner workload/escalation sections. This ordinary logout/login unmounts the document and is **not** proof of mounted memory A→B or deferred-response fencing. Screenshots `/private/tmp/render2-session71-franco-desktop.jpg`, `/private/tmp/render2-session71-luciano-mobile.jpg`.
2. At 390×844, Luciano Home and navigation to Feedback render and show actual empty editorial-review DTOs. The menu closes after navigation. A later Feedback reload was observed during its lazy-loading state only; final loaded post-reload state is not claimed.
3. Final build **after main runtime wiring**, separate fresh fixture `/private/tmp/render2-local-oPoicW`: login Luciano on desktop, Home ready; reload keeps user/Home ready; change viewport to 390×844. DOM measurement: document clientWidth 390, scrollWidth 390; heading `Hola, Luciano.`. Screenshot `/private/tmp/render2-runtime71-final-mobile.jpg`. This proves the legacy/default entrypoint import graph and limited responsive view, not all modules/devices or cookie activation.

Both owned browser tabs closed; temporary viewport reset. Both browser fixture processes stopped normally and exact root absence asserted; their synthetic task disappeared with the disposable database. HTTP fixtures also assert removal. No other processes/tabs or user data removed.

## Still open before activation or deployment

- App subscription and loading/error/anonymous handling, exact runtime DTO access through utils, real Login/Profile/logout adoption and safe form/upload mutation intents.
- A→B and same-ID rebootstrap **without document teardown**, deterministic delayed-response browser barriers, draft/navigation preservation and refresh/retry UX.
- Native Web Locks/cross-tab hints/crash/hung network and HTTPS/proxy acceptance; real independent owner-account verification and remaining master phases.
- Preexisting App20+/1-, Vite5+ and untracked reference work remain untouched/excluded. No configured DB/provider/environment/schema/dependency changes, push or deployment. Not production-ready; master goal remains active.

Security guidance kept browser mode Storage-free and same-origin; structured ownership isolated shared entrypoint changes. Browser QA deliberately separates observed behavior from unproven mounted/cookie behavior.

## Integration124 — canonical cookie transport

The operational `main.jsx` now chooses browser mode only. No public toggle silently restores bearer and no separate application is introduced. The server's explicit opt-in remains deliberate: operators must configure `RENDER_BROWSER_SESSIONS=true`, exact `RENDER_BROWSER_ORIGIN` and HTTPS for a coordinated authorized release. This source change does not configure or deploy a hosting environment. `VITE_API_BASE` must be empty; a foreign base or missing Web Locks fails closed with an actionable startup screen. Network bootstrap failure uses App's existing verification screen.

The document-owned runtime is installed before React StrictMode; Login/Profile, captured requests and mounted editors consume it. The historical `render_sesion` key is removed without reading its contents. No drafts/preferences are deleted and no token property is fabricated on cookie DTOs. Bearer API/adapters remain for explicit non-browser compatibility and regression tests, not a second canonical browser mode.

PersonalLists now captures a genuine binding once per component lifetime, preserving queued intent/CAS/abort guards without requiring `.token`. Productions captures a request before awaiting its write; write/readback/conflict observation use that same identity and context. Parent App's session-observation key remounts editor trees on account/bootstrap changes; token-only child key labels are not relied on to authorize requests.

Cross-document coordination uses a single advisory BroadcastChannel with only `{reason:'login'|'logout'}`. Receiving a valid hint cancels local publication and withdraws pending/current observation; it never adopts a message DTO, automatically bootstraps a new account or rebroadcasts invalidation. Cookie-setting requests retain the shared Web Lock until their network result resolves even when local publication is canceled. Hint delivery is best effort if the browser cannot provide the channel; server exact-context/CSRF and response/body fences remain mandatory. This is not guaranteed crash/offline/hung-request recovery.

Logout revokes the actor's existing server epoch, deliberately affecting that account's other sessions of the epoch. It does not clear cookies with a delayed Set-Cookie response that could overwrite another login. Other accounts are not revoked. Shared cookie state means tabs in one browser origin are not simultaneous independent account containers: account changes withdraw old views rather than mixing their data. Separate identities are verified accounts; separate private-browser profiles/devices can use their own cookie jars.

No new migrations/dependencies. Production deployment additionally requires verified public origin/TLS/reverse proxy, approved account/provider onboarding and backup/restore/rollout. Native local acceptance uses only the restricted numeric-loopback dev cookie, not proof of HTTPS Secure/__Host enforcement in hosting. Actual Google/Drive provider authentication remains unverified. See MASTER_LOCAL_ACCEPTANCE and STATUS for final test counts and temporary native evidence.
