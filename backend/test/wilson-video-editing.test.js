import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerWilsonVideoEditingRoutes, normalizeWilsonVideoEditingIntent, assertNoLegacyWilsonEditingSource } from '../src/wilson-video-editing.js';
import { dispatchProductionVideoEditing, createProductionRegistryRouter } from '../src/production-registry.js';

// Actual canonical dispatcher + registered handlers; memory-only transactional
// rows. No listener, PostgreSQL, configured pool, credential, provider or worker.
const visitId = '11111111-1111-4111-8111-111111111111';
const videoId = '22222222-2222-4222-8222-222222222222';
const external = 'qa-video-actor';
const actorHash = createHash('sha256').update(external).digest('hex');
const wilson = { channel: 'whatsapp', actorId: external, actorName: 'Untrusted name', groupId: '', privateChat: true, userId: 7 };
const input = { visita_id: visitId, video_id: videoId, expected_revision: 3, editor_id: 9, fecha_entrega: '2026-11-03' };

function fixture(options = {}) {
  const calls = [], notices = [], routes = new Map(), errors = [];
  const state = { revision: 3, source: null, task: null, tokens: {}, audits: [], assignments: [],
    video: { id: videoId, visita_id: visitId, titulo: 'Video parcial', estado: 'grabado', guion: 'Guion',
      material_url: 'https://example.invalid/material', observaciones: 'QA', video_origen_id: null,
      publicacion_id: null, tarea_entrega_id: null, tarea_edicion_id: null, editor_id: null, fecha_entrega: null },
    clientActive: true, editorActive: true, editorName: 'Editor por ID', actorActive: true, role: 'admin', mapping: true, expired: false };
  let pending, connects = 0, released = [], taskCreates = 0;
  // A fixture lease mutex makes the two-request recovery test deterministic;
  // it does NOT claim to prove physical PostgreSQL lock behavior.
  let queue = Promise.resolve();
  const visit = () => ({ id: visitId, revision: pending.revision, tarea_origen_id: pending.source?.id ?? null,
    cliente_id: 20, cliente_nombre: 'Cliente QA', fecha: '2026-11-01', titulo: 'Visita parcial',
    drive_url: '', participante_ids: [7], ultimo_resultado: null });
  const observation = () => ({ visita_id: visitId, revision: pending.revision, cliente_id: 20, cliente_nombre: 'Cliente QA',
    cliente_activo: pending.clientActive, tarea_origen_id: pending.source?.id ?? null, drive_url: '', video_id: videoId,
    video_estado: pending.video.estado, video_titulo: pending.video.titulo, guion: pending.video.guion,
    material_url: pending.video.material_url, video_origen_id: null, publicacion_id: null, tarea_entrega_id: null,
    tarea_edicion_id: pending.video.tarea_edicion_id, editor_id: pending.video.editor_id, fecha_entrega: pending.video.fecha_entrega,
    source: pending.source, task: pending.task && { ...pending.task, owner_id: pending.assignments[0]?.usuario_id ?? null } });
  async function query(raw, p = []) {
    const sql = raw.replace(/\s+/g, ' ').trim(); calls.push({ sql, params: structuredClone(p) });
    if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') { pending = structuredClone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { pending = undefined; if (options.rollbackFails) throw new Error('QA rollback'); return { rows: [] }; }
    if (sql === 'COMMIT') { if (options.commitFails) throw new Error('QA commit'); Object.assign(state, pending); pending = undefined; return { rows: [] }; }
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash')) return { rows: [{ id: 7, usuario: 'qa', nombre: 'Admin actual', rol: pending.role, activo: pending.actorActive, whatsapp_habilitado: true, whatsapp_id_hash: actorHash }] };
    if (sql.startsWith('SELECT actor_hash,usuario_id,enabled')) return { rows: [] };
    if (sql.startsWith('SELECT u.id FROM usuarios u WHERE u.whatsapp_habilitado')) return { rows: pending.mapping ? [{ id: 7 }] : [] };
    if (sql.startsWith('SELECT v.id AS visita_id')) return { rows: p[0] === visitId && p[1] === videoId ? [structuredClone(observation())] : [] };
    if (sql.startsWith('SELECT id,nombre,rol FROM usuarios WHERE id=$1')) return { rows: pending.editorActive ? [{ id: 9, nombre: pending.editorName, rol: 'edicion' }] : [] };
    if (sql.startsWith('INSERT INTO integracion_confirmaciones')) {
      pending.tokens[p[0]] = { payload: JSON.parse(p[5]), payload_hash: p[4], actor: p[1], group: p[2], operation: p[3], used_at: null };
      return { rows: [{ expires_at: '2026-11-01T12:15:00Z' }] };
    }
    if (sql.startsWith('SELECT payload,payload_hash,used_at')) {
      const token = pending.tokens[p[0]];
      return { rows: token && token.actor === p[1] && token.group === p[2] && token.operation === p[3] ? [structuredClone(token)] : [] };
    }
    if (sql.startsWith('UPDATE integracion_confirmaciones SET used_at')) {
      assert.match(sql, /expires_at>clock_timestamp\(\)/);
      const token = pending.tokens[p[0]];
      if (!token || token.used_at || pending.expired) return { rows: [] };
      token.used_at = '2026-11-01T12:02:00Z'; return { rows: [{ token: p[0] }] };
    }
    if (sql.startsWith('UPDATE integracion_confirmaciones SET payload')) { Object.assign(pending.tokens[p[0]].payload, JSON.parse(p[1])); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO integracion_auditoria')) { if (options.auditFails) throw new Error('QA audit'); pending.audits.push(p); return { rows: [] }; }
    if (sql.startsWith('SELECT v.id,v.revision,v.cliente_id,c.nombre AS cliente_nombre,c.activo')) throw new Error('Unexpected observation variant');
    if (sql.startsWith('SELECT v.id,v.revision,v.cliente_id,c.nombre AS cliente_nombre,')) return { rows: [{ id: visitId, revision: pending.revision, cliente_id: 20, cliente_nombre: 'Cliente QA', video_id: videoId, titulo: pending.video.titulo, estado: pending.video.estado }] };
    if (sql.startsWith('SELECT tarea_origen_id FROM produccion_visitas')) return { rows: [{ tarea_origen_id: pending.source?.id ?? null }] };
    if (sql.startsWith('SELECT a.tarea_edicion_id FROM produccion_edicion_adopciones')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM tareas WHERE id=ANY')) return { rows: p[0].map(id => ({ id })) };
    if (sql.startsWith('SELECT * FROM tareas WHERE id=$1')) return { rows: pending.source ? [structuredClone(pending.source)] : [] };
    if (sql.startsWith('SELECT v.id,v.tarea_origen_id')) return { rows: [visit()] };
    if (sql.startsWith('SELECT pv.id,pv.visita_id')) {
      if (options.expireAtVideoLock && sql.includes('FOR UPDATE')) pending.expired = true;
      return { rows: [structuredClone(pending.video)] };
    }
    if (sql.startsWith('SELECT id,visita_id,tipo,estado,drive_url')) return { rows: [] };
    if (sql.startsWith('SELECT id,nombre,rol FROM usuarios WHERE id=ANY')) return { rows: [{ id: 9, nombre: pending.editorName, rol: 'edicion' }] };
    if (sql.startsWith('SELECT id FROM tareas WHERE propiedades_extra')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM produccion_reconciliaciones')) return { rows: [] };
    if (sql.startsWith('SELECT l.id,l.visita_id,l.tarea_origen_id') || sql.startsWith('SELECT r.source_history_hash')) return { rows: [] };
    if (sql.startsWith('INSERT INTO tareas(')) {
      taskCreates++;
      pending.task = { id: 80, revision: 1, titulo: p[0], asignado_a: p[1], cliente_id: p[2], estado: 'pendiente', tipo_tarea: 'edicion', subtipo: 'video', fecha_vencimiento: p[3], material_referencia: p[4], aclaraciones: p[5], propiedades_extra: JSON.parse(p[6]) };
      return { rows: [structuredClone(pending.task)] };
    }
    if (sql.startsWith('DELETE FROM tarea_asignaciones')) { pending.assignments = []; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO tarea_asignaciones')) { pending.assignments = p[1].map((id, i) => ({ tarea_id: p[0], usuario_id: id, tipo: p[2][i] })); return { rows: [] }; }
    if (sql.startsWith('SELECT tarea_id, usuario_id, tipo FROM tarea_asignaciones')) return { rows: structuredClone(pending.assignments) };
    if (sql.startsWith('UPDATE produccion_videos SET tarea_edicion_id')) { Object.assign(pending.video, { tarea_edicion_id: p[2], editor_id: p[3], fecha_entrega: p[4] }); return { rows: [] }; }
    if (sql.startsWith('UPDATE produccion_visitas SET revision=revision+1')) { pending.revision++; return { rows: [] }; }
    if (sql.startsWith('SELECT t.*,to_char(t.fecha_vencimiento')) return { rows: pending.task ? [structuredClone(pending.task)] : [] };
    throw new Error(`Unexpected QA query: ${sql}`);
  }
  const pool = { query, async connect() {
    connects++; const previous = queue; let unlock; queue = new Promise(resolve => { unlock = resolve; }); await previous;
    return { query, release(error) { released.push(error); unlock(); } };
  } };
  const router = { get(path, fn) { routes.set(`GET ${path}`, fn); }, post(path, fn) { routes.set(`POST ${path}`, fn); } };
  registerWilsonVideoEditingRoutes(router, { pool, dispatchProductionVideoEditing: options.dispatch ?? dispatchProductionVideoEditing,
    notifyAssignment: async value => { assert.ok(pending === undefined, 'Notify only after COMMIT'); notices.push(value); if (options.notifyFails) throw new Error('QA notifier'); } });
  async function invoke(path, body, identity = wilson, params = {}) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await routes.get(path)({ body, wilson: identity, params }, res, error => { errors.push(error); }); return res;
  }
  const preview = (body = input) => invoke('POST /produccion/edicion/previsualizar', body);
  const confirm = (token, body = input, identity = wilson) => invoke('POST /produccion/edicion/confirmar', { ...body, confirmacion_token: token }, identity);
  return { state, pool, calls, notices, errors, invoke, preview, confirm, get connects() { return connects; }, get released() { return released; }, get creates() { return taskCreates; } };
}

test('closed per-video intent requires explicit IDs/revision/date and binds notification default', () => {
  assert.equal(normalizeWilsonVideoEditingIntent(input).notificar_asignacion, true);
  assert.equal(normalizeWilsonVideoEditingIntent({ ...input, notificar_asignacion: false }).notificar_asignacion, false);
  for (const patch of [{ editor_id: '9' }, { expected_revision: 0 }, { fecha_entrega: '2026-02-30' }, { titulo: 'Override' }, { notificar_asignacion: 0 }, { permitir_duplicado: true }, { material: 'https://other.invalid' }]) assert.throws(() => normalizeWilsonVideoEditingIntent({ ...input, ...patch }), { status: 400 });
});

test('legacy aliases including nested generic confirmation fail with reconciliation instruction', () => {
  for (const key of ['tarea_origen_id', 'tarea_padre_id', 'origen_visita_parcial_id']) for (const body of [{ [key]: 50, notificar_asignacion: false }, { payload: { [key]: null } }]) assert.throws(() => assertNoLegacyWilsonEditingSource(body), { status: 409, code: 'WILSON_VIDEO_RECONCILIATION_REQUIRED' });
  assert.throws(() => normalizeWilsonVideoEditingIntent({ ...input, video_id: undefined }), { status: 409 });
});

test('registration is inert for read-only pools; missing transactional lease fails only on invocation', async () => {
  const routes = {}; registerWilsonVideoEditingRoutes({ get() {}, post(path, fn) { routes[path] = fn; } }, { pool: { query() {} }, dispatchProductionVideoEditing });
  let error; await routes['/produccion/edicion/previsualizar']({ body: input, wilson }, {}, e => { error = e; });
  assert.match(error.message, /pool.connect/);
});

test('preview summarizes exact canonical video/editor/date/material/notification without creating work', async () => {
  const f = fixture(), res = await f.preview();
  assert.equal(res.statusCode, 201); assert.equal(res.body.summary.video, 'Video parcial');
  assert.equal(res.body.summary.editor, 'Editor por ID'); assert.equal(res.body.summary.notificar_asignacion, true);
  assert.equal(f.creates, 0); assert.equal(f.state.revision, 3); assert.equal(f.notices.length, 0);
  assert.equal(Object.keys(f.state.tokens).length, 1); assert.deepEqual(f.errors, []);
});

test('actual canonical partial-video dispatch creates one ID-assigned task, canonical title, then safe replay', async () => {
  const f = fixture(), p = await f.preview(); const token = p.body.confirmacion_token;
  const res = await f.confirm(token);
  assert.deepEqual(f.errors, []); assert.equal(res.statusCode, 201);
  assert.equal(res.body.task.titulo, 'Cliente QA | Edición | Video parcial'); assert.equal(res.body.task.asignado_a_id, 9);
  assert.equal(f.state.task.propiedades_extra.origen_produccion_video_id, videoId);
  assert.equal(f.state.revision, 4); assert.equal(f.state.task.estado, 'pendiente');
  assert.equal(f.notices.length, 1); assert.equal(f.notices[0].actorId, 7); assert.equal(f.notices[0].actor, 'Admin actual');
  const again = await f.confirm(token);
  assert.deepEqual(f.errors, []); assert.equal(again.statusCode, 200); assert.equal(again.body.idempotent, true);
  assert.equal(f.creates, 1); assert.equal(f.state.audits.length, 1); assert.equal(f.notices.length, 1);
  const locks = f.calls.filter(c => c.sql.startsWith('SELECT id FROM tareas WHERE id=ANY'));
  assert.deepEqual(locks.at(-1).params, [[80]], 'Replay retains linked editing task lock');
});

test('partial source with larger planned count is preserved; source/editing locks precede replay hook', async () => {
  const f = fixture();
  f.state.source = { id: 50, revision: 2, cliente_id: 20, titulo: 'Visita parcial QA', tipo_tarea: 'produccion',
    estado: 'en_progreso', propiedades_extra: { workspace: 'render_os', produccion_videos_previstos: 3 } };
  const before = structuredClone(f.state.source), p = await f.preview(), token = p.body.confirmacion_token;
  assert.equal((await f.confirm(token)).statusCode, 201); assert.deepEqual(f.state.source, before);
  const start = f.calls.length;
  assert.equal((await f.confirm(token)).statusCode, 200); assert.deepEqual(f.state.source, before);
  const replay = f.calls.slice(start);
  const taskLock = replay.findIndex(c => c.sql.startsWith('SELECT id FROM tareas WHERE id=ANY'));
  const visitLock = replay.findIndex(c => c.sql.includes('FOR UPDATE OF v'));
  const videoLock = replay.findIndex(c => c.sql.includes('FOR UPDATE OF pv'));
  const guardedObservation = replay.findIndex(c => c.sql.startsWith('SELECT v.id AS visita_id'));
  assert.deepEqual(replay[taskLock].params, [[50, 80]]);
  assert.ok(taskLock < visitLock && visitLock < videoLock && videoLock < guardedObservation);
  assert.equal(f.state.task.historia_id, undefined); assert.equal(f.state.task.publicacion_id, undefined);
  assert.equal(f.calls.filter(c => /^(UPDATE|INSERT INTO) (publicaciones|historias)/.test(c.sql)).length, 0);
  assert.deepEqual(f.errors, []);
});

test('wrong video/visit cannot be substituted and reused preview cannot retarget editor/date', async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token;
  for (const patch of [{ video_id: visitId }, { visita_id: videoId }, { editor_id: 10 }, { fecha_entrega: '2026-11-04' }]) {
    assert.equal((await f.confirm(token, { ...input, ...patch })).statusCode, 409);
  }
  assert.equal(f.creates, 0); assert.equal(f.state.tokens[token].used_at, null);
});

test('second preview token cannot create a sibling after the first confirmed dispatch', async () => {
  const f = fixture(), first = await f.preview(), second = await f.preview();
  assert.equal((await f.confirm(first.body.confirmacion_token)).statusCode, 201);
  assert.equal((await f.confirm(second.body.confirmacion_token)).statusCode, 409);
  assert.equal(f.creates, 1); assert.equal(f.state.tokens[second.body.confirmacion_token].used_at, null);
});

test('two concurrent confirmations recover one committed result without repeated notice (memory lease)', async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token;
  const results = await Promise.all([f.confirm(token), f.confirm(token)]);
  assert.deepEqual(f.errors, []); assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 201]);
  assert.equal(f.creates, 1); assert.equal(f.notices.length, 1);
});

test('false notification flag is honored and changing it invalidates confirmation', async () => {
  const f = fixture(), body = { ...input, notificar_asignacion: false }, p = await f.preview(body);
  assert.equal((await f.confirm(p.body.confirmacion_token)).statusCode, 409);
  assert.equal((await f.confirm(p.body.confirmacion_token, body)).statusCode, 201);
  assert.equal(f.notices.length, 0);
});

for (const [name, change] of [
  ['inactive identity', s => { s.actorActive = false; }], ['demoted admin', s => { s.role = 'edicion'; }],
  ['revoked identity mapping', s => { s.mapping = false; }], ['inactive editor', s => { s.editorActive = false; }],
  ['changed editor label', s => { s.editorName = 'Renamed'; }], ['inactive client', s => { s.clientActive = false; }],
  ['material drift', s => { s.video.material_url = 'https://example.invalid/changed'; }],
  ['unrecorded video', s => { s.video.estado = 'pendiente'; }], ['visit revision drift', s => { s.revision++; }],
]) test(`confirmation rejects ${name} without creating or consuming`, async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token; change(f.state);
  const result = await f.confirm(token);
  assert.ok([403, 409].includes(result.statusCode), JSON.stringify({ result, errors: f.errors.map(e => e.message) }));
  assert.equal(f.creates, 0); assert.equal(f.state.tokens[token].used_at, null); assert.equal(f.notices.length, 0);
});

test('fresh clock token claim rejects expiry after canonical video-lock wait', async () => {
  const f = fixture({ expireAtVideoLock: true }), p = await f.preview(), token = p.body.confirmacion_token;
  assert.equal((await f.confirm(token)).statusCode, 409); assert.equal(f.creates, 0); assert.equal(f.state.tokens[token].used_at, null);
});

test('wrong conversation/actor, groups and system actors do not obtain confirmation authority', async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token;
  assert.equal((await f.confirm(token, input, { ...wilson, groupId: 'other-private' })).statusCode, 409);
  for (const extra of [{ privateChat: false }, { systemActor: true }, { channel: 'telegram' }, { userId: null }]) assert.equal((await f.confirm(token, input, { ...wilson, ...extra })).statusCode, 403);
  assert.equal(f.creates, 0);
});

test('trashed/cross-client or aggregate source cannot become a sibling editing task', async () => {
  for (const mutation of [s => { s.propiedades_extra.papelera_render_os = true; }, s => { s.cliente_id = 21; }, s => { s.propiedades_extra.produccion_registros = [{ cantidad: 2 }]; }]) {
    const f = fixture(); f.state.source = { id: 50, revision: 1, cliente_id: 20, titulo: 'Visita QA', tipo_tarea: 'produccion', propiedades_extra: { workspace: 'render_os' } };
    mutation(f.state.source); const res = await f.preview();
    assert.equal(res.statusCode, 409, JSON.stringify(f.errors)); assert.equal(f.creates, 0);
  }
});

test('changed replay task client/material/trash/owner/lineage rejects without duplicate or notice', async () => {
  for (const mutation of [t => { t.cliente_id = 21; }, t => { t.material_referencia = 'https://other.invalid'; },
    t => { t.propiedades_extra.papelera_render_os = true; }, t => { t.propiedades_extra.origen_produccion_video_id = visitId; }]) {
    const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token; await f.confirm(token);
    mutation(f.state.task); assert.equal((await f.confirm(token)).statusCode, 409); assert.equal(f.creates, 1); assert.equal(f.notices.length, 1);
  }
});

test('audit/commit failure rolls back task, token, assignment and notice', async () => {
  for (const options of [{ auditFails: true }, { commitFails: true }]) {
    const f = fixture(options);
    // Create preview with success; inject failures only on confirmation by
    // using a separate fixture cannot retain tokens, so toggle the shared option.
    const failure = { ...options }; Object.assign(options, { auditFails: false, commitFails: false });
    const p = await f.preview(), token = p.body.confirmacion_token; Object.assign(options, failure);
    await f.confirm(token); assert.equal(f.errors.length, 1); assert.equal(f.state.task, null);
    assert.equal(f.state.tokens[token].used_at, null); assert.equal(f.state.assignments.length, 0); assert.equal(f.notices.length, 0);
  }
});

test('failed rollback discards lease while preserving primary error', async () => {
  const options = {}, f = fixture(options), p = await f.preview();
  Object.assign(options, { auditFails: true, rollbackFails: true });
  await f.confirm(p.body.confirmacion_token);
  assert.match(f.errors[0].message, /QA audit/); assert.match(f.released.at(-1).message, /QA rollback/);
  assert.equal(f.state.task, null); assert.equal(f.state.tokens[p.body.confirmacion_token].used_at, null);
});

test('notifier failure after commit preserves successful ACK and replay never resends', async () => {
  const f = fixture({ notifyFails: true }), p = await f.preview(), token = p.body.confirmacion_token;
  assert.equal((await f.confirm(token)).statusCode, 201); assert.equal((await f.confirm(token)).statusCode, 200);
  assert.equal(f.notices.length, 1); assert.equal(f.state.task.id, 80); assert.deepEqual(f.errors, []);
});

test('dispatcher without retained-lock callback fails closed and rolls back', async () => {
  const f = fixture({ dispatch: async () => ({ created: true, task: { id: 80 } }) }), p = await f.preview();
  assert.equal((await f.confirm(p.body.confirmacion_token)).statusCode, 500); assert.equal(f.state.task, null);
});

test('discovery returns canonical identity/revision without creating work', async () => {
  const f = fixture(), res = await f.invoke('GET /produccion/visitas/:visitaId/videos', undefined, wilson, { visitaId: visitId });
  assert.deepEqual(f.errors, []); assert.equal(res.body.expected_revision, 3); assert.equal(res.body.videos[0].video_id, videoId); assert.equal(f.creates, 0);
});

test('web endpoint retains existing closed body/authority transaction and calls shared dispatcher', async () => {
  const f = fixture();
  const source = readFileSync(new URL('../src/production-registry.js', import.meta.url), 'utf8');
  const route = source.slice(source.indexOf("router.post('/:id/videos/:videoId/enviar-edicion'"));
  assert.match(route, /transaction\(pool,req.auth,true,db=>dispatchProductionVideoEditing/);
  assert.match(route, /keys\(req.body,\['expected_revision','editor_id','fecha_entrega'\]\)/);
  const collected = new Map(); const router = { use() {}, get() {}, patch() {}, post(path, fn) { collected.set(path, fn); } };
  createProductionRegistryRouter({ express: { Router: () => router }, pool: f.pool });
  const handler = collected.get('/:id/videos/:videoId/enviar-edicion');
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  // Separate productionAuthority actor query, same transaction adapter.
  const originalConnect = f.pool.connect;
  f.pool.connect = async () => { const db = await originalConnect(); const q = db.query; db.query = (sql, params) => sql === 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE'
    ? Promise.resolve({ rows: [{ id: 7, rol: 'admin', activo: true, session_version: 2 }] }) : q(sql, params); return db; };
  await handler({ auth: { id: 7, rol: 'admin', session_version: 2 }, params: { id: visitId, videoId }, body: { expected_revision: 3, editor_id: 9, fecha_entrega: '2026-11-03' } }, res, e => f.errors.push(e));
  assert.deepEqual(f.errors, []); assert.equal(res.statusCode, 201); assert.equal(res.body.task.titulo, 'Cliente QA | Edición | Video parcial'); assert.equal(f.creates, 1);
});
