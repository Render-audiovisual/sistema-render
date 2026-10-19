import test from 'node:test';
import assert from 'node:assert/strict';
import { findPasswordLoginIdentity, resolveGoogleLoginIdentity } from '../src/login-identity.js';

const claims = { sub: 'google-subject', email: 'User@example.com', email_verified: true };
const account = { id: 7, usuario: 'user', nombre: 'User', rol: 'editor', foto_perfil: null, activo: true, session_version: 3 };
function fakePool(...steps) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      assert.ok(steps.length, 'unexpected storage call');
      const step = steps.shift();
      if (step instanceof Error) throw step;
      return { rows: step };
    },
  };
}
const status = expected => error => error.status === expected && !error.message.includes(claims.email)
  && !error.message.includes(claims.sub);

test('password lookup uses only canonical/configured email, projected hash and LIMIT 2', async () => {
  const row = { ...account, password_hash: 'hash' };
  const pool = fakePool([row]);
  assert.equal(await findPasswordLoginIdentity(pool, 'USER'), row);
  assert.deepEqual(pool.calls[0].params, ['USER']);
  assert.match(pool.calls[0].sql, /lower\(usuario\).*OR lower\(google_email\)/s);
  assert.match(pool.calls[0].sql, /password_hash/);
  assert.match(pool.calls[0].sql, /LIMIT 2/);
  assert.doesNotMatch(pool.calls[0].sql, /email_notificaciones|SELECT \*/);
});
test('password missing or ambiguous candidates deny', async () => {
  for (const rows of [[], [account, { ...account, id: 8 }]]) {
    assert.equal(await findPasswordLoginIdentity(fakePool(rows), 'user'), null);
  }
});
test('invalid claims fail before storage', async () => {
  for (const payload of [null, {}, ...[false, 'true', 1, undefined].map(email_verified => ({ ...claims, email_verified })),
    ...['', ' ', [], {}, 's'.repeat(256), 'x\n'].map(sub => ({ ...claims, sub })),
    ...['', [], {}, 'bad', 'a@b', 'a b@c.com', 'a@b.com\n', `${'a'.repeat(320)}@b.com`].map(email => ({ ...claims, email }))]) {
    const pool = fakePool();
    await assert.rejects(resolveGoogleLoginIdentity(pool, payload), status(401));
    assert.equal(pool.calls.length, 0);
  }
});
test('existing subject wins even when provider email changed, without writes', async () => {
  const pool = fakePool([account]);
  assert.equal(await resolveGoogleLoginIdentity(pool, { ...claims, email: 'changed@example.com' }), account);
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /google_id = \$1 LIMIT 2/);
  assert.deepEqual(pool.calls[0].params, [claims.sub]);
});
test('inactive or ambiguous subject denies without email fallback', async () => {
  for (const rows of [[{ ...account, activo: false }], [account, account]]) {
    const pool = fakePool(rows);
    await assert.rejects(resolveGoogleLoginIdentity(pool, claims), status(403));
    assert.equal(pool.calls.length, 1);
  }
});
test('unknown, ambiguous, inactive or already differently bound email denies without write', async () => {
  for (const rows of [[], [account, account], [{ ...account, activo: false }], [{ ...account, google_id: 'other' }]]) {
    const pool = fakePool([], rows);
    await assert.rejects(resolveGoogleLoginIdentity(pool, claims), status(403));
    assert.equal(pool.calls.length, 2);
    assert.match(pool.calls[1].sql, /lower\(google_email\) = lower\(\$1\) LIMIT 2/);
  }
});
test('first binding CAS checks email, version, activity and eligible subject; returns fresh row', async () => {
  for (const google_id of [null, claims.sub]) {
    const fresh = { ...account, nombre: 'Current name' };
    const pool = fakePool([], [{ ...account, google_id }], [fresh]);
    assert.equal(await resolveGoogleLoginIdentity(pool, claims), fresh);
    const update = pool.calls[2];
    assert.deepEqual(update.params, [claims.sub, account.id, claims.email, account.session_version]);
    for (const predicate of [/id = \$2/, /lower\(google_email\) = lower\(\$3\)/, /session_version = \$4/,
      /activo = TRUE/, /google_id IS NULL OR google_id = \$1/, /RETURNING id, usuario/]) assert.match(update.sql, predicate);
    assert.doesNotMatch(update.sql, /password_hash|email_notificaciones/);
  }
});
test('CAS miss and uniqueness race give safe 409 without retry', async () => {
  for (const outcome of [[], Object.assign(new Error('private storage detail'), { code: '23505' })]) {
    const pool = fakePool([], [{ ...account, google_id: null }], outcome);
    await assert.rejects(resolveGoogleLoginIdentity(pool, claims), status(409));
    assert.equal(pool.calls.length, 3);
  }
});
test('unexpected storage failures propagate unchanged at each operation', async () => {
  const error = Object.assign(new Error('storage failure'), { code: '08006' });
  for (const steps of [[error], [[], error], [[], [{ ...account, google_id: null }], error]]) {
    await assert.rejects(resolveGoogleLoginIdentity(fakePool(...steps), claims), value => value === error);
  }
  await assert.rejects(findPasswordLoginIdentity(fakePool(error), 'user'), value => value === error);
});
