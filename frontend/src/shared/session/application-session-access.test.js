import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createApplicationSessionAccess } from './application-session-access.js';
import { createApplicationSession } from './application-session.js';

const session = id => JSON.stringify({ token: `synthetic-${id}`, usuario: { id, usuario: 'qa', nombre: 'Synthetic', rol: 'edicion' } });
function fixture() {
  let raw = session(1);
  const runtime = createApplicationSession({ storage: { getItem: () => raw }, fetchImpl: async () => new Response('{}') });
  return { runtime, change: id => { raw = session(id); } };
}
test('document access installs the original runtime once; absent runtime is a stable closed error', () => {
  const access = createApplicationSessionAccess(), a = fixture(), b = fixture();
  assert.equal(access.get(), null); assert.equal(access.getSnapshot(), access.getSnapshot());
  assert.equal(access.getSnapshot().status, 'error');
  assert.throws(() => access.install({}), /inválido/);
  assert.equal(access.install(a.runtime), a.runtime); assert.equal(access.install(a.runtime), a.runtime);
  assert.throws(() => access.install(b.runtime), /instalado/);
  assert.equal(access.get(), a.runtime); a.runtime.dispose(); b.runtime.dispose();
});
test('access forwards current stable snapshots and subscriptions without creating or disposing another runtime', async () => {
  const access = createApplicationSessionAccess(), f = fixture(); access.install(f.runtime);
  await f.runtime.start(); const initial = access.getSnapshot(); let changed = 0;
  const remove = access.subscribe(() => changed++);
  f.change(2); f.runtime.sync();
  assert.equal(changed, 1); assert.notEqual(access.getSnapshot(), initial);
  assert.equal(access.getSnapshot().session, f.runtime.getSession());
  remove(); f.change(3); f.runtime.sync();
  assert.equal(changed, 1); assert.equal(f.runtime.getSession().usuario.id, 3); f.runtime.dispose();
});

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('actual React hook observes snapshots with stable module callbacks, no mount-time bootstrap/dispose (source)', () => {
  const source = read('./use-application-session.js');
  assert.match(source, /useSyncExternalStore\(subscribeApplicationSession, getApplicationSessionSnapshot, getApplicationSessionSnapshot\)/);
  assert.doesNotMatch(source, /useEffect|\.start\(|\.dispose\(|\.logout\(|localStorage/);
});
test('actual App handles pending/error before auth redirects and remounts operational pages by observation (AST, not mounted)', () => {
  const source = read('../../App.jsx');
  const file = ts.createSourceFile('App.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length, 0);
  assert.match(source, /const sessionSnapshot = useApplicationSession\(\)/);
  assert.match(source, /const sesion = sessionSnapshot.session/);
  assert.match(source, /const sessionKey = sessionViewKey\(sesion\)/);
  assert.ok(source.indexOf("sessionSnapshot.status === 'loading'") < source.indexOf('if (path === "/login")'));
  assert.ok(source.indexOf("sessionSnapshot.status === 'error'") < source.indexOf('if (!sesion)'));
  assert.match(source, /sessionSnapshot.status === 'loading' && path !== '\/login'/);
  assert.match(source, /sessionSnapshot.status === 'error' && path !== '\/login'/);
  assert.match(source, /<LoginPage sessionPending=\{sessionSnapshot.status === 'loading'\}/);
  assert.match(source, /role="alert"/);
  assert.match(source, /<React.Suspense key=\{sessionKey\} fallback=\{<RouteLoading \/>\}>\{dashboard\}/);
  assert.match(source, /<Sidebar key=\{sessionKey\}/);
  assert.doesNotMatch(source, /getSesion\(\)|sessionToken/);
});
test('actual utility bridge uses exact runtime DTO and denies local writes in browser mode (source)', () => {
  const source = read('../../utils.jsx');
  assert.match(source, /if \(runtime\) return runtime.getSession\(\)/);
  const save = source.slice(source.indexOf('export function guardarSesion'), source.indexOf('export function inicialesUsuario'));
  assert.ok(save.indexOf("runtime?.mode === 'browser'") < save.indexOf('localStorage.setItem'));
  assert.match(save, /runtime\?\.sync\(\)/);
  assert.match(source, /if \(runtime\?\.mode === 'browser'\) return runtime.logout\(\)/);
});
