# Integration 70 — existing React session views

Local development only; not cookie cutover, production deployment or master-goal completion.

## Ownership and implementation

- Coordinator: shared `session-view`/hook, publication-control key, API body error propagation, integration tests and documentation.
- Carson: Home editorial/escalations/team/monthly-production and piece-detail JSX wrappers, source/AST regression contracts.
- Hypatia: QuickHome, Feedback inventory and bound personal-home loader/tests.
- Beauvoir: independent frozen-source review; no confirmed P1/P2 in this scope.

The shared hook memoizes complete legacy identity primitives, avoiding reload loops when legacy session JSON is parsed again. Cookie views retain the exact registered DTO and receive an opaque per-observation React identity. No cookie token placeholder is reconstructed. Copied or stale cookie observations cannot acquire a valid binding.

Existing effects retain abort/dispose, scope matching, pagination, filters and refresh deferral while a publication editor is open. Personal Home validates its captured binding before dispatch and after response, and parses only the expected user's closed DTO. Its userId-only pure-loader API remains for compatibility; the actual QuickHome supplies the bound session. API JSON parsing no longer converts typed stale-session errors into successful empty objects/pages. Legacy malformed-JSON behavior is unchanged.

## Reproducible verification

- Canonical tracked frontend tests plus the four new test files: **580 passed, zero failed/skipped**; final run in `/private/tmp/render2-session-view-frontend-final.log`.
- Backend discovery: **1325 passed, 56 explicit opt-in skips, zero failed**; `cd backend && node --test test/*.test.js`; log `/private/tmp/render2-session-view-backend-final.log`.
- Frontend build: `cd frontend && npm run build`; log `/private/tmp/render2-session-view-build.log`.
- Isolated physical tests: `cd backend && RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-browser-client.integration.test.js test/render2-personal-list-persistence.integration.test.js`; log `/private/tmp/render2-session-view-http.log`.

Physical run: 17 passed, zero failed/skipped. The existing cookie/principal read loop now includes personal Home alongside five existing Home/Feedback loaders, using real password authentication, HTTP DTOs and a fresh guarded PostgreSQL fixture. Full-table digests remain unchanged across reads; other tests retain list CAS/identity/reorder coverage. Cookie storage in that suite is a simulated Node jar, not native browser proof. Every owned fixture is stopped and its directory removed/asserted by cleanup.

The new focused tests exercise stable inputs, exact cookie DTO ownership, independent stores, late successes/errors, same-ID rebootstrap, disposal and stale JSON-body errors. JSX checks use source/AST; one hook test uses React SSR. Neither proves mounted effect/rerender behavior.

## Acceptance boundary and remaining work

- No fresh desktop/mobile screenshot or mounted A→B/rebootstrap acceptance in this batch. That gate remains mandatory before cookie activation.
- Monthly-production preload provenance is enforced by its scoped QuickHome parent, not an independent provenance token in the child. Do not reuse it with arbitrary cross-user preloads.
- Root main/App/Login/utils/Profile, uploads and other editors/forms still require coordinated adoption. Current app remains legacy bearer/localStorage by default; browser-session flag remains off.
- Same-context refresh, unsaved-draft recovery/navigation, native Web Locks/cross-tab hints, page close/crash/hung-cookie-writer and HTTPS/proxy acceptance remain open.
- No configured database/provider/environment/schema/dependency changes, no real-account provisioning, migration, commercial-record changes, push or deploy. Preexisting App/Vite and untracked reference work are excluded from the commit.

Security guidance shaped original-observation retention and fail-closed checks; React guidance shaped complete stable hook dependencies; structured multi-agent ownership kept shared files under one integrator. No redesign or expansion of server permissions was introduced here.
