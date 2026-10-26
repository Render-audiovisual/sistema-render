import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);

test('release WhatsApp: real signed private completion, current authority and publication invariance', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const actors = { admin: 'qa-release-owner', editor: 'qa-release-editor' };
  const group = 'qa-release-group';
  const fixture = await startLocalHarness({ port: 55993, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    allowedWhatsappIds: Object.values(actors).join(','), allowedWhatsappGroups: group,
  } });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic('Own isolated WhatsApp fixture stopped and removed. No configured database or provider used.');
  });
  for (const [key, id] of [['admin', 91001], ['editor', 91003]])
    await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=$2', [hash(actors[key]), id]);
  const signed = async (route, body, { actor = actors.admin, groupId = '', method = 'POST' } = {}) => {
    const url = new URL(`/api/integraciones/wilson${route}`, fixture.base);
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID();
    const message = ['v2', timestamp, nonce, 'whatsapp', actor, groupId, 'QA release', method,
      url.pathname + url.search, hash(body === undefined ? '' : stable(body))].join('\n');
    const response = await fetch(url, { method, signal: AbortSignal.timeout(10000), headers: {
      'x-wilson-signature-version': '2', 'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce,
      'x-wilson-channel': 'whatsapp', 'x-wilson-actor-id': actor, 'x-wilson-actor-name': 'QA release',
      'x-wilson-group-id': groupId,
      'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64'),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA release Wilson') RETURNING id");
  const [piece] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,metadata)
    VALUES($1,'video','pendiente','2026-11-01','{"qa_marker":"publication unchanged"}') RETURNING id`, [client.id]);
  const createTask = async (title, state = 'aprobada') => {
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,estado,tipo_tarea,subtipo,propiedades_extra)
      VALUES($1,'Luciano QA',$2,$3,$4,'edicion','video','{"workspace":"render_os"}') RETURNING *`, [title, client.id, piece.id, state]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [task.id]);
    return task;
  };
  const taskState = async id => (await fixture.query('SELECT estado,revision FROM tareas WHERE id=$1', [id]))[0];
  const preview = ids => signed('/lotes/finalizacion/previsualizar', { task_ids: ids });
  const confirm = token => signed('/lotes/finalizacion/confirmar', { confirmacion_token: token });
  const pieceBefore = await fixture.query('SELECT to_jsonb(p) row,xmin::text xmin,ctid::text ctid FROM publicaciones p WHERE id=$1', [piece.id]);

  await t.test('approved batch persists and replay cannot repeat task/audit mutations or publish', async () => {
    const first = await createTask('QA release approved A'), second = await createTask('QA release approved B');
    const resolve = await signed('/tareas/resolver-finalizacion', { referencias: [first.titulo] });
    assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
    const proposal = await preview([second.id, first.id]);
    assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
    assert.equal(typeof proposal.body.confirmacion_token, 'string');
    const result = await confirm(proposal.body.confirmacion_token);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal((await taskState(first.id)).estado, 'finalizada');
    assert.equal((await taskState(second.id)).estado, 'finalizada');
    const after = await fixture.query('SELECT to_jsonb(t) row,xmin::text xmin,ctid::text ctid FROM tareas t WHERE id=ANY($1::int[]) ORDER BY id', [[first.id, second.id]]);
    const replay = await confirm(proposal.body.confirmacion_token);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.deepEqual(await fixture.query('SELECT to_jsonb(t) row,xmin::text xmin,ctid::text ctid FROM tareas t WHERE id=ANY($1::int[]) ORDER BY id', [[first.id, second.id]]), after);
    assert.deepEqual(await fixture.query('SELECT to_jsonb(p) row,xmin::text xmin,ctid::text ctid FROM publicaciones p WHERE id=$1', [piece.id]), pieceBefore);
    const reloaded = await signed(`/tareas/${first.id}`, undefined, { method: 'GET' });
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.task.estado, 'finalizada');
  });
  await t.test('pending work cannot bypass approval and editor cannot acquire owner completion authority', async () => {
    const task = await createTask('QA release pending', 'pendiente');
    assert.equal((await preview([task.id])).status, 409);
    const approved = await createTask('QA release editor cannot close');
    const denied = await signed('/lotes/finalizacion/previsualizar', { task_ids: [approved.id] }, { actor: actors.editor });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal((await taskState(approved.id)).estado, 'aprobada');
  });
  await t.test('group cannot prepare or confirm private completion', async () => {
    const task = await createTask('QA release private only');
    const proposal = await preview([task.id]);
    assert.equal(proposal.status, 201);
    for (const [route, body] of [
      ['/tareas/resolver-finalizacion', { referencias: [task.titulo] }],
      ['/lotes/finalizacion/previsualizar', { task_ids: [task.id] }],
      ['/lotes/finalizacion/confirmar', { confirmacion_token: proposal.body.confirmacion_token }],
    ]) assert.ok([400,403].includes((await signed(route, body, { groupId: group })).status));
    assert.equal((await taskState(task.id)).estado, 'aprobada');
  });
  await t.test('role revocation after preview denies mutation; latest task revision conflicts atomically', async () => {
    const task = await createTask('QA release revoked role');
    const proposal = await preview([task.id]);
    assert.equal(proposal.status, 201);
    await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=91001");
    assert.equal((await confirm(proposal.body.confirmacion_token)).status, 403);
    await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91001");
    assert.equal((await taskState(task.id)).estado, 'aprobada');
    const a = await createTask('QA release atomic A'), b = await createTask('QA release atomic B');
    const batch = await preview([a.id,b.id]);
    assert.equal(batch.status, 201);
    await fixture.query("UPDATE tareas SET titulo=titulo||' changed',updated_at=clock_timestamp() WHERE id=$1", [b.id]);
    assert.equal((await confirm(batch.body.confirmacion_token)).status, 409);
    assert.equal((await taskState(a.id)).estado, 'aprobada');
    assert.equal((await taskState(b.id)).estado, 'aprobada');
  });
  await t.test('concurrent confirmations apply one batch once and preserve publication bytes', async () => {
    const task = await createTask('QA release concurrent');
    const proposal = await preview([task.id]);
    assert.equal(proposal.status, 201);
    const replies = await Promise.all([confirm(proposal.body.confirmacion_token), confirm(proposal.body.confirmacion_token)]);
    assert.deepEqual(replies.map(result => result.status), [200,200], JSON.stringify(replies));
    assert.equal((await taskState(task.id)).estado, 'finalizada');
    assert.deepEqual(await fixture.query('SELECT to_jsonb(p) row,xmin::text xmin,ctid::text ctid FROM publicaciones p WHERE id=$1', [piece.id]), pieceBefore);
  });
  await t.test('expired token, disabled identity and newly trashed work never finalize', async () => {
    const task = await createTask('QA release expiry');
    const proposal = await preview([task.id]);
    assert.equal(proposal.status, 201);
    await fixture.query("UPDATE integracion_confirmaciones SET expires_at=clock_timestamp()-interval '1 second' WHERE token=$1", [proposal.body.confirmacion_token]);
    assert.equal((await confirm(proposal.body.confirmacion_token)).status, 409);
    assert.equal((await taskState(task.id)).estado, 'aprobada');
    const fresh = await preview([task.id]);
    assert.equal(fresh.status, 201);
    await fixture.query('UPDATE usuarios SET whatsapp_habilitado=false WHERE id=91001');
    assert.equal((await confirm(fresh.body.confirmacion_token)).status, 403);
    await fixture.query('UPDATE usuarios SET whatsapp_habilitado=true WHERE id=91001');
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra||'{"papelera_render_os":true}'::jsonb WHERE id=$1`, [task.id]);
    assert.ok([404,409].includes((await confirm(fresh.body.confirmacion_token)).status));
    assert.equal((await taskState(task.id)).estado, 'aprobada');
  });
  await t.test('partial visit dispatch creates one task per recorded video with explicit editor/delivery and safe replay', async () => {
    const login = await request(fixture.base, '/api/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } });
    assert.equal(login.status, 200);
    const api = (route, method = 'GET', body, token = login.body.token) => request(fixture.base, `/api${route}`, { token, method, body });
    let created = await api('/producciones', 'POST', { cliente_id: client.id, fecha: '2026-10-27', titulo: 'QA partial release visit',
      drive_url: 'https://example.invalid/release-material', participante_ids: [91001] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    let visit = created.body.visita;
    for (const [titulo, estado] of [['QA video A','grabado'], ['QA video B','grabado'], ['QA video pending','pendiente']]) {
      const result = await api(`/producciones/${visit.id}/videos`, 'POST', { expected_revision: visit.revision, titulo, estado, guion: `Guion ${titulo}` });
      assert.equal(result.status, 201, JSON.stringify(result.body)); visit = result.body.visita;
    }
    const recorded = visit.videos.filter(video => video.estado === 'grabado');
    const planned = visit.videos.find(video => video.estado === 'pendiente');
    const read = await signed(`/produccion/visitas/${visit.id}/videos`, undefined, { method: 'GET' });
    assert.equal(read.status, 200, JSON.stringify(read.body)); assert.equal(read.body.videos.length, 3);
    const ids = [];
    for (const [index, video] of recorded.entries()) {
      const observed = await api(`/producciones/${visit.id}`); visit = observed.body.visita;
      const intent = { visita_id: visit.id, video_id: video.id, expected_revision: visit.revision,
        editor_id: index === 0 ? 91003 : 91002, fecha_entrega: index === 0 ? '2026-11-02' : '2026-11-04', notificar_asignacion: false };
      const previewed = await signed('/produccion/edicion/previsualizar', intent);
      assert.equal(previewed.status, 201, JSON.stringify(previewed.body));
      assert.equal(previewed.body.summary.notificar_asignacion, false);
      const payload = { ...intent, confirmacion_token: previewed.body.confirmacion_token };
      const attempts = await Promise.all([signed('/produccion/edicion/confirmar', payload), signed('/produccion/edicion/confirmar', payload)]);
      assert.deepEqual(attempts.map(result => result.status).sort(), [200,201], JSON.stringify(attempts));
      const task = attempts.find(result => result.status === 201).body.task;
      ids.push(task.id); assert.equal(task.asignado_a_id, intent.editor_id);
      assert.equal(task.fecha_vencimiento, intent.fecha_entrega);
      assert.equal(task.propiedades_extra.origen_produccion_video_id, video.id);
      const before = await fixture.query('SELECT to_jsonb(t) row,xmin::text xmin,ctid::text ctid FROM tareas t WHERE id=$1', [task.id]);
      const replay = await signed('/produccion/edicion/confirmar', payload);
      assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.task.id, task.id);
      assert.deepEqual(await fixture.query('SELECT to_jsonb(t) row,xmin::text xmin,ctid::text ctid FROM tareas t WHERE id=$1', [task.id]), before);
      assert.equal((await fixture.query("SELECT count(*)::int count FROM tareas WHERE propiedades_extra->>'origen_produccion_video_id'=$1", [video.id]))[0].count, 1);
    }
    assert.equal(new Set(ids).size, 2);
    const after = (await api(`/producciones/${visit.id}`)).body.visita;
    assert.equal(after.fecha, '2026-10-27');
    assert.equal(after.videos.find(video => video.id === planned.id).tarea_edicion_id, null);
    assert.equal(after.videos.find(video => video.id === planned.id).estado, 'pendiente');
    assert.deepEqual(after.videos.map(video => [video.id,video.guion]), visit.videos.map(video => [video.id,video.guion]));
    const invalid = { visita_id: visit.id, video_id: planned.id, expected_revision: after.revision, editor_id: 91003, fecha_entrega: '2026-11-02' };
    assert.equal((await signed('/produccion/edicion/previsualizar', invalid)).status, 409);
    assert.equal((await signed('/produccion/edicion/previsualizar', { ...invalid, video_id: recorded[0].id }, { actor: actors.editor })).status, 403);
    for (const route of ['/tareas/validar', '/tareas', '/confirmaciones']) {
      const rejected = await signed(route, { tarea_origen_id: 123, notificar_asignacion: false });
      assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    }
    // A genuine visit row lock delays the canonical dispatch. Expire the token
    // while it waits, then verify the late claim rolls everything back.
    const added = await api(`/producciones/${visit.id}/videos`, 'POST', { expected_revision: after.revision, titulo: 'QA lock expiry video', estado: 'grabado' });
    assert.equal(added.status, 201);
    const expiryVideo = added.body.visita.videos.find(video => video.titulo === 'QA lock expiry video');
    const expiryIntent = { visita_id: visit.id, video_id: expiryVideo.id, expected_revision: added.body.visita.revision,
      editor_id: 91003, fecha_entrega: '2026-11-08', notificar_asignacion: false };
    const expiryPreview = await signed('/produccion/edicion/previsualizar', expiryIntent);
    assert.equal(expiryPreview.status, 201);
    const blocker = new pg.Client({ host: '127.0.0.1', port: 55993, user: 'render2_fixture', database: 'render2_local_test',
      password: '', ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    let pending;
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      const pid = (await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await blocker.query('SELECT id FROM produccion_visitas WHERE id=$1 FOR UPDATE', [visit.id]);
      pending = signed('/produccion/edicion/confirmar', { ...expiryIntent, confirmacion_token: expiryPreview.body.confirmacion_token });
      const deadline = Date.now() + 4000;
      let observed = false;
      while (Date.now() < deadline) {
        const [blocked] = await fixture.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) blocked', [pid]);
        if (blocked.blocked) { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      assert.equal(observed, true, 'must observe a real lock wait before expiring token');
      await fixture.query("UPDATE integracion_confirmaciones SET expires_at=clock_timestamp()-interval '1 second' WHERE token=$1", [expiryPreview.body.confirmacion_token]);
      await blocker.query('COMMIT');
      const expired = await pending;
      assert.equal(expired.status, 409, JSON.stringify(expired.body));
      assert.equal((await fixture.query('SELECT tarea_edicion_id FROM produccion_videos WHERE id=$1', [expiryVideo.id]))[0].tarea_edicion_id, null);
      assert.equal((await fixture.query('SELECT used_at FROM integracion_confirmaciones WHERE token=$1', [expiryPreview.body.confirmacion_token]))[0].used_at, null);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      await blocker.end();
      if (pending) await pending.catch(() => {});
    }
    assert.deepEqual(await fixture.query('SELECT to_jsonb(p) row,xmin::text xmin,ctid::text ctid FROM publicaciones p WHERE id=$1', [piece.id]), pieceBefore);
  });
});
