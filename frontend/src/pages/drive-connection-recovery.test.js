import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCapturedRequest } from '../shared/session/captured-request.js';

// Execute the actual page effect and retry handler with controlled transport.
// Not a React mount, real OAuth, browser session or provider acceptance test.
const source = readFileSync(new URL('./Drive.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Drive.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = []; (function visit(node) { nodes.push(node); ts.forEachChild(node, visit); })(ast);
const effects = nodes.filter(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect');
const effectNode = effects.find(node => node.arguments[0].getText(ast).includes("guard.request('/api/drive/status'"));
assert.ok(effectNode);
const retryNode = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'retryConnection');
assert.ok(retryNode);
const extract = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(ast)});`)(...Object.values(deps));
const settled = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const status = { connected: true, configured: true, roots: { general: 'folder-A' } };
function fixture() {
  let session = { token: 'synthetic-A', usuario: { id: 7, rol: 'edicion' } };
  const paints = [], calls = []; let transport = async () => status, attempt = 0;
  const deps = {
    view: { session }, mounted: { current: true }, connectionRead: { current: null },
    ROOT_LABELS: { general: 'Render' }, AbortController, createCapturedRequest, getSesion: () => session,
    driveStatus: options => { calls.push(options); return transport(options); },
    setConnectionPhase: value => paints.push(['phase', value]), setError: value => paints.push(['error', value]),
    setStatus: value => paints.push(['status', value]), setStack: value => paints.push(['stack', value]),
    setConnectionAttempt: updater => { attempt = updater(attempt); },
  };
  return { deps, paints, calls, retry: extract(retryNode.initializer, deps),
    run: () => extract(effectNode.arguments[0], deps)(), read: fn => { transport = fn; },
    attempt: () => attempt, switchUser: () => { session = { token: 'synthetic-B', usuario: { id: 8, rol: 'edicion' } }; } };
}

test('failed status has no automatic retry; explicit retry latches once then recovers the real root', async () => {
  const f = fixture(); f.read(async () => { throw Error('503 fixture'); });
  const cleanup = f.run(); await settled();
  assert.equal(f.calls.length, 1); assert.equal(f.deps.connectionRead.current.phase, 'error');
  assert.equal(f.paints.some(([key]) => key === 'status' || key === 'stack'), false);
  assert.deepEqual(f.paints.at(-2), ['phase', 'error']);
  f.retry(); f.retry();
  assert.equal(f.attempt(), 1); assert.equal(f.calls.length, 1, 'Handler queues a read, never OAuth');
  assert.equal(f.deps.connectionRead.current.phase, 'loading');
  cleanup(); assert.equal(f.calls[0].signal.aborted, true);
  f.read(async () => status); const cleanupRetry = f.run(); await settled();
  assert.equal(f.calls.length, 2); assert.equal(f.deps.connectionRead.current.phase, 'ready');
  assert.deepEqual(f.paints.findLast(([key]) => key === 'stack'), ['stack', [{ id: 'folder-A', name: 'Render' }]]);
  assert.equal(f.paints.findLast(([key]) => key === 'status')[1], status);
  f.retry(); assert.equal(f.attempt(), 1, 'No status refresh/reset after a ready observation');
  cleanupRetry();
});

for (const outcome of ['success', 'failure']) test(`old status ${outcome} cannot publish after effect cleanup or a newer observation`, async () => {
  const f = fixture(), pending = deferred(); f.read(() => pending.promise);
  const cleanup = f.run(); cleanup();
  f.read(async () => status); const nextCleanup = f.run(); await settled();
  const count = f.paints.length;
  if (outcome === 'success') pending.resolve({ ...status, roots: { general: 'old-root' } }); else pending.reject(Error('old private failure'));
  await settled(); assert.equal(f.paints.length, count); assert.equal(f.deps.connectionRead.current.phase, 'ready');
  nextCleanup();
});

test('retained retry refuses dispatch and state changes after account replacement or unmount', async () => {
  for (const retire of ['account', 'unmount', 'effect-cleanup']) {
    const f = fixture(); f.read(async () => { throw Error('offline'); }); const cleanup = f.run(); await settled();
    if (retire === 'account') f.switchUser();
    else if (retire === 'unmount') { f.deps.mounted.current = false; cleanup(); }
    else cleanup();
    const count = f.paints.length; f.retry();
    assert.equal(f.attempt(), 0); assert.equal(f.calls.length, 1); assert.equal(f.paints.length, count);
    cleanup();
  }
});

test('a failed explicit retry stays recoverable;401 never becomes verified provider disconnection', async () => {
  for (const statusCode of [401, 503]) {
    const f = fixture(); f.read(async () => { throw Object.assign(Error('fixture'), { status: statusCode }); });
    const firstCleanup = f.run(); await settled(); f.retry(); firstCleanup();
    const retryCleanup = f.run(); await settled();
    assert.equal(f.calls.length, 2); assert.equal(f.attempt(), 1);
    assert.equal(f.deps.connectionRead.current.phase, 'error');
    assert.equal(f.paints.some(([key]) => key === 'status' || key === 'stack'), false);
    retryCleanup();
  }
});

for (const outcome of ['success', 'failure']) test(`pending ${outcome} from account A cannot publish under B`, async () => {
  const f = fixture(), pending = deferred(); f.read(() => pending.promise);
  const cleanup = f.run(); f.switchUser(); const count = f.paints.length;
  if (outcome === 'success') pending.resolve(status); else pending.reject(Error('private fixture failure'));
  await settled(); assert.equal(f.paints.length, count); cleanup();
});

test('loading/error rendering is separate from the verified disconnected OAuth branch', () => {
  assert.match(source, /connectionPhase === 'loading' \? <section[^>]*role="status"/);
  assert.match(source, /connectionPhase === 'error' \? <section[^>]*role="alert"/);
  assert.match(source, /onClick=\{retryConnection\}>Reintentar consulta/);
  assert.deepEqual(effectNode.arguments[1].elements.map(node => node.getText(ast)), ['view', 'connectionAttempt']);
  assert.doesNotMatch(retryNode.initializer.getText(ast), /driveRequest|connect\(|load\(|window\.location/);
  const branch = nodes.find(node => ts.isConditionalExpression(node) && node.condition.getText(ast) === "connectionPhase === 'loading'");
  assert.ok(branch);
  const code = ts.transpileModule(`const out=(${branch.getText(ast)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const render = (connectionPhase, observedStatus) => renderToStaticMarkup(new Function('React', 'connectionPhase', 'status', 'retryConnection', 'isAdmin', 'connect', `${code};return out;`)(
    React, connectionPhase, observedStatus, () => {}, true, () => assert.fail('Rendering cannot start OAuth')));
  for (const phase of ['loading', 'error']) {
    const html = render(phase, null);
    assert.doesNotMatch(html, /Conectá|Conectar Google Drive|autorización anterior venció|Falta configurar/);
    assert.match(html, phase === 'error' ? /Reintentar consulta/ : /Consultando Drive/);
  }
  assert.match(render('ready', { connected: false, configured: true }), /Conectar Google Drive/);
});
