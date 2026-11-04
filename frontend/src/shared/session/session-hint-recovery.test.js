import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationSession } from './application-session.js';

const dto = { usuario: { id: 7, usuario: 'qa', nombre: 'Synthetic', rol: 'edicion' },
  session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) };
const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'X-Render-Session-Context': value?.session_context || '' } });
const tick = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
function fixture() {
  let hint, next = dto, status = 200, calls = 0;
  const runtime = createApplicationSession({ mode: 'browser', location: { origin: 'https://render.example.test' },
    locks: { request: (_name, _options, work) => Promise.resolve().then(work) },
    fetchImpl: async path => { assert.equal(path, '/api/sesion'); calls++; return response(next, status); },
    sessionChanges: { subscribe(fn) { hint = fn; return () => {}; } } });
  return { runtime, hint: () => hint({ reason: 'login' }), calls: () => calls,
    set(value, code = 200) { next = value; status = code; } };
}

test('an external hint checks unchanged server session without publishing anonymous or posting login', async () => {
  const f = fixture(); await f.runtime.start();
  const statuses = []; f.runtime.subscribe(() => statuses.push(f.runtime.getSnapshot().status));
  f.hint(); assert.equal(f.runtime.getSession(), null); await tick();
  assert.equal(f.runtime.getSession().usuario.id, 7);
  assert.deepEqual(statuses, ['loading', 'authenticated']);
  assert.equal(f.calls(), 2); f.runtime.dispose();
});

test('hint recovery rejects revoked sessions, changed accounts, contexts and roles', async () => {
  for (const [value, code] of [[{}, 401], [{ ...dto, usuario: { ...dto.usuario, id: 8 } }, 200],
    [{ ...dto, session_context: 'c'.repeat(43) }, 200],
    [{ ...dto, usuario: { ...dto.usuario, rol: 'admin' } }, 200]]) {
    const f = fixture(); await f.runtime.start(); f.set(value, code); f.hint(); await tick();
    assert.equal(f.runtime.getSession(), null);
    assert.equal(f.runtime.getSnapshot().status, 'error'); f.runtime.dispose();
  }
});
