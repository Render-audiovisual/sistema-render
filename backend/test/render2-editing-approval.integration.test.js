import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const binding = 'revision_aprobada_entrega_id';
test('editing approval: explicitly observed latest artifact, atomic task CAS and immutable legacy history', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55617, deferEditingApprovalMigration: true });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own editing-approval fixture stopped and removed: ${fixture.root}`);
  });
  const checked = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const api = (path, token = admin, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const login = async usuario => checked(await request(fixture.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const admin = await login('qa_franco');
  for (const [id, role] of [[109001, 'edicion'], [109002, 'community'], [109003, 'admin']]) await fixture.query(`INSERT INTO usuarios
    (id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,$2,'QA editing approval identity',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa_approval_${id}`, role]);
  const editor = await login('qa_approval_109001'); const leader = await login('qa_approval_109003');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA concrete artifact approval') RETURNING id");
  const [publication] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy)
    VALUES ($1,'video','lista','2026-10-29','QA preserved publication copy') RETURNING id`, [client.id]);
  const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales(clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
    VALUES ('qa-approval-066','2026-10-01',$1,'QA approval work objective',50,0,'QA fixture') RETURNING id`, [client.id]);
  let serial = 0;
  const row = async id => (await fixture.query('SELECT * FROM tareas WHERE id=$1', [id]))[0];
  const detail = async id => checked(await api(`/tareas/${id}?workspace=render_os`));
  const taskBody = extra => ({ titulo: `QA explicit artifact ${++serial}`, workspace: 'render_os', cliente_id: client.id,
    tipo_tarea: 'edicion', subtipo: 'video', asignado_a_id: 109001, colaborador_ids: [],
    material_referencia: 'https://example.invalid/raw-preserved', aclaraciones: 'QA preserved working script',
    fecha_vencimiento: '2026-10-25', ...extra });
  const create = async (extra = {}) => checked(await api('/tareas', admin, 'POST', taskBody(extra)), 201);
  const delivery = async id => {
    const body = { request_id: randomUUID(), expected_revision: (await row(id)).revision,
      url: `https://example.invalid/version-${randomUUID()}`, notes: 'QA explicitly delivered artifact' };
    const result = checked(await api(`/tareas-edicion/${id}/entregas`, editor, 'POST', body), 201);
    return { id: result.delivery_id, body, result };
  };
  const approve = (id, mode, revision, entrega, token = admin, extra = {}) => api(
    mode === 'patch' ? `/tareas/${id}?workspace=render_os` : `/tareas/${id}/aprobar-publicacion?workspace=render_os`, token,
    mode === 'patch' ? 'PATCH' : 'POST', {
      expected_revision: revision, ...(mode === 'patch' ? { estado: 'aprobada' } : { responsable_publicacion_id: 109002 }),
      ...(entrega === undefined ? {} : { expected_entrega_id: entrega }), ...extra,
    });
  const snapshot = async () => {
    const result = {};
    for (const table of ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', 'task_editing_deliveries',
      'publicaciones', 'historias', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
      'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      result[table] = await fixture.query(`SELECT to_jsonb(r) AS row FROM ${table} r ORDER BY to_jsonb(r)::text`);
    return result;
  };
  const editorial = () => fixture.query('SELECT id,estado,"fecha_publicación_real",fecha_programada,copy FROM publicaciones WHERE cliente_id=$1 ORDER BY id', [client.id]);
  const seedReview = async () => {
    const task = await create(); const version = await delivery(task.id); return { task, version };
  };
  const old = await create({ publicacion_id: publication.id });
  await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,copy)
    VALUES ($1,'video',1,$2,$3,'QA historical slot','QA preserved publication copy')`, [goal.id, old.id, publication.id]);
  // Historical approval is inserted as an old row, never inferred from an event.
  const [historical] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,propiedades_extra)
    VALUES ('QA historical approved without binding','QA fixture',$1,'edicion','aprobada',
      '{"workspace":"render_os","revision_aprobada":true,"revision_aprobada_por_id":91001}') RETURNING id`, [client.id]);
  const [legacyEvent] = await fixture.query(`INSERT INTO task_editing_deliveries
    (id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes)
    VALUES ($1,$2,109001,$3,$4,$5,'https://example.invalid/historical-version','QA historical delivery') RETURNING id`,
  [randomUUID(), old.id, randomUUID(), 'a'.repeat(64), old.revision]);
  await t.test('066 changes only trigger behavior; populated tasks/deliveries/goal/editorial history unchanged', async () => {
    const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^066_.*\.sql$/.test(name));
    assert.equal(files.length, 1); assert.deepEqual(await fixture.query('SELECT nombre FROM _migrations WHERE nombre=$1', [files[0]]), []);
    const before = await snapshot(); await fixture.query(await readFile(new URL(`../migrations/${files[0]}`, import.meta.url), 'utf8'));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await row(historical.id)).propiedades_extra[binding], undefined);
    assert.equal((await fixture.query('SELECT id FROM task_editing_deliveries WHERE id=$1', [legacyEvent.id]))[0].id, legacyEvent.id);
    await fixture.query('INSERT INTO _migrations(nombre) VALUES ($1)', [files[0]]);
  });
  for (const mode of ['patch', 'publisher']) {
    await t.test(`${mode}: missing/foreign/older IDs409 and malformed UUID400 roll back task, goal and assignments`, async () => {
      const [piece] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy)
        VALUES ($1,'video','lista','2026-10-29','QA independent approval piece') RETURNING id`, [client.id]);
      const candidate = await create({ publicacion_id: piece.id });
      await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo)
        VALUES ($1,'video',$2,$3,$4,'QA atomic approval slot')`, [goal.id, ++serial, candidate.id, piece.id]);
      const first = await delivery(candidate.id); const latest = await delivery(candidate.id); const foreign = await seedReview();
      const revision = (await row(candidate.id)).revision;
      for (const [id, status] of [[undefined, 409], [null, 409], [first.id, 409], [foreign.version.id, 409], ['bad', 400]]) {
        const before = await snapshot(); assert.equal((await approve(candidate.id, mode, revision, id)).status, status);
        assert.deepEqual(await snapshot(), before, `${mode} invalid artifact must roll back every related write`);
      }
      const beforeEditorial = await editorial();
      const approved = checked(await approve(candidate.id, mode, revision, latest.id));
      assert.equal(approved.estado, 'aprobada'); assert.equal(approved.propiedades_extra[binding], latest.id);
      assert.equal(approved.propiedades_extra.revision_aprobada, true);
      assert.equal((await row(candidate.id)).revision, revision + 1);
      assert.deepEqual(await editorial(), beforeEditorial);
      if (mode === 'publisher') {
        const bindings = await fixture.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [candidate.id]);
        assert.deepEqual(bindings, [{ usuario_id: 109001, tipo: 'colaborador' }, { usuario_id: 109002, tipo: 'responsable' }]);
      }
      const reloaded = checked(await api(`/tareas/${candidate.id}?workspace=render_os`, await login('qa_approval_109001')));
      assert.equal(reloaded.propiedades_extra[binding], latest.id);
      checked(await api(`/tareas/${candidate.id}?workspace=render_os`, admin, 'PATCH', {
        estado: 'finalizada', expected_revision: reloaded.revision,
      }));
      assert.equal((await row(candidate.id)).propiedades_extra[binding], latest.id);
      assert.deepEqual(await editorial(), beforeEditorial);
      assert.deepEqual(await fixture.query("SELECT * FROM editorial_publicacion_eventos WHERE dominio='publicacion' AND pieza_id=$1", [piece.id]), []);
    });
    await t.test(`${mode}: delivery-first stale approval409; approval-first new delivery clears binding, no evidence substitution`, async () => {
      const one = await seedReview(); const observed = (await row(one.task.id)).revision;
      const newVersion = await delivery(one.task.id);
      let before = await snapshot();
      assert.equal((await approve(one.task.id, mode, observed, one.version.id)).status, 409); assert.deepEqual(await snapshot(), before);
      assert.equal((await approve(one.task.id, mode, (await row(one.task.id)).revision, one.version.id)).status, 409);
      checked(await approve(one.task.id, mode, (await row(one.task.id)).revision, newVersion.id));
      // Publisher approval retains the original editor as normalized collaborator.
      const replacement = await delivery(one.task.id); const changed = await row(one.task.id);
      assert.equal(changed.estado, 'en_revision'); assert.equal(changed.propiedades_extra.revision_aprobada, false);
      assert.equal(changed.propiedades_extra[binding] ?? null, null);
      for (const key of ['revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at', 'finalizada_at']) assert.equal(changed.propiedades_extra[key] ?? null, null);
      before = await snapshot();
      assert.equal((await approve(one.task.id, mode, changed.revision, newVersion.id)).status, 409); assert.deepEqual(await snapshot(), before);
      checked(await approve(one.task.id, mode, changed.revision, replacement.id));
    });
    await t.test(`${mode}: simultaneous delivery versus approval on identical revision has one winner and coherent binding`, async () => {
      const { task, version } = await seedReview(); const revision = (await row(task.id)).revision;
      const body = { request_id: randomUUID(), expected_revision: revision, url: 'https://example.invalid/racing-version', notes: 'QA bounded race' };
      const results = await Promise.all([api(`/tareas-edicion/${task.id}/entregas`, editor, 'POST', body), approve(task.id, mode, revision, version.id)]);
      const current = await row(task.id);
      if (results[0].status === 201) {
        assert.equal(results[1].status, 409); assert.equal(current.estado, 'en_revision'); assert.equal(current.propiedades_extra[binding] ?? null, null);
      } else {
        assert.equal(results[0].status, 409); checked(results[1]); assert.equal(current.estado, 'aprobada'); assert.equal(current.propiedades_extra[binding], version.id);
      }
      assert.equal(current.revision, revision + 1);
      const deliveries = await fixture.query('SELECT id FROM task_editing_deliveries WHERE task_id=$1', [task.id]);
      assert.equal(deliveries.length, results[0].status === 201 ? 2 : 1);
    });
  }
  await t.test('reserved approval metadata cannot be forged by admin create/PATCH, root or nested', async () => {
    const task = await create();
    for (const forged of [{ [binding]: randomUUID() }, { propiedades_extra: { [binding]: randomUUID() } }]) {
      let before = await snapshot(); assert.equal((await api('/tareas', admin, 'POST', taskBody(forged))).status, 400); assert.deepEqual(await snapshot(), before);
      before = await snapshot(); assert.equal((await api(`/tareas/${task.id}?workspace=render_os`, admin, 'PATCH', {
        expected_revision: (await row(task.id)).revision, ...forged,
      })).status, 400); assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('raw material/content/reopen invalidates bound approval without touching original raw publication', async () => {
    const { task, version } = await seedReview(); const rawPublication = await editorial();
    checked(await approve(task.id, 'patch', (await row(task.id)).revision, version.id));
    checked(await api(`/tareas/${task.id}?workspace=render_os`, admin, 'PATCH', {
      expected_revision: (await row(task.id)).revision, material_referencia: 'https://example.invalid/raw-new',
    }));
    assert.equal((await row(task.id)).estado, 'en_revision'); assert.equal((await row(task.id)).propiedades_extra[binding] ?? null, null);
    checked(await approve(task.id, 'patch', (await row(task.id)).revision, version.id));
    checked(await api(`/tareas/${task.id}?workspace=render_os`, admin, 'PATCH', {
      expected_revision: (await row(task.id)).revision, aclaraciones: 'QA changed substantive script',
    }));
    assert.equal((await row(task.id)).propiedades_extra[binding] ?? null, null);
    checked(await approve(task.id, 'patch', (await row(task.id)).revision, version.id));
    checked(await api(`/tareas/${task.id}?workspace=render_os`, admin, 'PATCH', { estado: 'en_revision', expected_revision: (await row(task.id)).revision }));
    assert.equal((await row(task.id)).propiedades_extra[binding] ?? null, null); assert.deepEqual(await editorial(), rawPublication);
  });
  await t.test('legacy tasks without deliveries keep explicit unverified approval; supplied nonexistent delivery409', async () => {
    for (const mode of ['patch', 'publisher']) {
      const task = await create();
      checked(await api(`/tareas/${task.id}?workspace=render_os`, editor, 'PATCH', { estado: 'en_revision', expected_revision: task.revision }));
      const before = await snapshot(); assert.equal((await approve(task.id, mode, (await row(task.id)).revision, randomUUID())).status, 409); assert.deepEqual(await snapshot(), before);
      const result = checked(await approve(task.id, mode, (await row(task.id)).revision));
      assert.equal(result.estado, 'aprobada'); assert.equal(result.propiedades_extra[binding] ?? null, null);
      assert.deepEqual(await fixture.query('SELECT * FROM task_editing_deliveries WHERE task_id=$1', [task.id]), []);
      const otherScope = await create({ tipo_tarea: 'diseno' });
      checked(await api(`/tareas/${otherScope.id}?workspace=render_os`, editor, 'PATCH', { estado: 'en_revision', expected_revision: otherScope.revision }));
      const unchanged = await snapshot();
      assert.equal((await approve(otherScope.id, mode, (await row(otherScope.id)).revision, legacyEvent.id)).status, 409);
      assert.deepEqual(await snapshot(), unchanged);
    }
  });
  await t.test('content and separate script edits reopen bound final aliases and clear artifact approval', async () => {
    const beforeEditorial = await editorial();
    for (const finalState of ['finalizada','publicada']) for (const changes of [
      {aclaraciones:'QA changed approved instructions'},
      {material_referencia:'https://example.invalid/changed-raw'},
      {propiedades_extra:{copy_trabajo:'QA changed approved copy'}},
      {propiedades_extra:{guiones:'QA changed separately stored script'}},
      {propiedades_extra:{guiones:null}},
    ]) {
      const {task,version} = await seedReview();
      checked(await api(`/tareas/${task.id}?workspace=render_os`,admin,'PATCH',{propiedades_extra:{guiones:'QA original separate script'},expected_revision:(await row(task.id)).revision}));
      checked(await approve(task.id,'patch',(await row(task.id)).revision,version.id));
      checked(await api(`/tareas/${task.id}?workspace=render_os`,admin,'PATCH',{estado:'finalizada',expected_revision:(await row(task.id)).revision}));
      if (finalState === 'publicada') await fixture.query("UPDATE tareas SET estado='publicada' WHERE id=$1",[task.id]);
      assert.equal((await row(task.id)).propiedades_extra[binding],version.id);
      checked(await api(`/tareas/${task.id}?workspace=render_os`,admin,'PATCH',{propiedades_extra:{guiones:'QA original separate script'},expected_revision:(await row(task.id)).revision}));
      assert.equal((await row(task.id)).estado,finalState);
      assert.equal((await row(task.id)).propiedades_extra[binding],version.id,'An identical separately stored script cannot revoke the approval');
      checked(await api(`/tareas/${task.id}?workspace=render_os`,admin,'PATCH',{...changes,expected_revision:(await row(task.id)).revision}));
      const changed = await row(task.id);
      assert.equal(changed.estado,'en_revision');
      assert.equal(changed.propiedades_extra.revision_aprobada,false);
      for (const key of [binding,'revision_aprobada_por','revision_aprobada_por_id','revision_aprobada_at','finalizada_at']) assert.equal(changed.propiedades_extra[key] ?? null,null,key);
      assert.equal((await fixture.query('SELECT count(*)::int n FROM task_editing_deliveries WHERE task_id=$1',[task.id]))[0].n,1);
    }
    assert.deepEqual(await editorial(),beforeEditorial);
  });
  await t.test('admin session/role/activity revocation rejects current approval and leaves task/assignment/history intact', async () => {
    const { task, version } = await seedReview();
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=109003');
    for (const mode of ['patch', 'publisher']) {
      const before = await snapshot(); assert.equal((await approve(task.id, mode, (await row(task.id)).revision, version.id, leader)).status, 401); assert.deepEqual(await snapshot(), before);
    }
    const renewed = await login('qa_approval_109003'); await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=109003");
    for (const mode of ['patch', 'publisher']) assert.equal((await approve(task.id, mode, (await row(task.id)).revision, version.id, renewed)).status, 403);
    await fixture.query("UPDATE usuarios SET rol='admin',activo=false WHERE id=109003");
    for (const mode of ['patch', 'publisher']) assert.equal((await approve(task.id, mode, (await row(task.id)).revision, version.id, renewed)).status, 401);
    await fixture.query('UPDATE usuarios SET activo=true WHERE id=109003');
  });
  await t.test('both routes recheck a role change committed after middleware but before the task write', async () => {
    for (const mode of ['patch','publisher']) {
      await fixture.query("UPDATE usuarios SET rol='admin',activo=true WHERE id=109003");
      const token = await login('qa_approval_109003');
      const {task,version} = await seedReview(); const revision = (await row(task.id)).revision;
      const before = await snapshot(); const marker = `qa_approval_revoke_${randomUUID().replaceAll('-','')}`;
      let blocker, response;
      const observe = async (sql, values = []) => {
        for (let attempt=0;attempt<40;attempt++) {
          if ((await fixture.query(sql,values)).length) return true;
          await new Promise(resolve=>setTimeout(resolve,15));
        }
        return false;
      };
      try {
        // One PostgreSQL query holds a single connection for the whole barrier.
        blocker = fixture.query(`/* ${marker} */ BEGIN; UPDATE usuarios SET rol='edicion' WHERE id=109003; SELECT pg_sleep(1.2); COMMIT`);
        assert.equal(await observe("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE $1 AND wait_event='PgSleep'",[`%${marker}%`]),true);
        response = approve(task.id,mode,revision,version.id,token);
        assert.equal(await observe("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%SELECT id,rol,activo,session_version FROM usuarios%' AND query ILIKE '%FOR SHARE%'"),true,'Approval must actually wait in its transactional actor check');
        assert.equal((await response).status,401); await blocker;
      } finally {
        if (blocker) await blocker;
        if (response) await response;
        await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=109003");
      }
      assert.deepEqual(await snapshot(),before,'Revoked in-flight approval cannot commit task, goal or assignment changes');
    }
  });
});
