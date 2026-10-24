import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';

// Real component callback, not a replacement list loader or mounted browser.
const source = readFileSync(new URL('./Drive.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Drive.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = []; function visit(node) { nodes.push(node); ts.forEachChild(node, visit); } visit(file);
const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'load');
const callback = declaration.initializer.arguments[0].getText(file);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(request, query = '') {
  let session = { token: 'synthetic-A', usuario: { id: 7, rol: 'edicion' } };
  const effects = [], view = { key: 'A', session }, live = { current: JSON.stringify(['A', 'folder-A', query]) };
  const bindings = { current: { id: 'folder-A' }, query, view, live, mounted: { current: true }, generation: { current: 0 },
    createCapturedRequest, getSesion: () => session, driveFiles: request,
    setLoading: value => effects.push(['loading', value]), setError: value => effects.push(['error', value]),
    setFolderReadError: value => effects.push(['folderReadError', value]),
    setFiles: value => effects.push(['files', value]), setLoadedContext: value => effects.push(['context', value]) };
  const load = new Function(...Object.keys(bindings), `return (${callback});`)(...Object.values(bindings));
  return { load, effects, live, bindings, switchUser: () => { session = { token: 'synthetic-B', usuario: { id: 8, rol: 'edicion' } }; } };
}
test('upload reload returns a Promise and keeps original scope/headers through the actual folder callback', async () => {
  let passed;
  const f = fixture(async (parent, query, options) => { passed = options; assert.equal(parent, 'folder-A'); assert.equal(query, ''); return [{ id: 'file' }]; });
  const scope = createCapturedRequest({ session: f.bindings.view.session, readSession: f.bindings.getSesion });
  const result = f.load('folder-A', '', scope); assert.ok(result instanceof Promise); assert.equal(await result, true);
  assert.equal(passed.headers.Authorization, 'Bearer synthetic-A');
  assert.deepEqual(f.effects.at(-1), ['loading', false]); assert.ok(f.effects.some(([name]) => name === 'files'));
});
for (const outcome of ['success', 'failure']) test(`old folder ${outcome} cannot appear beneath a new breadcrumb`, async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const result = f.load(); const count = f.effects.length; f.live.current = JSON.stringify(['A', 'folder-B', '']);
  if (outcome === 'success') pending.resolve([{ id: 'old-file' }]); else pending.reject(new Error('private failure'));
  assert.equal(await result, false); assert.equal(f.effects.length, count);
});
test('old upload scope refuses reload before touching a different account or its view', async () => {
  let calls = 0; const f = fixture(async () => { calls++; return []; });
  const scope = createCapturedRequest({ session: f.bindings.view.session, readSession: f.bindings.getSesion });
  f.switchUser(); await assert.rejects(f.load('folder-A', '', scope), error => isSessionFailure(error));
  assert.equal(calls, 0); assert.deepEqual(f.effects, []);
});
test('overlapping same-folder reloads publish only the newest request', async () => {
  const pending = deferred(); let count = 0;
  const f = fixture(() => ++count === 1 ? pending.promise : Promise.resolve([{ id: 'new' }]));
  const old = f.load(); assert.equal(await f.load(), true); const effects = f.effects.length;
  pending.resolve([{ id: 'old' }]); assert.equal(await old, false); assert.equal(f.effects.length, effects);
  assert.deepEqual(f.effects.findLast(([name]) => name === 'files'), ['files', [{ id: 'new' }]]);
});
test('obsolete upload reload cannot cancel the current query or leave its loading state stuck', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const scope = createCapturedRequest({ session: f.bindings.view.session, readSession: f.bindings.getSesion });
  f.live.current = JSON.stringify(['A', 'folder-B', 'fresh']);
  const current = f.load('folder-B', 'fresh'); const generation = f.bindings.generation.current;
  assert.equal(await f.load('folder-A', '', scope), false);
  assert.equal(f.bindings.generation.current, generation);
  pending.resolve([{ id: 'fresh-file' }]); assert.equal(await current, true);
  assert.deepEqual(f.effects.at(-1), ['loading', false]);
  assert.deepEqual(f.effects.findLast(([name]) => name === 'files'), ['files', [{ id: 'fresh-file' }]]);
});
test('actual Drive hides stale rows during folder/search change and forwards uploader scope', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  assert.match(source, /const files = loadedContext === context && !folderReadError \? loadedFiles : \[\]/);
  assert.match(source, /onUploaded=\{\(_uploaded, scope\) => load\(current\?\.id, query, scope\)\}/);
  assert.match(source, /generation.current === observed/);
  assert.match(source, /url.origin !== 'https:\/\/accounts.google.com'/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test('folder error offers a real retry of the same context without upload/delete or navigation', async () => {
  const retry = nodes.find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button'
    && node.children.some(child => ts.isJsxText(child) && child.text.trim() === 'Reintentar carpeta'));
  assert.ok(retry, 'The folder error must expose a retry button');
  const click = retry.openingElement.attributes.properties.find(attr => attr.name?.getText(file) === 'onClick');
  const disabled = retry.openingElement.attributes.properties.find(attr => attr.name?.getText(file) === 'disabled');
  assert.equal(disabled.initializer.expression.getText(file), 'loading');
  let attempt = 0; const calls = [];
  const f = fixture(async (parent, query) => {
    calls.push({ parent, query });
    if (++attempt === 1) throw Error('temporary fixture failure');
    return [{ id: 'recovered-file' }];
  }, 'material septiembre');
  assert.equal(await f.load(), false);
  assert.ok(f.effects.some(([key, value]) => key === 'error' && /consultar esta carpeta/.test(value)));
  const retryAction = new Function('load', `return (${click.initializer.expression.getText(file)});`)(f.load);
  assert.equal(await retryAction(), true);
  assert.deepEqual(calls, [{ parent: 'folder-A', query: 'material septiembre' }, { parent: 'folder-A', query: 'material septiembre' }]);
  assert.deepEqual(f.effects.findLast(([key]) => key === 'context'), ['context', JSON.stringify(['A', 'folder-A', 'material septiembre'])]);
  assert.deepEqual(f.effects.findLast(([key]) => key === 'folderReadError'), ['folderReadError', false]);
  assert.deepEqual(f.effects.findLast(([key]) => key === 'error'), ['error', '']);
  assert.deepEqual(f.effects.findLast(([key]) => key === 'files'), ['files', [{ id: 'recovered-file' }]]);
  f.switchUser(); const before = f.effects.length;
  assert.equal(await retryAction(), false);
  assert.equal(calls.length, 2); assert.equal(f.effects.length, before);
});

test('read retry stays explicit and a second failure keeps recovery available without false empty state', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; throw Error('offline'); });
  assert.equal(await f.load(), false);
  assert.equal(calls, 1, 'No automatic retry');
  assert.equal(await f.load(), false);
  assert.equal(calls, 2);
  assert.deepEqual(f.effects.findLast(([key]) => key === 'folderReadError'), ['folderReadError', true]);
  assert.deepEqual(f.effects.at(-1), ['loading', false]);
  assert.equal(f.effects.some(([key]) => key === 'files'), false);
  assert.match(source, /folderReadError && <button[^>]*onClick=\{\(\) => load\(\)\}/);
  assert.match(source, /: !error && <div className="drive-empty"/);
  assert.match(source, /drive-folder-recovery" role="alert"/);
  assert.match(source, /setFolderReadError\(false\); setError\('No pudimos confirmar el cambio/);
});
