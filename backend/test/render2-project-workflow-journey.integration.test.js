import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Combined API/PG journey, not native UI acceptance. Explicit opt-in only.
test('project-only web work: structural ID authority, one linked task workflow and fresh personal projections', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55835 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Project workflow fixture removed: ${f.root}; port55835`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55835,
    url: 'postgresql://render2_fixture@127.0.0.1:55835/render2_local_test', identity });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const login = async usuario => {
    const value = ok(await api('/login', null, 'POST', { usuario, password: fixturePassword }));
    assert.equal(typeof value.token, 'string'); return value.token;
  };
  const admin = await login('qa_franco'), owner = await login('qa_designer'), member = await login('qa_luciano');
  const ownerId = 91004, memberId = 91003;
  const tables = ['clientes', 'cliente_configuraciones', 'cliente_abonos', 'grupos_feed',
    'proyectos', 'proyecto_miembros', 'proyecto_etapas', 'proyecto_hitos', 'proyecto_entregables',
    'proyecto_entregable_aprobaciones', 'project_child_create_receipts', 'proyecto_tareas', 'proyecto_actividad',
    'tareas', 'tarea_asignaciones', 'task_editing_deliveries', 'task_editing_reviews',
    'produccion_visitas', 'produccion_videos', 'produccion_fotos',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
    'historias', 'publicaciones', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos',
    'team_payments', 'team_payment_events', 'team_payment_receipts'];
  const snapshot = async () => {
    const value = {};
    for (const table of tables) value[table] = await f.query(`SELECT * FROM ${table} r ORDER BY to_jsonb(r)::text`);
    return value;
  };
  const forbidden = ['cliente_configuraciones', 'cliente_abonos', 'grupos_feed',
    'produccion_visitas', 'produccion_videos', 'produccion_fotos', 'cliente_objetivos_mensuales',
    'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'historias', 'publicaciones',
    'editorial_publicacion_versiones', 'editorial_publicacion_eventos',
    'team_payments', 'team_payment_events', 'team_payment_receipts', 'task_editing_deliveries', 'task_editing_reviews'];
  const baseline = await snapshot();
  // Historical migrations may seed a feed group even in a fresh cluster.
  // Preserve that baseline; never delete it to manufacture an empty fixture.
  for (const table of forbidden.filter(name => name !== 'grupos_feed')) assert.deepEqual(baseline[table], [], `${table}: fresh isolated fixture`);
  for (const table of ['proyectos', 'proyecto_tareas', 'tareas', 'tarea_asignaciones']) assert.deepEqual(baseline[table], [], `${table}: no preexisting journey work`);
  let client, project, stage, milestone, task, linkedRevision;
  const readProject = async (token = admin) => ok(await api(`/proyectos/${project.id}`, token)).proyecto;
  const readTask = async (token = admin) => ok(await api(`/tareas/${task.id}?workspace=render_os`, token));
  const patchTask = async (token, estado) => {
    const observed = await readTask();
    return api(`/tareas/${task.id}?workspace=render_os`, token, 'PATCH', {
      estado, expected_revision: observed.revision, expected_updated_at: observed.updated_at,
    });
  };

  await t.test('API creates a basic client, web project, receipted stage/milestone and exactly one observed task link', async () => {
    client = ok(await api('/clientes', admin, 'POST', { nombre: 'QA177 project workflow without monthly agreement' }), 201);
    assert.equal(client.configuracion_completa, false); assert.equal(client.fecha_inicio, null);
    assert.equal(client.cuota_reels, 0); assert.equal(client.cuota_carruseles, 0);
    project = ok(await api('/proyectos', admin, 'POST', { request_id: randomUUID(), titulo: 'QA177 web delivery',
      cliente_id: client.id, responsable_id: ownerId, miembro_ids: [memberId], tipo: 'web',
      descripcion: 'Independent development project, not a monthly content quota',
      fecha_inicio: '2026-10-01', fecha_entrega: '2026-11-03' }), 201).proyecto;
    assert.equal(project.estado, 'planificado'); assert.equal(project.responsable.id, ownerId);
    assert.deepEqual(project.miembro_ids, [memberId]);
    const createChild = async (kind, body) => {
      const before = await readProject(owner), requestId = randomUUID();
      const result = ok(await api(`/proyectos/${project.id}/${kind}`, owner, 'POST', {
        request_id: requestId, expected_revision: before.revision, ...body,
      }), 201);
      assert.equal(result.replayed, false); assert.equal(result.proyecto.revision, before.revision + 1);
      assert.deepEqual(result.creacion, { request_id: requestId, proyecto_id: project.id, recurso_tipo: kind,
        recurso_id: result.creacion.recurso_id, actor_id: ownerId, expected_revision: before.revision });
      const child = result.proyecto[kind].find(row => row.id === result.creacion.recurso_id); assert.ok(child); return child;
    };
    stage = await createChild('etapas', { titulo: 'QA177 implementation' });
    milestone = await createChild('hitos', { titulo: 'QA177 web review', fecha: '2026-10-24', estado: 'pendiente', etapa_id: stage.id });
    task = ok(await api('/tareas', admin, 'POST', { titulo: 'QA177 implement web', workspace: 'render_os',
      cliente_id: client.id, asignado_a_id: ownerId, colaborador_ids: [], tipo_tarea: 'desarrollo', subtipo: 'web',
      fecha_vencimiento: '2026-10-25' }), 201);
    assert.equal(task.asignado_a_id, ownerId); assert.equal(task.tipo_tarea, 'desarrollo');
    const observedTask = await readTask(owner), observedProject = await readProject(owner);
    const result = ok(await api(`/proyectos/${project.id}/tareas`, owner, 'POST', {
      expected_revision: observedProject.revision, tarea_id: task.id,
      expected_tarea_revision: observedTask.revision, etapa_id: stage.id,
    }), 201).proyecto;
    linkedRevision = result.revision; assert.equal(linkedRevision, observedProject.revision + 1);
    assert.deepEqual(result.tareas.map(row => row.id), [task.id]); assert.equal(result.tareas[0].etapa_id, stage.id);
    assert.deepEqual(await readTask(owner), observedTask, 'Linking must not rewrite the task');
    assert.deepEqual(await f.query('SELECT proyecto_id,tarea_id,etapa_id FROM proyecto_tareas'), [{ proyecto_id: project.id, tarea_id: task.id, etapa_id: stage.id }]);
  });

  await t.test('project membership grants no structural write or task assignment; denials leave domain snapshots unchanged', async () => {
    const observed = await readProject(member), observedTask = await readTask();
    assert.deepEqual(observed.permissions, { administrar: false, editar: false });
    const attempts = [
      [`/proyectos/${project.id}`, 'PATCH', { expected_revision: observed.revision, titulo: 'Forbidden member rename' }],
      [`/proyectos/${project.id}/etapas/${stage.id}`, 'PATCH', { expected_revision: observed.revision, titulo: 'Forbidden member stage' }],
      [`/proyectos/${project.id}/tareas`, 'POST', { expected_revision: observed.revision, tarea_id: task.id, expected_tarea_revision: observedTask.revision, etapa_id: stage.id }],
    ];
    for (const [path, method, body] of attempts) {
      const before = await snapshot(); ok(await api(path, member, method, body), 403); assert.deepEqual(await snapshot(), before);
    }
    const before = await snapshot();
    const denied = await patchTask(member, 'en_progreso');
    assert.ok([403, 404].includes(denied.status), `Unassigned task write must be denied, got ${denied.status}`);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('owner completes development review under task CAS; employee cannot approve and task progress does not transition the project', async () => {
    const beforeProject = await f.query('SELECT * FROM proyectos WHERE id=$1', [project.id]);
    const beforeActivity = await f.query('SELECT * FROM proyecto_actividad WHERE proyecto_id=$1 ORDER BY id', [project.id]);
    for (const state of ['en_progreso', 'en_revision']) {
      const before = await readTask(owner); ok(await patchTask(owner, state));
      const updated = await readTask(owner); assert.equal(updated.estado, state); assert.equal(updated.revision, before.revision + 1);
    }
    const beforeDenied = await snapshot(); ok(await patchTask(owner, 'aprobada'), 403); assert.deepEqual(await snapshot(), beforeDenied);
    for (const state of ['aprobada', 'finalizada']) {
      const before = await readTask(); ok(await patchTask(admin, state));
      const updated = await readTask(); assert.equal(updated.estado, state); assert.equal(updated.revision, before.revision + 1);
    }
    const current = await readProject(owner);
    assert.equal(current.estado, 'planificado'); assert.equal(current.revision, linkedRevision);
    assert.deepEqual(current.counts, { tareas: 1, finalizadas: 1, hitos: 1, entregables: 0 });
    assert.equal(current.tareas[0].estado, 'finalizada'); assert.equal(current.hitos[0].estado, 'pendiente'); assert.equal(current.etapas[0].estado, 'pendiente');
    assert.deepEqual(await f.query('SELECT * FROM proyectos WHERE id=$1', [project.id]), beforeProject);
    assert.deepEqual(await f.query('SELECT * FROM proyecto_actividad WHERE proyecto_id=$1 ORDER BY id', [project.id]), beforeActivity);
  });

  await t.test('fresh owner/member sessions see the same planned project in Home and correct personal milestone/task calendar scope without writes', async () => {
    const freshOwner = await login('qa_designer'), freshMember = await login('qa_luciano');
    const before = await snapshot();
    for (const [token, actorId] of [[freshOwner, ownerId], [freshMember, memberId]]) {
      const home = ok(await api('/inicio', token));
      const rows = home.projects.filter(row => row.id === project.id); assert.equal(rows.length, 1);
      assert.equal(rows[0].estado, 'planificado'); assert.equal(rows[0].revision, linkedRevision);
      assert.equal(rows[0].cliente.id, client.id); assert.equal(rows[0].href, `/proyectos?proyecto=${project.id}`);
      assert.ok(!home.tasks.some(row => row.id === task.id), 'Finalized work must not remain in open personal tasks');
      const activity = home.activity.filter(row => row.task_id === task.id);
      if (actorId === ownerId) { assert.equal(activity.length, 1); assert.equal(activity[0].estado, 'finalizada'); }
      else assert.deepEqual(activity, [], 'Project membership must not create personal task activity');
      const params = new URLSearchParams({ desde: '2026-10-01', hasta: '2026-11-01', scope: 'mine', kind: 'all', cliente_id: String(client.id), limit: '200', offset: '0' });
      const calendar = ok(await api(`/calendario?${params}`, token));
      assert.equal(calendar.scope, 'mine'); assert.equal(calendar.timezone, 'America/Argentina/Cordoba'); assert.equal(calendar.truncated, false);
      const hito = calendar.events.filter(row => row.kind === 'hito'); assert.equal(hito.length, 1);
      assert.equal(hito[0].source_id, milestone.id); assert.equal(hito[0].date, '2026-10-24'); assert.equal(hito[0].estado, 'pendiente');
      assert.equal(hito[0].href, `/proyectos?proyecto=${project.id}`); assert.deepEqual(hito[0].responsable_ids, [memberId, ownerId]); assert.equal(hito[0].evidence, null);
      const tasks = calendar.events.filter(row => row.kind === 'tarea');
      if (actorId === ownerId) {
        assert.equal(tasks.length, 1); assert.equal(tasks[0].source_id, task.id); assert.equal(tasks[0].date, '2026-10-25');
        assert.equal(tasks[0].estado, 'finalizada'); assert.equal(tasks[0].href, `/workspace/tareas?task=${task.id}`); assert.deepEqual(tasks[0].responsable_ids, [ownerId]);
      } else assert.deepEqual(tasks, [], 'Project membership is not task assignment');
      assert.ok(calendar.events.every(row => ['hito', 'tarea'].includes(row.kind)), 'No programmed/actual publications inferred from final work');
      assert.equal(calendar.pagination.total, actorId === ownerId ? 2 : 1);
    }
    assert.deepEqual((await readProject(freshMember)).tareas.map(row => row.id), [task.id]);
    assert.deepEqual(await snapshot(), before, 'New-login projections are read-only');
  });

  const final = await snapshot();
  assert.equal(final.tareas.length, baseline.tareas.length + 1);
  assert.equal(final.tareas.filter(row => row.id === task.id && row.estado === 'finalizada').length, 1);
  assert.equal(final.proyecto_tareas.length, 1); assert.equal(final.proyectos.length, 1);
  assert.equal(final.proyecto_etapas.length, 1); assert.equal(final.proyecto_hitos.length, 1);
  assert.equal(final.project_child_create_receipts.length, 2);
  assert.deepEqual(final.tarea_asignaciones.filter(row => row.tarea_id === task.id).map(row => ({ usuario_id: row.usuario_id, tipo: row.tipo })), [{ usuario_id: ownerId, tipo: 'responsable' }]);
  for (const table of forbidden) assert.deepEqual(final[table], baseline[table], `${table}: project work must not create editorial, production or finance records`);
});
