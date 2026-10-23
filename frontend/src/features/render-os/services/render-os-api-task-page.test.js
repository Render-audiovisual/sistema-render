import test from 'node:test';
import assert from 'node:assert/strict';
import { apiTaskPage } from './render-os-api.js';

// Only synthetic fetch responses: no listener, database or runtime session.
test('normal pages validate complete arrays and canonical totals, including empty/beyond-end pages', async () => {
  const original = globalThis.fetch;
  try {
    for (const { items, total, options } of [
      { items: [{ id: 1 }, { id: 2147483647 }], total: '3', options: { limit: 2 } },
      { items: [{ id: 3 }], total: '3', options: { limit: 2, offset: 2 } },
      { items: [], total: '0', options: {} },
      { items: [], total: '3', options: { offset: 100 } },
      { items: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })), total: '51', options: {} },
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(items), { headers: { 'X-Total-Count': total } });
      assert.deepEqual(await apiTaskPage(options), { items, total: Number(total) });
    }
  } finally { globalThis.fetch = original; }
});

test('normal pages reject malformed bodies, IDs, duplicate IDs, totals and incomplete/overfull pages', async () => {
  const original = globalThis.fetch;
  const bad = [
    { raw: '{', total: '0' },
    ...[null, {}, { items: [] }, 'not an array'].map(body => ({ body, total: '0' })),
    ...[null, {}, [], { id: '1' }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: 2147483648 }]
      .map(item => ({ body: [item], total: '1' })),
    { body: [{ id: 1 }, { id: 1 }], total: '2' },
    ...[undefined, '', '01', '-1', '1.0', '1x', '1e2', '9007199254740992'].map(total => ({ body: [], total })),
    { body: [], total: '1' },
    { body: [{ id: 1 }], total: '2' },
    { body: [{ id: 1 }, { id: 2 }], total: '2', options: { limit: 1 } },
    { body: [{ id: 1 }], total: '0' },
    { body: [{ id: 1 }], total: '1', options: { offset: 2 } },
  ];
  try {
    for (const fixture of bad) {
      globalThis.fetch = async () => new Response(fixture.raw ?? JSON.stringify(fixture.body), {
        headers: fixture.total === undefined ? {} : { 'X-Total-Count': fixture.total },
      });
      await assert.rejects(apiTaskPage(fixture.options), { message: 'No se pudo verificar la página de tareas.' });
    }
    // Headers normalizes outer whitespace; a transport exposing it must still fail closed.
    for (const count of ['1\n', ' 1', '1 ', '1\r\n']) {
      globalThis.fetch = async () => ({ ok: true, json: async () => [{ id: 1 }], headers: { get: () => count } });
      await assert.rejects(apiTaskPage(), { message: 'No se pudo verificar la página de tareas.' });
    }
  } finally { globalThis.fetch = original; }
});

test('normal page HTTP errors retain status/message even with malformed error JSON or missing totals', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [400, 401, 403, 409, 500]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Rechazo controlado' }), { status });
      await assert.rejects(apiTaskPage(), { status, message: 'Rechazo controlado' });
      globalThis.fetch = async () => new Response('{', { status });
      await assert.rejects(apiTaskPage(), { status, message: 'No se pudieron cargar las tareas.' });
    }
  } finally { globalThis.fetch = original; }
});
