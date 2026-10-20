import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { createCapturedRequest } from '../../frontend/src/shared/session/captured-request.js';

test('shared dispatch preparation persists without inventing real publication', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55689 });
  t.after(async () => { await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT'); });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const response = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(response.status, 200); return response.body.token;
  };
  const owner = await login('qa_franco'), otherOwner = await login('qa_agustin'), employee = await login('qa_luciano');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA shared preparation') RETURNING id");
  const [piece] = await fixture.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada) VALUES($1,'video','pendiente','2026-10-22') RETURNING *", [client.id]);
  const body = { clientId: client.id, publicationId: piece.id, type: 'reel', caption: 'Synthetic draft', platforms: { instagram: true },
    materials: ['https://drive.google.com/file/d/synthetic-test/view'], scheduledAt: '2026-10-22T12:00:00Z', mode: 'draft', requestKey: 'qa-dispatch-persistence-75' };
  const created = await api('/publicacion-envios', { token: owner, method: 'POST', body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'borrador'); assert.equal(created.body.previewOnly, true);
  const read = await api('/publicacion-envios?estado=borrador', { token: otherOwner });
  assert.equal(read.status, 200); assert.ok(read.body.some(row => String(row.id) === String(created.body.id)));
  const duplicate = await api('/publicacion-envios', { token: owner, method: 'POST', body });
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.id, created.body.id);
  await t.test('an idempotency key cannot acknowledge another actor or a changed normalized intent', async () => {
    const snapshot = async () => ({ rows: await fixture.query('SELECT * FROM publicacion_envios ORDER BY id'),
      materials: await fixture.query('SELECT * FROM publicacion_envio_materiales ORDER BY id'),
      targets: await fixture.query('SELECT * FROM publicacion_envio_destinos ORDER BY id') });
    const before = await snapshot();
    for (const [token, input] of [[otherOwner, body], [owner, { ...body, caption: 'Changed intent under same key' }],
      [owner, { ...body, materials: ['https://drive.google.com/file/d/different/view'] }],
      [owner, { ...body, platforms: ['facebook'] }]]) {
      const rejected = await api('/publicacion-envios', { token, method: 'POST', body: input });
      assert.equal(rejected.status, 409); assert.equal(rejected.body.code, 'DISPATCH_REPLAY_MISMATCH');
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('PATCH rejects a different-client publication without changing any dispatch data', async () => {
    const [otherClient] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA other publication client') RETURNING id");
    const [foreignPiece] = await fixture.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada) VALUES($1,'video','pendiente','2026-10-22') RETURNING id", [otherClient.id]);
    const snapshot = async () => ({
      dispatches: await fixture.query('SELECT * FROM publicacion_envios ORDER BY id'),
      materials: await fixture.query('SELECT * FROM publicacion_envio_materiales ORDER BY id'),
      targets: await fixture.query('SELECT * FROM publicacion_envio_destinos ORDER BY id'),
    });
    const before = await snapshot();
    const rejected = await api(`/publicacion-envios/${created.body.id}`, { token: otherOwner, method: 'PATCH',
      body: { ...body, expectedRevision: created.body.revision, publicationId: foreignPiece.id, caption: 'Must not commit', mode: 'schedule' } });
    assert.equal(rejected.status, 400); assert.match(rejected.body.error, /no pertenece al cliente/);
    assert.deepEqual(await snapshot(), before);
  });
  const scheduled = await api(`/publicacion-envios/${created.body.id}`, { token: otherOwner, method: 'PATCH', body: { ...body, expectedRevision: created.body.revision, mode: 'schedule' } });
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body)); assert.equal(scheduled.body.status, 'programada');
  const [unchanged] = await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [piece.id]);
  assert.deepEqual(unchanged, piece, 'dispatch preparation must not change editorial state or real publication evidence');
  assert.equal((await api('/publicacion-envios', { token: employee })).status, 403);
  assert.equal((await api('/publicacion-envios', { token: employee, method: 'POST', body })).status, 403);
  assert.equal((await api('/publicacion-envios', { token: owner, method: 'POST', body: { ...body, clientId: 9999999, requestKey: 'qa-dispatch-missing-client-75' } })).status, 404);
  const [count] = await fixture.query('SELECT count(*)::int AS total FROM publicacion_envios'); assert.equal(count.total, 1);
  await t.test('two simultaneous editors cannot overwrite the same observed draft revision', async () => {
    const input = { ...body, requestKey: 'qa-dispatch-concurrency-77' };
    const draft = await api('/publicacion-envios', { token: owner, method: 'POST', body: input });
    assert.equal(draft.status, 201); assert.match(draft.body.revision, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    const url = `/publicacion-envios/${draft.body.id}`;
    const snapshot = async () => ({ rows: await fixture.query('SELECT * FROM publicacion_envios ORDER BY id'),
      materials: await fixture.query('SELECT * FROM publicacion_envio_materiales ORDER BY id'),
      targets: await fixture.query('SELECT * FROM publicacion_envio_destinos ORDER BY id') });
    const before = await snapshot();
    assert.equal((await api(url, { token: owner, method: 'PATCH', body: input })).status, 428);
    assert.equal((await api(url, { token: owner, method: 'PATCH', body: { ...input, expectedRevision: 'rounded-or-forged' } })).status, 400);
    assert.deepEqual(await snapshot(), before);
    const edits = await Promise.all([owner, otherOwner].map((token, index) => api(url, { token, method: 'PATCH',
      body: { ...input, expectedRevision: draft.body.revision, caption: `Concurrent editor ${index}` } })));
    assert.deepEqual(edits.map(result => result.status).sort(), [200, 409]);
    const winner = edits.find(result => result.status === 200), loser = edits.find(result => result.status === 409);
    assert.equal(loser.body.code, 'DISPATCH_REVISION_CONFLICT'); assert.notEqual(winner.body.revision, draft.body.revision);
    const rows = await api('/publicacion-envios?estado=borrador', { token: otherOwner });
    const stored = rows.body.find(row => String(row.id) === String(draft.body.id));
    assert.equal(stored.caption, winner.body.caption); assert.equal(stored.revision, winner.body.revision);
    const afterWinner = await snapshot();
    const replay = await api('/publicacion-envios', { token: owner, method: 'POST', body: input });
    assert.equal(replay.status, 409); assert.equal(replay.body.code, 'DISPATCH_REPLAY_CHANGED');
    assert.deepEqual(await snapshot(), afterWinner);
    const refreshed = await api(url, { token: otherOwner, method: 'PATCH', body: { ...input, expectedRevision: stored.revision, caption: 'Explicit refreshed edit' } });
    assert.equal(refreshed.status, 200); assert.equal(refreshed.body.caption, 'Explicit refreshed edit');
    // Seed only this disposable row ahead of the clock: one-microsecond changes
    // must remain distinguishable, not be collapsed by JavaScript Date parsing.
    await fixture.query("UPDATE publicacion_envios SET updated_at='2099-10-20T12:00:00.123456Z' WHERE id=$1", [draft.body.id]);
    const exact = (await api('/publicacion-envios?estado=borrador', { token: owner })).body.find(row => String(row.id) === String(draft.body.id));
    assert.equal(exact.revision, '2099-10-20T12:00:00.123456Z');
    const rounded = await api(url, { token: owner, method: 'PATCH', body: { ...input, expectedRevision: '2099-10-20T12:00:00.123000Z' } });
    assert.equal(rounded.status, 409);
    const precise = await api(url, { token: owner, method: 'PATCH', body: { ...input, expectedRevision: exact.revision } });
    assert.equal(precise.status, 200); assert.equal(precise.body.revision, '2099-10-20T12:00:00.123457Z');
    assert.deepEqual((await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [piece.id]))[0], piece);
  });
  await t.test('adjacent BIGSERIAL IDs above JS safe integer stay separate through PATCH', async () => {
    const ids = ['9007199254740992', '9007199254740993'];
    for (const id of ids) await fixture.query(`INSERT INTO publicacion_envios
      (id,cliente_id,creado_por_nombre,tipo,copy,estado,idempotency_key)
      VALUES($1,$2,'Synthetic QA','reel',$3,'borrador',$4)`, [id, client.id, `Original ${id}`, `qa-dispatch-big-${id}`]);
    const listed = await api('/publicacion-envios?estado=borrador', { token: owner });
    const target = listed.body.find(row => row.id === ids[1]); assert.ok(target);
    const saved = await api(`/publicacion-envios/${ids[1]}`, { token: owner, method: 'PATCH',
      body: { ...body, expectedRevision: target.revision, caption: 'Only the exact higher ID' } });
    assert.equal(saved.status, 200); assert.equal(saved.body.id, ids[1]);
    const rows = await fixture.query('SELECT id,copy FROM publicacion_envios WHERE id=ANY($1::bigint[]) ORDER BY id', [ids]);
    assert.deepEqual(rows.map(row => row.copy), [`Original ${ids[0]}`, 'Only the exact higher ID']);
    for (const invalid of ['09007199254740993', '9223372036854775808', '1e3']) {
      assert.equal((await api(`/publicacion-envios/${invalid}`, { token: owner, method: 'PATCH',
        body: { ...body, expectedRevision: target.revision } })).status, 400);
    }
  });
  await t.test('original actor fences a committed response and refuses a stale subsequent dispatch', async () => {
    const loginDto = async usuario => {
      const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
      assert.equal(result.status, 200); return result.body;
    };
    const sessionA = await loginDto('qa_franco'), sessionB = await loginDto('qa_agustin');
    let live = sessionA, calls = 0, entered, release;
    const reached = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const scope = createCapturedRequest({ session: sessionA, readSession: () => live, request: async (url, options) => {
      calls += 1;
      const response = await fetch(`${fixture.base}${url}`, options);
      const payload = await response.json();
      assert.equal(response.status, 201, JSON.stringify(payload));
      entered(); await gate; return payload;
    } });
    const pending = scope.request('/api/publicacion-envios', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, requestKey: 'qa-dispatch-binding-76' }) });
    const observed = pending.then(value => ({ value }), error => ({ error }));
    try {
      await reached; live = sessionB; release();
      assert.equal((await observed).error?.code, 'session_binding_obsolete');
      await assert.rejects(scope.request('/api/publicacion-envios', { method: 'POST', body: '{}' }), error => error.code === 'session_binding_obsolete');
      assert.equal(calls, 1, 'old scope must not dispatch under B');
      const [saved] = await fixture.query("SELECT creado_por_id,estado FROM publicacion_envios WHERE idempotency_key='qa-dispatch-binding-76'");
      assert.equal(String(saved.creado_por_id), String(sessionA.usuario.id)); assert.equal(saved.estado, 'borrador');
      assert.deepEqual((await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [piece.id]))[0], piece);
    } finally { release(); }
  });
  t.diagnostic('Two server-verified owners share one persisted dispatch; employee denied; no Meta call or actual publication.');
});
