# Feedback replay: confirmed P1 and next contract

Status: read-only source audit plus pure synthetic checks; no database, network, server, real payload or credentials used. Application changes deferred to the main integration agent. Not a global-readiness or production approval.

## Confirmed evidence

- `backend/src/feedback-fields.js:31–36` accepts caller-supplied `origen: "mia_whatsapp"`, `confirmado_por` and `wilson_idempotency_key`.
- Principal `backend/src/server.js` POST `/notas` (normalization at line 395, insert at 401) and PATCH `/notas/:id` (normalization at 419, replacement at 426) persist these fields from authenticated browser requests without a privileged-field boundary.
- `backend/src/wilson-integration.js:1025–1037` locks/looks up a global key in editable note JSON and returns the prior row before consuming confirmation. Replay does not bind the actor ID or request payload hash. A browser writer can therefore forge provenance and seed/replace replay evidence, causing a later integration request to return an unrelated row as successful replay without its confirmation check.
- Key storage truncates to 200 characters (`feedback-fields.js:33`), but lock/lookup use the full key. A longer key misses its own stored receipt on retry. Replacing feedback JSON or permanently deleting its note also destroys replay evidence. No independent durable feedback receipt is used by this path.

Line numbers describe the inspected snapshot; use the named routes/functions if concurrent integration shifts them.

## Pure synthetic reproduction

From repository root, the following runs only the normalizer and extracted handler with an injected fake pool. It does not import/start the server or contact any service. All values are fictional.

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeFeedback } from './backend/src/feedback-fields.js';

const feedback = normalizeFeedback({
  origen: 'mia_whatsapp',
  confirmado_por: 'Synthetic approver',
  wilson_idempotency_key: 'synthetic-feedback-key',
});
assert.equal(feedback.confirmado_por, 'Synthetic approver');
assert.equal(feedback.wilson_idempotency_key, 'synthetic-feedback-key');

const source = fs.readFileSync('backend/src/wilson-integration.js', 'utf8');
const start = source.indexOf('  router.post("/feedback",');
const end = source.indexOf('  router.post("/tareas/validar",', start);
assert.ok(start >= 0 && end > start);
let handler;
let confirmationCalls = 0;
const queries = [];
const prior = {
  id: 8, titulo: 'Synthetic earlier note', contenido: 'Synthetic earlier text', feedback,
};
const client = {
  query: async (sql) => {
    queries.push(sql);
    return { rows: sql.includes('SELECT id,titulo') ? [prior] : [] };
  },
  release() {},
};
new Function('router', 'pool', 'consumeWilsonConfirmation', source.slice(start, end))(
  { post: (_path, fn) => { handler = fn; } },
  { connect: async () => client },
  async () => { confirmationCalls++; return false; },
);
const response = {
  status(code) { this.code = code; return this; },
  json(data) { this.data = data; return this; },
};
await handler({
  headers: { 'idempotency-key': 'synthetic-feedback-key' },
  body: { titulo: 'Synthetic incompatible replacement' },
  wilson: { actorId: 'synthetic-other-actor', userId: 99 },
}, response, (error) => { throw error; });
assert.equal(response.data.idempotent, true);
assert.equal(response.data.feedback.id, 8);
assert.equal(confirmationCalls, 0);
assert.ok(!queries.some((sql) => sql.includes('payload_hash')));
assert.equal(normalizeFeedback({
  wilson_idempotency_key: 'x'.repeat(201),
}).wilson_idempotency_key.length, 200);
console.log('Synthetic replay/provenance and key-length defects reproduced.');
JS
```

The equivalent extracted-handler reproduction passed during the audit. Existing pure regressions also passed (12 tests):

```sh
node --test backend/test/feedback-fields.test.js backend/test/feedback-workflow.test.js backend/test/feedback-routes.test.js
```

These checks establish handler/helper behavior, not HTTP middleware, SQL constraints or real concurrent transaction behavior. After the fix the vulnerable-behavior assertions above should fail; replace them with rejection/replay-contract assertions.

## Recommended bounded receipt/provenance contract

1. **Trusted provenance:** browser POST/PATCH may edit shared-note business fields but cannot supply integration origin, confirmer or replay key. Reject reserved fields explicitly; browser edits preserve existing server provenance. Integration derives actor/confirmer from validated server identity/confirmation, never display-name input. Retain legacy provenance as historical/unverified where trust cannot be established.
2. **Receipt scope:** independent table with unique `(actor_user_id, operation, idempotency_key)`; principal ID is the stable existing `usuarios.id`, not a browser profile, name or mutable external alias. Require a bounded nonempty key; reject oversized input consistently rather than truncating it. Bind the canonical validated business payload hash, including target ID for updates.
3. **Atomicity:** serialize the same receipt scope and commit receipt, note mutation and audit together. A first execution must validate current authorization and consume valid confirmation in that transaction. Failure rolls everything back. Same actor/key/hash replays the committed result without repeating side effects; changed hash returns 409. Different actors have distinct scopes. Check current authorization before returning stored results; no cross-actor/global lookup.
4. **Durability:** receipts are not editable through notes APIs and do not cascade away when a note is archived, edited or purged. Store the minimal stable result/DTO needed for retry; define purge/tombstone response and retention explicitly. Never store credentials or confirmation secrets in replay responses. Historical JSON keys are not automatically promoted to trusted receipts.
5. **Notifications:** notification fingerprint deduplication is not mutation idempotency. If reliable delivery is required, enqueue an outbox record in the same transaction and deduplicate dispatch by committed event ID; current post-response enqueue has a crash gap.
6. **Verification:** pure tests for reserved-field rejection, canonical hash/key validation and actor scope; isolated principal-schema tests for concurrent identical retries (one mutation), conflicting payloads (409), rollback, crash/retry, role loss, edit/archive/purge survival, and one committed notification event. No production or sandbox replacement is authorized.

## Scope distinctions and freeze

Shared-team note reading and editing another author's note are intentional in current tests; this finding does not propose creator-only ACLs. Permanent purge currently lacks an admin guard (`server.js`, DELETE `/notas/:id`, `permanente=true` branch), but admin-only purge policy remains undecided: do not label that behavior a confirmed unauthorized-action bug until the policy is approved.

No confirmed financial-source/structured financial-response leak was found in the scoped feedback routes/helpers. Raw note text/JSON returned to the shared team is not itself evidence of payroll exposure.

Next owner: main agent, for ID-scoped atomic durable receipts and server provenance in non-production integration. This sidecar is frozen after saving this document; no application code, database or integration state changed.
