# Integration 75 — auxiliary writers and shared dispatch preparation

## Team and scope

Coordinator: publication browser-fallback removal, physical persistence test, integration/docs. Carson: GoalTaskLink and adjacent tests. Hypatia: WilsonAssistant/WilsonConversations and adjacent tests. Beauvoir: independent frozen-source review, no confirmed P1/P2. Workers returned ownership. No server/App/shared-runtime/CSS modifications; preexisting user changes excluded.

GoalTaskLink captures the original genuine session at dialog opening for lookup and explicit POST. Task ID, piece ID and both CAS timestamps preserved; task/account change and cleanup fence requests/effects. Wilson uses keyed session views and original scopes for conversation, notifications, messages, manual production confirmation and read ACK. Busy refs prevent double mutation; conversation/person generations fence stale selection results. Admin reset remains explicit; it was not exercised against real data. Position remains a noncritical browser preference; confirmation tokens are operation IDs, not authentication.

## Removing a parallel operational source

PublicationComposer formerly converted API404/503 into browser-only simulated saves and advertised success. It now propagates failure, never reads/writes that operational fallback, rejects non-array queue responses and displays API draft errors. Old browser copies are NOT deleted or automatically imported. Existing server dispatch tables remain shared; outbound destinations remain `simulada`/previewOnly and no Meta publishing is enabled. This batch does NOT migrate all composer callbacks/uploads to captured bindings or validate every DTO field. Those and raw-fetch editorial screens remain next gates.

## Verification

- Frontend725 passed, no failures/skips: tracked suite plus new GoalTaskLink9, Wilson22 and dispatch4 tests. Actual extracted callbacks cover late A→B/unmount/StrictMode, selection races, duplicate writes, session failures and preserved CAS. Not mounted cookie acceptance.
- Backend1336 passed,57 opt-in skips,zero failures. Initial run overlapped Vite dist replacement and startup import observed missing dist/index.html; reran AFTER build completion, all passed. This is documented orchestration evidence, not a production bug claim.
- New opt-in actual HTTP/PostgreSQL suite1 passed: owner creates draft, another owner reads/schedules same record, duplicate request key stays one row, ordinary employee GET/POST403, invalid-client404 creates no record, editorial piece unchanged. No external provider request. Fixture cleanup/root absence asserted.
- Production build and diff check pass. Logs `/private/tmp/render2-aux75-{frontend,backend-final,http,build}.log`.
- Actual final default-bearer UI: synthetic Franco creates draft with copy, reloads, selects Borrador#1 and recovers exact text. Screenshot `/private/tmp/render2-aux75-draft-reloaded.jpg`. Temporary browser tab closed and root `/private/tmp/render2-local-tJn9kC` absent. No mounted Wilson interaction/Goal link transition proof this batch.
- Read-only mobile review did NOT confirm the previously suspected narrow-panel defect from screenshot74 (full-width panel/padding16 in source). No speculative CSS override added; complete responsive acceptance remains open.

## Status and remaining risks

Local implemented/verified slice only. Global cookie mode OFF, legacy bearer/localStorage default unchanged. Composer/editorial raw fetch, remaining editor/form inventory, draft recovery, native locks/cross-tab/crash/HTTPS/proxy acceptance, provider acceptance and premium design unification still required. No configured database/provider, actual account/commercial data, environment/dependency/schema changes, push/deployment. Goal remains active; not deployment-ready.
