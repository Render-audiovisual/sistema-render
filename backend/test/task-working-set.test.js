import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workingTaskReadClause } from '../src/task-working-set.js';

test('working set is opt-in and read only, leaving reports and history intact', () => {
  assert.equal(workingTaskReadClause(), '');
  const sql = workingTaskReadClause({ workspace: 'render_os', trabajo_pendiente: 'true' });
  assert.match(sql, /IN \('pendiente','en_progreso','en_revision','aprobada'\)/);
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE/);
  assert.match(sql, /t.estado IN \('finalizada','publicada'\)/);
  assert.match(sql, /finalizada_at/);
  assert.match(sql, /2026-10-29T20:46:32[.]000Z/);
  assert.match(sql, /archivada_render_os/); assert.match(sql, /papelera_render_os/);
});

test('malformed and contradictory archive scopes reject before querying', () => {
  for (const value of [false, true, '', 'false', [], {}, ['true'], 'true\n'])
    assert.throws(() => workingTaskReadClause({ workspace: 'render_os', trabajo_pendiente: value }), { status: 400 });
  for (const key of ['papelera', 'solo_archivadas', 'incluir_archivadas'])
    assert.throws(() => workingTaskReadClause({ workspace: 'render_os', trabajo_pendiente: 'true', [key]: 'true' }), { status: 400 });
  assert.throws(() => workingTaskReadClause({ trabajo_pendiente: 'true' }), { status: 400 });
});

test('route applies working set to shared collection before count, snapshots and pagination', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const route = source.slice(source.indexOf('router.get("/tareas",'));
  assert.match(route, /workingTaskReadClause\(req.query\)/);
  assert.ok(route.indexOf('query += workingTaskClause') < route.indexOf('readTaskBoardPage('));
});
