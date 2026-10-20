import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const ids = { owner: 92001, impostor: 92002, collaborator: 92003, inactive: 92004, sentinel: 92005 };

test('stable task assignments: real HTTP identity, annotations and atomicity', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const migration = await readFile(new URL('../migrations/056_task_assignments.sql', import.meta.url), 'utf8');
  const fixture = await startLocalHarness({ port: 55595, deferAssignmentMigration: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own fixture stopped and removed: ${fixture.root}`);
  });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.token;
  };
  for (const [key, id] of Object.entries(ids)) {
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,'diseno',password_hash,$4,1 FROM usuarios WHERE id=91004`,
    [id, `qa_assignment_${key}`, ['owner', 'impostor'].includes(key) ? 'QA Same Name' : `QA ${key}`, key !== 'inactive']);
  }
  const admin = await login('qa_franco');
  let owner = await login('qa_assignment_owner');
  const impostor = await login('qa_assignment_impostor');
  const collaborator = await login('qa_assignment_collaborator');
  await t.test('056 preserves populated legacy history and creates no inferred assignments', async () => {
    assert.deepEqual(await fixture.query("SELECT to_regclass('public.tarea_asignaciones') AS relation"), [{ relation: null }]);
    assert.equal((await fixture.query("SELECT nombre FROM _migrations WHERE nombre='056_task_assignments.sql'")).length, 0);
    const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA pre056 client') RETURNING id");
    const [piece] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,fecha_publicación_real)
      VALUES ($1,'video','publicada','2026-09-19','2026-09-19T15:12:00Z') RETURNING id`, [client.id]);
    const [legacy] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,publicacion_id,propiedades_extra,updated_at)
      VALUES ('QA pre056 legacy','QA Same Name','en_revision',$1,
      '{"workspace":"render_os","colaboradores":["QA collaborator"],"legacy_marker":"unchanged"}',
      '2026-09-19T15:00:00Z') RETURNING id`, [piece.id]);
    await fixture.query(`INSERT INTO tareas(titulo,asignado_a,tarea_padre_id,propiedades_extra)
      VALUES ('QA pre056 child','Unknown historical person',$1,'{"workspace":"render_os"}')`, [legacy.id]);
    const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales
      (clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
      VALUES ('qa-pre056','2026-09-01',$1,'QA pre056 history',1,0,'Historical leader') RETURNING id`, [client.id]);
    const [slot] = await fixture.query(`INSERT INTO cliente_objetivo_piezas
      (objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,estado)
      VALUES ($1,'video',1,$2,$3,'Historical slot','en_revision') RETURNING id`, [goal.id, legacy.id, piece.id]);
    await fixture.query(`INSERT INTO cliente_objetivo_eventos(pieza_id,estado_anterior,estado_nuevo,tarea_id,created_at)
      VALUES ($1,'pendiente','en_revision',$2,'2026-09-19T15:00:00Z')`, [slot.id, legacy.id]);
    const history = async () => {
      const result = {};
      for (const table of ['usuarios', 'clientes', 'tareas', 'historias', 'publicaciones',
        'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'])
        result[table] = await fixture.query(`SELECT * FROM ${table} ORDER BY id`);
      return result;
    };
    const before = await history();
    await fixture.query(migration);
    assert.deepEqual(await history(), before, '056 must not rewrite pre-existing tasks, users or goal/editorial history');
    assert.deepEqual(await fixture.query('SELECT * FROM tarea_asignaciones'), [], 'Historical names must not infer identities');
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('056_task_assignments.sql')");
  });
  const detail = async id => {
    const result = await api(`/tareas/${id}?workspace=render_os`, { token: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const create = async extra => {
    const result = await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'QA stable assignment', workspace: 'render_os', asignado_a_id: ids.owner,
      colaborador_ids: [ids.collaborator], ...extra,
    } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const patch = async (id, token, body) => {
    const current = await detail(id);
    return api(`/tareas/${id}?workspace=render_os`, {
      token, method: 'PATCH', body: { expected_updated_at: current.updated_at,
        expected_revision: current.revision, ...body },
    });
  };
  const snapshot = async id => ({
    task: await fixture.query('SELECT * FROM tareas WHERE id=$1', [id]),
    assignments: await fixture.query('SELECT * FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [id]),
  });
  const denied = result => assert.ok([403, 404].includes(result.status), JSON.stringify(result));
  const annotated = (row, ownerId, collaborators) => {
    assert.ok(row, 'Missing task DTO');
    assert.ok(Number.isSafeInteger(row.revision) && row.revision >= 1, 'Task DTO must expose integer revision');
    assert.equal(row.asignado_a_id, ownerId);
    assert.deepEqual([...row.colaborador_ids].sort((a, b) => a - b), [...collaborators].sort((a, b) => a - b));
  };
  const task = await create({});

  await t.test('create, batch list, detail, PATCH and subtask DTOs carry stable IDs', async () => {
    annotated(task, ids.owner, [ids.collaborator]);
    annotated(await detail(task.id), ids.owner, [ids.collaborator]);
    const child = await create({ titulo: 'QA stable child', tarea_padre_id: task.id,
      asignado_a_id: ids.collaborator, colaborador_ids: [ids.owner] });
    const list = await api('/tareas?workspace=render_os&limit=500', { token: owner });
    assert.equal(list.status, 200);
    annotated(list.body.find(row => row.id === task.id), ids.owner, [ids.collaborator]);
    annotated(list.body.find(row => row.id === child.id), ids.collaborator, [ids.owner]);
    const children = await api(`/tareas/${task.id}/subtareas?workspace=render_os`, { token: owner });
    assert.equal(children.status, 200);
    annotated(children.body.find(row => row.id === child.id), ids.collaborator, [ids.owner]);
    const changed = await patch(task.id, owner, { titulo: 'QA owner edited' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    annotated(changed.body, ids.owner, [ids.collaborator]);
    assert.equal((await patch(task.id, collaborator, { titulo: 'QA collaborator edited' })).status, 200);
  });

  await t.test('same-name impostor and unauthenticated callers cannot mutate', async () => {
    const before = await snapshot(task.id);
    denied(await patch(task.id, impostor, { titulo: 'Impostor wrote this' }));
    assert.equal((await api(`/tareas/${task.id}?workspace=render_os`, { method: 'PATCH', body: { titulo: 'Anonymous' } })).status, 401);
    assert.equal((await api('/tareas', { method: 'POST', body: { titulo: 'Anonymous', asignado_a_id: ids.owner, workspace: 'render_os' } })).status, 401);
    assert.equal((await api(`/tareas/${task.id}?workspace=render_os`)).status, 401);
    assert.equal((await api('/tareas?workspace=render_os')).status, 401);
    assert.deepEqual(await snapshot(task.id), before);
    const ambiguous = await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'Ambiguous name must fail', workspace: 'render_os', asignado_a: 'QA Same Name', colaborador_ids: [],
    } });
    assert.equal(ambiguous.status, 400);
  });

  await t.test('piece creation binds generated tasks by explicit owner ID despite duplicate names and rejects invalid IDs atomically', async () => {
    const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA automatic piece bindings') RETURNING id");
    const [homonyms] = await fixture.query("SELECT count(*)::int AS count FROM usuarios WHERE nombre='QA Same Name'");
    assert.equal(homonyms.count, 2, 'Run while both accounts still share the exact display name');
    const counts = () => fixture.query(`SELECT (SELECT count(*)::int FROM historias) AS historias,
      (SELECT count(*)::int FROM publicaciones) AS publicaciones,
      (SELECT count(*)::int FROM tareas) AS tareas,
      (SELECT count(*)::int FROM tarea_asignaciones) AS asignaciones`);
    for (const tipo of ['historia', 'carrusel', 'video']) {
      const created = await api('/piezas', { token: admin, method: 'POST', body: {
        tipo, cliente_id: client.id, responsable_id: ids.owner, responsable: 'QA Same Name',
        fecha_programada: '2026-10-25', idea: `QA automatic ${tipo}`,
      } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.responsable, 'QA Same Name');
      const column = tipo === 'historia' ? 'historia_id' : 'publicacion_id';
      const generated = await fixture.query(`SELECT id FROM tareas WHERE ${column}=$1`, [created.body.id]);
      assert.equal(generated.length, 1, `Expected one automatic task for ${tipo}`);
      const generatedId = generated[0].id;
      annotated(await detail(generatedId), ids.owner, []);
      assert.deepEqual((await snapshot(generatedId)).assignments,
        [{ tarea_id: generatedId, usuario_id: ids.owner, tipo: 'responsable' }]);
      assert.equal((await patch(generatedId, owner, { titulo: `QA owner edited automatic ${tipo}` })).status, 200);
      denied(await patch(generatedId, impostor, { titulo: 'Homonym must not own automatic task' }));
      const before = await counts();
      for (const responsable_id of [2147483647, ids.inactive]) {
        const rejected = await api('/piezas', { token: admin, method: 'POST', body: {
          tipo, cliente_id: client.id, responsable_id, fecha_programada: '2026-10-25', idea: 'Must not persist',
        } });
        assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
        assert.deepEqual(await counts(), before, `Invalid ${tipo} owner must leave pieces, tasks and assignments unchanged`);
      }
    }
  });

  await t.test('rename retains ID binding and owner edit authority after real relogin', async () => {
    const catalog = await api('/usuarios', { token: admin });
    assert.equal(catalog.status, 200);
    const expected_revision = catalog.body.find(row => row.id === ids.owner)?.admin_revision;
    assert.match(expected_revision, new RegExp(`^ua1:${ids.owner}:[0-9]+$`));
    const renamed = await api(`/usuarios/${ids.owner}`, { token: admin, method: 'PATCH', body: {
      expected_revision, usuario: 'qa_assignment_owner', nombre: 'QA Renamed Owner', rol: 'diseno',
    } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    owner = await login('qa_assignment_owner');
    annotated(await detail(task.id), ids.owner, [ids.collaborator]);
    assert.equal((await patch(task.id, owner, { titulo: 'QA renamed owner edited' })).status, 200);
    denied(await patch(task.id, impostor, { titulo: 'Still not owner' }));
  });

  await t.test('missing/stale versions reject and roll back both labels and assignment rows', async () => {
    const before = await snapshot(task.id);
    const noVersion = await api(`/tareas/${task.id}?workspace=render_os`, { token: admin, method: 'PATCH',
      body: { asignado_a_id: ids.collaborator, colaborador_ids: [ids.impostor] } });
    assert.equal(noVersion.status, 400, JSON.stringify(noVersion.body));
    assert.deepEqual(await snapshot(task.id), before);
    // Keep the timestamp current: a stale integer revision alone must reject,
    // even if timestamps collide at millisecond precision.
    const stale = await patch(task.id, admin, { expected_revision: before.task[0].revision - 1,
      asignado_a_id: ids.collaborator, colaborador_ids: [ids.impostor], titulo: 'Must roll back' });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.deepEqual(await snapshot(task.id), before);
  });

  await t.test('inactive IDs rejected by HTTP and dangling IDs rejected by real FK constraints', async () => {
    const before = await snapshot(task.id);
    for (const body of [{ asignado_a_id: ids.inactive }, { colaborador_ids: [ids.inactive] }]) {
      const result = await patch(task.id, admin, body);
      assert.equal(result.status, 400, JSON.stringify(result.body));
      assert.deepEqual(await snapshot(task.id), before);
    }
    const created = await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'Inactive assignment', workspace: 'render_os', asignado_a_id: ids.inactive, colaborador_ids: [],
    } });
    assert.equal(created.status, 400);
    await assert.rejects(fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
      VALUES ($1,2147483647,'colaborador')`, [task.id]), /foreign key/i);
    await assert.rejects(fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
      VALUES (2147483647,$1,'colaborador')`, [ids.owner]), /foreign key/i);
    assert.deepEqual(await snapshot(task.id), before);
  });

  await t.test('identical timestamps cannot bypass stale integer revision on ownership PATCH', async () => {
    const collision = await create({ titulo: 'QA same-millisecond ownership' });
    const observed = await detail(collision.id);
    await fixture.query(`UPDATE tareas SET titulo='QA concurrent SQL update',updated_at=updated_at WHERE id=$1`, [collision.id]);
    const current = await detail(collision.id);
    assert.equal(current.updated_at, observed.updated_at, 'Timestamp must be identical for this regression');
    assert.equal(current.revision, observed.revision + 1, 'SQL update must advance revision independently of timestamp');
    const before = await snapshot(collision.id);
    const stale = await api(`/tareas/${collision.id}?workspace=render_os`, {
      token: admin, method: 'PATCH', body: { asignado_a_id: ids.impostor, colaborador_ids: [],
        expected_revision: observed.revision, expected_updated_at: observed.updated_at },
    });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.deepEqual(await snapshot(collision.id), before);
    annotated(await detail(collision.id), ids.owner, [ids.collaborator]);
  });

  await t.test('assignment INSERT failure after base UPDATE rolls back task and bindings atomically', async () => {
    const before = await snapshot(task.id);
    await fixture.query(`CREATE FUNCTION qa_assignment_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.usuario_id=92005 THEN RAISE EXCEPTION 'QA sentinel assignment failure'; END IF; RETURN NEW; END $$`);
    try {
      await fixture.query(`CREATE TRIGGER qa_assignment_insert_failure BEFORE INSERT ON tarea_asignaciones
        FOR EACH ROW EXECUTE FUNCTION qa_assignment_insert_failure()`);
      try {
        const failed = await patch(task.id, admin, { asignado_a_id: ids.sentinel,
          colaborador_ids: [ids.impostor], titulo: 'Must roll back after base UPDATE' });
        assert.equal(failed.status, 500, JSON.stringify(failed.body));
        assert.deepEqual(await snapshot(task.id), before, 'Base update and deleted/replaced bindings must all roll back');
      } finally { await fixture.query('DROP TRIGGER qa_assignment_insert_failure ON tarea_asignaciones'); }
    } finally { await fixture.query('DROP FUNCTION qa_assignment_insert_failure()'); }
    assert.equal((await patch(task.id, owner, { titulo: 'Owner still edits after rollback' })).status, 200);
  });

  await t.test('removing collaborator revokes the next edit despite surviving legacy JSON label', async () => {
    assert.equal((await patch(task.id, admin, { colaborador_ids: [] })).status, 200);
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra ||
      '{"colaboradores":["QA collaborator"]}'::jsonb WHERE id=$1`, [task.id]);
    const before = await snapshot(task.id);
    assert.deepEqual(before.task[0].propiedades_extra.colaboradores, ['QA collaborator']);
    denied(await patch(task.id, collaborator, { titulo: 'Revoked collaborator edit' }));
    assert.deepEqual(await snapshot(task.id), before);
    annotated(await detail(task.id), ids.owner, []);
    assert.equal((await patch(task.id, owner, { titulo: 'Owner remains authorized' })).status, 200);
  });

  await t.test('legacy name-only row stays unbound until explicit admin binding', async () => {
    const [legacy] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,propiedades_extra)
      VALUES ('QA legacy unmapped','QA Renamed Owner','{"workspace":"render_os","colaboradores":["QA collaborator"]}') RETURNING id`);
    const before = await snapshot(legacy.id);
    annotated(await detail(legacy.id), null, []);
    denied(await patch(legacy.id, owner, { titulo: 'Names must not grant access' }));
    denied(await patch(legacy.id, collaborator, { titulo: 'Legacy JSON must not grant access' }));
    assert.deepEqual(await snapshot(legacy.id), before);
    const bound = await patch(legacy.id, admin, { asignado_a_id: ids.owner, colaborador_ids: [ids.collaborator] });
    assert.equal(bound.status, 200, JSON.stringify(bound.body));
    annotated(bound.body, ids.owner, [ids.collaborator]);
    assert.equal((await patch(legacy.id, owner, { titulo: 'Explicitly bound owner edit' })).status, 200);
    assert.equal((await patch(legacy.id, collaborator, { titulo: 'Explicitly bound collaborator edit' })).status, 200);
  });

  await t.test('real PostgreSQL planner accepts stable-ID ACL and batch annotation queries', async () => {
    const acl = await fixture.query(`EXPLAIN (FORMAT JSON) SELECT t.id FROM tareas t WHERE t.id=$1
      AND EXISTS (SELECT 1 FROM tarea_asignaciones ta WHERE ta.tarea_id=t.id AND ta.usuario_id=$2::integer)`, [task.id, ids.owner]);
    const batch = await fixture.query(`EXPLAIN (FORMAT JSON) SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones
      WHERE tarea_id=ANY($1::integer[]) ORDER BY tarea_id,usuario_id`, [[task.id]]);
    assert.ok(acl[0]['QUERY PLAN'][0].Plan);
    assert.ok(batch[0]['QUERY PLAN'][0].Plan);
    t.diagnostic(`Planner nodes: ACL=${acl[0]['QUERY PLAN'][0].Plan['Node Type']}; batch=${batch[0]['QUERY PLAN'][0].Plan['Node Type']}. Tiny-fixture plans are not production performance evidence.`);
  });

  await t.test('stale approval after collaborator change cannot restore removed bindings', async () => {
    const editing = await create({ titulo: 'QA stale approval handoff', tipo_tarea: 'edicion',
      subtipo: 'video', estado: 'en_revision' });
    const observed = await detail(editing.id);
    const changed = await patch(editing.id, admin, { colaborador_ids: [] });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.ok(changed.body.revision > observed.revision);
    // Reproduce the lost-update window with exactly the same visible timestamp
    // and same editorial task state, but a later integer revision.
    await fixture.query('UPDATE tareas SET updated_at=$1 WHERE id=$2', [observed.updated_at, editing.id]);
    const current = await detail(editing.id);
    assert.equal(current.updated_at, observed.updated_at);
    assert.equal(current.estado, 'en_revision');
    assert.ok(current.revision > observed.revision);
    const before = await snapshot(editing.id);
    const stale = await api(`/tareas/${editing.id}/aprobar-publicacion?workspace=render_os`, {
      token: admin, method: 'POST', body: { responsable_publicacion_id: 91002,
        expected_revision: observed.revision, expected_updated_at: observed.updated_at },
    });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.deepEqual(await snapshot(editing.id), before, 'Stale approval must not rewrite task, revision or assignments');
    annotated(await detail(editing.id), ids.owner, []);
    denied(await patch(editing.id, collaborator, { titulo: 'Removed collaborator stays revoked' }));
  });

  await t.test('approval hands ownership to selected publisher ID while preserving editor and collaborators', async () => {
    const editing = await create({ titulo: 'QA video editing handoff', tipo_tarea: 'edicion',
      subtipo: 'video', estado: 'en_revision' });
    const approve = async (token, publisher) => {
      const current = await detail(editing.id);
      return api(`/tareas/${editing.id}/aprobar-publicacion?workspace=render_os`, {
        token, method: 'POST', body: { responsable_publicacion_id: publisher,
          expected_revision: current.revision, expected_updated_at: current.updated_at },
      });
    };
    const before = await snapshot(editing.id);
    assert.equal((await approve(owner, 91002)).status, 403);
    assert.deepEqual(await snapshot(editing.id), before);
    assert.equal((await approve(admin, ids.inactive)).status, 400);
    assert.deepEqual(await snapshot(editing.id), before);
    const approved = await approve(admin, 91002);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    annotated(approved.body, 91002, [ids.owner, ids.collaborator]);
    assert.equal(approved.body.propiedades_extra.responsable_publicacion_id, 91002);
    assert.equal(approved.body.propiedades_extra.edicion_responsable_id, ids.owner);
    assert.equal(approved.body.propiedades_extra.revision_aprobada_por_id, 91001);
    annotated(await detail(editing.id), 91002, [ids.owner, ids.collaborator]);
    const publisher = await login('qa_agustin');
    assert.equal((await patch(editing.id, publisher, { titulo: 'Publisher ID can edit' })).status, 200);
    assert.equal((await patch(editing.id, owner, { titulo: 'Editor retained as collaborator' })).status, 200);
    assert.equal((await patch(editing.id, collaborator, { titulo: 'Existing collaborator retained' })).status, 200);
    denied(await patch(editing.id, impostor, { titulo: 'Unassigned impostor denied after handoff' }));
    assert.equal((await approve(admin, 91002)).status, 409);
  });
});
