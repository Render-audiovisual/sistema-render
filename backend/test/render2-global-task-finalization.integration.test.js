import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { SYSTEM_USER_ROLES } from '../src/user-roles.js';

test('all authenticated roles can finalize foreign Render OS tasks without acquiring other privileges', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  // Dedicated fresh cluster; never reuse the interactive review PG55991.
  const f = await startLocalHarness({ port: 55993 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' });
    t.diagnostic('Own PG55993 fixture removed; interactive PG55991/HTTP52922 untouched.'); });
  const api = (route, token, method = 'GET', body) => request(f.base, `/api${route}`, { token, method, body });
  const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA finalization client',true) RETURNING id");
  const [publication] = await f.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy) VALUES ($1,'video','lista',CURRENT_DATE,'QA preserved publication') RETURNING id", [client.id]);
  const create = async (state = 'pendiente', workspace = 'render_os', type = 'edicion') => {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,publicacion_id,propiedades_extra)
      VALUES ('QA foreign task','Franco QA',$1,$2,$3,$4::jsonb) RETURNING id,revision`,
    [type, state, publication.id, JSON.stringify({ workspace, private_finance: { secret: 'QA_FINALIZATION_PRIVATE_FINANCE' } })]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91001,'responsable')", [row.id]);
    return row;
  };
  const row = async id => (await f.query('SELECT to_jsonb(t) AS data FROM tareas t WHERE id=$1', [id]))[0]?.data;
  const snapshot = async () => {
    const tables = await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const result = {};
    for (const { tablename } of tables) {
      const quoted = `"${tablename.replaceAll('"', '""')}"`;
      result[tablename] = (await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'[]')) AS hash FROM ${quoted} r`))[0].hash;
    }
    return result;
  };
  const roles = [...SYSTEM_USER_ROLES, 'qa_custom_role'];
  for (const [index, role] of roles.entries()) {
    const id = 92001 + index, usuario = `qa_finalizer_${index}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$2,$3,password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario, role]);
    const token = ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
    for (const state of ['pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizada', 'publicada']) {
      await t.test(`${role}: unrelated task ${state} -> finalizada is state-only and not publication`, async () => {
        const task = await create(state), before = await row(task.id), tablesBefore = await snapshot();
        const result = ok(await api(`/tareas/${task.id}?workspace=render_os`, token, 'PATCH', {
          estado: 'finalizada', expected_revision: task.revision,
        }));
        assert.equal(result.id, task.id); assert.equal(result.estado, 'finalizada');
        if (role !== 'admin') assert.ok(!JSON.stringify(result).includes('QA_FINALIZATION_PRIVATE_FINANCE'));
        const after = await row(task.id);
        for (const field of Object.keys(before).filter(k => !['estado', 'revision', 'updated_at', 'propiedades_extra'].includes(k)))
          assert.deepEqual(after[field], before[field], `Unrelated task field preserved: ${field}`);
        const { finalizada_at: oldTime, ...oldMetadata } = before.propiedades_extra;
        const { finalizada_at: newTime, ...newMetadata } = after.propiedades_extra;
        assert.deepEqual(newMetadata, oldMetadata);
        if (!['finalizada', 'publicada'].includes(state)) assert.ok(newTime);
        else assert.equal(newTime, oldTime, 'Historical completion timestamp is not invented');
        assert.equal(after.revision, before.revision + 1);
        const tablesAfter = await snapshot();
        for (const name of Object.keys(tablesBefore).filter(name => name !== 'tareas'))
          assert.equal(tablesAfter[name], tablesBefore[name], `State-only operation must not mutate ${name}`);
        assert.equal((await api(`/tareas/${task.id}?workspace=render_os`, token, 'PATCH', {
          estado: 'finalizada', expected_revision: task.revision,
        })).status, 409, 'Stale revision never silently succeeds');
      });
    }
    if (role === 'admin') continue; // Existing admin privileges are not revoked by this narrow grant.
    await t.test(`${role}: no content, assignment, delete, approval, publication, historical or financial escalation`, async () => {
      const task = await create(), historical = await create('pendiente', 'historical');
      for (const [route, method, body] of [
        [`/tareas/${task.id}?workspace=render_os`, 'PATCH', { estado: 'finalizada', titulo: 'Unauthorized edit', expected_revision: task.revision }],
        [`/tareas/${task.id}?workspace=render_os`, 'PATCH', { estado: 'finalizada', asignado_a_id: id, expected_revision: task.revision }],
        [`/tareas/${task.id}?workspace=render_os`, 'PATCH', { estado: 'aprobada', expected_revision: task.revision }],
        [`/tareas/${task.id}?workspace=render_os`, 'DELETE', undefined],
        [`/tareas/${task.id}/aprobar-publicacion?workspace=render_os`, 'POST', {}],
        [`/tareas/${historical.id}`, 'PATCH', { estado: 'finalizada', expected_revision: historical.revision }],
        ['/sueldos', 'GET', undefined],
      ]) {
        const before = await snapshot(), result = await api(route, token, method, body);
        assert.ok([400, 403, 404, 409].includes(result.status), `${role} denied ${method} ${route}: ${result.status}`);
        assert.deepEqual(await snapshot(), before, 'Rejected request changes no public-table business data');
      }
    });
  }
  await t.test('anonymous caller cannot finalize', async () => {
    const task = await create(), before = await snapshot();
    assert.equal((await api(`/tareas/${task.id}?workspace=render_os`, null, 'PATCH', { estado: 'finalizada', expected_revision: task.revision })).status, 401);
    assert.deepEqual(await snapshot(), before);
  });
});
