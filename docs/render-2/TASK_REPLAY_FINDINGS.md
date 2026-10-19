# Wilson task replay findings

Source snapshot: HEAD `a508fd7`, inspected working-tree files. Read-only code review and synthetic extracted-handler checks only; no server imports/startup, DB, network or real payloads. Only this document created. Source line numbers may shift during integration.

## Confirmed P1: create/edit replay identity and intent are not bound

`backend/src/wilson-integration.js`:

- Create, lines 1941–1964: global advisory scope `wilson:${key}`; lookup by editable `propiedades_extra.wilson_idempotency_key`, workspace only, `LIMIT 1`. It annotates current ID assignments and checks `privateCurrentTaskError`, then returns `created:false,idempotent:true` before confirmation. No originating stable actor ID or request hash is compared.
- PATCH, lines 1815–1838: lock scope is task ID/key; load/lock live task and check current access, then compare only `propiedades_extra.wilson_last_update_key`. A match returns `updated:false,idempotent:true` before confirmation and payload/target-assignment validation. Stored external actor metadata is not compared.
- Create writes external actor/channel/key into JSON (1980–1985); PATCH writes last-update external actor/channel/key into JSON (around 1907). These attributes are not independent durable receipts. A later update overwrites the sole last-update key; deleting the task destroys create replay evidence.

Impact: an authorized collaborator/admin using another operation's key and a different payload receives false successful replay, without proving the requested intent was ever confirmed or performed. Global create keys also collide across accounts. This is a confirmation/replay-integrity failure, **not** a demonstrated unauthorized mutation or unrelated-user disclosure: current task-ID access is checked before these replay returns.

## Current permission and editable-JSON boundaries

- Router middleware resolves signed external actors to an active linked internal account. `privateCurrentTaskError` (around 928) permits current admin or owner/collaborator by stable IDs; names are not its ownership authority. The task paths do not call the feedback transaction-time actor/mapping lock helper. Concurrent role/link changes after middleware are therefore not revalidated under the mutation transaction; a live race was not tested.
- Principal browser `server.js` PATCH `/tareas/:id`, lines 2289–2298: employees pass a metadata allowlist; `task-access.js:32–36` rejects `wilson_last_update_key` and `wilson_idempotency_key`. **No confirmed ordinary-employee JSON poisoning path** through this endpoint.
- Admin bypasses that employee allowlist; only selected approval fields are stripped. Generic metadata merges at `server.js:2493` can therefore set/overwrite Wilson replay/provenance keys. That is a privileged mutable-evidence path, not employee privilege escalation. Browser task creation constructs its own metadata rather than accepting arbitrary JSON (around 2121–2146).
- `taskWithUrl` → `wilsonTaskForResponse` → operational DTO serialization still governs replay responses; no new financial/secret disclosure is established by the replay defect. Do not remove current resource authorization when replacing replay storage.

## Archive/delete: separate durability gaps

- POST `/tareas/:id/archivar` (around 2010): requires a key, consumes confirmation before lookup, writes `wilson_archive_key`, but never reads it as a receipt. A retry after success fails confirmation or active-task lookup; no durable success recovery. The key does not bind actor/payload. No same early-success bypass was found here.
- DELETE `/tareas/:id` (2041 onward): current middleware-resolved admin check, confirmation consumption and archived-task row lock precede delete/audit/commit. No idempotency key or independent replay receipt. A successful delete followed by lost response cannot replay success. No same early-success bypass was found here.
- Archive/PATCH/create use transactional mutation+audit but post-commit task notifications remain separate. Do not infer transactional notification delivery from the feedback implementation.

## Reproducible pure evidence

Run from repository root. Actual create/PATCH route bodies are extracted without importing the server; fake dependencies intentionally supply a task the different synthetic caller currently collaborates on. The reproduction isolates replay decisions, not middleware/SQL execution.

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { canEmployeePatchTask } from './backend/src/task-access.js';
const source=fs.readFileSync('backend/src/wilson-integration.js','utf8');
const task={id:81,asignado_a_id:22,colaborador_ids:[33],propiedades_extra:{
  workspace:'render_os',wilson_idempotency_key:'synthetic-key',
  wilson_actor_id:'synthetic-original',wilson_last_update_key:'synthetic-key',
}};
const start=source.indexOf('  router.patch("/tareas/:id",');
const end=source.indexOf('  router.post("/tareas/:id/archivar",',start);
assert.ok(start>=0 && end>start);
let confirmations=0;
const handlers=new Map();
const db={query:async(sql)=>({rows:sql.includes('SELECT t.*')?[task]:[]}),release(){}};
new Function('router','pool','env','loadWilsonTask','privateCurrentTaskError',
  'annotateTaskAssignments','taskWithUrl','wilsonOperationalAuth',
  'consumeWilsonConfirmation',source.slice(start,end))(
  {patch:(path,fn)=>handlers.set('patch',fn),post:(path,fn)=>handlers.set('create',fn)},
  {connect:async()=>db},{},async()=>task,
  (req,env,row)=>row.asignado_a_id===req.wilson.userId
    ||row.colaborador_ids.includes(req.wilson.userId)?null:'forbidden',
  async(db,rows)=>rows,row=>({id:row.id}),()=>({}),
  async()=>{confirmations++;return false;},
);
for(const route of ['create','patch']) {
  const response={status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await handlers.get(route)({params:{id:'81'},headers:{'idempotency-key':'synthetic-key'},
    body:{titulo:'Synthetic incompatible requested change'},
    wilson:{userId:33,actorId:'synthetic-different-actor',actorRole:'edicion'},
  },response,error=>{throw error;});
  assert.equal(response.data.idempotent,true);
  assert.equal(confirmations,0);
  console.log(route+': different collaborator/payload accepted as replay without confirmation');
}
assert.equal(canEmployeePatchTask({propiedades_extra:{wilson_last_update_key:'synthetic-key'}},
  {workspace:'render_os',role:'edicion'}),false);
console.log('Employee JSON poisoning is blocked by the current allowlist.');
JS
```

Executed successfully during this audit. After a fix, replace these vulnerable-success expectations with actor-scope/hash-conflict assertions. No existing integration suites or databases were used.

## Concrete next bounded fix

Introduce task-operation receipts independent of task JSON, unique by stable internal actor ID/operation/key, with canonical versioned request-intent hash and target ID for edit/archive/delete. Require bounded consistent keys; reject conflicting header/body keys. Revalidate current linked actor and resource permission before receipt replay. Exact retry returns minimal committed result/current authorized DTO or tombstone; changed intent returns 409. Never treat legacy JSON keys as trusted receipts.

Create/edit/archive/delete must commit confirmation consumption, mutation, audit and receipt atomically. Define delete/archive replay permission explicitly: keep actor/operation authorization after target deletion rather than requiring a now-absent live row or granting access to another actor's receipt. Preserve existing group restrictions and stable-ID task access; no new task visibility policy is proposed. Reserve integration provenance/replay metadata across all browser writers, including admin inputs. Notification durability and stronger task CAS should be explicit contract decisions, not assumed solved by replacing JSON lookup.
