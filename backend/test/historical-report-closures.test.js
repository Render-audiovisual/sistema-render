import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalClosuresDto, loadHistoricalReportClosures } from '../src/historical-report-closures.js';
import { filterReportDataForUser } from '../src/report-access.js';
const record=()=>({periodo:'2026-09-01',usuario_id:8,nombre_snapshot:'Nombre anterior',porcentaje:100,registrado_at:new Date('2026-10-13T12:00:00.000Z'),motivo:'private amount 999',autorizado_por:'private',importe:999,password_hash:'private'});

test('legacy manual closures are closed scalar historical evidence, not task/publication metrics',()=>{
 const dto=historicalClosuresDto({disponible:true,registros:[record()]});
 assert.deepEqual(dto,{disponible:true,registros:[{periodo:'2026-09-01',usuario_id:8,nombre_snapshot:'Nombre anterior',porcentaje:100,registrado_at:'2026-10-13T12:00:00.000Z'}]});
 for(const rol of ['admin','diseno','edicion','community','produccion','programacion']){
  const result=filterReportDataForUser({cierresMensuales:{disponible:true,registros:[record()]},tareas:[],publicaciones:[],historias:[]},{id:9,rol,activo:true});
  assert.deepEqual(result.cierresMensuales,dto);assert.deepEqual(result.tareas,[]);assert.deepEqual(result.publicaciones,[]);assert.deepEqual(result.resumenRenderOsPorDia,{});
  assert.doesNotMatch(JSON.stringify(result),/999|private|motivo|autorizado_por|importe|password_hash/);
 }
});
test('unavailable differs from empty archive; invalid rows and getter values never become evidence',()=>{
 assert.deepEqual(historicalClosuresDto(undefined),{disponible:false,registros:[]});
 assert.deepEqual(historicalClosuresDto({disponible:true,registros:[]}),{disponible:true,registros:[]});
 for(const patch of [{periodo:'2026-13-01'},{periodo:'2026-09-02'},{usuario_id:'8'},{usuario_id:0},{porcentaje:'100'},{porcentaje:101},{porcentaje:-1},{porcentaje:NaN},{nombre_snapshot:{}},{nombre_snapshot:''}]){
  assert.deepEqual(historicalClosuresDto({disponible:true,registros:[{...record(),...patch}]}).registros,[]);
 }
 let invoked=false;const malicious={get disponible(){invoked=true;throw Error('getter');}};
 assert.deepEqual(historicalClosuresDto(malicious),{disponible:false,registros:[]});assert.equal(invoked,false);
});
test('sort/dedupe use month and stable ID, never name; dates are validated, not inferred',()=>{
 const first=record(),second={...record(),usuario_id:9,registrado_at:'invalid'},later={...record(),periodo:'2026-10-01'};
 const rows=historicalClosuresDto({disponible:true,registros:[second,first,first,later]}).registros;
 assert.deepEqual(rows.map(r=>[r.periodo,r.usuario_id]),[['2026-10-01',8],['2026-09-01',8],['2026-09-01',9]]);
 assert.equal(rows[2].registrado_at,null);assert.equal(rows[0].nombre_snapshot,rows[2].nombre_snapshot);
});
test('optional deployed table is read-only, qualified and selects no free-text reason/author',async()=>{
 const calls=[],db={async query(sql){calls.push(sql);return{rows:calls.length===1?[{historical_closures_table:'reporte_cierres_mensuales'}]:[record()]};}};
 assert.equal((await loadHistoricalReportClosures(db)).registros.length,1);
 assert.equal(calls.length,2);assert.match(calls[1],/FROM public\.reporte_cierres_mensuales/);assert.doesNotMatch(calls[1],/motivo|autorizado_por|SELECT \*|INSERT|UPDATE|DELETE/);
 const missingCalls=[];const missing=await loadHistoricalReportClosures({async query(sql){missingCalls.push(sql);return{rows:[{historical_closures_table:null}]};}});
 assert.deepEqual(missing,{disponible:false,registros:[]});assert.equal(missingCalls.length,1);
 await assert.rejects(loadHistoricalReportClosures({async query(){throw Error('query failure');}}),/query failure/);
});
test('unknown and unauthenticated actors do not receive historical archive',()=>{
 const data={cierresMensuales:{disponible:true,registros:[record()]}};
 for(const auth of [{},{id:1,rol:'unknown'},{id:1,rol:'admin',activo:false}])assert.equal(filterReportDataForUser(data,auth).cierresMensuales,undefined);
});
