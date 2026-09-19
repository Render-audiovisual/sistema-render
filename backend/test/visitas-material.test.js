import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isProductionVisitTask} from '../src/production-visits.js';
const src=readFileSync(new URL('../src/wilson-integration.js',import.meta.url),'utf8');
const code=src.slice(src.indexOf('  // Read-only, keyset-paginated intake.'),src.indexOf('  router.get("/tareas",'));
async function run({leader=true,after,rows=[]}={}){
 let fn,query;
 const bindings={router:{get(path,f){assert.equal(path,'/visitas-material');fn=f;}},pool:{async query(sql,args){query={sql,args};return {rows};}},isWilsonLeader:()=>leader,env:{},wilsonPersonAliases:()=>['germán','german'],isProductionVisitTask,taskWithUrl:t=>({...t,url:`task=${t.id}`})};
 new Function(...Object.keys(bindings),code)(...Object.values(bindings));
 const res={statusCode:200,status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;}};
 await fn({query:{after}},res,e=>{throw e;});return {...res,query};
}
test('only leaders can inspect production material and comments',async()=>{
 const r=await run({leader:false});assert.equal(r.statusCode,403);assert.equal(r.query,undefined);
});
test('reject invalid cursors before querying',async()=>{
 for(const after of ['-1','1.2','abc','9007199254740992'])assert.equal((await run({after})).statusCode,400);
});
test('pagination continues past 100 rows even if non-visits occupy page',async()=>{
 const rows=Array.from({length:101},(_,i)=>({id:i+1,tipo_tarea:'produccion',titulo:i===0?'Otra producción':'Visita producción',comentarios:[{contenido:'Drive'}]}));
 const r=await run({rows});assert.equal(r.body.next_after,100);assert.equal(r.body.tasks.length,99);assert.deepEqual(r.body.tasks[0].comentarios,[{contenido:'Drive'}]);
 const last=await run({after:'100',rows:rows.slice(100)});assert.equal(last.body.next_after,null);assert.equal(last.body.tasks[0].id,101);assert.equal(last.query.args[1],100);
 assert.match(r.query.sql,/tarea_comentarios/);assert.match(r.query.sql,/origen_visita_id/);assert.match(r.query.sql,/papelera_render_os/);
});
