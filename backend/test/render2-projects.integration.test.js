import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const ids = { responsible: 105001, homonym: 105002, member: 105003, extra: 105004 };
const poison = 'QA_PROJECT_PRIVATE_FINANCE_55610';
const projectTables = ['proyectos', 'proyecto_miembros', 'proyecto_etapas', 'proyecto_hitos', 'proyecto_entregables', 'proyecto_tareas', 'proyecto_actividad'];
const summaryKeys = ['id', 'titulo', 'cliente', 'responsable', 'tipo', 'estado', 'fecha_inicio', 'fecha_entrega', 'archivado', 'revision', 'counts', 'href'];

test('principal projects: additive history, ID authority, atomic CRUD and reciprocal task domains', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55610, deferProjectsMigration: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own projects fixture stopped and removed: ${fixture.root}`);
  });
  const api = (route, body, token = admin, method = 'POST') => request(fixture.base, `/api${route}`, { token, method, body });
  const ok = (response, statuses = [200]) => {
    assert.ok(statuses.includes(response.status), `${response.status}: ${JSON.stringify(response.body)}`); return response.body;
  };
  const login = async usuario => ok(await request(fixture.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  for (const [name, id] of Object.entries(ids)) await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,$2,$3,'edicion',password_hash,true,1 FROM usuarios WHERE id=91004`,
  [id, `qa_project_${name}`, ['responsible', 'homonym'].includes(name) ? 'QA Project Same Name' : `QA Project ${name}`]);
  const admin = await login('qa_franco');
  const responsible = await login('qa_project_responsible'); const homonym = await login('qa_project_homonym');
  const member = await login('qa_project_member');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA project client') RETURNING id,nombre");
  const [otherClient] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA project other') RETURNING id,nombre");
  const [inactiveClient] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA project inactive',false) RETURNING id");
  await fixture.query("INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por) VALUES ($1,'2026-01-01',637281.49,'QA fixture')", [client.id]);
  let serial = 0;
  const seedTask = async ({ clientId = client.id, properties = {}, piece = null, history = null, type = 'edicion', title } = {}) => {
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,historia_id,tipo_tarea,subtipo,
      estado,fecha_vencimiento,aclaraciones,propiedades_extra)
      VALUES ($1,'QA Project member',$2,$3,$4,$5,'video','pendiente','2026-10-25',$6,$7::jsonb) RETURNING *`,
    [title || `QA project task ${++serial}`, clientId, piece, history, type, `Private description ${poison}`,
      JSON.stringify({ workspace: 'render_os', arbitrary_money: { amount: 637281.49, nested: [{ marker: poison }] }, ...properties })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [task.id, ids.member]);
    return task;
  };
  const [publication] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,metadata)
    VALUES ($1,'video','pendiente','2026-10-29',$2::jsonb) RETURNING id`, [client.id, JSON.stringify({ marker: poison, importe: 637281.49 })]);
  const [history] = await fixture.query(`INSERT INTO historias(cliente_id,estado,fecha_programada,metadata)
    VALUES ($1,'pendiente','2026-10-29',$2::jsonb) RETURNING id`, [client.id, JSON.stringify({ marker: poison })]);
  const editorialTask = await seedTask({ piece: publication.id });
  const historicalTask = await seedTask({ history: history.id });
  const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales
    (clave,periodo,cliente_id,cuentas,nombre,reels,carruseles,preparado_por)
    VALUES ('qa-project-goal','2026-10-01',$1,jsonb_build_array(jsonb_build_object('id',$1::int)),
      'QA project independent monthly goal',50,0,'fixture') RETURNING id`, [client.id]);
  await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo)
    VALUES ($1,'video',1,$2,$3,'QA project historical slot')`, [goal.id, editorialTask.id, publication.id]);
  const oldTask = await seedTask();
  const legacyTables = ['usuarios', 'clientes', 'cliente_abonos', 'tareas', 'tarea_asignaciones', 'publicaciones', 'historias',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'produccion_visitas', 'produccion_videos',
    'produccion_fotos', 'produccion_visita_participantes', 'integracion_auditoria', 'mia_private_task_notifications'];
  const snapshot = async (projects = true) => {
    const result = {};
    for (const table of [...legacyTables, ...(projects ? projectTables : [])]) result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  await t.test('063 preserves populated principal history and existing trigger behavior without promotion or backfill', async () => {
    assert.deepEqual(await fixture.query("SELECT nombre FROM public._migrations WHERE nombre='063_projects.sql'"), []);
    for (const table of projectTables) assert.deepEqual(await fixture.query('SELECT to_regclass($1) AS relation', [`public.${table}`]), [{ relation: null }]);
    const before = await snapshot(false);
    await fixture.query(await readFile(new URL('../migrations/063_projects.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await snapshot(false), before);
    for (const table of projectTables) assert.deepEqual(await fixture.query(`SELECT * FROM ${table}`), []);
    await fixture.query("INSERT INTO public._migrations(nombre) VALUES ('063_projects.sql')");
    const [revision] = await fixture.query('SELECT revision FROM tareas WHERE id=$1', [oldTask.id]);
    await fixture.query('UPDATE tareas SET titulo=titulo WHERE id=$1', [oldTask.id]);
    assert.equal((await fixture.query('SELECT revision FROM tareas WHERE id=$1', [oldTask.id]))[0].revision, revision.revision + 1);
  });
  const read = async (id, token = admin) => ok(await api(`/proyectos/${id}`, undefined, token, 'GET')).proyecto;
  const createBody = (extra = {}) => ({ request_id: crypto.randomUUID(), titulo: `QA project ${++serial}`, cliente_id: client.id,
    responsable_id: ids.responsible, tipo: 'web', descripcion: 'QA shared operational description',
    fecha_inicio: '2026-10-01', fecha_entrega: '2026-11-01', miembro_ids: [ids.member], ...extra });
  const create = async (extra = {}) => {
    const body = createBody(extra); const response = ok(await api('/proyectos', body), [201]);
    assert.equal(response.idempotent, false); return { project: response.proyecto, body };
  };
  const mutate = async (id, path, body, token = admin, method = path ? 'POST' : 'PATCH') => {
    const current = await read(id); const beforeEvents = (await fixture.query('SELECT count(*)::int AS n FROM proyecto_actividad WHERE proyecto_id=$1', [id]))[0].n;
    const result = ok(await api(`/proyectos/${id}${path}`, { expected_revision: current.revision, ...body }, token, method), method === 'POST' ? [201] : [200]);
    assert.equal(result.proyecto.revision, current.revision + 1, 'Each mutation advances parent revision exactly once');
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM proyecto_actividad WHERE proyecto_id=$1', [id]))[0].n, beforeEvents + 1);
    return result.proyecto;
  };
  const link = async (projectId, task, etapa_id) => mutate(projectId, '/tareas', { tarea_id: task.id,
    expected_tarea_revision: (await fixture.query('SELECT revision FROM tareas WHERE id=$1', [task.id]))[0].revision,
    ...(etapa_id ? { etapa_id } : {}) });
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const safeProject = (project, detail = true) => {
    keys(project, [...summaryKeys, ...(detail ? ['descripcion', 'miembro_ids', 'etapas', 'hitos', 'entregables', 'tareas', 'actividad', 'permissions', 'tareas_no_disponibles'] : [])]);
    keys(project.cliente, ['id', 'nombre']); keys(project.responsable, ['id', 'nombre']); keys(project.counts, ['tareas', 'finalizadas', 'hitos', 'entregables']);
    assert.equal(project.href, `/proyectos?proyecto=${project.id}`); assert.ok(Number.isSafeInteger(project.revision) && project.revision > 0);
    assert.ok(!JSON.stringify(project).includes(poison)); assert.ok(!JSON.stringify(project).includes('637281.49'));
    if (!detail) return;
    keys(project.permissions, ['administrar', 'editar']); assert.ok(project.actividad.length <= 20);
    for (const item of project.etapas) keys(item, ['id', 'titulo', 'posicion', 'estado']);
    for (const item of project.hitos) keys(item, ['id', 'etapa_id', 'titulo', 'fecha', 'estado']);
    for (const item of project.entregables) keys(item, ['id', 'titulo', 'url', 'observaciones', 'estado', 'aprobado_por_id', 'aprobado_at']);
    for (const item of project.tareas) {
      keys(item, ['id', 'titulo', 'estado', 'prioridad', 'revision', 'fecha_vencimiento', 'etapa_id', 'href']);
      assert.equal(item.href, `/workspace/tareas?task=${item.id}`);
    }
    for (const item of project.actividad) keys(item, ['id', 'actor_id', 'accion', 'created_at', 'recurso_id', 'tarea_id', 'estado_anterior', 'estado_nuevo']);
  };
  const main = await create(); const second = await create({ titulo: 'QA second independent project' });
  let stageId;
  await t.test('shared reads use active identity while structural authority is responsible ID, never homonym or member', async () => {
    assert.equal((await request(fixture.base, '/api/proyectos')).status, 401);
    for (const [token, canEdit] of [[responsible, true], [homonym, false], [member, false]]) {
      const project = await read(main.project.id, token); safeProject(project);
      assert.deepEqual(project.permissions, { administrar: false, editar: canEdit });
    }
    assert.deepEqual((await read(main.project.id)).permissions, { administrar: true, editar: true });
    for (const token of [responsible, homonym, member]) {
      const before = await snapshot(); assert.equal((await api('/proyectos', createBody(), token)).status, 403); assert.deepEqual(await snapshot(), before);
    }
    for (const token of [homonym, member]) {
      const before = await snapshot();
      assert.equal((await api(`/proyectos/${main.project.id}`, { expected_revision: (await read(main.project.id)).revision, titulo: 'Denied structural rename' }, token, 'PATCH')).status, 403);
      assert.deepEqual(await snapshot(), before);
    }
    const updated = await mutate(main.project.id, '', { titulo: 'QA responsible authorized title', fecha_inicio: null }, responsible);
    assert.equal(updated.fecha_inicio, null);
    const before = await snapshot();
    assert.equal((await api(`/proyectos/${main.project.id}`, { expected_revision: updated.revision, responsable_id: ids.homonym }, responsible, 'PATCH')).status, 403);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('admin create exact request replays current detail, conflicts on changed hash and serializes duplicate requests', async () => {
    const before = await snapshot(); const retried = ok(await api('/proyectos', main.body));
    assert.equal(retried.idempotent, true); assert.equal(retried.proyecto.titulo, 'QA responsible authorized title'); assert.deepEqual(await snapshot(), before);
    assert.equal((await api('/proyectos', { ...main.body, titulo: 'QA changed request intention' })).status, 409);
    const body = createBody(); const results = await Promise.all([api('/proyectos', body), api('/proyectos', body)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
    assert.equal((await fixture.query('SELECT id FROM proyectos WHERE creado_por_id=91001 AND request_id=$1', [body.request_id])).length, 1);
    const minimal = { request_id: crypto.randomUUID(), titulo: 'QA canonical defaults', cliente_id: client.id, responsable_id: ids.responsible, tipo: 'otro' };
    const minimalResult = ok(await api('/proyectos', minimal), [201]);
    const beforeDefaults = await snapshot();
    const defaultsRetry = ok(await api('/proyectos', { miembro_ids: [], fecha_entrega: null, descripcion: '', fecha_inicio: null, ...minimal }));
    assert.equal(defaultsRetry.idempotent, true); assert.equal(defaultsRetry.proyecto.id, minimalResult.proyecto.id);
    assert.deepEqual(await snapshot(), beforeDefaults);
    await fixture.query('UPDATE clientes SET activo=false WHERE id=$1', [client.id]);
    try { assert.equal(ok(await api('/proyectos', main.body)).proyecto.id, main.project.id); }
    finally { await fixture.query('UPDATE clientes SET activo=true WHERE id=$1', [client.id]); }
  });
  await t.test('stage/milestone/deliverable CRUD and reorder enforce parent IDs and preserve explicit approval history', async () => {
    let project = await mutate(main.project.id, '/etapas', { titulo: 'QA design stage' }, responsible);
    stageId = project.etapas.find(item => item.titulo === 'QA design stage').id;
    project = await mutate(main.project.id, '/etapas', { titulo: 'QA implementation stage' }, responsible);
    const otherStage = project.etapas.find(item => item.id !== stageId).id;
    project = await mutate(main.project.id, '/etapas/orden', { etapa_ids: [otherStage, stageId] }, responsible, 'PUT');
    assert.deepEqual([...project.etapas].sort((a, b) => a.posicion - b.posicion).map(item => item.id), [otherStage, stageId]);
    await mutate(main.project.id, `/etapas/${stageId}`, { estado: 'completada' }, responsible, 'PATCH');
    project = await mutate(main.project.id, '/hitos', { titulo: 'QA first milestone', fecha: '2026-10-22', etapa_id: stageId }, responsible);
    const milestone = project.hitos.find(item => item.titulo === 'QA first milestone');
    project = await mutate(main.project.id, `/hitos/${milestone.id}`, { fecha: null, estado: 'completado' }, responsible, 'PATCH');
    assert.equal(project.hitos.find(item => item.id === milestone.id).fecha, null);
    project = await mutate(main.project.id, '/entregables', { titulo: 'QA deliverable', url: 'https://example.invalid/qa-project', observaciones: 'Operational evidence' }, responsible);
    const delivery = project.entregables.find(item => item.titulo === 'QA deliverable');
    project = await mutate(main.project.id, `/entregables/${delivery.id}`, { estado: 'aprobado' }, responsible, 'PATCH');
    const approved = project.entregables.find(item => item.id === delivery.id);
    assert.equal(approved.aprobado_por_id, ids.responsible); assert.ok(Number.isFinite(Date.parse(approved.aprobado_at)));
    project = await mutate(main.project.id, `/entregables/${delivery.id}`, { estado: 'correcciones' }, responsible, 'PATCH');
    const corrected = project.entregables.find(item => item.id === delivery.id);
    assert.equal(corrected.aprobado_por_id, null); assert.equal(corrected.aprobado_at, null);
    const historyRows = await fixture.query('SELECT * FROM proyecto_actividad WHERE proyecto_id=$1 AND recurso_id=$2 ORDER BY id', [main.project.id, delivery.id]);
    assert.ok(historyRows.some(row => row.actor_id === ids.responsible && row.estado_nuevo === 'aprobado' && row.created_at));
    assert.ok(historyRows.some(row => row.actor_id === ids.responsible && row.estado_anterior === 'aprobado' && row.estado_nuevo === 'correcciones'));
    const foreign = await mutate(second.project.id, '/etapas', { titulo: 'QA foreign stage' });
    const before = await snapshot();
    const bad = await api(`/proyectos/${main.project.id}/hitos`, { expected_revision: project.revision, titulo: 'Forbidden foreign stage', etapa_id: foreign.etapas[0].id });
    assert.ok([400, 404, 409].includes(bad.status)); assert.deepEqual(await snapshot(), before);
    safeProject(await read(main.project.id, member));
  });
  await t.test('all parent mutations use exact CAS and concurrent edits have one winner', async () => {
    const current = await read(main.project.id); const before = await snapshot();
    assert.equal((await api(`/proyectos/${main.project.id}`, { titulo: 'Missing CAS' }, responsible, 'PATCH')).status, 400);
    assert.equal((await api(`/proyectos/${main.project.id}/etapas`, { expected_revision: current.revision - 1, titulo: 'Stale stage' }, responsible)).status, 409);
    assert.deepEqual(await snapshot(), before);
    const results = await Promise.all(['one', 'two'].map(value => api(`/proyectos/${main.project.id}`, { expected_revision: current.revision, descripcion: `QA concurrent ${value}` }, responsible, 'PATCH')));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal((await read(main.project.id)).revision, current.revision + 1);
    const observed = (await read(main.project.id)).revision;
    await fixture.query("UPDATE proyectos SET titulo='QA external writer' WHERE id=$1", [main.project.id]);
    assert.equal((await read(main.project.id)).revision, observed + 1);
    assert.equal((await api(`/proyectos/${main.project.id}`, { expected_revision: observed, titulo: 'Stale external revision' }, responsible, 'PATCH')).status, 409);
  });
  let linkedTask;
  await t.test('existing task links are unique and reject incompatible clients, private/editorial/production domains', async () => {
    const createdTask = ok(await api('/tareas', { titulo: 'QA real Desarrollo task', workspace: 'render_os', cliente_id: client.id,
      asignado_a_id: ids.member, colaborador_ids: [], tipo_tarea: 'desarrollo', subtipo: 'web', fecha_vencimiento: '2026-10-25' }), [201]);
    linkedTask = createdTask;
    assert.equal(linkedTask.tipo_tarea, 'desarrollo'); assert.equal(linkedTask.subtipo, 'web');
    assert.equal(linkedTask.publicacion_id ?? null, null); assert.equal(linkedTask.historia_id ?? null, null);
    const web = ok(await api('/tareas?workspace=render_os&area=web', undefined, member, 'GET'));
    assert.ok(Array.isArray(web) && web.some(task => task.id === linkedTask.id));
    const sector = ok(await api('/tareas?workspace=render_os&tipo_tarea=desarrollo', undefined, member, 'GET'));
    assert.ok(Array.isArray(sector) && sector.some(task => task.id === linkedTask.id));
    assert.ok(sector.every(task => task.tipo_tarea === 'desarrollo'));
    const generic = ok(await api('/tareas', { titulo: 'QA generic technical maintenance', workspace: 'render_os', cliente_id: client.id,
      asignado_a_id: ids.member, colaborador_ids: [], tipo_tarea: 'desarrollo', fecha_vencimiento: '2026-10-25' }), [201]);
    const area = ok(await api('/tareas?workspace=render_os&area=desarrollo', undefined, member, 'GET'));
    assert.ok(Array.isArray(area) && area.some(task => task.id === generic.id));
    assert.ok(!area.some(task => task.id === linkedTask.id), 'Web subarea must not be flattened into generic Desarrollo');
    assert.ok(area.every(task => task.tipo_tarea === 'desarrollo'));
    const beforeCount = (await fixture.query('SELECT count(*)::int AS n FROM tareas'))[0].n;
    const linked = await link(main.project.id, linkedTask, stageId);
    assert.equal(linked.counts.tareas, 1); assert.equal((await fixture.query('SELECT count(*)::int AS n FROM tareas'))[0].n, beforeCount);
    const source = await seedTask({ type: 'produccion' }); const visitId = crypto.randomUUID();
    await fixture.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,$3,'2026-10-25','QA excluded source',91001,91001)`, [visitId, source.id, client.id]);
    const edit = await seedTask();
    await fixture.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,tarea_edicion_id,editor_id,fecha_entrega,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,'QA excluded editing','grabado',$3,$4,'2026-10-28',91001,91001)`, [crypto.randomUUID(), visitId, edit.id, ids.member]);
    for (const invalid of [editorialTask, historicalTask, source, edit, await seedTask({ clientId: otherClient.id }), await seedTask({ properties: { workspace: 'private' } })]) {
      const current = await read(main.project.id); const before = await snapshot();
      const unavailable = invalid.propiedades_extra?.workspace !== 'render_os';
      assert.equal((await api(`/proyectos/${main.project.id}/tareas`, { expected_revision: current.revision, tarea_id: invalid.id, expected_tarea_revision: invalid.revision })).status, unavailable ? 404 : 409);
      await assert.rejects(fixture.query('INSERT INTO proyecto_tareas(proyecto_id,tarea_id) VALUES ($1,$2)', [main.project.id, invalid.id]));
      assert.deepEqual(await snapshot(), before);
    }
    const raceTask = await seedTask(); const a = await read(main.project.id); const b = await read(second.project.id);
    const results = await Promise.all([[a, main.project.id], [b, second.project.id]].map(([project, id]) => api(`/proyectos/${id}/tareas`, {
      expected_revision: project.revision, tarea_id: raceTask.id, expected_tarea_revision: raceTask.revision })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  });
  await t.test('reciprocal goal/source/video guards reject both insertion orders through API and direct SQL', async () => {
    for (const domain of ['goal', 'source', 'video']) {
      const task = await seedTask(); await link(main.project.id, task);
      const visit = crypto.randomUUID();
      if (domain === 'video') await fixture.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
        VALUES ($1,$2,'2026-10-25','QA reverse video container',91001,91001)`, [visit, client.id]);
      const write = async target => domain === 'goal' ? fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,titulo)
        VALUES ($1,'video',$2,$3,'QA reverse goal')`, [goal.id, ++serial, target.id])
        : domain === 'source' ? fixture.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
          VALUES ($1,$2,$3,'2026-10-25','QA reverse source',91001,91001)`, [crypto.randomUUID(), target.id, client.id])
          : fixture.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,tarea_edicion_id,editor_id,fecha_entrega,creado_por_id,actualizado_por_id)
            VALUES ($1,$2,'QA reverse video','grabado',$3,$4,'2026-10-28',91001,91001)`, [crypto.randomUUID(), visit, target.id, ids.member]);
      const before = await snapshot(); await assert.rejects(write(task)); assert.deepEqual(await snapshot(), before);
      let update;
      if (domain === 'goal') {
        const [empty] = await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,titulo)
          VALUES ($1,'video',$2,'QA reciprocal UPDATE goal') RETURNING id`, [goal.id, ++serial]);
        update = () => fixture.query('UPDATE cliente_objetivo_piezas SET tarea_id=$1 WHERE id=$2', [task.id, empty.id]);
      } else if (domain === 'source') {
        const empty = crypto.randomUUID();
        await fixture.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
          VALUES ($1,$2,'2026-10-25','QA reciprocal UPDATE source',91001,91001)`, [empty, client.id]);
        update = () => fixture.query('UPDATE produccion_visitas SET tarea_origen_id=$1 WHERE id=$2', [task.id, empty]);
      } else {
        const empty = crypto.randomUUID();
        await fixture.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,creado_por_id,actualizado_por_id)
          VALUES ($1,$2,'QA reciprocal UPDATE video','planificado',91001,91001)`, [empty, visit]);
        update = () => fixture.query(`UPDATE produccion_videos SET tarea_edicion_id=$1,editor_id=$2,fecha_entrega='2026-10-28' WHERE id=$3`, [task.id, ids.member, empty]);
      }
      const beforeUpdate = await snapshot(); await assert.rejects(update()); assert.deepEqual(await snapshot(), beforeUpdate);
      const reverse = await seedTask(); await write(reverse);
      const beforeLink = await snapshot(); const observed = await read(main.project.id);
      assert.equal((await api(`/proyectos/${main.project.id}/tareas`, { expected_revision: observed.revision, tarea_id: reverse.id, expected_tarea_revision: reverse.revision })).status, 409);
      await assert.rejects(fixture.query('INSERT INTO proyecto_tareas(proyecto_id,tarea_id) VALUES ($1,$2)', [main.project.id, reverse.id]));
      assert.deepEqual(await snapshot(), beforeLink);
    }
  });
  await t.test('reciprocal insertion racing a project link serializes on the task without advisory inversion', async () => {
    const task = await seedTask(); const project = await read(main.project.id); const marker = `qa_project_race_${crypto.randomUUID().replaceAll('-', '')}`;
    const slotNumber = ++serial;
    const blocker = fixture.query(`/* ${marker} */ BEGIN; SELECT id FROM tareas WHERE id=${task.id} FOR UPDATE;
      SELECT pg_sleep(1.2); INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,titulo)
      VALUES (${goal.id},'video',${slotNumber},${task.id},'QA winning reciprocal row'); COMMIT;`)
      .then(value => ({ value }), error => ({ error }));
    let operation;
    try {
      const deadline = Date.now() + 650; let sleeping = false;
      while (Date.now() < deadline && !sleeping) {
        sleeping = (await fixture.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND position($1 in query)>0 AND wait_event='PgSleep'`, [marker])).length > 0;
        if (!sleeping) await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(sleeping, true);
      operation = api(`/proyectos/${main.project.id}/tareas`, { expected_revision: project.revision, tarea_id: task.id, expected_tarea_revision: task.revision });
      const waitDeadline = Date.now() + 650; let taskWait = false;
      while (Date.now() < waitDeadline && !taskWait) {
        taskWait = (await fixture.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%FROM tareas%FOR UPDATE%'`)).length > 0;
        if (!taskWait) await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(taskWait, true, 'Actual HTTP linker must be observed waiting while reciprocal writer owns the task');
      const result = await operation; assert.equal(result.status, 409);
      const finished = await blocker; if (finished.error) throw finished.error;
      assert.equal((await fixture.query('SELECT * FROM proyecto_tareas WHERE tarea_id=$1', [task.id])).length, 0);
      assert.equal((await fixture.query('SELECT * FROM cliente_objetivo_piezas WHERE tarea_id=$1', [task.id])).length, 1);
    } finally { const finished = await blocker; if (operation) await operation; if (finished.error) throw finished.error; }
  });
  await t.test('direct repeatable-read domain writers fail closed with named isolation constraint and leave rows unchanged', async () => {
    const eligible = await seedTask();
    const videoContainer = crypto.randomUUID();
    await fixture.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,'2026-10-25','QA RR video container',91001,91001)`, [videoContainer, client.id]);
    assert.match(main.project.id, /^[0-9a-f-]{36}$/i);
    const cases = [
      `INSERT INTO proyecto_tareas(proyecto_id,tarea_id) VALUES ('${main.project.id}'::uuid,${eligible.id})`,
      `UPDATE proyectos SET cliente_id=${otherClient.id} WHERE id='${main.project.id}'::uuid`,
      `UPDATE tareas SET cliente_id=${otherClient.id} WHERE id=${linkedTask.id}`,
      `INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,titulo)
        VALUES (${goal.id},'video',${++serial},${linkedTask.id},'QA RR reciprocal goal')`,
      `INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
        VALUES ('${crypto.randomUUID()}'::uuid,${linkedTask.id},${client.id},'2026-10-25','QA RR reciprocal source',91001,91001)`,
      `INSERT INTO produccion_videos(id,visita_id,titulo,estado,tarea_edicion_id,editor_id,fecha_entrega,creado_por_id,actualizado_por_id)
        VALUES ('${crypto.randomUUID()}'::uuid,'${videoContainer}'::uuid,'QA RR reciprocal video','grabado',${linkedTask.id},${ids.member},'2026-10-28',91001,91001)`,
    ];
    for (const statement of cases) {
      const before = await snapshot();
      // One physical query owns BEGIN/DO/ROLLBACK on one pooled connection.
      // Catch only SQLSTATE23514 and verify its exact constraint. The inner
      // subtransaction rolls back failed SQL; outer transaction always rolls
      // back on success, while an unexpected error aborts the client query.
      await fixture.query(`BEGIN ISOLATION LEVEL REPEATABLE READ;
        DO $qa_rr$ DECLARE rejected boolean:=false; constraint_name text;
        BEGIN
          BEGIN ${statement};
          EXCEPTION WHEN check_violation THEN
            GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
            IF constraint_name IS DISTINCT FROM 'proyectos_isolation' THEN
              RAISE EXCEPTION 'Unexpected RR domain constraint' USING ERRCODE='XX000';
            END IF;
            rejected:=true;
          END;
          IF NOT rejected THEN RAISE EXCEPTION 'RR domain write was not rejected' USING ERRCODE='XX000'; END IF;
        END $qa_rr$; ROLLBACK;`);
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('linked task writers cannot change domain/client or delete identity; unlink removes only relationship', async () => {
    const unsupportedTask = ok(await api(`/tareas/${linkedTask.id}?workspace=render_os`, undefined, admin, 'GET'));
    const beforeUnsupported = await snapshot();
    assert.equal((await api(`/tareas/${linkedTask.id}?workspace=render_os`, {
      expected_revision: unsupportedTask.revision, historia_id: history.id,
    }, admin, 'PATCH')).status, 400, 'Existing task PATCH does not expose historia_id as an editable field');
    assert.deepEqual(await snapshot(), beforeUnsupported);
    for (const changes of [{ cliente_id: otherClient.id }, { publicacion_id: publication.id },
      { tipo_tarea: 'produccion', subtipo: 'visita' }]) {
      const task = ok(await api(`/tareas/${linkedTask.id}?workspace=render_os`, undefined, admin, 'GET')); const before = await snapshot();
      const result = await api(`/tareas/${linkedTask.id}?workspace=render_os`, { expected_revision: task.revision, ...changes }, admin, 'PATCH');
      assert.equal(result.status, 409, JSON.stringify({ changes, status: result.status, error: result.body?.error,
        returnedworkspace: result.body?.propiedades_extra?.workspace }));
      assert.deepEqual(await snapshot(), before);
    }
    const domainFields = () => fixture.query(`SELECT id,cliente_id,historia_id,publicacion_id,tipo_tarea,subtipo,
      propiedades_extra->>'workspace' AS workspace FROM tareas WHERE id=$1`, [linkedTask.id]);
    const beforePinnedDomain = await domainFields();
    const beforePinnedLinks = await fixture.query('SELECT to_jsonb(x) AS row FROM proyecto_tareas x WHERE tarea_id=$1 ORDER BY proyecto_id', [linkedTask.id]);
    const pinnedRevision = ok(await api(`/tareas/${linkedTask.id}?workspace=render_os`, undefined, admin, 'GET')).revision;
    const pinned = await api(`/tareas/${linkedTask.id}?workspace=render_os`, {
      expected_revision: pinnedRevision, propiedades_extra: { workspace: 'private' },
    }, admin, 'PATCH');
    assert.equal(pinned.status, 200, JSON.stringify({ changes: { workspace: 'private' }, status: pinned.status,
      error: pinned.body?.error, returnedworkspace: pinned.body?.propiedades_extra?.workspace }));
    assert.equal(pinned.body.propiedades_extra.workspace, 'render_os');
    assert.deepEqual(await domainFields(), beforePinnedDomain, 'Canonical RenderOS PATCH must preserve actual task domain fields');
    assert.deepEqual(await fixture.query('SELECT to_jsonb(x) AS row FROM proyecto_tareas x WHERE tarea_id=$1 ORDER BY proyecto_id', [linkedTask.id]), beforePinnedLinks);
    const beforeUnpinned = await snapshot();
    const unpinnedRevision = ok(await api(`/tareas/${linkedTask.id}?workspace=render_os`, undefined, admin, 'GET')).revision;
    const unpinned = await api(`/tareas/${linkedTask.id}`, { expected_revision: unpinnedRevision,
      propiedades_extra: { workspace: 'private' } }, admin, 'PATCH');
    assert.equal(unpinned.status, 409, JSON.stringify({ changes: { workspace: 'private', renderOSQuery: false }, status: unpinned.status,
      error: unpinned.body?.error, returnedworkspace: unpinned.body?.propiedades_extra?.workspace }));
    assert.deepEqual(await snapshot(), beforeUnpinned);
    for (const [sql, values] of [['UPDATE tareas SET cliente_id=$1 WHERE id=$2', [otherClient.id, linkedTask.id]],
      ['UPDATE tareas SET publicacion_id=$1 WHERE id=$2', [publication.id, linkedTask.id]],
      ['UPDATE proyectos SET cliente_id=$1 WHERE id=$2', [otherClient.id, main.project.id]]]) {
      const beforeSql = await snapshot(); await assert.rejects(fixture.query(sql, values)); assert.deepEqual(await snapshot(), beforeSql);
    }
    // IPC intentionally carries error messages, not pg error codes. Catch only
    // SQLSTATE23514 with the named domain guard, not an unrelated constraint.
    for (const statement of [`UPDATE tareas SET historia_id=${history.id} WHERE id=${linkedTask.id}`,
      `UPDATE tareas SET propiedades_extra=propiedades_extra || '{"workspace":"private"}'::jsonb WHERE id=${linkedTask.id}`]) {
      const beforeDomainSql = await snapshot();
      await fixture.query(`DO $qa_domain$ DECLARE rejected boolean:=false; constraint_name text;
        BEGIN
          BEGIN ${statement};
          EXCEPTION WHEN check_violation THEN
            GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
            IF constraint_name IS DISTINCT FROM 'proyectos_tarea_domain' THEN RAISE EXCEPTION 'Unexpected project domain constraint' USING ERRCODE='XX000'; END IF;
            rejected:=true;
          END;
          IF NOT rejected THEN RAISE EXCEPTION 'Expected SQLSTATE23514 project domain rejection' USING ERRCODE='XX000'; END IF;
        END $qa_domain$;`);
      assert.deepEqual(await snapshot(), beforeDomainSql);
    }
    const before = await snapshot(); assert.equal((await api(`/tareas/${linkedTask.id}`, undefined, admin, 'DELETE')).status, 409); assert.deepEqual(await snapshot(), before);
    const temporary = await seedTask(); await link(second.project.id, temporary);
    await mutate(second.project.id, `/tareas/${temporary.id}`, {}, admin, 'DELETE');
    assert.equal((await fixture.query('SELECT id FROM tareas WHERE id=$1', [temporary.id])).length, 1);
    const purge = await api(`/tareas/${temporary.id}`, undefined, admin, 'DELETE'); assert.equal(purge.status, 200);
    assert.ok((await fixture.query("SELECT tarea_id FROM proyecto_actividad WHERE proyecto_id=$1 AND accion='desvincular_tarea'", [second.project.id])).some(row => row.tarea_id === temporary.id));
  });
  await t.test('existing task API workflow/date changes appear live without project membership grants or publication', async () => {
    const editorialBefore = await fixture.query('SELECT to_jsonb(p) AS row FROM publicaciones p ORDER BY id'); const projectState = (await read(main.project.id)).estado;
    const patch = async (changes, token) => {
      const task = ok(await api(`/tareas/${linkedTask.id}?workspace=render_os`, undefined, admin, 'GET'));
      return api(`/tareas/${linkedTask.id}?workspace=render_os`, { expected_revision: task.revision, expected_updated_at: task.updated_at, ...changes }, token, 'PATCH');
    };
    assert.ok([403, 404].includes((await patch({ aclaraciones: 'No project-based task grant' }, responsible)).status));
    ok(await patch({ fecha_vencimiento: '2026-11-05', estado: 'en_progreso' }, member));
    ok(await patch({ estado: 'en_revision' }, member)); ok(await patch({ estado: 'aprobada' }, admin)); ok(await patch({ estado: 'finalizada' }, admin));
    const detail = await read(main.project.id, await login('qa_project_member'));
    const linked = detail.tareas.find(row => row.id === linkedTask.id); assert.equal(linked.estado, 'finalizada'); assert.equal(linked.fecha_vencimiento, '2026-11-05');
    assert.ok(detail.counts.finalizadas >= 1); assert.equal(detail.estado, projectState);
    assert.deepEqual(await fixture.query('SELECT to_jsonb(p) AS row FROM publicaciones p ORDER BY id'), editorialBefore);
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra || '{"papelera_render_os":true}'::jsonb WHERE id=$1`, [linkedTask.id]);
    const hidden = await read(main.project.id); assert.ok(!hidden.tareas.some(row => row.id === linkedTask.id));
    assert.ok(hidden.tareas_no_disponibles >= 1); assert.equal(hidden.counts.tareas, detail.counts.tareas); assert.equal(hidden.counts.finalizadas, detail.counts.finalizadas - 1);
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra - 'papelera_render_os' WHERE id=$1`, [linkedTask.id]);
  });
  await t.test('audit and child failures roll back parent CAS, rows and history then permit exact explicit retry', async () => {
    for (const table of ['proyecto_actividad', 'proyecto_hitos']) {
      const project = await read(main.project.id); const payload = { expected_revision: project.revision, titulo: `QA rollback ${table}`, etapa_id: stageId };
      await fixture.query(`CREATE FUNCTION qa_project_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'QA project injected failure' USING ERRCODE='XX000'; END $$;
        CREATE TRIGGER qa_project_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION qa_project_fail()`);
      try { const before = await snapshot(); assert.equal((await api(`/proyectos/${main.project.id}/hitos`, payload)).status, 500); assert.deepEqual(await snapshot(), before); }
      finally { await fixture.query(`DROP TRIGGER qa_project_fail ON ${table}; DROP FUNCTION qa_project_fail()`); }
      assert.equal((await api(`/proyectos/${main.project.id}/hitos`, payload)).status, 201);
    }
    const payload = createBody();
    await fixture.query(`CREATE FUNCTION qa_project_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA create audit failure' USING ERRCODE='XX000'; END $$;
      CREATE TRIGGER qa_project_fail BEFORE INSERT ON proyecto_actividad FOR EACH ROW EXECUTE FUNCTION qa_project_fail()`);
    try { const before = await snapshot(); assert.equal((await api('/proyectos', payload)).status, 500); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query('DROP TRIGGER qa_project_fail ON proyecto_actividad; DROP FUNCTION qa_project_fail()'); }
    assert.equal((await api('/proyectos', payload)).status, 201);
  });
  await t.test('Home projects use assigned IDs through membership/responsible changes, renames and archive/state changes', async () => {
    const dedicated = await create({ titulo: 'QA Home project identity' }); const id = dedicated.project.id;
    const home = async token => ok(await api('/inicio', undefined, token, 'GET'));
    assert.ok((await home(responsible)).projects.some(project => project.id === id));
    assert.ok((await home(member)).projects.some(project => project.id === id));
    assert.ok(!(await home(homonym)).projects.some(project => project.id === id));
    assert.ok(!(await home(admin)).projects.some(project => project.id === id));
    await mutate(id, '', { miembro_ids: [] }); assert.ok(!(await home(member)).projects.some(project => project.id === id));
    await mutate(id, '', { responsable_id: ids.homonym });
    assert.ok(!(await home(responsible)).projects.some(project => project.id === id)); assert.ok((await home(homonym)).projects.some(project => project.id === id));
    await fixture.query("UPDATE usuarios SET nombre='QA renamed stable responsible' WHERE id=$1", [ids.homonym]);
    await fixture.query("UPDATE clientes SET nombre='QA renamed stable project client' WHERE id=$1", [client.id]);
    const renamed = (await home(homonym)).projects.find(project => project.id === id); assert.equal(renamed.cliente.id, client.id); assert.equal(renamed.cliente.nombre, 'QA renamed stable project client');
    assert.equal(renamed.href, `/proyectos?proyecto=${id}`);
    await mutate(id, '', { archivado: true }); assert.ok(!(await home(homonym)).projects.some(project => project.id === id));
    await mutate(id, '', { archivado: false }); await mutate(id, '', { estado: 'finalizado' }); assert.ok(!(await home(homonym)).projects.some(project => project.id === id));
    await mutate(id, '', { estado: 'en_curso' }); assert.ok((await home(homonym)).projects.some(project => project.id === id));
    await fixture.query('UPDATE clientes SET activo=false WHERE id=$1', [client.id]);
    try { assert.ok(!(await home(homonym)).projects.some(project => project.id === id)); }
    finally { await fixture.query('UPDATE clientes SET activo=true WHERE id=$1', [client.id]); }
    for (let n = 0; n < 9; n++) await create({ responsable_id: ids.homonym, miembro_ids: [], fecha_entrega: `2026-11-${String(10 + n).padStart(2, '0')}` });
    const expected = await fixture.query(`SELECT p.id,to_char(p.fecha_entrega,'YYYY-MM-DD') AS fecha_entrega FROM proyectos p
      JOIN clientes c ON c.id=p.cliente_id WHERE NOT p.archivado AND p.estado NOT IN ('finalizado','cancelado')
      AND c.activo IS DISTINCT FROM FALSE AND (p.responsable_id=$1 OR EXISTS(SELECT 1 FROM proyecto_miembros m WHERE m.proyecto_id=p.id AND m.usuario_id=$1))
      ORDER BY p.fecha_entrega NULLS LAST,p.id`, [ids.homonym]);
    const bounded = await home(homonym); assert.equal(bounded.capabilities.projects, true);
    assert.equal(bounded.list_totals.projects, expected.length); assert.equal(bounded.projects.length, 8);
    assert.deepEqual(bounded.projects.map(project => project.id), expected.slice(0, 8).map(project => project.id));
    for (const project of bounded.projects) keys(project, ['id', 'titulo', 'tipo', 'estado', 'fecha_entrega', 'revision', 'cliente', 'href']);
  });
  await t.test('safe DTOs, list validation/bounds and archived project authorization survive fresh login', async () => {
    const listing = ok(await api('/proyectos?limit=1&offset=0', undefined, member, 'GET'));
    keys(listing, ['proyectos', 'total', 'limit', 'offset']); assert.equal(listing.limit, 1); assert.equal(listing.offset, 0); assert.equal(listing.proyectos.length, 1); listing.proyectos.forEach(project => safeProject(project, false));
    const next = ok(await api('/proyectos?limit=1&offset=1', undefined, member, 'GET')); assert.equal(next.total, listing.total); assert.notEqual(next.proyectos[0].id, listing.proyectos[0].id);
    for (const query of ['limit=101', 'limit=0', 'offset=-1', 'estado=unknown', 'cliente_id=0']) assert.equal((await api(`/proyectos?${query}`, undefined, member, 'GET')).status, 400);
    const before = await snapshot(); const detail = await read(main.project.id, await login('qa_project_homonym')); safeProject(detail); assert.deepEqual(await snapshot(), before);
    const archived = await mutate(second.project.id, '', { archivado: true });
    const beforeDenied = await snapshot(); assert.equal((await api(`/proyectos/${second.project.id}/etapas`, { expected_revision: archived.revision, titulo: 'Denied archived' }, responsible)).status, 403); assert.deepEqual(await snapshot(), beforeDenied);
    assert.equal((await api('/proyectos?archivados=true', undefined, member, 'GET')).status, 403);
    assert.ok(ok(await api('/proyectos?archivados=true', undefined, admin, 'GET')).proyectos.some(project => project.id === second.project.id));
    await mutate(second.project.id, '', { archivado: false });
    const deleted = await fetch(new URL(`/api/proyectos/${second.project.id}`, fixture.base), { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` }, signal: AbortSignal.timeout(5000) });
    assert.ok([404, 405].includes(deleted.status)); await deleted.text();
    const bounded = await create({ titulo: 'QA explicit child capacity' }); const capId = bounded.project.id;
    const stageIds = Array.from({ length: 100 }, () => crypto.randomUUID());
    await fixture.query(`INSERT INTO proyecto_etapas(id,proyecto_id,titulo,posicion)
      SELECT x.id,$1,'QA capacity stage '||x.n,x.n::int-1 FROM unnest($2::uuid[]) WITH ORDINALITY x(id,n)`, [capId, stageIds]);
    for (const table of ['proyecto_hitos', 'proyecto_entregables']) await fixture.query(`INSERT INTO ${table}(id,proyecto_id,titulo)
      SELECT x.id,$1,'QA capacity child '||x.n FROM unnest($2::uuid[]) WITH ORDINALITY x(id,n)`, [capId, Array.from({ length: 200 }, () => crypto.randomUUID())]);
    const capTasks = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,propiedades_extra)
      SELECT 'QA capacity task '||n,'QA capacity fixture',$1,'desarrollo','pendiente','{"workspace":"render_os"}'::jsonb
      FROM generate_series(1,200) n RETURNING id`, [client.id]);
    await fixture.query('INSERT INTO proyecto_tareas(proyecto_id,tarea_id) SELECT $1,unnest($2::int[])', [capId, capTasks.map(task => task.id)]);
    const full = await read(capId); safeProject(full);
    assert.equal(full.etapas.length, 100); assert.equal(full.hitos.length, 200); assert.equal(full.entregables.length, 200); assert.equal(full.tareas.length, 200);
    for (const child of ['etapas', 'hitos', 'entregables']) {
      const beforeFull = await snapshot();
      assert.equal((await api(`/proyectos/${capId}/${child}`, { expected_revision: full.revision, titulo: 'QA beyond explicit bound' })).status, 409);
      assert.deepEqual(await snapshot(), beforeFull);
    }
    const extraTask = await seedTask(); const beforeFull = await snapshot();
    assert.equal((await api(`/proyectos/${capId}/tareas`, { expected_revision: full.revision, tarea_id: extraTask.id, expected_tarea_revision: extraTask.revision })).status, 409);
    assert.deepEqual(await snapshot(), beforeFull);
    for (let n = 0; n < 22; n++) await mutate(main.project.id, '', { descripcion: `QA bounded activity ${n}` });
    const events = (await read(main.project.id)).actividad;
    const expectedEvents = await fixture.query('SELECT id FROM proyecto_actividad WHERE proyecto_id=$1 ORDER BY id DESC LIMIT 20', [main.project.id]);
    assert.equal(events.length, 20); assert.deepEqual(events.map(event => Number(event.id)), expectedEvents.map(event => Number(event.id)));
  });
  await t.test('validation, forged authority fields and current identity changes fail closed without project writes', async () => {
    for (const invalid of [{ responsable_id: -1 }, { cliente_id: inactiveClient.id }, { fecha_inicio: '2026-12-01', fecha_entrega: '2026-01-01' },
      { tipo: 'unknown' }, { titulo: '' }, { request_hash: 'a'.repeat(64) }, { actor_id: ids.responsible }, { importe: 1 }]) {
      const before = await snapshot(); assert.ok([400, 422].includes((await api('/proyectos', createBody(invalid))).status)); assert.deepEqual(await snapshot(), before);
    }
    for (const url of ['javascript:alert(1)', 'https://user:password@example.invalid/file']) {
      const before = await snapshot(); assert.ok([400, 422].includes((await api(`/proyectos/${main.project.id}/entregables`, { expected_revision: (await read(main.project.id)).revision, titulo: 'QA unsafe URL', url })).status)); assert.deepEqual(await snapshot(), before);
    }
    const extra = await login('qa_project_extra'); await fixture.query("UPDATE usuarios SET rol='qa_unknown' WHERE id=$1", [ids.extra]);
    try { assert.equal((await api(`/proyectos/${main.project.id}`, undefined, extra, 'GET')).status, 403); }
    finally { await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=$1", [ids.extra]); }
    const revoked = await login('qa_project_responsible'); ok(await api('/logout', {}, revoked));
    assert.equal((await api(`/proyectos/${main.project.id}`, undefined, revoked, 'GET')).status, 401);
    const active = await login('qa_project_extra');
    const beforeDeactivate = ok(await api('/usuarios', undefined, admin, 'GET')).find(row => row.id === ids.extra)?.admin_revision;
    assert.match(beforeDeactivate, new RegExp(`^ua1:${ids.extra}:[0-9]+$`));
    ok(await api(`/usuarios/${ids.extra}/acceso`, { expected_revision: beforeDeactivate, activo: false }, admin, 'PATCH'));
    assert.equal((await api(`/proyectos/${main.project.id}`, undefined, active, 'GET')).status, 401);
    const beforeReactivate = ok(await api('/usuarios', undefined, admin, 'GET')).find(row => row.id === ids.extra)?.admin_revision;
    assert.match(beforeReactivate, new RegExp(`^ua1:${ids.extra}:[0-9]+$`));
    ok(await api(`/usuarios/${ids.extra}/acceso`, { expected_revision: beforeReactivate, activo: true }, admin, 'PATCH'));
  });
});
