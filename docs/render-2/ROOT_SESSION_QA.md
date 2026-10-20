# Integration 72 — root subscription and Login lifetime

Development only. This continues the active full Render 2.0 objective; it is not phase/master completion or production deployment. The prior turn made progress in local commit `9826d12`.

## Ownership and implementation

- Coordinator: document-local runtime access, React subscription hook, main/App/utils bridge, root/source contracts, principal HTTP extension, staging and docs.
- Hypatia: application runtime's legacy notifications and regression tests only.
- Carson: actual Login JSX, shared login-attempt coordinator and tests only.
- Beauvoir: independent frozen-source review; no confirmed P1/P2. Cookie activation not approved.

One runtime is installed before the real root; replacement is rejected. `useSyncExternalStore` observes stable snapshots. It never creates/disposes a controller on mount/cleanup. `getSesion()` returns the **exact** installed runtime session, including null while unauthenticated/pending; legacy parsing fallback exists only when no runtime was installed. Browser-mode `guardarSesion` refuses writes before touching Storage. The default main selection remains literal `bearer`.

App distinguishes pending/error from anonymous, canonicalizes aliases by captured observation rather than JWT presence, and keys Sidebar and operational Suspense by observation so another account cannot inherit page-local state. Existing routes, server permissions and DEV-only reference wrappers remain. Protected-page verification errors require explicit reload; this is not transparent revalidation/draft recovery.

Login remains mounted on `/login` across loading/error: otherwise its own cleanup would cancel the controller's login. Pending password/Google dispatch is blocked without rebuilding the attempt. The shared coordinator fences generation, mount, runtime and legacy baseline before accepting a response; browser mode accepts only the runtime's exact published session and never saves a bearer. Local cleanup aborts only the page attempt, not the global controller. Google load listeners/callbacks are cleaned or ignored after unmount. Errors use a bounded generic message, not raw server/provider detail. Real Google login is not tested.

Legacy same-document writes call `sync()`; a single document-owned native storage listener handles external changes of the existing session key (or storage clear). It rereads actual Storage, never adopts `event.newValue`. A separate `lastNotified` marker ensures a read before an event/sync cannot swallow notification, and reentrant sync cannot duplicate it. Browser mode installs no Storage listener and rejects legacy sync.

## Verified

- Frontend: **613 passed /0 failed /0 skipped**; tracked tests plus the two new test files, `/private/tmp/render2-root72-frontend-final.log`. Includes 17 runtime tests, 10 login-attempt tests and 5 new registry/source tests; these counts overlap, not additive.
- Backend discovery: **1325 passed /56 explicit opt-in skips /0 failed**, `/private/tmp/render2-root72-backend-final.log`.
- Principal HTTP/PostgreSQL: **19 passed /0 failed /0 skipped**, `/private/tmp/render2-root72-http.log`. New test drives the actual Login attempt helper through the existing runtime and principal password verification: Luciano login/read, then Franco publication with synchronous page cleanup. The verified session remains usable while the cleaned page neither saves nor navigates late; logout is confirmed. Node cookie jar and lock adapter remain simulations, not native cookie/Web Locks proof.
- Frontend build passed before browser/physical tests; `/private/tmp/render2-root72-build.log`. No rebuild under a running dist-serving harness. Source/AST checks do not prove mounted cookie-mode behavior.

## Actual browser walkthrough

Canonical built frontend served by isolated principal fixture `/private/tmp/render2-local-I0QzWH` at a dynamic numeric-loopback origin; no Preview/Sandbox. Only existing synthetic fixture logins were used.

1. On `/login`, submit incorrect synthetic password for `qa_franco`: generic failure appears, same form remains usable. Correct password then reaches loaded Franco Home.
2. Open a second owned tab using `/franco`: URL canonicalizes to `/inicio` (with editorial view query), with the same real fixture identity.
3. Logout through the second tab's actual account menu. Without a manual reload, navigation, or action in the first tab, **both** show `/login`; old owner panels disappear. This exercises native browser storage-event delivery to the mounted legacy root and subsequent auth redirect.
4. Login `qa_luciano` in the second tab: both observe Luciano; the first tab reaches ready personal Home without a manual action. Neither shows Finance/owner workload sections. This path includes ordinary auth document navigation and is not proof of cookie same-ID rebootstrap or a delayed-body race without document teardown.
5. At 390×844 in the second tab, Home is ready; DOM clientWidth and scrollWidth both 390, heading `Hola, Luciano.`. Evidence: `/private/tmp/render2-root72-franco-desktop.jpg`, `/private/tmp/render2-root72-luciano-mobile.jpg`.

Owned tabs closed and temporary viewport reset. Only the owned browser fixture process was stopped; exact generated root absence asserted. HTTP suites assert their own temporary root cleanup. No commercial data were created/changed and no user/provider accounts were provisioned.

## Preservation and remaining gates

App had preexisting 20 additions/1 deletion for local reference wrappers. Coordinator App changes were staged from HEAD separately; those exact user deltas remain unstaged alongside Vite's preexisting 5 additions and all untracked reference work. No overwrite, inclusion in the commit or removal of user work.

Profile is inspected but **not migrated in this batch**. Remaining: cookie-safe profile/photo update and reauthentication, other editor/upload mutation writers, draft/navigation recovery, explicit retry/refresh semantics, mounted cookie-mode A→B/same-ID observation and deterministic delayed response barriers, native Web Locks/cross-tab hints/crash/hung-cookie-writer and HTTPS/proxy acceptance. The current legacy session token is still in localStorage; no claim that browser auth is globally live or that XSS-readable token debt is solved yet.

Security guidance shaped original-runtime ownership, no cookie-mode Storage fallback and bounded errors. React guidance shaped stable external-store callbacks, key scoping and one listener per document. No dependencies/schema/environment changes, configured DB/provider access, push or deployment. Master goal stays active.
