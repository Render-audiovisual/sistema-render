import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('stories principal persistence, planning distinction and safe legacy flyer conversion', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const f = await startLocalHarness({ port: 55691 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const api = (path, options) => request(f.base, `/api${path}`, options);
  const login = async usuario => { const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }); assert.equal(result.status, 200); return result.body.token; };
  const owner = await login('qa_franco'), otherOwner = await login('qa_agustin'), employee = await login('qa_designer');
  const [client] = await f.query("INSERT INTO clientes(nombre) VALUES ('QA78 Historias') RETURNING id");
  const create = await api('/piezas', { token: owner, method: 'POST', body: { tipo: 'historia', cliente_id: client.id,
    responsable_id: 91004, fecha_programada: '2026-10-22', estado: 'pendiente', idea: 'QA story', copy: 'Initial copy' } });
  assert.equal(create.status, 201, JSON.stringify(create.body)); const storyId = create.body.id;
  await t.test('story and linked task use real assignment; date, metadata and empty text persist across users', async () => {
    const tasks = await f.query(`SELECT t.id,a.usuario_id FROM tareas t JOIN tarea_asignaciones a ON a.tarea_id=t.id
      WHERE t.historia_id=$1 AND a.tipo='responsable'`, [storyId]);
    assert.equal(tasks.length, 1); assert.equal(tasks[0].usuario_id, 91004);
    const home = await api('/inicio', { token: employee }); assert.equal(home.status, 200);
    assert.ok(home.body.tasks.some(row => row.id === tasks[0].id), 'new linked task must reach the actual responsible personal Home');
    const patched = await api(`/historias/${storyId}`, { token: otherOwner, method: 'PATCH', body: {
      fecha_programada: '2026-10-24', metadata: { tipo: 'Producto', hora: '10:30' }, copy: '', idea: '', material_referencia: '', aclaraciones: '', notas_planificacion: '' } });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    const listed = await api('/historias', { token: employee }); assert.equal(listed.status, 200);
    const saved = listed.body.find(row => row.id === storyId); assert.equal(saved.copy, ''); assert.equal(saved.idea, '');
    assert.equal(saved.fecha_programada, '2026-10-24'); assert.equal(saved.metadata.hora, '10:30');
    const before = (await f.query('SELECT * FROM historias WHERE id=$1', [storyId]))[0];
    assert.equal((await api(`/historias/${storyId}`, { token: owner, method: 'PATCH', body: { copy: { unsafe: true } } })).status, 400);
    assert.deepEqual((await f.query('SELECT * FROM historias WHERE id=$1', [storyId]))[0], before);
    assert.equal((await api(`/historias/${storyId}`, { token: employee, method: 'PATCH', body: { copy: 'Denied' } })).status, 403);
  });
  await t.test('weekly theme and daily planning check do not manufacture a real publication', async () => {
    const before = (await f.query('SELECT * FROM historias WHERE id=$1', [storyId]))[0];
    const structure = await api('/estructura', { token: owner, method: 'POST', body: { cliente_id: client.id, dia_semana: 4, tema: 'QA product', horario: '10:30' } });
    assert.equal(structure.status, 201);
    const check = await api('/check-publicacion', { token: owner, method: 'POST', body: { cliente_id: client.id, fecha: '2026-10-24', publicado: true } });
    assert.equal(check.status, 200); assert.equal(check.body.publicado, true);
    assert.deepEqual((await f.query('SELECT * FROM historias WHERE id=$1', [storyId]))[0], before);
    assert.equal((await f.query('SELECT count(*)::int AS n FROM editorial_publicacion_eventos'))[0].n, 0);
    assert.equal((await api('/estructura', { token: employee, method: 'POST', body: { cliente_id: client.id, dia_semana: 4, tema: 'Denied' } })).status, 403);
  });
  const seedFlyer = async (idea, state = 'pendiente') => (await f.query(`INSERT INTO publicaciones
    (cliente_id,tipo,estado,fecha_programada,responsable,idea,copy,metadata)
    VALUES($1,'flyer',$2,'2026-10-22','Designer QA',$3,'Flyer copy','{"original":"preserve"}') RETURNING *`, [client.id, state, idea]))[0];
  await t.test('parallel conversion makes one story and preserves full source snapshot, never duplicates', async () => {
    const flyer = await seedFlyer('QA78 safe flyer');
    const results = await Promise.all([owner, otherOwner].map(token => api(`/historias/convertir-flyer/${flyer.id}`, { token, method: 'POST' })));
    assert.deepEqual(results.map(row => row.status).sort(), [201, 404]);
    const converted = results.find(row => row.status === 201).body;
    assert.equal(converted.estado, flyer.estado); assert.equal(Object.hasOwn(converted, 'metadata'), false);
    const [record] = await f.query('SELECT metadata FROM historias WHERE id=$1', [converted.id]);
    assert.equal(record.metadata.flyer_origen.idea, flyer.idea); assert.equal(record.metadata.original, 'preserve');
    const employeeView = await api('/historias', { token: employee });
    const projected = employeeView.body.find(row => row.id === converted.id);
    assert.ok(projected); assert.equal(Object.hasOwn(projected.metadata || {}, 'flyer_origen'), false);
    assert.equal((await f.query('SELECT id FROM publicaciones WHERE id=$1', [flyer.id])).length, 0);
    assert.equal((await f.query("SELECT id FROM historias WHERE metadata->>'migrada_desde_flyer_id'=$1", [String(flyer.id)])).length, 1);
  });
  await t.test('linked and historical flyers are retained instead of cascading tasks or rewriting history', async () => {
    const linked = await seedFlyer('QA78 linked flyer'), historical = await seedFlyer('QA78 historical flyer', 'publicada');
    await f.query("INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id) VALUES('QA preserve linked task','Designer QA',$1,$2)", [client.id, linked.id]);
    const snapshot = async () => ({ stories: await f.query('SELECT * FROM historias ORDER BY id'), pieces: await f.query('SELECT * FROM publicaciones ORDER BY id'), tasks: await f.query('SELECT * FROM tareas ORDER BY id') });
    const before = await snapshot();
    for (const piece of [linked, historical]) {
      const rejected = await api(`/historias/convertir-flyer/${piece.id}`, { token: owner, method: 'POST' });
      assert.equal(rejected.status, 409); assert.equal(rejected.body.code, 'FLYER_REQUIRES_REVIEW');
      assert.deepEqual(await snapshot(), before);
    }
    assert.equal((await api(`/historias/convertir-flyer/${linked.id}`, { token: employee, method: 'POST' })).status, 403);
  });
  await t.test('failure after story INSERT rolls back both conversion steps', async () => {
    const flyer = await seedFlyer('QA force conversion rollback');
    await f.query(`CREATE FUNCTION qa78_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.idea='QA force conversion rollback' THEN RAISE EXCEPTION 'synthetic conversion rejection'; END IF; RETURN OLD; END $$`);
    await f.query('CREATE TRIGGER qa78_reject_delete BEFORE DELETE ON publicaciones FOR EACH ROW EXECUTE FUNCTION qa78_reject_delete()');
    const before = await f.query('SELECT * FROM historias ORDER BY id');
    assert.equal((await api(`/historias/convertir-flyer/${flyer.id}`, { token: owner, method: 'POST' })).status, 500);
    assert.deepEqual(await f.query('SELECT * FROM historias ORDER BY id'), before);
    assert.equal((await f.query('SELECT id FROM publicaciones WHERE id=$1', [flyer.id])).length, 1);
  });
});
