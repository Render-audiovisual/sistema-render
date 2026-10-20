import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertAgreementRevision, clientAgreementRevisionSql, lockClientAgreement } from '../src/client-agreement.js';
test('revision binds client and both version domains with canonical int32 parts',()=>{
  for(const value of ['a1:1:1:0:0','a1:3:9:1:2','a1:2147483647:2147483647:2147483647:2147483647'])assert.doesNotThrow(()=>assertAgreementRevision(value));
  assert.throws(()=>assertAgreementRevision(undefined),e=>e.status===428&&e.code==='CLIENT_AGREEMENT_REQUIRED');
  for(const value of [null,{},[],false,1,'','a1:1:1:0','a1:0:1:0:0','a1:1:0:0:0','a1:01:1:0:0','a1:1:1:2:0','a1:1:1:0:2',
    'a1:1:1:0:0\n',' a1:1:1:0:0','a1:1:1:0:0 ','a1:1:1:0:0:1','a1:2147483648:1:0:0']){
    assert.throws(()=>assertAgreementRevision(value),e=>e.status===400&&e.code==='CLIENT_AGREEMENT_INVALID');
  }
});
test('SQL projection keeps counters in PostgreSQL and rejects noninternal aliases',()=>{
  assert.match(clientAgreementRevisionSql(),/c\.id.*c\.agreement_version.*c\.grupo_feed_id.*gf\.agreement_version/);
  for(const alias of [null,1,'c;DELETE','c.x','c\n',' c'])assert.throws(()=>clientAgreementRevisionSql(alias,'gf'));
});
function fixture({missing=false,group=0,revision='a1:1:2:0:0'}={}){
  const calls=[];
  return{calls,db:{async query(sql,params){calls.push({sql,params});
    if(sql.startsWith('SELECT id,grupo_feed_id'))return{rowCount:missing?0:1,rows:missing?[]:[{id:1,grupo_feed_id:group||null}]};
    if(sql.includes(' AS agreement_revision'))return{rowCount:1,rows:[{agreement_revision:revision}]};
    return{rowCount:1,rows:[{id:group}]};
  }}};
}
test('invalid/missing observations do not acquire locks or touch database',async()=>{
  const f=fixture();for(const expected of [undefined,'bad'])await assert.rejects(lockClientAgreement(f.db,1,expected));
  assert.deepEqual(f.calls,[]);
});
test('global writer lock precedes parent/group row locks and revision comparison; helper owns no transaction',async()=>{
  const f=fixture({group:2,revision:'a1:1:2:2:3'});
  const row=await lockClientAgreement(f.db,1,'a1:1:2:2:3');assert.equal(row.grupo_feed_id,2);
  assert.match(f.calls[0].sql,/pg_advisory_xact_lock/);assert.match(f.calls[1].sql,/public.clientes.*FOR UPDATE/);
  assert.match(f.calls[2].sql,/public.grupos_feed.*FOR UPDATE/);assert.match(f.calls[3].sql,/ AS agreement_revision/);
  assert.ok(f.calls.every(call=>call.sql.startsWith('SELECT')));
});
test('stale or cross-resource observations reject before business DML; missing client stays404',async()=>{
  for(const revision of ['a1:1:1:0:0','a1:2:2:0:0']){
    const f=fixture();await assert.rejects(lockClientAgreement(f.db,1,revision),e=>e.status===409&&e.code==='CLIENT_AGREEMENT_CONFLICT');
    assert.ok(f.calls.every(call=>call.sql.startsWith('SELECT')));
  }
  const missing=fixture({missing:true});await assert.rejects(lockClientAgreement(missing.db,1,'a1:1:1:0:0'),e=>e.status===404);
});
test('migration installs monotonic future update/child triggers without changing business amounts or lifecycle states',()=>{
  const source=readFileSync(new URL('../migrations/072_client_agreement_versions.sql',import.meta.url),'utf8');
  assert.match(source,/NEW\.agreement_version := OLD\.agreement_version \+ 1/);
  assert.match(source,/AFTER INSERT OR UPDATE OR DELETE ON cliente_configuraciones/);
  assert.match(source,/AFTER INSERT OR UPDATE OR DELETE ON cliente_abonos/);
  assert.match(source,/ORDER BY id LOOP/);
  const installation=source.replace(/--[^\n]*/g,'').replace(/CREATE FUNCTION[\s\S]*?END \$\$;/g,'');
  assert.doesNotMatch(installation,/\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(source,/SET\s+(?:importe|estado|abono_mensual|cuota_reels)/i);
});
