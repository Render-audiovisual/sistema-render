import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const secretMarker = 'QA_HOME_PRIVATE_FINANCE_55607';
const ownerId = 104001;
const homonymId = 104002;
const collaboratorId = 104003;

test('principal personal home: stable personal IDs, bounded operational DTO and live updates', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55607, clusterOnly: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own personal-home fixture stopped and removed: ${fixture.root}`);
  });
  const [clock] = await fixture.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today,
    to_char(clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati','YYYY-MM-DD') AS far_day,clock_timestamp() AS instant`);
  const date = offset => new Date(Date.parse(`${clock.today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  const zone = clock.far_day !== clock.today ? 'Pacific/Kiritimati' : 'Etc/GMT+12';
  await fixture.query(`ALTER ROLE render2_fixture SET timezone='${zone}'`);
  await fixture.query("ALTER ROLE render2_fixture SET log_statement='all'");
  for (const [id, role] of [[ownerId, 'edicion'], [homonymId, 'edicion'], [collaboratorId, 'community'], [104004, 'diseno']])
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,true,1 FROM usuarios WHERE id=91004`,
    [id, `qa_home_${id}`, id === ownerId || id === homonymId ? 'QA Home Same Name' : `QA Home ${id}`, role]);
  const clients = [];
  for (let n = 0; n < 10; n++) clients.push((await fixture.query(`INSERT INTO clientes(nombre,activo)
    VALUES ($1,true) RETURNING id,nombre`, [`QA Home client ${String(n).padStart(2, '0')}`]))[0]);
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Home inactive',false) RETURNING id,nombre");
  await fixture.query("INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por) VALUES ($1,'2026-01-01',834921.77,'QA fixture')", [clients[0].id]);
  let serial = 0;
  const seedTask = async ({ owner = ownerId, collaborators = [], day = 0, state = 'pendiente', priority = 'media',
    clientId = clients[0].id, properties = {}, title, updated, type = 'edicion', subtype = 'video' } = {}) => {
    const n = ++serial;
    const props = { workspace: 'render_os', colaboradores: ['QA Home Same Name'],
      future_bag: { importe: 834921.77, nested: [{ marker: secretMarker }] }, resumen: { marker: secretMarker }, ...properties };
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,prioridad,cliente_id,tipo_tarea,subtipo,
      fecha_vencimiento,aclaraciones,propiedades_extra,updated_at)
      VALUES ($1,'QA Home Same Name',$2,$3,$4,$9,$10,$5,$6,$7::jsonb,$8) RETURNING *`,
    [title || `QA Home task ${n}`, state, priority, clientId, day === null ? null : date(day),
      `Not a home description ${secretMarker}`, JSON.stringify(props),
      updated || new Date(Date.parse(clock.instant) - (1000 - n) * 1000).toISOString(), type, subtype]);
    if (owner !== null) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [task.id, owner]);
    for (const id of [...new Set(collaborators)].filter(id => id !== owner))
      await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'colaborador')", [task.id, id]);
    return task;
  };
  const important = {};
  important.overdue = await seedTask({ day: -2, priority: 'alta', collaborators: [collaboratorId, collaboratorId] });
  await seedTask({ day: -2, priority: 'media' }); await seedTask({ day: -1, priority: 'baja' });
  important.review = await seedTask({ day: 0, state: 'en_revision', priority: 'alta' });
  important.legacyApproved = await seedTask({ day: 0, state: 'en_revision', properties: { revision_aprobada: true } });
  await seedTask({ day: 0, state: 'aprobada', priority: 'baja' });
  await seedTask({ day: 1 }); await seedTask({ day: 7 }); await seedTask({ day: 8 });
  important.legacyOpen = await seedTask({ day: -7, state: 'programada' });
  await seedTask({ day: null, clientId: null });
  await seedTask({ day: -6, clientId: null });
  important.foreign = await seedTask({ owner: homonymId, state: 'en_revision' });
  important.collaborative = await seedTask({ owner: homonymId, collaborators: [ownerId, collaboratorId, collaboratorId], day: 2 });
  await seedTask({ owner: null });
  const excluded = [];
  for (const properties of [{ workspace: 'private' }, { workspace: null }, { archivada_render_os: true }, { papelera_render_os: 'true' }])
    excluded.push(await seedTask({ day: -3, properties }));
  excluded.push(await seedTask({ clientId: inactive.id, day: -4 }));
  important.admin = await seedTask({ owner: 91001, day: -1 });
  for (let n = 0; n < 10; n++) await seedTask({ owner: homonymId, state: 'en_revision', day: n % 3 });
  for (const client of clients) await seedTask({ clientId: client.id, day: 3 });

  const visitIds = [];
  const seedVisit = async ({ source = null, participants = [], editing = null, day = 1, clientId = clients[0].id } = {}) => {
    const id = crypto.randomUUID();
    await fixture.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,observaciones,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,$3,$4,$5,$6,91001,91001)`, [id, source, clientId, date(day), `QA Home visit ${visitIds.length}`,
      `Private visit notes ${secretMarker}`]);
    for (const userId of [...new Set(participants)]) await fixture.query('INSERT INTO produccion_visita_participantes(visita_id,usuario_id) VALUES ($1,$2)', [id, userId]);
    if (editing) await fixture.query(`INSERT INTO produccion_videos(id,visita_id,titulo,guion,estado,tarea_edicion_id,editor_id,fecha_entrega,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,'QA Home video',$3,'grabado',$4,$5,$6,91001,91001)`,
    [crypto.randomUUID(), id, `Private script ${secretMarker}`, editing, ownerId, date(5)]);
    visitIds.push(id); return id;
  };
  for (let n = 0; n < 10; n++) await seedVisit({ participants: [ownerId], day: n % 8 });
  const source = await seedTask({ day: 2, type: 'produccion', subtype: 'visita', title: 'QA Home visita source' });
  await seedVisit({ source: source.id, participants: [ownerId], day: 2 });
  const editTask = await seedTask({ day: 4 }); await seedVisit({ editing: editTask.id, day: 4 });
  await seedVisit({ participants: [91001], day: 1 });
  await seedVisit({ participants: [homonymId], day: 1 });
  await seedVisit({ participants: [ownerId], day: -1 }); await seedVisit({ participants: [ownerId], day: 8 });
  await seedVisit({ participants: [ownerId], clientId: inactive.id });
  const hiddenVisits = [];
  for (const properties of [{ workspace: 'private' }, { archivada_render_os: true }, { papelera_render_os: true }]) {
    const hiddenSource = await seedTask({ owner: homonymId, properties, type: 'produccion', subtype: 'visita' });
    hiddenVisits.push(await seedVisit({ source: hiddenSource.id, participants: [ownerId] }));
    const ownedEdit = await seedTask();
    hiddenVisits.push(await seedVisit({ source: (await seedTask({ owner: homonymId, properties, type: 'produccion', subtype: 'visita' })).id, editing: ownedEdit.id }));
  }
  important.finalized = await seedTask({ state: 'finalizada' });
  important.publishedAlias = await seedTask({ state: 'publicada' });
  const app = await fixture.launchActual({ entry: 'server' });
  const { base } = await app.ready;
  const api = (route, options = {}) => request(base, `/api${route}`, options);
  const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
  const login = async usuario => ok(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const owner = await login(`qa_home_${ownerId}`); const homonym = await login(`qa_home_${homonymId}`);
  const collaborator = await login(`qa_home_${collaboratorId}`); const admin = await login('qa_franco');
  const home = async token => ok(await api('/inicio', { token }));
  const sortedKeys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const taskKeys = ['id', 'titulo', 'estado', 'prioridad', 'fecha_vencimiento', 'cliente', 'revision', 'href'];
  const assertTask = task => {
    sortedKeys(task, taskKeys); assert.ok(Number.isSafeInteger(task.id) && Number.isSafeInteger(task.revision));
    assert.equal(task.href, `/workspace/tareas?task=${task.id}`);
    if (task.cliente !== null) sortedKeys(task.cliente, ['id', 'nombre']);
    if (task.fecha_vencimiento !== null) assert.match(task.fecha_vencimiento, /^\d{4}-\d{2}-\d{2}$/);
  };
  const checkDTO = data => {
    sortedKeys(data, ['version', 'generated_at', 'today', 'user', 'summary', 'tasks', 'review', 'clients', 'visits', 'activity', 'projects', 'capabilities', 'list_totals', 'monthly_progress']);
    sortedKeys(data.monthly_progress, ['period', 'total', 'completed', 'by_sector']);
    assert.equal(data.monthly_progress.period, data.today.slice(0, 7));
    assert.ok(data.monthly_progress.completed <= data.monthly_progress.total);
    assert.equal(data.version, 1); sortedKeys(data.user, ['id', 'nombre']);
    sortedKeys(data.summary, ['open', 'overdue', 'today', 'upcoming', 'undated', 'awaiting_review']);
    sortedKeys(data.review, ['scope', 'total', 'items']); sortedKeys(data.list_totals, ['clients', 'visits', 'activity', 'projects']);
    assert.deepEqual(data.capabilities, { projects: true });
    assert.deepEqual(data.projects, []);
    assert.ok(Number.isFinite(Date.parse(data.generated_at)));
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data.generated_at));
    assert.equal(data.today, day); assert.equal(data.today, clock.today);
    data.tasks.forEach(assertTask); data.review.items.forEach(assertTask);
    for (const item of data.clients) sortedKeys(item, ['id', 'nombre', 'open']);
    for (const item of data.visits) {
      sortedKeys(item, ['id', 'titulo', 'fecha', 'cliente', 'href']); sortedKeys(item.cliente, ['id', 'nombre']);
      assert.equal(item.href, `/producciones?visita=${item.id}&mes=${item.fecha.slice(0, 7)}`);
    }
    for (const item of data.activity) {
      sortedKeys(item, ['task_id', 'titulo', 'estado', 'updated_at', 'href']);
      assert.equal(item.href, `/workspace/tareas?task=${item.task_id}`); assert.ok(Number.isFinite(Date.parse(item.updated_at)));
    }
    assert.ok(!JSON.stringify(data).includes(secretMarker)); assert.ok(!JSON.stringify(data).includes('834921.77'));
    for (const [items, bound] of [[data.tasks, 12], [data.review.items, 8], [data.clients, 8], [data.visits, 8], [data.activity, 8]])
      assert.ok(items.length <= bound);
  };
  const model = async (userId, isAdmin = false) => {
    const rows = await fixture.query(`SELECT t.*,to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS day,c.activo AS client_active,
      c.nombre AS client_name FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id`);
    const assignments = await fixture.query('SELECT tarea_id,usuario_id FROM tarea_asignaciones');
    const visible = rows.filter(row => row.propiedades_extra?.workspace === 'render_os'
      && ![true, 'true'].includes(row.propiedades_extra.archivada_render_os)
      && ![true, 'true'].includes(row.propiedades_extra.papelera_render_os) && row.client_active !== false)
      .map(row => ({ ...row, effective: row.estado === 'en_revision' && row.propiedades_extra.revision_aprobada === true ? 'aprobada' : row.estado }));
    const assigned = new Set(assignments.filter(row => row.usuario_id === userId).map(row => row.tarea_id));
    const mine = visible.filter(row => assigned.has(row.id)); const open = mine.filter(row => !['finalizada', 'publicada'].includes(row.effective));
    const summary = { open: open.length, overdue: open.filter(row => row.day && row.day < clock.today).length,
      today: open.filter(row => row.day === clock.today).length, upcoming: open.filter(row => row.day > clock.today && row.day <= date(7)).length,
      undated: open.filter(row => row.day === null).length, awaiting_review: open.filter(row => row.effective === 'en_revision').length };
    const priority = { alta: 0, media: 1, baja: 2 };
    open.sort((a, b) => (a.day ?? '9999-12-31').localeCompare(b.day ?? '9999-12-31') || priority[a.prioridad] - priority[b.prioridad] || a.id - b.id);
    const reviews = (isAdmin ? visible : mine).filter(row => row.effective === 'en_revision');
    const clientCounts = new Map(); for (const row of open) if (row.cliente_id !== null) clientCounts.set(row.cliente_id, (clientCounts.get(row.cliente_id) || 0) + 1);
    const visits = await fixture.query("SELECT *,to_char(fecha,'YYYY-MM-DD') AS day FROM produccion_visitas");
    const participants = await fixture.query('SELECT * FROM produccion_visita_participantes'); const videos = await fixture.query('SELECT * FROM produccion_videos');
    const activeClients = new Set((await fixture.query('SELECT id FROM clientes WHERE activo IS DISTINCT FROM FALSE')).map(row => row.id));
    const visibleIds = new Set(visible.map(row => row.id)); const mineIds = new Set(mine.map(row => row.id));
    const myVisits = visits.filter(row => activeClients.has(row.cliente_id) && row.day >= clock.today && row.day <= date(7)
      && (row.tarea_origen_id === null || visibleIds.has(row.tarea_origen_id))
      && (participants.some(p => p.visita_id === row.id && p.usuario_id === userId) || mineIds.has(row.tarea_origen_id)
        || videos.some(v => v.visita_id === row.id && mineIds.has(v.tarea_entrega_id ?? v.tarea_edicion_id))));
    return { summary, open, mine, reviews, clientCounts, visits: myVisits };
  };
  const checkModel = async (token, userId, isAdmin = false) => {
    const data = await home(token); checkDTO(data); const expected = await model(userId, isAdmin);
    assert.equal(data.user.id, userId); assert.deepEqual(data.summary, expected.summary);
    assert.deepEqual(data.tasks.map(row => row.id), expected.open.slice(0, 12).map(row => row.id));
    assert.equal(data.review.scope, isAdmin ? 'team' : 'personal'); assert.equal(data.review.total, expected.reviews.length);
    assert.equal(data.review.items.length, Math.min(8, expected.reviews.length));
    for (const row of data.review.items) assert.ok(expected.reviews.some(task => task.id === row.id));
    assert.equal(new Set(data.tasks.map(row => row.id)).size, data.tasks.length);
    assert.equal(data.clients.length, Math.min(8, expected.clientCounts.size));
    for (const row of data.clients) assert.equal(row.open, expected.clientCounts.get(row.id));
    assert.deepEqual(data.list_totals, { clients: expected.clientCounts.size, visits: expected.visits.length, activity: expected.mine.length, projects: 0 });
    assert.equal(data.visits.length, Math.min(8, expected.visits.length));
    assert.equal(new Set(data.visits.map(row => row.id)).size, data.visits.length);
    for (const row of data.visits) assert.ok(expected.visits.some(visit => visit.id === row.id));
    const activities = [...expected.mine].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
    assert.deepEqual(data.activity.map(row => row.task_id), activities.slice(0, 8).map(row => row.id));
    for (const row of [...data.tasks, ...data.review.items]) assert.equal(row.estado, [...expected.open, ...expected.reviews].find(task => task.id === row.id).effective);
    return data;
  };
  const tables = ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', 'produccion_visitas', 'produccion_visita_participantes',
    'produccion_videos', 'produccion_fotos', 'publicaciones', 'historias', 'cliente_abonos', 'cliente_objetivo_piezas', 'integracion_auditoria'];
  const snapshot = async () => {
    const result = {}; for (const table of tables) result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };

  await t.test('homonyms and collaborators use stable IDs, exact totals and deterministic bounded lists', async () => {
    const before = await snapshot();
    const logOffset = (await readFile(`${fixture.root}/postgres.log`, 'utf8')).length;
    const mine = await checkModel(owner, ownerId); const other = await checkModel(homonym, homonymId);
    await checkModel(collaborator, collaboratorId);
    assert.ok(mine.summary.open > 12 && mine.list_totals.clients > 8 && mine.list_totals.visits > 8 && mine.list_totals.activity > 8);
    assert.equal(mine.tasks.length, 12); assert.equal(mine.visits.length, 8); assert.equal(mine.activity.length, 8);
    assert.ok(mine.tasks.some(row => row.cliente === null));
    assert.equal(mine.tasks.find(row => row.id === important.legacyOpen.id)?.estado, 'programada');
    assert.ok(mine.activity.some(row => row.task_id === important.finalized.id));
    assert.ok(mine.activity.some(row => row.task_id === important.publishedAlias.id));
    assert.ok(!mine.tasks.some(row => row.id === important.foreign.id));
    assert.ok(!other.tasks.some(row => row.id === important.overdue.id));
    const again = await home(owner);
    for (const key of ['summary', 'tasks', 'review', 'clients', 'visits', 'activity', 'list_totals']) assert.deepEqual(again[key], mine[key]);
    assert.deepEqual(await snapshot(), before);
    const statements = (await readFile(`${fixture.root}/postgres.log`, 'utf8')).slice(logOffset);
    assert.ok(/BEGIN(?: TRANSACTION)? ISOLATION LEVEL REPEATABLE READ READ ONLY/i.test(statements),
      'Actual endpoint must begin the required read-only repeatable-read transaction');
    assert.ok(!/(?:statement:|execute [^:]*:)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(statements),
      'Home reads must not issue operational mutations or schema writes');
  });
  await t.test('admin personal counts stay personal while a distinct bounded team review queue remains visible', async () => {
    const data = await checkModel(admin, 91001, true);
    assert.equal(data.summary.open, 1); assert.deepEqual(data.tasks.map(row => row.id), [important.admin.id]);
    assert.ok(data.review.total > 8); assert.equal(data.review.items.length, 8);
    assert.equal(data.list_totals.visits, 1);
    assert.ok(!JSON.stringify(data).includes(secretMarker));
  });
  await t.test('Córdoba day ignores conflicting server DB timezone; legacy approval is projected without historical rewrite', async () => {
    const conflictingDay = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(clock.instant));
    assert.notEqual(conflictingDay, clock.today);
    const before = await snapshot(); const data = await checkModel(owner, ownerId);
    assert.equal(data.today, clock.today);
    assert.equal(data.tasks.find(row => row.id === important.legacyApproved.id)?.estado, 'aprobada');
    assert.ok(!data.review.items.some(row => row.id === important.legacyApproved.id));
    const raw = (await fixture.query('SELECT estado,propiedades_extra FROM tareas WHERE id=$1', [important.legacyApproved.id]))[0];
    assert.equal(raw.estado, 'en_revision'); assert.equal(raw.propiedades_extra.revision_aprobada, true);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('hidden/private/inactive work and participant or editing visits with invisible source stay excluded', async () => {
    const data = await checkModel(owner, ownerId);
    for (const task of excluded) assert.ok(!data.tasks.some(row => row.id === task.id));
    for (const id of hiddenVisits) assert.ok(!data.visits.some(row => row.id === id));
    const expected = await model(ownerId);
    for (const id of hiddenVisits) assert.ok(!expected.visits.some(row => row.id === id));
    assert.ok(expected.open.some(row => row.id === important.legacyOpen.id));
    assert.ok(expected.mine.some(row => row.id === important.finalized.id));
    assert.ok(!expected.open.some(row => [important.finalized.id, important.publishedAlias.id].includes(row.id)));
  });
  await t.test('actual POST/PATCH date, state and ID reassignment appear on reload and fresh login without publication', async () => {
    const editorialBefore = await fixture.query('SELECT to_jsonb(p) AS row FROM publicaciones p ORDER BY id');
    const created = await api('/tareas', { token: admin, method: 'POST', body: { titulo: 'QA Home HTTP created',
      workspace: 'render_os', cliente_id: clients[0].id, asignado_a_id: ownerId, colaborador_ids: [collaboratorId, collaboratorId],
      tipo_tarea: 'edicion', subtipo: 'video', fecha_vencimiento: date(0), prioridad: 'alta' } });
    assert.equal(created.status, 201, JSON.stringify(created.body)); const id = created.body.id;
    let data = await checkModel(owner, ownerId); assert.ok(data.tasks.some(row => row.id === id));
    const patch = async body => {
      const detail = ok(await api(`/tareas/${id}?workspace=render_os`, { token: admin }));
      return api(`/tareas/${id}?workspace=render_os`, { token: admin, method: 'PATCH',
        body: { expected_revision: detail.revision, expected_updated_at: detail.updated_at, ...body } });
    };
    ok(await patch({ fecha_vencimiento: date(-9), estado: 'en_revision' }));
    data = await checkModel(owner, ownerId); assert.equal(data.tasks[0].id, id);
    assert.ok(data.review.items.some(row => row.id === id));
    ok(await patch({ asignado_a_id: homonymId, colaborador_ids: [] }));
    data = await checkModel(await login(`qa_home_${ownerId}`), ownerId); assert.ok(!data.tasks.some(row => row.id === id));
    const reassigned = await checkModel(await login(`qa_home_${homonymId}`), homonymId);
    assert.ok(reassigned.tasks.some(row => row.id === id));
    assert.deepEqual(await fixture.query('SELECT to_jsonb(p) AS row FROM publicaciones p ORDER BY id'), editorialBefore);
  });
  await t.test('identity/query selection is rejected and current role, inactive identity and revoked login fail closed', async () => {
    assert.equal((await api('/inicio')).status, 401);
    for (const query of [`usuario_id=${homonymId}`, `user_id=${homonymId}`, `id=${homonymId}`, 'limit=1000', 'desde=2026-01-01'])
      assert.equal((await api(`/inicio?${query}`, { token: owner })).status, 400);
    const restricted = await login('qa_home_104004');
    await fixture.query("UPDATE usuarios SET rol='qa_unknown' WHERE id=104004");
    try { assert.equal((await api('/inicio', { token: restricted })).status, 403); }
    finally { await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=104004"); }
    const inactiveToken = await login('qa_home_104004');
    ok(await api('/usuarios/104004/acceso', { token: admin, method: 'PATCH', body: { activo: false } }));
    assert.equal((await api('/inicio', { token: inactiveToken })).status, 401);
    ok(await api('/usuarios/104004/acceso', { token: admin, method: 'PATCH', body: { activo: true } }));
    const revoked = await login(`qa_home_${ownerId}`); ok(await api('/logout', { token: revoked, method: 'POST' }));
    assert.equal((await api('/inicio', { token: revoked })).status, 401);
    await checkModel(await login(`qa_home_${ownerId}`), ownerId);
  });
  await t.test('SQL failure returns a safe error, rolls back read transactions and releases clients for recovery', async () => {
    const token = await login(`qa_home_${ownerId}`);
    await fixture.query('ALTER TABLE tarea_asignaciones RENAME COLUMN usuario_id TO qa_home_missing_user');
    try {
      const responses = await Promise.all(Array.from({ length: 12 }, () => api('/inicio', { token })));
      for (const response of responses) {
        assert.equal(response.status, 500); assert.ok(!JSON.stringify(response.body).includes(secretMarker));
        assert.ok(!JSON.stringify(response.body).includes('qa_home_missing_user'));
      }
      assert.equal((await fixture.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND state LIKE 'idle in transaction%'`))[0].n, 0);
    } finally { await fixture.query('ALTER TABLE tarea_asignaciones RENAME COLUMN qa_home_missing_user TO usuario_id'); }
    await checkModel(token, ownerId);
  });
});
