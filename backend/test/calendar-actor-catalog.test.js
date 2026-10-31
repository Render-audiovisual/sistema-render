import test from 'node:test';
import assert from 'node:assert/strict';
import {readCalendar} from '../src/calendar.js';
const auth={id:1,rol:'admin',session_version:1};
const query={desde:'2026-09-28',hasta:'2026-11-02',vista:'publicaciones',limit:'200',offset:'0'};
function fixture(actor={...auth,activo:true,clients:[{id:5,nombre:'Hortícola'}]}){
  const calls=[];
  const db={release(){calls.push({sql:'RELEASE'});},async query(sql,values){calls.push({sql,values});
    if(sql.includes('calendar_actor_catalog'))return{rows:actor?[actor]:[]};
    if(sql.startsWith('WITH '))return{rows:[{total:'0',range_total:'0',fingerprint:'a'.repeat(64),events:[],days:[]}]};
    if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK')return{rows:[]};
    assert.fail('Unexpected extra round trip: '+sql);
  }};
  return{calls,pool:{connect:async()=>db}};
}
test('publication calendar validates actor/catalog together and does not reread clients separately',async()=>{
  const f=fixture(),result=await readCalendar(f.pool,auth,query);
  assert.deepEqual(result.clients,[{id:5,nombre:'Hortícola'}]);assert.deepEqual(result.events,[]);
  assert.equal(f.calls.filter(c=>c.sql!=='RELEASE').length,4);
  const context=f.calls.find(c=>c.sql.includes('calendar_actor_catalog'));
  assert.deepEqual(context.values.slice(0,3),[1,'admin',1]);
  assert.match(context.sql,/u.activo IS TRUE AND u.rol=\$2 AND u.session_version=\$3/);
  assert.match(context.sql,/WHERE c.activo IS DISTINCT FROM FALSE/);
  assert.ok(f.calls[0].sql.includes('REPEATABLE READ READ ONLY'));
});
for(const actor of [null,{...auth,activo:false},{...auth,activo:true,session_version:2},{...auth,activo:true,rol:'edicion'}])test('invalid, revoked or changed actor cannot read calendar rows or return a catalog: '+JSON.stringify(actor),async()=>{
  const f=fixture(actor);await assert.rejects(readCalendar(f.pool,auth,query),{status:401});
  assert.ok(!f.calls.some(c=>c.sql.startsWith('WITH ')));assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'));
});
test('a role outside the system remains forbidden even when its session version matches',async()=>{
  const invalid={...auth,rol:'unknown'},f=fixture({...invalid,activo:true,clients:[]});await assert.rejects(readCalendar(f.pool,invalid,query),{status:403});assert.ok(!f.calls.some(c=>c.sql.startsWith('WITH ')));
});
