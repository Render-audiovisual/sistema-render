# Integration83 — canonical finance sessions and independent contract CAS

## Ownership and scope

Coordinator:073 migration, financial-contract helper/server routes, unit/physical QA, compatibility tests and integration. Carson: Sueldos page/session tests. Hypatia: extracted FinanceContractsPanel/callback tests. Beauvoir: independent frozen-source reviews. Existing App20+/1-,Vite5+ and untracked reference work preserved. No configured DB/provider/real-account or commercial write, dependency/environment change, push or deployment.

## Data and API contract

Financial contracts remain independent records. No cliente_id or assignment is inferred from a matching name.073 adds positive INTEGER contract_version(default1); every future UPDATE sets OLD+1, including SQL/no-op/ABA. Installation does not rewrite stored amounts, dates, names or lifecycle states. Version exhaustion fails closed.

Admin GET/POST/PATCH/soft-DELETE DTOs include resource-bound `contract_revision: fc1:<id>:<version>`. Existing writers require body expected_revision; missing428, malformed400, stale/cross-resource409 CONTRACT_REVISION_CONFLICT. PATCH and soft deletion are a single atomic UPDATE WHERE id AND contract_version, with ACK from the same RETURNING after its BEFORE trigger. A zero-row update can only become404 or409, never acknowledged success. Role checks stay server-side admin-only.

Input is closed and validated: canonical int32 ID/version; trimmed nonempty name≤250; NUMERIC14,2-compatible nonnegative decimal amount (string preserved, no silent rounding); actual Gregorian ISO dates. End date can be cleared. Existing relative-date/soft-archive semantics remain, including retention of an already stored final date. No new hard-delete or billing-policy reinterpretation. Older writers without preconditions now fail closed and need a coordinated release.

## Frontend integration

Sueldos uses genuine scoped parsed requests for contracts and financial summaries; identity reset, period/ABA/read-generation/abort fences, role gate and URL validation. Period changes defer while contract activity is present. Administrative contracts stay mounted independently of summary loading/error, so a calculation failure does not discard a financial draft or hide a confirmed save. Verified ACKs update the current account's list without an extra GET/rebase; summary refresh is separate.

The extracted controlled-input panel replaces document.getElementById/raw fetch. Editor holds its own ID/version. Duplicate dispatch/dirty close/session-switch fences, strict ACKs, explicit conflict recovery and duplicate-ID rejection on reload. Conflict or uncertain response preserves draft and blocks repeated writing until reviewed recovery; confirmed creation is not repeated because a later refresh failed. Toggle uses held-version PATCH; history is not physically deleted. No new CSS stack: existing classes retained, except creation avoids the edit-only class that hid labels; all four inputs have explicit accessible names.

## Reproduction and evidence

```
node --test test/financial-contract.test.js test/render2-startup-guard.test.js
RENDER2_RUN_LOCAL_INTEGRATION=true node --test --test-concurrency=1 test/render2-financial-contracts.integration.test.js test/render2-client-agreement.integration.test.js test/render2-cross-sector-workflow.integration.test.js
node --test test/*.test.js
```

Final frontend910 pass/0fail/0skip (31 panel and11 finance-page cases included, extracted actual callbacks/source, not mounted React); backend1397 pass/63 explicit opt-in skips/0fail; actual principal HTTP/PostgreSQL30 pass/0fail/0skip; frontend production build and diff check pass. Physical cases include exact decimal/ID/revision persistence across owners, all employee financial read/write denials, bad input/version rejection, one-winner concurrency, no implicit client linkage, financial summary update, SQL ABA, soft deletion/reactivation and prior task/approval/client-agreement regression. Generated-root absence asserted for all fixtures.

Exchange-rate calls are blocked in the harness; the existing explicit fallback/source is returned and shown, not a live-provider verification. Billing calculations were preserved, not replaced with browser figures. Financial source guards were adapted to the extracted canonical panel and retained no-table/history/API checks, not weakened to accept raw fetch.

Initial mounted inspection discovered unnamed/hidden creation fields caused by existing desktop CSS; fixed and rebuilt before final UI acceptance. Final browser Franco holds1000 and drafts1500; actual Agustín API updates2000 using his own version. Franco save409 visibly retains1500 and offers explicit recovery. Mobile load shows2000, subsequent2500 save/reload persists and the summary shows2500. These are synthetic contract amounts in a newly generated fixture; other fixture labels/values come from repository seed migrations, not a configured live database. At390×844 document width/scrollWidth both390. Screenshot visually inspected: `/private/tmp/render2-finance83-reloaded-mobile.jpg`; conflict evidence `/private/tmp/render2-finance83-conflict-desktop.jpg`.

Both owned browser tabs closed, viewport reset, original fixture PTYs stopped; exact roots `/private/tmp/render2-local-0uwSFU` and `/private/tmp/render2-local-bdTtQS` checked absent. No broad kill, repository reset or user-data cleanup.

## Startup regression discovered during integration

An initial final backend run overlapped Vite's dist replacement and failed on an ENOENT read of index.html. The server previously checked only that dist existed. It now reads the entrypoint once and omits static mounting only for ENOENT; EACCES/other I/O errors still propagate. A subprocess regression injects missing/inaccessible entrypoints without changing disk and forbids DB/listen/network/timers during disabled import. Full backend and physical suites were then rerun without a parallel build. If imported without the entrypoint, static serving requires restart after build; no automatic readiness or deployment claim. The financial browser bundle was unchanged by this final backend-only guard adjustment.

Logs `/private/tmp/render2-finance83-frontend-final.log`, `/private/tmp/render2-finance83-backend-final.log`, `/private/tmp/render2-finance83-http-final.log`, `/private/tmp/render2-finance83-build-final.log`. Independent bounded source review found no confirmed P1/P2 in the final corrections.

## Remaining gates and release distinction

073 applied only through disposable guarded fixtures. Release requires explicit known environment identity/plan hash, backup and synchronized migration/API/frontend; no configured database was migrated. Not production-ready/deployed or full phase/master completion.

Still pending: durable create/mutation receipts after uncertain transport; immutable financial audit/effective-price policy; explicit client-contract relationships and overlap/termination business rules; expenses/payroll/exchange-rate writers; global navigation/crash drafts; cookie activation and native device/proxy/provider acceptance; remaining canonical writers and all-app design unification. Existing calculations aggregate contract labels for presentation; labels remain unsuitable for identity or permissions. No new claim that financial history has become an immutable accounting ledger.
