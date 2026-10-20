import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITORIAL_BUCKETS, EDITORIAL_LIMIT, canReadEditorialControl, parseHomeEditorialControl,
  createHomeEditorialLoader, homeEditorialContextHref } from './homeEditorialControl.js';

const session = () => ({ token: 'token', usuario: { id: 7, rol: 'community', activo: true } });
const row = (overrides = {}) => ({ domain: 'historia', id: 1, titulo: '<img src=x>', estado: 'pendiente', tipo: 'historia',
  cliente: { id: 3, nombre: 'Cliente' }, fecha_programada: '2026-10-22', publication_classification: 'no_publicada', ...overrides });
function dto(bucket = 'today', offset = 0, items = [], total = offset + items.length) {
  return { version: 1, today: '2026-10-22', bucket, offset, limit: 20, total, has_more: offset + items.length < total,
    summary: { today: 100, overdue: 100, blocked: 100, upcoming_ready: 100, [bucket]: total }, items };
}
const parse = (value) => parseHomeEditorialControl(value, { bucket: value.bucket, offset: value.offset });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('exact buckets/limit and all six current operational roles; identity and token are mandatory', () => {
  assert.deepEqual(EDITORIAL_BUCKETS, [{ value: 'today', label: 'Hoy' }, { value: 'overdue', label: 'Atrasadas' },
    { value: 'blocked', label: 'Bloqueadas' }, { value: 'upcoming_ready', label: 'Próximas listas' }]);
  assert.equal(EDITORIAL_LIMIT, 20);
  for (const rol of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion']) {
    assert.equal(canReadEditorialControl({ ...session(), usuario: { id: 7, rol, activo: true } }), true);
  }
  for (const invalid of [null, {}, { ...session(), token: '' }, { ...session(), token: 7 },
    ...[0, -1, '7', 1.5, 2147483648].map(id => ({ ...session(), usuario: { id, rol: 'admin' } })),
    { ...session(), usuario: { id: 7, rol: 'unknown', nombre: 'Franco' } },
    { ...session(), usuario: { id: 7, rol: 'admin', activo: false } }]) assert.equal(canReadEditorialControl(invalid), false);
});

test('closed DTO preserves domain+ID keys, literal title, real dates and independent counts without mutation', () => {
  const items = [row(), row({ domain: 'publicacion', tipo: 'reel' })];
  const raw = dto('today', 0, items);
  raw.metadata = { salary: 99 }; raw.summary.finance = 88; raw.items[0].metadata = { proof: 'forged' };
  raw.items[0].cliente.finance = 77;
  const before = JSON.stringify(raw), parsed = parseHomeEditorialControl(raw);
  assert.equal(parsed.items.length, 2); assert.equal(parsed.items[0].titulo, '<img src=x>');
  assert.equal('metadata' in parsed, false); assert.equal('metadata' in parsed.items[0], false);
  assert.equal('finance' in parsed.summary, false); assert.equal('finance' in parsed.items[0].cliente, false);
  parsed.items[0].cliente.nombre = 'changed'; assert.equal(JSON.stringify(raw), before);
  assert.equal(parse(dto('today', 40, [], 2)).total, 2);
});

test('bucket membership uses server day; historical today stays historical and blocked permits future/null', () => {
  assert.equal(parse(dto('today', 0, [row({ estado: 'publicada', publication_classification: 'historica_sin_confirmacion' })])).items[0].estado, 'publicada');
  for (const fecha_programada of ['2020-02-29', '2099-12-31', null]) {
    assert.equal(parse(dto('blocked', 0, [row({ estado: 'bloqueada', fecha_programada })])).items[0].fecha_programada, fecha_programada);
  }
  assert.equal(parse(dto('upcoming_ready', 0, [row({ estado: 'lista', fecha_programada: '2099-12-31' })])).items.length, 1);
  assert.equal(parse(dto('overdue', 0, [row({ fecha_programada: '2026-10-21' })])).items.length, 1);
  for (const [bucket, item] of [['today', row({ fecha_programada: '2026-10-21' })],
    ['overdue', row()], ['overdue', row({ estado: 'rechazada', fecha_programada: '2026-10-21' })],
    ['overdue', row({ estado: 'publicada', fecha_programada: '2026-10-21', publication_classification: 'historica_sin_confirmacion' })],
    ['blocked', row()], ['upcoming_ready', row({ estado: 'lista' })], ['upcoming_ready', row({ fecha_programada: '2099-01-01' })],
    ['today', row({ fecha_programada: null })]]) assert.throws(() => parse(dto(bucket, 0, [item])));
});

test('strict pagination, dates, shape, identifiers and evidence/state consistency reject unsafe data', () => {
  for (const patch of [{ version: 2 }, { today: '2026-02-29' }, { today: '0000-01-01' }, { today: '2026-10-22\n' },
    { limit: 50 }, { offset: 20 }, { total: -1 }, { total: '1' }, { has_more: true }, { summary: {} }, { items: [] }]) {
    assert.throws(() => parseHomeEditorialControl({ ...dto('today', 0, [row()]), ...patch }));
  }
  for (const patch of [{ id: '1' }, { id: 2147483648 }, { domain: 'task' }, { titulo: {} }, { titulo: 'x'.repeat(161) },
    { tipo: 'unknown' }, { estado: 'finalizada' }, { cliente: null }, { cliente: { id: 0, nombre: 'x' } },
    { fecha_programada: '2026-04-31' }, { publication_classification: 'forged' },
    { publication_classification: 'confirmada_manualmente' }, { estado: 'publicada' }]) {
    assert.throws(() => parse(dto('today', 0, [row(patch)])));
  }
  for (const offset of [-1, 1, 1000020, '0']) assert.throws(() => parseHomeEditorialControl(dto(), { offset }));
  assert.throws(() => parseHomeEditorialControl(dto(), { bucket: 'unknown' }));
  const inconsistent = dto('today', 0, [row({ estado: 'bloqueada' })]); inconsistent.summary.blocked = 0;
  assert.throws(() => parse(inconsistent));
  assert.equal(parse(dto('today', 0, [row({ estado: 'publicada', publication_classification: 'confirmada_manualmente' })])).items.length, 1);
  // Historical actual evidence can persist after reopening; do not invent an equivalence to state.
  assert.equal(parse(dto('blocked', 0, [row({ estado: 'bloqueada', publication_classification: 'historica_sin_confirmacion' })])).items.length, 1);
});

test('exact date/domain/ID order, duplicates and null-last ordering are enforced', () => {
  const ordered = [row({ estado: 'bloqueada', fecha_programada: '2026-10-21' }),
    row({ id: 2, estado: 'bloqueada' }), row({ domain: 'publicacion', tipo: 'reel', estado: 'bloqueada' }),
    row({ estado: 'bloqueada', fecha_programada: null })];
  // Last row must have a different domain+ID even though its date differs.
  ordered[3].id = 3;
  assert.equal(parse(dto('blocked', 0, ordered)).items.length, 4);
  for (const items of [[row(), row()], [row({ id: 2 }), row()],
    [row({ domain: 'publicacion', tipo: 'reel' }), row()]]) {
    assert.throws(() => parse(dto('today', 0, items)));
  }
  assert.throws(() => parse(dto('blocked', 0, [...ordered].reverse())));
});

test('full and final pages have exact lengths, selected global total and has_more', () => {
  const items = Array.from({ length: 20 }, (_, index) => row({ id: index + 1 }));
  assert.equal(parse(dto('today', 0, items, 21)).has_more, true);
  assert.equal(parse(dto('today', 20, [row({ id: 21 })], 21)).has_more, false);
  assert.throws(() => parse(dto('today', 0, items.slice(1), 21)));
  const inconsistent = dto('today', 0, items, 21); inconsistent.summary.today = 20;
  assert.throws(() => parse(inconsistent));
});

test('context links are closed existing dated module contexts, not guessed dates or piece-selection promises', () => {
  assert.equal(homeEditorialContextHref(row()), '/planificacion-historias?vista=checklist&cliente=3&mes=2026-10');
  assert.equal(homeEditorialContextHref(row({ domain: 'publicacion', tipo: 'reel' })), '/planificacion-publicaciones?tab=calendario&cliente=3&mes=2026-10');
  for (const item of [null, row({ fecha_programada: null }), row({ fecha_programada: '2026-02-29' }),
    row({ domain: 'javascript' }), row({ cliente: { id: '3' } }), row({ id: 0 })]) assert.equal(homeEditorialContextHref(item), null);
});

test('loader exact GET URL, remembered bucket/page and reset on bucket change; every state carries selection', async () => {
  const current = session(), states = [], urls = []; let now = 0;
  const loader = createHomeEditorialLoader({ sesion: current, readSession: () => current, now: () => now,
    onChange: state => states.push(state), request: async (url, options) => {
      urls.push(url); assert.equal(options.method, 'GET'); assert.ok(options.signal instanceof AbortSignal); assert.equal('body' in options, false);
      const params = new URL(url, 'https://render.test').searchParams;
      return dto(params.get('bucket'), Number(params.get('offset')), [], 0);
    } });
  await loader.refresh(); await loader.refresh({ bucket: 'blocked', offset: 0 });
  await loader.refresh({ offset: 20 }); await loader.refresh();
  await loader.refresh({ bucket: 'upcoming_ready', offset: 40 });
  assert.deepEqual(urls, ['/api/editorial-control?bucket=today&offset=0&limit=20',
    '/api/editorial-control?bucket=blocked&offset=0&limit=20', '/api/editorial-control?bucket=blocked&offset=20&limit=20',
    '/api/editorial-control?bucket=blocked&offset=20&limit=20', '/api/editorial-control?bucket=upcoming_ready&offset=40&limit=20']);
  await loader.refresh({ bucket: 'today' });
  assert.equal(urls.at(-1), '/api/editorial-control?bucket=today&offset=0&limit=20');
  for (const state of states) { assert.ok(typeof state.bucket === 'string'); assert.equal(typeof state.offset, 'number'); }
  assert.equal(await loader.refresh({ background: true }), false);
  now = 30000; assert.equal(await loader.refresh({ background: true }), true);
  for (const options of [{ bucket: '//evil' }, { offset: 1 }, { offset: 1000020 }, { offset: '20' }]) await assert.rejects(loader.refresh(options));
  loader.dispose(); assert.equal(await loader.refresh(), false);
});

test('obsolete success/error and dispose cannot publish; background refresh cannot supersede in-flight', async () => {
  for (const rejectOld of [true, false]) {
    const current = session(), a = deferred(), b = deferred(), states = []; let calls = 0, firstSignal;
    const loader = createHomeEditorialLoader({ sesion: current, readSession: () => current, onChange: value => states.push(value),
      request: (_url, { signal }) => { if (++calls === 1) firstSignal = signal; return calls === 1 ? a.promise : b.promise; } });
    const first = loader.refresh(); assert.equal(await loader.refresh({ background: true }), false);
    const second = loader.refresh({ bucket: 'blocked' }); assert.equal(firstSignal.aborted, true);
    b.resolve(dto('blocked')); await second; const length = states.length;
    if (rejectOld) a.reject(new Error('private finance')); else a.resolve(dto());
    await first; assert.equal(states.length, length); assert.equal(states.at(-1).bucket, 'blocked'); loader.dispose();
  }
  const current = session(), pending = deferred(), states = [];
  const loader = createHomeEditorialLoader({ sesion: current, readSession: () => current, request: () => pending.promise, onChange: value => states.push(value) });
  const run = loader.refresh(); loader.dispose(); pending.resolve(dto()); await run;
  assert.deepEqual(states.map(value => value.status), ['loading']);
});

test('live ID/token/role/active changes suppress stale data/errors and deny redispatch without rerender', async () => {
  for (const reject of [true, false]) for (const changed of [null, { ...session(), token: 'other' },
    { ...session(), usuario: { id: 8, rol: 'community', activo: true } },
    { ...session(), usuario: { id: 7, rol: 'admin', activo: true } },
    { ...session(), usuario: { id: 7, rol: 'community', activo: false } }]) {
    let current = session(), calls = 0; const captured = current, pending = deferred(), states = [];
    const loader = createHomeEditorialLoader({ sesion: captured, readSession: () => current,
      request: () => { calls++; return pending.promise; }, onChange: value => states.push(value) });
    const run = loader.refresh({ bucket: 'overdue' }); current = changed;
    if (reject) pending.reject(new Error('financial secret')); else pending.resolve(dto('overdue'));
    await run;
    assert.equal(states.at(-1).data, null); assert.equal(states.at(-1).status, 'error');
    assert.equal(states.at(-1).bucket, 'overdue'); assert.equal(states.at(-1).offset, 0);
    assert.doesNotMatch(states.at(-1).error, /financial|secret/);
    await loader.refresh(); assert.equal(calls, 1); loader.dispose();
  }
});

test('current transport/auth/parser failures expose bounded error and keep selection without old data', async () => {
  for (const response of [async () => { throw Object.assign(new Error('salary hidden'), { status: 403 }); },
    async () => ({ finance: 'secret' })]) {
    const current = session(), states = [];
    const loader = createHomeEditorialLoader({ sesion: current, readSession: () => current,
      request: response, onChange: value => states.push(value) });
    await loader.refresh({ bucket: 'blocked' });
    assert.equal(states.at(-1).status, 'error'); assert.equal(states.at(-1).data, null);
    assert.equal(states.at(-1).bucket, 'blocked'); assert.equal(states.at(-1).offset, 0);
    assert.doesNotMatch(states.at(-1).error, /salary|secret|finance/); loader.dispose();
  }
});
