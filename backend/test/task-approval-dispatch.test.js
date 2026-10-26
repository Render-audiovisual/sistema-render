import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Execute the actual post-save dispatch block, not a second implementation.
// The physical test separately proves the principal HTTP/PG/queue integration.
const source = readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const route = source.indexOf('router.patch("/tareas/:id",');
const start = source.indexOf('    if (approvalNotification) {',route);
const end = source.indexOf('    const eventoEstado',start);
assert.ok(route>0 && start>route && end>start);
assert.ok(source.lastIndexOf('res.json(taskOperationalDto(tareaActualizada, req.auth));',start)>route);
const execute = new Function('approvalNotification','result','pool','notificarAsignacionSinInterrumpir',source.slice(start,end));
const approval = {actorId:1,actor:'DB admin',tarea:{id:3,revision:7},destinatarioIds:[2]};
const reassignment = {actorId:1,actor:'DB admin',tarea:{id:3},destinatarioIds:[2]};

test('actual approval dispatch supersedes a reassignment notice from the same PATCH',()=>{
  const calls=[],pool={};execute(approval,{assignmentNotification:reassignment},pool,value=>calls.push(value));
  assert.equal(calls.length,1);assert.equal(calls[0].motivo,'aprobada');
  assert.equal(calls[0].detalle,'DB admin aprobó el trabajo.');
  assert.deepEqual(calls[0].destinatarioIds,[2]);assert.strictEqual(calls[0].pool,pool);
});

test('ordinary reassignment dispatch remains unchanged without an approval event',()=>{
  const calls=[];execute(null,{assignmentNotification:reassignment},{},value=>calls.push(value));
  assert.equal(calls.length,1);assert.equal(calls[0].motivo,'reasignada');
  execute(null,{assignmentNotification:{destinatarioIds:[]}},{},()=>assert.fail('No recipient delta'));
  execute(null,{}, {},()=>assert.fail('No event'));
});

for(const mode of ['throw','reject'])test(`approval notifier ${mode} cannot escape the actual post-response block`,async()=>{
  let calls=0;
  assert.doesNotThrow(()=>execute(approval,{assignmentNotification:reassignment},{},()=>{
    calls++;if(mode==='throw')throw new Error('Synthetic transport failure');
    return Promise.reject(new Error('Synthetic transport rejection'));
  }));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});
