# Email membership boundary — local integration399

## Finding E399-1

Severity: medium privacy/correctness issue. Location: backend/src/email-notifications.js, notificarAsignacionTarea. Captured ID recipients were filtered by active status only, then mailed after asynchronous client/transport preparation. A recipient removed from a task could still receive its private correction notes. The private WhatsApp queue already rechecked current membership; its provider-specific eligibility cannot simply be applied to email.

## Implemented boundary

For ID-bound comentario/bloqueada/correcciones only, capture a bounded task ID before awaiting and re-read the recipient by ID immediately before sendMail. Require active account, current tarea_asignaciones membership, render_os scope and no archive/trash flag. Use the freshly read address/name, exclude the actor by ID and deduplicate current addresses. No role/name/WhatsApp inference. Zero eligible deliveries returns false instead of indexing an empty result. Lookup failure rejects without fallback. Other notification motives and historical name-bound paths retain existing behavior; this change is not a new recipient policy.

The read is parameterized, read-only and takes no explicit locks. SMTP is not called within a transaction. It reduces the stale-authorization window but cannot guarantee atomicity against revocation after the SELECT, delivery exactly once, atomic outbox semantics or actual provider acceptance. Existing HTML escaping/TLS configuration are unchanged.

## Coordination and tests

Main owns email implementation, physical regression and cohort integration. Hilbert independently owns37 unit tests; Harvey reviews source and physical scope without editing them. Security guidance shaped ID authorization/fail-closed handling; transactional email guidance preserved transport behavior without inventing retries/idempotency guarantees; PostgreSQL guidance keeps remote transport outside transactions.

- Hilbert's prepatch Git module loaded in memory:36tests,5PASS/31FAIL. This is a retrospective baseline against the actual old implementation, not an on-disk RED run before Main patched. Final37PASS/0FAIL; the extra shared-cached-address test is defensive adapter coverage, not a physically possible duplicate under the unique email index.
- Focal existing emails + new37 + fixed-cohort contracts:55PASS/0FAIL (/private/tmp/render2-goal399-email-focal-final.log). Initial cohort-contract assertion still expected40arguments; updated to41 for39files. No guard removed.
- New opt-in PostgreSQL test starts its own guarded cluster55984, no HTTP server/provider. Captures candidates, deliberately removes91003 and changes91004 email, then runs actual notification code. Each of the3 guarded motives excludes removed ID and sends exactly once to the current collaborator address using mock SMTP. WhatsApp-disabled member remains eligible. Archive, trash and non-render_os cases send nothing. All109 JSON/xmin/ctid hashes remain unchanged by notification code after deliberate fixture mutations.7PASS/0FAIL; root p1qbD9 removed ENOENT. Initial fixture failed NOT NULL because asignado_a was omitted; test setup corrected, not schema/product. Failed root jWnp7D also removed ENOENT.
- Backend final2682PASS/178opt-inSKIP/0FAIL of2860, terminal0 (/private/tmp/render2-goal399-backend-final.log). Initial restricted run had1 listener EPERM, not a product assertion failure; rerun used loopback permission, not disabled test.
- Core expanded39files: first358PASS/0FAIL/0SKIP, terminal0,84.11s (/private/tmp/render2-goal399-core.log). Final renewal after the last ID-deduplication adjustment:358PASS/0FAIL/0SKIP, terminal0,82.53s (/private/tmp/render2-goal399-core-final.log), disposable fixtures cleaned. Independent final review found no concrete P1/P2 in the delta; it is not a global security certification.

## Other work and remaining gates

Native Moodboards Categories focus acceptance closed separately in MOODBOARD_NATIVE_DIALOG_QA.md. A next production-result lifecycle fixture is prepared at /private/tmp/render2-goal399-production-native.mjs, syntax checked but NOT launched/accepted. Do not count preparation as a successful journey.

No configured/commercial database touched, real email sent, provider enabled, schema migration on existing data, push or deployment. Real accounts/provider credentials, recipient policy371, native uploads and broader acceptance remain outstanding. Render2 remains in local development, not globally ready for deployment.
