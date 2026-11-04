import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {apiWorkspaceTaskPage} from './render-os-api.js';

test('unfiltered workspace loads all 170 current tasks, including states outside the first 50', async()=>{
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async url=>{
    const query=new URL(url,'https://example.test').searchParams;calls.push(query);
    const rows=Array.from({length:170},(_,i)=>({id:i+1,estado:i<50?'pendiente':i<100?'en_progreso':i<150?'en_revision':'finalizada'}));
    return new Response(JSON.stringify(rows.slice(0,Number(query.get('limit')))),{headers:{'X-Total-Count':'170'}});
  };
  try{
    const all=await apiWorkspaceTaskPage({responsible:'all',status:'all'});
    assert.equal(all.items.length,170);assert.equal(all.total,170);
    assert.deepEqual([...new Set(all.items.map(t=>t.estado))],['pendiente','en_progreso','en_revision','finalizada']);
    assert.equal(calls[0].get('limit'),'500');assert.equal(calls[0].get('trabajo_pendiente'),'true');
    assert.ok(!calls[0].has('asignado_a_id'));assert.ok(!calls[0].has('estado'));
    await apiWorkspaceTaskPage({responsible:'id:10',status:'all'});
    assert.equal(calls[1].get('asignado_a_id'),'10');assert.ok(!calls[1].has('estado'));
  }finally{globalThis.fetch=original;}
});

test('clear filters resets responsible, state, overdue, review scope and mobile destination',async()=>{
  const source=await readFile(new URL('../../../pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
  const handler=source.match(/const clearFilters = \(\) => \{([^}]+)\}/)?.[1];
  assert.ok(handler);
  for(const reset of ['setResponsible("all")','setTaskStatus("all")','setQuery("")','setClient("all")','setOverdue(false)',"setReviewScope('')","setMobileBoardColumn('pendiente')"])
    assert.ok(handler.includes(reset),reset);
});
