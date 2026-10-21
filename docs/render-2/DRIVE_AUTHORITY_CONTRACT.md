# Drive: deferred authority and uncertain writes

Integration104 is implemented and tested locally in the scope recorded in `STATUS.md`, not deployed or accepted against real Google Drive. No real Google request, credential update, upload or replacement is authorized by its tests.

## Authority

The principal Express Drive routers remain canonical. OAuth login and agency Drive credentials remain distinct. Drive capabilities must identify an exact database actor and session epoch; legacy name/role capabilities are rejected. Current active identity, task ownership/collaboration and current administrator role for replacement are checked again when the capability is consumed, not merely when it is created.

Task authorization uses the shared ID-based task predicate. Actor, task and authorizing assignment locks protect one bounded provider operation and its database attachment. Upload destination, size, task, replacement and content metadata are immutable intent fields. Query parameters cannot retarget a chunk. Provider responses are validated before attaching material. Existing attachment metadata is preserved and duplicate file IDs do not append a second attachment.

The public OAuth callback must independently validate current administrator authority before exchanging a code or saving credentials. The fact that a callback has no logged-in browser session is not permission to trust a historical role claim.

## Uncertain outcomes

Google and PostgreSQL do not form a distributed transaction. A lost response, provider timeout or attachment failure can follow a successful external write. An uncertain response is not evidence that nothing happened. Return a sanitized typed non-retryable outcome, never a provider error containing credentials, authorization codes or resumable URLs. Upload capabilities in request paths must be redacted by access-log configuration before release.

The client must not automatically resend an ambiguous chunk or begin a new upload for the same unresolved attempt. Confirmed files in a batch are retained immediately even if a subsequent file fails. A confirmed upload followed by a failed parent refresh offers a read-only refresh, not another upload. Recovery remains pinned to its original user/session/task/folder. Switching users cannot adopt a previous actor's upload.

Server-side terminal/replay protection uses additive migration080: `drive_upload_intents` and `drive_oauth_nonces`, with no historical backfill. An upload phase is durably claimed before its external effect; an abandoned starting/in-flight phase is fail-closed, not automatically resumed. Chunk range and bytes hash distinguish exact cached acknowledgments from changed requests. Cached acknowledgments still require current identity/task/replacement authority. A replacement has a separate single-use claim. OAuth state is consumed durably before code exchange; repeating it cannot exchange the code again. This is protection against redispatch, not a distributed exactly-once guarantee. Do not infer success from finding a matching file name in Drive.

Initial duplicates are explicitly typed `DRIVE_DUPLICATE_REJECTED`, before starting an upload. Only this known rejection permits a new explicit keep/replace decision; `retryable:false` never triggers an automatic retry. Final frontend acknowledgment validates ID, confirmed name, MIME, size and an exact safe Drive link before declaring success. A genuine zero-byte file must retain size zero.

## Scope and release gates

The upload lifecycle does not certify a complete per-folder privacy policy, real agency folder/roster onboarding, immutable external file bytes, production access-log redaction or real Google availability. Existing name-based destination heuristics are not authorization and are not silently remapped. No real account or folder mapping is invented.

Local QA uses actual Express routers, current-identity authentication and fresh guarded PostgreSQL, with an injected simulated provider. These tests must be distinguished from native browser checks and a real Google acceptance test. No configured development, sandbox or production database is reused.

Release requires080 plus coordinated backend/frontend deployment on an approved target. Legacy upload/OAuth capabilities fail closed and require a fresh attempt/login as appropriate; no old token is silently promoted. No maintenance job deletes receipt history, upload URLs or nonces in this integration. Retention/cleanup policy and encryption/access controls for stored capability URLs must be reviewed before production. These tables intentionally restrict deletion of referenced actor/task history.
