import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { mergeTaskComments } from './taskCommentCollection.js';

// Actual initial read effect, POST and input handler with real session fencing.
// Only scheduling/React setters and deferred transport are injected.
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const detail = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TaskDetail');
function find(predicate) {
  const out = []; function walk(n) { if (predicate(n)) out.push(n); ts.forEachChild(n, walk); } walk(detail);
  assert.equal(out.length, 1); return out[0];
}
const readEffect = find(n => ts.isCallExpression(n) && n.expression.getText(file) === 'useEffect'
  && n.arguments[0].getText(file).includes('setComments([])')).arguments[0];
const submit = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'addComment').initializer;
const resetOwner = find(n => ts.isIfStatement(n) && n.expression.getText(file).includes('commentDraftOwner.current.taskId'));
const input = find(n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(file) === 'textarea'
  && n.attributes.properties.some(a => a.name?.getText(file) === 'aria-label' && a.initializer?.text === 'Agregar un comentario'));
const change = input.attributes.properties.find(a => a.name?.getText(file) === 'onChange').initializer.expression;
const evaluate = (n, deps) => Function(...Object.keys(deps), `return (${n.getText(file)});`)(...Object.values(deps));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = (id = 21, extra = {}) => ({ id, tarea_id: 9, autor: 'QA', contenido: `Comment ${id}`, created_at: '2026-10-24T12:00:00.123Z', ...extra });
function fixture() {
  const store = createBrowserSessionState(), reads = [], posts = [], effects = [];
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'diseno' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  accept(7); let active = true;
  const deps = { mergeTaskComments, task: { id: 9, propiedades_extra: {} }, sesion: store.getSession(),
    commentDraftOwner: { current: null }, comment: '', commenting: false, comments: [], commentError: '',
    apiJson() {}, AbortController, getUnifiedTaskContent: () => '', getHoyLocalISO: () => '2026-10-24', onLoadSubtasks: async () => [] };
  function captureFor(session) {
    return () => createCapturedRequest({ session, readSession: store.getSession, isActive: () => active,
      request(url, options) { const held = { ...deferred(), url, options }; (options.method === 'POST' ? posts : reads).push(held); return held.promise; } });
  }
  deps.captureRequest = captureFor(deps.sesion);
  for (const name of ['Draft', 'Editing', 'Comment', 'CommentError', 'Comments', 'Commenting', 'LinkCopied', 'ProductionAmount', 'ProductionDate', 'ProductionCorrections', 'ProductionDriveLink', 'PublicationResponsible']) {
    const key = name[0].toLowerCase() + name.slice(1);
    deps[`set${name}`] = value => { deps[key] = typeof value === 'function' ? value(deps[key]) : value; effects.push([name, deps[key]]); };
  }
  const renderOwner = () => Function(...Object.keys(deps), resetOwner.getText(file))(...Object.values(deps));
  renderOwner();
  return { deps, reads, posts, effects,
    read: () => evaluate(readEffect, deps)(), type: value => evaluate(change, deps)({ target: { value } }), send: () => evaluate(submit, deps)(),
    switchTask(id) { deps.task = { id, propiedades_extra: {} }; renderOwner(); },
    switchSession(id) { accept(id); deps.sesion = store.getSession(); deps.captureRequest = captureFor(deps.sesion); renderOwner(); },
    unmount() { active = false; } };
}

test('held empty initial GET cannot hide a confirmed POST or clear the newer B draft', async () => {
  const h = fixture(), cleanup = h.read(); h.type('A'); const sent = h.send(); h.type('B');
  h.posts[0].resolve(row()); await sent; assert.deepEqual(h.deps.comments, [row()]);
  h.reads[0].resolve([]); await flush();
  assert.deepEqual(h.deps.comments, [row()]); assert.equal(h.deps.comment, 'B'); assert.equal(h.posts.length, 1); cleanup();
});

for (const order of ['GET first', 'ACK first']) {
  test(`${order}: GET containing the confirmed ID and POST ACK render exactly one comment`, async () => {
    const h = fixture(), cleanup = h.read(); h.type('A'); const sent = h.send();
    if (order === 'GET first') { h.reads[0].resolve([row()]); await flush(); h.posts[0].resolve(row()); await sent; }
    else { h.posts[0].resolve(row()); await sent; h.reads[0].resolve([row()]); await flush(); }
    assert.deepEqual(h.deps.comments, [row()]); cleanup();
  });
}

test('multiple confirmed POSTs merge with earlier GET rows in created_at/id order without duplicate IDs', async () => {
  const h = fixture(), cleanup = h.read();
  for (const value of [row(23), row(22)]) { h.type(value.contenido); const sent = h.send(); h.posts.at(-1).resolve(value); await sent; }
  h.reads[0].resolve([row(24, { created_at: '2026-10-24T13:00:00.000Z' }), row(20), row(22)]); await flush();
  assert.deepEqual(h.deps.comments.map(r => r.id), [20, 22, 23, 24]); cleanup();
});

for (const invalid of [null, {}, [row(0)], [row('21')], [row(21, { tarea_id: 10 })], [row(21, { created_at: 'invalid' })],
  [row(21, { contenido: 'Contradictory same ID' })], [row(20), row(20, { contenido: 'Conflicting duplicate in GET' })]]) {
  test(`invalid/conflicting GET preserves confirmed comments and draft (${JSON.stringify(invalid)})`, async () => {
    const h = fixture(), cleanup = h.read(); h.type('A'); const sent = h.send(); h.type('B');
    h.posts[0].resolve(row()); await sent; h.reads[0].resolve(invalid); await flush();
    assert.deepEqual(h.deps.comments, [row()]); assert.equal(h.deps.comment, 'B'); assert.match(h.deps.commentError, /verificar/); cleanup();
  });
}

test('GET error preserves confirmed A and unsent B; POST error never fabricates a confirmed row', async () => {
  const h = fixture(), cleanup = h.read(); h.type('A'); let sent = h.send(); h.posts[0].resolve(row()); await sent;
  h.type('B'); h.reads[0].reject(new Error('Read failed')); await flush();
  assert.deepEqual(h.deps.comments, [row()]); assert.equal(h.deps.comment, 'B');
  sent = h.send(); h.posts[1].reject(new Error('Write failed')); await sent;
  assert.deepEqual(h.deps.comments, [row()]); assert.equal(h.deps.comment, 'B'); cleanup();
});

for (const cleanupFirst of [false, true]) {
  test(`replaced read round fences old GET AND old POST, cleanup=${cleanupFirst}`, async () => {
    const h = fixture(), firstCleanup = h.read(); h.type('A'); const sent = h.send();
    if (cleanupFirst) firstCleanup();
    const secondCleanup = h.read(); const count = h.effects.length;
    h.posts[0].resolve(row()); h.reads[0].resolve([row()]); await sent; await flush();
    assert.equal(h.effects.length, count); assert.deepEqual(h.deps.comments, []);
    h.reads[1].resolve([row(30)]); await flush(); assert.deepEqual(h.deps.comments, [row(30)]);
    firstCleanup(); secondCleanup();
  });
}

for (const transition of ['task', 'task ABA', 'session', 'session ABA', 'unmount']) {
  test(`late GET/POST cannot resurrect the reset ${transition} owner`, async () => {
    const h = fixture(), cleanup = h.read(); h.type('A'); const sent = h.send();
    if (transition.startsWith('task')) { h.switchTask(10); if (transition.endsWith('ABA')) h.switchTask(9); }
    else if (transition.startsWith('session')) { h.switchSession(8); if (transition.endsWith('ABA')) h.switchSession(7); }
    else h.unmount();
    const count = h.effects.length;
    h.posts[0].resolve(row()); h.reads[0].resolve([row()]); await sent; await flush();
    assert.equal(h.effects.length, count); assert.deepEqual(h.deps.comments, []); cleanup();
  });
}

test('pure merge validates all rows before returning and never mutates inputs or deduplicates by author/name', () => {
  const read = Object.freeze([Object.freeze(row(20))]), confirmed = Object.freeze([Object.freeze(row(21))]);
  assert.deepEqual(mergeTaskComments(read, confirmed, 9).map(r => r.id), [20, 21]);
  for (const id of [0, -1, 1.5, '21', 2147483648]) assert.throws(() => mergeTaskComments([], [row(id)], 9), /verificar/);
  assert.throws(() => mergeTaskComments([row()], [row(21, { autor: 'Other' })], 9), /verificar/);
});

for (const failure of [false, true]) {
  for (const newPending of [false, true]) {
    test(`read reset retires old busy without letting old ${failure ? 'error' : 'ACK'} unlock a new POST (new pending=${newPending})`, async () => {
      const h = fixture(), firstCleanup = h.read(); h.type('Old A'); const old = h.send();
      assert.equal(h.deps.commenting, true);
      const secondCleanup = h.read();
      assert.equal(h.deps.commenting, false, 'New read owns an idle UI, not a claim of server cancellation');
      assert.equal(h.deps.commentDraftOwner.current.pendingComment, null);
      let fresh;
      if (newPending) { h.type('New B'); fresh = h.send(); assert.equal(h.deps.commenting, true); }
      const token = h.deps.commentDraftOwner.current.pendingComment, count = h.effects.length;
      if (failure) h.posts[0].reject(new Error('Old failure')); else h.posts[0].resolve(row());
      await old;
      assert.equal(h.effects.length, count, 'Retired operation neither publishes nor changes busy/error');
      assert.equal(h.deps.commentDraftOwner.current.pendingComment, token);
      assert.equal(h.deps.commenting, newPending); assert.deepEqual(h.deps.comments, []);
      if (newPending) {
        h.posts[1].resolve(row(22)); await fresh;
        assert.equal(h.deps.commenting, false); assert.equal(h.deps.commentDraftOwner.current.pendingComment, null);
        assert.deepEqual(h.deps.comments, [row(22)]);
      }
      h.reads[0].resolve([]); h.reads[1].resolve([]); await flush();
      assert.deepEqual(h.deps.comments, newPending ? [row(22)] : []);
      firstCleanup(); secondCleanup();
    });
  }
}
