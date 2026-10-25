import test from 'node:test';
import assert from 'node:assert/strict';
import { moodboardTaskPageQuery, readMoodboardTaskPage, readMoodboardTaskContext } from '../src/moodboard-task-pages.js';

for (const rol of ['admin','edicion']) test(`${rol}: exact contextual task retains board and ID authorization without pagination`, async () => {
  const calls=[], item={id:152,titulo:'Last task'};
  const result=await readMoodboardTaskContext({query:async(sql,values)=>{calls.push({sql,values});return{rows:[item]};}},
    {id:7,rol,activo:true},'9','152',{});
  assert.deepEqual(result,{version:1,item});
  assert.deepEqual(calls[0].values,rol==='admin'?[9,152]:[9,152,7]);
  assert.match(calls[0].sql,/bc.board_id = \$1 AND t.id = \$2/);
  if(rol!=='admin')assert.match(calls[0].sql,/tarea_asignaciones/);
  assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE|OFFSET|LIMIT)\b/);
});
test('unavailable exact task is generic404 and invalid context rejects before DB', async () => {
  await assert.rejects(readMoodboardTaskContext({query:async()=>({rows:[]})},{id:7,rol:'admin',activo:true},9,152,{}),{status:404});
  const pool={query:()=>assert.fail('Invalid input cannot query')};
  for(const taskId of ['01','0','2147483648','1\n'])await assert.rejects(readMoodboardTaskContext(pool,{},9,taskId,{}),{status:400});
  await assert.rejects(readMoodboardTaskContext(pool,{},9,152,{limit:'1'}),{status:400});
});

test('page query is bounded and canonical; omitted pagination preserves legacy array contract', () => {
  assert.deepEqual(moodboardTaskPageQuery({}), { paginated: false, limit: 150, offset: 0 });
  assert.deepEqual(moodboardTaskPageQuery({limit:'150',offset:'0'}), { paginated: true, limit: 150, offset: 0 });
  for (const query of [{limit:'0'},{limit:'151'},{limit:'01'},{limit:10},{limit:['10']},{offset:'-1'},
    {offset:'1\n'},{offset:'1000001'},{offset:'1.0'},{unknown:'x'},null,[]]) assert.throws(()=>moodboardTaskPageQuery(query),{status:400});
});
for (const rol of ['admin','edicion']) test(`${rol}: read retains ID authorization, bound parameters and stable order`, async () => {
  const rows=Array.from({length:151},(_,index)=>({id:index+1,titulo:`Task ${index}`})), calls=[];
  const pool={async query(sql,values){calls.push({sql,values});return{rows};}};
  const result=await readMoodboardTaskPage(pool,{id:7,rol,session_version:1,activo:true},'9',{limit:'150',offset:'150'});
  assert.equal(result.items.length,150);assert.equal(result.next_offset,300);assert.equal(result.offset,150);
  assert.match(calls[0].sql,/ORDER BY t.titulo,t.id LIMIT \$\d OFFSET \$\d/);
  assert.deepEqual(calls[0].values,rol==='admin'?[9,151,150]:[9,7,151,150]);
  if(rol!=='admin')assert.match(calls[0].sql,/tarea_asignaciones/);
  assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE)\b/);
});
test('empty terminal page and legacy responses do not invent another page', async () => {
  const pool={async query(){return{rows:[]};}};
  assert.deepEqual(await readMoodboardTaskPage(pool,{id:7,rol:'admin',activo:true},9,{offset:'150'}),
    {version:1,items:[],limit:150,offset:150,next_offset:null});
  assert.deepEqual(await readMoodboardTaskPage(pool,{id:7,rol:'admin',activo:true},9,{}),[]);
});
test('invalid query or board rejects before DB access', async () => {
  const pool={query:()=>assert.fail('No query on invalid input')};
  await assert.rejects(readMoodboardTaskPage(pool,{},'01',{}),{status:400});
  await assert.rejects(readMoodboardTaskPage(pool,{},'1',{limit:'NaN'}),{status:400});
});
test('a bounded page never returns an unusable continuation beyond the offset limit', async () => {
  const pool={async query(){return{rows:[{id:1,titulo:'A'},{id:2,titulo:'B'},{id:3,titulo:'C'}]};}};
  await assert.rejects(readMoodboardTaskPage(pool,{id:7,rol:'admin',activo:true},9,{limit:'2',offset:'999999'}),{status:422});
});
