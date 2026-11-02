# Saturday Instagram weekly report release

## 1. Objective

Apply instagram-reporte-sabados.patch to the actual published codex/render-2-release-20261029 head, preserving operational data and the existing automatic Instagram refresh.

## 2. Scope

Report weeks become Saturday through Friday in America/Argentina/Cordoba. The newly complete week is available from Saturday 09:00 local time. Existing weekly records are preserved; older Monday–Sunday records are not rewritten. The worker can catch up the latest complete week on the next authorized invocation.

## 3. Integration

Prepared in an isolated worktree from published commit 6c3befb4a5875d140eb4d3a09852cbcabab73139. The seven textual patch files initially passed reverse-apply verification. The unrelated compiled Python __pycache__ binary was deliberately excluded. Only an entrypoint comment and extra regression assertions were added beyond the textual patch.

## 4. Risks and boundaries

instagram_reporte runs after successful synchronization only when already present in RENDER_AUTOMATION_JOBS. No editorial, WhatsApp, supervisor or task jobs are enabled. AI remains optional under existing explicit configuration. Existing schema, migration guard, transport identity, mutex, completion ledger and domain idempotence remain unchanged. No manual production job invocation or environment modification is required.

## 5. Acceptance

Verify Saturday 08:59/09:00, Sunday/Monday, month/year boundaries; ordering sync then report; hourly deduplication and one stored weekly report across repeated invocations; preserved operational fingerprints. Production activation is separate from local test success.

## 6. Tests

55 focused runner/weekly/frontend tests passed. Eight actual PostgreSQL integration tests passed on a fresh isolated fixture, including a real weekly report after the dedicated sync pipeline and duplicate prevention across two hour slots. Frontend production build passed (278 modules). No migration was applied to production.

## 7. Publication review

Before publication, compare the current remote branch head and retain a non-forced expected-head update. Verify the active worker, weekly module and frontend artifacts, operational fingerprints, and the first automatic weekly receipt. Do not claim a future Saturday execution has already occurred.
