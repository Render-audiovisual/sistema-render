import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPersonalLists} from '../src/personal-lists.js';
test('personal page loads through one scoped read, retaining BIGINT IDs and timestamps',async()=>{
 const calls=[],id='9007199254740993';
 const pool={query:async(sql,values)=>{calls.push({sql,values});return{rows:[{lists:[{id,titulo:'Private',created_at:'2026-11-03T00:00:00+00:00',updated_at:'2026-11-03T00:00:00+00:00'}],sections:[],items:[],blocks:[{id:'9007199254740995',lista_id:id,tipo:'texto',contenido:{texto:'Synthetic'}}]}]};}};
 const data=await loadPersonalLists(pool,17);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].values,[17]);
 assert.match(calls[0].sql,/FROM listas_personales WHERE usuario_id=\$1/);
 assert.equal((calls[0].sql.match(/JOIN own_lists l ON l.id=s.lista_id/g)||[]).length,2);
 assert.match(calls[0].sql,/JOIN own_lists l ON l.id=b.lista_id/);
 assert.match(calls[0].sql,/i.id::text,i.seccion_id::text/);
 assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE)\b/);
 assert.equal(data[0].id,id);assert.equal(data[0].bloques[0].id,'9007199254740995');
 assert.equal(data[0].created_at.toISOString(),'2026-11-03T00:00:00.000Z');
});
test('empty private page has the same empty contract and malformed batches fail closed',async()=>{
 assert.deepEqual(await loadPersonalLists({query:async()=>({rows:[{lists:[],sections:[],items:[],blocks:[]}]})},17),[]);
 await assert.rejects(loadPersonalLists({query:async()=>({rows:[]})},17));
});
