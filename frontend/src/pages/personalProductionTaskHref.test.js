import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { personalProductionTaskHref } from './personalHome.js';
import { getTaskViewState } from '../features/render-os/utils/task-view-state.js';
import { buildTaskPageUrl } from '../features/render-os/services/render-os-api.js';

test('personal production navigation carries only stable ID and the actual board sector contract', () => {
  const href = personalProductionTaskHref(91004);
  const state = getTaskViewState(new URL(href, 'http://localhost').search);
  assert.equal(state.view,'list'); assert.equal(state.responsible,'id:91004'); assert.equal(state.sector,'produccion');
  const request = new URL(buildTaskPageUrl(state),'http://localhost');
  assert.equal(request.searchParams.get('asignado_a_id'),'91004');
  assert.equal(request.searchParams.get('tipo_tarea'),'produccion');
  assert.equal(request.searchParams.has('asignado_a'),false);
  for(const id of [null,undefined,'91004','Germán',0,-1,1.2,2147483648,Infinity,NaN,{}]) assert.equal(personalProductionTaskHref(id),null);
});
test('shared home makes the ID-bound production view reachable without hiding other assigned work', () => {
  const source=readFileSync(new URL('./QuickHome.jsx',import.meta.url),'utf8');
  assert.match(source,/Mis tareas de producción/);
  assert.match(source,/href=\{personalProductionTaskHref\(userId\)\}/);
  assert.match(source,/role === 'produccion' \|\| data.monthly_progress\?\.production\?\.total > 0/);
  assert.match(source,/<TaskRows items=\{data.tasks\}/);
});
