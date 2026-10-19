import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTaskAssignments, replaceTaskAssignments, annotateTaskAssignments } from '../src/task-assignments.js';

const users = [{ id: 1, nombre: 'Renamed', activo: true },
  { id: 2, nombre: 'Editor', activo: true }, { id: 3, nombre: 'Inactive', activo: false },
  { id: 4, nombre: 'Duplicate', activo: true }, { id: 5, nombre: 'Duplicate', activo: true }];
const mock = (rows = users) => ({ calls: [], async query(sql, params) {
  this.calls.push({ sql, params }); return { rows };
} });
const bad = error => error.status === 400;

test('stable IDs win over stale labels; canonical names and deduplicated roles', async () => {
  const db = mock();
  assert.deepEqual(await resolveTaskAssignments(db, { asignado_a_id: 1, asignado_a: 'Old',
    colaborador_ids: [2, 2, 1], colaboradores: ['Ignored'] }), {
    ownerId: 1, ownerName: 'Renamed', collaboratorIds: [2], collaboratorNames: ['Editor'], hasCollaborators: true
  });
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [[1, 2], []]);
});

test('explicit legacy exact unique names or numeric IDs resolve at write boundary', async () => {
  const result = await resolveTaskAssignments(mock(), { asignado_a: 'Renamed', colaboradores: [2] });
  assert.equal(result.ownerId, 1);
  assert.deepEqual(result.collaboratorIds, [2]);
  for (const name of ['Duplicate', 'Inactive', 'Unknown', 'renamed', '', null]) {
    await assert.rejects(resolveTaskAssignments(mock(), { asignado_a: name }), bad);
  }
});

test('invalid, inactive and unknown IDs fail closed including collaborator IDs', async () => {
  for (const id of [0, -1, 1.5, '1', true, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 3, 99]) {
    await assert.rejects(resolveTaskAssignments(mock(), { asignado_a_id: id }), bad);
    await assert.rejects(resolveTaskAssignments(mock(), { asignado_a_id: 1, colaborador_ids: [id] }), bad);
  }
  await assert.rejects(resolveTaskAssignments(mock(), { asignado_a_id: 1, colaborador_ids: null }), bad);
});

test('omitted collaborators differ from explicit clear; optional owner never infers identity', async () => {
  assert.equal((await resolveTaskAssignments(mock(), { asignado_a_id: 1 })).hasCollaborators, false);
  assert.equal((await resolveTaskAssignments(mock(), { asignado_a_id: 1, colaboradores: [] })).hasCollaborators, true);
  await assert.rejects(resolveTaskAssignments(mock(), {}), bad);
  const db = mock();
  assert.deepEqual(await resolveTaskAssignments(db, {}, { requireOwner: false }), {
    ownerId: null, ownerName: null, collaboratorIds: [], collaboratorNames: [], hasCollaborators: false
  });
  assert.equal(db.calls.length, 0);
});

test('replacement uses only caller transaction; validates before delete and propagates errors', async () => {
  const db = mock([]);
  await replaceTaskAssignments(db, 10, { ownerId: 1, collaboratorIds: [1, 2, 2] });
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /^DELETE/);
  assert.deepEqual(db.calls[1].params, [10, [1, 2], ['responsable', 'colaborador']]);
  assert.ok(db.calls.every(call => !/BEGIN|COMMIT|ROLLBACK/.test(call.sql)));
  const invalid = mock();
  await assert.rejects(replaceTaskAssignments(invalid, 10, { ownerId: 1, collaboratorIds: [-2] }), bad);
  assert.equal(invalid.calls.length, 0);
  const empty = mock();
  await replaceTaskAssignments(empty, 10, { ownerId: null, collaboratorIds: [] });
  assert.equal(empty.calls.length, 1);
  const failure = new Error('transaction aborted');
  await assert.rejects(replaceTaskAssignments({ async query() { throw failure; } }, 10,
    { ownerId: 1, collaboratorIds: [] }), error => error === failure);
});

test('annotation batches IDs once, preserves historical labels and never infers from names', async () => {
  const db = mock([{ tarea_id: '10', usuario_id: '1', tipo: 'responsable' },
    { tarea_id: 10, usuario_id: 2, tipo: 'colaborador' }]);
  const rows = [{ id: 10, asignado_a: 'Historical label', propiedades_extra: { colaboradores: ['Old'] } },
    { id: 11, asignado_a: 'Renamed' }];
  const result = await annotateTaskAssignments(db, rows);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [[10, 11]]);
  assert.doesNotMatch(db.calls[0].sql, /usuarios|INSERT|UPDATE/);
  assert.deepEqual(result[0], { ...rows[0], asignado_a_id: 1, colaborador_ids: [2] });
  assert.deepEqual(result[1], { ...rows[1], asignado_a_id: null, colaborador_ids: [] });
  assert.equal(rows[0].asignado_a_id, undefined);
  assert.deepEqual(await annotateTaskAssignments(db, []), []);
  assert.equal(db.calls.length, 1);
});

test('migration constraints and absence of historical backfill', () => {
  const sql = readFileSync(new URL('../migrations/056_task_assignments.sql', import.meta.url), 'utf8');
  assert.match(sql, /REFERENCES tareas\(id\) ON DELETE CASCADE/);
  assert.match(sql, /REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /PRIMARY KEY \(tarea_id, usuario_id\)/);
  assert.match(sql, /CHECK \(tipo IN \('responsable', 'colaborador'\)\)/);
  assert.match(sql, /CREATE UNIQUE INDEX[\s\S]*WHERE tipo = 'responsable'/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE tareas/i);
});
