import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contractId, expectedContractVersion, isContractDate, normalizeContractInput, contractNotUpdated } from '../src/financial-contract.js';
test('contract IDs and revision observations are canonical int32 and resource-bound',()=>{
  assert.equal(contractId('2147483647'),2147483647);assert.equal(expectedContractVersion('fc1:7:12',7),12);
  for(const id of [7,null,'0','01','-1','1e0','1\n','2147483648'])assert.throws(()=>contractId(id),e=>e.status===400);
  assert.throws(()=>expectedContractVersion(undefined,7),e=>e.status===428);
  for(const v of [null,1,{},[],'','fc1:0:1','fc1:7:0','fc1:07:1','fc1:7:1\n','fc1:7:2147483648','a1:7:1:0:0'])assert.throws(()=>expectedContractVersion(v,7),e=>e.status===400);
  assert.throws(()=>expectedContractVersion('fc1:8:1',7),e=>e.status===409&&e.code==='CONTRACT_REVISION_CONFLICT');
});
test('calendar validation rejects impossible dates without Date timezone/year coercion',()=>{
  for(const date of ['0001-01-01','2000-02-29','2026-10-20','9999-12-31'])assert.equal(isContractDate(date),true);
  for(const date of [null,1,'0000-01-01','1900-02-29','2026-02-29','2026-04-31','2026-13-01','2026-01-00','2026-1-1','2026-10-20\n'])assert.equal(isContractDate(date),false);
});
test('closed input preserves exact decimal text within NUMERIC14,2 and never silently rounds amounts',()=>{
  for(const amount of [0,'0.00',1234.5,'999999999999.99'])assert.equal(normalizeContractInput({importe_mensual:amount}).importe_mensual,String(amount));
  for(const amount of [null,true,{},[],NaN,Infinity,-1,'',' ',' 1','1 ','1\n','1e3','1,50','01','1.234','1000000000000'])assert.throws(()=>normalizeContractInput({importe_mensual:amount}),e=>e.status===400);
  for(const body of [null,[],42,{}, {revision:1},{activo:'false'},{nombre:{}},{nombre:'x'.repeat(251)},{inicia_el:null},{inicia_el:'2026-02-31'}])assert.throws(()=>normalizeContractInput(body),e=>e.status===400);
  assert.deepEqual(normalizeContractInput({nombre:' QA ',finaliza_el:''}),{nombre:'QA',finaliza_el:null});
  assert.deepEqual(normalizeContractInput({nombre:'QA',importe_mensual:'15.25',inicia_el:'2026-10-01'},{operation:'create'}),{nombre:'QA',importe_mensual:'15.25',inicia_el:'2026-10-01'});
  assert.throws(()=>normalizeContractInput({expected_revision:'fc1:1:1',activo:false},{operation:'archive'}),e=>e.status===400);
});
test('zero-row mutation distinguishes missing from stale but never acknowledges success',async()=>{
  for(const rowCount of [0,1]){
    const calls=[];const db={async query(sql,params){calls.push({sql,params});return{rowCount};}};
    await assert.rejects(contractNotUpdated(db,7),e=>e.status===(rowCount?409:404));
    assert.deepEqual(calls,[{sql:'SELECT id FROM contratos_financieros WHERE id=$1',params:[7]}]);
  }
});
test('migration adds a monotonic future update trigger without changing amounts, dates, names or linking clients',()=>{
  const sql=readFileSync(new URL('../migrations/073_financial_contract_versions.sql',import.meta.url),'utf8');
  assert.match(sql,/NEW.contract_version := OLD.contract_version \+ 1/);
  assert.match(sql,/BEFORE UPDATE ON contratos_financieros/);
  assert.doesNotMatch(sql,/SET (?:importe_mensual|nombre|inicia_el|finaliza_el|activo)|REFERENCES clientes|DELETE FROM/i);
});
