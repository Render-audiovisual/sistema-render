# Integration81 — client administration session adoption and history-safe deletion

## Ownership and boundaries

Carson owns Clientes.jsx/admin session tests; Hypatia owns ClienteModals.jsx/modal tests; coordinator owns shared useScopedRequest hook, canonical overview loader/tests, deleteEmptyClient/server route, real principal QA and integration. Beauvoir independently reviews contracts and frozen source. App20+/1-,Vite5+ and untracked reference work excluded. No configured database/provider, real commercial records, migration/dependency/environment, push or production deployment.

## Shared frontend contract

useScopedRequest retains the genuine session object, exact account/context observation and layout-mounted lifetime. Actions are invalidated on identity/context ABA or unmount; same-identity lifetime guard permits busy cleanup only. It is continuity protection, not server authorization. Overview now accepts capture() and consumes canonical parsed API arrays; obsolete bundles are discarded, typed authorization/session errors preserved and current generic errors bounded. No task-completion shortcut supplies publication evidence.

Page and modal writers use immutable serialized intent, original session/context, ref-based duplicate/close fences and validated ACKs. Polling defers while create/detail/edit is open, never replacing a held draft. Create uncertainty preserves draft and requires review rather than automatic retry. Multi-step configuration/activation/next-fee operations remain separate transactions: the UI reports stages already committed and later failure honestly; it does not claim rollback or continue under a new actor. Config ACK is a delta; next-fee ACK uses cliente_id/importe/vigente_desde, not a full client snapshot.

Two additional verified/reviewed issues prompted fixes before integration: deep-link reload restored a raw client rather than the enriched monthly row (incorrect story quota/status); monthly edit used the current month regardless of selected historic cohort. Restoration now uses the same enriched row as the card and retains it during modal polling. Selected periodo is passed through nested editors, shown explicitly, used for monthly configuration writes, and checked against ACK effective dates. Legacy/shared next-fee remains next SERVER month, not selected historic month. Legacy designer-name configuration remains business labeling, not authentication or ID migration.

## Server deletion boundary

Old DELETE counted five UI-related tables then deleted outside a transaction; it missed cascading configuration/fee history and allowed a child-insert race. deleteEmptyClient explicitly locks public.clientes FOR UPDATE inside READ COMMITTED, inspects all catalogued incoming FK relationships as subsequent statements, and rejects any linked record with409. Identifiers are schema-qualified/quoted, values parametrized. Composite/nonpublic relationships fail closed for review,23503 becomes safe409. Only a client with no inspected references is deleted; no FK/schema/backfill changes. Existing requireRole(admin) retained. Prefer deactivation to preserve history.

This does NOT discover convention-only/JSON/external relationships, concurrent DDL, privileged trigger bypass, or solve last-write-wins configuration/fee edits. Those are explicit gates, not covered by session binding. New records in the physical tests are disposable and local only.

## Reproducible physical tests

```
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-client-admin.integration.test.js test/render2-goals-content.integration.test.js
node --test test/*.test.js
```

Principal HTTP/PostgreSQL19 pass/0fail/0skip: independent owner persistence, employee financial redaction and forbidden create/config/activation/fee/delete, delta/config/activation/next-fee contracts, truthful partial commit, historical vs current cohort separation, fee/config retention, dynamically added FK protection, empty-client removal/404/invalid IDs, earlier child insert makes DELETE wait then409, later insert cannot slip into cascade, composite/other-schema fail-closed retention; prior goal ID-scope/CAS/approval rules still pass. Fixtures assert generated roots absent. Initial synthetic fee seed used current_date rather than first-of-month and failed the actual schema check; corrected fixture only, not schema.

## Final verification and cleanup

Frontend853 pass/0fail/0skip (35 modal callbacks,9 page callbacks,3 shared hook cases and14 overview tests included; not additive). Backend1385 pass/61 explicit opt-in skips/0fail. Production build and diff check pass. Existing overview source contracts now require captured scope/generation checks and memoized loader cleanup; parsed-request tests retain cancellation, all-or-nothing, malformed response and obsolete-result behavior, plus account/typed-error tests. No mounted React claim for extracted callback tests. Independent frozen review found the period issue resolved and no new confirmed P1/P2 in the bounded fixes.

Logs `/private/tmp/render2-clients81-frontend-final.log`, `/private/tmp/render2-clients81-backend-final.log`, `/private/tmp/render2-clients81-http-final.log`, `/private/tmp/render2-clients81-build-final.log`.

Initial mounted edit of current client2→3reels succeeded and persisted, but deep-link reload showed stories0/0 instead of8; that attempt is diagnostic evidence, not final acceptance. Its fixture/tab stopped before rebuilding. Final fresh fixture seeded October2026 quota2/fee12345 and February2020 quota7/fee15001. Franco opened the historical direct-link detail: stories0/8 and matching quota/status. Nested editor visibly showed selected2020-02 and effective2020-02-01. Editing7→8reels, saving and reloading preserved8reels/stories8 and selected period. A separate actual Agustín HTTP login confirmed current October quota2 and fee12345 unchanged. No financial amount belongs to a real client.

Final desktop/mobile screenshots `/private/tmp/render2-clients81-final-desktop.jpg`, `/private/tmp/render2-clients81-final-mobile.jpg`; mobile visually inspected, document width/scrollWidth390 at390×844. This is bounded detail acceptance, not all mobile interactions, native month picker/confirm rejection or session replacement in mounted cookie mode. Both owned tabs closed, viewport reset; original PTYs stopped and exact roots `/private/tmp/render2-local-iR7VIF` and `/private/tmp/render2-local-wo9hoX` checked absent. No broad process kill or recursive user-data cleanup.

Local implemented/tested only. Configuration/fee optimistic concurrency, uncertain-transport durable create receipts, legacy designer-ID migration, global draft/navigation recovery, cookie activation and full native/proxy/device/provider/design acceptance remain gates. No claim of production readiness, deployment or complete master phase.
