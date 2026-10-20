import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllTaskPages } from '../shared/tasks/fetch-all-task-pages.js';

const rows = (offset, count) => Array.from({ length: count }, (_, index) => ({ id: offset + index + 1, titulo: `Tarea ${offset + index + 1}` }));
const response = (items, total, { ok = true, json } = {}) => ({ ok,
  headers: { get(name) { assert.equal(name, 'X-Total-Count'); return total; } },
  json: json || (async () => items) });

test('loads more than two sequential pages, overrides paging and preserves repeated business filters', async () => {
  const input = '/api/tareas?workspace=render_os&asignado_a_id=7&estado=pendiente&estado=en_progreso&q=audio%20y%20video&limit=1&limit=2&offset=99&offset=100';
  const controller = new AbortController(), calls = []; let inFlight = false;
  const result = await fetchAllTaskPages(input, { signal: controller.signal, request: async (url, options) => {
    assert.equal(inFlight, false); inFlight = true;
    const parsed = new URL(url, 'https://render.test');
    assert.equal(parsed.pathname, '/api/tareas');
    assert.deepEqual(parsed.searchParams.getAll('limit'), ['500']);
    assert.equal(parsed.searchParams.get('workspace'), 'render_os');
    assert.equal(parsed.searchParams.get('asignado_a_id'), '7');
    assert.deepEqual(parsed.searchParams.getAll('estado'), ['pendiente', 'en_progreso']);
    assert.equal(parsed.searchParams.get('q'), 'audio y video');
    assert.equal(options.method, 'GET'); assert.equal(options.signal, controller.signal);
    const offset = Number(parsed.searchParams.get('offset')); calls.push(offset);
    return response(rows(offset, Math.min(500, 1203 - offset)), '1203', { json: async () => {
      await Promise.resolve(); inFlight = false; return rows(offset, Math.min(500, 1203 - offset));
    } });
  } });
  assert.deepEqual(calls, [0, 500, 1000]);
  assert.equal(result.length, 1203); assert.equal(result.at(-1).id, 1203);
  assert.equal(input.includes('offset=99'), true, 'Caller string is unchanged');
});

test('zero and exact page boundaries terminate without an unnecessary extra request', async () => {
  for (const total of [0, 1, 500, 1000]) {
    let calls = 0;
    const result = await fetchAllTaskPages('/api/tareas', { request: async url => {
      calls++; const offset = Number(new URL(url, 'https://render.test').searchParams.get('offset'));
      return response(rows(offset, Math.min(500, total - offset)), String(total));
    } });
    assert.equal(result.length, total); assert.equal(calls, Math.max(1, Math.ceil(total / 500)));
  }
});

test('100000 is complete in 200 pages; larger totals explicitly reject without truncation', async () => {
  let calls = 0;
  const result = await fetchAllTaskPages('/api/tareas', { request: async () => {
    const offset = calls++ * 500; return response(rows(offset, 500), '100000');
  } });
  assert.equal(calls, 200); assert.equal(result.length, 100000);
  await assert.rejects(fetchAllTaskPages('/api/tareas', { request: async () => response([], '100001') }), /100000/);
});

test('unsafe or nonexact endpoint URLs reject before requesting', async () => {
  for (const url of [null, undefined, {}, new URL('https://render.test/api/tareas'), '', 'api/tareas',
    'https://render.test/api/tareas', '//evil.test/api/tareas', '/api/tareas#x', '/api/tareas#',
    '/api/tareas/', '/api/%74areas', '/api/a/../tareas', '/api/./tareas', '/api/tareas-other',
    '/api/tareas\\', '/api/tareas?x=\n', '/api/tareas?x=hello world']) {
    await assert.rejects(fetchAllTaskPages(url, { request: () => { assert.fail('No unsafe URL dispatch'); } }));
  }
});

test('canonical total header is required; invalid arrays and PG IDs fail closed', async () => {
  for (const total of [null, undefined, '', ' 1', '1 ', '01', '+1', '-1', '1.0', '1e2', 'NaN', '1\n', '9007199254740992', 1]) {
    await assert.rejects(fetchAllTaskPages('/api/tareas', { request: async () => response(rows(0, 1), total) }));
  }
  for (const body of [{ items: rows(0, 1) }, null, 'tasks', [], rows(0, 2), [null], [[]],
    ...[0, -1, '1', 1.5, 2147483648, Infinity, undefined].map(id => [{ id }])]) {
    await assert.rejects(fetchAllTaskPages('/api/tareas', { request: async () => response(body, '1') }));
  }
  assert.equal((await fetchAllTaskPages('/api/tareas', { request: async () => response([{ id: 2147483647 }], '1') }))[0].id, 2147483647);
});

test('changed totals, premature empty pages and duplicate IDs never yield partial results', async () => {
  const badSecondPages = [response(rows(500, 1), '502'), response([], '501'), response([{ id: 1 }], '501'),
    response(rows(500, 2), '501'), response(null, '501')];
  for (const second of badSecondPages) {
    let calls = 0;
    await assert.rejects(fetchAllTaskPages('/api/tareas', { request: async () => ++calls === 1 ? response(rows(0, 500), '501') : second }));
    assert.equal(calls, 2);
  }
  await assert.rejects(fetchAllTaskPages('/api/tareas', { request: async () => response([{ id: 1 }, { id: 1 }], '2') }), /duplicados/);
});

test('network, HTTP and JSON failures reject, including after an already valid page', async () => {
  for (const failure of [async () => { throw new Error('network'); }, async () => response([], '501', { ok: false }),
    async () => response([], '501', { json: async () => { throw new SyntaxError('JSON'); } })]) {
    let calls = 0;
    await assert.rejects(fetchAllTaskPages('/api/tareas', { request: async () => ++calls === 1 ? response(rows(0, 500), '501') : failure() }));
    assert.equal(calls, 2);
  }
});

test('abort is checked before dispatch, after ignored-signal transport and after JSON', async () => {
  const initial = new AbortController(); initial.abort();
  await assert.rejects(fetchAllTaskPages('/api/tareas', { signal: initial.signal, request: () => assert.fail('Aborted dispatch') }), { name: 'AbortError' });
  for (const phase of ['response', 'json', 'second-page']) {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(fetchAllTaskPages('/api/tareas', { signal: controller.signal, request: async () => {
      calls++;
      if (phase === 'response') controller.abort();
      if (phase === 'second-page' && calls === 2) controller.abort();
      const total = phase === 'second-page' ? 501 : 1;
      return response([], String(total), { json: async () => {
        if (phase === 'json') controller.abort();
        return rows((calls - 1) * 500, Math.min(500, total - (calls - 1) * 500));
      } });
    } }), { name: 'AbortError' });
    assert.equal(calls, phase === 'second-page' ? 2 : 1);
  }
});

test('input rows remain unmodified and business filter URLs retain encoded values', async () => {
  const row = Object.freeze({ id: 1, propiedades_extra: Object.freeze({ material: 'keep' }) });
  const body = Object.freeze([row]);
  const before = JSON.stringify(body);
  const result = await fetchAllTaskPages('/api/tareas?cliente_id=3&q=a%26b%23c', { request: async url => {
    const params = new URL(url, 'https://render.test').searchParams;
    assert.equal(params.get('q'), 'a&b#c'); assert.equal(params.get('cliente_id'), '3');
    return response(body, '1');
  } });
  assert.notEqual(result, body); assert.equal(JSON.stringify(body), before);
});
