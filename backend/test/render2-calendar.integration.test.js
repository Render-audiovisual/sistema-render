import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const marker = 'QA_CALENDAR_FINANCIAL_PRIVATE_55619';
const tables = { historia: 'historias', publicacion: 'publicaciones' };
test('principal calendar: stable identities, separate dates and read-only bounded operational sources', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55619 });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own calendar fixture stopped and removed: ${fixture.root}`);
  });
  const checked = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const api = (path, token = admin, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const login = async usuario => checked(await request(fixture.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const admin = await login('qa_franco'); const users = [];
  for (const [id, role] of [[110001, 'edicion'], [110002, 'edicion'], [110003, 'community'], [110004, 'diseno'],
    [110005, 'produccion'], [110006, 'programacion'], [110007, 'qa_unknown']]) {
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA Calendar Same Name',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa_calendar_${id}`, role]);
    users.push({ id, role, token: await login(`qa_calendar_${id}`) });
  }
  const owner = users[0], impostor = users[1], community = users[2], producer = users[4];
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA calendar active') RETURNING id,nombre");
  const [other] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA calendar other') RETURNING id,nombre");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA calendar inactive',false) RETURNING id");
  let serial = 0;
  const createTask = async (extra = {}) => checked(await api('/tareas', admin, 'POST', {
    titulo: `QA calendar task ${++serial}`, workspace: 'render_os', cliente_id: client.id,
    asignado_a_id: owner.id, colaborador_ids: [community.id], fecha_vencimiento: '2026-07-24', tipo_tarea: 'edicion', subtipo: 'video', ...extra,
  }), 201);
  const source = await createTask({ titulo: 'QA calendar production visit', tipo_tarea: 'produccion', subtipo: 'visita', fecha_vencimiento: '2026-07-20', produccion_videos_previstos: 1 });
  const [visit] = await fixture.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [source.id]); assert.ok(visit);
  const readVisit = async () => checked(await api(`/producciones/${visit.id}`)).visita;
  let currentVisit = await readVisit();
  currentVisit = checked(await api(`/producciones/${visit.id}`, admin, 'PATCH', {
    expected_revision: currentVisit.revision, participante_ids: [producer.id],
  })).visita;
  currentVisit = checked(await api(`/producciones/${visit.id}/videos`, owner.token, 'POST', {
    expected_revision: currentVisit.revision, titulo: 'QA distinct editing deadline', guion: 'QA private working script',
    estado: 'grabado', material_url: 'https://example.invalid/calendar-raw',
  }), 201).visita;
  const handed = checked(await api(`/producciones/${visit.id}/videos/${currentVisit.videos[0].id}/enviar-edicion`, admin, 'POST', {
    expected_revision: currentVisit.revision, editor_id: owner.id, fecha_entrega: '2026-07-22',
  }), 201);
  const editingId = handed.task.id;
  const pieces = [];
  const seedPiece = async (domain, { id, state = 'lista', actual = null, archived = false, clientId = client.id } = {}) => {
    const [piece] = await fixture.query(`INSERT INTO ${tables[domain]}
      (${id ? 'id,' : ''}cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada,"fecha_publicación_real",idea,metadata)
      VALUES (${id ? `${id},` : ''}$1,${domain === 'publicacion' ? "'video'," : ''}$2,'2026-07-15',$3,'QA scheduled editorial', $4::jsonb) RETURNING id`,
    [clientId, state, actual, JSON.stringify({ archivado_tablero: archived, money: { amount: 874561.29, marker },
      publicacion_evidencia: { classification: 'confirmada_manualmente', revision: 1, confirmation: {
        id: randomUUID(), actor_id: 91001, occurred_at: '2026-08-01T02:30:00.000Z', recorded_at: '2026-08-01T02:30:00.000Z', source: 'manual',
      } } })]);
    const task = await createTask({ [domain === 'historia' ? 'historia_id' : 'publicacion_id']: piece.id });
    const result = { domain, id: piece.id, taskId: task.id }; pieces.push(result); return result;
  };
  const story = await seedPiece('historia', { id: 155619 });
  const publication = await seedPiece('publicacion', { id: 155619 });
  const history = [];
  for (const domain of Object.keys(tables)) for (const [state, actual] of [['publicada', '2026-08-01T02:30:00Z'], ['publicada', null], ['lista', '2026-08-01T02:30:00Z']])
    history.push(await seedPiece(domain, { state, actual }));
  const confirm = async (piece, occurred_at) => {
    const status = checked(await api(`/editorial-publicacion/${piece.domain}/${piece.id}`));
    return checked(await api(`/editorial-publicacion/${piece.domain}/${piece.id}/confirmar`, admin, 'POST', {
      request_id: randomUUID(), expected_revision: status.piece.revision, occurred_at,
    }), 201);
  };
  const firstConfirmation = await confirm(story, '2026-08-01T02:59:59Z');
  const secondConfirmation = await confirm(publication, '2026-08-01T03:00:00Z');
  const hidden = [];
  for (const properties of [{ workspace: 'private' }, { workspace: 'render_os', archivada_render_os: true }, { workspace: 'render_os', papelera_render_os: true }]) {
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
      VALUES ('QA hidden task','QA Calendar Same Name',$1,'edicion','pendiente','2026-07-10',$2::jsonb) RETURNING id`,
    [client.id, JSON.stringify({ ...properties, private_finance: { marker, amount: 874561.29 } })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [task.id, owner.id]); hidden.push(task.id);
  }
  const completed = await createTask(); await fixture.query("UPDATE tareas SET estado='finalizada' WHERE id=$1", [completed.id]);
  const [nullClient] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
    VALUES ('QA null client shared','QA Calendar Same Name','edicion','pendiente','2026-07-10','{"workspace":"render_os"}') RETURNING id`);
  await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [nullClient.id, owner.id]);
  const [inactiveTask] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
    VALUES ('QA inactive task','QA Calendar Same Name',$1,'edicion','pendiente','2026-07-10','{"workspace":"render_os"}') RETURNING id`, [inactive.id]);
  const archivedPiece = await seedPiece('historia', { archived: true });
  const calendar = async (token = owner.token, options = {}) => {
    const query = new URLSearchParams({ desde: '2026-07-01', hasta: '2026-08-01', ...options });
    return checked(await api(`/calendario?${query}`, token));
  };
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const validate = dto => {
    keys(dto, ['range', 'scope', 'kind', 'timezone', 'clients', 'events', 'truncated']); keys(dto.range, ['desde', 'hasta']);
    assert.equal(dto.timezone, 'America/Argentina/Cordoba'); assert.ok(dto.events.length <= 2000); assert.equal(typeof dto.truncated, 'boolean');
    const seen = new Set();
    for (const client of dto.clients) { keys(client, ['id', 'nombre']); assert.ok(Number.isSafeInteger(client.id) && client.id > 0); assert.ok(client.nombre.length <= 250); }
    for (const event of dto.events) {
      keys(event, ['key', 'kind', 'source', 'source_id', 'date', 'title', 'cliente_id', 'cliente_nombre', 'estado', 'href', 'responsable_ids', 'evidence']);
      assert.ok(!seen.has(event.key)); seen.add(event.key);
      assert.ok(['tarea', 'visita', 'programacion', 'publicacion'].includes(event.kind));
      assert.ok(['tarea', 'visita', 'historia', 'publicacion'].includes(event.source));
      assert.equal(event.key, `${event.kind}:${event.source}:${event.source_id}`);
      if (event.source === 'visita') assert.match(event.source_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      else assert.ok(Number.isSafeInteger(event.source_id) && event.source_id > 0);
      assert.match(event.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(event.date >= dto.range.desde && event.date < dto.range.hasta);
      assert.ok(typeof event.title === 'string' && event.title.length <= 160);
      assert.ok(event.cliente_nombre === null || (typeof event.cliente_nombre === 'string' && event.cliente_nombre.length <= 250));
      assert.ok(event.estado === null || typeof event.estado === 'string');
      assert.ok(Array.isArray(event.responsable_ids) && event.responsable_ids.every(id => Number.isSafeInteger(id) && id > 0));
      assert.ok(event.href.startsWith('/') && !event.href.startsWith('//'));
      if (event.kind !== 'publicacion') assert.equal(event.evidence, null);
      else {
        keys(event.evidence, ['classification', 'revision', 'confirmation']);
        assert.equal(event.evidence.classification, 'confirmada_manualmente');
        assert.ok(Number.isSafeInteger(event.evidence.revision) && event.evidence.revision > 0);
        const proof = event.evidence.confirmation;
        keys(proof, ['id', 'actor_id', 'occurred_at', 'recorded_at', 'source']);
        assert.match(proof.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        assert.ok(Number.isSafeInteger(proof.actor_id) && proof.actor_id > 0); assert.equal(proof.source, 'manual');
        for (const field of ['occurred_at', 'recorded_at']) assert.equal(new Date(proof[field]).toISOString(), proof[field]);
      }
    }
    const sorted = [...dto.events].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
    assert.deepEqual(dto.events, sorted); assert.ok(!JSON.stringify(dto).includes(marker)); assert.ok(!JSON.stringify(dto).includes('874561.29'));
  };
  const matching = (dto, kind, source, id) => dto.events.filter(event => event.kind === kind && event.source === source && event.source_id === id);
  const one = (dto, kind, source, id) => { const rows = matching(dto, kind, source, id); assert.equal(rows.length, 1, `${kind}/${source}/${id}`); return rows[0]; };
  // Capture all public business-table rows, not merely module-selected columns.
  const snapshot = async () => {
    const names = await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_migrations' ORDER BY tablename");
    assert.ok(names.every(row => /^[a-z_][a-z0-9_]*$/.test(row.tablename)));
    return fixture.query(`SELECT * FROM (${names.map(({ tablename }) => `SELECT '${tablename}' AS name,COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM "${tablename}" r`).join(' UNION ALL ')}) business_snapshot ORDER BY name`);
  };
  await t.test('all supported roles share closed team data; mine uses normalized IDs, never homonymous names', async () => {
    const before = await snapshot(); let shared;
    for (const token of [admin, ...users.filter(user => user.role !== 'qa_unknown').map(user => user.token)]) {
      const dto = await calendar(token, { scope: 'team', cliente_id: client.id }); validate(dto); assert.equal(dto.scope, 'team'); assert.equal(dto.truncated, false);
      if (shared) assert.deepEqual(dto.events, shared); else shared = dto.events;
    }
    const mine = await calendar(owner.token, { cliente_id: client.id }); validate(mine); assert.equal(mine.scope, 'mine');
    const sameName = await calendar(impostor.token, { cliente_id: client.id }); validate(sameName); assert.deepEqual(sameName.events, []);
    const participant = await calendar(producer.token, { cliente_id: client.id }); one(participant, 'visita', 'visita', visit.id);
    assert.equal(matching(participant, 'tarea', 'tarea', editingId).length, 0);
    const originMember = await calendar(community.token, { cliente_id: client.id }); one(originMember, 'visita', 'visita', visit.id);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('normalized visit suppresses source task deadline only; editing deadline and completed work remain distinct', async () => {
    const dto = await calendar(); validate(dto);
    assert.equal(matching(dto, 'tarea', 'tarea', source.id).length, 0);
    assert.equal(one(dto, 'visita', 'visita', visit.id).date, '2026-07-20');
    assert.equal(one(dto, 'tarea', 'tarea', editingId).date, '2026-07-22');
    assert.equal(one(dto, 'tarea', 'tarea', completed.id).estado, 'finalizada');
    assert.equal(one(dto, 'tarea', 'tarea', nullClient.id).cliente_id, null);
    const filtered = await calendar(owner.token, { cliente_id: client.id }); assert.equal(matching(filtered, 'tarea', 'tarea', nullClient.id).length, 0);
    assert.equal(one(dto, 'tarea', 'tarea', editingId).href, `/workspace/tareas?task=${editingId}`);
  });
  await t.test('scheduled source identities differ from real Córdoba publication month; history/forgery never produces actual event', async () => {
    const historicalTask = history[0].taskId;
    for (const estado of ['en_revision', 'aprobada', 'finalizada']) {
      const observed = checked(await api(`/tareas/${historicalTask}?workspace=render_os`));
      checked(await api(`/tareas/${historicalTask}?workspace=render_os`, admin, 'PATCH', { estado, expected_revision: observed.revision }));
    }
    const july = await calendar(owner.token, { cliente_id: client.id }); const august = await calendar(owner.token, { desde: '2026-08-01', hasta: '2026-09-01', cliente_id: client.id });
    validate(july); validate(august);
    const plannedStory = one(july, 'programacion', 'historia', story.id), plannedPub = one(july, 'programacion', 'publicacion', publication.id);
    assert.notEqual(plannedStory.key, plannedPub.key); assert.equal(plannedStory.date, '2026-07-15');
    assert.equal(one(july, 'publicacion', 'historia', story.id).date, '2026-07-31');
    assert.equal(matching(july, 'publicacion', 'publicacion', publication.id).length, 0);
    assert.equal(one(august, 'publicacion', 'publicacion', publication.id).date, '2026-08-01');
    for (const piece of history) assert.equal(matching(july, 'publicacion', piece.domain, piece.id).length + matching(august, 'publicacion', piece.domain, piece.id).length, 0);
    const proof = await fixture.query(`SELECT e.id,e.dominio,e.pieza_id,e.actor_id,e.occurred_at,e.recorded_at,v.revision,
      to_char(e.occurred_at AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS day
      FROM editorial_publicacion_eventos e JOIN editorial_publicacion_versiones v ON v.current_event_id=e.id AND v.dominio=e.dominio AND v.pieza_id=e.pieza_id
      WHERE e.id=ANY($1::uuid[]) ORDER BY e.dominio`, [[firstConfirmation.operation.id, secondConfirmation.operation.id]]);
    assert.deepEqual(proof.map(row => row.day).sort(), ['2026-07-31', '2026-08-01']);
    for (const row of proof) {
      const actual = one(row.day === '2026-07-31' ? july : august, 'publicacion', row.dominio, row.pieza_id);
      assert.equal(actual.date, row.day);
      assert.deepEqual(actual.evidence, { classification: 'confirmada_manualmente', revision: Number(row.revision), confirmation: {
        id: row.id, actor_id: row.actor_id, occurred_at: new Date(row.occurred_at).toISOString(),
        recorded_at: new Date(row.recorded_at).toISOString(), source: 'manual',
      } });
    }
    for (const event of [plannedStory, plannedPub]) {
      const href = new URL(event.href, 'http://fixture.invalid');
      assert.equal(href.pathname, event.source === 'historia' ? '/planificacion-historias' : '/planificacion-publicaciones');
      assert.ok([...href.searchParams.values()].includes(String(client.id))); assert.ok([...href.searchParams.values()].includes('2026-07'));
      assert.ok(href.searchParams.get('tab') === 'calendario' || href.searchParams.get('vista') === 'checklist');
    }
  });
  await t.test('private/archive/trash/inactive sources and options are excluded; client and kind narrow without granting access', async () => {
    const before = await snapshot(); const team = await calendar(admin, { scope: 'team', cliente_id: client.id }); validate(team);
    for (const id of [...hidden, inactiveTask.id]) assert.equal(matching(team, 'tarea', 'tarea', id).length, 0);
    const allClients = await calendar(admin, { scope: 'team' }); validate(allClients);
    assert.equal(matching(allClients, 'tarea', 'tarea', inactiveTask.id).length, 0);
    assert.equal(matching(team, 'programacion', archivedPiece.domain, archivedPiece.id).length, 0);
    assert.equal(team.clients.some(row => row.id === inactive.id), false);
    for (const kind of ['tarea', 'visita', 'programacion', 'publicacion']) {
      const filtered = await calendar(owner.token, { kind, cliente_id: client.id }); validate(filtered); assert.ok(filtered.events.every(event => event.kind === kind));
    }
    assert.deepEqual((await calendar(impostor.token, { cliente_id: client.id })).events, []);
    assert.deepEqual((await calendar(owner.token, { cliente_id: other.id })).events, []);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('actual deadline, registry reschedule and editorial scheduling APIs appear on refetch without publication/date inference', async () => {
    let task = checked(await api(`/tareas/${editingId}?workspace=render_os`));
    checked(await api(`/tareas/${editingId}?workspace=render_os`, owner.token, 'PATCH', { fecha_vencimiento: '2026-07-26', expected_revision: task.revision }));
    const actualVisit = await readVisit(); checked(await api(`/producciones/${visit.id}`, admin, 'PATCH', { expected_revision: actualVisit.revision, fecha: '2026-07-27' }));
    for (const piece of [story, publication]) checked(await api(`/${tables[piece.domain]}/${piece.id}`, admin, 'PATCH', { fecha_programada: '2026-08-05' }));
    const before = await snapshot(); const dto = await calendar(await login('qa_calendar_110001')); validate(dto);
    assert.equal(one(dto, 'tarea', 'tarea', editingId).date, '2026-07-26'); assert.equal(one(dto, 'visita', 'visita', visit.id).date, '2026-07-27');
    assert.equal((await fixture.query("SELECT to_char(fecha_vencimiento,'YYYY-MM-DD') AS day FROM tareas WHERE id=$1", [source.id]))[0].day, '2026-07-27');
    assert.equal(matching(dto, 'programacion', 'historia', story.id).length, 0);
    assert.equal(one(dto, 'publicacion', 'historia', story.id).date, '2026-07-31');
    const august = await calendar(owner.token, { desde: '2026-08-01', hasta: '2026-09-01' });
    for (const piece of [story, publication]) assert.equal(one(august, 'programacion', piece.domain, piece.id).date, '2026-08-05');
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('strict scalar query/range validation and active current sessions fail closed with no writes', async () => {
    const before = await snapshot();
    for (const query of [
      '', 'desde=2026-07-01', 'desde=2026-02-30&hasta=2026-03-02', 'desde=2026-07-01&hasta=2026-07-01',
      'desde=2026-07-01&hasta=2026-06-30', 'desde=2026-07-01&hasta=2026-09-02',
      'desde=2026-07-01&hasta=2026-08-01&scope=admin', 'desde=2026-07-01&hasta=2026-08-01&kind=milestone',
      'desde=2026-07-01&hasta=2026-08-01&cliente_id=0', 'desde=2026-07-01&hasta=2026-08-01&cliente_id=2147483648',
      'desde=2026-07-01&hasta=2026-08-01&cliente_id=1x', 'desde=2026-07-01&hasta=2026-08-01&user_id=110001',
      'desde=2026-07-01&hasta=2026-08-01&scope=mine&scope=team', 'desde[]=2026-07-01&hasta=2026-08-01',
      'desde=2026-07-01&hasta=2026-08-01&cliente_id[x]=1', 'desde=2026-07-01&desde=2026-07-02&hasta=2026-08-01',
    ]) assert.equal((await api(`/calendario?${query}`)).status, 400, query);
    validate(await calendar(owner.token, { hasta: '2026-09-01' }));
    assert.equal((await request(fixture.base, '/api/calendario?desde=2026-07-01&hasta=2026-08-01')).status, 401);
    assert.equal((await api('/calendario?desde=2026-07-01&hasta=2026-08-01', users[6].token)).status, 403);
    assert.deepEqual(await snapshot(), before);
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=110002');
    assert.equal((await api('/calendario?desde=2026-07-01&hasta=2026-08-01', impostor.token)).status, 401);
    const renewed = await login('qa_calendar_110002'); await fixture.query('UPDATE usuarios SET activo=false WHERE id=110002');
    assert.equal((await api('/calendario?desde=2026-07-01&hasta=2026-08-01', renewed)).status, 401);
    await fixture.query('UPDATE usuarios SET activo=true WHERE id=110002');
  });
  await t.test('actual withdrawal removes only confirmed event after refetch, preserving scheduled planning and task dates', async () => {
    const tasksBefore = await fixture.query('SELECT * FROM tareas ORDER BY id');
    for (const piece of [story, publication]) {
      const observed = checked(await api(`/editorial-publicacion/${piece.domain}/${piece.id}`));
      checked(await api(`/editorial-publicacion/${piece.domain}/${piece.id}/retirar`, admin, 'POST', {
        request_id: randomUUID(), expected_revision: observed.piece.revision,
      }));
    }
    const before = await snapshot();
    const range = await calendar(owner.token, { desde: '2026-07-01', hasta: '2026-09-01' }); validate(range);
    for (const piece of [story, publication]) {
      assert.equal(matching(range, 'publicacion', piece.domain, piece.id).length, 0);
      assert.equal(one(range, 'programacion', piece.domain, piece.id).date, '2026-08-05');
    }
    assert.deepEqual(await fixture.query('SELECT * FROM tareas ORDER BY id'), tasksBefore);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('bounded2002-task fixture explicitly reports truncation and caps2000 without pretending complete counts', async () => {
    const [bulkClient] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA bounded calendar bulk') RETURNING id");
    await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
      SELECT 'QA bounded item '||g,'QA fixture',$1,'edicion','pendiente','2026-07-10','{"workspace":"render_os"}'::jsonb FROM generate_series(1,2002) g`, [bulkClient.id]);
    const before = await snapshot();
    const dto = await calendar(admin, { scope: 'team', kind: 'tarea', cliente_id: bulkClient.id }); validate(dto);
    assert.equal(dto.events.length, 2000); assert.equal(dto.truncated, true);
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM tareas WHERE cliente_id=$1', [bulkClient.id]))[0].n, 2002);
    assert.deepEqual(await snapshot(), before);
  });
});
