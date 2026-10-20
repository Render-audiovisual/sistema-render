import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPersonalHomeLoader } from './personalHome.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { captureSessionBinding } from '../shared/session/session-binding.js';
const ts = createRequire(new URL('../../package.json', import.meta.url))('typescript');
const sourceFile = name => ts.createSourceFile(name, readFileSync(new URL(name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root); return found;
}
const compact = node => node.getText().replace(/\s+/g, '');

test('QuickHome captures the stable view and fences bound requests before and after HTTP', () => {
  const file = sourceFile('./QuickHome.jsx');
  const calls = nodes(file, ts.isCallExpression);
  assert.ok(calls.some(n => n.expression.getText() === 'useSessionView' && n.arguments[0]?.getText() === 'sesion'));
  const scope = nodes(file, ts.isVariableDeclaration).find(n => n.name.getText() === 'scopedRequest').initializer;
  const statements = scope.body.statements;
  const awaited = statements.findIndex(n => nodes(n, ts.isAwaitExpression).length > 0);
  assert.ok(awaited > 0);
  assert.ok(statements.slice(0, awaited).some(n => ts.isIfStatement(n) && compact(n.expression) === '!current()'));
  assert.ok(statements.slice(awaited + 1).some(n => ts.isIfStatement(n) && compact(n.expression) === '!current()'));
  assert.ok(nodes(scope, ts.isCallExpression).some(n => n.expression.getText() === 'sessionRequestOptions' && n.arguments[0]?.getText() === 'captured.binding'));
  assert.ok(nodes(scope, ts.isCallExpression).some(n => n.expression.getText() === 'sessionBindingMatches' && compact(n.arguments[1]) === 'getSesion()'));
  const loader = calls.find(n => n.expression.getText() === 'createPersonalHomeLoader').arguments[0];
  const properties = new Map(loader.properties.map(p => [p.name.getText(), p.initializer?.getText()]));
  assert.equal(properties.get('sesion'), 'captured.session'); assert.equal(properties.get('binding'), 'captured.binding');
  assert.equal(properties.get('readSession'), 'getSesion'); assert.equal(properties.get('request'), 'scopedRequest');
  assert.ok(calls.some(n => n.expression.getText() === 'loader.dispose'));
});

test('Feedback inventory keys and reload dependencies use the stable view, preserving original session DTO', () => {
  const file = sourceFile('./FeedbackTaskInventory.jsx');
  const inventory = nodes(file, ts.isJsxSelfClosingElement).find(n => n.tagName.getText() === 'Inventory');
  const attributes = new Map(inventory.attributes.properties.map(p => [p.name?.getText(), p.initializer?.expression?.getText()]));
  assert.equal(attributes.get('key'), 'view.key'); assert.equal(attributes.get('view'), 'view');
  const effects = nodes(file, ts.isCallExpression).filter(n => n.expression.getText() === 'useEffect');
  const effect = effects.find(n => nodes(n.arguments[0], ts.isCallExpression).some(c => c.expression.getText() === 'createFeedbackInventoryLoader'));
  assert.ok(effect.arguments[1].elements.some(n => n.getText() === 'view'));
  const loader = nodes(effect.arguments[0], ts.isCallExpression).find(n => n.expression.getText() === 'createFeedbackInventoryLoader');
  const session = loader.arguments[0].properties.find(n => n.name.getText() === 'sesion');
  assert.equal(session.initializer.getText(), 'view.session');
  assert.ok(nodes(effect, ts.isCallExpression).some(n => n.expression.getText() === 'loader.dispose'));
});

const dto = id => ({ version: 1, user: { id, nombre: 'Synthetic' }, today: '2026-10-20', generated_at: '2026-10-20T12:00:00Z',
  summary: { open: 0, overdue: 0, today: 0, upcoming: 0, undated: 0, awaiting_review: 0 },
  review: { scope: 'personal', total: 0, items: [] }, tasks: [], clients: [], visits: [], activity: [],
  list_totals: { clients: 0, visits: 0, activity: 0 }, capabilities: { projects: false } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function cookieStore() {
  const store = createBrowserSessionState();
  const accept = (id = 11, context = 'a', csrf = 'b') => {
    const ticket = store.beginBootstrap();
    store.acceptBootstrap(ticket, { usuario: { id, usuario: 'synthetic', nombre: 'Synthetic', rol: 'edicion' },
      session_context: context.repeat(43), csrf_token: csrf.repeat(43) });
    return store.getSession();
  };
  return { store, accept };
}

test('personal home cookie request retains actual registered intent and closed user projection without bearer', async () => {
  const h = cookieStore(), sesion = h.accept(), states = [], calls = [];
  const loader = createPersonalHomeLoader({ sesion, readSession: h.store.getSession, onChange: value => states.push(value),
    request: async (url, options) => { calls.push({ url, options }); return dto(11); } });
  assert.equal(await loader.refresh(), true); assert.equal(calls.length, 1);
  const { options } = calls[0], headers = new Headers(options.headers);
  assert.equal(calls[0].url, '/api/inicio'); assert.equal(h.store.isCurrent(options.sessionIntent), true);
  assert.equal(headers.has('Authorization'), false);
  assert.equal(headers.get('X-Render-Session-Context'), 'a'.repeat(43));
  assert.equal(headers.get('X-Render-CSRF'), 'b'.repeat(43));
  assert.equal(states.at(-1).data.user.id, 11); loader.dispose();
});

for (const outcome of ['success', 'failure']) test(`cookie B suppresses late A ${outcome} and prevents refresh under B`, async () => {
  const h = cookieStore(), sesion = h.accept(), states = [], pending = deferred(); let calls = 0;
  const loader = createPersonalHomeLoader({ sesion, readSession: h.store.getSession, onChange: state => states.push(state),
    request: () => { calls++; return pending.promise; } });
  const loading = loader.refresh(); h.accept(12, 'c', 'd');
  if (outcome === 'success') pending.resolve(dto(11)); else pending.reject(Object.assign(new Error('synthetic'), { status: 401 }));
  assert.equal(await loading, false); assert.deepEqual(states.map(state => state.status), ['loading']);
  assert.equal(await loader.refresh(), false); assert.equal(calls, 1); loader.dispose();
});

test('same-ID rebootstrap also obsoletes the old cookie binding before dispatch', async () => {
  const h = cookieStore(), sesion = h.accept(); let calls = 0;
  const loader = createPersonalHomeLoader({ binding: captureSessionBinding(sesion), readSession: h.store.getSession,
    onChange() {}, request: async () => { calls++; return dto(11); } });
  h.accept(); assert.equal(await loader.refresh(), false); assert.equal(calls, 0); loader.dispose();
});

test('unregistered cookie-shaped session cannot dispatch; legacy bearer and userId-only APIs remain supported', async () => {
  const h = cookieStore(), original = h.accept(); let calls = 0;
  const fake = { ...original };
  const denied = createPersonalHomeLoader({ sesion: fake, onChange() {}, request: async () => { calls++; return dto(11); } });
  assert.equal(await denied.refresh(), false); assert.equal(calls, 0); denied.dispose();
  const bearer = { token: 'synthetic', usuario: { id: 11, rol: 'edicion', activo: true } };
  const legacy = createPersonalHomeLoader({ sesion: bearer, onChange() {}, request: async (_url, options) => {
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer synthetic'); return dto(11);
  } });
  assert.equal(await legacy.refresh(), true); legacy.dispose();
  const pure = createPersonalHomeLoader({ userId: 11, onChange() {}, request: async (_url, options) => {
    assert.equal(options.headers, undefined); return dto(11);
  } });
  assert.equal(await pure.refresh(), true); pure.dispose();
});

test('disposal aborts cookie transport and suppresses its eventual valid response', async () => {
  const h = cookieStore(), pending = deferred(), states = []; let signal;
  const loader = createPersonalHomeLoader({ sesion: h.accept(), readSession: h.store.getSession, onChange: value => states.push(value),
    request: (_url, options) => { signal = options.signal; return pending.promise; } });
  const result = loader.refresh(); loader.dispose(); assert.equal(signal.aborted, true);
  pending.resolve(dto(11)); assert.equal(await result, false); assert.equal(states.length, 1);
});
