import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTaskPagination } from '../src/task-pagination.js';

test('task pagination defaults are bounded and explicit boundaries are canonical', () => {
  assert.deepEqual(parseTaskPagination(), { limit: 100, offset: 0 });
  assert.deepEqual(parseTaskPagination({ limit: '500', offset: '1000000' }), { limit: 500, offset: 1000000 });
  assert.deepEqual(parseTaskPagination({ limit: '1', offset: '0', workspace: 'render_os' }), { limit: 1, offset: 0 });
});

test('malformed pagination never disables LIMIT or silently coerces a different page', () => {
  for (const limit of [null, 100, 0, false, '', '0', '501', '-1', '01', '1.5', '1e2', '100tail', ' 100', '100 ', [], ['1'], {}, '9007199254740992']) {
    assert.throws(() => parseTaskPagination({ limit }), { status: 400 });
  }
  for (const offset of [null, false, 0, '', '-1', '01', '1000001', '1.5', '1e2', [], ['0'], {}]) {
    assert.throws(() => parseTaskPagination({ offset }), { status: 400 });
  }
});

test('actual endpoint always binds pagination and counts empty offsets from the same filtered query', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const route = source.slice(source.indexOf('router.get("/tareas",'), source.indexOf('router.get("/tareas-recomendaciones"'));
  assert.match(route, /parseTaskPagination\(req.query\)/);
  assert.doesNotMatch(route, /parseInt\(limit|if \(limite > 0\)/);
  assert.match(route, /SELECT COUNT\(\*\)::int AS total_count FROM \(\$\{query\}\) AS filtered_tasks/);
  assert.match(route, /const countParams = \[\.\.\.params\]/);
  assert.match(route, /result.rows.length === 0 && desplazamiento > 0/);
  assert.match(route, /pool.query\(countQuery, countParams\)/);
});
