import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createSessionView, sessionViewInputs } from '../shared/session/session-view.js';
import { driveRequest } from '../features/drive/drive-api.js';

// Execute actual callbacks + actual shared capture hook. No mounted React,
// browser, network, DB or replacement always-current session guard.
const source = readFileSync(new URL('./FinanceContractsPanel.jsx', import.meta.url), 'utf8');
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const file = parse('FinanceContractsPanel.jsx', source);
const hookFile = parse('hook.js', readFileSync(new URL('../shared/session/use-scoped-request.js', import.meta.url), 'utf8'));
function nodes(root, predicate) { const found = []; const visit = n => { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); }; visit(root); return found; }
const fn = (root, name) => nodes(root, ts.isFunctionDeclaration).find(n => n.name?.text === name);
const variable = name => nodes(file, ts.isVariableDeclaration).find(n => n.name.getText() === name);
const evaluate = (node, context) => new Function(...Object.keys(context), `return (${node.getText().replace(/^export\s+/, '')});`)(...Object.values(context));
const settle = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const row = (version = 1) => ({ id: 12, nombre: 'Synthetic contract', importe_mensual: '120.00', inicia_el: '2026-10-01', finaliza_el: null, activo: true, contract_revision: `fc1:12:${version}` });
function fixture({ edit = false } = {}) {
  const calls = [], saved = [], effects = [], state = {}, activity = [], store = createBrowserSessionState();
  function accept(id = 7) { const ticket = store.beginBootstrap(); store.acceptBootstrap(ticket, { usuario: { id, rol: 'admin', usuario: 'synthetic', nombre: 'Synthetic' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) }); }
  accept(); const original = store.getSession(), view = createSessionView(sessionViewInputs(original));
  const refs = [], cleanups = []; let index = 0, mounted = false;
  const rawFetch = (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject }));
  const hook = evaluate(fn(hookFile, 'useScopedRequest'), { useSessionView: () => view,
    useRef: value => refs[index++] ||= { current: value }, useCallback: callback => callback,
    useLayoutEffect: setup => { if (!mounted) cleanups.push(setup()); }, getSesion: () => store.getSession(),
    apiRequest: (url, options) => driveRequest(url, options, rawFetch), createCapturedRequest });
  const render = context => { index = 0; const value = hook(original, context); mounted = true; return value; };
  const scope = render(edit ? 'contract:12' : 'contract:create');
  const context = { contracts: [row()], editing: edit ? row() : null,
    draft: { nombre: 'Edited', importe_mensual: '250.25', inicia_el: '2026-10-01', finaliza_el: '' },
    newContract: { nombre: 'New financial contract', importe_mensual: '200.50', inicia_el: '2026-11-01', finaliza_el: '' },
    newBaseline: { current: 'initial' }, pending: { current: false }, blockedRef: { current: null }, createConsumed: { current: null },
    capture: scope.capture, activityCallback: { current: value => activity.push(value) },
    dirty: true, window: { confirm: () => true },
    onSaved: async (value, guard) => { guard.assertCurrent(); saved.push({ value, guard }); } };
  for (const name of ['Editing', 'Draft', 'NewContract', 'Rows', 'Loading', 'Error', 'Blocked']) context[`set${name}`] = value => {
    state[name] = typeof value === 'function' ? value(state[name] ?? null) : value; effects.push(name);
  };
  for (const name of ['contractRevision', 'contractDate', 'contractRow', 'contractDraft', 'contractPayload', 'assertContractAck']) context[name] = evaluate(fn(file, name), context);
  context.emptyContract = evaluate(variable('emptyContract').initializer, context);
  return { context, calls, saved, effects, state, activity, store, accept, render,
    unmount: () => cleanups.forEach(cleanup => cleanup?.()), run: name => evaluate(variable(name).initializer, context) };
}
function ack(h, version = 2, id = 12) {
  const body = JSON.parse(h.calls.at(-1).options.body); delete body.expected_revision;
  return { ...row(version), ...body, id, contract_revision: `fc1:${id}:${version}` };
}

test('create freezes full intent, prevents duplicate POST and publishes matching genuine session ACK', async () => {
  const h = fixture(), save = h.run('saveContract'), pending = save('create');
  await save('create'); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, 'POST'); assert.equal(h.calls[0].options.sessionIntent !== undefined, true);
  assert.equal(Object.hasOwn(JSON.parse(h.calls[0].options.body), 'expected_revision'), false);
  h.context.newContract.nombre = 'Typed later';
  h.calls[0].resolve(response(ack(h, 1, 19))); await pending;
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0].value.nombre, 'New financial contract');
  assert.equal(h.state.NewContract.nombre, ''); assert.equal(h.context.blockedRef.current, null);
});

test('edit holds original revision, sends decimal string and publishes advanced matching ACK', async () => {
  const h = fixture({ edit: true }), pending = h.run('saveContract')('edit');
  const body = JSON.parse(h.calls[0].options.body);
  assert.equal(body.expected_revision, 'fc1:12:1'); assert.equal(body.importe_mensual, '250.25');
  h.context.contracts[0] = row(99);
  h.calls[0].resolve(response(ack(h))); await pending;
  assert.equal(h.saved.length, 1); assert.equal(h.state.Editing, null);
});

for (const outcome of ['B', 'ABA', 'unmount', 'contextABA']) test(`${outcome} fences late save and all UI/parent effects`, async () => {
  const h = fixture({ edit: true }), pending = h.run('saveContract')('edit'), count = h.effects.length;
  if (outcome === 'B' || outcome === 'ABA') { h.accept(8); if (outcome === 'ABA') h.accept(7); }
  if (outcome === 'unmount') h.unmount();
  if (outcome === 'contextABA') { h.render('contract:13'); h.render('contract:12'); }
  h.calls[0].resolve(response(ack(h))); await pending;
  assert.equal(h.effects.length, count); assert.equal(h.saved.length, 0);
});

for (const failure of ['409', 'network', 'malformed', 'wrongID', 'unchanged', 'wrongValue']) test(`${failure} preserves draft and blocks any automatic or repeated write`, async () => {
  const h = fixture({ edit: true }), pending = h.run('saveContract')('edit');
  if (failure === 'network') h.calls[0].reject(new TypeError('Synthetic uncertainty'));
  else if (failure === '409') h.calls[0].resolve(response({ code: 'CONTRACT_REVISION_CONFLICT', error: 'Conflict' }, 409));
  else h.calls[0].resolve(response(failure === 'malformed' ? {} : { ...ack(h),
    ...(failure === 'wrongID' ? { id: 13, contract_revision: 'fc1:13:2' } : {}),
    ...(failure === 'unchanged' ? { contract_revision: 'fc1:12:1' } : {}),
    ...(failure === 'wrongValue' ? { nombre: 'Different' } : {}) }));
  await pending; await h.run('saveContract')('edit');
  assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 0);
  assert.equal(h.context.draft.nombre, 'Edited'); assert.equal(h.context.blockedRef.current.revision, 'fc1:12:1');
});

test('verified create ACK plus refresh failure reports committed save and clears create draft without retry', async () => {
  const h = fixture(); h.context.onSaved = async () => { throw new Error('Synthetic refresh failure'); };
  const pending = h.run('saveContract')('create'); h.calls[0].resolve(response(ack(h, 1, 19))); await pending;
  assert.match(h.state.Error, /se guardó.*No repitas/); assert.equal(h.state.NewContract.nombre, '');
  assert.equal(h.context.blockedRef.current, null); assert.equal(h.calls.length, 1);
  await h.run('saveContract')('create'); assert.equal(h.calls.length, 1);
});

test('toggle uses explicit held row revision and PATCH only, allowing backend date side effect', async () => {
  const h = fixture(), held = row(), pending = h.run('saveContract')('toggle', held);
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { activo: false, expected_revision: 'fc1:12:1' });
  assert.equal(h.calls[0].options.method, 'PATCH');
  h.calls[0].resolve(response({ ...row(2), activo: false, finaliza_el: '2026-10-20' })); await pending;
  assert.equal(h.saved.length, 1);
});

test('explicit recovery loads same ID and replaces draft only after validated read', async () => {
  const h = fixture({ edit: true }); h.context.blockedRef.current = { kind: 'edit', id: 12 };
  const pending = h.run('recoverContract')(); assert.equal(h.calls[0].url, '/api/contratos');
  h.calls[0].resolve(response([row(8)])); await pending;
  assert.equal(h.state.Editing.contract_revision, 'fc1:12:8'); assert.equal(h.state.Draft.nombre, 'Synthetic contract');
  assert.equal(h.context.blockedRef.current, null); assert.equal(h.saved.length, 0);
});

for (const outcome of ['missing', 'malformed', 'network', 'B']) test(`recovery ${outcome} preserves draft and held revision`, async () => {
  const h = fixture({ edit: true }); h.context.blockedRef.current = { kind: 'edit', id: 12, revision: 'fc1:12:1' };
  const pending = h.run('recoverContract')(), count = h.effects.length;
  if (outcome === 'B') h.accept(8);
  if (outcome === 'network') h.calls[0].reject(new Error('Synthetic failure'));
  else h.calls[0].resolve(response(outcome === 'missing' ? [] : outcome === 'malformed' ? [{}] : [row(8)]));
  await pending; assert.equal(h.state.Draft, undefined); assert.equal(h.context.blockedRef.current.revision, 'fc1:12:1');
  if (outcome === 'B') assert.equal(h.effects.length, count);
});

test('uncertain creation recovery reviews whole actual list without guessing a created ID', async () => {
  const h = fixture(); h.context.blockedRef.current = { kind: 'create' };
  const pending = h.run('recoverContract')(); h.calls[0].resolve(response([row(2)])); await pending;
  assert.equal(h.state.Rows.length, 1); assert.equal(h.state.NewContract.nombre, ''); assert.equal(h.saved.length, 0);
});

test('cancel is blocked while pending and dirty discard requires scoped confirmation', () => {
  const h = fixture({ edit: true }); h.context.pending.current = true;
  h.run('cancelEdit')(); assert.equal(h.state.Editing, undefined);
  h.context.pending.current = false; h.context.window.confirm = () => false;
  h.run('cancelEdit')(); assert.equal(h.state.Editing, undefined);
  h.context.window.confirm = () => { h.accept(8); return true; };
  assert.throws(() => h.run('cancelEdit')(), error => error.code === 'session_binding_obsolete');
  assert.equal(h.state.Editing, undefined);
});

test('canonical tokens, calendar dates and decimal payload constraints match backend without cross-date restriction', () => {
  const h = fixture();
  for (const token of ['fc1:12:0', 'fc1:0:1', 'fc1:12:01', 'fc1:12:2\n', 'fc1:12:2147483648']) assert.equal(h.context.contractRevision(token), null);
  assert.equal(h.context.contractRevision('fc1:13:2', 12), null);
  for (const date of ['0000-01-01', '2026-02-29', '2026-2-01', '2026-01-01\n']) assert.equal(h.context.contractDate(date), false);
  assert.equal(h.context.contractDate('0001-01-01'), true);
  assert.equal(h.context.contractPayload({ ...h.context.draft, finaliza_el: '2025-01-01' }).finaliza_el, '2025-01-01');
  for (const amount of ['01', '-1', '1.001', '1000000000000', '1e2']) assert.throws(() => h.context.contractPayload({ ...h.context.draft, importe_mensual: amount }));
});

test('source preserves financial classes, controlled fields, explicit recovery and activity cleanup without raw APIs', () => {
  assert.doesNotMatch(source, /document\.|\bfetch\s*\(|localStorage|defaultValue|method:\s*['"]DELETE/);
  assert.match(source, /Descartar mis cambios y cargar versión guardada/);
  assert.match(source, /activityCallback.current\?\.\(loading \|\| dirty \|\| Boolean\(editing\)\)/);
  assert.match(source, /useEffect\(\(\) => \(\) => \{ activityCallback.current\?\.\(false\)/);
  assert.match(source, /newBaseline.current/); assert.match(source, /contract:\$\{editing.id\}/);
  const inputs = nodes(file, ts.isJsxSelfClosingElement).filter(n => n.tagName.getText() === 'input');
  assert.equal(inputs.length, 4); assert.ok(inputs.every(n => n.attributes.properties.some(p => p.name?.getText() === 'value')));
});

test('missing held revision and invalid create values fail before transport or parent callback', async () => {
  const h = fixture({ edit: true }); h.context.editing.contract_revision = undefined;
  await h.run('saveContract')('edit'); assert.equal(h.calls.length, 0); assert.match(h.state.Error, /revisión válida/);
  for (const changes of [{ nombre: 'x'.repeat(251) }, { importe_mensual: '2.345' }, { inicia_el: '2026-02-30' }]) {
    const c = fixture(); Object.assign(c.context.newContract, changes);
    await c.run('saveContract')('create'); assert.equal(c.calls.length, 0); assert.equal(c.saved.length, 0);
  }
});

test('callback completion after B does not publish final editor close or loading reset', async () => {
  const h = fixture({ edit: true }); let finish;
  h.context.onSaved = () => new Promise(resolve => { finish = resolve; });
  const pending = h.run('saveContract')('edit'); h.calls[0].resolve(response(ack(h))); await settle();
  assert.equal(typeof finish, 'function'); const count = h.effects.length;
  h.accept(8); finish(); await pending;
  assert.equal(h.effects.length, count); assert.equal(h.state.Editing, undefined);
});

test('reactivation ACK must clear end date and unreviewed row cannot toggle', async () => {
  const h = fixture(); const pending = h.run('saveContract')('toggle', { ...row(), activo: false, finaliza_el: '2026-10-01' });
  h.calls[0].resolve(response({ ...row(2), finaliza_el: '2026-10-01' })); await pending;
  assert.equal(h.saved.length, 0); assert.equal(h.context.blockedRef.current.kind, 'toggle');
  const missing = fixture(); await missing.run('saveContract')('toggle', { ...row(), contract_revision: 'fc1:13:1' });
  assert.equal(missing.calls.length, 0);
});

test('activity effect includes unchanged open editor, dirty/conflict state and pending requests', () => {
  const effect = nodes(fn(file, 'ContractsSession'), ts.isCallExpression).find(n =>
    n.expression.getText() === 'useEffect' && n.arguments[0]?.getText().includes('activityCallback.current?.(loading'));
  assert.ok(effect);
  assert.deepEqual(effect.arguments[1].elements.map(n => n.getText()), ['loading', 'dirty', 'editing']);
  for (const [loading, dirty, editing, expected] of [
    [false, false, row(), true], [true, false, null, true], [false, true, null, true], [false, false, null, false],
  ]) {
    const observed = [];
    evaluate(effect.arguments[0], { loading, dirty, editing, activityCallback: { current: value => observed.push(value) } })();
    assert.deepEqual(observed, [expected]);
  }
  const dirtyExpression = variable('dirty').initializer.getText();
  assert.match(dirtyExpression, /blocked/);
});

test('malformed ACK IDs never confirm creation, mutate internal rows or invoke parent success', async () => {
  for (const id of [undefined, null, '12', 0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
    const h = fixture(), pending = h.run('saveContract')('create');
    h.calls[0].resolve(response({ ...ack(h, 1), id })); await pending;
    assert.equal(h.saved.length, 0); assert.equal(h.state.Rows, undefined);
    assert.equal(h.state.NewContract, undefined); assert.equal(h.context.createConsumed.current, null);
    assert.equal(h.context.blockedRef.current.kind, 'create');
  }
});

test('amounts require full canonical match in payload and ACK while historical long names remain readable', async () => {
  const h = fixture();
  assert.ok(h.context.contractRow({ ...row(), nombre: 'h'.repeat(300) }));
  for (const amount of ['120\n', '120\r\n', ' 120', '120 ', '120\t']) {
    assert.equal(Boolean(h.context.contractRow({ ...row(), importe_mensual: amount })), false);
    assert.throws(() => h.context.contractPayload({ ...h.context.draft, importe_mensual: amount }));
    const c = fixture(), pending = c.run('saveContract')('create');
    c.calls[0].resolve(response({ ...ack(c, 1), importe_mensual: `${JSON.parse(c.calls[0].options.body).importe_mensual}\n` })); await pending;
    assert.equal(c.saved.length, 0); assert.equal(c.state.Rows, undefined);
    assert.equal(c.context.blockedRef.current.kind, 'create');
  }
});

test('recovery rejects duplicate contract IDs without discarding draft or releasing conflict', async () => {
  const h = fixture({ edit: true });
  const held = { kind: 'edit', id: 12, revision: 'fc1:12:1' };
  h.context.blockedRef.current = held;
  const pending = h.run('recoverContract')();
  h.calls[0].resolve(response([row(2), row(3)])); await pending;
  assert.equal(h.state.Rows, undefined); assert.equal(h.state.Editing, undefined);
  assert.equal(h.state.Draft, undefined); assert.equal(h.context.draft.nombre, 'Edited');
  assert.equal(h.context.blockedRef.current, held); assert.equal(h.saved.length, 0);
  assert.match(h.state.Error, /No se descartaron tus cambios/);
});

test('shared controlled fields have explicit accessible names and create retains visible unhidden labels', () => {
  const fields = variable('fields').initializer;
  const inputs = nodes(fields, ts.isJsxSelfClosingElement).filter(n => n.tagName.getText() === 'input');
  assert.deepEqual(inputs.map(n => n.attributes.properties.find(p => p.name?.getText() === 'aria-label')?.initializer.text),
    ['Contrato financiero', 'Monto mensual', 'Inicia', 'Finaliza']);
  const labels = nodes(fields, ts.isJsxOpeningElement).filter(n => n.tagName.getText() === 'label');
  assert.equal(labels.length, 4);
  for (const label of labels) {
    const expression = label.attributes.properties.find(p => p.name?.getText() === 'className').initializer.expression;
    assert.ok(ts.isConditionalExpression(expression)); assert.equal(expression.condition.getText(), 'create');
    assert.equal(expression.whenTrue.getText(), 'undefined');
    assert.match(expression.whenFalse.text, /^finance-contract-field/);
  }
  const calls = nodes(fn(file, 'ContractsSession'), ts.isCallExpression).filter(n => n.expression.getText() === 'fields');
  const creation = calls.find(n => n.arguments[0].getText() === 'newContract');
  assert.equal(creation.arguments[2].kind, ts.SyntaxKind.TrueKeyword);
  const editing = calls.find(n => n.arguments[0].getText() === 'draft');
  assert.equal(editing.arguments.length, 2);
});
