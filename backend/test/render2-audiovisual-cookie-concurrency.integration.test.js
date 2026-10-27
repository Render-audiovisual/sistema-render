import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {access} from 'node:fs/promises';
import {startLocalHarness, assertFixtureIdentity, fixturePassword} from '../scripts/render2-local-test.js';
import {loginProductionCookieSession, productionCookieRequest} from './helpers/production-cookie-session.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function deferred() {
  let resolve;
  const promise = new Promise(yes => {resolve = yes;});
  return {promise, resolve};
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned audiovisual HTTP barrier timed out')), 15000);
    })]);
  } finally {clearTimeout(timer);}
}

// Independent API cookie jars, not native browser windows/devices. All domain
// setup uses principal HTTP except the synthetic client. No external transport.
test('cookie audiovisual concurrency preserves exact artifacts, CAS and independent task identities', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const port = 55962, f = await startLocalHarness({port, browserSessions: true});
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic('Owned audiovisual cookie PG55962/API removed; no native-device/provider claim.');
  });
  const [identity] = await f.query(`SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`);
  assertFixtureIdentity({root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity});
  const actors = [
    {id: 91001, username: 'qa_franco'}, {id: 91002, username: 'qa_agustin'},
    {id: 91003, username: 'qa_luciano'},
  ];
  async function loginAll() {
    for (const actor of actors) {
      actor.session = await loginProductionCookieSession(f.base, actor.username, fixturePassword);
      assert.equal(actor.session.user.id, actor.id);
    }
    assert.equal(new Set(actors.map(actor => actor.session.cookie)).size, 3, 'Separate captured cookie jars');
    assert.equal(new Set(actors.map(actor => actor.session.context)).size, 3, 'Separate context proofs');
  }
  await loginAll();
  const [franco, agustin, luciano] = actors;
  const api = (route, actor = franco, method = 'GET', body) =>
    productionCookieRequest(f.base, `/api${route}`, {session: actor.session, method, body});
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'Unexpected principal HTTP status (headers/credentials/body omitted)');
    return response.body;
  };
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA364 cookie audiovisual client',true) RETURNING id");
  const [clock] = await f.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') today`);
  const month = clock.today.slice(0, 7), day = `${month}-10`;
  const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10);
  let visit = checked(await api('/producciones', franco, 'POST', {
    request_id: randomUUID(), cliente_id: client.id, fecha: day, titulo: 'QA364 ordinary production',
    participante_ids: actors.map(actor => actor.id), drive_url: 'https://example.invalid/qa364/raw',
    observaciones: 'Independent cookie contexts; preserve literal scripts.',
  }), 201).visita;
  assert.match(visit.id, uuid); assert.equal(visit.tarea_origen_id, null);
  const visitId = visit.id, records = [];
  for (const [index, actor] of actors.entries()) {
    const title = `QA364 independent video ${index + 1}`, script = `QA364 script ${index + 1}\nLiteral second line.`;
    visit = checked(await api(`/producciones/${visitId}/videos`, franco, 'POST', {
      expected_revision: visit.revision, titulo: title, guion: script, estado: 'grabado',
      material_url: `https://example.invalid/qa364/raw-${index + 1}`,
    }), 201).visita;
    const video = visit.videos.find(row => row.titulo === title);
    assert.ok(video); assert.match(video.id, uuid); assert.equal(video.guion, script);
    const due = `${month}-${18 + index}`;
    const sent = checked(await api(`/producciones/${visitId}/videos/${video.id}/enviar-edicion`, franco, 'POST', {
      expected_revision: visit.revision, editor_id: actor.id, fecha_entrega: due,
    }), 201);
    assert.equal(sent.created, true); assert.equal(sent.task.asignado_a_id, actor.id);
    visit = sent.visita;
    records.push({actor, videoId: video.id, taskId: sent.task.id, due, title, script});
  }
  assert.equal(new Set(records.map(row => row.taskId)).size, 3);
  const record = records[2], taskId = record.taskId;
  const taskPath = `/tareas/${taskId}?workspace=render_os`;
  const task = async (actor = luciano) => checked(await api(taskPath, actor));
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  async function snapshot() {
    const result = {};
    assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
    for (const table of tables) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/);
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`);
      result[table] = row.hash;
    }
    return result;
  }
  function unchangedExcept(before, after, allowed) {
    for (const table of tables) if (!allowed.includes(table))
      assert.equal(after[table], before[table], `Unexpected mutation in ${table}; only hashes are compared`);
  }
  const siblingIds = records.slice(0, 2).map(row => row.taskId);
  async function siblingSnapshot() {
    const rows = {};
    for (const [table, column] of [['tareas', 'id'], ['tarea_asignaciones', 'tarea_id'],
      ['tarea_comentarios', 'tarea_id'], ['task_editing_deliveries', 'task_id'], ['task_editing_reviews', 'task_id'],
      ['progreso_edicion_entregas', 'tarea_id']]) {
      rows[table] = hash(await f.query(`SELECT to_jsonb(r) value,r.xmin::text xmin,r.ctid::text ctid
        FROM ${table} r WHERE ${column}=ANY($1::int[]) ORDER BY to_jsonb(r)::text,r.ctid::text`, [siblingIds]));
    }
    return rows;
  }
  const setup = await snapshot(), siblings = await siblingSnapshot();
  const deliveries = [], corrections = [];
  const deliveryBody = (revision, label) => ({request_id: randomUUID(), expected_revision: revision,
    url: `https://example.invalid/qa364/${label}`, notes: `Literal QA364 ${label}`});
  const correctionBody = (revision, delivery, label) => ({request_id: randomUUID(), expected_revision: revision,
    expected_entrega_id: delivery, notes: `Literal QA364 correction ${label}`});
  function rememberDelivery(body, result) {
    assert.equal(result.replayed, false); assert.match(result.delivery_id, uuid);
    const row = result.deliveries.find(item => item.id === result.delivery_id);
    assert.ok(row); assert.equal(row.actor_id, luciano.id); assert.equal(row.task_id, taskId);
    assert.equal(row.task_revision, body.expected_revision + 1); assert.equal(row.url, body.url); assert.equal(row.notes, body.notes);
    deliveries.push({row, body}); return row;
  }
  function rememberCorrection(body, result) {
    assert.equal(result.replayed, false); assert.match(result.decision_id, uuid);
    const row = result.decisions.find(item => item.id === result.decision_id);
    assert.ok(row); assert.equal(row.actor_id, agustin.id); assert.equal(row.task_id, taskId);
    assert.equal(row.delivery_id, body.expected_entrega_id); assert.equal(row.action, 'correcciones');
    assert.equal(row.notes, body.notes); assert.equal(row.task_revision, body.expected_revision + 1);
    corrections.push({row, body}); return row;
  }
  let first, currentDelivery, raceLoser, finalRevision, finalHistory;

  await t.test('delayed genuine cookie GET retains its old revision; another actor PATCH makes delivery CAS stale without DML', async () => {
    const ready = deferred(), release = deferred(), captured = luciano.session;
    const held = (async () => {
      let response;
      try {
        response = await fetch(new URL(`/api${taskPath}`, f.base), {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: {Origin: 'http://127.0.0.1:5195', 'Sec-Fetch-Site': 'same-origin', Cookie: captured.cookie,
            'X-Render-Session-Context': captured.context, 'X-Render-CSRF': captured.csrf}});
        assert.equal(response.status, 200); assert.equal(response.headers.get('x-render-session-context'), captured.context);
        const bytes = await response.text();
        ready.resolve(); await release.promise;
        return JSON.parse(bytes); // Genuine completed response; never synthesize a task DTO.
      } catch {throw new Error('Owned delayed cookie task read failed; sensitive response details omitted');}
    })();
    try {
      await bounded(Promise.race([ready.promise, held.then(() => {throw new Error('GET bypassed the response barrier');})]));
      assert.deepEqual(await snapshot(), setup, 'Reading/holding bytes is mutation-free after login/setup baseline');
      const beforeTask = await task(franco);
      const updated = checked(await api(taskPath, franco, 'PATCH', {
        expected_revision: beforeTask.revision, titulo: 'QA364 newer title confirmed by independent owner',
      }));
      assert.equal(updated.revision, beforeTask.revision + 1);
      release.resolve(); const stale = await bounded(held);
      assert.equal(stale.id, taskId); assert.equal(stale.revision, beforeTask.revision);
      assert.notEqual(stale.titulo, updated.titulo);
      const beforeDenial = await snapshot();
      checked(await api(`/tareas-edicion/${taskId}/entregas`, luciano, 'POST', deliveryBody(stale.revision, 'stale')), 409);
      assert.deepEqual(await snapshot(), beforeDenial, 'Rejected old-observation delivery cannot insert a partial artifact/receipt');
    } finally {release.resolve(); await bounded(held);}
  });

  await t.test('fresh V1 then correction versus replacement at the same revision admits exactly one complete transaction', async () => {
    const observed = await task();
    const firstBody = deliveryBody(observed.revision, 'v1');
    first = rememberDelivery(firstBody, checked(await api(`/tareas-edicion/${taskId}/entregas`, luciano, 'POST', firstBody), 201));
    const shared = await task(); assert.equal(shared.estado, 'en_revision'); assert.equal(shared.revision, first.task_revision);
    const correction = correctionBody(shared.revision, first.id, 'race'), replacement = deliveryBody(shared.revision, 'race-replacement');
    const beforeRace = await snapshot();
    const readProgress = () => f.query(`SELECT to_jsonb(p) AS row,p.xmin::text AS xmin,p.ctid::text AS ctid
      FROM progreso_edicion_entregas p ORDER BY p.id`);
    const beforeProgress = await readProgress();
    const priorCredit = beforeProgress.filter(item => String(item.row.tarea_id) === String(taskId));
    assert.equal(priorCredit.length, 1, 'V1 created exactly one canonical task credit before the race');
    // The current writer crosses node-postgres Date (millisecond precision).
    // Assert that exact contract initially, then preserve the literal stored
    // credit timestamp below; no rounding is allowed across the race itself.
    const [firstCreditDate] = await f.query("SELECT to_jsonb(date_trunc('milliseconds',d.recorded_at))#>>'{}' AS exact_date FROM task_editing_deliveries d WHERE id=$1 AND task_id=$2", [first.id, taskId]);
    assert.equal(priorCredit[0].row.entregada_at, firstCreditDate.exact_date, 'Initial credit matches the first delivery at the writer’s explicit Date precision');
    assert.equal(new Date(priorCredit[0].row.entregada_at).toISOString(), first.recorded_at);
    const readNotices = () => f.query(`SELECT to_jsonb(n) AS row,n.xmin::text AS xmin,n.ctid::text AS ctid
      FROM mia_private_task_notifications n ORDER BY n.id`);
    const beforeNotices = await readNotices();
    const go = deferred();
    const run = (route, actor, body) => (async () => {await go.promise; return api(route, actor, 'POST', body);})();
    const correcting = run(`/tareas-edicion/${taskId}/correcciones`, agustin, correction);
    const replacing = run(`/tareas-edicion/${taskId}/entregas`, luciano, replacement);
    go.resolve();
    const [correctionResult, replacementResult] = await bounded(Promise.all([correcting, replacing]));
    assert.deepEqual([correctionResult.status, replacementResult.status].sort((a, b) => a - b), [201, 409]);
    const fresh = await task(); assert.equal(fresh.revision, shared.revision + 1);
    const correctionWon = correctionResult.status === 201;
    if (correctionWon) {
      rememberCorrection(correction, correctionResult.body); assert.equal(fresh.estado, 'en_progreso');
      currentDelivery = first;
      raceLoser = {route: `/tareas-edicion/${taskId}/entregas`, actor: luciano, body: replacement};
    } else {
      currentDelivery = rememberDelivery(replacement, replacementResult.body); assert.equal(fresh.estado, 'en_revision');
      raceLoser = {route: `/tareas-edicion/${taskId}/correcciones`, actor: agustin, body: correction};
    }
    const artifacts = await f.query('SELECT id,actor_id,request_id,task_revision FROM task_editing_deliveries WHERE task_id=$1 ORDER BY task_revision', [taskId]);
    const decisions = await f.query('SELECT id,actor_id,request_id,task_revision FROM task_editing_reviews WHERE task_id=$1 ORDER BY task_revision', [taskId]);
    assert.equal(artifacts.length, correctionWon ? 1 : 2); assert.equal(decisions.length, correctionWon ? 1 : 0);
    assert.deepEqual(artifacts.map(row => row.id), deliveries.map(item => item.row.id));
    assert.deepEqual(decisions.map(row => row.id), corrections.map(item => item.row.id));
    assert.equal(artifacts.some(row => row.request_id === raceLoser.body.request_id), false);
    assert.equal(decisions.some(row => row.request_id === raceLoser.body.request_id), false);
    let afterNotices = await readNotices();
    if (correctionWon) {
      const fingerprint = createHash('sha256').update(JSON.stringify([
        'task-recipient-id-v1',taskId,'correcciones',luciano.id,fresh.revision,correction.notes,
      ])).digest('hex');
      const deadline = Date.now() + 5000;
      while (!afterNotices.some(item => item.row.fingerprint === fingerprint) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve,25)); afterNotices = await readNotices();
      }
      assert.equal(afterNotices.length,beforeNotices.length+1,'Only the winning correction emits a notice');
      for (const prior of beforeNotices) assert.deepEqual(afterNotices.find(item => item.row.id === prior.row.id),prior,
        'Existing notices remain physically unchanged');
      const notice = afterNotices.find(item => item.row.fingerprint === fingerprint)?.row;
      assert.ok(notice,'Committed correction has its ID/version/notes-bound notice');
      assert.equal(String(notice.tarea_id),String(taskId)); assert.equal(notice.motivo,'correcciones');
      assert.equal(notice.detalles.actor_usuario_id,agustin.id);
      assert.equal(notice.detalles.destinatario_usuario_id,luciano.id);
      assert.ok(notice.mensaje.split('\n').includes(correction.notes));
    } else assert.deepEqual(afterNotices,beforeNotices,'Losing correction cannot enqueue');
    const afterProgress = await readProgress();
    assert.equal(afterProgress.length, beforeProgress.length, 'Neither race branch inserts a second operational credit');
    assert.deepEqual(afterProgress.filter(item => String(item.row.tarea_id) !== String(taskId)),
      beforeProgress.filter(item => String(item.row.tarea_id) !== String(taskId)), 'Other task credits remain physically unchanged');
    const credits = afterProgress.filter(item => String(item.row.tarea_id) === String(taskId));
    assert.equal(credits.length, 1);
    const credit = credits[0].row, prior = priorCredit[0].row;
    assert.equal(credit.estado_actual, correctionWon ? 'en_progreso' : 'en_revision');
    assert.equal(credit.estado_actual, fresh.estado);
    assert.equal(credit.task_revision, fresh.revision);
    assert.equal(credit.delivery_id, currentDelivery.id);
    assert.equal(credit.delivery_id, correctionWon ? first.id : artifacts.find(item => item.request_id === replacement.request_id).id);
    assert.equal(String(credit.tarea_id), String(taskId));
    assert.equal(credit.editor_user_id, luciano.id);
    assert.equal(credit.editor_clave, `user:${luciano.id}`);
    assert.equal(credit.origen_registro, 'canonical_delivery');
    assert.equal(credit.entregada_at, firstCreditDate.exact_date, 'Replacement/correction cannot move the original monthly credit');
    assert.equal(credit.activa, !correctionWon);
    if (correctionWon) assert.ok(typeof credit.baja_at === 'string' && Number.isFinite(Date.parse(credit.baja_at)));
    else assert.equal(credit.baja_at, null);
    assert.ok(Number.isFinite(Date.parse(credit.updated_at)) && Date.parse(credit.updated_at) >= Date.parse(prior.updated_at));
    assert.deepEqual(credit, { ...prior, estado_actual: fresh.estado, task_revision: fresh.revision,
      delivery_id: currentDelivery.id, activa: !correctionWon, baja_at: credit.baja_at, updated_at: credit.updated_at },
    'Only exact winning projection fields change; ID, task, editor, title/client, credit date and creation date stay fixed');
    const afterRace = await snapshot();
    unchangedExcept(beforeRace, afterRace, ['tareas', 'task_editing_deliveries', 'task_editing_reviews', 'progreso_edicion_entregas',
      ...(correctionWon ? ['mia_private_task_notifications'] : [])]);
    checked(await api(raceLoser.route, raceLoser.actor, 'POST', raceLoser.body), 409);
    assert.deepEqual(await snapshot(), afterRace);
    assert.deepEqual(await siblingSnapshot(), siblings);
    t.diagnostic(`CAS winner: ${correctionWon ? 'correction' : 'replacement delivery'}; concurrent dispatch, not a claimed pg-lock barrier.`);
  });

  await t.test('fresh correction and resubmission approve only the latest artifact and finalize without publication', async () => {
    let observed = await task();
    if (observed.estado === 'en_revision') {
      const body = correctionBody(observed.revision, currentDelivery.id, 'fresh-after-race');
      rememberCorrection(body, checked(await api(`/tareas-edicion/${taskId}/correcciones`, agustin, 'POST', body), 201));
      observed = await task();
    }
    assert.equal(observed.estado, 'en_progreso');
    const body = deliveryBody(observed.revision, 'corrected-final');
    currentDelivery = rememberDelivery(body, checked(await api(`/tareas-edicion/${taskId}/entregas`, luciano, 'POST', body), 201));
    observed = await task();
    const before = await snapshot();
    checked(await api(taskPath, agustin, 'PATCH', {expected_revision: observed.revision, estado: 'aprobada', expected_entrega_id: first.id}), 409);
    assert.deepEqual(await snapshot(), before, 'Current task revision cannot authorize approval of the superseded artifact');
    const approved = checked(await api(taskPath, agustin, 'PATCH', {
      expected_revision: observed.revision, estado: 'aprobada', expected_entrega_id: currentDelivery.id,
    }));
    assert.equal(approved.revision, observed.revision + 1); assert.equal(approved.estado, 'aprobada');
    assert.equal(approved.propiedades_extra.revision_aprobada_entrega_id, currentDelivery.id);
    const done = checked(await api(taskPath, franco, 'PATCH', {expected_revision: approved.revision, estado: 'finalizada'}));
    assert.equal(done.estado, 'finalizada'); assert.equal(done.revision, approved.revision + 1);
    finalRevision = done.revision;
    const history = checked(await api(`/tareas-edicion/${taskId}/revisiones`, luciano));
    assert.equal(history.total, 2); assert.equal(history.truncated, false);
    assert.equal(history.latest_delivery.id, currentDelivery.id);
    assert.deepEqual(history.decisions.filter(row => row.action === 'correcciones'), corrections.map(item => item.row));
    const approvals = history.decisions.filter(row => row.action === 'aprobada'); assert.equal(approvals.length, 1);
    assert.equal(approvals[0].actor_id, agustin.id); assert.equal(approvals[0].delivery_id, currentDelivery.id);
    assert.equal(approvals[0].task_revision, approved.revision);
    finalHistory = history;
    const after = await snapshot();
    const editorial = ['historias', 'publicaciones', 'editorial_publicacion_eventos', 'editorial_publicacion_versiones',
      'cliente_objetivo_piezas', 'cliente_objetivo_eventos'];
    for (const table of editorial) assert.equal(after[table], setup[table], `No implicit publication/quota evidence in ${table}`);
    assert.deepEqual(await siblingSnapshot(), siblings);
  });

  await t.test('new cookie contexts recover immutable versions/reviews and shared calendar/Home/report projections without writes', async () => {
    // Authentication intentionally precedes this baseline: login abuse/session
    // rows may change on login and are NOT silently excluded from the snapshot.
    await loginAll(); const before = await snapshot();
    for (const actor of actors) {
      const current = await task(actor); assert.equal(current.id, taskId); assert.equal(current.estado, 'finalizada');
      assert.equal(current.revision, finalRevision);
      assert.equal(current.asignado_a_id, luciano.id); assert.equal(current.fecha_vencimiento.slice(0, 10), record.due);
      const artifacts = checked(await api(`/tareas-edicion/${taskId}/entregas`, actor));
      assert.equal(artifacts.deliveries.length, deliveries.length);
      for (const artifact of deliveries) assert.deepEqual(artifacts.deliveries.find(row => row.id === artifact.row.id), artifact.row);
      const history = checked(await api(`/tareas-edicion/${taskId}/revisiones`, actor));
      assert.equal(history.total, 2); assert.equal(history.latest_delivery.id, currentDelivery.id);
      assert.deepEqual(history.decisions, finalHistory.decisions);
      assert.deepEqual(history.latest_delivery, finalHistory.latest_delivery);
      assert.equal(history.task.revision, finalRevision); assert.equal(history.task.estado, 'finalizada');
      const stored = checked(await api(`/producciones/${visitId}`, actor)).visita;
      assert.equal(stored.id, visitId); assert.equal(stored.fecha, day); assert.equal(stored.videos.length, 3);
      for (const linked of records) {
        const video = stored.videos.find(row => row.id === linked.videoId);
        assert.ok(video); assert.equal(video.guion, linked.script); assert.equal(video.tarea_edicion_id, linked.taskId);
        assert.equal(video.editor_actual_id, linked.actor.id); assert.equal(video.fecha_entrega_actual, linked.due);
        assert.equal(video.tarea_estado, linked === record ? 'finalizada' : 'pendiente');
        assert.equal(video.publicacion_id, null);
      }
      const calendar = checked(await api(`/calendario?${new URLSearchParams({desde: `${month}-01`, hasta: nextMonth, scope: 'team', cliente_id: String(client.id)})}`, actor));
      assert.equal(calendar.truncated, false);
      const visitEvents = calendar.events.filter(row => row.key === `visita:visita:${visitId}`);
      assert.equal(visitEvents.length, 1); assert.equal(visitEvents[0].date, day);
      for (const linked of records) {
        const rows = calendar.events.filter(row => row.key === `tarea:tarea:${linked.taskId}`);
        assert.equal(rows.length, 1); assert.equal(rows[0].date, linked.due); assert.deepEqual(rows[0].responsable_ids, [linked.actor.id]);
        assert.equal(rows[0].estado, linked === record ? 'finalizada' : 'pendiente');
      }
      const report = checked(await api(`/reportes/datos?${new URLSearchParams({mes_configuracion: month, desde: `${month}-01`, hasta: nextMonth})}`, actor));
      const shared = report.producciones.visitas.find(row => row.id === visitId);
      assert.ok(shared); assert.equal(shared.videos.length, 3);
      const reported = report.tareasRenderOs.find(row => row.id === taskId);
      assert.ok(reported); assert.equal(reported.estado, 'finalizada');
    }
    const home = checked(await api('/inicio', luciano));
    assert.equal(home.user.id, luciano.id); assert.equal(home.monthly_progress.period, month);
    assert.equal(home.monthly_progress.total, 1); assert.equal(home.monthly_progress.completed, 1);
    assert.equal(home.tasks.some(row => row.id === taskId), false);
    for (const artifact of deliveries) {
      const replay = checked(await api(`/tareas-edicion/${taskId}/entregas`, luciano, 'POST', artifact.body));
      assert.equal(replay.replayed, true); assert.equal(replay.delivery_id, artifact.row.id); assert.equal(replay.task.estado, 'finalizada');
    }
    for (const correction of corrections) {
      const replay = checked(await api(`/tareas-edicion/${taskId}/correcciones`, agustin, 'POST', correction.body));
      assert.equal(replay.replayed, true); assert.equal(replay.decision_id, correction.row.id); assert.equal(replay.task.estado, 'finalizada');
    }
    assert.deepEqual(await snapshot(), before, 'All public tables including auth/session rows unchanged after reads and exact replay');
    assert.deepEqual(await siblingSnapshot(), siblings);
  });
});
