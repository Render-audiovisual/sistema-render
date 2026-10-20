import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationSession } from './application-session.js';
import { captureProfileSession, createProfileSessionGuard, profileFailureMessage } from './profile-session.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('profile errors are bounded and do not claim an uncertain write was rolled back', () => {
  for (const error of [new TypeError('Failed to fetch'), new Error('private SQL'), null]) {
    assert.equal(profileFailureMessage(error), 'No pudimos confirmar el cambio. Volvé a verificar tu perfil antes de reintentar.');
  }
  assert.equal(profileFailureMessage({ code: 'current_password_invalid' }), 'La contraseña actual es incorrecta.');
  assert.equal(profileFailureMessage(new Error('No se pudo leer la imagen.')), 'No se pudo leer la imagen.');
});
function fixture() {
  let serverId = 7, photo = null, mounted = true, nextGate = null;
  const calls = [], navigations = [];
  const dto = () => ({ usuario: { id: serverId, usuario: `qa${serverId}`, nombre: 'Synthetic', rol: 'diseno', foto_perfil: photo },
    session_context: (serverId === 7 ? 'a' : 'c').repeat(43), csrf_token: (serverId === 7 ? 'b' : 'd').repeat(43) });
  const runtime = createApplicationSession({ mode: 'browser', location: { origin: 'https://render.test' },
    locks: { request: (_name, _options, work) => Promise.resolve().then(work) },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const gate = nextGate; nextGate = null;
      const value = dto(); if (gate) await gate.promise;
      return new Response(JSON.stringify(url === '/api/sesion/desafio' ? { csrf_token: 'e'.repeat(43) } : value),
        { headers: { 'X-Render-Session-Context': value.session_context } });
    },
  });
  const guard = () => createProfileSessionGuard({ session: runtime.getSession(), readSession: runtime.getSession,
    isMounted: () => mounted, runtime, save: () => assert.fail('No bearer save'), clear: () => assert.fail('No Storage clearing'),
    navigate: href => navigations.push(href) });
  return { runtime, guard, calls, navigations, dto,
    setPhoto: value => { photo = value; }, setId: id => { serverId = id; }, unmount: () => { mounted = false; },
    hold: gate => { nextGate = gate; } };
}

test('profile dispatch pins genuine cookie intent, body and CSRF without Authorization', async () => {
  const f = fixture(); await f.runtime.start(); const guard = f.guard();
  const response = await guard.request(f.runtime.fetch, '/api/usuarios/foto', { method: 'PATCH',
    headers: { 'Content-Type': 'application/json' }, body: '{"foto_perfil":""}' });
  assert.equal(response.status, 200); const sent = f.calls.at(-1);
  assert.equal(new Headers(sent.options.headers).has('Authorization'), false);
  assert.equal(new Headers(sent.options.headers).get('X-Render-CSRF'), 'b'.repeat(43));
  assert.equal(sent.options.body, '{"foto_perfil":""}'); f.runtime.dispose();
});
test('photo uses a new genuine server observation, never its response DTO as a local session', async () => {
  const f = fixture(); await f.runtime.start(); const original = f.runtime.getSession(), guard = f.guard();
  f.setPhoto('data:image/jpeg;base64,c3ludGhldGlj');
  const result = await guard.applyPhoto(f.dto().usuario);
  assert.equal(result, f.runtime.getSession().usuario); assert.notEqual(f.runtime.getSession(), original);
  assert.equal(result.foto_perfil, 'data:image/jpeg;base64,c3ludGhldGlj');
  assert.equal(guard.current(), false); assert.equal(captureProfileSession(f.runtime.getSession()).mode, 'cookie');
  assert.deepEqual(f.calls.map(call => call.url), ['/api/sesion', '/api/sesion']); f.runtime.dispose();
});
test('cookie photo does not refresh if unmounted/stale and rejects foreign response identity before network', async () => {
  const f = fixture(); await f.runtime.start(); const guard = f.guard(), count = f.calls.length;
  assert.throws(() => guard.applyPhoto({ ...f.dto().usuario, id: 9 })); assert.equal(f.calls.length, count);
  f.unmount(); assert.equal(guard.applyPhoto(f.dto().usuario), null); assert.equal(f.calls.length, count); f.runtime.dispose();
});
test('server reobservation of B is never accepted as A photo update', async () => {
  const f = fixture(); await f.runtime.start(); const guard = f.guard(), photo = f.dto().usuario;
  f.setId(8);
  await assert.rejects(guard.applyPhoto(photo), error => error.code === 'browser_login_context_changed');
  assert.equal(f.runtime.getSession(), null); assert.equal(f.runtime.getSnapshot().status, 'error'); f.runtime.dispose();
});
test('credential success withdraws only captured observation, no extra server logout or Storage mutation', async () => {
  const f = fixture(); await f.runtime.start(); const guard = f.guard(), count = f.calls.length;
  assert.equal(guard.requireReauthentication(), true); assert.equal(f.runtime.getSession(), null);
  assert.equal(f.calls.length, count); assert.deepEqual(f.navigations, ['/login']); f.runtime.dispose();
});
test('old credential completion cannot clear a newer actual login', async () => {
  const f = fixture(); await f.runtime.start(); const guard = f.guard(); f.setId(8);
  await f.runtime.login({ kind: 'password', body: { usuario: 'qa8', password: 'synthetic' } });
  const live = f.runtime.getSession(); assert.equal(guard.requireReauthentication(), false);
  assert.equal(f.runtime.getSession(), live); assert.deepEqual(f.navigations, []); f.runtime.dispose();
});
test('synchronous new login during invalidation prevents old credential handler navigation', async () => {
  const f = fixture(); await f.runtime.start(); const guard = f.guard(); let pending;
  const remove = f.runtime.subscribe(() => {
    if (f.runtime.getSnapshot().status === 'anonymous') {
      f.setId(8);
      pending = f.runtime.login({ kind: 'password', body: { usuario: 'qa8', password: 'synthetic' } });
    }
  });
  assert.equal(guard.requireReauthentication(), true); assert.deepEqual(f.navigations, []);
  assert.equal((await pending).ok, true); assert.equal(f.runtime.getSession().usuario.id, 8);
  remove(); f.runtime.dispose();
});
test('held profile response is suppressed after new login, even if transport completes', async () => {
  const f = fixture(); await f.runtime.start(); const guard = f.guard(), gate = deferred(); f.hold(gate);
  const pending = guard.request(f.runtime.fetch, '/api/usuarios/foto', { method: 'PATCH', body: '{}' });
  await Promise.resolve(); f.setId(8);
  await f.runtime.login({ kind: 'password', body: { usuario: 'qa8', password: 'synthetic' } });
  gate.resolve(); assert.equal(await pending, undefined); assert.equal(f.runtime.getSession().usuario.id, 8); f.runtime.dispose();
});
