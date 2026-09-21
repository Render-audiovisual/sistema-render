import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../src/wilson-integration.js',import.meta.url),'utf8');
const code=s.slice(s.indexOf('  // Bounded, filtered task reads'),s.indexOf('  router.get("/tareas",'));
async function run(query={},leader=false,rows=[]){let handler,seen;const b={router:{get:(p,f)=>handler=f},pool:{query:async(sql,args)=>{seen={sql,args};return{rows}}},isWilsonLeader:()=>leader,env:{},wilsonPersonAliases:n=>[n.toLowerCase()],taskWithUrl:t=>t};new Function(...Object.keys(b),code)(...Object.values(b));const res={status(c){this.code=c;return this},json(body){this.body=body;return this}};await handler({query,wilson:{actorName:'Luciano'}},res,e=>{throw e});return{...res,seen}}
test('invalid cursor never queries',async()=>{const r=await run({after:'-1'});assert.equal(r.code,400);assert.equal(r.seen,undefined)});
test('nonleader remains restricted even when querying another person',async()=>{const r=await run({persona:'Franco',clientes:'Lavalle,Bendita'});assert.deepEqual(r.seen.args.slice(0,6),[false,['luciano'],false,['franco'],false,['%lavalle%','%bendita%']]);assert.match(r.seen.sql,/\$1::boolean OR LOWER\(t.asignado_a\)=ANY\(\$2::text\[\]\)/)});
test('leader cursor pages return only requested window',async()=>{const r=await run({after:'90'},true,Array.from({length:51},(_,i)=>({id:91+i})));assert.equal(r.body.tasks.length,50);assert.equal(r.body.next_after,140);assert.equal(r.seen.args[7],90);assert.match(r.seen.sql,/tarea_comentarios/)});
