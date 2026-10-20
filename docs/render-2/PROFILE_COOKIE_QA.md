# Integration 73 — captured Profile operations and verified photo refresh

Local development only. Prior turn was progress (`d0826d9`); the full Render 2.0 objective remains active. No cookie cutover, production deployment or real-account changes.

## Ownership and behavior

- Main: profile guard and cookie tests, closed browser `/api/sesion` photo projection, backend callback tests, physical suite extension, bounded error messages and docs/integration.
- Hypatia: browser controller/runtime refresh and local invalidation plus tests.
- Carson: existing Perfil JSX and actual callback/source tests; main integrated final error wording.
- Beauvoir: independent frozen-source reviews, no confirmed P1/P2; no approval to activate cookie mode.

All three existing Profile writes now pass through a captured binding and guard before/after dispatch and JSON. Legacy bearer behavior remains; cookie mutations carry the original genuine intent/context/CSRF, never a fake token. A stale/unmounted operation does not repaint, save credentials or navigate another identity.

Cookie photo commit validates the returned identity, then reobserves the server under the original session ID/context/CSRF/role. It never creates a cookie DTO from a PATCH response or writes Storage. Refresh rechecks the genuine intent **after obtaining the cooperative lock and before publishing loading**; if another observation appeared while queued, it returns obsolete without HTTP or clearing B. Loading intentionally remounts Profile; page cleanup does not abort the global refresh. Other unsaved profile fields block a browser photo action, all controls disable while an operation is pending, and an imperative busy ref blocks same-turn duplicate dispatch.

Credential success withdraws only the captured local observation because the backend already revoked its epoch. It does not make an extra logout call that might revoke B. Navigation also checks the exact post-invalidation revision, including synchronous subscriber reentry. Other form/navigation/draft workflows are not declared complete by this profile-specific protection.

## Actual backend gap fixed

Physical testing exposed that photo PATCH saved `foto_perfil`, but browser `/api/sesion` returned only the authorization DTO, which omitted it. Browser bootstrap now queries the saved profile by verified ID/session_version/active, emits only `{id, usuario, nombre, rol, foto_perfil}` and preserves no-store/context/CSRF. Missing epoch returns401 and removes confirmed-context proof; DB errors have no stale auth fallback. Bearer bootstrap is unchanged and adds no query. The general authentication middleware was not expanded.

Actual callback tests execute the route with an injected pool and verify the closed projection excludes extra hash/financial fields, null/new photo, missing epoch and DB failure. This is not physical proof of a race between the two identity queries; physical CAS coverage remains separately identified.

## Verification

- Frontend **640 passed /0 failed /0 skipped**: tracked tests plus `profile-session-cookie.test.js` and `profile-ui-session.test.js`; `/private/tmp/render2-profile73-frontend-verified.log`.
- Backend **1329 passed /56 explicit opt-in skips /0 failed**: `node --test test/*.test.js`; `/private/tmp/render2-profile73-backend-verified.log`.
- Physical HTTP/PostgreSQL **45 passed /0 failed /0 skipped**: `RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-browser-client.integration.test.js test/render2-browser-controller.integration.test.js test/render2-browser-sessions.integration.test.js test/render2-profile-session.integration.test.js test/render2-personal-list-persistence.integration.test.js`; `/private/tmp/render2-profile73-http-verified.log`.
- Production frontend build passed after final UI/helper changes; `/private/tmp/render2-profile73-build-final.log`. Diff check passed. Initial physical test correctly failed on missing bootstrap photo; it was not counted as passing before the endpoint fix.

The new physical profile test uses actual principal password verification, HTTP routes and a fresh guarded PostgreSQL fixture. It saves and verifies a photo, removes it then deliberately fails the confirming GET with a synthetic503, proves the successful removal remains committed, and recovers by explicit login. It verifies wrong current password leaves the session usable, username change revokes the epoch, login with the renamed account works, password change requires reauthentication, new credentials work and stable user ID stays91001. These credential changes occur only in disposable synthetic accounts. Existing profile suite retains row-lock CAS, cross-account and logout coverage. Node jar/lock manager are simulations, not native cookie/Web Locks acceptance.

Bounded Spanish UI errors no longer expose raw network/SQL detail or claim an uncertain write was rolled back. Known wrong-password and image-read errors retain useful wording. No automatic replay is introduced.

## Browser QA and honest limitations

- First unused fixture `/private/tmp/render2-local-9F2ESX` was stopped and removed before the server projection change.
- Canonical built app at fixture `/private/tmp/render2-local-YudrGC`: synthetic Designer login and Perfil rendering worked. A file chooser attempted to use a prior **synthetic QA screenshot**, not user data, as the profile image. The tool interaction took about1674seconds; the fixture's ten-minute lifetime expired. UI showed `Failed to fetch`; process exit0 and exact root absence were confirmed. **Browser photo upload/persistence is not verified.** No retry/upload-success claim; evidence `/private/tmp/render2-profile73-upload-unconfirmed.jpg` predates the bounded error wording fix.
- Fresh final build/fixture `/private/tmp/render2-local-T6DyIw`: Designer login, loaded Perfil on desktop, expansion of the username form without entering/changing credentials, and ready mobile layout at390×844. Measured clientWidth=scrollWidth=390. Screenshots `/private/tmp/render2-profile73-final-desktop.jpg`, `/private/tmp/render2-profile73-final-mobile.jpg`. No file chooser repeated.
- Owned browser tabs closed, viewport reset, final process stopped and exact root absence asserted. Physical suites assert cleanup of every owned fixture. No shared/foreign process or user record removed.

## Shared credential policy and typed profile inputs

The canonical account-creation and self-password-change paths now import the same pure public contract, `shared/password-policy.mjs`. Perfil imports it too: the old four-character client rule is gone. New passwords require at least12 Unicode code points and at most72 UTF-8 bytes; NUL, unpaired surrogates and whitespace-only values reject. Inputs are neither normalized nor trimmed. Existing login and current-password verification retain the prior nonempty/1024-byte acceptance, including short historical passwords. No existing password is rewritten or automatically rotated.

All three self-profile bodies are closed and typed. Photo removal needs an explicit empty string or null, not a malformed or omitted value. Current login labels remain exact consistency echoes, never database target selectors; writes still select authenticated ID and current active session epoch. New login labels are trimmed, bounded to128 code points and320 UTF-8 bytes and reject controls, matching the login byte limit; account creation and admin identity edits use the same bounds. Photo validation remains the existing data-image prefix and size bound, not verification of decoded image content.

The profile client accepts credential success only after validating the ACK: username requires the held ID, requested login and held role; password requires `ok === true`. Unexpected or late replies do not clear fields or announce success. Known validation codes map to fixed local text; arbitrary server diagnostics are not reflected. Existing session fencing, current-password error handling and exact-intent reauthentication are preserved.

### Verification of the credential contract

Final frontend1091 pass; backend1429 pass/67 opt-in skips; actual sequential HTTP/PostgreSQL59 pass across `render2-profile-input`, `render2-profile-session`, `render2-browser-client`, `render2-user-administration` and `render2-user-revisions` (all `.integration.test.js`). Physical command from backend: `RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1` followed by those five files. Frontend uses `node --test`, backend `npm test`, and build `npm run build` from frontend. Build and diff checks passed.

Physical cases cover malformed/missing/extra fields without writes; exact Unicode, byte and space boundaries; historical short-password login and deliberate rotation; ID/history preservation; revocation of older sessions; new-credential login; and two credential changes from the same epoch with one success/one401 after observed row-lock barriers. Cookie/browser-controller regressions are actual HTTP with the existing simulated cookie jar/lock manager, not native cookie acceptance.

Four packaging tests verify policy acceptance parity, browser/backend direct imports and an isolated copy/import of the public `.mjs` file. The Hostinger copy list now includes root `shared` alongside backend source. The real packaging script was not executed: it removes `hostinger-dist` and runs an installer. No build script touched user output or installed dependencies. A backend-only upload without `shared` is not a valid deployment of this code.

Read-only browser QA used synthetic Luciano QA, opened Perfil through its account menu, expanded the empty password form and checked desktop/mobile390×844. The employee menu contained Perfil and logout, not administrative management or Finance. Document width remained390. No new credentials were entered or submitted through browser UI; credential changes were executed only by terminal tests against disposable synthetic accounts. This is not a claim of native credential-change UX acceptance. Fixture `/private/tmp/render2-local-z89UtZ` was stopped/removed, tab closed and viewport reset.

Logs: `/private/tmp/render2-profile87-http-final.log`, `/private/tmp/render2-profile87-backend-final.log`, `/private/tmp/render2-profile87-frontend-final.log`, `/private/tmp/render2-profile87-build-final.log`. Screenshots: `/private/tmp/render2-profile87-desktop.png`, `/private/tmp/render2-profile87-mobile.png`.

## Remaining gates

Cookie mode remains disabled in main. Profile is implemented and headless/HTTP verified for both transports; native browser cookie Profile remount, upload happy path, credential UX and unsaved-navigation behavior still need acceptance. Other editors/uploads, explicit refresh/draft recovery, native locks/hints/crash/hung-cookie-writer/HTTPS/proxy and the remaining full master phases remain open.

Root `shared` must accompany the backend during coordinated rollout. Cross-column login-namespace uniqueness and throttling of authenticated current-password verification remain separate review items; this policy/input work does not certify either. No secure-recovery provider or real account provisioning was enabled.

No configured database/provider, real account, migration/schema/dependency/environment change, push or deployment. Preexisting App20+/1-, Vite5+ and untracked references are untouched and excluded. Security guidance shaped exact-intent refresh/invalidation, closed DTOs and honest uncertain-write errors; structured ownership prevented simultaneous shared-file edits. Not deployment-ready or full-goal completion.
