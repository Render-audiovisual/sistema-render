import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { proposalSnapshot } from '../src/mia-supervisor-policy.js';

// Registry-router journey assertions await its actual endpoint/body contract.
test('production registry: historical invariance and real per-video HTTP workflow', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const migration = await readFile(new URL('../migrations/059_production_registry.sql', import.meta.url), 'utf8');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const externalActor = 'qa-registry-admin';
  const fixture = await startLocalHarness({ port: 55601, deferProductionRegistryMigration: true, supervisorEnabled: true,
    wilson: { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), allowedWhatsappIds: externalActor } });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production-registry fixture stopped and removed: ${fixture.root}`);
  });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.token;
  };
  const admin = await login('qa_franco');
  let sourceLink;
  let historicalTasks;
  const session = await api('/sesion', { token: admin });
  assert.equal(session.status, 200);
  assert.equal(session.body.usuario.id, 91001);
  await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=91001',
    [crypto.createHash('sha256').update(externalActor).digest('hex')]);
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  const signed = async (route, body, method = 'POST') => {
    const url = new URL(`/api/integraciones/wilson${route}`, fixture.base);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    const bodyHash = crypto.createHash('sha256').update(body === undefined ? '' : canonical(body)).digest('hex');
    const message = ['v2', timestamp, nonce, 'whatsapp', externalActor, '', 'QA registry admin', method,
      `${url.pathname}${url.search}`, bodyHash].join('\n');
    const response = await fetch(url, { method, signal: AbortSignal.timeout(5000), headers: {
      'x-wilson-signature-version': '2', 'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce,
      'x-wilson-channel': 'whatsapp', 'x-wilson-actor-id': externalActor, 'x-wilson-actor-name': 'QA registry admin',
      'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64'),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };

  await t.test('059 adds an empty registry without migrating, fusing or rewriting legacy tasks and goals', async () => {
    assert.equal((await fixture.query("SELECT nombre FROM _migrations WHERE nombre='059_production_registry.sql'")).length, 0);
    const registryTables = ['produccion_visitas', 'produccion_visita_participantes', 'produccion_videos', 'produccion_fotos'];
    for (const table of registryTables)
      assert.deepEqual(await fixture.query('SELECT to_regclass($1) AS relation', [`public.${table}`]), [{ relation: null }]);
    const [client] = await fixture.query("INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES ('QA registry historical client',3,1) RETURNING id");
    const [piece] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,fecha_publicación_real,metadata)
      VALUES ($1,'video','publicada','2026-09-10','2026-09-10T14:00:00Z','{"legacy_marker":"keep raw history"}') RETURNING id`, [client.id]);
    const [visit] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,subtipo,estado,propiedades_extra,updated_at)
      VALUES ('QA visita legacy 3 videos','Luciano QA',$1,'produccion','visita','en_revision',
      '{"workspace":"render_os","produccion_videos_previstos":3,"produccion_registros":[{"id":"legacy-record","cantidad":3,"fecha":"2026-09-10"}],"legacy_marker":"no automatic fusion"}',
      '2026-09-10T13:00:00Z') RETURNING id`, [client.id]);
    const [aggregate] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,tipo_tarea,subtipo,estado,propiedades_extra,updated_at)
      VALUES ('QA legacy aggregate editing 3 videos','Luciano QA',$1,$2,'edicion','video','publicada',$3::jsonb,
      '2026-09-10T13:30:00Z') RETURNING id`, [client.id, piece.id, JSON.stringify({ workspace: 'render_os',
      origen_visita_id: String(visit.id), legacy_marker: 'preserve aggregate task', finalizada_at: '2026-09-10T13:30:00Z' })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [aggregate.id]);
    const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales
      (clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
      VALUES ('qa-registry-history','2026-09-01',$1,'QA registry legacy goal',3,1,'Historical QA') RETURNING id`, [client.id]);
    const [slot] = await fixture.query(`INSERT INTO cliente_objetivo_piezas
      (objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,estado,completada_at)
      VALUES ($1,'video',1,$2,$3,'QA historical aggregate slot','publicada','2026-09-10T13:30:00Z') RETURNING id`, [goal.id, aggregate.id, piece.id]);
    await fixture.query(`INSERT INTO cliente_objetivo_eventos(pieza_id,estado_anterior,estado_nuevo,tarea_id,created_at)
      VALUES ($1,'en_revision','publicada',$2,'2026-09-10T13:30:00Z')`, [slot.id, aggregate.id]);
    const history = async () => {
      const result = {};
      for (const table of ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', 'historias', 'publicaciones',
        'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'])
        result[table] = await fixture.query(`SELECT * FROM ${table} ORDER BY ${table === 'tarea_asignaciones' ? 'tarea_id,usuario_id' : 'id'}`);
      return result;
    };
    const legacyIndexes = () => fixture.query(`SELECT indexname,indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='tareas' AND indexdef LIKE '%origen_visita_id%' ORDER BY indexname`);
    const before = await history();
    historicalTasks = { ids: [visit.id, aggregate.id], rows: await fixture.query('SELECT * FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [[visit.id, aggregate.id]]) };
    const beforeIndexes = await legacyIndexes();
    assert.ok(beforeIndexes.length, 'Existing legacy aggregate uniqueness index must be present');
    await fixture.query(migration);
    assert.deepEqual(await history(), before, '059 must not infer identities, split/fuse tasks or rewrite historical rows');
    assert.deepEqual(await legacyIndexes(), beforeIndexes, 'Legacy origin_visita_id index must remain unchanged');
    for (const table of registryTables)
      assert.deepEqual(await fixture.query(`SELECT count(*)::int AS count FROM ${table}`), [{ count: 0 }]);
    const lineage = await fixture.query(`SELECT column_name,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='produccion_videos' AND column_name='video_origen_id'`);
    assert.deepEqual(lineage, [{ column_name: 'video_origen_id', is_nullable: 'YES' }]);
    const selfReferences = await fixture.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid='produccion_videos'::regclass AND confrelid='produccion_videos'::regclass AND contype='f'`);
    assert.ok(selfReferences.some(row => row.definition.includes('FOREIGN KEY (video_origen_id) REFERENCES produccion_videos(id)')),
      'Video lineage must be a real nullable self-FK on videos, not on participants');
    const reuseIndex = await fixture.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='produccion_video_retomado_unico'");
    assert.equal(reuseIndex.length, 1);
    assert.match(reuseIndex[0].indexdef, /UNIQUE.*produccion_videos.*\(visita_id, video_origen_id\)/);
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('059_production_registry.sql')");
    // 060 depends on 059 and is also deferred by this fixture. Install it only
    // after all 059 history/empty-registry assertions above, before HTTP use.
    const editorialMigrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter(name => /^060_.*\.sql$/.test(name));
    assert.equal(editorialMigrations.length, 1);
    await fixture.query(await readFile(new URL(`../migrations/${editorialMigrations[0]}`, import.meta.url), 'utf8'));
    await fixture.query('INSERT INTO _migrations(nombre) VALUES ($1)', [editorialMigrations[0]]);
    await fixture.query(await readFile(new URL('../migrations/063_projects.sql', import.meta.url), 'utf8'));
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('063_projects.sql')");
    // 069 is deferred with its 059 dependency; run the actual forward SQL
    // after original history assertions and before current mutation routes.
    await fixture.query(await readFile(new URL('../migrations/069_production_reconciliation.sql',import.meta.url),'utf8'));
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('069_production_reconciliation.sql')");
    // 070 depends on 069 and is likewise deferred. Apply its real forward SQL
    // to the populated fixture; adoption must never backfill or rewrite history.
    const beforeAdoptions = await history();
    assert.deepEqual(await fixture.query("SELECT to_regclass('public.produccion_edicion_adopciones') AS relation"), [{ relation: null }]);
    await fixture.query(await readFile(new URL('../migrations/070_production_editing_adoptions.sql',import.meta.url),'utf8'));
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('070_production_editing_adoptions.sql')");
    assert.deepEqual(await history(), beforeAdoptions, '070 must preserve all populated historical rows and assignments');
    assert.deepEqual(await fixture.query('SELECT count(*)::int AS count FROM produccion_edicion_adopciones'), [{ count: 0 }]);
    // 078 is deferred with 059/060. Only after their original invariance
    // assertions may its forward SQL retire the legacy single-child index.
    const batchTables = ['produccion_revision_lotes', 'produccion_lote_edicion_mapeos',
      'produccion_revision_lote_videos', 'produccion_revision_lote_hijos'];
    assert.deepEqual(await fixture.query("SELECT nombre FROM _migrations WHERE nombre='078_production_history_batches.sql'"), []);
    const beforeBatches = await history();
    const beforeRegistry = {};
    for (const table of registryTables) beforeRegistry[table] = await fixture.query(`SELECT * FROM ${table}`);
    await fixture.query(await readFile(new URL('../migrations/078_production_history_batches.sql', import.meta.url), 'utf8'));
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('078_production_history_batches.sql')");
    assert.deepEqual(await history(), beforeBatches, '078 must not rewrite existing historical rows, assignments or goals');
    for (const table of registryTables) assert.deepEqual(await fixture.query(`SELECT * FROM ${table}`), beforeRegistry[table]);
    for (const table of batchTables) assert.deepEqual(await fixture.query(`SELECT count(*)::int AS count FROM ${table}`), [{ count: 0 }]);
    const beforeApprovals = await history();
    await fixture.query(await readFile(new URL('../migrations/079_project_deliverable_approvals.sql', import.meta.url), 'utf8'));
    await fixture.query("INSERT INTO _migrations(nombre) VALUES ('079_project_deliverable_approvals.sql')");
    assert.deepEqual(await history(), beforeApprovals, '079 must preserve existing operational history');
    assert.deepEqual(await fixture.query('SELECT * FROM proyecto_entregable_aprobaciones'), []);
  });
  await t.test('task POST registers one visit with no inferred videos; task-only date/client writes and deletion reject', async () => {
    const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA source task client') RETURNING id");
    const [otherClient] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA source task other client') RETURNING id");
    const created = await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'QA visita source hook', workspace: 'render_os', asignado_a_id: 91003, colaborador_ids: [],
      cliente_id: client.id, fecha_vencimiento: '2026-11-07', tipo_tarea: 'produccion', subtipo: 'visita',
      produccion_videos_previstos: 3,
    } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const taskId = created.body.id;
    const linked = () => fixture.query('SELECT * FROM produccion_visitas WHERE tarea_origen_id=$1', [taskId]);
    const visits = await linked();
    assert.equal(visits.length, 1, 'One explicit new task must register exactly one normalized visit');
    const visit = visits[0];
    sourceLink = { visitId: visit.id, taskId, clientId: client.id, otherClientId: otherClient.id };
    assert.equal(visit.cliente_id, client.id);
    assert.equal(String(visit.fecha).slice(0, 10), '2026-11-07');
    assert.deepEqual(await fixture.query('SELECT * FROM produccion_videos WHERE visita_id=$1', [visit.id]), [],
      'Planned count is not evidence of individual video identities');
    assert.deepEqual(await fixture.query('SELECT usuario_id FROM produccion_visita_participantes WHERE visita_id=$1 ORDER BY usuario_id', [visit.id]),
      [{ usuario_id: 91003 }]);
    const detail = async () => {
      const result = await api(`/tareas/${taskId}?workspace=render_os`, { token: admin });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body;
    };
    const state = async () => ({ task: await fixture.query('SELECT * FROM tareas WHERE id=$1', [taskId]),
      visits: await linked(), participants: await fixture.query('SELECT * FROM produccion_visita_participantes WHERE visita_id=$1 ORDER BY usuario_id', [visit.id]) });
    const beforeUnrelated = await linked();
    const current = await detail();
    const unrelated = await api(`/tareas/${taskId}?workspace=render_os`, { token: admin, method: 'PATCH',
      body: { prioridad: 'alta', expected_revision: current.revision, expected_updated_at: current.updated_at } });
    assert.equal(unrelated.status, 200, JSON.stringify(unrelated.body));
    assert.deepEqual(await linked(), beforeUnrelated, 'Unrelated task update must not overwrite or duplicate registry row');
    for (const body of [{ fecha_vencimiento: '2026-12-08' }, { cliente_id: otherClient.id }, { tipo_tarea: 'edicion' }, { titulo: 'QA no longer a visit', subtipo: 'inventario' }]) {
      const observed = await detail();
      const before = await state();
      const changed = await api(`/tareas/${taskId}?workspace=render_os`, { token: admin, method: 'PATCH',
        body: { ...body, expected_revision: observed.revision, expected_updated_at: observed.updated_at } });
      assert.equal(changed.status, 409, JSON.stringify(changed.body));
      assert.deepEqual(await state(), before, 'Registry-owned source date/client/classification must reject a task-only write atomically');
    }
    const beforeDelete = await state();
    const deleted = await api(`/tareas/${taskId}?workspace=render_os`, { token: admin, method: 'DELETE' });
    assert.equal(deleted.status, 409, JSON.stringify(deleted.body));
    assert.deepEqual(await state(), beforeDelete, 'FK-protected source deletion must be non-destructive');
  });

  // All remaining paths use the real registry router, not fixture table writes.
  for (const [id, rol] of [[98001, 'community'], [98002, 'edicion'], [98003, 'edicion'], [98004, 'diseno']])
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,$5,1 FROM usuarios WHERE id=91004`,
    [id, `qa_registry_${id}`, `QA Registry ${id}`, rol, id !== 98003]);
  const team = await login('qa_registry_98001');
  const editors = [
    { id: 91002, token: await login('qa_agustin') },
    { id: 91003, token: await login('qa_luciano') },
    { id: 98002, token: await login('qa_registry_98002') },
  ];
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA registry HTTP client') RETURNING id");
  const [otherClient] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA registry unrelated client') RETURNING id");
  const readVisit = async (id, token = admin) => {
    const result = await api(`/producciones/${id}`, { token });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.visita;
  };
  const createVisit = async (title, clientId = client.id, extra = {}) => {
    const result = await api('/producciones', { token: admin, method: 'POST', body: {
      cliente_id: clientId, fecha: '2026-10-20', titulo: title, participante_ids: [91003],
      drive_url: 'https://example.invalid/qa-registry-material', ...extra,
    } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.visita;
  };
  const addVideo = async (id, body, token = admin) => {
    const current = await readVisit(id);
    const result = await api(`/producciones/${id}/videos`, { token, method: 'POST',
      body: { expected_revision: current.revision, ...body } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.visita;
  };
  const updateVideo = async (id, videoId, body, token = team) => {
    const current = await readVisit(id);
    const result = await api(`/producciones/${id}/videos/${videoId}`, { token, method: 'PATCH',
      body: { expected_revision: current.revision, ...body } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.visita;
  };
  const handoff = (visitId, videoId, revision, editorId, delivery, token = admin) => api(
    `/producciones/${visitId}/videos/${videoId}/enviar-edicion`, { token, method: 'POST',
      body: { expected_revision: revision, editor_id: editorId, fecha_entrega: delivery } });
  const snapshot = async () => {
    const result = {};
    for (const table of ['tareas', 'tarea_asignaciones', 'produccion_visitas', 'produccion_visita_participantes', 'produccion_videos', 'produccion_fotos'])
      result[table] = await fixture.query(`SELECT * FROM ${table} ORDER BY ${table === 'tarea_asignaciones' ? 'tarea_id,usuario_id' : table === 'produccion_visita_participantes' ? 'visita_id,usuario_id' : 'id'}`);
    return result;
  };
  const taskDetail = async id => {
    const result = await api(`/tareas/${id}?workspace=render_os`, { token: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const patchTask = async (id, token, body) => {
    const current = await taskDetail(id);
    return api(`/tareas/${id}?workspace=render_os`, { token, method: 'PATCH',
      body: { expected_revision: current.revision, expected_updated_at: current.updated_at, ...body } });
  };
  let journeyVisit;
  let videoIds;
  let editingIds;

  await t.test('admin plans three videos; unassigned active teammate records videos/photos/pending work', async () => {
    journeyVisit = await createVisit('QA three individual videos');
    for (let number = 1; number <= 3; number++)
      journeyVisit = await addVideo(journeyVisit.id, { titulo: `QA Video ${number}`, guion: `QA Guion ${number}` });
    videoIds = journeyVisit.videos.map(video => video.id);
    assert.equal(new Set(videoIds).size, 3);
    assert.deepEqual((await readVisit(journeyVisit.id, team)).participante_ids, [91003]);
    journeyVisit = await updateVideo(journeyVisit.id, videoIds[0], { estado: 'grabado' });
    journeyVisit = await updateVideo(journeyVisit.id, videoIds[1], { estado: 'pendiente', observaciones: 'QA pendiente por grabar' });
    journeyVisit = await updateVideo(journeyVisit.id, videoIds[2], { estado: 'repetir' });
    const photos = await api(`/producciones/${journeyVisit.id}/fotos`, { token: team, method: 'POST', body: {
      expected_revision: journeyVisit.revision, tipo: 'QA fotos de producto', estado: 'realizada',
      drive_url: 'https://example.invalid/qa-photo',
    } });
    assert.equal(photos.status, 201, JSON.stringify(photos.body));
    journeyVisit = photos.body.visita;
    assert.equal(journeyVisit.fotos.length, 1);
    assert.equal(journeyVisit.videos.find(video => video.id === videoIds[1]).estado, 'pendiente');
    assert.equal(journeyVisit.videos.find(video => video.id === videoIds[2]).estado, 'repetir');
    for (const id of videoIds.slice(1)) journeyVisit = await updateVideo(journeyVisit.id, id, { estado: 'grabado' });
  });
  await t.test('handoff validates role, revision, IDs/date, editor and visit scope without writes', async () => {
    const current = await readVisit(journeyVisit.id);
    const other = await createVisit('QA cross-visit scope');
    const before = await snapshot();
    assert.equal((await handoff(current.id, videoIds[0], current.revision, editors[0].id, '2026-10-26', team)).status, 403);
    assert.equal((await handoff(current.id, videoIds[0], current.revision - 1, editors[0].id, '2026-10-26')).status, 409);
    for (const [id, delivery] of [['91003', '2026-10-26'], [91003, '2026-02-30'], [98003, '2026-10-26'], [98004, '2026-10-26']])
      assert.equal((await handoff(current.id, videoIds[0], current.revision, id, delivery)).status, 400);
    assert.equal((await handoff(current.id, 'bad-uuid', current.revision, 91003, '2026-10-26')).status, 400);
    assert.equal((await handoff(other.id, videoIds[0], other.revision, 91003, '2026-10-26')).status, 404);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('three recorded videos create three individual ID-bound editing tasks; repeats do not duplicate', async () => {
    editingIds = [];
    for (const [index, editor] of editors.entries()) {
      const current = await readVisit(journeyVisit.id);
      const delivery = `2026-10-${26 + index}`;
      const result = await handoff(current.id, videoIds[index], current.revision, editor.id, delivery);
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.created, true);
      assert.equal(result.body.task.asignado_a_id, editor.id);
      assert.deepEqual(result.body.task.colaborador_ids, []);
      // Confirmed contract: admin task DTO is raw and serializes PG DATE as
      // a timestamp; registry/current-task projections remain date-only.
      assert.equal(result.body.task.fecha_vencimiento.slice(0, 10), delivery);
      const handedVideo = result.body.visita.videos.find(video => video.id === videoIds[index]);
      assert.equal(handedVideo.fecha_entrega, delivery);
      assert.equal(handedVideo.fecha_entrega_handoff, delivery);
      assert.equal(handedVideo.fecha_entrega_actual, delivery);
      assert.equal((await taskDetail(result.body.task.id)).fecha_vencimiento, delivery);
      assert.deepEqual(await fixture.query("SELECT to_char(fecha_vencimiento,'YYYY-MM-DD') AS fecha FROM tareas WHERE id=$1", [result.body.task.id]),
        [{ fecha: delivery }]);
      assert.equal(result.body.task.propiedades_extra.origen_produccion_video_id, videoIds[index]);
      assert.equal(result.body.task.propiedades_extra.produccion_visita_id, current.id);
      assert.equal(result.body.task.propiedades_extra.origen_visita_id, undefined);
      editingIds.push(result.body.task.id);
      const before = await snapshot();
      const repeated = await handoff(current.id, videoIds[index], current.revision, editor.id, delivery);
      assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
      assert.equal(repeated.body.created, false);
      assert.equal(repeated.body.task.id, result.body.task.id);
      assert.deepEqual(await snapshot(), before);
    }
    assert.equal(new Set(editingIds).size, 3);
    journeyVisit = await readVisit(journeyVisit.id);
    assert.deepEqual(journeyVisit.videos.map(video => video.tarea_edicion_id).sort((a, b) => a - b), [...editingIds].sort((a, b) => a - b));
  });
  await t.test('assigned editor edits/reviews; approval/finalization joins reflect current task state without publication', async () => {
    const beforeEditorial = await fixture.query('SELECT * FROM publicaciones ORDER BY id');
    for (const [index, editor] of editors.entries()) {
      const id = editingIds[index];
      const own = await api(`/tareas?workspace=render_os&asignado_a_id=${editor.id}&limit=500`, { token: editor.token });
      assert.equal(own.status, 200);
      assert.ok(own.body.some(task => task.id === id));
      assert.equal((await patchTask(id, editor.token, { titulo: `QA edited video ${index}` })).status, 200);
      for (const [estado, token] of [['en_progreso', editor.token], ['en_revision', editor.token], ['aprobada', admin], ['finalizada', admin]]) {
        const result = await patchTask(id, token, { estado });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.estado, estado);
        const visible = (await readVisit(journeyVisit.id, team)).videos.find(video => video.id === videoIds[index]);
        assert.equal(visible.tarea_estado, estado);
      }
    }
    assert.deepEqual(await fixture.query('SELECT * FROM publicaciones ORDER BY id'), beforeEditorial);
  });
  await t.test('visit postponement survives monthly reload/login; bound-client changes and editing deletion reject', async () => {
    const current = await readVisit(journeyVisit.id);
    const tasksBefore = await fixture.query('SELECT id,fecha_vencimiento FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [editingIds]);
    const moved = await api(`/producciones/${current.id}`, { token: admin, method: 'PATCH',
      body: { expected_revision: current.revision, fecha: '2026-11-10' } });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.visita.fecha, '2026-11-10');
    assert.deepEqual(await fixture.query('SELECT id,fecha_vencimiento FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [editingIds]), tasksBefore);
    const fresh = await login('qa_registry_98001');
    for (const [month, present] of [['2026-10', false], ['2026-11', true]]) {
      const listed = await api(`/producciones?mes=${month}`, { token: fresh });
      assert.equal(listed.status, 200, JSON.stringify(listed.body));
      assert.equal(listed.body.visitas.some(visit => visit.id === current.id), present);
    }
    const before = await snapshot();
    const changed = await api(`/producciones/${current.id}`, { token: admin, method: 'PATCH', body: {
      expected_revision: moved.body.visita.revision, cliente_id: otherClient.id,
    } });
    assert.equal(changed.status, 409, JSON.stringify(changed.body));
    const deleted = await api(`/tareas/${editingIds[0]}?workspace=render_os`, { token: admin, method: 'DELETE' });
    assert.equal(deleted.status, 409, JSON.stringify(deleted.body));
    const editingClient = await patchTask(editingIds[0], admin, { cliente_id: otherClient.id });
    assert.equal(editingClient.status, 409, JSON.stringify(editingClient.body));
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('current editing owner/date stay distinct from original handoff snapshot on registry reload and retry', async () => {
    const taskId = editingIds[0];
    const current = await readVisit(journeyVisit.id);
    const handoffSnapshot = current.videos.find(video => video.id === videoIds[0]);
    assert.equal(handoffSnapshot.editor_handoff_id, 91002);
    assert.equal(handoffSnapshot.fecha_entrega_handoff, '2026-10-26');
    const changed = await patchTask(taskId, admin, { asignado_a_id: 98002, colaborador_ids: [], fecha_vencimiento: '2026-12-05' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const visible = (await readVisit(journeyVisit.id, team)).videos.find(video => video.id === videoIds[0]);
    assert.equal(visible.editor_actual_id, 98002);
    assert.equal(visible.fecha_entrega_actual, '2026-12-05');
    assert.equal(visible.editor_handoff_id, 91002);
    assert.equal(visible.fecha_entrega_handoff, '2026-10-26');
    const before = await snapshot();
    const retried = await handoff(current.id, videoIds[0], current.revision, 91002, '2026-10-26');
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.created, false);
    assert.equal(retried.body.task.id, taskId);
    assert.equal(retried.body.task.asignado_a_id, 98002);
    assert.deepEqual(await snapshot(), before, 'Retry uses original handoff identity but must not overwrite current task ownership/date');
  });
  await t.test('source-linked registry updates source date/client atomically and forbids parallel legacy aggregate recording', async () => {
    const current = await readVisit(sourceLink.visitId);
    const source = await taskDetail(sourceLink.taskId);
    const moved = await api(`/producciones/${current.id}`, { token: admin, method: 'PATCH', body: {
      expected_revision: current.revision, fecha: '2026-12-08', cliente_id: sourceLink.otherClientId,
    } });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.visita.revision, current.revision + 1);
    const updated = await taskDetail(sourceLink.taskId);
    assert.equal(updated.fecha_vencimiento, '2026-12-08');
    assert.equal(updated.cliente_id, sourceLink.otherClientId);
    assert.equal(updated.revision, source.revision + 1);
    const beforeDuplicate = await snapshot();
    const duplicate = await api('/producciones', { token: admin, method: 'POST', body: {
      tarea_origen_id: sourceLink.taskId, cliente_id: updated.cliente_id, fecha: updated.fecha_vencimiento, titulo: 'QA duplicate explicit source',
    } });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
    assert.deepEqual(await snapshot(), beforeDuplicate);
    let linked = await addVideo(current.id, { titulo: 'QA source individual video', estado: 'grabado', guion: 'QA source script',
      material_url: 'https://example.invalid/qa-source-material' });
    const video = linked.videos[0];
    const sent = await handoff(linked.id, video.id, linked.revision, 91003, '2026-12-12');
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const before = await snapshot();
    const latestTask = await taskDetail(sourceLink.taskId);
    const legacy = await api(`/tareas/${sourceLink.taskId}/produccion/registros`, { token: admin, method: 'POST',
      body: { expected_revision: latestTask.revision, cantidad: 1, fecha: '2026-12-08' } });
    assert.equal(legacy.status, 409, JSON.stringify(legacy.body));
    assert.deepEqual(await fixture.query("SELECT id FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1", [String(sourceLink.taskId)]), []);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('pending photos bank filters real states/client and orders by visit date, creation and UUID without writes', async () => {
    const early = await createVisit('QA pending photos early', client.id, { fecha: '2026-10-18' });
    const later = await createVisit('QA pending photos later', client.id, { fecha: '2026-10-19' });
    const foreign = await createVisit('QA pending photos foreign', otherClient.id);
    const ids = Array.from({ length: 6 }, (_, i) => `f1950000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    const seeds = [
      [ids[0], early.id, 'pendiente', '2026-10-20T10:00:00Z'],
      [ids[1], early.id, 'repetir', '2026-10-20T10:00:00Z'],
      [ids[2], early.id, 'pendiente', '2026-10-20T11:00:00Z'],
      [ids[3], later.id, 'repetir', '2026-10-19T09:00:00Z'],
      [ids[4], early.id, 'realizada', '2026-10-20T09:00:00Z'],
      [ids[5], foreign.id, 'pendiente', '2026-10-20T09:00:00Z'],
    ];
    for (const [id, visitaId, estado, createdAt] of seeds.reverse()) {
      await fixture.query(`INSERT INTO produccion_fotos
        (id,visita_id,tipo,estado,drive_url,observaciones,creado_por_id,actualizado_por_id,created_at)
        VALUES ($1,$2,'QA producto',$3,'https://example.invalid/qa-photos','QA photo notes',91003,91003,$4)`,
      [id, visitaId, estado, createdAt]);
    }
    const before = await snapshot();
    const result = await api(`/producciones/pendientes?cliente_id=${client.id}`, { token: team });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.ok(Array.isArray(result.body.videos)); assert.ok(Array.isArray(result.body.fotos));
    assert.deepEqual(result.body.fotos.filter(row => ids.includes(row.id)).map(row => row.id), ids.slice(0, 4));
    for (const row of result.body.fotos) {
      assert.equal(row.cliente_id, client.id); assert.ok(['pendiente', 'repetir'].includes(row.estado));
      assert.match(row.fecha, /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(Object.keys(row).sort(), ['id','visita_id','tipo','estado','drive_url','observaciones','fecha','cliente_id','cliente_nombre'].sort());
    }
    const other = await api(`/producciones/pendientes?cliente_id=${otherClient.id}`, { token: team });
    assert.equal(other.status, 200); assert.ok(other.body.fotos.some(row => row.id === ids[5]));
    assert.ok(other.body.fotos.every(row => row.cliente_id === otherClient.id));
    const all = await api('/producciones/pendientes', { token: team });
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.fotos.filter(row => ids.includes(row.id)).map(row => row.id), [...ids.slice(0, 4), ids[5]]);
    const [emptyClient] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA empty photo bank') RETURNING id");
    const empty = await api(`/producciones/pendientes?cliente_id=${emptyClient.id}`, { token: team });
    assert.equal(empty.status, 200); assert.deepEqual(empty.body, { videos: [], fotos: [] });
    assert.deepEqual(await snapshot(), before, 'Reading the bank must not transfer, copy or modify production rows');
  });
  await t.test('explicit pending reuse preserves source script/history, lineage and latest-only intake', async () => {
    let a = await createVisit('QA pending source A');
    a = await addVideo(a.id, { titulo: 'QA unresolved lineage', guion: 'QA source script preserved', estado: 'pendiente' });
    const original = a.videos[0];
    const sourceRows = await fixture.query('SELECT * FROM produccion_videos WHERE id=$1', [original.id]);
    const unrelated = await createVisit('QA other-client target', otherClient.id);
    const b = await createVisit('QA pending target B');
    const pending = await api(`/producciones/pendientes?cliente_id=${client.id}`, { token: team });
    assert.equal(pending.status, 200, JSON.stringify(pending.body));
    assert.ok(pending.body.videos.some(video => video.id === original.id));
    const beforeWrong = await snapshot();
    const wrong = await api(`/producciones/${unrelated.id}/videos`, { token: team, method: 'POST',
      body: { expected_revision: unrelated.revision, video_origen_id: original.id } });
    assert.equal(wrong.status, 404, JSON.stringify(wrong.body));
    assert.deepEqual(await snapshot(), beforeWrong);
    const reused = await addVideo(b.id, { video_origen_id: original.id }, team);
    assert.equal(reused.videos[0].video_origen_id, original.id);
    assert.equal(reused.videos[0].guion, original.guion);
    assert.deepEqual(await fixture.query('SELECT * FROM produccion_videos WHERE id=$1', [original.id]), sourceRows);
    const beforeDuplicate = await snapshot();
    const duplicate = await api(`/producciones/${b.id}/videos`, { token: team, method: 'POST',
      body: { expected_revision: reused.revision, video_origen_id: original.id } });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
    assert.deepEqual(await snapshot(), beforeDuplicate);
    const latest = await api(`/producciones/pendientes?cliente_id=${client.id}`, { token: team });
    assert.equal(latest.status, 200, JSON.stringify(latest.body));
    assert.ok(!latest.body.videos.some(video => video.id === original.id));
    assert.ok(latest.body.videos.some(video => video.id === reused.videos[0].id));
    for (const visitId of [a.id, b.id]) {
      const linked = await readVisit(visitId);
      const before = await snapshot();
      const changed = await api(`/producciones/${visitId}`, { token: admin, method: 'PATCH', body: {
        expected_revision: linked.revision, cliente_id: otherClient.id,
      } });
      assert.equal(changed.status, 409, JSON.stringify(changed.body));
      assert.deepEqual(await snapshot(), before, 'Inbound and outbound reuse lineage both prohibit cross-client relabeling');
    }
  });
  await t.test('binding INSERT failure rolls back video handoff, visit revision and new task; retry is safe', async () => {
    let visit = await createVisit('QA binding rollback');
    visit = await addVideo(visit.id, { titulo: 'QA binding failure video', estado: 'grabado' });
    const videoId = visit.videos[0].id;
    const before = await snapshot();
    await fixture.query(`CREATE FUNCTION qa_registry_binding_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF EXISTS(SELECT 1 FROM tareas WHERE id=NEW.tarea_id AND propiedades_extra->>'origen_produccion_video_id'=TG_ARGV[0])
      THEN RAISE EXCEPTION 'QA registry binding failure'; END IF; RETURN NEW; END $$`);
    try {
      await fixture.query(`CREATE TRIGGER qa_registry_binding_failure BEFORE INSERT ON tarea_asignaciones
        FOR EACH ROW EXECUTE FUNCTION qa_registry_binding_failure('${videoId}')`);
      try {
        const failed = await handoff(visit.id, videoId, visit.revision, 98002, '2026-10-29');
        assert.equal(failed.status, 500, JSON.stringify(failed.body));
        assert.deepEqual(await snapshot(), before);
      } finally { await fixture.query('DROP TRIGGER qa_registry_binding_failure ON tarea_asignaciones'); }
    } finally { await fixture.query('DROP FUNCTION qa_registry_binding_failure()'); }
    const retried = await handoff(visit.id, videoId, visit.revision, 98002, '2026-10-29');
    assert.equal(retried.status, 201, JSON.stringify(retried.body));
    assert.equal(retried.body.task.asignado_a_id, 98002);
  });
  await t.test('legacy counted visit and aggregate tasks remain untouched after the new journey', async () => {
    assert.deepEqual(await fixture.query('SELECT * FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [historicalTasks.ids]), historicalTasks.rows);
  });
  await t.test('signed Wilson cannot change linked source date, client or classification; rejected confirmations stay unused', async () => {
    for (const changes of [{ fecha_vencimiento: '2099-01-09' }, { cliente_id: sourceLink.clientId }, { sector: 'edicion' }]) {
      const [observed] = await fixture.query('SELECT revision FROM tareas WHERE id=$1', [sourceLink.taskId]);
      const payload = { ...changes, idempotency_key: crypto.randomUUID(), expected_revision: observed.revision };
      const issued = await signed('/confirmaciones', { operacion: 'editar', tarea_id: sourceLink.taskId, payload });
      assert.equal(issued.status, 201, JSON.stringify(issued.body));
      const token = issued.body.confirmacion_token;
      const before = await snapshot();
      const beforeToken = await fixture.query('SELECT * FROM integracion_confirmaciones WHERE token=$1', [token]);
      const result = await signed(`/tareas/${sourceLink.taskId}`, { ...payload, confirmacion_token: token }, 'PATCH');
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await fixture.query('SELECT * FROM integracion_confirmaciones WHERE token=$1', [token]), beforeToken);
      assert.equal(beforeToken[0].used_at, null);
    }
  });
  await t.test('web Wilson chat cannot append aggregate recording once normalized media exists', async () => {
    const prepared = await api('/wilson/produccion/preparar', { token: admin, method: 'POST',
      body: { tarea_id: sourceLink.taskId, cantidad: 1, fecha: '2026-12-08' } });
    assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
    const token = prepared.body.confirmation.token;
    const before = await snapshot();
    const pending = await fixture.query('SELECT * FROM wilson_acciones_pendientes WHERE token=$1', [token]);
    assert.equal(pending[0].confirmed_at, null);
    const confirmed = await api(`/wilson/confirmaciones/${token}`, { token: admin, method: 'POST', body: {} });
    assert.equal(confirmed.status, 409, JSON.stringify(confirmed.body));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await fixture.query('SELECT * FROM wilson_acciones_pendientes WHERE token=$1', [token]), pending);
    assert.deepEqual(await fixture.query("SELECT id FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1", [String(sourceLink.taskId)]), []);
  });
  const supervisorSnapshot = async () => ({ ...await snapshot(),
    replies: await fixture.query('SELECT * FROM mia_supervisor_replies ORDER BY id'),
    conversations: await fixture.query('SELECT * FROM mia_supervisor_conversations ORDER BY usuario_id,tarea_id'),
    inbound: await fixture.query('SELECT * FROM mia_supervisor_inbound ORDER BY actor_hash'),
    audit: await fixture.query('SELECT * FROM integracion_auditoria ORDER BY id'),
    comments: await fixture.query('SELECT * FROM tarea_comentarios ORDER BY id'),
    proposals: await fixture.query('SELECT * FROM mia_supervisor_proposals ORDER BY id'),
  });
  await t.test('enabled supervisor date reply rejects linked source change and rolls back all conversation/reply/audit writes', async () => {
    const before = await supervisorSnapshot();
    const response = await signed(`/supervisor/tareas/${sourceLink.taskId}/respuesta`, {
      message_id: crypto.randomUUID(), estado: 'en_progreso', motivo: 'falta material completo',
      nueva_fecha: '2099-01-09', fecha_texto: '2099-01-09',
      texto: 'En progreso: falta material completo. Estimo entregar el 2099-01-09.',
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(response.body.error, /Producciones/, 'Must reach registry date guard, not disabled/invalid-report logic');
    assert.deepEqual(await supervisorSnapshot(), before);
  });
  await t.test('enabled supervisor accepted-date proposal cannot move linked source outside registry', async () => {
    const task = await taskDetail(sourceLink.taskId);
    const proposalId = crypto.randomUUID();
    await fixture.query(`INSERT INTO mia_supervisor_proposals(id,tarea_id,fecha,razon,snapshot_hash)
      VALUES ($1,$2,'2099-01-09','QA valid current proposal',$3)`, [proposalId, task.id, proposalSnapshot(task)]);
    const before = await supervisorSnapshot();
    const response = await signed(`/supervisor/tareas/${task.id}/fecha`, {
      proposal_id: proposalId, fecha: '2099-01-09', message_id: crypto.randomUUID(),
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(response.body.error, /Producciones/, 'Must reach registry guard with a valid current proposal');
    assert.deepEqual(await supervisorSnapshot(), before);
  });
  await t.test('concurrent source-client change versus pending reuse never commits cross-client lineage', async () => {
    // Three bounded fresh pairs; real concurrent HTTP, no sleeps, raw DB locks,
    // fixture transaction affinity assumptions or retries hiding failed states.
    for (let attempt = 0; attempt < 3; attempt++) {
      let source = await createVisit(`QA race source ${attempt}`);
      source = await addVideo(source.id, { titulo: `QA race pending ${attempt}`, guion: `QA race script ${attempt}`, estado: 'pendiente' });
      const target = await createVisit(`QA race target ${attempt}`);
      const videoId = source.videos[0].id;
      const [changed, reused] = await Promise.all([
        api(`/producciones/${source.id}`, { token: admin, method: 'PATCH', body: {
          expected_revision: source.revision, cliente_id: otherClient.id,
        } }),
        api(`/producciones/${target.id}/videos`, { token: team, method: 'POST', body: {
          expected_revision: target.revision, video_origen_id: videoId,
        } }),
      ]);
      assert.ok([200, 409].includes(changed.status), JSON.stringify(changed));
      assert.ok([201, 404, 409].includes(reused.status), JSON.stringify(reused));
      const lineage = await fixture.query(`SELECT sv.cliente_id AS source_client,tv.cliente_id AS target_client
        FROM produccion_videos child JOIN produccion_videos parent ON parent.id=child.video_origen_id
        JOIN produccion_visitas sv ON sv.id=parent.visita_id JOIN produccion_visitas tv ON tv.id=child.visita_id
        WHERE parent.id=$1`, [videoId]);
      for (const edge of lineage) assert.equal(edge.source_client, edge.target_client, 'Race committed cross-client lineage');
      if (reused.status === 201) {
        assert.equal(lineage.length, 1);
        assert.equal(changed.status, 409, 'Successful reuse must protect original client identity');
      }
      if (changed.status === 200) assert.equal(lineage.length, 0, 'Successful client move cannot retain a child in the old client');
      t.diagnostic(`Bounded race ${attempt + 1}: client=${changed.status}, reuse=${reused.status}, lineage=${lineage.length}`);
    }
  });
});
