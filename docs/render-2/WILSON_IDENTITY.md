# External identity contract — local rescue integration

This is an implementation/rollout contract, not authorization to deploy or evidence of real account ownership.

## Identity and task access

- Transport RSA signatures identify an authorized integration request, never a Render role.
- Every human request resolves one active `usuarios.id`. WhatsApp uses enabled server-stored hashes/identity rows. Zero matches, multiple matching accounts (including an inactive conflicting link), and inactive accounts fail closed.
- Telegram requires explicit server configuration `WILSON_TELEGRAM_USER_BINDINGS`, a JSON object mapping the exact external actor identifier to a positive numeric user ID. Example for disposable tests only: `{"qa-tg-owner":94001}`. No default Telegram identifier implies ownership or leadership. Old `WILSON_ALLOWED_TELEGRAM_IDS` alone cannot authorize a human account.
- Current database role `admin` grants integration leadership. Display names, aliases, job titles, transport headers and the obsolete `lider` label do not.
- Task list/detail/context/report, modification/archive and review membership use normalized `tarea_asignaciones` IDs. Group context cannot broaden individual task access. Unbound historical tasks are not inferred from names.
- Explicit new assignment selections can resolve a unique active name into IDs. Non-admin assignment writes are self-only; broader assignment needs admin. Name aliases retained for human input/display are not an ACL.
- Review confirmation rechecks normalized membership after task locks. Idempotent task-create retries reauthorize the returned task. This is not yet full principal-scoped/payload-bound idempotency for every integration operation.
- Supervisor task loads are annotated with normalized membership. Private employee follow-ups remain available and current active identity is checked again by the supervisor; global scheduler/delivery routes remain service-only.

## Signed protocol and client cutover

The server accepts **version 2 only** and verifies the exact pathname plus query string in the signed target, along with timestamp, nonce, channel, actor ID, group ID, display-name header, HTTP method and canonical body hash. Unknown channels and missing/unsupported signature versions are rejected. Query order/encoding must match the sent URL exactly; clients must not sign only the pathname.

Both repository Python clients were updated together: Telegram now emits v2 context and WhatsApp retains the query string. No client has been executed against WhatsApp, Telegram or a hosted Render instance. The test signing keypair exists only in test-process memory and only its public half reaches the fixture child.

The configured system actor has a route allowlist for existing queues/digests/delivery/tick operations and cannot use ordinary human task routes or mint human confirmations. This is not a separate production credential provisioning flow: distinct credential rotation/channel scoping still needs review.

Before any approved rollout: validate a real per-person roster/link map without guessing from names, coordinate server and signing-client versions, rehearse disabled/ambiguous-account rejection, and preserve a recovery-capable administrator. Existing integrations using v1, pathname-only signing or default Telegram owner IDs will intentionally be rejected. Do not deploy the server change alone.

## Open security gates

This block does **not** close Phase 1 or certify all integration endpoints. Remaining work includes feedback object ACLs/duplicate-result privacy, shared durable replay protection (nonces are process-local), operation/user/payload-bound idempotency and confirmation lifecycle across relinking, financial privacy coverage of all equivalent routes, service credential separation, active-user/reassignment concurrency stress tests, and production callback/token transaction boundaries. Fine-grained capabilities and canonical task transitions remain separate pending work.

See `WILSON_QA.md` for actual signed HTTP evidence and limitations; tests without the explicit local-integration opt-in do not start a database.
