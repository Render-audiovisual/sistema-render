import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('canonical client objectives preserve quotas, ID write access and task revision CAS', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const f = await startLocalHarness({ port: 55693 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const owner = await login('qa_franco'), secondOwner = await login('qa_agustin');
  let designer = await login('qa_designer'); const unrelated = await login('qa_luciano');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles) VALUES('QA80 goals client',true,2,1) RETURNING id");
  await f.query("INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe) VALUES($1,'2026-10-01',817293.46)", [client.id]);
  const prepare = { periodo: '2026-10', clave: `cliente-${client.id}`, responsables: [91004], responsables_por_formato: { video: [91004], carrusel: [91004] } };
  const snapshots = async () => ({
    tasks: await f.query('SELECT * FROM tareas ORDER BY id'),
    goals: await f.query('SELECT * FROM cliente_objetivos_mensuales ORDER BY id'),
    pieces: await f.query('SELECT * FROM cliente_objetivo_piezas ORDER BY id'),
    publications: await f.query('SELECT * FROM publicaciones ORDER BY id'),
    events: await f.query('SELECT * FROM editorial_publicacion_eventos ORDER BY id'),
  });
  const goals = async token => ok(await api('/cliente-objetivos?periodo=2026-10', token));
  const selected = data => data.clientes.find(row => row.clave === prepare.clave);
  await t.test('two owners prepare one quota only; employee cannot change monthly assignments', async () => {
    const results = await Promise.all([api('/cliente-objetivos/preparar', owner, 'POST', prepare), api('/cliente-objetivos/preparar', secondOwner, 'POST', prepare)]);
    assert.equal(results.reduce((count, response) => count + ok(response).creadas, 0), 3);
    const goal = selected(await goals(designer));
    assert.equal(goal.piezas.length, 3); assert.equal(goal.reels, 2); assert.equal(goal.carruseles, 1);
    const before = await snapshots();
    assert.equal((await api('/cliente-objetivos/preparar', unrelated, 'POST', prepare)).status, 403);
    assert.deepEqual(await snapshots(), before);
  });
  const piece = selected(await goals(designer)).piezas.find(row => row.tipo === 'carrusel');
  const task = async token => ok(await api(`/tareas/${piece.tarea_id}?workspace=render_os`, token));
  const content = current => ({ titulo: 'QA80 updated design', copy: 'QA80 shared copy', expected_updated_at: current.updated_at, expected_revision: current.revision });
  const endpoint = `/cliente-objetivos/piezas/${piece.id}/contenido`;
  await t.test('employee reads are shared and nonfinancial; reads never create or alter goals', async () => {
    const before = await snapshots();
    for (const token of [designer, unrelated]) {
      const data = await goals(token);
      assert.equal(selected(data).piezas.length, 3);
      assert.ok(!JSON.stringify(data).includes('817293.46'));
      assert.ok(!JSON.stringify(data).includes('abono'));
    }
    assert.deepEqual(await snapshots(), before);
  });
  await t.test('nonmember cannot bypass task write scope through goal content endpoint', async () => {
    const current = await task(unrelated); // Shared reads do not grant writes.
    const before = await snapshots();
    assert.equal((await api(endpoint, unrelated, 'PATCH', content(current))).status, 404);
    assert.deepEqual(await snapshots(), before);
  });
  await t.test('same person remains authorized after a rename; no name impersonation or publication side effect', async () => {
    await f.query("UPDATE usuarios SET nombre='QA80 Designer renamed' WHERE id=91004");
    designer = await login('qa_designer');
    const current = await task(designer);
    const before = await snapshots();
    const saved = ok(await api(endpoint, designer, 'PATCH', content(current)));
    assert.ok(saved.revision > current.revision);
    const latest = await task(secondOwner);
    assert.equal(latest.titulo, 'QA80 updated design'); assert.equal(latest.propiedades_extra.copy_trabajo, 'QA80 shared copy');
    assert.equal(latest.estado, current.estado); assert.equal(latest.asignado_a_id, current.asignado_a_id);
    const after = await snapshots();
    assert.deepEqual(after.publications, before.publications); assert.deepEqual(after.events, before.events);
    const reload = selected(await goals(unrelated)).piezas.find(row => row.id === piece.id);
    assert.equal(reload.copy, 'QA80 shared copy'); assert.equal(reload.titulo, 'QA80 updated design');
  });
  await t.test('required integer revision rejects stale content even with a fresh timestamp; malformed bodies never write', async () => {
    const current = await task(owner), before = await snapshots();
    for (const body of [null, [], { ...content(current), expected_revision: undefined }, { ...content(current), expected_revision: 0 },
      { ...content(current), expected_revision: String(current.revision) }, { ...content(current), estado: 'publicada' }]) {
      assert.equal((await api(endpoint, owner, 'PATCH', body)).status, 400);
    }
    const stale = await api(endpoint, owner, 'PATCH', { ...content(current), expected_revision: current.revision - 1 });
    assert.equal(stale.status, 409);
    assert.deepEqual(await snapshots(), before);
  });
  await t.test('content changes invalidate approval rather than silently retaining it or publishing', async () => {
    let current = await task(owner);
    assert.equal((await api(`/tareas/${piece.tarea_id}?workspace=render_os`, owner, 'PATCH', { estado: 'finalizada', expected_revision: current.revision })).status, 409);
    for (const estado of ['en_progreso', 'en_revision', 'aprobada']) {
      current = await task(owner);
      ok(await api(`/tareas/${piece.tarea_id}?workspace=render_os`, owner, 'PATCH', { estado, expected_revision: current.revision }));
    }
    const approved = await task(designer), before = await snapshots();
    ok(await api(endpoint, designer, 'PATCH', { ...content(approved), copy: 'QA80 changed after approval' }));
    const latest = await task(owner);
    assert.equal(latest.estado, 'en_revision'); assert.equal(latest.propiedades_extra.revision_aprobada, false);
    const goalPiece = selected(await goals(owner)).piezas.find(row => row.id === piece.id);
    assert.equal(goalPiece.estado, 'en_revision'); assert.equal(goalPiece.completada_at, null);
    const after = await snapshots();
    assert.deepEqual(after.publications, before.publications); assert.deepEqual(after.events, before.events);
  });
  await t.test('explicit collaborator membership permits content editing and removal revokes it', async () => {
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'colaborador')", [piece.tarea_id]);
    const current = await task(unrelated);
    ok(await api(endpoint, unrelated, 'PATCH', { ...content(current), copy: 'QA80 explicit collaborator' }));
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003', [piece.tarea_id]);
    const latest = await task(unrelated), before = await snapshots();
    assert.equal((await api(endpoint, unrelated, 'PATCH', content(latest))).status, 404);
    assert.deepEqual(await snapshots(), before);
  });
  await t.test('competing content edits have one winner and one conflict; removal of assignment revokes content writes', async () => {
    const current = await task(owner);
    const responses = await Promise.all([owner, secondOwner].map((token, index) => api(endpoint, token, 'PATCH', { ...content(current), copy: `QA80 concurrent ${index}` })));
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    const winner = responses.find(row => row.status === 200);
    assert.equal((await task(owner)).revision, winner.body.revision);
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91004', [piece.tarea_id]);
    const latest = await task(designer), before = await snapshots();
    assert.equal((await api(endpoint, designer, 'PATCH', content(latest))).status, 404);
    assert.deepEqual(await snapshots(), before);
  });
});
