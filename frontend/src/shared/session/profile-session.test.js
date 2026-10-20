import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { captureProfileSession, createProfileSessionGuard, profileFailureMessage } from './profile-session.js';
import { PASSWORD_POLICY_MESSAGE } from '../../../../shared/password-policy.mjs';

const session = () => ({ token: 'captured-token', usuario: { id: 7, usuario: 'designer', nombre: 'Diseñador', rol: 'diseno', activo: true, foto_perfil: '' } });
test('profile validation codes expose fixed actionable text rather than arbitrary response details',()=>{
  assert.equal(profileFailureMessage({code:'LOGIN_IDENTIFIER_UNAVAILABLE',message:'private-identity@example.test'}),'Ese usuario o email de acceso no está disponible. Elegí otro.');
  assert.equal(profileFailureMessage({code:'NEW_PASSWORD_INVALID',message:'private-diagnostic'}),PASSWORD_POLICY_MESSAGE);
  assert.equal(profileFailureMessage({code:'PROFILE_INPUT_INVALID',message:'private-diagnostic'}),'Revisá los datos del perfil. No se realizó ningún cambio.');
  assert.ok(!profileFailureMessage({code:'unknown',message:'private-diagnostic'}).includes('private-diagnostic'));
});
function fixture() {
  let live = session(), mounted = true;
  const writes = [], clears = [], navigations = [];
  const guard = createProfileSessionGuard({ session: live, readSession: () => live, isMounted: () => mounted,
    save: (token, usuario) => { writes.push({ token, usuario }); live = { token, usuario }; },
    clear: key => clears.push(key), navigate: href => navigations.push(href) });
  return { guard, writes, clears, navigations, setLive: value => { live = value; }, unmount: () => { mounted = false; } };
}
test('photo preserves exact server ID and known active fields without mutating input', () => {
  const f = fixture(), response = { id: 7, usuario: 'designer', nombre: 'Nombre actual', rol: 'diseno', foto_perfil: 'data:image/jpeg;base64,test' };
  const before = JSON.stringify(response);
  assert.deepEqual(f.guard.headers(), { 'Content-Type': 'application/json', Authorization: 'Bearer captured-token' });
  const user = f.guard.applyPhoto(response);
  assert.equal(user.id, 7); assert.equal(user.activo, true); assert.equal(user.nombre, response.nombre);
  assert.equal(f.writes[0].token, 'captured-token'); assert.equal(JSON.stringify(response), before);
  assert.equal(captureProfileSession(null), null);
});
test('photo rejects malformed or different server identity and never writes', () => {
  for (const patch of [{ id: undefined }, { id: '7' }, { id: 8 }, { rol: 'admin' }, { usuario: '' }, { nombre: null }, { foto_perfil: {} }, { activo: false }]) {
    const f = fixture(); assert.throws(() => f.guard.applyPhoto({ ...session().usuario, ...patch })); assert.equal(f.writes.length, 0);
  }
});
test('removing a photo accepts server null while preserving the authenticated ID and token',()=>{
  const f=fixture();const user=f.guard.applyPhoto({...session().usuario,foto_perfil:null});
  assert.equal(user.id,7);assert.equal(user.foto_perfil,'');assert.equal(f.writes[0].token,'captured-token');
});
test('stale actor, token, role, activity, logout or unmount cannot write, repaint or clear another session', () => {
  for (const next of [null, { ...session(), token: 'new-token' }, { ...session(), usuario: { ...session().usuario, id: 8 } },
    { ...session(), usuario: { ...session().usuario, rol: 'admin' } }, { ...session(), usuario: { ...session().usuario, activo: false } }]) {
    const f = fixture(); f.setLive(next);
    assert.equal(f.guard.current(), false); assert.equal(f.guard.headers(), null);
    assert.equal(f.guard.applyPhoto(session().usuario), null); assert.equal(f.guard.requireReauthentication(), false);
    assert.deepEqual([f.writes, f.clears, f.navigations], [[], [], []]);
  }
  const f = fixture(); f.unmount(); assert.equal(f.guard.applyPhoto(session().usuario), null);
  assert.equal(f.guard.requireReauthentication(), false); assert.equal(f.guard.current(), false);
});
test('successful credentials require login without ever persisting revoked token', () => {
  const f = fixture(); assert.equal(f.guard.requireReauthentication(), true);
  assert.deepEqual(f.clears, ['render_sesion']); assert.deepEqual(f.navigations, ['/login']); assert.deepEqual(f.writes, []);
});
test('unavailable session reader fails closed', () => {
  const guard = createProfileSessionGuard({ session: session(), readSession: () => { throw Error('unavailable'); }, isMounted: () => true });
  assert.equal(guard.current(), false); assert.equal(guard.headers(), null); assert.equal(guard.requireReauthentication(), false);
});
test('late asynchronous photo and credential results cannot affect a replacement session or unmounted page', async () => {
  for (const invalidate of [f => f.setLive({ ...session(), token: 'replacement' }), f => f.unmount()]) {
    for (const operation of ['photo', 'credentials']) {
      const f = fixture(); let finish, repaints = 0;
      const pending = new Promise(resolve => { finish = resolve; }).then(value => {
        if (!f.guard.current()) return;
        if (operation === 'photo') { if (f.guard.applyPhoto(value)) repaints++; }
        else f.guard.requireReauthentication();
      });
      invalidate(f); finish(session().usuario); await pending;
      assert.equal(repaints, 0); assert.deepEqual([f.writes, f.clears, f.navigations], [[], [], []]);
    }
  }
});
test('failed operation leaves existing session and form input intact', async () => {
  const f = fixture(), form = { usuario: 'new-login', password: 'synthetic-only' };
  const before = { ...form };
  await assert.rejects(async () => {
    const response = { ok: false, error: 'Conflicto' };
    if (!response.ok) throw new Error(response.error);
    f.guard.requireReauthentication();
  }, /Conflicto/);
  assert.equal(f.guard.current(), true); assert.deepEqual(form, before);
  assert.deepEqual([f.writes, f.clears, f.navigations], [[], [], []]);
});
test('actual profile source wires guarded photo, credential reauth, mounted cleanup and honest text (not mounted)', () => {
  const source = readFileSync(new URL('../../pages/Perfil.jsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('Perfil.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length, 0);
  assert.match(source, /mounted.current = false/);
  assert.match(source, /readSession: getSesion/); assert.match(source, /save: guardarSesion/);
  assert.match(source, /clear: key => localStorage.removeItem\(key\)/);
  assert.match(source, /guard.applyPhoto\(data\)/);
  assert.match(source, /const guard = capture\(\);[\s\S]*?await reducirFotoPerfil\(file\)/);
  assert.match(source, /guardarFotoPerfil\(fotoReducida, guard\)/);
  assert.equal((source.match(/guard.requireReauthentication\(\)/g) || []).length, 2);
  assert.equal((source.match(/if \(!response.ok\)/g) || []).length, 3);
  assert.doesNotMatch(source, /guardarSesion\(|sin cerrar tu sesión|Tu cuenta sigue activa|localStorage.clear/);
  assert.match(source, /requiere iniciar sesión nuevamente/);
});
