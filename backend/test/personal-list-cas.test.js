import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalListsRouter } from '../src/personal-lists.js';

// Execute actual registered handlers with injected SQL responses; not HTTP/PG tests.
function fixture(query) {
  const routes = new Map(), calls = [];
  const router = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, handler) => routes.set(`${method}:${path}`, handler)]));
  createPersonalListsRouter({ express: { Router: () => router }, pool: { query: async (sql, params) => { calls.push({ sql, params }); return query(sql, params); } } });
  return { calls, async patch(path, body) {
    let status = 200, value;
    const res = { status(code) { status = code; return this; }, json(data) { value = data; return this; } };
    await routes.get(`patch:${path}`)({ auth: { id: 7 }, params: { id: '12' }, body }, res, error => { throw error; });
    return { status, value };
  } };
}
const cases = [
  { path: '/:id', body: { titulo: '  Nuevo   título  ', emoji: '✅' }, table: 'listas_personales', predicate: /AND version=\$5/, increment: /version=version\+1/ },
  { path: '/bloques/:id', body: { tipo: 'texto', contenido: { texto: 'Contenido' } }, table: 'lista_bloques', predicate: /AND b.version=\$5/, increment: /version=b.version\+1/ },
];
for (const item of cases) {
  test(`${item.path}: required canonical numeric positive PG version rejects before DB`, async () => {
    for (const version of [undefined, null, '1', '', 0, -1, 1.5, NaN, Infinity, 2147483648, true, {}, []]) {
      const f = fixture(() => { throw Error('Must not query'); });
      const response = await f.patch(item.path, { ...item.body, expected_version: version });
      assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
    }
    const f = fixture(() => { throw Error('Must not query'); });
    assert.equal((await f.patch(item.path, undefined)).status, 400); assert.equal(f.calls.length, 0);
  });
  test(`${item.path}: atomic owner/version UPDATE increments once and returns actual version`, async () => {
    for (const version of [1, 2147483647]) {
      const f = fixture(() => ({ rowCount: 1, rows: [{ id: 12, version: version + 1 }] }));
      const body = { ...item.body, expected_version: version, usuario_id: 999 }, before = JSON.stringify(body);
      const response = await f.patch(item.path, body);
      assert.equal(response.status, 200); assert.equal(response.value.version, version + 1);
      assert.equal(f.calls.length, 1); assert.match(f.calls[0].sql, item.predicate);
      assert.match(f.calls[0].sql, item.increment); assert.match(f.calls[0].sql, /usuario_id=\$4/);
      assert.deepEqual(f.calls[0].params.slice(2), ['12', 7, version]);
      assert.equal(JSON.stringify(body), before);
      if (item.path === '/:id') assert.equal(f.calls[0].params[0], 'Nuevo título');
      else assert.deepEqual(JSON.parse(f.calls[0].params[1]), { texto: 'Contenido' });
    }
  });
  test(`${item.path}: owned stale is 409, absent or foreign is indistinguishable 404`, async () => {
    for (const owned of [true, false]) {
      const f = fixture(sql => sql.startsWith('UPDATE') ? { rowCount: 0, rows: [] }
        : { rowCount: owned ? 1 : 0, rows: owned ? [{ id: 12 }] : [] });
      const response = await f.patch(item.path, { ...item.body, expected_version: 2 });
      assert.equal(response.status, owned ? 409 : 404); assert.deepEqual(Object.keys(response.value), ['error']);
      assert.equal(f.calls.length, 2); assert.match(f.calls[1].sql, /SELECT/);
      assert.match(f.calls[1].sql, /usuario_id=\$2/); assert.deepEqual(f.calls[1].params, ['12', 7]);
      assert.equal(f.calls.filter(call => call.sql.startsWith('UPDATE')).length, 1);
    }
  });
  test(`${item.path}: malformed content still fails before database; SQL errors propagate`, async () => {
    const f = fixture(() => { throw Error('database failure'); });
    const bad = item.path === '/:id' ? { titulo: ' ' } : { tipo: 'unknown', contenido: {} };
    assert.equal((await f.patch(item.path, { ...bad, expected_version: 1 })).status, 400);
    assert.equal(f.calls.length, 0);
    await assert.rejects(f.patch(item.path, { ...item.body, expected_version: 1 }), /database failure/);
  });
}
