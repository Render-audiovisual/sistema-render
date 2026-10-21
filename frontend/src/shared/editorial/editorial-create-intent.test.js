import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createEditorialCreateIntent, verifiedEditorialCreation } from './editorial-create-intent.js';
import { createCapturedRequest } from '../session/captured-request.js';
import { registerNavigationGuard, installUnsavedNavigation } from '../navigation/unsaved.js';
import { requestAppNavigation } from '../navigation/location.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const data = () => ({ tipo: 'historia', cliente_id: 8, responsable_id: 19, fecha_programada: '2026-10-29', idea: 'Original' });
const ack = (extra = {}) => ({ id: 25, publicacion_evidencia: { revision: 0 },
  creation: { request_id: uuid, dominio: 'historia', pieza_id: 25, tarea_id: 26, replayed: false }, ...extra });
function fixture(request, randomUUID = () => uuid) {
  const calls = []; let captures = 0, keys = 0, active = true;
  let session = { token: 'owner-A', usuario: { id: 7, rol: 'admin', activo: true } };
  const original = session;
  const capture = () => { captures++; return createCapturedRequest({ session, readSession: () => session,
    isActive: () => active, request: async (url, options) => { calls.push({ url, options }); return request(url, options, calls.length); } }); };
  const model = createEditorialCreateIntent({ capture, randomUUID: () => { keys++; return randomUUID(); } });
  return { model, calls, original, get captures() { return captures; }, get keys() { return keys; },
    invalidate() { active = false; }, switch() { session = { token: 'owner-B', usuario: { id: 8, rol: 'admin', activo: true } }; } };
}
test('lost ACK requires explicit verify with exactly the original UUID/body/session; replay accepts current revision', async () => {
  const replay = ack({ idea: 'Server edited after create', publicacion_evidencia: { revision: 17 }, creation: { ...ack().creation, replayed: true } });
  const f = fixture(async (_url, _options, number) => { if (number === 1) throw Error('lost'); return replay; });
  const input = data(); await assert.rejects(f.model.submit(input)); input.idea = 'Mutated';
  assert.equal(f.model.snapshot.phase, 'uncertain'); assert.equal(f.calls.length, 1);
  await assert.rejects(f.model.submit(data())); assert.equal(f.keys, 1); assert.equal(f.calls.length, 1);
  assert.equal(await f.model.verify(), replay); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].options.body, f.calls[1].options.body);
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { ...data(), request_id: uuid });
  assert.equal(f.calls[1].options.headers.Authorization, 'Bearer owner-A');
  assert.equal(f.model.snapshot.phase, 'confirmed'); f.model.complete(); assert.equal(f.model.snapshot.locked, false);
});
test('accepted ACK plus failed follow-up never repeats POST; explicit verify returns saved receipt', async () => {
  const saved = ack(), f = fixture(async () => saved); await f.model.submit(data());
  await assert.rejects(f.model.submit(data())); assert.equal(await f.model.verify(), saved);
  assert.equal(f.calls.length, 1); assert.equal(f.keys, 1); assert.equal(f.model.snapshot.phase, 'confirmed');
});
test('an older backend cannot receive a blind legacy creation or fallback after dedicated-route failure', async () => {
  const f=fixture(async()=>{throw Object.assign(Error('Unknown operation'),{status:404});});
  await assert.rejects(f.model.submit(data()));
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/editorial-creaciones');
  await assert.rejects(f.model.verify());
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.url==='/api/editorial-creaciones'));
  assert.equal(f.calls[0].options.body,f.calls[1].options.body);assert.equal(f.keys,1);
});
test('busy prevents duplicate submit/verify and insecure UUID never dispatches', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; }); const f = fixture(() => pending);
  const first = f.model.submit(data()); await assert.rejects(f.model.submit(data())); await assert.rejects(f.model.verify());
  assert.equal(f.calls.length, 1); release(ack()); await first;
  for (const key of ['bad', `${uuid}\n`, uuid.toUpperCase(), '11111111-1111-1111-1111-111111111111']) {
    // This digits-only valid UUID has no case distinction.
    if (key === uuid) continue;
    const invalid = fixture(() => assert.fail('No insecure dispatch'), () => key);
    await assert.rejects(invalid.model.submit(data())); assert.equal(invalid.calls.length, 0);
  }
});
for (const status of [400, 413, 422, 428]) test(`known precommit ${status} permits corrected new intent, never automatic POST`, async () => {
  const f = fixture(async () => { throw Object.assign(Error('invalid'), { status }); });
  await assert.rejects(f.model.submit(data())); assert.equal(f.model.snapshot.locked, false);
  await assert.rejects(f.model.verify()); assert.equal(f.calls.length, 1);
  await assert.rejects(f.model.submit({ ...data(), idea: 'Corrected' })); assert.equal(f.calls.length, 2);
});
for (const status of [401, 403, 409]) test(`${status} blocks receipt reuse and new keys`, async () => {
  const f = fixture(async () => { throw Object.assign(Error('denied'), { status }); });
  await assert.rejects(f.model.submit(data())); assert.equal(f.model.snapshot.phase, 'blocked');
  await assert.rejects(f.model.verify()); await assert.rejects(f.model.submit(data())); assert.equal(f.calls.length, 1); assert.equal(f.keys, 1);
});
for (const change of ['switch', 'invalidate']) test(`${change}: obsolete scope cannot verify or accept late response`, async () => {
  const f = fixture(async () => { throw Error('lost'); }); await assert.rejects(f.model.submit(data())); f[change]();
  await assert.rejects(f.model.verify()); assert.equal(f.calls.length, 1);
  let release; const late = fixture(() => new Promise(resolve => { release = resolve; }));
  const sent = late.model.submit(data()); late[change](); release(ack()); await assert.rejects(sent);
  assert.equal(late.model.snapshot.phase, 'blocked'); assert.equal(late.model.snapshot.savedId, null);
});
test('malformed ACK stays uncertain, never manufactures a created ID', async () => {
  for (const value of [{}, ack({ creation: null }), ack({ id: 99 }), ack({ publicacion_evidencia: { revision: '0' } }),
    ack({ creation: { ...ack().creation, request_id: 'different' } }), ack({ creation: { ...ack().creation, dominio: 'publicacion' } })]) {
    const f = fixture(async () => value); await assert.rejects(f.model.submit(data())); assert.equal(f.model.snapshot.phase, 'uncertain');
    assert.equal(f.model.snapshot.savedId, null); assert.equal(f.calls.length, 1);
    assert.throws(() => verifiedEditorialCreation(value, uuid, 'historia'));
  }
});
test('no responsible ID means no key and no transport', async () => {
  for (const responsable_id of [undefined, null, '', '19', 0, -1]) {
    const f = fixture(() => assert.fail()); await assert.rejects(f.model.submit({ ...data(), responsable_id })); assert.equal(f.keys, 0); assert.equal(f.calls.length, 0);
  }
});
const descendants = (root, predicate) => { const found = []; const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }; visit(root); return found; };
for (const name of ['Historias', 'Publicaciones']) {
  const source = readFileSync(new URL(`../../pages/${name}.jsx`, import.meta.url), 'utf8');
  const file = ts.createSourceFile(`${name}.jsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  test(`${name}: actual navigation getter protects pending/uncertain/confirmed attempts through shared product guard`, async () => {
    assert.equal(file.parseDiagnostics.length, 0);
    const hook = descendants(file, node => ts.isCallExpression(node) && node.expression.getText(file) === 'useNavigationGuard')[0];
    assert.ok(hook);
    const f = fixture(async () => { throw Error('lost'); });
    const getter = new Function('creation', 'creating', 'creationLocks', `return (${hook.arguments[0].getText(file)});`)(
      { current: { model: f.model } }, { current: false }, { current: new Set() });
    assert.deepEqual(getter(), { dirty: false, busy: false }); await assert.rejects(f.model.submit(data()));
    assert.deepEqual(getter(), { dirty: true, busy: false });
    const win = new EventTarget(); win.location = new URL('https://render.test/original');
    win.CustomEvent = class extends Event { constructor(type, options) { super(type, options); this.detail = options.detail; } };
    win.confirm = () => false;
    const installed = installUnsavedNavigation(win), unregister = registerNavigationGuard(win, getter);
    assert.equal(requestAppNavigation(win, '/different?mes=2026-11'), false);
    const unload = new Event('beforeunload', { cancelable: true }); win.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
    unregister(); installed.dispose();
    assert.match(source, /approveContextChange/); assert.match(source, /if \(!approveContextChange\(/);
    assert.match(source, /model\.verify\(\)/); assert.doesNotMatch(source, /responsable: "Augusto"/);
  });
}
