import test from 'node:test';
import assert from 'node:assert/strict';
import {productionResultProjection as dto,productionResultProjectionSql as sql} from '../src/production-result-projection.js';
const evidence=()=>({id:'11111111-2222-4333-8444-555555555555',visita_revision:7,revision_resultante:8,
  registrado_at:'2026-10-25T12:00:00Z',parcial:true,vigente:true});
test('projection is explicit, detached and distinguishes current and obsolete evidence',()=>{
  const raw={...evidence(),resumen:{secret:true},request_id:'private',sueldo:999};
  assert.deepEqual(dto(raw,8),{...evidence(),registrado_at:'2026-10-25T12:00:00.000Z'});
  assert.equal(dto({...raw,vigente:false},9).vigente,false);
  assert.equal(dto(null,8),null);assert.equal(dto(undefined,8),null);
});
test('projection rejects revision contradictions and malformed journal evidence',()=>{
  for(const patch of [{revision_resultante:9},{vigente:false},{visita_revision:0},{parcial:1},
    {registrado_at:'not-a-date'},{id:'not-a-uuid'}])assert.throws(()=>dto({...evidence(),...patch},8));
  assert.throws(()=>dto(evidence(),7));
});
test('last result is a bounded correlated lookup in the visit statement, never raw JSON',()=>{
  assert.match(sql,/r.visita_id=v.id/);assert.match(sql,/ORDER BY r.visita_revision DESC LIMIT 1/);
  assert.match(sql,/r.revision_resultante=v.revision/);
  assert.doesNotMatch(sql,/r\.\*|request_id|payload_hash|registrado_por_id/);
});
