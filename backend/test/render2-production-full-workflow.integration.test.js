import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loginProductionCookieSession, productionCookieRequest } from './helpers/production-cookie-session.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

// Opt-in only; principal HTTP and fresh physical PG. No service imports,
// simulated writers, ledger fixture INSERTs or configured database connection.
for (const cohort of [
  { transport: 'bearer', port: 55677, employeeOnly: false },
  { transport: 'cookie', port: 55784, employeeOnly: false },
  { transport: 'cookie', port: 55913, employeeOnly: true },
]) test(`${cohort.employeeOnly ? 'cookie employee-only editors' : cohort.transport}: three-video production journey persists exact deliveries/corrections/approvals across registry, Home, calendar and reports`, {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const { transport, port, employeeOnly } = cohort;
  const fixture = await startLocalHarness({ port, browserSessions: transport === 'cookie' });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own full production-workflow fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'Unexpected principal HTTP status; authentication bodies intentionally omitted'); return response.body;
  };
  const api = (route, token, method = 'GET', body) => transport === 'cookie'
    ? productionCookieRequest(fixture.base, `/api${route}`, { session: token, method, body })
    : request(fixture.base, `/api${route}`, { token, method, body });
  const login = async usuario => transport === 'cookie'
    ? loginProductionCookieSession(fixture.base, usuario, fixturePassword)
    : checked(await api('/login', undefined, 'POST', { usuario, password: fixturePassword })).token;
  const actors = [
    { id: 91001, usuario: 'qa_franco', role: 'admin' },
    { id: 91002, usuario: 'qa_agustin', role: 'admin' },
    { id: 91003, usuario: 'qa_luciano', role: 'edicion' },
  ];
  const extraEditors = employeeOnly ? [
    { id: 91005, usuario: 'qa_editora', role: 'edicion' },
    { id: 91006, usuario: 'qa_editorb', role: 'edicion' },
  ] : [];
  for (const editor of extraEditors) {
    // Generated fixture identity was checked above. Copy only its known
    // synthetic login hash in SQL; never read/log a credential or real user.
    const created = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,'edicion',password_hash,true,1 FROM usuarios WHERE id=91003
      RETURNING id,usuario,rol`, [editor.id, editor.usuario, `QA independent editor ${editor.id}`]);
    assert.deepEqual(created, [{ id: editor.id, usuario: editor.usuario, rol: 'edicion' }]);
  }
  const employees = [actors[2], ...extraEditors];
  const sessionActors = [...actors, ...extraEditors];
  for (const actor of sessionActors) actor.token = await login(actor.usuario);
  if (employeeOnly) {
    assert.equal(employees.length, 3); assert.equal(new Set(employees.map(actor => actor.id)).size, 3);
    for (const actor of employees) { assert.equal(actor.role, 'edicion'); assert.equal(actor.token.user.rol, 'edicion'); }
  }
  const [clock] = await fixture.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today`);
  const month = clock.today.slice(0, 7), start = `${month}-01`;
  const shiftMonth = n => {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number - 1 + n, 1)).toISOString().slice(0, 10);
  };
  const next = shiftMonth(1), afterNext = shiftMonth(2), movedDate = `${next.slice(0, 7)}-03`;
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA full production workflow client',true) RETURNING id,nombre");
  const records = (employeeOnly ? employees : actors).map((actor, index) => ({ actor, reviewer: actors[index === 0 ? 1 : 0],
    title: `QA explicit full-workflow video ${index + 1}`, script: `Literal script for independent video ${index + 1}\nSecond line preserved.`,
    due: `${month}-${20 + index}`, state: 'pendiente', videoId: null, taskId: null, artifacts: [], decisions: [] }));
  const businessTables = ['tareas', 'tarea_asignaciones', 'tarea_comentarios', 'produccion_visitas', 'produccion_visita_participantes',
    'produccion_videos', 'produccion_fotos', 'task_editing_deliveries', 'task_editing_reviews',
    'historias', 'publicaciones', 'editorial_publicacion_eventos', 'editorial_publicacion_versiones',
    'cliente_objetivo_piezas', 'cliente_objetivo_eventos'];
  const snapshot = async (tables = businessTables) => {
    const value = {};
    for (const name of tables) value[name] = digest(await fixture.query(`SELECT * FROM ${name} r ORDER BY to_jsonb(r)::text`));
    return value;
  };
  const editorialTables = ['historias', 'publicaciones', 'editorial_publicacion_eventos', 'editorial_publicacion_versiones',
    'cliente_objetivo_piezas', 'cliente_objetivo_eventos'];
  const originalEditorial = await snapshot(editorialTables);
  const noPublication = async () => assert.deepEqual(await snapshot(editorialTables), originalEditorial,
    'Production work, deliveries, approvals and completion must not create pieces, quotas or publication evidence');
  const originalTaskIds = (await fixture.query('SELECT id FROM tareas ORDER BY id')).map(row => row.id);
  let visitId, visitDate = start;
  const visit = async (token = actors[0].token) => checked(await api(`/producciones/${visitId}`, token)).visita;
  const task = async record => checked(await api(`/tareas/${record.taskId}?workspace=render_os`, record.actor.token));
  const handoff = (record, expected_revision) => api(`/producciones/${visitId}/videos/${record.videoId}/enviar-edicion`, actors[0].token, 'POST', {
    expected_revision, editor_id: record.actor.id, fecha_entrega: record.due,
  });
  const calendar = async (token, from, until, scope = 'team') => checked(await api(`/calendario?${new URLSearchParams({
    desde: from, hasta: until, scope, cliente_id: String(client.id),
  })}`, token));
  const report = async (token, from, until) => checked(await api(`/reportes/datos?${new URLSearchParams({
    mes_configuracion: from.slice(0, 7), desde: from, hasta: until,
  })}`, token));
  const exactlyOne = (rows, predicate, label) => {
    const matches = rows.filter(predicate); assert.equal(matches.length, 1, label); return matches[0];
  };
  const assertMedia = current => {
    assert.equal(current.id, visitId); assert.equal(current.cliente_id, client.id); assert.equal(current.fecha, visitDate);
    assert.equal(current.tarea_origen_id, null, 'Ordinary new visit has no fabricated historical source');
    assert.deepEqual([...current.participante_ids].sort(), actors.map(actor => actor.id).sort());
    assert.deepEqual(current.videos.map(row => row.id).sort(), records.map(row => row.videoId).sort());
    for (const record of records) {
      const video = exactlyOne(current.videos, row => row.id === record.videoId, 'One stable UUID per video');
      assert.equal(video.titulo, record.title); assert.equal(video.guion, record.script); assert.equal(video.estado, 'grabado');
      assert.equal(video.tarea_edicion_id, record.taskId); assert.equal(video.tarea_estado, record.state);
      assert.equal(video.editor_handoff_id, record.actor.id); assert.equal(video.editor_actual_id, record.actor.id);
      assert.equal(video.fecha_entrega_handoff, record.due); assert.equal(video.fecha_entrega_actual, record.due);
      assert.equal(video.publicacion_id, null); assert.equal(video.tarea_entrega_id, null);
    }
  };
  const assertViews = async () => {
    assertMedia(await visit());
    const taskIds = records.map(row => row.taskId);
    assert.deepEqual((await fixture.query('SELECT id FROM tareas ORDER BY id')).map(row => row.id),
      [...originalTaskIds, ...taskIds].sort((a, b) => a - b), 'Only the three explicit editing tasks exist');
    assert.deepEqual(await fixture.query(`SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[])
      ORDER BY tarea_id,usuario_id`, [taskIds]), records.map(row => ({ tarea_id: row.taskId, usuario_id: row.actor.id, tipo: 'responsable' }))
      .sort((a, b) => a.tarea_id - b.tarea_id));
    const teamCalendar = await calendar(actors[0].token, start, next);
    assert.equal(teamCalendar.truncated, false);
    assert.equal(teamCalendar.events.filter(row => row.kind === 'publicacion').length, 0);
    for (const record of records) {
      const event = exactlyOne(teamCalendar.events, row => row.key === `tarea:tarea:${record.taskId}`, 'One independent editing deadline');
      assert.equal(event.date, record.due); assert.equal(event.estado, record.state);
      assert.deepEqual(event.responsable_ids, [record.actor.id]); assert.equal(event.evidence, null);
    }
    const scheduled = await calendar(actors[0].token, visitDate === start ? start : next, visitDate === start ? next : afterNext);
    const event = exactlyOne(scheduled.events, row => row.key === `visita:visita:${visitId}`, 'One visit, never three copies');
    assert.equal(event.date, visitDate); assert.equal(event.evidence, null);
    for (const record of records) {
      const home = checked(await api('/inicio', record.actor.token));
      assert.equal(home.user.id, record.actor.id); assert.equal(home.monthly_progress.period, month);
      assert.equal(home.monthly_progress.total, 1); assert.equal(home.monthly_progress.completed, Number(record.state === 'finalizada'));
      const sector = exactlyOne(home.monthly_progress.by_sector, row => row.sector === 'edicion', 'Own monthly editing work');
      assert.equal(sector.total, 1); assert.equal(sector.completed, Number(record.state === 'finalizada'));
      assert.equal(home.summary.open, Number(record.state !== 'finalizada'));
      assert.deepEqual(home.tasks.map(row => row.id), record.state === 'finalizada' ? [] : [record.taskId]);
      assert.deepEqual(home.activity.map(row => row.task_id), [record.taskId]);
      const reviewIds = (record.actor.role === 'admin' ? records : [record]).filter(row => row.state === 'en_revision').map(row => row.taskId).sort((a, b) => a - b);
      assert.equal(home.review.total, reviewIds.length);
      assert.deepEqual(home.review.items.map(row => row.id).sort((a, b) => a - b), reviewIds);
      const mine = await calendar(record.actor.token, start, next, 'mine');
      assert.deepEqual(mine.events.filter(row => row.source === 'tarea').map(row => row.source_id), [record.taskId]);
      const body = await report(record.actor.token, start, next);
      const expectedTasks = records; // Team reports; personal Home/calendar assertions above remain unchanged.
      assert.deepEqual(body.tareasRenderOs.filter(row => taskIds.includes(row.id)).map(row => row.id).sort((a, b) => a - b),
        expectedTasks.map(row => row.taskId).sort((a, b) => a - b));
      for (const own of expectedTasks) {
        const taskRow = exactlyOne(body.tareasRenderOs, row => row.id === own.taskId, 'Report reads original editing task');
        assert.equal(taskRow.estado, own.state); assert.equal(taskRow.fecha_vencimiento.slice(0, 10), own.due);
        const day = body.resumenRenderOsPorDia[own.due]?.ediciones;
        assert.equal(day?.total, 1); assert.equal(day?.publicadas, Number(own.state === 'finalizada'),
          'Legacy report key describes completed work, never publication evidence');
      }
      const registryReport = await report(record.actor.token, visitDate === start ? start : next, visitDate === start ? next : afterNext);
      const shared = exactlyOne(registryReport.producciones.visitas, row => row.id === visitId, 'Shared production visit persists in every account');
      assert.equal(shared.fecha, visitDate); assert.equal(shared.videos.length, 3);
      for (const linked of records) {
        const video = exactlyOne(shared.videos, row => row.id === linked.videoId, 'Stable report video');
        assert.equal(video.estado, 'grabado'); assert.equal(video.tarea_edicion_id, linked.taskId);
        assert.equal(video.tarea_estado, linked.state); assert.equal(video.editor_actual_id, linked.actor.id);
        assert.equal(video.fecha_entrega_actual, linked.due);
      }
    }
    await noPublication();
  };

  await t.test('ordinary visit and three individually recorded scripts are created by actual registry APIs without inferred tasks', async () => {
    const current = checked(await api('/producciones', actors[0].token, 'POST', { request_id: randomUUID(), cliente_id: client.id,
      fecha: start, titulo: 'QA ordinary new three-video full workflow', participante_ids: actors.map(actor => actor.id),
      drive_url: 'https://example.invalid/full-workflow-raw-material', observaciones: 'Explicit new visit, not historical aggregate reconciliation.',
    }), 201).visita;
    visitId = current.id; assert.match(visitId, uuid);
    for (const record of records) {
      const recordingActor = employeeOnly ? actors[0] : record.actor;
      let saved = checked(await api(`/producciones/${visitId}/videos`, recordingActor.token, 'POST', {
        expected_revision: (await visit()).revision, titulo: record.title, guion: record.script, estado: 'planificado',
      }), 201).visita;
      record.videoId = exactlyOne(saved.videos, row => row.titulo === record.title, 'Explicit video identity').id;
      assert.match(record.videoId, uuid);
      saved = checked(await api(`/producciones/${visitId}/videos/${record.videoId}`, recordingActor.token, 'PATCH', {
        expected_revision: saved.revision, estado: 'grabado', material_url: `https://example.invalid/full-workflow-raw-${record.actor.id}`,
      })).visita;
      assert.equal(saved.videos.find(row => row.id === record.videoId).guion, record.script);
    }
    assert.equal(new Set(records.map(row => row.videoId)).size, 3);
    assert.deepEqual((await fixture.query('SELECT id FROM tareas ORDER BY id')).map(row => row.id), originalTaskIds);
    await noPublication();
  });

  await t.test('manual editor IDs yield three independent tasks; exact handoff retry never duplicates or rewrites them', async () => {
    for (const record of records) {
      const observed = (await visit()).revision, saved = checked(await handoff(record, observed), 201);
      record.taskId = saved.task.id; assert.equal(saved.created, true); assert.equal(saved.task.asignado_a_id, record.actor.id);
      const before = await snapshot(), replay = checked(await handoff(record, observed));
      assert.equal(replay.created, false); assert.equal(replay.task.id, record.taskId); assert.deepEqual(await snapshot(), before);
    }
    assert.equal(new Set(records.map(row => row.taskId)).size, 3); await assertViews();
  });

  if (transport === 'cookie') await t.test('cookie actors cannot cross context or hand off as employee; logout withdraws the original session', async () => {
    for (const actor of actors) assert.equal(actor.token.user.id, actor.id);
    assert.equal(new Set(actors.map(actor => actor.token.context)).size, 3, 'Independent server sessions');
    const before = await snapshot();
    const crossedSession = { ...actors[0].token, cookie: actors[2].token.cookie };
    // GET may run under the cookie's actual user; its proof must prevent the
    // original caller from accepting another session's successful response.
    await assert.rejects(productionCookieRequest(fixture.base, `/api/producciones/${visitId}`, {
      session: crossedSession,
    }), /Successful operational response must prove its original cookie context/);
    const crossed = await productionCookieRequest(fixture.base, `/api/producciones/${visitId}/videos`, {
      session: crossedSession, method: 'POST', body: { expected_revision: (await visit()).revision,
        titulo: 'QA denied crossed-cookie video', estado: 'planificado' },
    });
    checked(crossed, 409); assert.equal(crossed.body.code, 'browser_session_changed');
    const record = records[2];
    checked(await api(`/producciones/${visitId}/videos/${record.videoId}/enviar-edicion`, actors[2].token, 'POST', {
      expected_revision: (await visit()).revision, editor_id: record.actor.id, fecha_entrega: record.due,
    }), 403);
    assert.deepEqual(await snapshot(), before, 'Denied context/role must not rewrite existing handoffs');
    const retired = actors[2].token;
    checked(await api('/logout', retired, 'POST', {}));
    checked(await api('/inicio', retired), 401);
    actors[2].token = await login(actors[2].usuario);
    assert.equal(actors[2].token.user.id, actors[2].id);
    await assertViews(); assert.deepEqual(await snapshot(), before, 'New session recovers original shared records');
  });

  await t.test('allowed ordinary visit reschedule crosses month after handoff but before editing; no task deadline moves', async () => {
    const before = await fixture.query("SELECT id,to_char(fecha_vencimiento,'YYYY-MM-DD') AS due FROM tareas WHERE id=ANY($1::int[]) ORDER BY id", [records.map(row => row.taskId)]);
    checked(await api(`/producciones/${visitId}`, actors[0].token, 'PATCH', { expected_revision: (await visit()).revision, fecha: movedDate }));
    visitDate = movedDate;
    assert.deepEqual(await fixture.query("SELECT id,to_char(fecha_vencimiento,'YYYY-MM-DD') AS due FROM tareas WHERE id=ANY($1::int[]) ORDER BY id", [records.map(row => row.taskId)]), before);
    assert.equal(checked(await api(`/producciones?mes=${month}`, actors[2].token)).visitas.some(row => row.id === visitId), false);
    assert.equal(checked(await api(`/producciones?mes=${next.slice(0, 7)}`, actors[2].token)).visitas.filter(row => row.id === visitId).length, 1);
    assert.equal((await calendar(actors[0].token, start, next)).events.some(row => row.source_id === visitId), false);
    assert.equal((await report(actors[2].token, start, next)).producciones.visitas.some(row => row.id === visitId), false);
    await assertViews();
  });

  for (const record of records) await t.test(`editor ${record.actor.id}: real two-version correction/review loop preserves exact artifact and actor proof`, async () => {
    const patch = async (state, extra = {}, token = record.actor.token) => checked(await api(`/tareas/${record.taskId}?workspace=render_os`, token, 'PATCH', {
      expected_revision: (await task(record)).revision, estado: state, ...extra,
    }));
    await patch('en_progreso'); record.state = 'en_progreso'; await assertViews();
    if (employeeOnly || record.actor.id !== 91003) {
      const before = await snapshot();
      const unrelatedEditor = employeeOnly ? employees.find(actor => actor.id !== record.actor.id) : actors[2];
      assert.ok(unrelatedEditor); assert.notEqual(unrelatedEditor.id, record.actor.id);
      checked(await api(`/tareas-edicion/${record.taskId}/entregas`, unrelatedEditor.token, 'POST', {
        request_id: randomUUID(), expected_revision: (await task(record)).revision,
        url: 'https://example.invalid/not-this-editors-video', notes: employeeOnly
          ? 'Another employee cannot deliver this independently assigned video'
          : 'Unrelated editor cannot write an admin-owned task',
      }), 403); assert.deepEqual(await snapshot(), before);
    }
    const deliver = async ordinal => {
      const body = { request_id: randomUUID(), expected_revision: (await task(record)).revision,
        url: `https://example.invalid/full-workflow-${record.actor.id}-v${ordinal}`, notes: `Literal version ${ordinal} for video ${record.videoId}` };
      const saved = checked(await api(`/tareas-edicion/${record.taskId}/entregas`, record.actor.token, 'POST', body), 201);
      assert.equal(saved.replayed, false); assert.match(saved.delivery_id, uuid);
      const artifact = exactlyOne(saved.deliveries, row => row.id === saved.delivery_id, 'One concrete delivered version');
      assert.equal(artifact.task_id, record.taskId); assert.equal(artifact.actor_id, record.actor.id);
      assert.equal(artifact.url, body.url); assert.equal(artifact.notes, body.notes);
      assert.equal(artifact.task_revision, body.expected_revision + 1);
      record.artifacts.push({ ...artifact, body });
      const before = await snapshot(), replay = checked(await api(`/tareas-edicion/${record.taskId}/entregas`, record.actor.token, 'POST', body));
      assert.equal(replay.replayed, true); assert.equal(replay.delivery_id, saved.delivery_id); assert.deepEqual(await snapshot(), before);
      record.state = 'en_revision'; await assertViews(); return saved.delivery_id;
    };
    const first = await deliver(1);
    if (employeeOnly) {
      const before = await snapshot();
      checked(await api(`/tareas/${record.taskId}?workspace=render_os`, record.actor.token, 'PATCH', {
        expected_revision: (await task(record)).revision, estado: 'aprobada', expected_entrega_id: first,
      }), 403);
      assert.deepEqual(await snapshot(), before, 'Employee self-approval of the exact current delivery must not write');
    }
    const correctionBody = { request_id: randomUUID(), expected_revision: (await task(record)).revision,
      expected_entrega_id: first, notes: `Correct only the ending of video ${record.videoId}, version one.` };
    const correction = checked(await api(`/tareas-edicion/${record.taskId}/correcciones`, record.reviewer.token, 'POST', correctionBody), 201);
    const decision = exactlyOne(correction.decisions, row => row.id === correction.decision_id, 'Durable correction to exact artifact');
    assert.equal(decision.task_id, record.taskId); assert.equal(decision.actor_id, record.reviewer.id);
    assert.equal(decision.delivery_id, first); assert.equal(decision.action, 'correcciones'); assert.equal(decision.notes, correctionBody.notes);
    assert.equal(decision.task_revision, correctionBody.expected_revision + 1);
    record.decisions.push(decision); record.correctionBody = correctionBody; record.state = 'en_progreso';
    const beforeReplay = await snapshot();
    const replay = checked(await api(`/tareas-edicion/${record.taskId}/correcciones`, record.reviewer.token, 'POST', correctionBody));
    assert.equal(replay.replayed, true); assert.equal(replay.decision_id, decision.id); assert.deepEqual(await snapshot(), beforeReplay);
    await assertViews();
    const second = await deliver(2); assert.notEqual(second, first);
    const beforeStale = await snapshot();
    checked(await api(`/tareas/${record.taskId}?workspace=render_os`, record.reviewer.token, 'PATCH', {
      expected_revision: (await task(record)).revision, estado: 'aprobada', expected_entrega_id: first,
    }), 409); assert.deepEqual(await snapshot(), beforeStale);
    await patch('aprobada', { expected_entrega_id: second }, record.reviewer.token); record.state = 'aprobada';
    const approved = await task(record); assert.equal(approved.propiedades_extra.revision_aprobada, true);
    assert.equal(approved.propiedades_extra.revision_aprobada_entrega_id, second); await assertViews();
    const history = checked(await api(`/tareas-edicion/${record.taskId}/revisiones`, record.actor.token));
    const approval = exactlyOne(history.decisions, row => row.action === 'aprobada', 'Approval is a real decision, not a state-only assertion');
    assert.equal(approval.actor_id, record.reviewer.id); assert.equal(approval.delivery_id, second); assert.equal(approval.notes, '');
    record.decisions.push(approval);
    await patch('finalizada', {}, record.reviewer.token); record.state = 'finalizada'; await assertViews();
  });

  await t.test('fresh sessions recover all versions/decisions and cross-module dates; late exact retries cannot reset completed work', async () => {
    for (const actor of sessionActors) actor.token = await login(actor.usuario);
    // Refresh the reviewer references through the same actor objects above.
    const before = await snapshot();
    for (const record of records) {
      const current = await task(record); assert.equal(current.estado, 'finalizada'); assert.equal(current.asignado_a_id, record.actor.id);
      assert.equal(current.publicacion_id, null); assert.equal(current.historia_id, null);
      assert.equal(current.fecha_vencimiento.slice(0, 10), record.due);
      const deliveries = checked(await api(`/tareas-edicion/${record.taskId}/entregas`, record.actor.token));
      assert.equal(deliveries.deliveries.length, 2);
      for (const artifact of record.artifacts) assert.deepEqual(exactlyOne(deliveries.deliveries, row => row.id === artifact.id, 'Original delivered artifact survives reload'),
        Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'body')));
      const history = checked(await api(`/tareas-edicion/${record.taskId}/revisiones`, record.actor.token));
      assert.equal(history.total, 2); assert.equal(history.truncated, false); assert.equal(history.latest_delivery.id, record.artifacts[1].id);
      assert.deepEqual(history.decisions, record.decisions); assert.equal(history.can_request_corrections, false);
      const sent = checked(await handoff(record, (await visit()).revision)); assert.equal(sent.created, false); assert.equal(sent.task.id, record.taskId);
      const delivered = checked(await api(`/tareas-edicion/${record.taskId}/entregas`, record.actor.token, 'POST', record.artifacts[0].body));
      assert.equal(delivered.replayed, true); assert.equal(delivered.delivery_id, record.artifacts[0].id); assert.equal(delivered.task.estado, 'finalizada');
      const corrected = checked(await api(`/tareas-edicion/${record.taskId}/correcciones`, record.reviewer.token, 'POST', record.correctionBody));
      assert.equal(corrected.replayed, true); assert.equal(corrected.task.estado, 'finalizada');
    }
    await assertViews(); assert.deepEqual(await snapshot(), before, 'Fresh reads and exact retries cannot modify any business/history row');
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM task_editing_deliveries WHERE task_id=ANY($1::int[])', [records.map(row => row.taskId)]))[0].n, 6);
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM task_editing_reviews WHERE task_id=ANY($1::int[])', [records.map(row => row.taskId)]))[0].n, 6);
    await noPublication();
  });
});
