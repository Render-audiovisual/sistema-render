import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { personForTask, taskResponsibleLabels } from './task-formatters.js';

const users = [
  { id: 91004, nombre: 'DesignerQA', usuario: 'designer-qa', rol: 'diseno' },
  { id: 91005, nombre: 'Germán', usuario: 'german-qa', rol: 'produccion' },
  { id: 91006, nombre: 'DesignerQA', usuario: 'other-designer', rol: 'diseno' },
];

test('stale Germán label cannot override actual DesignerQA owner ID for avatar or visible text', () => {
  const task = { asignado_a_id: 91004, asignado_a: 'Germán', propiedades_extra: { colaboradores: ['Germán'] }, colaborador_ids: [] };
  assert.equal(personForTask(task, users), users[0]);
  assert.deepEqual(taskResponsibleLabels(task, users), ['DesignerQA · #91004']);
  assert.doesNotMatch(taskResponsibleLabels(task, users).join(', '), /Germán/);
});

test('homonymous collaborators remain distinct IDs; only duplicate IDs deduplicate in stable order', () => {
  const task = { asignado_a_id: 91004, colaborador_ids: [91006, 91004, 91006, 91005],
    asignado_a: 'stale', propiedades_extra: { colaboradores: ['stale', 'stale'] } };
  assert.deepEqual(taskResponsibleLabels(task, users), ['DesignerQA · #91004', 'DesignerQA · #91006', 'Germán · #91005']);
});

test('missing catalog IDs display ID-only, never borrow a raw name or homonymous catalog entry', () => {
  const task = { asignado_a_id: 99, asignado_a: 'Germán', colaborador_ids: [91004, 100] };
  assert.equal(personForTask(task, users), undefined);
  assert.deepEqual(taskResponsibleLabels(task, users), ['Usuario #99', 'DesignerQA · #91004', 'Usuario #100']);
  assert.deepEqual(taskResponsibleLabels(task), ['Usuario #99', 'Usuario #91004', 'Usuario #100']);
  assert.deepEqual(taskResponsibleLabels(task, null), ['Usuario #99', 'Usuario #91004', 'Usuario #100']);
  const duplicateCatalog = [...users, { id: 91004, nombre: 'Conflicting catalog record' }];
  assert.equal(personForTask({ asignado_a_id: 91004 }, duplicateCatalog), undefined);
  assert.deepEqual(taskResponsibleLabels({ asignado_a_id: 91004 }, duplicateCatalog), ['Usuario #91004']);
});

test('legacy names are explicitly historical/unverified, never resolved by nombre or usuario', () => {
  for (const asignado_a of ['Germán', 'german-qa', 'DesignerQA']) {
    const task = { asignado_a, propiedades_extra: { colaboradores: ['DesignerQA', 'DesignerQA'] } };
    assert.equal(personForTask(task, users), undefined);
    assert.deepEqual(taskResponsibleLabels(task, users), [`Histórico sin verificar: ${asignado_a}`,
      'Histórico sin verificar: DesignerQA', 'Histórico sin verificar: DesignerQA']);
  }
  assert.deepEqual(taskResponsibleLabels(null, users), []);
  assert.deepEqual(taskResponsibleLabels({}, users), []);
  assert.deepEqual(taskResponsibleLabels({ asignado_a: {}, propiedades_extra: { colaboradores: [null, 7, {}, ' '] } }), []);
});

test('ID validation is strict PG integer and user labels safely fall back to username/ID', () => {
  for (const asignado_a_id of ['91004', 0, -1, 1.5, Infinity, 2147483648]) {
    assert.equal(personForTask({ asignado_a_id, asignado_a: 'DesignerQA' }, users), undefined);
  }
  assert.deepEqual(taskResponsibleLabels({ asignado_a_id: 1, colaborador_ids: ['2', null, 0, 2147483648, 2] },
    [{ id: 1, nombre: ' ', usuario: 'valid-user' }, { id: 2, nombre: {}, usuario: null }]), ['valid-user · #1', 'Usuario #2']);
  assert.deepEqual(taskResponsibleLabels({ asignado_a_id: 2147483647 }), ['Usuario #2147483647']);
});

test('display helpers never mutate task, assignments, metadata or users', () => {
  const catalog = Object.freeze(users.map(user => Object.freeze({ ...user })));
  const task = Object.freeze({ asignado_a_id: 91004, asignado_a: 'Germán',
    colaborador_ids: Object.freeze([91006, 91006]), propiedades_extra: Object.freeze({ colaboradores: Object.freeze(['Germán']) }) });
  const before = JSON.stringify({ task, catalog });
  const result = taskResponsibleLabels(task, catalog); result.push('presentation only');
  assert.equal(personForTask(task, catalog), catalog[0]);
  assert.equal(JSON.stringify({ task, catalog }), before);
  assert.equal(taskResponsibleLabels(task, catalog).length, 2);
});

test('actual Workspace display consumers receive catalog; assignment and authorization calls never use labels', () => {
  // Source/AST contracts only: no browser or mounted React claim.
  const source = readFileSync(new URL('../../../pages/WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length, 0);
  const nodes = (root, predicate) => {
    const result = [];
    const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
    visit(root); return result;
  };
  const calls = nodes(file, ts.isCallExpression);
  const labelCalls = calls.filter(call => call.expression.getText(file) === 'taskResponsiblesLabel');
  assert.ok(labelCalls.length >= 5);
  for (const call of labelCalls) assert.equal(call.arguments[1]?.getText(file), 'users');
  assert.match(source, /return taskResponsibleLabels\(task, users\)/);
  assert.match(source, /<Avatar person=\{person\} name=\{primaryLabel\}/);
  assert.match(source, /\{primaryLabel\}\{responsibleLabels.length > 1/);
  assert.match(source, /<TaskCalendar tasks=\{visible\} users=\{users\}/);
  assert.match(source, /<TasksByClient tasks=\{visible\} users=\{users\}/);
  assert.doesNotMatch(source, /<Avatar person=\{person\} name=\{task.asignado_a\}/);
  for (const call of calls.filter(call => /^(canUser|buildTaskAssignmentInput)/.test(call.expression.getText(file)))) {
    assert.doesNotMatch(call.arguments.map(argument => argument.getText(file)).join(','), /taskResponsibleLabels|taskResponsiblesLabel|primaryLabel|personForTask/);
  }
});
