import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createLoginHandlers, loginUserDto } from '../src/login-handlers.js';

const password = ' synthetic password with spaces ';
const passwordHash = bcrypt.hashSync(password, 4);
const account = () => ({ id: 7, usuario: 'qa', nombre: 'QA actual', rol: 'edicion', foto_perfil: null, activo: true, session_version: 3, password_hash: passwordHash });
const claims = () => ({ sub: 'synthetic-subject', email: 'qa@example.test', email_verified: true });
const credential = 'raw-synthetic-google-credential';
const audience = 'synthetic-audience';
function fixture({ steps = [], blocked = false, payload = claims(), verificationError = null, googleConfigured = true } = {}) {
  const events = [], success = [], failures = [], queries = [];
  const pool = { async query(sql, params) {
    events.push('query'); queries.push({ sql, params });
    assert.ok(steps.length, 'Unexpected synthetic database call');
    const step = steps.shift(); if (step instanceof Error) throw step;
    return { rows: step };
  } };
  const handlers = createLoginHandlers({ pool, googleAudience: audience,
    allowLoginAttempt: async (req, res, identifier) => {
      events.push(['limit', identifier]);
      if (blocked) { res.status(429).json({ error: 'Limited' }); return false; }
      return true;
    },
    googleClient: googleConfigured ? { async verifyIdToken(options) {
      events.push('verify'); assert.deepEqual(options, { idToken: credential, audience });
      if (verificationError) throw verificationError;
      return { getPayload: () => payload };
    } } : null,
    sendSuccess: (user, res, browser) => { events.push('success'); success.push({ user, browser }); return res.json({ delivered: true }); },
  });
  return { handlers, events, queries, success, failures, async call(kind, body, browser = false) {
    let status = 200, value;
    const res = { status(code) { status = code; return this; }, json(data) { value = data; return this; } };
    await handlers[kind](browser)({ body }, res, error => failures.push(error));
    return { status, value };
  } };
}
test('both password modes use real bcrypt and pass the exact observed DB identity to serializer', async () => {
  for (const browser of [false, true]) {
    const user = account(), f = fixture({ steps: [[user]] });
    assert.equal((await f.call('password', { usuario: '  QA  ', password }, browser)).status, 200);
    assert.equal(f.success[0].user, user); assert.equal(f.success[0].browser, browser);
    assert.deepEqual(f.events, [['limit', 'QA'], 'query', 'success']);
    assert.deepEqual(f.queries[0].params, ['QA']); assert.match(f.queries[0].sql, /LIMIT 2/);
  }
});
test('password wrong, missing, inactive and ambiguous identities share bounded generic denial', async () => {
  for (const browser of [false, true]) for (const candidate of [[], [account(), { ...account(), id: 8 }], [{ ...account(), activo: false }], [account()]]) {
    const f = fixture({ steps: [candidate] });
    const result = await f.call('password', { usuario: 'qa', password: candidate.length === 1 && candidate[0].activo ? 'wrong' : password }, browser);
    assert.deepEqual(result, { status: 401, value: { error: 'Usuario o contraseña incorrectos.' } });
    assert.equal(f.success.length, 0); assert.equal(f.failures.length, 0); assert.equal(f.queries.length, 1);
  }
});
test('rate limiter precedes password hash lookup and Google verification/storage in both modes', async () => {
  for (const browser of [false, true]) for (const kind of ['password', 'google']) {
    const f = fixture({ blocked: true });
    assert.equal((await f.call(kind, kind === 'password' ? { usuario: 'qa', password } : { credential }, browser)).status, 429);
    assert.deepEqual(f.events, [['limit', kind === 'password' ? 'qa' : undefined]]);
    assert.equal(f.queries.length, 0); assert.equal(f.success.length, 0);
  }
});
test('closed input rejects malformed and caller-supplied mode/identity/role before limiter or DB', async () => {
  for (const browser of [false, true]) for (const kind of ['password', 'google']) {
    const valid = kind === 'password' ? { usuario: 'qa', password } : { credential };
    for (const body of [null, [], {}, { ...valid, browser: !browser }, { ...valid, id: 99 }, { ...valid, rol: 'admin' }, { ...valid, usuario_id: 8 },
      kind === 'password' ? { ...valid, password: '' } : { credential: {} }]) {
      const f = fixture(); assert.deepEqual(await f.call(kind, body, browser), { status: 400, value: { error: 'Datos de acceso inválidos.' } });
      assert.deepEqual(f.events, []); assert.equal(f.success.length, 0);
    }
  }
  const f = fixture();
  for (const invalid of ['browser', 1, null, {}]) for (const kind of ['password', 'google']) assert.throws(() => f.handlers[kind](invalid), /Invalid login mode/);
});
test('default factory mode is bearer, never selected from request contents', async () => {
  const user = account(), f = fixture({ steps: [[user]] });
  await f.call('password', { usuario: 'qa', password }); assert.equal(f.success[0].browser, false);
  for (const kind of ['password', 'google']) assert.equal(typeof f.handlers[kind](), 'function');
});
test('Google requires provider verification with raw credential and configured audience before any identity query', async () => {
  for (const browser of [false, true]) {
    const user = account(), f = fixture({ steps: [[user]] });
    assert.equal((await f.call('google', { credential }, browser)).status, 200);
    assert.deepEqual(f.events, [['limit', undefined], 'verify', 'query', 'success']);
    assert.deepEqual(f.queries[0].params, [claims().sub]); assert.match(f.queries[0].sql, /google_id = \$1/);
    assert.equal(f.success[0].user, user); assert.equal(f.success[0].browser, browser);
  }
});
test('Google malformed/unverified claims and provider failure never query storage or expose provider error', async () => {
  for (const browser of [false, true]) {
    for (const payload of [null, {}, ...[false, 'true', 1].map(email_verified => ({ ...claims(), email_verified })),
      { ...claims(), sub: '' }, { ...claims(), email: '' }, { ...claims(), email: 'bad' }, { ...claims(), sub: 'x'.repeat(256) }]) {
      const f = fixture({ payload }), result = await f.call('google', { credential }, browser);
      assert.equal(result.status, 401); assert.equal(f.queries.length, 0); assert.equal(f.success.length, 0);
      assert.deepEqual(Object.keys(result.value), ['error']); assert.ok(result.value.error.length < 180);
    }
    const f = fixture({ verificationError: Error('sensitive-provider-detail') });
    assert.deepEqual(await f.call('google', { credential }, browser), { status: 401, value: { error: 'Token de Google inválido o vencido.' } });
    assert.equal(f.queries.length, 0); assert.equal(f.failures.length, 0);
  }
});
test('Google configured roster first binding uses resolver CAS and exact fresh returned identity in both modes', async () => {
  for (const browser of [false, true]) {
    const selected = { ...account(), google_id: null }, fresh = { ...account(), nombre: 'Fresh DB result', session_version: 4 };
    const f = fixture({ steps: [[], [selected], [fresh]] });
    assert.equal((await f.call('google', { credential }, browser)).status, 200);
    assert.equal(f.success[0].user, fresh); assert.equal(f.success[0].browser, browser);
    assert.deepEqual(f.queries[1].params, [claims().email]);
    assert.deepEqual(f.queries[2].params, [claims().sub, selected.id, claims().email, selected.session_version]);
    assert.match(f.queries[2].sql, /session_version = \$4 AND activo = TRUE/);
  }
});
test('Google inactive/ambiguous/unknown roster and CAS conflicts return bounded errors without successful serialization', async () => {
  const selected = { ...account(), google_id: null };
  const cases = [
    { steps: [[{ ...account(), activo: false }]], status: 403 }, { steps: [[account(), account()]], status: 403 },
    { steps: [[], []], status: 403 }, { steps: [[], [account(), account()]], status: 403 },
    { steps: [[], [{ ...selected, activo: false }]], status: 403 },
    { steps: [[], [selected], []], status: 409 },
    { steps: [[], [selected], Object.assign(Error('secret-db-constraint'), { code: '23505' })], status: 409 },
  ];
  for (const browser of [false, true]) for (const item of cases) {
    const f = fixture({ steps: [...item.steps] }), result = await f.call('google', { credential }, browser);
    assert.equal(result.status, item.status); assert.equal(f.success.length, 0); assert.equal(f.failures.length, 0);
    assert.deepEqual(Object.keys(result.value), ['error']); assert.ok(result.value.error.length < 180);
    assert.doesNotMatch(result.value.error, /secret-db-constraint|qa@example|synthetic-subject/);
  }
});
test('Google missing configuration returns existing bounded 500 after limiter without provider/storage', async () => {
  const f = fixture({ googleConfigured: false });
  assert.deepEqual(await f.call('google', { credential }), { status: 500, value: { error: 'El login con Google no está configurado en el servidor.' } });
  assert.deepEqual(f.events, [['limit', undefined]]); assert.equal(f.queries.length, 0);
});
test('unexpected storage faults reach next unchanged without serialization or detail in response', async () => {
  for (const kind of ['password', 'google']) {
    const error = Error('private-storage-failure'), f = fixture({ steps: [error] });
    const result = await f.call(kind, kind === 'password' ? { usuario: 'qa', password } : { credential });
    assert.equal(result.value, undefined); assert.equal(f.failures[0], error); assert.equal(f.success.length, 0);
  }
});
test('shared success user serializer projects exact current identity, never hash, session version or arbitrary bags', () => {
  const user = { ...account(), metadata: { finance: 99 } }, before = JSON.stringify(user);
  assert.deepEqual(loginUserDto(user), { id: 7, usuario: 'qa', nombre: 'QA actual', rol: 'edicion', foto_perfil: null });
  assert.equal(JSON.stringify(user), before);
});
