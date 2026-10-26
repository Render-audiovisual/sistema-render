# Production results across operational projections — QA401

## Scope

After QA400's two native snapshots, verify that later edits and their replacement journal also propagate correctly through the actual task context, client operation hub, shared Reports API and frontend report projection. Keep Calendar tied to the visit date, not journal dates. No new business rule, UI/backend implementation change or new module.

Main extends the existing opt-in render2-production-results.integration.test.js. The same canonical server and disposable PostgreSQL fixture are used, not mock report rows. Its existing scenario edits a pending video to repetir and changes its script, then explicitly appends a new result. The new helper checks both intermediate and final evidence for owner91001 and employee91003.

## Assertions added

- Visit detail, source task context, client operation and Reports agree on exact result UUID, source/result revisions, timestamp, partial flag and vigente.
- The real pure frontend buildProductionRegistryReport consumes that HTTP response: reports Resultado desactualizado before the second result and Resultado parcial registrado afterwards. Media UUIDs stay identical. This is not native browser/React mounting evidence.
- Calendar exposes exactly one visit event at its visit date with null publication evidence. No journal append creates a publication event.
- All109 public-table JSON/xmin/ctid hashes remain identical around the owner/employee GETs and pure projection. Existing journal replay/recovery/immutability/concurrency tests are retained, not replaced.

## Verification

Expanded physical file18PASS/0FAIL/0SKIP,2.52s, own fixture cleaned (/private/tmp/render2-goal401-production-projections.log). Deliberate injected RAISE in its existing rollback case remains an expected failure assertion, not an unhandled test failure. Backend2682PASS/178opt-inSKIP/0FAIL of2860, terminal0 (/private/tmp/render2-goal401-backend.log). Final integrated39-file cohort358PASS/0FAIL/0SKIP,86.73s, terminal0 (/private/tmp/render2-goal401-core.log); fixtures cleaned by their own hooks.

Harvey independently checks test-oracle scope. Read-only sidecar reviews:57frontend+21backend pure checks on navigation/permissions;51project/task/approval checks, all passed. Neither agent confirmed a new P1/P2 in its bounded scope. This is not a global absence-of-defects or all-role acceptance claim. Historical findings were not reopened solely from old documentation.

Harvey's commands from repository root (tool output only, no separate log): node --test frontend/src/shared/navigation/login-destination.test.js frontend/src/shared/navigation/location.test.js frontend/src/components/navigation.test.js frontend/src/features/drive/upload-navigation.test.js frontend/src/pages/profileSiblingDraft.test.js; and node --test backend/test/user-catalog.test.js backend/test/client-catalog.test.js. Final independent review of the32-line test delta found no concrete P1/P2.

Superpowers keeps scope and evidence aligned. No frontend rebuild/visual acceptance renewed here; product build remains QiAl1qiE from400. No existing database, real account, provider, deployment or push. Render2 master remains open, including real identities/provisioning, deployment conditions and native acceptance gaps. Next safe preparation targets Mi lista lost-ACK recovery; a prepared fixture is not a completed test.
