import test from 'node:test';
import assert from 'node:assert/strict';
import {projectHistoricalProduction} from '../src/team-production-statistics.js';
import {projectTeamStatistics} from '../src/team-statistics.js';
const users=[{id:10,nombre:'QA filmmaker',rol:'produccion'}];
const batch=(id='batch-1',changes={})=>({id,fecha:'2026-10-26',cantidad:4,usuario:'Germán',created_at:'2026-10-26T20:00:00.000Z',...changes});
const task=(records,changes={})=>({id:100,title:'QA visit 26/10',client:'QA',client_id:1,records,...changes});
test('historical batches preserve corrected quantities and dedupe identical record IDs without fabricated videos',()=>{
 const record=batch('same',{cantidad:4,corregido_desde:6});
 const input=[task([record,structuredClone(record)]),task([record],{id:101})];
 const before=structuredClone(input),result=projectHistoricalProduction(input);
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].quantity,4);
 const person=projectTeamStatistics(users,result.candidates,'2026-10')[0];
 assert.equal(person.count,4);assert.equal(person.records.length,1);assert.equal(person.records[0].quantity,4);
 assert.equal(person.records[0].href,'/workspace/tareas?task=100');
 assert.deepEqual(input,before);
});
test('near-identical batches are held in full, not silently merged or summed',()=>{
 const result=projectHistoricalProduction([task([batch('a',{cantidad:2}),batch('b',{cantidad:2,created_at:'2026-10-26T20:00:06.000Z'})])]);
 assert.equal(result.candidates.length,0);assert.equal(result.pending.length,2);
 assert.ok(result.pending.every(row=>row.reason.includes('falta comprobar')));
 // Different quantities or different recorded days can be additional work.
 const distinct=projectHistoricalProduction([task([batch('a',{cantidad:2}),batch('b',{cantidad:1})])]);
 assert.equal(distinct.candidates.length,2);
});
test('conflicting batch IDs, month hints and normalized overlap require review, never invented dates',()=>{
 const conflict=projectHistoricalProduction([task([batch('same')]),task([batch('same',{cantidad:6})],{id:101})]);
 assert.equal(conflict.candidates.length,0);assert.equal(conflict.pending.length,1);
 const old=projectHistoricalProduction([task([batch()],{title:'QA visit 30/09'})]);
 assert.equal(old.candidates.length,0);assert.equal(old.pending[0].date,'2026-10-26');
 assert.match(old.pending[0].reason,/mes indicado/);
 const migrated=projectHistoricalProduction([task([batch()],{has_normalized_videos:true})]);
 assert.equal(migrated.candidates.length,0);assert.match(migrated.pending[0].reason,/evitar duplicados/);
 const copied=projectHistoricalProduction([task([batch()]),task([batch()],{id:101,has_normalized_videos:true})]);
 assert.equal(copied.candidates.length,0);
});
test('no quantity from scripts, registration time, different users or invalid values',()=>{
 assert.deepEqual(projectHistoricalProduction([task(null),task([])]),{candidates:[],pending:[]});
 for(const change of [{cantidad:0},{cantidad:-1},{cantidad:1.5},{cantidad:'x'},{fecha:'2026-02-30'},
  {created_at:'invalid'},{created_at:'2026-02-30T12:00:00Z'},{created_at:'2026-10-26'},{id:''},{usuario_id:9},{usuario_id:'10'},{usuario:'Líder'}]){
  assert.equal(projectHistoricalProduction([task([batch('x',change)])]).candidates.length,0);
 }
 const identified=projectHistoricalProduction([task([batch('signed',{usuario_id:10,usuario:'Renamed'})])]);
 assert.equal(identified.candidates.length,1);
 const period=projectTeamStatistics(users,identified.candidates,'2026-11')[0];assert.equal(period.count,0);
});
