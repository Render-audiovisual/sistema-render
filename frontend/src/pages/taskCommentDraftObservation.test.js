import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { mergeTaskComments } from './taskCommentCollection.js';

// Actual input handler, owner reset and submit callback; real cookie-session
// observation kernel. Deferred transport only, no server or React mount claim.
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
const detail = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TaskDetail');
function find(predicate) {
  const matches = []; function walk(n) { if (predicate(n)) matches.push(n); ts.forEachChild(n, walk); }
  walk(detail); assert.equal(matches.length, 1); return matches[0];
}
const submit = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'addComment').initializer;
const ownerReset = find(n => ts.isIfStatement(n) && n.expression.getText(file).includes('commentDraftOwner.current.taskId'));
const input = find(n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(file) === 'textarea'
  && n.attributes.properties.some(a => a.name?.getText(file) === 'aria-label' && a.initializer?.text === 'Agregar un comentario'));
const change = input.attributes.properties.find(a => a.name?.getText(file) === 'onChange').initializer.expression;
function evaluate(node, deps) { return Function(...Object.keys(deps), `return (${node.getText(file)});`)(...Object.values(deps)); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const store = createBrowserSessionState(), wait = deferred(), calls = [], effects = [];
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'diseno' },
    session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  accept(7); let active = true;
  const deps = { mergeTaskComments, task: { id: 9 }, sesion: store.getSession(), comment: '', commenting: false,
    comments: [], commentError: '', commentDraftOwner: { current: null } };
  function captureFor(session) {
    return () => createCapturedRequest({ session, readSession: store.getSession, isActive: () => active,
      request(url, options) { calls.push({ url, options }); return wait.promise; } });
  }
  deps.captureRequest = captureFor(deps.sesion);
  deps.setComment = value => { deps.comment = value; effects.push(['draft', value]); };
  deps.setCommenting = value => { deps.commenting = value; effects.push(['busy', value]); };
  deps.setCommentError = value => { deps.commentError = value; effects.push(['error', value]); };
  deps.setComments = update => { deps.comments = typeof update === 'function' ? update(deps.comments) : update; effects.push(['comments', deps.comments]); };
  const renderOwner = () => Function(...Object.keys(deps), ownerReset.getText(file))(...Object.values(deps));
  renderOwner();
  return { deps, wait, calls, effects, renderOwner,
    type(value) { evaluate(change, deps)({ target: { value } }); },
    send: () => evaluate(submit, deps)(),
    switchTask(id) { deps.task = { id }; renderOwner(); },
    switchSession(id) { accept(id); deps.sesion = store.getSession(); deps.captureRequest = captureFor(deps.sesion); renderOwner(); },
    unmount() { active = false; } };
}
const created = { id: 21, tarea_id: 9, contenido: 'A', autor: 'QA', created_at: '2026-10-24T12:00:00.123Z' };

test('untouched submitted comment clears on ACK; payload, task URL and cookie intent stay unchanged', async () => {
  const h = fixture(); h.type('  A  '); const pending = h.send();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, '/api/tareas/9/comentarios?workspace=render_os');
  assert.equal(h.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { autor: 'QA', contenido: 'A' });
  assert.ok(h.calls[0].options.sessionIntent); assert.equal(h.calls[0].options.headers.Authorization, undefined);
  h.wait.resolve(created); await pending;
  assert.equal(h.deps.comment, ''); assert.equal(h.deps.commenting, false);
  assert.deepEqual(h.deps.comments, [created]); assert.equal(h.calls.length, 1);
});

for (const edits of [['B'], ['B', 'A'], ['A'], ['  A  '], ['']]) {
  test(`post-submit edit ${JSON.stringify(edits)} is retained without posting another comment`, async () => {
    const h = fixture(); h.type('A'); const pending = h.send();
    for (const value of edits) h.type(value);
    h.wait.resolve(created); await pending;
    assert.equal(h.deps.comment, edits.at(-1)); assert.equal(h.deps.commenting, false);
    assert.deepEqual(h.deps.comments, [created]); assert.equal(h.calls.length, 1);
    assert.equal(JSON.parse(h.calls[0].options.body).contenido, 'A');
  });
}

test('same-task renders do not invent an edit generation or prevent untouched ACK clearing', async () => {
  const h = fixture(); h.type('A'); const owner = h.deps.commentDraftOwner.current, generation = owner.generation;
  const pending = h.send(); h.renderOwner(); h.renderOwner();
  assert.equal(h.deps.commentDraftOwner.current, owner); assert.equal(owner.generation, generation);
  h.wait.resolve(created); await pending; assert.equal(h.deps.comment, '');
});

for (const edited of [false, true]) {
  test(`failed POST preserves draft (edited=${edited}) and does not append or retry`, async () => {
    const h = fixture(); h.type('A'); const pending = h.send(); if (edited) h.type('B');
    h.wait.reject(new Error('No se pudo guardar')); await pending;
    assert.equal(h.deps.comment, edited ? 'B' : 'A'); assert.deepEqual(h.deps.comments, []);
    assert.equal(h.deps.commentError, 'No se pudo guardar'); assert.equal(h.deps.commenting, false); assert.equal(h.calls.length, 1);
  });
}

for (const transition of ['task', 'task ABA', 'session', 'session ABA', 'unmount']) {
  for (const failure of [false, true]) {
    test(`stale ${transition} ${failure ? 'error' : 'ACK'} cannot append, clear or repaint busy/error`, async () => {
      const h = fixture(); h.type('A'); const pending = h.send();
      if (transition.startsWith('task')) { h.switchTask(10); if (transition.endsWith('ABA')) h.switchTask(9); }
      else if (transition.startsWith('session')) { h.switchSession(8); if (transition.endsWith('ABA')) h.switchSession(7); }
      else h.unmount();
      h.type('New owner draft'); const count = h.effects.length;
      if (failure) h.wait.reject(new Error('Old owner error')); else h.wait.resolve(created);
      await pending;
      assert.equal(h.effects.length, count); assert.equal(h.deps.comment, 'New owner draft');
      assert.deepEqual(h.deps.comments, []); assert.equal(h.calls.length, 1);
    });
  }
}
