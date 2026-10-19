import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordLoginInput, googleLoginInput } from '../src/login-input.js';
const rejected = action => assert.throws(action, error => error.status === 400 && error.message === 'Datos de acceso inválidos.');

test('password login accepts only exact scalar fields, preserves password and trims only identifier', () => {
  assert.deepEqual(passwordLoginInput({ usuario: '  Mi.Cuenta@Example.test ', password: '  exact secret  ' }), { usuario: 'Mi.Cuenta@Example.test', password: '  exact secret  ' });
  for (const body of [null, undefined, [], '', { usuario: 'u' }, { password: 'x' }, { usuario: ['u'], password: 'x' },
    { usuario: 'u', password: {} }, { usuario: 'u', password: 123 }, { usuario: 'u', password: null },
    { usuario: 'u', password: 'x', rol: 'admin' }, { usuario: ' ', password: 'x' }, { usuario: 'u\nadmin', password: 'x' },
    { usuario: 'u\u0085admin', password: 'x' }, { usuario: 'u', password: '' }]) rejected(() => passwordLoginInput(body));
});

test('credential lengths are bounded in UTF-8 bytes, never silently truncated', () => {
  assert.equal(passwordLoginInput({ usuario: 'á'.repeat(160), password: 'á'.repeat(512) }).password.length, 512);
  rejected(() => passwordLoginInput({ usuario: 'á'.repeat(161), password: 'x' }));
  rejected(() => passwordLoginInput({ usuario: 'u', password: 'á'.repeat(513) }));
  assert.equal(googleLoginInput({ credential: 'x'.repeat(16384) }).credential.length, 16384);
  rejected(() => googleLoginInput({ credential: 'á'.repeat(8193) }));
});

test('Google credentials reject wrong shape/types/empty, retaining an opaque string only', () => {
  assert.deepEqual(googleLoginInput({ credential: 'opaque.fixture.token' }), { credential: 'opaque.fixture.token' });
  for (const body of [null, [], {}, { credential: '' }, { credential: 1 }, { credential: ['token'] }, { credential: {}, usuario: 'u' },
    { credential: 'token', rol: 'admin' }]) rejected(() => googleLoginInput(body));
});
