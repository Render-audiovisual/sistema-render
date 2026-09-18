import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as production from '../src/production-visits.js';
import { buildTaskAccessClause, getTaskActor } from '../src/task-access.js';

const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const routeSource = source.slice(source.indexOf('router.post("/tareas/:id/produccion/registros"'), source.indexOf('\nasync function confirmProductionVisit'));
async function register(body, metadata = {}, auth = { nombre: 'Germán', rol: 'produccion' }) {
  let handler; let updated = null;
  const task = { id: 1753, titulo: 'Moketa | Visita producción', tipo_tarea: 'produccion', asignado_a: 'Germán', updated_at: '2026-09-16T10:00:00Z', propiedades_extra: metadata };
  const client = { release() {}, async query(sql, args) {
    if (sql.includes('SELECT')) return { rows: [task] };
    if (sql.includes('UPDATE tareas')) { updated = { ...task, estado: args[2], propiedades_extra: { ...metadata, ...JSON.parse(args[1]) } }; return { rows: [updated] }; }
    return { rows: [] };
  }};
  const bindings = { router: { post(_path, fn) { handler = fn; } }, pool: { async connect() { return client; } }, ...production, buildTaskAccessClause, getTaskActor };
  new Function(...Object.keys(bindings), routeSource)(...Object.values(bindings));
  const response = { code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body, auth, params: { id: '1753' } }, response, error => { throw error; });
  return { ...response, updated };
}
test('Moketa: actual count without a planned count can complete the visit and stays in September', async () => {
  const result = await register({ cantidad: 3, fecha: '2026-09-16', finalizar: true });
  assert.equal(result.code, 201);
  assert.equal(result.updated.estado, 'en_revision');
  assert.equal(result.updated.propiedades_extra.produccion_registros[0].cantidad, 3);
  assert.equal(result.updated.propiedades_extra.produccion_registros[0].cantidad_adelanto, undefined);
  assert.equal(result.updated.propiedades_extra.produccion_confirmada_at, null);
  assert.equal(production.isProductionComplete(result.updated), true);
});
test('saving a partial unplanned recording does not complete it', async () => {
  const result = await register({ cantidad: 2, fecha: '2026-09-16' });
  assert.equal(result.code, 201);
  assert.equal(result.updated.estado, 'en_progreso');
  assert.equal(production.isProductionComplete(result.updated), false);
});
test('finishing already registered work does not count the videos a second time', async () => {
  const result = await register({ cantidad: 0, fecha: '2026-09-16', finalizar: true }, { produccion_registros: [{ cantidad: 3, fecha: '2026-09-16' }] });
  assert.equal(result.code, 201);
  assert.equal(result.updated.propiedades_extra.produccion_registros.length, 1);
  assert.equal(production.getProductionProgress(result.updated).recorded, 3);
});
test('stale submissions and finished visits cannot add duplicate recordings', async () => {
  assert.equal((await register({ cantidad: 3, fecha: '2026-09-16', expected_updated_at: '2026-09-15' })).code, 409);
  assert.equal((await register({ cantidad: 3, fecha: '2026-09-16' }, { produccion_confirmada_at: '2026-09-16' })).code, 409);
});
test('invalid counts, empty completed visits and unauthorized roles are rejected', async () => {
  for (const cantidad of [-1, 1.5, 'no', Number.MAX_SAFE_INTEGER + 1]) assert.equal((await register({ cantidad, fecha: '2026-09-16', finalizar: true })).code, 400);
  assert.equal((await register({ cantidad: 0, fecha: '2026-09-16', finalizar: true })).code, 400);
  assert.equal((await register({ cantidad: 3, fecha: '2026-09-16' }, {}, { nombre: 'Luciano', rol: 'edicion' })).code, 403);
});
