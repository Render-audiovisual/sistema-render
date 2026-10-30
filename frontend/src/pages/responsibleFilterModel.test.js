import test from 'node:test';
import assert from 'node:assert/strict';
import { responsibleFilterId, resolveResponsibleFilter, buildResponsibleOptions, taskMatchesResponsible } from '../features/render-os/utils/task-responsible-filter.js';
import { getTaskViewState, updateTaskViewUrl } from '../features/render-os/utils/task-view-state.js';
const users = [{ id: 1, nombre: 'Luciano', usuario: 'luciano_a' }, { id: 2, nombre: 'Luciano', usuario: 'luciano_b' }, { id: 3, nombre: 'Mariano', usuario: 'Mariano' }];

test('canonical IDs respect PostgreSQL range without coercing names or malformed tokens', () => {
  for (const [token, id] of [['id:1', 1], ['id:2147483647', 2147483647]]) assert.equal(responsibleFilterId(token), id);
  for (const token of [1, null, '1', 'id:0', 'id:01', 'id:-1', 'id:2147483648', 'id:1.0', 'id:1 ', 'Luciano']) assert.equal(responsibleFilterId(token), null);
});

test('legacy recovery waits for catalog and resolves only a unique exact stable identity', () => {
  assert.equal(resolveResponsibleFilter('Mariano', [], false).status, 'pending');
  assert.deepEqual(resolveResponsibleFilter('Mariano', users, true, true), { status: 'resolved', value: 'id:3', ready: false, message: '' });
  assert.equal(resolveResponsibleFilter('luciano_a', users, true, true).value, 'id:1');
  assert.equal(resolveResponsibleFilter('Mariano', users, true, false).ready, false);
  for (const value of ['Luciano', 'luciano', 'Unknown', 'invalid:duplicate', 'id:01']) {
    const selection = resolveResponsibleFilter(value, users, true, true);
    assert.equal(selection.ready, false); assert.ok(selection.message); assert.equal(selection.value, value);
  }
  assert.equal(resolveResponsibleFilter('id:99', [], false).ready, true);
});

test('ID membership includes real collaborators once and never historical labels', () => {
  const task = { asignado_a_id: 1, colaborador_ids: [3, 3], asignado_a: 'Luciano', propiedades_extra: { colaboradores: ['luciano_b'] } };
  assert.equal(taskMatchesResponsible(task, 'id:1'), true);
  assert.equal(taskMatchesResponsible(task, 'id:3'), true);
  assert.equal(taskMatchesResponsible(task, 'id:2'), false);
  assert.equal(taskMatchesResponsible({ asignado_a: 'Luciano' }, 'id:1'), false);
  assert.equal(taskMatchesResponsible(task, 'Luciano'), false);
  assert.equal(taskMatchesResponsible(task, 'all'), true);
});

test('options show names only while retaining distinct stable IDs and missing selections', () => {
  const original = structuredClone(users);
  const options = buildResponsibleOptions(users, [{ asignado_a_id: 9, colaborador_ids: [1, 3], asignado_a: 'Fake label' }], 'id:10');
  assert.equal(new Set(options.map(option => option.value)).size, 5);
  assert.equal(options.find(option => option.value === 'id:1').label, users.find(user=>user.id===1).nombre);
  assert.equal(options.find(option => option.value === 'id:2').label, users.find(user=>user.id===2).nombre);
  assert.ok(options.every(option=>!/[#@·]/.test(option.label)));
  assert.ok(options.find(option => option.value === 'id:10').label.includes('No disponible'));
  assert.ok(!JSON.stringify(options).includes('Fake label'));
  assert.deepEqual(users, original);
});

test('URL keeps stable selection and direct task context; duplicate selectors fail closed', () => {
  const state = getTaskViewState('?responsible=id%3A3&task=51&view=list');
  assert.equal(state.responsible, 'id:3');
  const url = updateTaskViewUrl('https://render.local/workspace/tareas?task=51', state);
  assert.equal(url.searchParams.get('responsible'), 'id:3');
  assert.equal(url.searchParams.get('task'), '51');
  assert.equal(getTaskViewState('?responsible=id%3A1&responsible=id%3A2').responsible, 'invalid:duplicate');
});
