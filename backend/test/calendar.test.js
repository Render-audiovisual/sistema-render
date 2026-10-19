import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCalendarQuery, buildCalendarEvents, calendarEditorialSql, CALENDAR_TASK_SQL,
  CALENDAR_VISIT_SQL, readCalendar, createCalendarRouter } from '../src/calendar.js';

const UUID = '10000000-0000-4000-8000-000000000001';
const VISIT = '20000000-0000-4000-8000-000000000002';
const AUTH = { id: 4, rol: 'edicion', activo: true, session_version: 2 };
const QUERY = { desde: '2026-02-01', hasta: '2026-03-01' };
const TIME = '2026-03-01T02:30:00.000Z';
const task = (extra = {}) => ({ id: 8, titulo: 'Editar', estado: 'finalizada', date: '2026-02-10', cliente_id: 7, cliente_nombre: 'Cliente', responsable_ids: [4], ...extra });
const piece = (extra = {}) => ({ id: 1, cliente_id: 7, cliente_nombre: 'Cliente', estado: 'publicada', fecha_programada: '2026-03-12', 'fecha_publicación_real': new Date(TIME), responsable_ids: [4], ...extra });
const proof = () => ({ classification: 'confirmada_manualmente', revision: 3,
  confirmation: { id: UUID, actor_id: 9, occurred_at: TIME, recorded_at: TIME, source: 'manual' } });
const build = (data, query = QUERY) => buildCalendarEvents(data, normalizeCalendarQuery(query));

test('strict closed filters default mine/all and use half-open 1..62 day range', () => {
  assert.deepEqual(normalizeCalendarQuery(QUERY), { ...QUERY, scope: 'mine', kind: 'all', cliente_id: null });
  assert.equal(normalizeCalendarQuery({ desde: '2026-01-01', hasta: '2026-03-04' }).scope, 'mine');
  for (const invalid of [{ desde: '2026-01-01', hasta: '2026-03-05' }, { ...QUERY, hasta: QUERY.desde },
    { ...QUERY, desde: '2026-02-30' }, { ...QUERY, desde: '0000-01-01' }, { ...QUERY, desde: '2026-2-01' },
    { ...QUERY, scope: 'mio' }, { ...QUERY, kind: 'project' }, { ...QUERY, scope: ['mine', 'team'] },
    { ...QUERY, actor_id: '4' }, { ...QUERY, cliente_id: {} }, { ...QUERY, cliente_id: '0' }, { ...QUERY, cliente_id: '2147483648' },
    { ...QUERY, hasta: '2026-03-01T00:00:00Z' }, {}]) {
    assert.throws(() => normalizeCalendarQuery(invalid), { status: 400 });
  }
  assert.equal(normalizeCalendarQuery({ desde: '2024-02-29', hasta: '2024-03-01', scope: 'team', kind: 'visita', cliente_id: '7' }).cliente_id, 7);
});

test('source identity keys never collide, events sort and half-open dates filter', () => {
  const rows = build({ tasks: [task(), task({ id: 9, date: '2026-03-01' })], visits: [task({ id: VISIT })],
    historias: [piece({ fecha_programada: '2026-02-10' })], publicaciones: [piece({ fecha_programada: '2026-02-10' })] });
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map(r => r.key)).size, 4);
  assert.ok(rows.some(r => r.key === 'programacion:historia:1'));
  assert.ok(rows.some(r => r.key === 'programacion:publicacion:1'));
  assert.equal(rows.find(r => r.kind === 'tarea').estado, 'finalizada');
  assert.equal(rows.some(r => r.source_id === 9), false);
});

test('manual occurrence uses Córdoba day while href keeps actual source scheduled month/client', () => {
  const confirmed = piece({ publicacion_evidencia: proof() });
  const events = build({ publicaciones: [confirmed] });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'publicacion');
  assert.equal(events[0].date, '2026-02-28');
  assert.equal(events[0].href, '/planificacion-publicaciones?tab=calendario&cliente=7&mes=2026-03');
  assert.equal(events[0].evidence.confirmation.source, 'manual');
  assert.equal(build({ publicaciones: [confirmed] }, { ...QUERY, kind: 'programacion' }).length, 0);
});

test('legacy state/date, metadata and malformed evidence cannot create actual-publication events', () => {
  for (const change of [{}, { metadata: { publicacion_evidencia: proof() } },
    { publicacion_evidencia: { ...proof(), classification: 'historica_sin_confirmacion' } },
    { publicacion_evidencia: { ...proof(), confirmation: { ...proof().confirmation, source: 'external' } } },
    { estado: 'lista', publicacion_evidencia: proof() },
    { 'fecha_publicación_real': '2026-03-01 02:30', publicacion_evidencia: proof() },
    { 'fecha_publicación_real': new Date('2026-03-02T02:30:00Z'), publicacion_evidencia: proof() }]) {
    assert.equal(build({ historias: [piece(change)] }).length, 0);
  }
});

test('closed event/evidence trees omit private sentinels, bound text and sanitize responsible IDs', () => {
  const e = proof(); e.private_finance = { token: 'SECRET' }; e.confirmation.salary = 'SECRET';
  const rows = build({ tasks: [task({ titulo: 'x'.repeat(1000), cliente_nombre: 'c'.repeat(1000), responsable_ids: [4, 4, 0, '5', null], metadata: { salario: 'SECRET' } })],
    publicaciones: [piece({ publicacion_evidencia: e })] });
  assert.equal(rows[0].title.length, 160);
  assert.equal(rows[0].cliente_nombre.length, 250);
  assert.deepEqual(rows[0].responsable_ids, [4]);
  assert.doesNotMatch(JSON.stringify(rows), /SECRET|private_finance|salary|metadata/);
  assert.deepEqual(Object.keys(rows[0]), ['key', 'kind', 'source', 'source_id', 'date', 'title', 'cliente_id', 'cliente_nombre', 'estado', 'href', 'responsable_ids', 'evidence']);
});

test('editorial real titles/type are bounded, fallback IDs remain without leaking metadata objects', () => {
  const events = build({ publicaciones: [piece({ tipo: 'reel', titulo: 'Lanzamiento', fecha_programada: '2026-02-10' })] });
  assert.match(events[0].title, /Reel · Lanzamiento/);
  const fallback = build({ historias: [piece({ titulo: {}, fecha_programada: '2026-02-10' })] });
  assert.match(fallback[0].title, /Historia #1/);
  const sql = calendarEditorialSql('publicacion', 'all');
  assert.match(sql, /COALESCE\(NULLIF\(btrim\(p.idea\),''\),NULLIF\(btrim\(CASE WHEN jsonb_typeof/);
  assert.match(sql, /jsonb_typeof\(p.metadata->'idea'\)='string'/);
  assert.match(sql, /jsonb_typeof\(p.metadata->'Idea'\)='string'/);
  assert.match(sql, /left\(p.copy,160\)/);
  assert.doesNotMatch(sql, /p\.metadata\s*,|metadata::text|SELECT \*/);
});

test('client narrowing preserves null-client shared tasks only without explicit filter', () => {
  assert.equal(build({ tasks: [task({ cliente_id: null, cliente_nombre: null })] }).length, 1);
  assert.equal(build({ tasks: [task({ cliente_id: null })] }, { ...QUERY, cliente_id: '7' }).length, 0);
  assert.equal(build({ tasks: [task()] }, { ...QUERY, cliente_id: '8' }).length, 0);
});

function harness({ user = { ...AUTH }, tasks = [], visits = [], historias = [], publicaciones = [], evidenceRows = [], fault } = {}) {
  const calls = [];
  let released = false;
  const db = { release() { released = true; }, async query(sql, params = []) {
    calls.push({ sql, params });
    if (fault?.(sql)) throw new Error('SQL failure');
    if (sql.startsWith('SELECT id,rol,activo,session_version FROM usuarios')) return { rows: user ? [user] : [] };
    if (sql.startsWith('SELECT id,nombre FROM clientes')) return { rows: [{ id: 7, nombre: 'Cliente', salario: 'SECRET' }] };
    if (sql === CALENDAR_TASK_SQL) return { rows: tasks };
    if (sql === CALENDAR_VISIT_SQL) return { rows: visits };
    if (sql.startsWith('SELECT p.id AS piece_id')) return { rows: evidenceRows };
    if (sql.includes('FROM historias p')) return { rows: historias };
    if (sql.includes('FROM publicaciones p')) return { rows: publicaciones };
    return { rows: [] };
  } };
  return { calls, db, pool: { connect: async () => db }, released: () => released };
}

test('all six roles share snapshot API; mine/team is an explicit ID-scoped parameter, never admin override', async () => {
  for (const rol of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion']) {
    const user = { ...AUTH, rol }, h = harness({ user, tasks: [task()] });
    const result = await readCalendar(h.pool, user, QUERY);
    assert.equal(result.scope, 'mine');
    assert.equal(result.events.length, 1);
    assert.equal(h.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(h.calls.at(-1).sql, 'COMMIT');
    assert.equal(h.calls.find(c => c.sql === CALENDAR_TASK_SQL).params[4], false);
    assert.equal(h.calls.some(c => /FOR UPDATE|FOR SHARE|INSERT |UPDATE |DELETE /i.test(c.sql)), false);
    assert.equal(h.released(), true);
  }
  const h = harness();
  await readCalendar(h.pool, AUTH, { ...QUERY, scope: 'team', cliente_id: '7' });
  assert.deepEqual(h.calls.find(c => c.sql === CALENDAR_TASK_SQL).params, [QUERY.desde, QUERY.hasta, 7, 4, true]);
});

test('actor revocation/session/role changes deny before source reads; current unknown role403', async () => {
  for (const user of [null, { ...AUTH, activo: false }, { ...AUTH, session_version: 3 }, { ...AUTH, rol: 'admin' }]) {
    const h = harness({ user });
    await assert.rejects(readCalendar(h.pool, AUTH, QUERY), { status: 401 });
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  }
  const unknown = { ...AUTH, rol: 'unknown' }, h = harness({ user: unknown });
  await assert.rejects(readCalendar(h.pool, unknown, QUERY), { status: 403 });
});

test('real batch annotator runs inside the same snapshot and ignores forged incoming evidence', async () => {
  const observed = piece({ publicacion_evidencia: proof() });
  const absent = harness({ historias: [observed] });
  assert.equal((await readCalendar(absent.pool, AUTH, QUERY)).events.length, 0);
  const snapshot = { piece_id: 1, piece_cliente_id: 7, piece_estado: 'publicada', piece_actual_at: new Date(TIME), piece_fecha_programada: '2026-03-12',
    piece_archived: false, cliente_activo: true, revision: '3', current_event_id: UUID, event_id: UUID, event_dominio: 'historia', event_pieza_id: 1,
    event_cliente_id: 7, event_actor_id: 9, event_action: 'confirmar', event_source: 'manual', event_occurred_at: new Date(TIME), event_recorded_at: new Date(TIME) };
  const h = harness({ historias: [observed], evidenceRows: [snapshot] });
  const result = await readCalendar(h.pool, AUTH, QUERY);
  assert.equal(result.events[0].date, '2026-02-28');
  const annotation = h.calls.filter(c => c.sql.startsWith('SELECT p.id AS piece_id'));
  assert.equal(annotation.length, 1);
  assert.deepEqual(annotation[0].params, ['historia', [1]]);
});

test('source overflow sets explicit truncation even if projection/filter emits no events', async () => {
  const h = harness({ tasks: Array.from({ length: 2001 }, (_, n) => task({ id: n + 1, date: '2026-03-01' })) });
  const result = await readCalendar(h.pool, AUTH, { ...QUERY, kind: 'tarea' });
  assert.equal(result.events.length, 0);
  assert.equal(result.truncated, true);
  const full = harness({ tasks: Array.from({ length: 2001 }, (_, n) => task({ id: n + 1 })) });
  const bounded = await readCalendar(full.pool, AUTH, { ...QUERY, kind: 'tarea' });
  assert.equal(bounded.events.length, 2000);
  assert.equal(bounded.truncated, true);
});

test('SQL scopes use assignment/participant IDs, exclude hidden/private and deduplicate only source visits', () => {
  assert.match(CALENDAR_TASK_SQL, /tarea_asignaciones mine.*mine.usuario_id=\$4/);
  assert.match(CALENDAR_TASK_SQL, /NOT EXISTS\(SELECT 1 FROM produccion_visitas v WHERE v.tarea_origen_id=t.id\)/);
  assert.doesNotMatch(CALENDAR_TASK_SQL, /tarea_edicion_id|estado NOT IN/);
  assert.match(CALENDAR_VISIT_SQL, /produccion_visita_participantes p WHERE p.visita_id=v.id AND p.usuario_id=\$4/);
  assert.match(CALENDAR_VISIT_SQL, /source.id=v.tarea_origen_id/);
  for (const sql of [CALENDAR_TASK_SQL, CALENDAR_VISIT_SQL, calendarEditorialSql('historia', 'all'), calendarEditorialSql('publicacion', 'all')]) {
    assert.match(sql, /workspace'='render_os'/);
    assert.match(sql, /archivada_render_os/);
    assert.match(sql, /papelera_render_os/);
    assert.match(sql, /LIMIT 2001/);
    assert.doesNotMatch(sql, /asignado_a\s*=|responsable\s*=|nombre\s*=|importe|salario/);
  }
  assert.match(calendarEditorialSql('historia', 'all'), /t.historia_id=p.id/);
  assert.match(calendarEditorialSql('publicacion', 'all'), /t.publicacion_id=p.id/);
});

test('invalid query does not connect; unexpected read failure rolls back and reaches global handler', async () => {
  await assert.rejects(readCalendar({ connect: () => { throw new Error('must not connect'); } }, AUTH, { ...QUERY, uid: '4' }), { status: 400 });
  const h = harness({ fault: sql => sql === CALENDAR_TASK_SQL });
  await assert.rejects(readCalendar(h.pool, AUTH, QUERY), /SQL failure/);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(h.released(), true);
});

test('router exposes single read-only GET and no-store headers', async () => {
  const h = harness(), routes = new Map();
  createCalendarRouter({ express: { Router: () => ({ get: (path, handler) => routes.set(path, handler) }) }, pool: h.pool });
  let header, payload;
  await routes.get('/')({ auth: AUTH, query: QUERY }, { set: (...v) => { header = v; }, json: value => { payload = value; } }, error => { throw error; });
  assert.deepEqual(header, ['Cache-Control', 'no-store']);
  assert.equal(payload.timezone, 'America/Argentina/Cordoba');
  assert.deepEqual(payload.clients, [{ id: 7, nombre: 'Cliente' }]);
});
