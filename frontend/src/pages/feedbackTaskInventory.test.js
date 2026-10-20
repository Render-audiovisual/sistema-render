import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { normalizeInventorySelection, readInventoryLocation, inventoryLocationUrl, inventoryRequestUrl, parseFeedbackTaskInventory, createFeedbackInventoryLoader } from './feedbackTaskInventory.js';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const session = () => ({ token: 'synthetic-token', usuario: { id: 7, rol: 'admin', activo: true } });
const row = () => ({ task_id: 1, revision: 4, titulo: '<img src=x onerror=alert(1)>', estado: 'en_revision', cliente: { id: 8, nombre: 'Cliente' },
  latest_delivery: { id: uuid(1), task_revision: 2, recorded_at: '2026-10-20T12:00:00.000Z' },
  latest_decision: null, has_corrections: false, href: '/workspace/tareas?task=1' });
const envelope = () => ({ version: 1, limit: 20, offset: 0, total: 1, has_more: false, items: [row()] });
test('closed inventory keeps literal text and strips notes/finance from every projection without mutation', () => {
  const value = envelope(); value.finance = 900; value.items[0].notes = 'private'; value.items[0].cliente.salary = 9; value.items[0].latest_delivery.url = 'javascript:bad';
  const before = JSON.stringify(value); assert.deepEqual(parseFeedbackTaskInventory(value), envelope()); assert.equal(JSON.stringify(value), before);
  const history = envelope(); history.items[0].estado = 'finalizada'; history.items[0].has_corrections = true;
  history.items[0].latest_decision = { id: uuid(2), delivery_id: uuid(1), action: 'correcciones', task_revision: 3, recorded_at: '2026-10-20T12:00:00.000Z' };
  assert.equal(parseFeedbackTaskInventory(history, { view: 'with_corrections' }).items[0].estado, 'finalizada');
});
test('strict envelope and row identity/date/count membership rejects malformed responses', () => {
  for (const patch of [{ version: 2 }, { limit: 100 }, { offset: 20 }, { total: -1 }, { total: 2 }, { has_more: true }, { items: {} }, { items: [row(), row()], total: 2 }]) assert.throws(() => parseFeedbackTaskInventory({ ...envelope(), ...patch }));
  for (const patch of [{ task_id: '1' }, { task_id: 2147483648 }, { revision: 0 }, { titulo: {} }, { estado: 'unknown' }, { href: 'https://evil.test' }, { href: '/workspace/tareas?task=2' },
    { cliente: {} }, { latest_delivery: {} }, { latest_delivery: { ...row().latest_delivery, recorded_at: '2026-02-30' } }, { latest_delivery: { ...row().latest_delivery, task_revision: 5 } },
    { latest_decision: {} }, { has_corrections: 'true' }, { latest_delivery: null }]) assert.throws(() => parseFeedbackTaskInventory({ ...envelope(), items: [{ ...row(), ...patch }] }));
  assert.throws(() => parseFeedbackTaskInventory(envelope(), { view: 'with_corrections' }));
  assert.throws(() => parseFeedbackTaskInventory(envelope(), { cliente_id: 9 }));
  assert.equal(parseFeedbackTaskInventory({ ...envelope(), offset: 20, items: [] }, { offset: 20 }).total, 1);
  const second = { ...row(), task_id: 2, href: '/workspace/tareas?task=2' };
  assert.throws(() => parseFeedbackTaskInventory({ ...envelope(), total: 2, items: [row(), second] }));
  assert.equal(parseFeedbackTaskInventory({ ...envelope(), total: 2, items: [second, row()] }).items.length, 2);
});
test('bounded request URL and independent location keys preserve note context and hash', () => {
  const selection = { view: 'with_corrections', offset: 20, q: 'video & edición', cliente_id: 8 };
  assert.equal(inventoryRequestUrl(selection), '/api/tareas-edicion/inventario-feedback?limit=20&offset=20&view=with_corrections&q=video+%26+edici%C3%B3n&cliente_id=8');
  const next = inventoryLocationUrl('https://render.test/feedback?section=team&note=42#detail', selection);
  assert.ok(next.startsWith('/feedback?')); assert.match(next, /section=team&note=42/); assert.ok(next.endsWith('#detail'));
  assert.deepEqual(readInventoryLocation(new URL(next, 'https://render.test').search), selection);
  const legacy = inventoryLocationUrl('https://render.test/bloc-notas?section=team&note=42#detail', selection);
  assert.equal(legacy, next);
  for (const search of ['?inv_view=bad', '?inv_page=01', '?inv_page=1', '?inv_page=1000020', '?inv_view=all&inv_view=all', '?inv_q=a&inv_q=b', '?inv_cliente=0']) assert.throws(() => readInventoryLocation(search));
  for (const patch of [{ q: 'x'.repeat(201) }, { q: 'bad\nquery' }, { offset: Infinity }, { cliente_id: 2147483648 }]) assert.throws(() => normalizeInventorySelection(patch));
  assert.throws(() => inventoryLocationUrl('https://render.test/inicio', {}));
});
test('loader uses captured bearer and abort/generation suppresses stale pages and unmounted replies', async () => {
  const calls = [], events = []; const pending = [];
  const loader = createFeedbackInventoryLoader({ sesion: session(), readSession: session, onChange: s => events.push(s), request: (url, options) => { calls.push({ url, options }); return new Promise(resolve => pending.push(resolve)); } });
  const first = loader.load({}), second = loader.load({ offset: 20 });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-token'); assert.equal(calls[0].options.signal.aborted, true);
  pending[1]({ ...envelope(), offset: 20, items: [] }); await second; pending[0](envelope()); await first;
  assert.equal(events.at(-1).data.offset, 20);
  const last = loader.load({}); const count = events.length; loader.dispose(); pending[2](envelope()); await last; assert.equal(events.length, count);
});
test('live ID/token/role/activity changes deny late success and errors without private data', async () => {
  for (const change of [s => s.usuario.id++, s => s.token = 'new', s => s.usuario.rol = 'edicion', s => s.usuario.activo = false]) {
    for (const fail of [true, false]) {
      const live = session(), events = []; let finish, reject;
      const loader = createFeedbackInventoryLoader({ sesion: session(), readSession: () => live, onChange: s => events.push(s), request: () => new Promise((resolve, r) => { finish = resolve; reject = r; }) });
      const pending = loader.load({}); change(live); if (fail) reject(Error('offline')); else finish(envelope()); await pending;
      assert.equal(events.at(-1).status, 'error'); assert.equal(events.at(-1).data, null); loader.dispose();
    }
  }
});
test('invalid session/filter and malformed response fail closed; no unresolved API requests', async () => {
  let calls = 0; const events = [];
  const loader = createFeedbackInventoryLoader({ sesion: session(), readSession: session, onChange: s => events.push(s), request: async () => { calls++; return {}; } });
  await loader.load({ view: 'invalid' }); assert.equal(calls, 0); await loader.load({}); assert.equal(events.at(-1).data, null); loader.dispose();
  const denied = createFeedbackInventoryLoader({ sesion: { ...session(), usuario: { id: 7, rol: 'unknown' } }, readSession: session, onChange: s => events.push(s), request: async () => { calls++; } });
  await denied.load({}); assert.equal(calls, 1); denied.dispose();
});
test('actual JSX exports named section and uses guarded SPA navigation, separate decisions and cleaned listeners (not mounted)', () => {
  const source = readFileSync(new URL('./FeedbackTaskInventory.jsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('FeedbackTaskInventory.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length, 0); assert.match(source, /export function FeedbackTaskInventory/);
  assert.match(source, /Revisión de edición/); assert.match(source, /Estado actual:/); assert.match(source, /Última decisión:/);
  assert.match(source, /no significa que haya correcciones pendientes/);
  assert.match(source, /navigateWithinApp\(window, href\)/); assert.match(source, /inventoryLocationUrl\(window.location.href/);
  assert.match(source, /removeEventListener\('popstate', sync\)/); assert.match(source, /loader.dispose\(\)/);
  assert.match(source, /result\?\.location === location/); assert.match(source, /sesion\?\.token/);
  assert.match(source, /clients=\{clients\}/);
  assert.match(source, /<option value="">Todos los clientes<\/option>/);
  assert.match(source, /key=\{item.id\} value=\{String\(item.id\)\}>\{item.nombre\}/);
  assert.match(source, /!clientOptions.some\(item => String\(item.id\) === client\)/);
  assert.match(source, /<option value=\{client\}>Cliente no disponible \(#\{client\}\)/);
  assert.doesNotMatch(source, /Cliente por ID|inputMode="numeric"/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|localStorage|taskFeedbacks|guardarSesion|window\.location\.(href|assign)\s*=/);
});
