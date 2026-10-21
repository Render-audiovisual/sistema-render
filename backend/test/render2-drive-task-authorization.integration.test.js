import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { access } from 'node:fs/promises';
import { startDriveHttpFixture } from './helpers/drive-http-fixture.js';

// Actual Drive Express routers + actual JWT/current-DB authentication and fresh
// PostgreSQL. Only the injected provider is simulated; no cloud fetch occurs.
test('Drive HTTP authority is current at every upload/replacement/OAuth step; replays never duplicate attachments', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const calls = [], sessions = new Map(), states = [];
  let sequence = 0, chunkFailure = false, trashFailure = false, exchangeFailure = false;
  const folder = { id: 'qa104_parent_12345', name: 'RENDER_UPLOADS', mimeType: 'application/vnd.google-apps.folder' };
  const duplicate = { id: 'qa104_old_file', name: 'replace.bin', mimeType: 'application/octet-stream', webViewLink: 'https://example.invalid/old-file' };
  const providerFactory = async ({ db, signal }) => {
    assert.equal(typeof db?.query, 'function'); assert.ok(signal instanceof AbortSignal);
    return {
      async status() { calls.push({ kind: 'status' }); return { configured: true, connected: true, reconnectRequired: false }; },
      async listChildren(parentId, { query = '', foldersOnly = false } = {}) {
        calls.push({ kind: 'list', parentId });
        return { files: foldersOnly ? [folder] : query === duplicate.name ? [duplicate] : [] };
      },
      async startUpload(input) {
        calls.push({ kind: 'start' });
        const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?upload_id=qa104-${++sequence}`;
        sessions.set(uploadUrl, { ...input, fileId: `qa104_file_${sequence}` }); return { uploadUrl };
      },
      async uploadChunk({ uploadUrl, bytes, contentRange }) {
        calls.push({ kind: 'chunk' });
        assert.ok(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array);
        if (chunkFailure) throw new Error('QA104 synthetic uncertain provider outcome');
        const upload = sessions.get(uploadUrl); assert.ok(upload, 'Only this fake provider owns the upload');
        const range = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(contentRange); assert.ok(range);
        if (Number(range[2]) < Number(range[3]) - 1) return { status: 308, received: `bytes=0-${range[2]}` };
        return { status: 200, file: { id: upload.fileId, name: upload.name, mimeType: upload.mimeType,
          size: String(upload.size), parents: [upload.parentId], webViewLink: `https://example.invalid/${upload.fileId}` } };
      },
      async trashFile(id) { calls.push({ kind: 'trash', id }); if (trashFailure) throw new Error('QA104 synthetic uncertain trash'); },
      async generateAuthUrl(state) { calls.push({ kind: 'auth-url' }); states.push(state); return `https://example.invalid/oauth?state=${encodeURIComponent(state)}`; },
      async exchangeCode() { calls.push({ kind: 'exchange' }); if (exchangeFailure) throw new Error('QA104 synthetic uncertain exchange'); return { refresh_token: 'QA104_SYNTHETIC_REFRESH_NOT_REAL' }; },
    };
  };
  const f = await startDriveHttpFixture({ port: 55738, driveRouterOptions: { providerFactory, providerTimeoutMs: 15000 } });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const ok = (result, status = 200) => { assert.equal(result.status, status, 'Unexpected Drive HTTP status'); return result.body; };
  const admin = await f.tokenFor(91001), owner = await f.tokenFor(91003), outsider = await f.tokenFor(91004);
  let otherAdmin = await f.tokenFor(91002);
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA104 Drive task client',true) RETURNING id");
  const seed = async (actorId = 91003) => {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,material_referencia,propiedades_extra)
      VALUES ('QA104 upload task','QA104 historical display name',$1,'pendiente','edicion','',
      '{"workspace":"render_os","preserve":{"value":"QA104"}}'::jsonb) RETURNING id`, [client.id]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, actorId]); return row;
  };
  const tasks = async () => f.query('SELECT * FROM tareas ORDER BY id');
  const assignments = async () => f.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id');
  const config = async () => f.query("SELECT * FROM integraciones_sistema WHERE clave='google_drive'");
  const intents = () => f.query('SELECT * FROM drive_upload_intents ORDER BY id');
  const nonces = () => f.query('SELECT * FROM drive_oauth_nonces ORDER BY id');
  const start = (task, token = owner, extra = {}) => f.api('/uploads', { token, method: 'POST', body: {
    name: 'qa104.bin', mimeType: 'application/octet-stream', size: 4, parentId: folder.id, taskId: task.id, ...extra,
  } });
  const ticket = response => { const value = ok(response, 201); assert.equal(typeof value.token, 'string'); return value.token; };
  const chunk = (uploadToken, token = owner, range = 'bytes 0-3/4', bytes = Buffer.from('test')) => f.api(`/uploads/${encodeURIComponent(uploadToken)}`, {
    token, method: 'PUT', raw: true, body: bytes, range,
  });
  const denyWithoutEffects = async (operation, expected) => {
    const before = await tasks(), beforeAssignments = await assignments(), beforeIntents = await intents(), count = calls.length;
    ok(await operation(), expected);
    assert.equal(calls.length, count, 'Denied request must not invoke any provider operation');
    assert.deepEqual(await tasks(), before); assert.deepEqual(await assignments(), beforeAssignments); assert.deepEqual(await intents(), beforeIntents);
  };

  await t.test('other task start/plan denied; display-name homonym never substitutes for assigned ID', async () => {
    const task = await seed();
    await f.query("UPDATE usuarios SET nombre='QA104 historical display name' WHERE id=91004");
    await denyWithoutEffects(() => start(task, outsider), 403);
    await denyWithoutEffects(() => f.api(`/upload-plan?task_id=${task.id}`, { token: outsider }), 403);
    await denyWithoutEffects(() => start(task, null), 401);
    const planned = ok(await f.api(`/upload-plan?task_id=${task.id}`, { token: owner }));
    assert.equal(planned.status, 'resolved'); assert.equal(planned.folder.id, folder.id);
  });

  await t.test('upload ticket belongs to exact current actor; even another admin cannot consume it', async () => {
    const task = await seed(), upload = ticket(await start(task));
    await denyWithoutEffects(() => chunk(upload, outsider), 401);
    await denyWithoutEffects(() => chunk(upload, admin), 401);
    ok(await chunk(upload));
    const [saved] = await f.query('SELECT propiedades_extra FROM tareas WHERE id=$1', [task.id]);
    assert.equal(saved.propiedades_extra.drive_archivos.length, 1);
  });

  await t.test('live owner removal blocks chunk before provider; renamed actual owner remains authorized', async () => {
    const task = await seed(), upload = ticket(await start(task));
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003', [task.id]);
    await denyWithoutEffects(() => chunk(upload), 403);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [task.id]);
    await f.query("UPDATE usuarios SET nombre='QA104 renamed actual owner' WHERE id=91003");
    ok(await chunk(upload));
  });

  await t.test('revoked and inactive sessions deny start and chunk; new epoch cannot inherit old upload ticket', async () => {
    const task = await seed(91002), upload = ticket(await start(task, otherAdmin));
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    await denyWithoutEffects(() => start(task, otherAdmin), 401);
    await denyWithoutEffects(() => chunk(upload, otherAdmin), 401);
    otherAdmin = await f.tokenFor(91002);
    await denyWithoutEffects(() => chunk(upload, otherAdmin), 401);
    const freshUpload = ticket(await start(task, otherAdmin));
    await f.query('UPDATE usuarios SET activo=false WHERE id=91002');
    try { await denyWithoutEffects(() => chunk(freshUpload, otherAdmin), 401); }
    finally { await f.query('UPDATE usuarios SET activo=true WHERE id=91002'); }
  });

  await t.test('replacement requires current admin on start and completion; no trash happens after role loss', async () => {
    const task = await seed();
    await denyWithoutEffects(() => start(task, owner, { name: duplicate.name, duplicateAction: 'replace' }), 403);
    const replacementTask = await seed(91002);
    const upload = ticket(await start(replacementTask, otherAdmin, { name: duplicate.name, duplicateAction: 'replace' }));
    await f.query("UPDATE usuarios SET rol='edicion' WHERE id=91002");
    try {
      await denyWithoutEffects(() => chunk(upload, otherAdmin), 403);
      await denyWithoutEffects(() => start(replacementTask, otherAdmin, { name: duplicate.name, duplicateAction: 'replace' }), 403);
    } finally { await f.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    otherAdmin = await f.tokenFor(91002);
  });

  await t.test('308 then completion and identical final chunk replay attach exactly once without rewriting task again', async () => {
    const task = await seed(), before = (await tasks()).find(row => row.id === task.id), upload = ticket(await start(task));
    const partial = ok(await chunk(upload, owner, 'bytes 0-1/4', Buffer.from('te')), 202);
    const count = calls.length, partialLedger = await intents();
    assert.deepEqual(ok(await chunk(upload, owner, 'bytes 0-1/4', Buffer.from('te')), 202), partial);
    assert.equal(calls.length, count, 'Identical partial chunk returns cached308-derived202 without provider redispatch');
    assert.deepEqual(await intents(), partialLedger);
    ok(await chunk(upload, owner, 'bytes 0-1/4', Buffer.from('xx')), 409);
    assert.equal(calls.length, count, 'Same range with different bytes cannot overwrite acknowledged bytes');
    const intermediate = (await tasks()).find(row => row.id === task.id); assert.deepEqual(intermediate, before);
    const file = ok(await chunk(upload, owner, 'bytes 2-3/4', Buffer.from('st')));
    assert.equal(typeof file.id, 'string');
    const after = await tasks();
    assert.deepEqual(ok(await chunk(upload, owner, 'bytes 2-3/4', Buffer.from('st'))), file);
    assert.deepEqual(await tasks(), after);
    const saved = after.find(row => row.id === task.id);
    assert.equal(saved.propiedades_extra.drive_archivos.length, 1);
    assert.equal(saved.propiedades_extra.drive_archivos[0].id, file.id);
    assert.deepEqual(saved.propiedades_extra.preserve, before.propiedades_extra.preserve);
    assert.equal(saved.estado, before.estado); assert.equal(saved.cliente_id, before.cliente_id);
  });

  await t.test('replacement completion replay does not trash twice or duplicate attachment', async () => {
    const task = await seed(91002), upload = ticket(await start(task, otherAdmin, { name: duplicate.name, duplicateAction: 'replace' }));
    const trashBefore = calls.filter(row => row.kind === 'trash').length;
    const result = ok(await chunk(upload, otherAdmin)); const after = await tasks();
    assert.deepEqual(ok(await chunk(upload, otherAdmin)), result);
    assert.equal(calls.filter(row => row.kind === 'trash').length, trashBefore + 1);
    assert.deepEqual(await tasks(), after);
  });

  await t.test('uncertain provider upload is terminal without automatic or manual redispatch', async () => {
    const task = await seed(), upload = ticket(await start(task)), before = await tasks();
    chunkFailure = true;
    try {
      const result = ok(await chunk(upload), 409);
      assert.equal(result.code, 'DRIVE_UPLOAD_UNCERTAIN'); assert.equal(result.retryable, false);
    } finally { chunkFailure = false; }
    const count = calls.length, ledger = await intents();
    const retry = ok(await chunk(upload), 409); assert.equal(retry.retryable, false);
    assert.equal(calls.length, count); assert.deepEqual(await tasks(), before); assert.deepEqual(await intents(), ledger);
  });

  await t.test('uncertain replacement trash is not repeated and cannot produce duplicate attachment on retry', async () => {
    const task = await seed(91002), upload = ticket(await start(task, otherAdmin, { name: duplicate.name, duplicateAction: 'replace' }));
    trashFailure = true;
    try { const result = ok(await chunk(upload, otherAdmin), 409); assert.equal(result.code, 'DRIVE_REPLACEMENT_UNCERTAIN'); assert.equal(result.retryable, false); }
    finally { trashFailure = false; }
    const count = calls.length, after = await tasks(), ledger = await intents();
    ok(await chunk(upload, otherAdmin), 409); assert.equal(calls.length, count); assert.deepEqual(await tasks(), after);
    assert.deepEqual(await intents(), ledger);
    const [saved] = await f.query('SELECT propiedades_extra FROM tareas WHERE id=$1', [task.id]);
    assert.ok((saved.propiedades_extra.drive_archivos || []).length <= 1);
  });

  const oauthState = async token => {
    const result = ok(await f.api('/connect', { token, method: 'POST', body: {} }));
    assert.equal(typeof result.url, 'string'); const state = new URL(result.url).searchParams.get('state');
    assert.ok(state); assert.ok(states.includes(state)); return state;
  };
  const callback = state => f.api(`/oauth/callback?state=${encodeURIComponent(state)}&code=QA104_SYNTHETIC_CODE`);

  await t.test('OAuth callback rejects forged/legacy state before exchange and without integration writes', async () => {
    const legacy = jwt.sign({ purpose: 'google_drive', role: 'admin', name: 'QA104 legacy label' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    for (const state of ['not-a-signed-state', legacy]) {
      const count = calls.filter(row => row.kind === 'exchange').length, before = await config();
      ok(await callback(state), 401);
      assert.equal(calls.filter(row => row.kind === 'exchange').length, count); assert.deepEqual(await config(), before);
    }
  });

  await t.test('OAuth signed state rechecks current role and epoch, never cached name/role', async () => {
    const state = await oauthState(otherAdmin);
    await f.query("UPDATE usuarios SET rol='edicion' WHERE id=91002");
    try { const before = await config(), count = calls.filter(row => row.kind === 'exchange').length;
      ok(await callback(state), 403); assert.equal(calls.filter(row => row.kind === 'exchange').length, count); assert.deepEqual(await config(), before);
    } finally { await f.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    otherAdmin = await f.tokenFor(91002); const revokedState = await oauthState(otherAdmin);
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    const before = await config(), count = calls.filter(row => row.kind === 'exchange').length;
    ok(await callback(revokedState), 401); assert.equal(calls.filter(row => row.kind === 'exchange').length, count); assert.deepEqual(await config(), before);
  });

  await t.test('uncertain OAuth exchange consumes state once; direct replay cannot exchange or update configuration again', async () => {
    const state = await oauthState(admin), before = await config();
    const count = calls.filter(row => row.kind === 'exchange').length;
    exchangeFailure = true;
    try { const result = ok(await callback(state), 409); assert.equal(result.code, 'DRIVE_OAUTH_UNCERTAIN'); assert.equal(result.retryable, false); }
    finally { exchangeFailure = false; }
    assert.equal(calls.filter(row => row.kind === 'exchange').length, count + 1);
    const afterNonce = await nonces();
    const replay = ok(await callback(state), 409); assert.equal(replay.code, 'DRIVE_OAUTH_STATE_CONSUMED');
    assert.equal(calls.filter(row => row.kind === 'exchange').length, count + 1);
    assert.deepEqual(await config(), before); assert.deepEqual(await nonces(), afterNonce);
  });

  await t.test('authorized synthetic OAuth exchange persists configuration but never exposes refresh secret', async () => {
    const state = await oauthState(admin), beforeTasks = await tasks(), count = calls.filter(row => row.kind === 'exchange').length;
    const result = await callback(state); assert.equal(result.status, 302);
    assert.equal(result.location, '/drive?connected=1');
    assert.equal(JSON.stringify(result).includes('QA104_SYNTHETIC_REFRESH_NOT_REAL'), false);
    assert.equal(calls.filter(row => row.kind === 'exchange').length, count + 1);
    const rows = await config(); assert.equal(rows.length, 1);
    assert.equal(rows[0].configuracion.refresh_token === 'QA104_SYNTHETIC_REFRESH_NOT_REAL', true);
    assert.deepEqual(await tasks(), beforeTasks);
    const after = await config(), afterNonce = await nonces();
    const replay = ok(await callback(state), 409); assert.equal(replay.code, 'DRIVE_OAUTH_STATE_CONSUMED');
    assert.equal(calls.filter(row => row.kind === 'exchange').length, count + 1);
    assert.deepEqual(await config(), after); assert.deepEqual(await nonces(), afterNonce);
  });
});
