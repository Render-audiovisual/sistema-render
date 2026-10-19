import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const privateMarker = 'QA_CALENDAR_PROJECT_FINANCE_55621';
test('calendar project milestones: principal CRUD, parent identity and independent operational dates', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55621 });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own calendar-projects fixture stopped and removed: ${fixture.root}`);
  });
  const checked = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const api = (path, token = admin, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const login = async usuario => checked(await request(fixture.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const admin = await login('qa_franco'); const users = [];
  for (const [id, role] of [[111001, 'edicion'], [111002, 'edicion'], [111003, 'diseno'], [111004, 'community'], [111005, 'produccion'], [111006, 'programacion']]) {
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA project calendar homonym',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa_cal_project_${id}`, role]);
    users.push({ id, role, token: await login(`qa_cal_project_${id}`) });
  }
  const [responsible, homonym, member, taskOnly] = users;
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA milestone client') RETURNING id,nombre");
  const [other] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA milestone other') RETURNING id,nombre");
  await fixture.query("INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por) VALUES ($1,'2026-01-01',835721.64,'QA fixture')", [client.id]);
  const getProject = async id => checked(await api(`/proyectos/${id}`)).proyecto;
  const mutate = async (id, path, body, token = admin, method = 'PATCH') => {
    const observed = await getProject(id);
    return checked(await api(`/proyectos/${id}${path}`, token, method, { expected_revision: observed.revision, ...body }), method === 'POST' ? 201 : 200).proyecto;
  };
  const createProject = async (extra = {}) => checked(await api('/proyectos', admin, 'POST', {
    request_id: randomUUID(), titulo: 'QA real project calendar', cliente_id: client.id, responsable_id: responsible.id,
    miembro_ids: [member.id], tipo: 'web', descripcion: `Private project context ${privateMarker}`,
    fecha_inicio: '2026-10-01', fecha_entrega: '2026-10-28', ...extra,
  }), 201).proyecto;
  const project = await createProject();
  const addMilestone = async (parent, title, date, state = 'pendiente') => {
    const current = await mutate(parent.id, '/hitos', { titulo: title, fecha: date, estado: state }, admin, 'POST');
    const milestone = current.hitos.find(row => row.titulo === title); assert.ok(milestone); return milestone;
  };
  const pending = await addMilestone(project, 'QA dated real milestone', '2026-10-21');
  const completed = await addMilestone(project, 'QA completed planned milestone', '2026-10-12', 'completado');
  const cancelled = await addMilestone(project, 'QA cancelled planned milestone', '2026-10-13', 'cancelado');
  const undated = await addMilestone(project, 'QA undated not a calendar event', null);
  const lower = await addMilestone(project, 'QA inclusive lower bound', '2026-10-01');
  const upper = await addMilestone(project, 'QA exclusive upper bound', '2026-11-01');
  const long = await addMilestone(project, `QA long milestone ${'x'.repeat(220)}`, '2026-10-14');
  await mutate(project.id, '/entregables', { titulo: 'QA private artifact not calendar', url: `https://example.invalid/${privateMarker}`,
    observaciones: privateMarker }, admin, 'POST');
  const deadlineOnly = await createProject({ titulo: 'QA project delivery date alone is not milestone' });
  const oldTask = checked(await api('/tareas', admin, 'POST', {
    titulo: 'QA linked independent development deadline', workspace: 'render_os', cliente_id: client.id,
    asignado_a_id: taskOnly.id, colaborador_ids: [], tipo_tarea: 'desarrollo', fecha_vencimiento: '2026-10-21',
  }), 201);
  await mutate(project.id, '/tareas', { tarea_id: oldTask.id, expected_tarea_revision: oldTask.revision }, admin, 'POST');
  const visit = checked(await api('/producciones', admin, 'POST', { cliente_id: client.id, fecha: '2026-10-22',
    titulo: 'QA old source visit', participante_ids: [taskOnly.id] }), 201).visita;
  const [story] = await fixture.query(`INSERT INTO historias(cliente_id,estado,fecha_programada,idea,metadata)
    VALUES ($1,'lista','2026-10-20','QA original scheduled story',$2::jsonb) RETURNING id`, [client.id, JSON.stringify({ financial: { amount: 835721.64, marker: privateMarker } })]);
  const [publication] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,metadata)
    VALUES ($1,'video','lista','2026-10-20','QA original scheduled publication',$2::jsonb) RETURNING id`, [client.id, JSON.stringify({ financial: { marker: privateMarker } })]);
  const observedPiece = checked(await api(`/editorial-publicacion/publicacion/${publication.id}`));
  const confirmation = checked(await api(`/editorial-publicacion/publicacion/${publication.id}/confirmar`, admin, 'POST', {
    request_id: randomUUID(), expected_revision: observedPiece.piece.revision, occurred_at: '2026-10-01T03:30:00Z',
  }), 201);
  const calendar = async (token = admin, filters = {}) => checked(await api(`/calendario?${new URLSearchParams({
    desde: '2026-10-01', hasta: '2026-11-01', scope: 'mine', ...filters,
  })}`, token));
  const milestoneEvents = data => data.events.filter(event => event.kind === 'hito');
  const onlyOurMilestones = async (data, parentId = project.id) => {
    const ids = new Set((await fixture.query('SELECT id FROM proyecto_hitos WHERE proyecto_id=$1', [parentId])).map(row => row.id));
    return milestoneEvents(data).filter(event => ids.has(event.source_id));
  };
  const snapshot = async () => {
    const names = await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_migrations' ORDER BY tablename");
    assert.ok(names.every(row => /^[a-z_][a-z0-9_]*$/.test(row.tablename)));
    return fixture.query(`SELECT * FROM (${names.map(({ tablename }) => `SELECT '${tablename}' AS name,COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM "${tablename}" r`).join(' UNION ALL ')}) business_snapshot ORDER BY name`);
  };
  const oracle = async (scope, actorId, filters = {}) => fixture.query(`SELECT h.id,p.id AS project_id,h.titulo,
    to_char(h.fecha,'YYYY-MM-DD') AS date,h.estado,p.cliente_id,c.nombre AS cliente_nombre,
    ARRAY(SELECT DISTINCT ids.id FROM (SELECT p.responsable_id AS id UNION ALL SELECT m.usuario_id FROM proyecto_miembros m WHERE m.proyecto_id=p.id) ids ORDER BY ids.id) AS members
    FROM proyecto_hitos h JOIN proyectos p ON p.id=h.proyecto_id JOIN clientes c ON c.id=p.cliente_id
    WHERE NOT p.archivado AND c.activo IS DISTINCT FROM FALSE AND h.fecha >= $1::date AND h.fecha < $2::date
      AND ($3::int IS NULL OR p.cliente_id=$3)
      AND ($4::boolean OR p.responsable_id=$5 OR EXISTS(SELECT 1 FROM proyecto_miembros m WHERE m.proyecto_id=p.id AND m.usuario_id=$5))
    ORDER BY h.fecha,h.id`, [filters.desde ?? '2026-10-01', filters.hasta ?? '2026-11-01', filters.cliente_id ?? null, scope === 'team', actorId]);
  const validate = async (dto, scope, actorId, filters = {}) => {
    assert.deepEqual(Object.keys(dto).sort(), ['range', 'scope', 'kind', 'timezone', 'clients', 'events', 'truncated'].sort());
    assert.equal(dto.scope, scope); assert.equal(dto.timezone, 'America/Argentina/Cordoba'); assert.equal(dto.truncated, false);
    assert.ok(dto.events.length <= 2000);
    const actual = milestoneEvents(dto); const expected = await oracle(scope, actorId, filters);
    assert.deepEqual(actual.map(event => event.source_id).sort(), expected.map(row => row.id).sort());
    for (const row of expected) {
      const event = actual.find(event => event.source_id === row.id);
      assert.deepEqual(Object.keys(event).sort(), ['key', 'kind', 'source', 'source_id', 'date', 'title', 'cliente_id', 'cliente_nombre', 'estado', 'href', 'responsable_ids', 'evidence'].sort());
      assert.equal(event.key, `hito:hito:${row.id}`); assert.equal(event.source, 'hito');
      assert.match(event.source_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      assert.equal(event.date, row.date); assert.equal(event.estado, row.estado);
      assert.equal(event.title, `Hito de proyecto · ${row.titulo}`.slice(0, 160));
      assert.equal(event.cliente_id, row.cliente_id); assert.equal(event.cliente_nombre, row.cliente_nombre.slice(0, 250));
      assert.deepEqual(event.responsable_ids, row.members); assert.equal(event.evidence, null);
      assert.equal(event.href, `/proyectos?proyecto=${row.project_id}`);
      const context = new URL(event.href, 'http://fixture.invalid');
      assert.deepEqual([...context.searchParams.keys()], ['proyecto']); assert.equal(context.searchParams.get('proyecto'), row.project_id);
    }
    const keys = dto.events.map(row => row.key); assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(dto.events, [...dto.events].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)));
    for (const item of dto.clients) assert.deepEqual(Object.keys(item).sort(), ['id', 'nombre']);
    assert.ok(!JSON.stringify(dto).includes(privateMarker)); assert.ok(!JSON.stringify(dto).includes('835721.64'));
  };
  let oldSources;
  await t.test('all supported roles share safe team milestones and current responsible/member IDs alone grant mine', async () => {
    const before = await snapshot(); let expected;
    for (const actor of [{ id: 91001, token: admin }, ...users]) {
      const dto = await calendar(actor.token, { scope: 'team' }); await validate(dto, 'team', actor.id);
      if (expected) assert.deepEqual(milestoneEvents(dto), expected); else expected = milestoneEvents(dto);
      const mine = await calendar(actor.token); await validate(mine, 'mine', actor.id);
      const own = await onlyOurMilestones(mine);
      if ([responsible.id, member.id].includes(actor.id)) assert.equal(own.length, 5);
      else assert.deepEqual(own, [], `No mine authority from admin status, names, task links or other roles: ${actor.id}`);
    }
    oldSources = (await calendar(admin, { scope: 'team' })).events.filter(event => event.kind !== 'hito');
    for (const [kind, source, id] of [['tarea', 'tarea', oldTask.id], ['visita', 'visita', visit.id],
      ['programacion', 'historia', story.id], ['programacion', 'publicacion', publication.id], ['publicacion', 'publicacion', publication.id]])
      assert.equal(oldSources.filter(event => event.kind === kind && event.source === source && event.source_id === id).length, 1);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('linked task assignment is independent: task-only actor sees deadline but no project milestones', async () => {
    const mine = await calendar(taskOnly.token); await validate(mine, 'mine', taskOnly.id);
    assert.ok(mine.events.some(event => event.kind === 'tarea' && event.source_id === oldTask.id));
    assert.deepEqual(await onlyOurMilestones(mine), []);
    const shared = await calendar(admin, { scope: 'team' });
    assert.equal(shared.events.filter(event => event.date === '2026-10-21' && event.source_id === pending.id && event.kind === 'hito').length, 1);
    assert.equal(shared.events.filter(event => event.date === '2026-10-21' && event.source_id === oldTask.id && event.kind === 'tarea').length, 1);
  });
  await t.test('null milestone/project deadline do not invent events; inclusive bounds and completed/cancelled planned states remain explicit', async () => {
    const dto = await calendar(responsible.token, { kind: 'hito' }); await validate(dto, 'mine', responsible.id);
    assert.ok(dto.events.every(event => event.kind === 'hito')); assert.ok(!dto.events.some(event => event.source_id === undated.id || event.source_id === upper.id));
    assert.equal(dto.events.find(event => event.source_id === lower.id).date, '2026-10-01');
    assert.equal(dto.events.find(event => event.source_id === completed.id).estado, 'completado');
    assert.equal(dto.events.find(event => event.source_id === cancelled.id).estado, 'cancelado');
    assert.equal(dto.events.find(event => event.source_id === long.id).title.length, 160);
    assert.deepEqual(await onlyOurMilestones(dto, deadlineOnly.id), []);
    assert.ok(!dto.events.some(event => event.source_id === deadlineOnly.id));
  });
  await t.test('real milestone date/title changes retain UUID/key/context and refetch through fresh login', async () => {
    await mutate(project.id, `/hitos/${pending.id}`, { fecha: '2026-11-04', titulo: 'QA deliberately postponed milestone' }, responsible.token);
    // Preserve the all-table read-only assertion after login's security write.
    const freshToken = await login('qa_cal_project_111001');
    const before = await snapshot();
    const october = await calendar(freshToken, { kind: 'hito' }); await validate(october, 'mine', responsible.id);
    assert.equal(october.events.some(event => event.source_id === pending.id), false);
    const filters = { desde: '2026-11-01', hasta: '2026-12-01', kind: 'hito' };
    const november = await calendar(responsible.token, filters); await validate(november, 'mine', responsible.id, filters);
    const updated = november.events.find(event => event.source_id === pending.id); assert.ok(updated);
    assert.equal(updated.key, `hito:hito:${pending.id}`); assert.equal(updated.href, `/proyectos?proyecto=${project.id}`); assert.equal(updated.date, '2026-11-04');
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('project member changes and renames affect current ID scope immediately, never historical names', async () => {
    await mutate(project.id, '', { miembro_ids: [homonym.id] });
    const before = await snapshot();
    assert.deepEqual(await onlyOurMilestones(await calendar(member.token)), []);
    assert.ok((await onlyOurMilestones(await calendar(homonym.token))).length > 0);
    assert.deepEqual(await snapshot(), before);
    await fixture.query("UPDATE usuarios SET nombre='QA renamed stable project owner' WHERE id=$1", [responsible.id]);
    const renamed = await calendar(responsible.token); await validate(renamed, 'mine', responsible.id);
    await mutate(project.id, '', { responsable_id: users[4].id });
    assert.deepEqual(await onlyOurMilestones(await calendar(responsible.token)), []);
    assert.ok((await onlyOurMilestones(await calendar(users[4].token))).length > 0);
    await mutate(project.id, '', { responsable_id: responsible.id, miembro_ids: [member.id] });
  });
  await t.test('archived/inactive exclusion is reversible while finalized/cancelled parent does not erase dated milestones', async () => {
    await mutate(project.id, '', { archivado: true });
    for (const token of [admin, responsible.token]) assert.deepEqual(await onlyOurMilestones(await calendar(token, { scope: 'team' })), []);
    await mutate(project.id, '', { archivado: false });
    await fixture.query('UPDATE clientes SET activo=false WHERE id=$1', [client.id]);
    try {
      const before = await snapshot(); const dto = await calendar(admin, { scope: 'team' });
      assert.deepEqual(await onlyOurMilestones(dto), []); assert.equal(dto.clients.some(item => item.id === client.id), false);
      assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query('UPDATE clientes SET activo=true WHERE id=$1', [client.id]); }
    for (const estado of ['finalizado', 'cancelado']) {
      await mutate(project.id, '', { estado });
      const dto = await calendar(responsible.token, { kind: 'hito' }); await validate(dto, 'mine', responsible.id);
      assert.ok(dto.events.some(event => event.source_id === completed.id && event.estado === 'completado'));
      assert.ok(dto.events.some(event => event.source_id === cancelled.id && event.estado === 'cancelado'));
    }
    await mutate(project.id, '', { estado: 'en_curso' });
  });
  await t.test('kind/client/date bounds narrow shared records without widening mine; old four sources and business rows unchanged', async () => {
    const before = await snapshot();
    const filters = { scope: 'team', kind: 'hito', cliente_id: client.id, desde: '2026-10-12', hasta: '2026-10-14' };
    const dto = await calendar(admin, filters); await validate(dto, 'team', 91001, filters);
    assert.deepEqual(dto.events.map(row => row.source_id).sort(), [completed.id, cancelled.id].sort());
    const empty = await calendar(admin, { scope: 'team', kind: 'hito', cliente_id: other.id }); await validate(empty, 'team', 91001, { cliente_id: other.id }); assert.deepEqual(empty.events, []);
    const nonmember = await calendar(taskOnly.token, { kind: 'hito', cliente_id: client.id }); assert.deepEqual(nonmember.events, []);
    for (const kind of ['tarea', 'visita', 'programacion', 'publicacion']) {
      const filtered = await calendar(admin, { scope: 'team', kind });
      assert.deepEqual(filtered.events, oldSources.filter(event => event.kind === kind));
    }
    assert.deepEqual((await calendar(admin, { scope: 'team' })).events.filter(event => event.kind !== 'hito'), oldSources);
    assert.deepEqual(await snapshot(), before);
  });
});
