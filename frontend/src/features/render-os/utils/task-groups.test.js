import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTasksByResponsible, groupTasksByClient } from './task-groups.js';

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const ids = group => group.tasks.map(task => task.id);
const group = (groups, key) => { const found = groups.find(item => item.key === key); assert.ok(found, `Missing ${key}`); return found; };
const closed = (groups, identityKey) => {
  for (const item of groups) {
    assert.deepEqual(Object.keys(item).sort(), ['key', identityKey, 'label', 'tasks'].sort());
    assert.equal(typeof item.label, 'string'); assert.ok(Array.isArray(item.tasks));
  }
};

test('responsible groups use stable IDs for homonyms, collaborators and inactive/unknown catalog entries', () => {
  const users = freeze([{ id: 2, nombre: 'Franco', activo: true }, { id: 10, nombre: 'Franco', activo: false }]);
  const tasks = freeze([
    { id: 9, asignado_a_id: 2, colaborador_ids: [10, 10, 2, 99], asignado_a: 'Untrusted legacy label' },
    { id: 3, asignado_a_id: 10, colaborador_ids: [2] },
    { id: 8, asignado_a_id: 99, asignado_a: 'Franco' },
  ]);
  const result = groupTasksByResponsible(tasks, users); closed(result, 'userId');
  assert.deepEqual(ids(group(result, 'user:2')), [9, 3]);
  assert.deepEqual(ids(group(result, 'user:10')), [9, 3]);
  assert.deepEqual(ids(group(result, 'user:99')), [9, 8]);
  assert.equal(group(result, 'user:10').userId, 10, 'Inactive catalog users retain their ID-bound work');
  assert.match(group(result, 'user:2').label, /Franco/); assert.match(group(result, 'user:2').label, /#2$/);
  assert.match(group(result, 'user:10').label, /#10$/);
  assert.notEqual(group(result, 'user:2').label, group(result, 'user:10').label);
  assert.equal(group(result, 'user:99').label, 'Usuario #99');
});

test('catalog rename changes display only; task display names and usernames never select membership', () => {
  const tasks = freeze([{ id: 1, asignado_a_id: 7, asignado_a: 'New name' },
    { id: 2, asignado_a: 'Old name', colaboradores: ['Old name'], responsable: 'Old name' }]);
  const before = groupTasksByResponsible(tasks, freeze([{ id: 7, nombre: 'Old name', usuario: 'login' }]));
  const after = groupTasksByResponsible(tasks, freeze([{ id: 7, nombre: 'New name', usuario: 'different-login' }]));
  for (const result of [before, after]) {
    assert.deepEqual(ids(group(result, 'user:7')), [1]);
    assert.deepEqual(ids(group(result, 'unassigned')), [2]);
    assert.equal(group(result, 'unassigned').label, 'Sin responsable vinculado');
    assert.equal(group(result, 'unassigned').userId, null);
  }
  assert.notEqual(group(before, 'user:7').label, group(after, 'user:7').label);
});

test('conflicting duplicate catalog IDs use neutral ID label independent of catalog order', () => {
  const tasks = freeze([{ id: 1, asignado_a_id: 7 }]);
  const users = freeze([{ id: 7, nombre: 'Alfa' }, { id: 7, nombre: 'Zulu' }, { id: '7', nombre: 'Fake string ID' }]);
  for (const catalog of [users, freeze([...users].reverse())]) {
    const result = groupTasksByResponsible(tasks, catalog);
    assert.equal(result.length, 1); assert.equal(result[0].key, 'user:7');
    assert.equal(result[0].label, 'Usuario #7'); assert.deepEqual(ids(result[0]), [1]);
  }
});

test('invalid owner/member IDs never coerce and collaborator membership is deduplicated per task', () => {
  const invalid = [null, undefined, 0, -1, 1.5, NaN, Infinity, '7', '07', true, {}, [], Number.MAX_SAFE_INTEGER + 1];
  const tasks = freeze(invalid.map((value, index) => ({ id: index + 1, asignado_a_id: value, colaborador_ids: [value], asignado_a: 'Named user' })));
  const result = groupTasksByResponsible(tasks, freeze([{ id: 7, nombre: 'Named user' }]));
  assert.equal(result.length, 1); assert.equal(result[0].key, 'unassigned'); assert.deepEqual(ids(result[0]), tasks.map(task => task.id));
  const members = groupTasksByResponsible(freeze([{ id: 99, asignado_a_id: 7, colaborador_ids: [7, 7, 8, 8, '8', null] },
    { id: 100, asignado_a_id: null, colaborador_ids: [8] }, { id: 101, colaborador_ids: '7' }]), []);
  assert.deepEqual(ids(group(members, 'user:7')), [99]); assert.deepEqual(ids(group(members, 'user:8')), [99, 100]);
  assert.deepEqual(ids(group(members, 'unassigned')), [101]);
});

test('task IDs are strict; duplicates use first complete task without merging later memberships or client metadata', () => {
  const tasks = freeze([null, {}, { id: '1', asignado_a_id: 7 }, { id: 0 }, { id: -1 }, { id: 1.5 },
    { id: Number.MAX_SAFE_INTEGER + 1 }, { id: 4, asignado_a_id: 7, cliente_id: 2, cliente_nombre: 'First client' },
    { id: 4, asignado_a_id: 8, colaborador_ids: [9], cliente_id: 3, cliente_nombre: 'Later client' },
    { id: 5, asignado_a: 'Legacy only' }, { id: 5, asignado_a_id: 8, cliente_id: 3 }]);
  const people = groupTasksByResponsible(tasks, []), clients = groupTasksByClient(tasks);
  assert.deepEqual(people.map(item => item.key), ['user:7', 'unassigned']);
  assert.deepEqual(ids(group(people, 'user:7')), [4]); assert.deepEqual(ids(group(people, 'unassigned')), [5]);
  assert.deepEqual(clients.map(item => item.key), ['client:2', 'unassigned']);
  assert.deepEqual(ids(group(clients, 'client:2')), [4]); assert.deepEqual(ids(group(clients, 'unassigned')), [5]);
});

test('client homonyms remain separate numeric identities and labels carry ID disambiguation', () => {
  const tasks = freeze([{ id: 9, cliente_id: 10, cliente_nombre: 'Same client' },
    { id: 3, cliente_id: 2, cliente_nombre: 'Same client' }, { id: 8, cliente_id: 10, cliente_nombre: 'Same client' }]);
  const result = groupTasksByClient(tasks); closed(result, 'clientId');
  assert.deepEqual(result.map(item => item.clientId), [2, 10], 'Homonym tie-break uses numeric ID, not lexicographic suffix');
  assert.deepEqual(ids(group(result, 'client:10')), [9, 8]); assert.deepEqual(ids(group(result, 'client:2')), [3]);
  assert.match(group(result, 'client:2').label, /#2$/); assert.match(group(result, 'client:10').label, /#10$/);
  const renamed = groupTasksByClient(freeze(tasks.map(task => ({ ...task, cliente_nombre: 'Renamed client' }))));
  assert.deepEqual(renamed.map(item => item.key), result.map(item => item.key));
  assert.deepEqual(renamed.map(ids), result.map(ids)); assert.notEqual(renamed[0].label, result[0].label);
});

test('client invalid/string IDs and legacy names are unassigned; known missing names use ID fallback', () => {
  const tasks = freeze([
    { id: 1, cliente_id: '7', cliente_nombre: 'Known-looking legacy client' },
    { id: 2, cliente_id: 0, cliente_nombre: 'Known-looking legacy client' },
    { id: 3, cliente_id: null, cliente: { id: 7, nombre: 'Do not infer nested identity' } },
    { id: 4, cliente_nombre: 'Known-looking legacy client' },
    { id: 5, cliente_id: 7, cliente_nombre: ' ' }, { id: 6, cliente_id: 8 },
  ]);
  const result = groupTasksByClient(tasks);
  assert.equal(group(result, 'client:7').label, 'Cliente #7'); assert.equal(group(result, 'client:8').label, 'Cliente #8');
  assert.equal(group(result, 'unassigned').label, 'Sin cliente vinculado'); assert.equal(group(result, 'unassigned').clientId, null);
  assert.deepEqual(ids(group(result, 'unassigned')), [1, 2, 3, 4]); assert.equal(result.at(-1).key, 'unassigned');
});

test('both groupings sort human names then numeric IDs, force unassigned last and preserve input task order', () => {
  const users = freeze([{ id: 10, nombre: 'Alfa' }, { id: 2, nombre: 'Alfa' }, { id: 1, nombre: 'Zulu' }]);
  const tasks = freeze([{ id: 9, asignado_a_id: 1, cliente_id: 1, cliente_nombre: 'Zulu' },
    { id: 5 }, { id: 3, asignado_a_id: 10, cliente_id: 10, cliente_nombre: 'Alfa' },
    { id: 8, asignado_a_id: 2, cliente_id: 2, cliente_nombre: 'Alfa' },
    { id: 2, asignado_a_id: 1, cliente_id: 1, cliente_nombre: 'Zulu' }]);
  const people = groupTasksByResponsible(tasks, users), clients = groupTasksByClient(tasks);
  assert.deepEqual(people.map(item => item.key), ['user:2', 'user:10', 'user:1', 'unassigned']);
  assert.deepEqual(clients.map(item => item.key), ['client:2', 'client:10', 'client:1', 'unassigned']);
  assert.deepEqual(ids(group(people, 'user:1')), [9, 2]); assert.deepEqual(ids(group(clients, 'client:1')), [9, 2]);
});

test('positive safe-integer upper boundary is valid, not truncated to a PG int or coerced from strings', () => {
  const max = Number.MAX_SAFE_INTEGER, task = freeze({ id: max, asignado_a_id: max, cliente_id: max });
  const people = groupTasksByResponsible(freeze([task]), []), clients = groupTasksByClient(freeze([task]));
  assert.equal(people[0].key, `user:${max}`); assert.equal(people[0].userId, max);
  assert.equal(clients[0].key, `client:${max}`); assert.equal(clients[0].clientId, max);
  assert.deepEqual(ids(people[0]), [max]); assert.deepEqual(ids(clients[0]), [max]);
});

test('frozen inputs are unchanged; output only reflects received page and shared members do not invent task totals', () => {
  const tasks = freeze([{ id: 91, asignado_a_id: 2, colaborador_ids: [7], cliente_id: 4, cliente_nombre: 'Page client', propiedades_extra: { preserve: true } },
    { id: 92, asignado_a_id: 7, cliente_id: 4, cliente_nombre: 'Page client' }]);
  const users = freeze([{ id: 2, nombre: 'Two' }, { id: 7, nombre: 'Seven' }, { id: 99, nombre: 'Catalog-only person' }]);
  const before = JSON.stringify({ tasks, users });
  const people = groupTasksByResponsible(tasks, users), clients = groupTasksByClient(tasks);
  assert.equal(JSON.stringify({ tasks, users }), before); closed(people, 'userId'); closed(clients, 'clientId');
  assert.equal(people.some(item => item.userId === 99), false);
  assert.equal(people.reduce((sum, item) => sum + item.tasks.length, 0), 3, 'One task can appear in two membership groups, not three distinct tasks');
  assert.deepEqual([...new Set(people.flatMap(ids))].sort((a, b) => a - b), [91, 92]);
  assert.deepEqual(clients.flatMap(ids), [91, 92]);
  assert.deepEqual(groupTasksByResponsible([], users), []); assert.deepEqual(groupTasksByClient([]), []);
});

test('case and Unicode-equivalent homonym labels are disambiguated without collapsing distinct IDs', () => {
  const users = freeze([{ id: 2, nombre: 'Équipo' }, { id: 10, nombre: 'e\u0301QUIPO' }]);
  const tasks = freeze([{ id: 1, asignado_a_id: 2, cliente_id: 2, cliente_nombre: 'CLIENTE' },
    { id: 2, asignado_a_id: 10, cliente_id: 10, cliente_nombre: 'cliente' }]);
  const people = groupTasksByResponsible(tasks, users), clients = groupTasksByClient(tasks);
  assert.deepEqual(people.map(item => item.userId), [2, 10]); assert.deepEqual(clients.map(item => item.clientId), [2, 10]);
  for (const result of [people, clients]) {
    assert.match(result[0].label, /#2$/); assert.match(result[1].label, /#10$/);
    assert.deepEqual(result.map(ids), [[1], [2]]);
  }
});

test('every nonnumeric or unsafe client ID stays unassigned even when its legacy name matches a known client', () => {
  const invalid = [null, undefined, 0, -1, 1.5, NaN, Infinity, '7', '07', true, {}, [], Number.MAX_SAFE_INTEGER + 1];
  const tasks = freeze(invalid.map((cliente_id, index) => ({ id: index + 1, cliente_id, cliente_nombre: 'Same name' })));
  const result = groupTasksByClient(tasks);
  assert.equal(result.length, 1); assert.equal(result[0].key, 'unassigned'); assert.equal(result[0].clientId, null);
  assert.deepEqual(ids(result[0]), tasks.map(task => task.id)); assert.equal(result[0].label, 'Sin cliente vinculado');
});
