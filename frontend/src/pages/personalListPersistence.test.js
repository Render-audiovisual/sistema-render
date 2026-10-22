import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./PersonalLists.jsx',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
test('actual page parses and navigation guard reads synchronous queue state before debounce or React repaint',()=>{
  const file=ts.createSourceFile('PersonalLists.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length,0);
  assert.match(source,/useNavigationGuard\(\(\)=>\(\{dirty:Boolean\(queue.current\?\.snapshot\(\).dirty/);
  assert.match(source,/busy:Boolean\(queue.current\?\.snapshot\(\).busy\|\|pendingSaves.current\)/);
  assert.doesNotMatch(source,/timers.current|\.catch\(load\)|catch \{ load\(\)/);
  assert.match(source,/status === 'pending' \? 'Sin guardar'/);
});
test('title/content schedule observed record versions immediately without network-driven draft replacement',()=>{
  const meta=part('  const saveListMeta =','  const deleteList =');
  const block=part('  const changeBlock =','  const deleteBlock =');
  for(const code of [meta,block]){
    assert.match(code,/queue.current\?\.schedule\(/);assert.match(code,/version:current.version/);
    assert.doesNotMatch(code,/load\(|runSaving\(|apiRequest\(/);
  }
  assert.match(source,/aria-label="Título de la página" onChange=\{\(event\) => saveListMeta/);
  assert.doesNotMatch(source,/onBlur=\{\(event\) => saveListMeta/);
  assert.match(source,/hasNewer\?\{\.\.\.value,version:row.version,updated_at:row.updated_at\}/);
});
test('structural operations flush pending edits, freeze editors and reread reorder versions before further edits',()=>{
  const saving=part('  const runSaving =','  const reload =');
  assert.ok(saving.indexOf('await queue.current?.flush()')<saving.indexOf('await operation()'));
  assert.match(saving,/pendingSaves.current \+= 1/);
  assert.match(source,/<fieldset className="personal-editor-lock" disabled=\{structuralBusy\}/);
  assert.match(source,/key=\{list.id\} disabled=\{structuralBusy\}/);
  const move=part('  const moveBlock =','  const saveAsTemplate =');
  assert.ok(move.indexOf("scopedRequest('/api/listas-personales'")>move.indexOf("orden/reordenar"));
  assert.match(move,/queue.current\?\.discard\(\);updateLists/);
});
test('refresh is explicit discard, not an automatic error handler; request identity is captured and unmount aborts',()=>{
  const reload=part('  const reload =','  const createList =');
  assert.ok(reload.indexOf('window.confirm(')<reload.indexOf('queue.current?.discard()'));
  assert.ok(reload.indexOf('queue.current?.discard()')<reload.indexOf('await load()'));
  assert.match(source,/sessionRequestOptions\(binding.current,/);
  assert.match(source,/sessionBindingMatches\(binding.current, getSesion\(\)\)/);
  assert.match(source,/queue.current\?\.dispose\(\)/);assert.match(source,/controller.abort\(\)/);
  assert.equal((source.match(/await apiRequest\(/g)||[]).length,1,'All page API calls pass through the session-scoped transport');
  assert.match(source,/Actualizar desde servidor/);assert.match(source,/Reintentar guardado/);assert.match(source,/Guardar ahora/);
});
