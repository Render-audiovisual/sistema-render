import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationDispatchRouter, normalizePublicationDispatch, PUBLICATION_DISPATCH_STATES } from '../src/publication-dispatch.js';

// Actual registered handlers, synthetic router/client only. No HTTP, DB or
// claim that SQL was executed by PostgreSQL; physical timestamp coverage is separate.
const REVISION = '2026-10-20T12:34:56.123456Z';
const NEXT_REVISION = '2026-10-20T12:34:56.123457Z';
const base = () => ({ clientId: 2, publicationId: 9, type: 'carrusel', mode: 'draft', caption: 'Fixture caption',
  firstComment: 'Fixture comment', materials: ['https://drive.google.com/file/d/one', 'https://drive.google.com/file/d/two'],
  platforms: ['instagram', 'facebook'], requestKey: 'revision-fixture-0001', expectedRevision: REVISION });
const rows = values => ({ rowCount: values.length, rows: values });
const dml = calls => calls.filter(call => /^\s*(UPDATE|INSERT|DELETE)\b/i.test(call.sql || ''));
const control = calls => calls.filter(call => /^(BEGIN(?: ISOLATION LEVEL READ COMMITTED)?|COMMIT|ROLLBACK)$/.test(call.sql || '')).map(call => call.sql.startsWith('BEGIN') ? 'BEGIN' : call.sql);
const locks = calls => calls.filter(call => /FOR UPDATE/i.test(call.sql || ''));
const acknowledgements = calls => calls.filter(call => /FROM publicacion_envios e\s+JOIN clientes/i.test(call.sql || '') && !/FOR UPDATE/i.test(call.sql));
function fixture({ existing = true, revision = REVISION, state = 'borrador', clientExists = true, publicationExists = true,
  updateError = null, duplicate = false, replayExists = true, unchanged = true, ackError = null, dispatchId = '11',
  createdById = 7, replayDto = {} } = {}) {
  const routes = new Map(), calls = [], forwarded = [], roles = [];
  let released = 0, connections = 0;
  const normalized = normalizePublicationDispatch(base());
  const dto = { id: dispatchId, clientId: normalized.clientId, publicationId: normalized.publicationId, type: normalized.type,
    caption: normalized.caption, firstComment: normalized.firstComment, scheduledAt: normalized.scheduledAt,
    status: normalized.status, options: normalized.options, previewOnly: true, revision: NEXT_REVISION,
    assets: normalized.materials.map((url, index) => ({ url, position: index + 1 })),
    targets: normalized.platforms.map(platform => ({ platform, status: 'simulada', attempts: 0 })), ...replayDto };
  const client = { async query(sql, params = []) {
    calls.push({ scope: 'tx', sql, params });
    if (/^(BEGIN(?: ISOLATION LEVEL READ COMMITTED)?|COMMIT|ROLLBACK)$/.test(sql)) return rows([]);
    if (sql.includes('FROM usuarios WHERE id=$1')) return rows([{id:params[0],session_version:1,rol:'community',activo:true,nombre:'QA'}]);
    if (/FOR UPDATE/i.test(sql)) {
      if (/idempotency_key=\$1/.test(sql)) return rows(replayExists ? [{ id: dispatchId, unchanged, creado_por_id: createdById }] : []);
      return rows(existing ? [{ id: dispatchId, estado: state, revision }] : []);
    }
    if (/^SELECT id FROM clientes/.test(sql)) return rows(clientExists ? [{ id: 2 }] : []);
    if (/^SELECT id FROM publicaciones/.test(sql)) return rows(publicationExists ? [{ id: 9 }] : []);
    if (/^\s*UPDATE publicacion_envios/.test(sql)) { if (updateError) throw updateError; return rows([]); }
    if (/^\s*INSERT INTO publicacion_envios\b/.test(sql)) {
      if (duplicate) throw Object.assign(Error('synthetic unique conflict'), { code: '23505' });
      return rows([{ id: dispatchId }]);
    }
    if (/^\s*(DELETE|INSERT)\b/.test(sql)) return rows([]);
    if (/FROM publicacion_envios e\s+JOIN clientes/i.test(sql)) { if (ackError) throw ackError; return rows([dto]); }
    assert.fail(`Unexpected synthetic SQL: ${sql}`);
  }, release() { released++; } };
  const pool = { async connect() { connections++; return client; }, async query(sql, params) {
    calls.push({ scope: 'pool', sql, params }); return rows([dto]);
  } };
  const router = {};
  for (const method of ['get', 'post', 'patch']) router[method] = (path, ...handlers) => routes.set(`${method} ${path}`, handlers);
  createPublicationDispatchRouter({ express: { Router: () => router }, pool,
    requireRole: (...allowed) => {
      roles.push(allowed);
      return (req, res, next) => allowed.includes(req.auth.rol) ? next() : res.status(403).json({ error: 'Role denied by injected middleware' });
    } });
  return { calls, forwarded, roles, dto, get released() { return released; }, get connections() { return connections; },
    async invoke(method = 'patch', body = base(), { id = '11', role = 'community', actorId = 7 } = {}) {
      const handlers = routes.get(`${method} ${method === 'patch' ? '/:id' : '/'}`);
      const req = { params: { id }, query: {}, body, auth: { id: actorId, rol: role, session_version:1, nombre: 'QA' } };
      const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      const dispatch = async index => {
        const handler = handlers[index]; if (!handler) return;
        return handler(req, res, error => { if (error) { forwarded.push(error); return; } return dispatch(index + 1); });
      };
      await dispatch(0); return res;
    } };
}
function assertRejectedBeforeMembership(f, code) {
  assert.deepEqual(control(f.calls), ['BEGIN', 'ROLLBACK']);
  assert.equal(locks(f.calls).length, 1);
  assert.equal(f.calls.some(call => /^SELECT id FROM (clientes|publicaciones)/.test(call.sql)), false);
  assert.equal(dml(f.calls).length, 0);
  assert.equal(acknowledgements(f.calls).length, 0);
  assert.equal(f.calls.some(call => call.scope === 'pool'), false);
  assert.equal(f.released, 1); assert.deepEqual(f.forwarded, []);
  if (code) assert.match(code, /^DISPATCH_/);
}
function assertRevisionProjection(call) {
  assert.match(call.sql, /to_char\(e.updated_at AT TIME ZONE 'UTC',\s*'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'\) AS revision/);
}

test('PATCH missing expectedRevision is 428 and malformed opaque values are 400 before pool access', async () => {
  const missing = base(); delete missing.expectedRevision;
  const f = fixture(); const res = await f.invoke('patch', missing);
  assert.equal(res.statusCode, 428); assert.equal(res.body.code, 'DISPATCH_REVISION_REQUIRED');
  assert.equal(f.connections, 0); assert.deepEqual(f.calls, []);
  for (const value of [null, '', 123, false, {}, [], new Date(REVISION), '2026-10-20T12:34:56.123Z',
    '2026-10-20T12:34:56.1234567Z', '2026-10-20T12:34:56.123456+00:00', '2026-10-20T12:34:56.123456z',
    ` ${REVISION}`, `${REVISION}\n`, 'not-a-revision']) {
    const invalid = fixture(); const response = await invalid.invoke('patch', { ...base(), expectedRevision: value });
    assert.equal(response.statusCode, 400, String(value)); assert.equal(response.body.code, 'DISPATCH_REVISION_INVALID');
    assert.equal(invalid.connections, 0); assert.deepEqual(invalid.calls, []);
  }
});
test('stale microsecond revision returns conflict before membership or DML; no Date/millisecond equivalence', async () => {
  const f = fixture({ revision: NEXT_REVISION });
  const res = await f.invoke(); assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'DISPATCH_REVISION_CONFLICT');
  assertRejectedBeforeMembership(f, res.body.code);
  const lock = locks(f.calls)[0]; assert.deepEqual(lock.params, ['11']);
  assert.match(lock.sql, /WHERE e.id=\$1 FOR UPDATE/); assert.doesNotMatch(lock.sql, /AND\s+(?:e\.)?estado=/);
  assertRevisionProjection(lock);
});
test('every non-draft state returns DISPATCH_NOT_EDITABLE under row lock before membership or DML', async () => {
  for (const state of PUBLICATION_DISPATCH_STATES) {
    if (state === 'borrador') continue;
    const f = fixture({ state }); const res = await f.invoke();
    assert.equal(res.statusCode, 409, state); assert.equal(res.body.code, 'DISPATCH_NOT_EDITABLE');
    assertRejectedBeforeMembership(f, res.body.code);
  }
});
test('missing row is 404, invalid membership rolls back after revision checks without writing', async () => {
  const missing = fixture({ existing: false }); assert.equal((await missing.invoke()).statusCode, 404); assertRejectedBeforeMembership(missing);
  for (const settings of [{ clientExists: false }, { publicationExists: false }]) {
    const f = fixture(settings); const res = await f.invoke(); assert.equal(res.statusCode, settings.clientExists === false ? 404 : 400);
    assert.deepEqual(control(f.calls), ['BEGIN', 'ROLLBACK']); assert.equal(dml(f.calls).length, 0); assert.equal(f.released, 1);
    const lockIndex = f.calls.indexOf(locks(f.calls)[0]);
    assert.ok(f.calls.findIndex(call => /^SELECT id FROM clientes/.test(call.sql)) > lockIndex);
  }
});
test('valid PATCH preserves normalization/IDs and parameterized monotonic clock SQL, ACK inside transaction before commit', async () => {
  const f = fixture(), body = { ...base(), caption: "Fixture '); DELETE FROM secret; --" }, before = JSON.stringify(body);
  const res = await f.invoke('patch', body); assert.equal(res.statusCode, 200); assert.equal(res.body, f.dto);
  assert.equal(JSON.stringify(body), before); assert.deepEqual(control(f.calls), ['BEGIN', 'COMMIT']);
  const update = f.calls.find(call => /^\s*UPDATE publicacion_envios/.test(call.sql));
  assert.match(update.sql, /updated_at=GREATEST\(clock_timestamp\(\),updated_at\s*\+\s*interval '1 microsecond'\)/);
  assert.match(update.sql, /WHERE id=\$1/); assert.equal(update.sql.includes(body.caption), false);
  const normalized = normalizePublicationDispatch(body);
  assert.deepEqual(update.params, ['11', 9, 2, normalized.type, normalized.caption, normalized.firstComment,
    normalized.scheduledAt, JSON.stringify(normalized.options), normalized.status]);
  const materialWrites = f.calls.filter(call => /INSERT INTO publicacion_envio_materiales/.test(call.sql));
  assert.deepEqual(materialWrites.map(call => call.params), normalized.materials.map((url, index) => ['11', index + 1, url]));
  const targetWrites = f.calls.filter(call => /INSERT INTO publicacion_envio_destinos/.test(call.sql));
  assert.deepEqual(targetWrites.map(call => call.params), normalized.platforms.map(platform => ['11', platform]));
  for (const call of f.calls.filter(call => /^DELETE/.test(call.sql))) assert.deepEqual(call.params, ['11']);
  const ack = acknowledgements(f.calls); assert.equal(ack.length, 1); assertRevisionProjection(ack[0]);
  assert.equal(ack[0].scope, 'tx'); assert.deepEqual(ack[0].params, ['11']);
  assert.ok(f.calls.indexOf(ack[0]) < f.calls.findIndex(call => call.sql === 'COMMIT'));
  assert.equal(f.calls.some(call => call.scope === 'pool'), false); assert.equal(res.body.revision, NEXT_REVISION);
  assert.equal(f.released, 1); assert.deepEqual(f.forwarded, []);
});
test('PATCH can schedule a current draft, preserving the normalizer instead of introducing another business policy', async () => {
  for (const mode of ['schedule', 'now']) {
    const f = fixture(), body = { ...base(), mode, scheduledAt: '2026-11-20T12:00:00.000Z' };
    assert.equal((await f.invoke('patch', body)).statusCode, 200);
    const update = f.calls.find(call => /^\s*UPDATE/.test(call.sql));
    assert.equal(update.params.at(-1), normalizePublicationDispatch(body).status);
  }
});
test('DML or ACK failure rolls back, forwards error and releases once; never commits a partial replacement', async () => {
  for (const stage of ['updateError', 'ackError']) {
    const error = Error('synthetic DB failure'), f = fixture({ [stage]: error }); await f.invoke();
    assert.deepEqual(control(f.calls), ['BEGIN', 'ROLLBACK']); assert.deepEqual(f.forwarded, [error]); assert.equal(f.released, 1);
    assert.equal(f.calls.some(call => call.scope === 'pool'), false);
  }
});
test('POST and GET expose the same UTC six-microsecond revision SQL; POST ACK remains inside transaction', async () => {
  const f = fixture(), body = base(); delete body.expectedRevision;
  assert.equal((await f.invoke('post', body)).statusCode, 201);
  assert.deepEqual(control(f.calls), ['BEGIN', 'COMMIT']); assert.equal(f.released, 1);
  const ack = acknowledgements(f.calls); assert.equal(ack.length, 1); assertRevisionProjection(ack[0]); assert.equal(ack[0].scope, 'tx');
  assert.ok(f.calls.indexOf(ack[0]) < f.calls.findIndex(call => call.sql === 'COMMIT'));
  const get = fixture(); const response = await get.invoke('get'); assert.deepEqual(response.body, [get.dto]);
  assertRevisionProjection(acknowledgements(get.calls)[0]); assert.equal(get.connections, 0);
});
test('duplicate POST replays only unchanged record under new transaction and lock; modified replay is 409 before ACK', async () => {
  for (const unchanged of [true, false]) {
    const f = fixture({ duplicate: true, unchanged }); const res = await f.invoke('post');
    assert.equal(res.statusCode, unchanged ? 200 : 409);
    assert.deepEqual(control(f.calls), ['BEGIN', 'ROLLBACK', 'BEGIN', unchanged ? 'COMMIT' : 'ROLLBACK']);
    const lock = locks(f.calls)[0]; assert.match(lock.sql, /updated_at=created_at AS unchanged/);
    assert.match(lock.sql, /creado_por_id/);
    assert.match(lock.sql, /WHERE idempotency_key=\$1 FOR UPDATE/); assert.deepEqual(lock.params, [base().requestKey]);
    assert.equal(dml(f.calls).length, 1, 'Only the original failed INSERT, no child replacement or UPDATE on replay');
    const ack = acknowledgements(f.calls); assert.equal(ack.length, unchanged ? 1 : 0);
    if (unchanged) {
      assertRevisionProjection(ack[0]); assert.equal(ack[0].scope, 'tx');
      assert.ok(f.calls.indexOf(lock) < f.calls.indexOf(ack[0])); assert.ok(f.calls.indexOf(ack[0]) < f.calls.findIndex(call => call.sql === 'COMMIT'));
    } else assert.equal(res.body.code, 'DISPATCH_REPLAY_CHANGED');
    assert.equal(f.released, 1); assert.deepEqual(f.forwarded, []); assert.equal(f.calls.some(call => call.scope === 'pool'), false);
  }
});
test('missing replay row forwards original uniqueness failure after rollback without ACK or fabricated success', async () => {
  const f = fixture({ duplicate: true, replayExists: false }); const res = await f.invoke('post');
  assert.equal(res.body, null); assert.equal(f.forwarded[0].code, '23505');
  assert.deepEqual(control(f.calls), ['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK']); assert.equal(f.released, 1);
  assert.equal(acknowledgements(f.calls).length, 0);
});
test('replay requires original persisted actor ID, never request-body actor or matching display name', async () => {
  for (const settings of [{ createdById: 8, actorId: 7 }, { createdById: 7, actorId: 8 }, { createdById: null, actorId: 7 }]) {
    const f = fixture({ duplicate: true, createdById: settings.createdById });
    const response = await f.invoke('post', { ...base(), creado_por_id: settings.createdById, actorId: settings.createdById }, { actorId: settings.actorId });
    assert.equal(response.statusCode, 409); assert.equal(response.body.code, 'DISPATCH_REPLAY_MISMATCH');
    assert.equal(response.body.id, undefined); assert.equal(response.body.revision, undefined, 'No successful/private DTO ACK');
    assert.deepEqual(control(f.calls), ['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK']);
    assert.equal(dml(f.calls).length, 1); assert.equal(f.released, 1); assert.deepEqual(f.forwarded, []);
    assert.match(locks(f.calls)[0].sql, /creado_por_id/);
  }
});
test('same-actor replay with changed normalized payload is rejected without commit, writes or successful DTO ACK', async () => {
  const variants = [
    { clientId: 3 }, { publicationId: 10 }, { publicationId: null }, { type: 'reel' },
    { caption: 'Changed caption' }, { firstComment: 'Changed comment' }, { scheduledAt: '2026-11-20T12:00:00Z' },
    { mode: 'now', scheduledAt: '2026-11-20T12:00:00Z' },
    { collaborators: 'Changed collaborator' }, { location: 'Changed location' }, { tags: 'Changed tag' },
    { materials: [...base().materials].reverse() }, { materials: ['https://drive.google.com/file/d/different'] },
    { platforms: ['instagram'] },
  ];
  for (const patch of variants) {
    const f = fixture({ duplicate: true }); const response = await f.invoke('post', { ...base(), ...patch });
    assert.equal(response.statusCode, 409, JSON.stringify(patch)); assert.equal(response.body.code, 'DISPATCH_REPLAY_MISMATCH');
    assert.equal(response.body.id, undefined); assert.equal(response.body.revision, undefined);
    assert.deepEqual(control(f.calls), ['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK']);
    assert.equal(dml(f.calls).length, 1, 'Only original uniqueness-failed INSERT, no replay mutations');
    const comparisonRead = acknowledgements(f.calls); assert.equal(comparisonRead.length, 1);
    assert.equal(comparisonRead[0].scope, 'tx'); assert.ok(f.calls.indexOf(locks(f.calls)[0]) < f.calls.indexOf(comparisonRead[0]));
    assert.equal(f.calls.some(call => call.scope === 'pool'), false); assert.equal(f.released, 1); assert.deepEqual(f.forwarded, []);
  }
});
test('replay comparison accepts normalized equivalent input and platform sets, but never a non-preview row', async () => {
  const f = fixture({ duplicate: true, replayDto: { targets: [...base().platforms].reverse().map(platform => ({ platform, status: 'simulada', attempts: 0 })) } });
  const response = await f.invoke('post', { ...base(), clientId: '2', publicationId: '9',
    caption: '  Fixture caption  ', platforms: ['facebook', 'instagram', 'facebook'] });
  assert.equal(response.statusCode, 200); assert.equal(response.body, f.dto);
  assert.deepEqual(control(f.calls), ['BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
  const notPreview = fixture({ duplicate: true, replayDto: { previewOnly: false } });
  const denied = await notPreview.invoke('post'); assert.equal(denied.statusCode, 409); assert.equal(denied.body.code, 'DISPATCH_REPLAY_MISMATCH');
  assert.deepEqual(control(notPreview.calls), ['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK']);
});
test('registered role middleware remains admin/community-only; denied role never enters transaction', async () => {
  const f = fixture(); assert.deepEqual(f.roles, [['admin', 'community'], ['admin', 'community'], ['admin', 'community']]);
  const res = await f.invoke('patch', base(), { role: 'diseno' }); assert.equal(res.statusCode, 403);
  assert.equal(f.connections, 0); assert.deepEqual(f.calls, []);
});
test('PATCH rejects noncanonical/out-of-range BIGSERIAL route IDs before connection or SQL', async () => {
  for (const id of ['', '0', '00', '01', '+1', '-1', ' 1', '1 ', '1\n', '1.0', '1e2', '0x10',
    '9223372036854775808', '10000000000000000000', '９', null, {}, ['1'], 9007199254740992, Infinity]) {
    const f = fixture(); const response = await f.invoke('patch', base(), { id });
    assert.equal(response.statusCode, 400, String(id)); assert.equal(f.connections, 0); assert.deepEqual(f.calls, []);
  }
});
test('adjacent unsafe-number-range BIGSERIALs and int8 maximum remain exact canonical strings in every SQL parameter', async () => {
  const observed = [];
  for (const id of ['9007199254740992', '9007199254740993', '9223372036854775807']) {
    const f = fixture({ dispatchId: id }); const response = await f.invoke('patch', base(), { id });
    assert.equal(response.statusCode, 200); assert.equal(response.body.id, id);
    const lock = locks(f.calls)[0]; assert.deepEqual(lock.params, [id]); observed.push(lock.params[0]);
    const update = f.calls.find(call => /^\s*UPDATE publicacion_envios/.test(call.sql));
    assert.equal(update.params[0], id); assert.equal(typeof update.params[0], 'string');
    for (const call of dml(f.calls)) assert.equal(call.params[0], id);
    assert.deepEqual(acknowledgements(f.calls)[0].params, [id]);
    assert.deepEqual(f.calls.find(call => /^SELECT id FROM clientes/.test(call.sql)).params, [2]);
    assert.deepEqual(f.calls.find(call => /^SELECT id FROM publicaciones/.test(call.sql)).params, [9, 2]);
    assert.deepEqual(control(f.calls), ['BEGIN', 'COMMIT']); assert.equal(f.released, 1);
  }
  assert.notEqual(observed[0], observed[1]);
});
test('client/publication normalization rejects unsafe numeric IDs without changing safe int IDs', async () => {
  for (const field of ['clientId', 'publicationId']) for (const value of [9007199254740992, '9007199254740993']) {
    const body = { ...base(), [field]: value }, f = fixture();
    assert.throws(() => normalizePublicationDispatch(body));
    assert.equal((await f.invoke('patch', body)).statusCode, 400);
    assert.equal(f.connections, 0); assert.deepEqual(f.calls, []);
  }
  assert.equal(normalizePublicationDispatch(base()).clientId, 2);
  assert.equal(normalizePublicationDispatch(base()).publicationId, 9);
});
