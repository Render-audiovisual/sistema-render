import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { mergeTaskComments } from './taskCommentCollection.js';
import { createTaskCommentCreation as createCreation } from './taskCommentCreation.js';
const requestId = '12345678-1234-4123-8123-123456789abc';
const createTaskCommentCreation = options => createCreation({ ...options, randomUUID: () => requestId });

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
const row = (id = 21, extra = {}) => ({ id, tarea_id: 9, autor: 'QA', contenido: 'A', created_at: '2026-10-24T12:00:00.123Z', creation_request_id: requestId, ...extra });
function fixture() {
  const store = createBrowserSessionState(), reads = [], posts = [], effects = [];
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'diseno' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  accept(7); let active = true;
  const deps = { mergeTaskComments, createTaskCommentCreation, renderCommentCreation() {}, task: { id: 9, propiedades_extra: {} }, sesion: store.getSession(),
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
  deps.acceptCommentCreation = owner => evaluate(find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'acceptCommentCreation').initializer, deps)(owner);
  const verify = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'verifyCommentCreation').initializer;
  return { deps, reads, posts, effects,
    retainedSend: () => evaluate(submit, deps), retainedVerify: () => evaluate(verify, deps),
    verify: () => evaluate(verify, deps)(),
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
  test(`replaced read round fences old GET but accepts the same-owner POST into current round, cleanup=${cleanupFirst}`, async () => {
    const h = fixture(), firstCleanup = h.read(); h.type('A'); const sent = h.send();
    if (cleanupFirst) firstCleanup();
    const secondCleanup = h.read();
    h.posts[0].resolve(row()); h.reads[0].resolve([row()]); await sent; await flush();
    assert.deepEqual(h.deps.comments, [row()]);
    h.reads[1].resolve([row(30)]); await flush(); assert.deepEqual(h.deps.comments, [row(), row(30)]);
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

for (const transition of ['task', 'task ABA', 'session', 'session ABA']) {
  test(`retained submit/verify callbacks cannot borrow the new ${transition} owner`, async () => {
    const h = fixture(); h.type('A');
    const oldSend = h.retainedSend(), oldVerify = h.retainedVerify();
    if (transition.startsWith('task')) { h.switchTask(10); if (transition.endsWith('ABA')) h.switchTask(9); }
    else { h.switchSession(8); if (transition.endsWith('ABA')) h.switchSession(7); }
    h.type('New owner text'); const count = h.effects.length;
    await oldSend(); await oldVerify();
    assert.equal(h.posts.length, 0); assert.equal(h.reads.length, 0);
    assert.equal(h.effects.length, count); assert.equal(h.deps.comment, 'New owner text');
  });
}

for (const edits of [[], ['B'], ['B', 'A'], ['']]) {
  test(`lost ACK remains locked across read reset; explicit GET restores once with edits ${JSON.stringify(edits)}`, async () => {
    const h = fixture(), cleanup = h.read(); h.type('A');
    const sent = h.send(); await h.send(); assert.equal(h.posts.length, 1);
    for (const value of edits) h.type(value);
    h.posts[0].reject(new Error('ACK lost')); await sent;
    const owner = h.deps.commentDraftOwner.current, attempt = owner.creation.snapshot.attempt;
    cleanup(); const cleanup2 = h.read();
    assert.equal(owner.creation.snapshot.locked, true); assert.equal(owner.creation.snapshot.attempt, attempt);
    assert.equal(h.deps.comment, edits.length ? edits.at(-1) : 'A');
    await h.send(); assert.equal(h.posts.length, 1);
    const checking = h.verify(); await h.verify();
    const request = h.reads.at(-1);
    assert.equal(request.url, `/api/tareas/9/comentarios/solicitudes/${requestId}?workspace=render_os`);
    assert.equal(request.options.method, 'GET'); assert.equal(request.options.body, undefined);
    request.resolve(row()); await checking;
    assert.equal(owner.creation.snapshot.locked, false);
    assert.equal(h.deps.comment, edits.length ? edits.at(-1) : '');
    assert.deepEqual(h.deps.comments, [row()]);
    h.type('After confirmation'); const count = h.effects.length;
    h.deps.acceptCommentCreation(owner); await h.verify();
    assert.equal(h.effects.length, count); assert.equal(h.deps.comment, 'After confirmation');
    h.reads[0].resolve([]); h.reads[1].resolve([]); await flush();
    assert.deepEqual(h.deps.comments, [row()]); assert.equal(h.posts.length, 1); cleanup2();
  });
}

for (const status of [404, 401, 403, 409]) {
  test(`recovery GET ${status} never grants a replacement POST or definitive absence`, async () => {
    const h = fixture(); h.type('A'); const sent = h.send();
    h.posts[0].reject(new Error('Lost ACK')); await sent;
    const checking = h.verify(); h.reads[0].reject(Object.assign(new Error('Unavailable'), { status })); await checking;
    const state = h.deps.commentDraftOwner.current.creation.snapshot;
    assert.equal(state.locked, true); assert.equal(state.canVerify, status === 404);
    h.type('B'); await h.send(); assert.equal(h.posts.length, 1); assert.equal(h.deps.comment, 'B');
  });
}

for (const transition of ['task', 'session', 'unmount']) {
  test(`late receipt GET after ${transition} cannot publish confirmation or clear new text`, async () => {
    const h = fixture(); h.type('A'); const sent = h.send(); h.posts[0].reject(new Error('lost')); await sent;
    const checking = h.verify();
    if (transition === 'task') h.switchTask(10);
    else if (transition === 'session') h.switchSession(8); else h.unmount();
    h.type('B'); const count = h.effects.length;
    h.reads[0].resolve(row()); await checking;
    assert.equal(h.effects.length, count); assert.equal(h.deps.comment, 'B'); assert.deepEqual(h.deps.comments, []);
  });
}

test('actual UI only offers explicit verification and disables Comentar for unresolved empty drafts', () => {
  const button = find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(file) === 'button'
    && n.openingElement.attributes.properties.some(a => a.name?.getText(file) === 'onClick' && a.initializer?.getText(file) === '{addComment}'));
  const disabled = button.openingElement.attributes.properties.find(a => a.name?.getText(file) === 'disabled').initializer.expression;
  assert.equal(evaluate(disabled, { comment: '', commenting: false, commentDraftOwner: { current: { creation: { snapshot: { locked: true } } } } }), true);
  assert.equal(evaluate(disabled, { comment: 'B', commenting: false, commentDraftOwner: { current: { creation: { snapshot: { locked: true } } } } }), true);
  assert.match(detail.getText(file), /snapshot.canVerify && <button type="button" onClick=\{verifyCommentCreation\}>Verificar envío/);
  assert.doesNotMatch(detail.getText(file), /creation\.discard\(/);
  assert.match(detail.getText(file), /Salir no cancela ni revierte el envío/);
});

for (const failure of [false, true]) {
  for (const newPending of [false, true]) {
    test(`read reset retains pending attempt and denies a second POST until ${failure ? 'uncertain' : 'confirmed'} (edit=${newPending})`, async () => {
      const h = fixture(), firstCleanup = h.read(); h.type('A'); const old = h.send();
      assert.equal(h.deps.commenting, true);
      const secondCleanup = h.read();
      assert.equal(h.deps.commenting, true);
      const attempt = h.deps.commentDraftOwner.current.creation.snapshot.attempt;
      if (newPending) h.type('New B');
      await h.send(); assert.equal(h.posts.length, 1);
      assert.equal(h.deps.commentDraftOwner.current.creation.snapshot.attempt, attempt);
      if (failure) h.posts[0].reject(new Error('Old failure')); else h.posts[0].resolve(row());
      await old;
      assert.equal(h.deps.commenting, false);
      assert.equal(h.deps.commentDraftOwner.current.creation.snapshot.locked, failure);
      assert.equal(h.deps.comment, newPending ? 'New B' : failure ? 'A' : '');
      h.reads[0].resolve([]); h.reads[1].resolve([]); await flush();
      assert.deepEqual(h.deps.comments, failure ? [] : [row()]);
      firstCleanup(); secondCleanup();
    });
  }
}
