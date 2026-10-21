import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { applyFeedbackBrowserOperation } from '../src/feedback-browser-write.js';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

test('QA120 actual browser feedback operations, durable replay and shared writer CAS', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const externalActor = 'qa120-synthetic-whatsapp';
  const f = await startLocalHarness({ port: 55770, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }), allowedWhatsappIds: externalActor,
  } });
  let pool;
  t.after(async () => {
    try { await pool?.end(); } finally { await f.cleanup(); }
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA120 cleanup ENOENT: ${f.root}; PostgreSQL port55770`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55770/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55770, url, identity });
  pool = new pg.Pool({ connectionString: url, max: 5, statement_timeout: 15000, application_name: 'qa120-own-feedback' });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), peer = await login('qa_agustin');
  const actors = [];
  for (const [index, role] of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion', 'qa_unknown'].entries()) {
    const id = 991200 + index;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,whatsapp_id_hash,whatsapp_habilitado)
      SELECT $1,$2,'QA120 fixture actor',$3,password_hash,true,1,$4,$5 FROM usuarios WHERE id=91004`,
    [id, `qa120_${index}`, role, index === 1 ? sha(externalActor) : null, index === 1]);
    actors.push({ id, role, token: await login(`qa120_${index}`) });
  }
  const marker = 'QA120_PRIVATE_FINANCIAL_HISTORY';
  const fields = title => ({ titulo: title, contenido: 'QA120 explicit browser text', categoria: 'general', feedback: {
    cliente: 'QA120 historical client', responsable: 'QA120 fixture actor', responsables: ['QA120 fixture actor'],
    referencia: 'https://example.invalid/qa120/reference', estado: 'pendiente', vigencia: 'puntual', flujo: 'feedback',
  } });
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const rows = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      rows[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return rows;
  };
  const keys = (row, expected) => assert.deepEqual(Object.keys(row).sort(), [...expected].sort());
  const noteDto = note => {
    keys(note, ['id', 'titulo', 'contenido', 'categoria', 'feedback', 'creado_por', 'modificado_por',
      'eliminado_at', 'created_at', 'updated_at', 'resolved_client', 'section']);
    assert.ok(Number.isSafeInteger(note.id) && note.id > 0 && note.id <= 2147483647);
    assert.ok(Number.isFinite(Date.parse(note.updated_at)));
    const allowed = new Set(['cliente', 'responsable', 'responsables', 'referencia', 'estado', 'vigencia', 'flujo',
      'origen', 'confirmado_por', 'confirmado_at', 'confirmado_por_id', 'provenance_version']);
    for (const key of Object.keys(note.feedback)) assert.ok(allowed.has(key));
    assert.equal(JSON.stringify(note).includes(marker), false); return note;
  };
  const ack = (body, intent, replayed, noteId = body.operation.note_id) => {
    keys(body, ['version', 'note', 'operation']); assert.equal(body.version, 1);
    keys(body.operation, ['request_id', 'action', 'note_id', 'note_updated_at', 'replayed']);
    assert.equal(body.operation.request_id, intent.request_id.toLowerCase()); assert.equal(body.operation.action, intent.action);
    assert.equal(body.operation.note_id, noteId); assert.equal(body.operation.replayed, replayed);
    assert.ok(Number.isFinite(Date.parse(body.operation.note_updated_at)));
    if (body.note !== null) { noteDto(body.note); assert.equal(body.note.id, noteId); }
    return body;
  };
  const write = (body, token = admin) => api('/notas/operaciones', token, 'POST', body);
  const create = (title, requestId = crypto.randomUUID()) => ({ request_id: requestId, action: 'create', fields: fields(title) });
  const intentFor = (action, note, patch, requestId = crypto.randomUUID()) => ({ request_id: requestId, action,
    note_id: note.id, expected_updated_at: note.updated_at, ...(patch === undefined ? {} : { fields: patch }) });
  const read = async (id, trash = false, token = admin) => noteDto(ok(await api(`/notas/${id}/detalle?papelera=${trash}`, token)).item);
  const waitBlocked = async pid => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query(`SELECT pid,query FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))`, [pid]);
      if (rows.length) return rows;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('HTTP did not reach the owned real PostgreSQL lock barrier');
  };
  const signed = async (route, body, method = 'POST') => {
    const target = new URL(`/api/integraciones/wilson${route}`, f.base);
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID(), actorName = 'QA120 signed fixture';
    const message = ['v2', timestamp, nonce, 'whatsapp', externalActor, '', actorName, method,
      `${target.pathname}${target.search}`, sha(canonical(body))].join('\n');
    const response = await fetch(target, { method, signal: AbortSignal.timeout(20000), headers: {
      'content-type': 'application/json', 'x-wilson-signature-version': '2', 'x-wilson-timestamp': timestamp,
      'x-wilson-nonce': nonce, 'x-wilson-channel': 'whatsapp', 'x-wilson-actor-id': externalActor,
      'x-wilson-actor-name': actorName, 'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64'),
    }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const confirmSignedEdit = async (noteId, payload) => ok(await signed('/confirmaciones', {
    operacion: 'editar_feedback', tarea_id: noteId, payload,
  }), 201).confirmacion_token;

  await t.test('every current role including custom creates, edits, trashes, restores and purges through closed real ACKs', async () => {
    for (const actor of actors) {
      const creation = create(`QA120 lifecycle ${actor.role}`);
      let saved = ack(ok(await write(creation, actor.token), 201), creation, false);
      const id = saved.note.id; assert.equal(saved.note.titulo, creation.fields.titulo);
      const edit = intentFor('edit', saved.note, { contenido: `QA120 changed ${actor.role}` });
      const beforeVersion = saved.note.updated_at;
      saved = ack(ok(await write(edit, actor.token)), edit, false, id);
      assert.equal(saved.note.contenido, edit.fields.contenido); assert.ok(Date.parse(saved.note.updated_at) > Date.parse(beforeVersion));
      const trash = intentFor('trash', saved.note);
      saved = ack(ok(await write(trash, actor.token)), trash, false, id); assert.ok(saved.note.eliminado_at);
      ok(await api(`/notas/${id}/detalle?papelera=false`, actor.token), 404);
      const restore = intentFor('restore', saved.note);
      saved = ack(ok(await write(restore, actor.token)), restore, false, id); assert.equal(saved.note.eliminado_at, null);
      assert.equal((await read(id, false, actor.token)).contenido, edit.fields.contenido);
      const again = intentFor('trash', saved.note);
      saved = ack(ok(await write(again, actor.token)), again, false, id);
      const purge = intentFor('purge', saved.note);
      saved = ack(ok(await write(purge, actor.token)), purge, false, id); assert.equal(saved.note, null);
      ok(await api(`/notas/${id}/detalle?papelera=true`, actor.token), 404);
      const beforeReplay = await snapshot();
      assert.equal(ack(ok(await write(creation, actor.token)), creation, true, id).note, null);
      assert.equal(ack(ok(await write(purge, actor.token)), purge, true, id).note, null);
      assert.deepEqual(await snapshot(), beforeReplay, 'Purged note must not resurrect on old create or purge replay');
      const receipts = await f.query('SELECT action FROM feedback_browser_operations WHERE actor_user_id=$1 AND note_id=$2 ORDER BY action', [actor.id, id]);
      assert.deepEqual(receipts.map(row => row.action), ['create', 'edit', 'purge', 'restore', 'trash', 'trash']);
    }
  });

  await t.test('genuine ignored ACK retries exactly once; old receipts return current note after later edit/trash/restore without reapplying', async () => {
    const creation = create('QA120 lost response observed on server');
    const first = ack(ok(await write(creation), 201), creation, false), id = first.note.id;
    let before = await snapshot();
    const retry = ack(ok(await write(creation)), creation, true, id);
    assert.deepEqual(retry.note, first.note); assert.deepEqual(await snapshot(), before);
    const edit = intentFor('edit', first.note, { titulo: 'QA120 newer human title' });
    const changed = ack(ok(await write(edit, peer)), edit, false, id);
    before = await snapshot(); const old = ack(ok(await write(creation)), creation, true, id);
    assert.equal(old.note.titulo, changed.note.titulo); assert.equal(old.note.updated_at, changed.note.updated_at);
    assert.equal(old.operation.note_updated_at, first.operation.note_updated_at);
    assert.deepEqual(await snapshot(), before);
    const trash = intentFor('trash', changed.note), trashed = ack(ok(await write(trash)), trash, false, id);
    before = await snapshot(); assert.ok(ack(ok(await write(edit, peer)), edit, true, id).note.eliminado_at);
    assert.deepEqual(await snapshot(), before);
    const restore = intentFor('restore', trashed.note), restored = ack(ok(await write(restore)), restore, false, id);
    before = await snapshot();
    assert.equal(ack(ok(await write(trash)), trash, true, id).note.eliminado_at, null);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await read(id)).updated_at, restored.note.updated_at);
    for (const changedIntent of [{ ...creation, fields: fields('QA120 changed same UUID') },
      intentFor('edit', restored.note, { contenido: 'Wrong action same UUID' }, creation.request_id)]) {
      ok(await write(changedIntent), 409); assert.deepEqual(await snapshot(), before);
    }
  });

  await t.test('trash-only purge, current observed timestamps and closed typed payloads reject without DML', async () => {
    const creation = create('QA120 validation target'), current = ack(ok(await write(creation), 201), creation, false).note;
    const otherIntent = create('QA120 different target'), other = ack(ok(await write(otherIntent), 201), otherIntent, false).note;
    const before = await snapshot(), valid = intentFor('edit', current, { contenido: 'QA120 would change' });
    const { expected_updated_at: _timestamp, ...missingTimestamp } = valid;
    const { request_id: _key, ...missingKey } = valid;
    ok(await write(missingTimestamp), 428); ok(await write(missingKey), 428);
    for (const body of [{ ...valid, extra: true }, { ...valid, request_id: 'bad' }, { ...valid, action: 'delete' },
      ...[0, -1, '1', 1.5, 2147483648, 9007199254740992].map(note_id => ({ ...valid, note_id })),
      ...[null, 123, 'invalid', '2026-02-30T12:00:00.000Z'].map(expected_updated_at => ({ ...valid, expected_updated_at })),
      ...[[], null, { contenido: 123 }, { unknown: 'bad' }, { feedback: { confirmado_por_id: 91001 } }].map(fields => ({ ...valid, fields }))])
      ok(await write(body), 400);
    ok(await write(intentFor('purge', current)), 409);
    ok(await write(intentFor('restore', current)), 409);
    ok(await write({ ...valid, note_id: other.id, request_id: creation.request_id }), 409);
    ok(await write(valid, null), 401); assert.deepEqual(await snapshot(), before);
  });

  await t.test('competing current actors blocked at the actual note lock have one CAS winner and one unchanged stale intent', async () => {
    const creation = create('QA120 real note CAS competition'), current = ack(ok(await write(creation), 201), creation, false).note;
    const locker = await pool.connect(), pending = [];
    try {
      await locker.query('BEGIN'); await locker.query('SELECT id FROM notas_compartidas WHERE id=$1 FOR UPDATE', [current.id]);
      const pid = (await locker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      for (const [index, token] of [admin, peer].entries())
        pending.push(write(intentFor('edit', current, { contenido: `QA120 competing ${index}` }), token));
      await waitBlocked(pid); await locker.query('COMMIT');
      const results = await Promise.all(pending); assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
      const winner = results.find(row => row.status === 200).body.note;
      assert.equal((await read(current.id)).contenido, winner.contenido);
      const stable = await snapshot();
      ok(await write(intentFor('edit', current, { contenido: 'QA120 stale retry must not win' })), 409);
      assert.deepEqual(await snapshot(), stable);
    } finally { await locker.query('ROLLBACK').catch(() => {}); await Promise.allSettled(pending); locker.release(); }
  });

  await t.test('another actor cannot borrow an existing edit receipt to bypass CAS; target substitution with the same actor/key conflicts', async () => {
    const creation = create('QA120 receipt belongs to original actor'), original = ack(ok(await write(creation), 201), creation, false).note;
    const intent = intentFor('edit', original, { contenido: 'QA120 actor A committed once' });
    const committed = ack(ok(await write(intent)), intent, false, original.id);
    const otherCreation = create('QA120 alternate target'), other = ack(ok(await write(otherCreation), 201), otherCreation, false).note;
    const before = await snapshot();
    ok(await write(intent, peer), 409);
    ok(await write({ ...intent, note_id: other.id }), 409);
    assert.deepEqual(ack(ok(await write(intent)), intent, true, original.id).note, committed.note);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await f.query('SELECT actor_user_id FROM feedback_browser_operations WHERE request_id=$1', [intent.request_id]), [{ actor_user_id: 91001 }]);
  });

  await t.test('partial browser edits preserve historical private metadata/provenance in SQL but never return those private bags', async () => {
    const [row] = await f.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback)
      VALUES('QA120 legacy provenance','Original historical content','general','Historical actor','Historical actor',$1::jsonb) RETURNING id`,
    [JSON.stringify({ ...fields('unused').feedback, origen: 'mia_whatsapp', confirmado_por: 'QA120 historical human',
      confirmado_por_id: 91004, confirmado_at: '2026-10-01T12:00:00.123456Z', provenance_version: 1,
      wilson_idempotency_key: marker, private_finance: { marker, importe: 817293.46 }, unknown: { marker } })]);
    const current = await read(row.id), before = await snapshot();
    const intent = intentFor('edit', current, { contenido: '', feedback: { estado: 'resuelto' } });
    const saved = ack(ok(await write(intent, actors.at(-1).token)), intent, false, row.id);
    assert.equal(saved.note.contenido, ''); assert.equal(saved.note.feedback.estado, 'resuelto');
    for (const key of ['origen', 'confirmado_por', 'confirmado_por_id', 'confirmado_at', 'provenance_version', 'referencia', 'cliente', 'responsables'])
      assert.deepEqual(saved.note.feedback[key], current.feedback[key]);
    const after = await snapshot(), stored = after.notas_compartidas.find(note => note.id === row.id);
    const original = before.notas_compartidas.find(note => note.id === row.id);
    assert.deepEqual(stored.feedback, { ...original.feedback, estado: 'resuelto' });
    assert.deepEqual(after.notas_compartidas.filter(note => note.id !== row.id), before.notas_compartidas.filter(note => note.id !== row.id));
    assert.deepEqual((await read(row.id)).feedback, saved.note.feedback);
  });

  await t.test('signed and browser writers share the real 061 monotonic timestamp: either direction invalidates the held observation', async () => {
    const creation = create('QA120 browser and signed writer share one version');
    // Signed feedback validates its current catalog: keep this one team-scoped
    // with the fixture's unique real responsible, not the deliberately shared
    // display names / free historical client label used in browser-only cases.
    creation.fields.feedback.cliente = '';
    creation.fields.feedback.responsable = 'Luciano QA';
    creation.fields.feedback.responsables = ['Luciano QA'];
    const initial = ack(ok(await write(creation), 201), creation, false).note;
    const browserOld = intentFor('edit', initial, { contenido: 'QA120 obsolete browser edit' });
    const payload = { contenido: 'QA120 signed writer committed', expected_updated_at: initial.updated_at,
      idempotency_key: crypto.randomUUID(), permitir_duplicado: true };
    const confirmation = await confirmSignedEdit(initial.id, payload);
    ok(await signed(`/feedback/${initial.id}`, { ...payload, confirmacion_token: confirmation }, 'PATCH'));
    const signedSaved = await read(initial.id);
    assert.equal(signedSaved.contenido, payload.contenido);
    assert.ok(Date.parse(signedSaved.updated_at) > Date.parse(initial.updated_at));
    let before = await snapshot(); ok(await write(browserOld), 409); assert.deepEqual(await snapshot(), before);
    const obsoleteSigned = { contenido: 'QA120 obsolete signed writer', expected_updated_at: signedSaved.updated_at,
      idempotency_key: crypto.randomUUID(), permitir_duplicado: true };
    const signedToken = await confirmSignedEdit(initial.id, obsoleteSigned);
    const freshBrowser = intentFor('edit', signedSaved, { contenido: 'QA120 browser committed after signed observation' });
    const browserSaved = ack(ok(await write(freshBrowser)), freshBrowser, false, initial.id).note;
    assert.ok(Date.parse(browserSaved.updated_at) > Date.parse(signedSaved.updated_at));
    before = await snapshot();
    ok(await signed(`/feedback/${initial.id}`, { ...obsoleteSigned, confirmacion_token: signedToken }, 'PATCH'), 409);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await read(initial.id)).contenido, freshBrowser.fields.contenido);
  });

  for (const change of ['epoch', 'role', 'inactive']) for (const replay of [false, true]) {
    await t.test(`account-mutex wait revalidates ${change} before ${replay ? 'receipt replay' : 'new mutation'}`, async () => {
      const actor = actors[0];
      await f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=$1", [actor.id]);
      const intent = create(`QA120 lost authority ${change} ${replay}`);
      if (replay) ok(await write(intent, actor.token), 201);
      const locker = await pool.connect(); let pending;
      try {
        await locker.query('BEGIN'); await locker.query('SELECT pg_advisory_xact_lock(20261019,1)');
        const pid = (await locker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        pending = write(intent, actor.token).then(value => ({ value }), error => ({ error }));
        await waitBlocked(pid);
        await locker.query(`UPDATE usuarios SET ${change === 'epoch' ? 'session_version=2' : change === 'role' ? "rol='edicion'" : 'activo=false'} WHERE id=$1`, [actor.id]);
        await locker.query('COMMIT'); const before = await snapshot(), result = await pending;
        if (result.error) throw result.error;
        ok(result.value, 401); assert.deepEqual(await snapshot(), before);
      } finally {
        await locker.query('ROLLBACK').catch(() => {}); await pending; locker.release();
        await f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=$1", [actor.id]);
      }
    });
  }

  await t.test('one authorized writer holds actor SHARE until COMMIT while note-locked; later revocation waits, then rejects the old token', async () => {
    const actor = actors[2], creation = create('QA120 actor SHARE through write commit');
    const current = ack(ok(await write(creation), 201), creation, false).note;
    const intent = intentFor('edit', current, { contenido: 'QA120 serialized before revocation' });
    const locker = await pool.connect(), revoker = await pool.connect(); let pending, revocation;
    try {
      await locker.query('BEGIN'); await locker.query('SELECT id FROM notas_compartidas WHERE id=$1 FOR UPDATE', [current.id]);
      const notePid = (await locker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      pending = write(intent, actor.token).then(value => ({ value }), error => ({ error }));
      const waiting = await waitBlocked(notePid);
      const writer = waiting.find(row => /FROM notas_compartidas/.test(row.query));
      assert.ok(writer, 'Writer must be waiting at the real target note row, after actor SHARE');
      await revoker.query('BEGIN');
      const revokerPid = (await revoker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      revocation = revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [actor.id]);
      // Attach failure observation immediately; no unhandled pending rejection.
      const revocationResult = revocation.then(value => ({ value }), error => ({ error }));
      const blocked = await waitBlocked(writer.pid);
      assert.ok(blocked.some(row => row.pid === revokerPid), 'Actual revoker must wait on the active writer actor lock');
      await locker.query('COMMIT'); const result = await pending;
      if (result.error) throw result.error;
      ack(ok(result.value), intent, false, current.id);
      const revoked = await revocationResult; if (revoked.error) throw revoked.error;
      await revoker.query('COMMIT');
      assert.equal((await read(current.id)).contenido, intent.fields.contenido);
      const before = await snapshot(); ok(await write(intent, actor.token), 401); assert.deepEqual(await snapshot(), before);
    } finally {
      await locker.query('ROLLBACK').catch(() => {}); await pending;
      await revocation?.catch(() => {}); await revoker.query('ROLLBACK').catch(() => {});
      locker.release(); revoker.release();
      await f.query('UPDATE usuarios SET session_version=1 WHERE id=$1', [actor.id]);
    }
  });

  await t.test('actor and entire request intent are captured before a delayed real connection lease', async () => {
    const actor = actors.at(-1);
    let reached, resume;
    const ready = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { resume = resolve; });
    const wrapper = { connect: async () => { reached(); await gate; return pool.connect(); } };
    const auth = { id: actor.id, rol: actor.role, session_version: 1 };
    const body = create('QA120 immutable original title'), originalId = body.request_id;
    const pending = applyFeedbackBrowserOperation(wrapper, auth, body);
    await ready;
    auth.id = 91001; auth.rol = 'admin'; auth.session_version = 2;
    body.request_id = crypto.randomUUID(); body.fields.titulo = 'QA120 mutated caller title';
    body.fields.feedback.responsables.push('QA120 mutated caller identity');
    resume();
    const result = await pending; assert.equal(result.status, 201);
    const saved = result.body; assert.equal(saved.operation.request_id, originalId);
    assert.equal(saved.note.titulo, 'QA120 immutable original title');
    assert.deepEqual(saved.note.feedback.responsables, ['QA120 fixture actor']);
    const [receipt] = await f.query('SELECT actor_user_id FROM feedback_browser_operations WHERE request_id=$1', [originalId]);
    assert.equal(receipt.actor_user_id, actor.id);
    for (const change of ['epoch', 'role', 'inactive']) {
      let acquired, release;
      const waiting = new Promise(resolve => { acquired = resolve; }), hold = new Promise(resolve => { release = resolve; });
      const delayed = { connect: async () => { acquired(); await hold; return pool.connect(); } };
      const observed = { id: actor.id, rol: actor.role, session_version: 1 };
      const requestBody = create(`QA120 prelease rejection ${change}`);
      const response = applyFeedbackBrowserOperation(delayed, observed, requestBody);
      const rejected = assert.rejects(response, error => error.status === 401);
      await waiting;
      try {
        await f.query(`UPDATE usuarios SET ${change === 'epoch' ? 'session_version=2' : change === 'role' ? "rol='admin'" : 'activo=false'} WHERE id=$1`, [actor.id]);
        observed.id = 91001; observed.rol = 'admin'; observed.session_version = 2;
        const before = await snapshot(); release(); await rejected; assert.deepEqual(await snapshot(), before);
      } finally {
        release(); await rejected;
        await f.query("UPDATE usuarios SET activo=true,rol='qa_unknown',session_version=1 WHERE id=$1", [actor.id]);
      }
    }
  });

  for (const action of ['create', 'edit', 'trash', 'restore', 'purge']) {
    await t.test(`late receipt INSERT fault atomically rolls back ${action}; same original key succeeds after removing only the fixture fault`, async () => {
      let intent;
      if (action === 'create') intent = create('QA120 atomic create receipt failure');
      else {
        const creation = create(`QA120 atomic ${action} setup`);
        let current = ack(ok(await write(creation), 201), creation, false).note;
        if (action === 'restore' || action === 'purge') {
          const trash = intentFor('trash', current); current = ack(ok(await write(trash)), trash, false, current.id).note;
        }
        intent = intentFor(action, current, action === 'edit' ? { contenido: 'QA120 atomic edit value' } : undefined);
      }
      const before = await snapshot();
      await f.query(`CREATE FUNCTION qa120_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'QA120 synthetic receipt failure'; END $$;
        CREATE TRIGGER qa120_receipt_fault BEFORE INSERT ON feedback_browser_operations
        FOR EACH ROW EXECUTE FUNCTION qa120_receipt_fault()`);
      try { ok(await write(intent), 500); assert.deepEqual(await snapshot(), before); }
      finally { await f.query('DROP TRIGGER qa120_receipt_fault ON feedback_browser_operations; DROP FUNCTION qa120_receipt_fault()'); }
      const saved = ack(ok(await write(intent), action === 'create' ? 201 : 200), intent, false);
      if (action === 'purge') assert.equal(saved.note, null);
      const after = await snapshot(); ack(ok(await write(intent)), intent, true, saved.operation.note_id);
      assert.deepEqual(await snapshot(), after);
      const [receipt] = await f.query('SELECT request_id FROM feedback_browser_operations WHERE actor_user_id=91001 AND request_id=$1', [intent.request_id]);
      assert.ok(receipt);
      for (const sql of ['UPDATE feedback_browser_operations SET payload_hash=payload_hash WHERE request_id=$1',
        'DELETE FROM feedback_browser_operations WHERE request_id=$1'])
        await assert.rejects(pool.query(sql, [intent.request_id]), error => error.code === '23514');
    });
  }
});
