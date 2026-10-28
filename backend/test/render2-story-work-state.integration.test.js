import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('synthetic story state control persists existing IDs without fabricating publication', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55993 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' });
    t.diagnostic('Own synthetic story fixture PG55993 removed; interactive55991 untouched.'); });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), employee = await login('qa_luciano');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA isolated story account',true) RETURNING id");
  const [story] = await f.query(`INSERT INTO historias(cliente_id,fecha_programada,estado,idea,copy)
    VALUES ($1,CURRENT_DATE,'pendiente','QA independent story','QA unchanged copy') RETURNING id`, [client.id]);
  const read = async () => ok(await api(`/piezas/${story.id}?dominio=historia`, admin));
  const physical = async () => (await f.query('SELECT to_jsonb(h) AS data FROM historias h WHERE id=$1', [story.id]))[0].data;
  for (const estado of ['bloqueada', 'en_diseño']) await t.test(`${estado}: actual PATCH, fresh GET and unchanged publication evidence`, async () => {
    const current = await read();
    const saved = ok(await api(`/historias/${story.id}`, admin, 'PATCH', { estado, expected_revision: current.revision }));
    assert.equal(saved.estado, estado); assert.equal((await read()).estado, estado);
    const row = await physical(); assert.equal(row.copy, 'QA unchanged copy'); assert.equal(row.cliente_id, client.id);
    assert.equal(row['fecha_publicación_real'], null);
    assert.deepEqual(await f.query("SELECT id FROM editorial_publicacion_eventos WHERE dominio='historia' AND pieza_id=$1", [story.id]), []);
  });
  await t.test('no invented state, publication shortcut, stale write or employee authority', async () => {
    const current = await read(), before = await physical();
    for (const [token, estado, revision, status] of [
      [admin, 'en_proceso', current.revision, 400], [admin, 'publicada', current.revision, 409],
      [admin, 'bloqueada', current.revision - 1, 409], [employee, 'bloqueada', current.revision, 403],
    ]) {
      ok(await api(`/historias/${story.id}`, token, 'PATCH', { estado, expected_revision: revision }), status);
      assert.deepEqual(await physical(), before);
    }
  });
});
