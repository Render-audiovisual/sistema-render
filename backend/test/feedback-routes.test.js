import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeFeedback } from '../src/feedback-fields.js';

// Execute the actual notes handlers with a fake pool: no server start, migrations,
// timers, messages or database access. This also covers the legacy notes API.
const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const start = source.indexOf('const NOTAS_CATEGORIAS');
const restore = source.indexOf('router.post("/notas/:id/restaurar"', start);
const end = source.indexOf('\n});', restore) + 4;
assert.ok(start > 0 && restore > start && end > restore);
function harness(results = []) {
  const routes = new Map(); const calls = [];
  const router = Object.fromEntries(['get','post','patch','delete'].map((method) => [method, (path, fn) => routes.set(`${method} ${path}`, fn)]));
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return results.shift() || { rows: [] }; } };
  new Function('router','pool','normalizeFeedback','getTaskActor', source.slice(start,end))(router,pool,normalizeFeedback,() => 'empleado');
  return { calls, async run(route, body = {}, query = {}) {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await routes.get(route)({ body, query, params: { id: 8 }, auth: { rol: 'empleado' } }, response, (error) => { throw error; });
    return response;
  } };
}
test('employee can create feedback through shared notes; stores no task state', async () => {
  const h = harness([{ rows: [{ id: 8 }] }]);
  assert.equal((await h.run('post /notas', { titulo: 'Feedback', contenido: 'Texto', feedback: { cliente: 'Cristal' } })).code, 201);
  assert.match(h.calls[0].sql, /INSERT INTO notas_compartidas/);
  assert.equal(JSON.parse(h.calls[0].params[4]).cliente, 'Cristal');
  assert.doesNotMatch(h.calls[0].sql, /INSERT INTO tareas/);
});
test('employee editing another author uses existing version check', async () => {
  const h = harness([{ rows: [{ id: 8, creado_por: 'otro' }] }]);
  assert.equal((await h.run('patch /notas/:id', { contenido: 'Actualizado', feedback: {}, expected_updated_at: '2026-09-18T00:00:00Z' })).code, 200);
  assert.match(h.calls[0].sql, /date_trunc/);
  assert.doesNotMatch(h.calls[0].sql, /creado_por\s*=/);
});
test('legacy PATCH leaves metadata untouched', async () => {
  const h = harness([{ rows: [{ id: 8 }] }]);
  await h.run('patch /notas/:id', { titulo: 'Título anterior' });
  assert.doesNotMatch(h.calls[0].sql.split('RETURNING')[0], /feedback=/);
});
test('concurrent edit rejected, not silently overwritten', async () => {
  const h = harness([{ rows: [] }, { rows: [{ id: 8 }] }]);
  assert.equal((await h.run('patch /notas/:id', { contenido: 'Texto', expected_updated_at: '2026-09-18T00:00:00Z' })).code, 409);
});
test('invalid metadata rejected before query', async () => {
  const h = harness();
  assert.equal((await h.run('post /notas', { feedback: [] })).code, 400);
  assert.equal(h.calls.length, 0);
});
test('new feedback count uses the last seen timestamp and ignores deleted notes', async () => {
  const h = harness([{ rows: [{ cantidad: 2 }] }]);
  const response = await h.run('get /notas/nuevas', {}, { desde: '2026-09-20T12:00:00.000Z' });
  assert.equal(response.code, 200);
  assert.equal(response.data.cantidad, 2);
  assert.match(h.calls[0].sql, /created_at > \$1/);
  assert.match(h.calls[0].sql, /eliminado_at IS NULL/);
});
