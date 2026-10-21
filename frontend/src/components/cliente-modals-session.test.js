import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createSessionView, sessionViewInputs } from '../shared/session/session-view.js';
import { driveRequest } from '../features/drive/drive-api.js';

// Actual modal callbacks and shared scope hook, with injected transport and
// hook primitives. These are model/source tests, not mounted React or HTTP QA.
const parse = (name, url) => ts.createSourceFile(name, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const file = parse('ClienteModals.jsx', new URL('./ClienteModals.jsx', import.meta.url));
const shared = parse('use-scoped-request.js', new URL('../shared/session/use-scoped-request.js', import.meta.url));
function nodes(root, predicate) { const found = []; function visit(n) { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); } visit(root); return found; }
const namedFunction = (root, name) => nodes(root, ts.isFunctionDeclaration).find(n => n.name?.text === name);
const variable = name => nodes(file, ts.isVariableDeclaration).find(n => n.name.getText() === name);
const evaluate = (node, context) => new Function(...Object.keys(context), `return (${node.getText().replace(/^export\s+/, '')});`)(...Object.values(context));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const initialRevision = 'a1:12:1:0:0', firstRevision = 'a1:12:2:0:0', finalRevision = 'a1:12:3:0:0';
const event = () => ({ preventDefault() {} });
const client = complete => ({ id: 12, agreement_revision: initialRevision, nombre: 'Synthetic client', activo: true, cuota_reels: 2, cuota_carruseles: 1,
  abono_mensual: 100, configuracion_completa: complete, rubro: 'Synthetic', dias_historias: [1, 3],
  dias_reels: [1], dias_carruseles: [3], disenador_responsable: 'Augusto' });
function fixture({ complete = false, sharedFeed = false, mode = 'cookie' } = {}) {
  const calls = [], effects = [], saved = [], deleted = [], closed = [], state = {}, cleanups = [];
  const store = createBrowserSessionState(); let live;
  const accept = (id = 7) => {
    if (mode === 'bearer') live = { token: `synthetic-${id}`, usuario: { id, rol: 'admin', activo: true } };
    else { const ticket = store.beginBootstrap(); store.acceptBootstrap(ticket, { usuario: { id, usuario: 'synthetic', nombre: 'Synthetic', rol: 'admin' },
      session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) }); live = store.getSession(); }
  };
  accept(); const original = live, view = createSessionView(sessionViewInputs(original));
  const rawFetch = (url, options) => { const d = deferred(); calls.push({ url, options, ...d }); return d.promise; };
  const refs = []; let index = 0, mounted = false;
  const hook = evaluate(namedFunction(shared, 'useScopedRequest'), {
    useSessionView: () => view, useRef: value => refs[index++] ||= { current: value }, useCallback: fn => fn,
    useLayoutEffect: setup => { if (!mounted) cleanups.push(setup()); }, getSesion: () => live,
    apiRequest: (url, options) => driveRequest(url, options, rawFetch), createCapturedRequest,
  });
  const renderScope = context => { index = 0; const result = hook(original, context); mounted = true; return result; };
  const scope = renderScope('client:12');
  const cliente = { ...client(complete), ...(sharedFeed ? { grupo_feed_id: 3, cuota_feed_reels: 4, cuota_feed_carruseles: 2 } : {}) };
  const context = { cliente, capture: scope.capture, pending: { current: false }, nestedEditing: { current: false }, detailAccessDenied: { current: false },
    revision: { current: initialRevision }, blocked: { current: false },
    periodo: '2026-10', nombre: 'Synthetic renamed', activo: complete ? false : true, cuotaReels: '3', cuotaCarruseles: '2',
    cuotaFeedReels: '5', cuotaFeedCarruseles: '3', abonoMensual: '120', diasReels: [4, 1], diasCarruseles: [5],
    esFeedCompartido: sharedFeed, formularioValido: true, getMesActualISO: () => '2026-10', snapshot: 'edited', baseline: { current: 'initial' },
    window: { confirm: () => true }, onClose: () => closed.push(true),
    onGuardado: async (value, guard) => { assert.equal(guard.current(), true); saved.push({ value, guard }); },
    onClienteEliminado: async (id, guard) => { assert.equal(guard.current(), true); deleted.push(id); },
  };
  for (const name of ['Guardando', 'Error', 'Enviando', 'EditandoCuota', 'NeedsReload', 'Cliente', 'Nombre', 'Activo', 'CuotaReels', 'CuotaCarruseles', 'CuotaFeedReels', 'CuotaFeedCarruseles', 'AbonoMensual', 'DiasReels', 'DiasCarruseles']) context[`set${name}`] = value => { state[name] = value; effects.push(name); };
  context.object = evaluate(variable('object').initializer, {});
  context.sameClient = evaluate(variable('sameClient').initializer, {});
  context.monthStart = evaluate(variable('monthStart').initializer, {});
  context.validPeriod = evaluate(variable('validPeriod').initializer, {});
  context.agreementParts = evaluate(namedFunction(file, 'agreementParts'), context);
  context.advanceAgreement = evaluate(namedFunction(file, 'advanceAgreement'), context);
  context.assertClientAck = evaluate(namedFunction(file, 'assertClientAck'), context);
  context.assertFeeAck = evaluate(namedFunction(file, 'assertFeeAck'), context);
  return { context, calls, effects, saved, deleted, closed, state, store, accept, renderScope,
    run: name => evaluate(variable(name).initializer, context), unmount: () => cleanups.forEach(fn => fn?.()) };
}
function firstAck(h) {
  const payload = JSON.parse(h.calls[0].options.body);
  return h.context.cliente.configuracion_completa && !h.context.esFeedCompartido
    ? { ...payload, id: 12, dias_reels: [...payload.dias_reels].sort(), dias_carruseles: [...payload.dias_carruseles].sort(),
      agreement_revision: firstRevision, configuracion_completa: true, configuracion_vigente_desde: `${payload.vigente_desde}-01`, abono_vigente_desde: `${payload.vigente_desde}-01` }
    : { ...payload, id: 12, agreement_revision: firstRevision };
}

test('config and active save share one genuine cookie intent and validate each ACK before notifying', async () => {
  const h = fixture({ complete: true }), pending = h.run('guardar')(event());
  assert.equal(h.calls[0].url, '/api/clientes/12/configuraciones'); assert.equal(h.calls[0].options.method, 'POST');
  const intent = h.calls[0].options.sessionIntent; assert.equal(h.store.isCurrent(intent), true);
  assert.equal(new Headers(h.calls[0].options.headers).has('Authorization'), false);
  h.calls[0].resolve(response(firstAck(h))); await settle();
  assert.equal(h.calls[1].url, '/api/clientes/12'); assert.deepEqual(JSON.parse(h.calls[1].options.body), { activo: false, expected_revision: firstRevision });
  assert.equal(h.calls[1].options.sessionIntent, intent);
  h.calls[1].resolve(response({ id: 12, activo: false, agreement_revision: finalRevision })); await pending;
  assert.equal(h.calls.length, 2); assert.equal(h.saved.length, 1); assert.equal(h.saved[0].value.activo, false);
  assert.equal(h.saved[0].value.abono_mensual, 120); assert.equal(h.context.baseline.current, 'edited'); assert.equal(h.state.Guardando, false);
});

test('legacy client quota update and separate next-month fee preserve endpoint/payload and captured bearer', async () => {
  const h = fixture({ mode: 'bearer' }), pending = h.run('guardar')(event());
  assert.equal(h.calls[0].options.method, 'PATCH'); assert.equal(Object.hasOwn(JSON.parse(h.calls[0].options.body), 'abono_mensual'), false);
  h.calls[0].resolve(response(firstAck(h))); await settle();
  assert.equal(h.calls[1].url, '/api/clientes/12/abono-proximo-mes'); assert.deepEqual(JSON.parse(h.calls[1].options.body), { importe: 120, expected_revision: firstRevision });
  assert.ok(h.calls.every(call => new Headers(call.options.headers).get('Authorization') === 'Bearer synthetic-7'));
  h.calls[1].resolve(response({ cliente_id: 12, importe: '120.00', vigente_desde: '2026-11-01', agreement_revision: finalRevision })); await pending;
  assert.equal(h.saved[0].value.abono_proximo_mes, '120.00'); assert.equal(h.saved[0].value.abono_proximo_vigente_desde, '2026-11-01');
});

test('shared-feed edit preserves shared quota semantics rather than creating per-account monthly config', async () => {
  const h = fixture({ complete: true, sharedFeed: true }), pending = h.run('guardar')(event());
  assert.equal(h.calls[0].url, '/api/clientes/12');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { nombre: 'Synthetic renamed', activo: false, cuota_feed_reels: 5, cuota_feed_carruseles: 3, expected_revision: initialRevision });
  h.calls[0].resolve(response(firstAck(h))); await settle();
  h.calls[1].resolve(response({ cliente_id: 12, importe: '120', vigente_desde: '2026-11-01', agreement_revision: finalRevision })); await pending;
  assert.equal(h.saved.length, 1);
});

for (const invalid of [null, {}, { id: 99 }, { id: 12, configuracion_completa: true }]) test(`invalid first ACK ${JSON.stringify(invalid)} stops chain without fabricated success`, async () => {
  const h = fixture({ complete: true }), pending = h.run('guardar')(event()); h.calls[0].resolve(response(invalid)); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 0); assert.match(h.state.Error, /no confirmó/);
});

for (const stage of ['active', 'fee']) test(`${stage} failure after confirmed first step reports partial commit and keeps form`, async () => {
  const h = fixture({ complete: stage === 'active' }), pending = h.run('guardar')(event());
  h.calls[0].resolve(response(firstAck(h))); await settle();
  h.calls[1].reject(new TypeError('Synthetic later step failed')); await pending;
  assert.equal(h.saved.length, 0); assert.equal(h.calls.length, 2);
  assert.match(h.state.Error, stage === 'active' ? /La configuración mensual se guardó.*No se confirmó el estado/ : /Los datos del cliente se guardaron.*No se confirmó el abono/);
  assert.equal(h.context.baseline.current, 'initial'); assert.equal(h.context.pending.current, false); assert.equal(h.context.nombre, 'Synthetic renamed');
});

test('wrong fee ACK cannot notify success or pretend previous client update rolled back', async () => {
  const h = fixture(), pending = h.run('guardar')(event()); h.calls[0].resolve(response(firstAck(h))); await settle();
  h.calls[1].resolve(response({ cliente_id: 99, importe: '120', vigente_desde: '2026-11-01' })); await pending;
  assert.equal(h.saved.length, 0); assert.match(h.state.Error, /Los datos del cliente se guardaron/);
});

for (const point of ['first', 'second']) for (const replacement of ['B', 'unmount', 'context', 'contextABA']) test(`${replacement} during ${point} save blocks stale effects, next writes and success callbacks`, async () => {
  const h = fixture({ complete: true }), pending = h.run('guardar')(event());
  if (point === 'second') { h.calls[0].resolve(response(firstAck(h))); await settle(); }
  const count = h.effects.length;
  if (replacement === 'B') h.accept(8); else if (replacement === 'unmount') h.unmount(); else {
    h.renderScope('client:13'); if (replacement === 'contextABA') h.renderScope('client:12');
  }
  h.calls.at(-1).resolve(response(point === 'first' ? firstAck(h) : { id: 12, activo: false })); await pending;
  assert.equal(h.calls.length, point === 'first' ? 1 : 2); assert.equal(h.effects.length, count); assert.equal(h.saved.length, 0);
});

test('same-tick duplicate save and Escape/close are blocked; dirty close requires user discard confirmation', async () => {
  const h = fixture({ complete: true }), save = h.run('guardar'), pending = save(event());
  await save(event()); h.run('closeEditor')(); assert.equal(h.calls.length, 1); assert.equal(h.closed.length, 0);
  h.calls[0].reject(new TypeError('Synthetic failure')); await pending;
  h.context.window.confirm = () => false; h.run('closeEditor')(); assert.equal(h.closed.length, 0);
  h.context.window.confirm = () => true; h.run('closeEditor')(); assert.equal(h.closed.length, 1);
});

test('delete requires existing confirmation, one original scope and actual matching delete ACK', async () => {
  const h = fixture(), remove = h.run('handleEliminarCliente'); h.context.window.confirm = () => false;
  await remove(); assert.equal(h.calls.length, 0);
  h.context.window.confirm = () => true; const pending = remove(); await remove(); h.run('closeDetail')();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.method, 'DELETE'); assert.equal(h.closed.length, 0);
  h.calls[0].resolve(response({ ok: true, cliente: { id: 12, nombre: 'Synthetic client' } })); await pending;
  assert.deepEqual(h.deleted, [12]); assert.equal(h.state.Enviando, null);
});

for (const outcome of ['wrongAck', 'B', 'unmount']) test(`delete ${outcome} cannot invoke parent success callback`, async () => {
  const h = fixture(), pending = h.run('handleEliminarCliente')(), count = h.effects.length;
  if (outcome === 'B') h.accept(8); if (outcome === 'unmount') h.unmount();
  h.calls[0].resolve(response({ ok: true, cliente: { id: outcome === 'wrongAck' ? 99 : 12 } })); await pending;
  assert.deepEqual(h.deleted, []); if (outcome !== 'wrongAck') assert.equal(h.effects.length, count);
});

test('nested edit passes original session and scopes each parent callback before closing', async () => {
  const h = fixture(); let second = 0;
  const nested = nodes(file, ts.isJsxSelfClosingElement).find(n => n.tagName.getText() === 'EditarCuotaClienteModal');
  const props = new Map(nested.attributes.properties.map(p => [p.name?.getText(), p.initializer?.expression]));
  assert.equal(props.get('sesion').getText(), 'sesion');
  const callback = evaluate(props.get('onGuardado'), { ...h.context,
    onClienteActualizado: async () => h.accept(8), onCuotaActualizada: async () => second++ });
  const guard = h.context.capture(); await assert.rejects(callback({ id: 12 }, guard), error => error.code === 'session_binding_obsolete');
  assert.equal(second, 0); assert.equal(h.state.EditandoCuota, undefined);
});

test('source uses no raw fetch/json; modal close and editable controls use pending guards and session-keyed lifetime', () => {
  const source = file.getText(); assert.doesNotMatch(source, /\bfetch\s*\(|\.json\s*\(|localStorage|sessionStorage/);
  assert.match(source, /useScopedRequest\(sesion, `editar-cliente:/); assert.match(source, /useScopedRequest\(sesion, `detalle-cliente:/);
  assert.match(source, /onClose=\{closeEditor\}/); assert.match(source, /onClose=\{closeDetail\}/);
  const inputs = nodes(namedFunction(file, 'EditarCuotaSession'), ts.isJsxSelfClosingElement).filter(n => n.tagName.getText() === 'input');
  assert.equal(inputs.length, 7);
  assert.ok(inputs.every(n => n.attributes.properties.some(p => p.name?.getText() === 'disabled' && p.initializer.expression.getText() === 'guardando')));
  assert.match(source, /pending.current \|\| nestedEditing.current/);
});

test('complete monthly config with unchanged active flag requires no separate fee or status request', async () => {
  const h = fixture({ complete: true }); h.context.activo = true;
  const pending = h.run('guardar')(event()); h.calls[0].resolve(response(firstAck(h))); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 1); assert.equal(h.saved[0].value.abono_mensual, 120);
});

test('wrong monthly ACK period or days stop subsequent status write without announcing complete save', async () => {
  for (const incorrect of [{ configuracion_vigente_desde: '2026-11-01' }, { dias_reels: [6] }]) {
    const h = fixture({ complete: true }), pending = h.run('guardar')(event());
    h.calls[0].resolve(response({ ...firstAck(h), ...incorrect })); await pending;
    assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 0); assert.match(h.state.Error, /no confirmó/);
  }
});

test('wrong status ACK preserves confirmed configuration and reports partial success', async () => {
  const h = fixture({ complete: true }), pending = h.run('guardar')(event());
  h.calls[0].resolve(response(firstAck(h))); await settle(); h.calls[1].resolve(response({ id: 12, activo: true })); await pending;
  assert.equal(h.saved.length, 0); assert.match(h.state.Error, /La configuración mensual se guardó.*No se confirmó el estado/);
});

test('parent callback failure after validated writes reports committed data, not a rolled back save', async () => {
  const h = fixture({ complete: true }); h.context.activo = true;
  h.context.onGuardado = async () => { throw new Error('Synthetic view refresh failed'); };
  const pending = h.run('guardar')(event()); h.calls[0].resolve(response(firstAck(h))); await pending;
  assert.match(h.state.Error, /La configuración mensual se guardó.*la actualización de la vista/);
  assert.equal(h.context.baseline.current, 'edited'); assert.equal(h.calls.length, 1);
});

test('historical monthly configuration uses selected period, not the current browser month', async () => {
  const h = fixture({ complete: true });
  h.context.periodo = '2025-08'; h.context.activo = true;
  h.context.getMesActualISO = () => { throw new Error('Must not replace selected period'); };
  const pending = h.run('guardar')(event());
  assert.equal(JSON.parse(h.calls[0].options.body).vigente_desde, '2025-08');
  h.calls[0].resolve(response(firstAck(h))); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].value.configuracion_vigente_desde, '2025-08-01');
  assert.equal(h.saved[0].value.abono_vigente_desde, '2025-08-01');
});

for (const field of ['configuracion_vigente_desde', 'abono_vigente_desde']) test(`historical ${field} ACK from another month cannot announce success or continue`, async () => {
  const h = fixture({ complete: true }); h.context.periodo = '2025-08';
  const pending = h.run('guardar')(event());
  h.calls[0].resolve(response({ ...firstAck(h), [field]: '2026-10-01' })); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 0);
  assert.equal(h.context.baseline.current, 'initial'); assert.match(h.state.Error, /no confirmó/);
});

test('invalid explicit periods cannot write or delete', async () => {
  for (const periodo of [null, '', '2026-00', '2026-13', '2026-8', '2026-08-01', 202608]) {
    const h = fixture({ complete: true }); h.context.periodo = periodo;
    await h.run('guardar')(event());
    h.context.window.confirm = () => { throw new Error('Invalid period must stop before confirmation'); };
    await h.run('handleEliminarCliente')();
    assert.equal(h.calls.length, 0); assert.equal(h.saved.length, 0); assert.match(h.state.Error, /período válido/);
  }
});

test('historical shared feed edit still schedules fee for server next month, not selected month', async () => {
  const h = fixture({ sharedFeed: true }); h.context.periodo = '2025-08';
  const pending = h.run('guardar')(event());
  h.calls[0].resolve(response(firstAck(h))); await settle();
  assert.match(h.calls[1].url, /\/abono-proximo-mes$/);
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { importe: 120, expected_revision: firstRevision });
  h.calls[1].resolve(response({ cliente_id: 12, importe: '120', vigente_desde: '2026-11-01', agreement_revision: finalRevision })); await pending;
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].value.abono_proximo_vigente_desde, '2026-11-01');
});

test('period is explicit in both scoped lifetimes, nested editor and truthful timing labels', () => {
  for (const name of ['EditarCuotaClienteModal', 'DetalleClienteModal']) {
    const wrapper = namedFunction(file, name);
    const period = wrapper.parameters[0].name.elements.find(n => n.name.getText() === 'periodo');
    assert.equal(period.initializer.getText(), 'getMesActualISO()');
    const call = nodes(wrapper, ts.isCallExpression).find(n => n.expression.getText() === 'useScopedRequest');
    assert.match(call.arguments[1].getText(), /\$\{periodo\}/);
  }
  const nested = nodes(file, ts.isJsxSelfClosingElement).find(n => n.tagName.getText() === 'EditarCuotaClienteModal');
  assert.equal(nested.attributes.properties.find(p => p.name?.getText() === 'periodo').initializer.expression.getText(), 'periodo');
  assert.match(file.getText(), /Período seleccionado: \{periodo\}/);
  assert.match(file.getText(), /El abono se programa para el próximo mes del servidor, no para el período seleccionado/);
});

test('missing, malformed or foreign initial agreement refuses save and delete before dispatch', async () => {
  for (const value of [undefined, 'a1:1:0:0', 'a1:13:1:0:0', 'a1:12:01:0:0', 'a1:12:2147483648:0:0', 'a1:12:1:0:1']) {
    const h = fixture(); h.context.revision.current = value; h.context.cliente.agreement_revision = value;
    await h.run('guardar')(event()); await h.run('handleEliminarCliente')();
    assert.equal(h.calls.length, 0); assert.equal(h.state.NeedsReload, true);
    assert.match(h.state.Error, /revisión válida/);
  }
});

test('agreement ACK must advance counters without changing client or group identity', async () => {
  for (const value of [undefined, initialRevision, 'a1:13:2:0:0', 'a1:12:0:0:0', 'a1:12:2:3:1']) {
    const h = fixture({ complete: true }), pending = h.run('guardar')(event());
    h.calls[0].resolve(response({ ...firstAck(h), agreement_revision: value })); await pending;
    await h.run('guardar')(event());
    assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 0);
    assert.equal(h.context.blocked.current, true); assert.equal(h.context.baseline.current, 'initial');
  }
  const h = fixture();
  assert.equal(h.context.advanceAgreement('a1:12:1:3:4', 'a1:12:1:3:5'), 'a1:12:1:3:5');
  assert.throws(() => h.context.advanceAgreement('a1:12:2:3:4', 'a1:12:3:3:3'));
});

for (const failure of ['conflict', 'network', 'partial']) test(`${failure} blocks repeating full chain and preserves draft`, async () => {
  const h = fixture({ complete: true }), pending = h.run('guardar')(event());
  assert.equal(JSON.parse(h.calls[0].options.body).expected_revision, initialRevision);
  if (failure === 'partial') {
    h.calls[0].resolve(response(firstAck(h))); await settle();
    h.calls[1].resolve(response({ error: 'Conflict', code: 'CLIENT_AGREEMENT_CONFLICT' }, 409));
  } else if (failure === 'network') h.calls[0].reject(new TypeError('Synthetic uncertain response'));
  else h.calls[0].resolve(response({ error: 'Conflict', code: 'CLIENT_AGREEMENT_CONFLICT' }, 409));
  await pending; const count = h.calls.length; await h.run('guardar')(event());
  assert.equal(h.calls.length, count); assert.equal(h.context.nombre, 'Synthetic renamed');
  assert.equal(h.context.baseline.current, 'initial'); assert.equal(h.state.NeedsReload, true);
  assert.equal(h.saved.length, 0);
  if (failure === 'partial') assert.match(h.state.Error, /La configuración mensual se guardó/);
});

test('explicit recovery loads same client/period then replaces fields and revision without a write or success callback', async () => {
  const h = fixture(); h.context.periodo = '2025-08'; h.context.blocked.current = true;
  const pending = h.run('reloadAgreement')();
  assert.equal(h.calls[0].url, '/api/clientes?periodo=2025-08');
  const row = { ...client(true), nombre: 'Server version', agreement_revision: 'a1:12:7:0:0' };
  h.calls[0].resolve(response([{ ...row, id: 99 }, row])); await pending;
  assert.equal(h.state.Nombre, 'Server version'); assert.deepEqual(h.state.Cliente, row);
  assert.equal(h.context.revision.current, row.agreement_revision); assert.equal(h.context.blocked.current, false);
  assert.equal(h.state.NeedsReload, false); assert.equal(h.saved.length, 0);
  assert.equal(h.calls.length, 1);
});

for (const result of ['network', 'missing', 'foreignRevision', 'B', 'unmount']) test(`recovery ${result} never discards draft or silently rebases`, async () => {
  const h = fixture(); h.context.blocked.current = true;
  const pending = h.run('reloadAgreement')(), effects = h.effects.length;
  if (result === 'B') h.accept(8); if (result === 'unmount') h.unmount();
  if (result === 'network') h.calls[0].reject(new TypeError('Synthetic failure'));
  else h.calls[0].resolve(response(result === 'missing' ? [] : [{ ...client(true), agreement_revision: result === 'foreignRevision' ? 'a1:99:7:0:0' : 'a1:12:7:0:0' }]));
  await pending;
  assert.equal(h.state.Cliente, undefined); assert.equal(h.state.Nombre, undefined);
  assert.equal(h.context.revision.current, initialRevision); assert.equal(h.context.baseline.current, 'initial');
  assert.equal(h.context.blocked.current, true); assert.equal(h.saved.length, 0);
  if (result === 'B' || result === 'unmount') assert.equal(h.effects.length, effects);
});

test('DELETE carries original agreement revision and final save publishes last fee ACK revision', async () => {
  const h = fixture(), pending = h.run('handleEliminarCliente')();
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { expected_revision: initialRevision });
  h.calls[0].resolve(response({ ok: true, cliente: { id: 12 } })); await pending;
  const save = fixture(), writing = save.run('guardar')(event());
  save.calls[0].resolve(response(firstAck(save))); await settle();
  save.calls[1].resolve(response({ cliente_id: 12, importe: '120', vigente_desde: '2026-11-01', agreement_revision: finalRevision })); await writing;
  assert.equal(save.saved[0].value.agreement_revision, finalRevision);
});

test('fee ACK with unchanged revision preserves confirmed client step but blocks whole-chain retry', async () => {
  const h = fixture(), pending = h.run('guardar')(event());
  h.calls[0].resolve(response(firstAck(h))); await settle();
  h.calls[1].resolve(response({ cliente_id: 12, importe: '120', vigente_desde: '2026-11-01', agreement_revision: firstRevision })); await pending;
  await h.run('guardar')(event());
  assert.equal(h.calls.length, 2); assert.equal(h.saved.length, 0);
  assert.match(h.state.Error, /Los datos del cliente se guardaron/);
  assert.equal(h.context.blocked.current, true);
});

test('recovery period replacement suppresses late results and explicit recovery is wired separately from save', async () => {
  const h = fixture(); h.context.blocked.current = true;
  const pending = h.run('reloadAgreement')(), effects = h.effects.length;
  h.renderScope('client:12:2025-08');
  h.calls[0].resolve(response([{ ...client(true), agreement_revision: finalRevision }])); await pending;
  assert.equal(h.effects.length, effects); assert.equal(h.context.blocked.current, true);
  const editor = namedFunction(file, 'EditarCuotaSession');
  const buttons = nodes(editor, ts.isJsxElement).filter(n => n.openingElement.tagName.getText() === 'button');
  const recovery = buttons.find(n => n.getText().includes('Descartar mis cambios y cargar versión guardada'));
  assert.ok(recovery);
  assert.equal(recovery.openingElement.attributes.properties.find(p => p.name?.getText() === 'onClick').initializer.expression.getText(), 'reloadAgreement');
  assert.match(file.getText(), /disabled=\{guardando \|\| needsReload \|\| !formularioValido\}/);
});

test('canonical agreement tokens reject zero client versions, half-present groups and trailing newlines before dispatch and in ACKs', async () => {
  for (const token of ['a1:12:0:0:0', 'a1:0:1:0:0', 'a1:12:1:3:0', 'a1:12:1:0:3',
    'a1:12:2:0:0\n', 'a1:12:2:0:0\r\n', 'a1:12:2:2147483648:1', 'a1:12:2:3:2147483648']) {
    const initial = fixture(); initial.context.revision.current = token;
    await initial.run('guardar')(event());
    assert.equal(initial.calls.length, 0, token); assert.equal(initial.state.NeedsReload, true);
    const h = fixture({ complete: true }), pending = h.run('guardar')(event());
    h.calls[0].resolve(response({ ...firstAck(h), agreement_revision: token })); await pending;
    assert.equal(h.calls.length, 1, token); assert.equal(h.saved.length, 0);
    assert.equal(h.context.blocked.current, true); assert.equal(h.context.revision.current, initialRevision);
  }
  const h = fixture();
  assert.deepEqual(h.context.agreementParts('a1:2147483647:2147483647:2147483647:2147483647'),
    [2147483647, 2147483647, 2147483647, 2147483647]);
});
