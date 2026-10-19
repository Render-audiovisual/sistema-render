# Shared unsaved navigation — independent pure QA

## Coordinator integration verification — 2026-10-19

Implemented and locally verified within the limits below; not deployed and not a global data-loss guarantee. Four agents: Archimedes migrated Projects/8 tests, Herschel Productions+Feedback/12 tests, Wegener independent controller/17 tests, Darwin read-only final review/30 focused tests. Coordinator owned shared controller/hook/bootstrap/location helper, TaskDetail/new-task integration/6 tests, existing regression adaptations, isolated browser execution and integration documentation. Shared files had one integrator. No backend business implementation, schema, migration, configured database, authentication rules or financial permissions changed in this integration. Superpowers guided contract-first disjoint ownership and independent review.

Final automated evidence:

- `node --test backend/test/*.test.js`:1118 passed,29 explicit opt-in skipped,0 failed. Log `/private/tmp/render2-navigation-backend.log`.
- `node --test frontend/src/pages/*.test.js frontend/src/components/*.test.js frontend/src/shared/navigation/*.test.js`:334 passed,0 skipped/failed. This includes existing local-preview pure tests as regression only, not promotion of their implementation. Log `/private/tmp/render2-navigation-all-frontend.log`.
- `RENDER2_RUN_LOCAL_INTEGRATION=true node --test backend/test/render2-*.integration.test.js`:all22 actual principal HTTP/PostgreSQL suites266 passed,0 skipped/failed. Log `/private/tmp/render2-navigation-http.log`; owned ephemeral harnesses cleaned themselves.
- Vite production build130 modules; `git diff --check` passed. No build was replaced while the browser fixture was running.
- Final independent reviewer found no confirmed P1/P2 within the inspected delta; no global audit claim.

Actual Chrome built-principal browser used fresh guarded PostgreSQL `/private/tmp/render2-local-fIzf2u` on dedicated55627, HTTP loopback63205 and fictional `qa_franco`. No production/configured data or external account login. Fixture cleanup/absence verified. Browser-owned intermediate tabs were unmarked and eligible for automatic turn cleanup; viewport override reset.

Observed browser results:

1. Proyectos → Nuevo proyecto → type title → native Back → one confirm → dismiss: URL `/proyectos` and exact title remained.
2. A second native Back without a fresh page interaction left for Inicio without another confirm. This demonstrates a real coverage limit, not a guarantee. Consistent with the standard's browser-escape/noncancelable boundary, but event.cancelable was not captured, so its cause is not asserted as proven. No history go/replace trap was added.
3. Unsent new task → type title → Back → dismiss: title/route remained. Then manual owner-ID selection and actual create succeeded once, opened Task#1 without a phantom warning. Fresh direct-link tab displayed the same task from PostgreSQL.
4. Task comment → Back → dismiss: task URL and exact unsent comment remained. Separate fresh tab saved a comment; reload and asynchronous comment read confirmed it persisted. Clean close returned to the task list without warning.
5. Feedback draft → Back → dismiss: title and `/feedback?section=clients` remained. At390×844 the actual form and sticky controls were usable without document horizontal overflow; screenshot `/private/tmp/render2-unsaved-mobile.png`. Clearing the draft to baseline allowed clean close.
6. Nueva visita → type title → Back → dismiss: title and `/producciones` remained. Existing conservative production dirty latch still warns after manually reverting text; that preexisting behavior was not redesigned.
7. Dirty manual task/visit closes showed the expected single confirm, but after native accept the browser-control focus operation timed out. No second dialog was observed, but resulting close was not successfully verified. Do not treat that acceptance path as browser-passed based on pure tests; rerun it in a stable browser session. This does not by itself establish an application defect. Fresh-tab access and saved record/reload remained functional.

Not browser-verified in this delta: busy pending-write exits, existing delivery/correction dirty forms, native Forward cancellation, accept-discard after first canceled Back, Safari/Firefox/older engines, process/forced exits. Pure/source tests cover the shared mechanics and lifecycle, not those actual engine outcomes. No universal recovery of unsent drafts: they are in React memory, not server autosaved or browser business storage. Unsupported/noncancelable traversal can still lose them. All-form migration and durable draft recovery remain separate master work. Release must stage these browser paths and remaining migrations independently before authorization to deploy.

## Independent author handoff (historical)

READY, frozen: **author executed the exact pure suite:17 passed / 0 failed / 0 skipped**. This is not browser verification. Owned only new unsavedNavigation.test.js and this document; no other file edits, DB/server/browser startup or commit. UNSAVED_NAVIGATION_CONTRACT.md read completely. Pure module exports registerNavigationGuard(win,getStatus) and installUnsavedNavigation(win) with dispose() are coordinator-owned; tests do not implement a substitute guard.

```sh
node --test frontend/src/shared/navigation/unsavedNavigation.test.js
```

Seventeen pure tests use deterministic EventTarget/Event/window/Navigation mocks and existing actual location.js helper. Cases: one consolidated dirty confirmation and live per-attempt contexts; busy denies without dialog; accepted traversal performs no intercept/replay/history/popstate/storage/save/clear; rejected existing link helper preserves URL/history then explicitly accepted link runs once; clean/current URL no phantom prompt; native unload warning only; noncancelable/other navigation ignored; cross-document/origin uses native fallback; cancelable traverse governed by cancelable not canIntercept; unsupported Navigation API fallback; idempotent install/unsubscribe/dispose/reinstall; per-window isolation; invalid/throwing getter and unavailable confirm fail closed; arbitrary history.state/methods/scroll restoration untouched.

Assertions pin relative pathname/query/hash context, sorted lifecycle listener counts and absence of browser business storage access. Mock accepted traversal does not simulate browser committing location; it proves controller does not manually reissue the browser event. These tests do not certify mounted React latest-ref/StrictMode behavior or actual native cancelability on any engine.

Main browser checklist (not executed by author): built principal synthetic account; project dirty text→cancel Back preserves URL/text then accept Back; task content/delivery/correction draft and unsent new task; production/feedback dirty exits preserve draft on cancel; busy mutations deny; clean Back/Forward/reload ordinary routing; desktop/mobile390px bounds; native confirm dialogs only, no page-evaluate state injection. Confirm no duplicate prompts from migrated page listeners. Unsupported/noncancelable same-document traversal, forced exits, suppressed dialogs and older browsers remain explicit limitations; no history trapping/replace/go workaround. No backend/auth/schema, production/deployment or all-form/master completion claim.

Implementation file became available after authoring; the full exact suite ran against coordinator's actual unsaved.js and existing location.js. Syntax/diff checks also passed. No skipped substitute or broad assertions to hide absence. Main owns actual browser execution and global regression, both still pending in this document.
