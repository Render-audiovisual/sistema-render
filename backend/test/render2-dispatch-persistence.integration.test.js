import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('shared dispatch preparation persists without inventing real publication', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55689 });
  t.after(async () => { await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT'); });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const response = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(response.status, 200); return response.body.token;
  };
  const owner = await login('qa_franco'), otherOwner = await login('qa_agustin'), employee = await login('qa_luciano');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA shared preparation') RETURNING id");
  const [piece] = await fixture.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada) VALUES($1,'video','pendiente','2026-10-22') RETURNING *", [client.id]);
  const body = { clientId: client.id, publicationId: piece.id, type: 'reel', caption: 'Synthetic draft', platforms: { instagram: true },
    materials: ['https://drive.google.com/file/d/synthetic-test/view'], scheduledAt: '2026-10-22T12:00:00Z', mode: 'draft', requestKey: 'qa-dispatch-persistence-75' };
  const created = await api('/publicacion-envios', { token: owner, method: 'POST', body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'borrador'); assert.equal(created.body.previewOnly, true);
  const read = await api('/publicacion-envios?estado=borrador', { token: otherOwner });
  assert.equal(read.status, 200); assert.ok(read.body.some(row => String(row.id) === String(created.body.id)));
  const duplicate = await api('/publicacion-envios', { token: owner, method: 'POST', body });
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.id, created.body.id);
  const scheduled = await api(`/publicacion-envios/${created.body.id}`, { token: otherOwner, method: 'PATCH', body: { ...body, mode: 'schedule' } });
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body)); assert.equal(scheduled.body.status, 'programada');
  const [unchanged] = await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [piece.id]);
  assert.deepEqual(unchanged, piece, 'dispatch preparation must not change editorial state or real publication evidence');
  assert.equal((await api('/publicacion-envios', { token: employee })).status, 403);
  assert.equal((await api('/publicacion-envios', { token: employee, method: 'POST', body })).status, 403);
  assert.equal((await api('/publicacion-envios', { token: owner, method: 'POST', body: { ...body, clientId: 9999999, requestKey: 'qa-dispatch-missing-client-75' } })).status, 404);
  const [count] = await fixture.query('SELECT count(*)::int AS total FROM publicacion_envios'); assert.equal(count.total, 1);
  t.diagnostic('Two server-verified owners share one persisted dispatch; employee denied; no Meta call or actual publication.');
});
