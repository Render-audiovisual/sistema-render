# Legacy routes — independent bounded source QA

Scope: Worker C authored only `frontend/src/components/legacyRouteIntegration.test.js` and this document. No App/helper edits, services, database, browser, or commits. Read the complete updated `LEGACY_ROUTES_CONTRACT.md` before revising.

## Inventory hold overrides blanket cutover

Blanket retirement is NOT approved: B1 coordination write controls and B3 leader escalation queue remain unresolved. `/lider`, `/augusto`, `/luciano`, `/german`, `/oriana` must remain unmapped by the helper, including with task context, and keep existing lazy imports/render branches under existing permissions. This does not expand access.

Only already-deprecated `/agustin`, `/franco`, `/piezas`, `/wilson-conversaciones`, `/equipo` are approved for safe canonicalization. Main's readonly recorded-context viewer addresses B2 metadata visibility; Main owns its integration test and runtime verification. It does not supply B1 writes or B3 triage, replace existing brief/Drive/visit/review mechanisms, or authorize retirement. Full single-principal consolidation remains future gated work, not completed scope.

## Source gate

Run from repository root:

```sh
node --test frontend/src/components/legacyRouteIntegration.test.js
```

Tests parse actual App JSX with the installed TypeScript parser; no alternate resolver is implemented. They check real helper imports, full reactive route input (including query/hash), unconditional hooks before conditional returns, token-and-destination-gated replacement with reactive dependencies, anonymous/root handling before the alias loading guard, permissions/mount ordering, retained five dashboard imports/mounts, removed approved-alias render/reload branches, current-session personal home, retained canonical workspace task query and shared navigation, and retained DEV wrapper gates. Identifier names for destination/token are discovered rather than hardcoded; whitespace is not significant.

These are structural source contracts, not React mounts or behavioral proof. In particular they cannot establish browser history ordering, canceled traversal behavior, provider/session validity, authorization, rendered equivalence, runtime task loading or build chunk reachability. Helper policy correctness belongs to Worker A's real-helper tests, not a second resolver embedded here.

Additional checks import the real shared helper (never a substitute): the five held dashboard routes must return null, including with task/filter context. Approved aliases exercise valid task forwarding, stripped identity/scope filters, duplicate/zero task rejection, team reports, canonical no-ops and unknown paths. These are pure-helper examples, not browser navigation validation.

App initially retained the five dashboards (now explicitly required) but still used approved-alias reload branches without canonical integration. Failures on missing Main integration or an overbroad helper must remain visible, not be skipped or relabeled as approved retirement. Results must be rerun against Main's final restricted integration.

Latest bounded run after concurrent Main integration: **8 tests passed, 0 failed**; the actual helper leaves all five held routes unmapped and App retains their imports/mounts. Scoped diff whitespace check passed. No runtime/navigation validation was performed by Worker C.

## Main-owned runtime and release gates — not executed by Worker C

Main follow-up: added ninth source test requiring subscription before replacement after independent review/browser reproduced initial-load deadlock. Final full frontend suite: 392 pass; backend: 1129 pass/30 skip; build pass. Bounded synthetic-owner browser task/reload/mobile/current-identity evidence is recorded in STATUS integration 30. Remaining gates below are not implied complete.

- Keep the five dashboards live while B1/B3 remain unresolved; retain source/reference files and preexisting DEV changes. Any missing capability blocks retirement.
- Run helper tests, these integration source tests, full frontend/backend pure suites and production build. The five held dashboard chunks/imports must remain; absence is not a success condition for this scope.
- Use only the guarded fresh PostgreSQL fixture and fake identities with the final built principal. No configured/production environment.
- Anonymous approved aliases must follow existing login handling without changing identity. Authenticated `/agustin` and `/franco` must reach current-identity `/inicio`, never impersonate their former names. Under existing authorized access, verify all five held dashboards still render, including B1 coordination writes and B3 leader escalation; their task/filter queries must not trigger new canonicalization.
- `/equipo` must reach `/reportes-historias`; `/piezas` and `/wilson-conversaciones` must reach `/workspace/tareas`. Exercise `/agustin`, `/franco` and both deprecated task aliases with one valid positive-safe-integer `task`: reach the same canonical task subject to current-ID authorization, then reload. `/equipo` retains its report destination. Test duplicate/invalid task values, unknown filters and hashes are not transplanted as scope/identity. Canonical and unknown paths must not be redirected by legacy policy.
- Verify Back/Forward has no loop or history growth; arbitrary existing history state survives canonical replacement. With a dirty task draft, cancel traversal and confirm URL/draft remain unchanged with no replacement or second discard prompt. Accept once and confirm one transition. Keep the shared unsaved-navigation controller authoritative.
- Verify current sidebar selection, personal-home identity, task detail/reload, role boundaries and existing financial/data permission suites. Check DEV preview wrappers separately without altering them.

Main additionally verifies readonly B2 metadata visibility without inference or writes and records B1/B3 as remaining work. Record commands/results, build evidence, fixture cleanup and actual visited URLs/identities in Main's runtime evidence. Source-test success alone is not navigation validation, whole-dashboard retirement, full-goal completion or phase completion.
