import test from 'node:test';
import assert from 'node:assert/strict';
import { readCalendarPage } from '../src/calendar-pagination.js';
import { CALENDAR_TASK_SQL, CALENDAR_VISIT_SQL, CALENDAR_MILESTONE_SQL,
  calendarEditorialSql, buildCalendarEvents } from '../src/calendar.js';
import { annotateEditorialEvidence } from '../src/editorial-evidence-read.js';

const filters = { desde: '2026-10-01', hasta: '2026-11-01', scope: 'mine', kind: 'all', cliente_id: null };
const user = { id: 3, rol: 'edicion', session_version: 2 };
const clients = [{ id: 7, nombre: 'Cliente' }];
const deps = { taskSql: CALENDAR_TASK_SQL, visitSql: CALENDAR_VISIT_SQL, milestoneSql: CALENDAR_MILESTONE_SQL,
  editorialSql: calendarEditorialSql, buildEvents: buildCalendarEvents, annotateEvidence: annotateEditorialEvidence };
const task = (id = 1, date = '2026-10-10') => ({ source: 'tarea', kind: 'tarea', date, key: `tarea:tarea:${id}`,
  raw: { id, titulo: `Tarea ${id}`, estado: 'pendiente', date, cliente_id: 7, cliente_nombre: 'Cliente', responsable_ids: [3] } });
const proofId = '10000000-0000-4000-8000-000000000001';
const instant = '2026-10-11T02:30:00.000Z';
const piece = kind => ({ source: 'publicacion', kind, date: '2026-10-10', key: `${kind}:publicacion:8`,
  raw: { id: 8, cliente_id: 7, cliente_nombre: 'Cliente', estado: 'publicada', tipo: 'video', titulo: 'Pieza',
    fecha_programada: '2026-10-10', fecha_publicación_real: instant, responsable_ids: [3] } });
const evidence = () => ({ piece_id: 8, piece_cliente_id: 7, piece_estado: 'publicada', piece_actual_at: instant,
  piece_fecha_programada: '2026-10-10', piece_archived: false, cliente_activo: true, revision: '4', current_event_id: proofId,
  event_id: proofId, event_dominio: 'publicacion', event_pieza_id: 8, event_cliente_id: 7, event_actor_id: 9,
  event_action: 'confirmar', event_source: 'manual', event_occurred_at: instant, event_recorded_at: instant });

function harness({ row, evidenceRows = [evidence()], override = {} } = {}) {
  const calls = [];
  const response = row ?? { total: '0', range_total: '0', fingerprint: 'a'.repeat(64), events: [], days: [] };
  const db = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.startsWith('WITH ')) return { rows: [structuredClone(response)] };
    assert.match(sql, /SELECT p.id AS piece_id/);
    return { rows: structuredClone(evidenceRows) };
  } };
  return { calls, run: (input = {}, dependencies = {}) => readCalendarPage(db,
    { filters, page: { limit: 2, offset: 0 }, clients, user, ...override, ...input }, { ...deps, ...dependencies }) };
}
const populated = (events = [task(1), task(2)], total = '2501') => ({ total, range_total: total,
  fingerprint: 'a'.repeat(64), events, days: [{ date: '2026-10-10', total, preview: [task(1), task(2)] }] });

test('empty page returns closed pagination and performs one bounded aggregate query; no transaction ownership', async () => {
  const h = harness(), result = await h.run();
  assert.deepEqual(Object.keys(result), ['events', 'truncated', 'pagination']);
  assert.deepEqual(result.events, []); assert.equal(result.truncated, false);
  assert.deepEqual({ ...result.pagination, snapshot: '<hash>' }, { version: 1, limit: 2, offset: 0, total: 0,
    has_more: false, snapshot: '<hash>', day: null, days: [] });
  assert.match(result.pagination.snapshot, /^c1:[0-9a-f]{64}$/);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].values, ['2026-10-01', '2026-11-01', null, 3, false, 2, 0, null]);
});

test('adapter null snapshot/day are absent on initial page, but null cannot authorize later pages', async () => {
  const ordinary = await harness().run();
  const h = harness();
  const result = await h.run({ page: { limit: 2, offset: 0, expected_snapshot: null, dia: null } });
  assert.deepEqual(result, ordinary);
  assert.equal(h.calls[0].values[7], null);
  const later = harness();
  await assert.rejects(later.run({ page: { limit: 2, offset: 1, expected_snapshot: null, dia: null } }), { status: 400 });
  assert.equal(later.calls.length, 0);
});

test('SQL reuses every original predicate, removes only terminal legacy caps and bounds page/previews in SQL', async () => {
  const h = harness(); await h.run(); const sql = h.calls[0].sql;
  for (const source of [CALENDAR_TASK_SQL, CALENDAR_VISIT_SQL, CALENDAR_MILESTONE_SQL,
    calendarEditorialSql('historia', 'all'), calendarEditorialSql('publicacion', 'all')]) {
    assert.ok(sql.includes(source.replace(/\sLIMIT 2001\s*$/i, '')));
  }
  assert.doesNotMatch(sql, /LIMIT 2001|\b(?:BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE)\b/i);
  assert.match(sql, /candidates AS MATERIALIZED/);
  assert.match(sql, /row_number\(\) OVER \(PARTITION BY date ORDER BY kind COLLATE "C",key COLLATE "C"\)/);
  assert.match(sql, /FILTER \(WHERE day_rank<=2\)/);
  assert.match(sql, /LIMIT \$6::int OFFSET \$7::bigint/);
  assert.match(sql, /encode\(sha256\(convert_to/);
  assert.match(sql, /raw,footprint/);
  assert.match(sql, /jsonb_agg/);
  assert.doesNotMatch(sql, /pgcrypto|digest\(/);
});

test('complete counts beyond old 2000 cap expose only closed page and two daily previews', async () => {
  const h = harness({ row: populated() }); const result = await h.run();
  assert.equal(result.pagination.total, 2501); assert.equal(result.pagination.has_more, true); assert.equal(result.truncated, true);
  assert.equal(result.events.length, 2); assert.equal(result.pagination.days[0].total, 2501);
  assert.equal(result.pagination.days[0].preview.length, 2);
  assert.deepEqual(result.events, result.pagination.days[0].preview);
  assert.doesNotMatch(JSON.stringify(result), /"raw"|footprint|responsable_ids.*secret/);
  assert.equal(h.calls.length, 1, 'No fetch-all or per-event query');
});

test('page and previews preserve SQL C candidate order independently of the projector locale sort', async () => {
  const entries = [task(10), task(2)];
  const row = { total: '2', range_total: '2', fingerprint: 'a'.repeat(64), events: entries,
    days: [{ date: '2026-10-10', total: '2', preview: entries }] };
  const calls = [];
  const result = await harness({ row }).run({}, { buildEvents(data, filters) {
    calls.push(data.tasks.map(row => row.id));
    // Only single-candidate calls can make any internal locale ordering inert.
    assert.equal(data.tasks.length, 1);
    return buildCalendarEvents(data, filters).reverse();
  } });
  assert.deepEqual(result.events.map(row => row.source_id), [10, 2]);
  assert.deepEqual(result.pagination.days[0].preview.map(row => row.source_id), [10, 2]);
  assert.deepEqual(calls, [[10], [2], [10], [2]]);
});

test('selected day total is independent of full range days and empty selected day is valid', async () => {
  const row = populated([task(3, '2026-10-12')], '1'); row.range_total = '2502';
  row.days = [{ date: '2026-10-10', total: '2501', preview: [task(1), task(2)] },
    { date: '2026-10-12', total: '1', preview: [task(3, '2026-10-12')] }];
  const h = harness({ row });
  const result = await h.run({ page: { limit: 2, offset: 0, dia: '2026-10-12' } });
  assert.equal(result.pagination.total, 1); assert.equal(result.pagination.day, '2026-10-12');
  assert.equal(result.pagination.has_more, false); assert.equal(result.truncated, false);
  assert.deepEqual(result.pagination.days.map(day => day.total), [2501, 1]);
  assert.equal(h.calls[0].values[7], '2026-10-12');
  row.total = '0'; row.events = [];
  const empty = await harness({ row }).run({ page: { limit: 2, offset: 0, dia: '2026-10-13' } });
  assert.equal(empty.pagination.total, 0); assert.equal(empty.pagination.days.length, 2);
});

test('snapshot ignores limit/offset and filters.pagination; last-page flags follow the specified totals', async () => {
  const first = await harness({ row: populated([task(1), task(2)], '3') }).run();
  const lastRow = populated([task(3)], '3');
  const h = harness({ row: lastRow });
  const last = await h.run({ filters: { ...filters, pagination: { arbitrary: 'not part of identity' } },
    page: { limit: 1, offset: 2, expected_snapshot: first.pagination.snapshot } });
  assert.equal(last.pagination.snapshot, first.pagination.snapshot);
  assert.equal(last.pagination.has_more, false); assert.equal(last.truncated, true);
  assert.equal(last.events[0].source_id, 3);
  const beyond = populated([], '3');
  const result = await harness({ row: beyond }).run({ page: { limit: 500, offset: Number.MAX_SAFE_INTEGER,
    expected_snapshot: first.pagination.snapshot } });
  assert.deepEqual(result.events, []); assert.equal(result.pagination.has_more, false);
});

test('snapshot binds exact actor/role/epoch, base filters, selected day, client catalog and SQL footprint', async () => {
  const token = (await harness().run()).pagination.snapshot;
  for (const input of [
    { user: { ...user, id: 4 } }, { user: { ...user, rol: 'admin' } }, { user: { ...user, session_version: 3 } },
    { filters: { ...filters, scope: 'team' } }, { filters: { ...filters, kind: 'tarea' } },
    { filters: { ...filters, cliente_id: 7 } }, { filters: { ...filters, hasta: '2026-10-31' } },
    { clients: [{ id: 7, nombre: 'Renamed' }] }, { clients: [{ id: 8, nombre: 'Cliente' }] },
  ]) {
    const h = harness();
    await assert.rejects(h.run({ ...input, page: { limit: 2, offset: 1, expected_snapshot: token } }), { status: 409 });
    assert.equal(h.calls.length, 1, 'Mismatch stops before projection/evidence reads');
  }
  await assert.rejects(harness().run({ page: { limit: 2, offset: 1, dia: '2026-10-10', expected_snapshot: token } }), { status: 409 });
  await assert.rejects(harness({ row: { total: '0', range_total: '0', fingerprint: 'b'.repeat(64), events: [], days: [] } })
    .run({ page: { limit: 2, offset: 1, expected_snapshot: token } }), { status: 409 });
});

test('actual candidate SQL requires exact current manual proof and valid planned/recorded dates, not legacy state/date alone', async () => {
  const h = harness(); await h.run({ filters: { ...filters, kind: 'publicacion' } });
  const sql = h.calls[0].sql;
  for (const fragment of ["v.revision BETWEEN 1 AND 9007199254740991", 'v.current_event_id=e.id', 'e.pieza_id=r.id',
    'e.cliente_id=r.cliente_id', "e.action='confirmar'", "e.source='manual'", 'e.actor_id BETWEEN 1 AND 2147483647',
    "r.estado='publicada'", 'r.fecha_publicación_real=e.occurred_at', 'r.valid_proof IS TRUE',
    'to_jsonb(v) AS version_footprint', 'to_jsonb(e) AS event_footprint', "r.fecha_programada >= '0001-01-01'",
    "e.recorded_at AT TIME ZONE 'America/Argentina/Cordoba'", 'LEFT JOIN editorial_publicacion_versiones',
    'LEFT JOIN editorial_publicacion_eventos']) assert.ok(sql.includes(fragment), fragment);
  assert.doesNotMatch(sql, /'programacion'::text kind|task_rows AS|visit_rows AS|milestone_rows AS/);
});

test('same editorial piece scheduled and actual projects twice but evidence batches once with authoritative helper', async () => {
  const entries = [piece('programacion'), piece('publicacion')];
  const row = { total: '2', range_total: '2', fingerprint: 'c'.repeat(64), events: entries,
    days: [{ date: '2026-10-10', total: '2', preview: entries }] };
  const h = harness({ row }); const result = await h.run();
  assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1].values, ['publicacion', [8]]);
  assert.deepEqual(result.events.map(event => event.kind), ['programacion', 'publicacion']);
  assert.equal(result.events[0].evidence, null);
  assert.equal(result.events[1].evidence.classification, 'confirmada_manualmente');
  assert.equal(result.events[1].evidence.revision, 4);
  assert.equal(result.events[1].evidence.confirmation.id, proofId);
  assert.deepEqual(result.events, result.pagination.days[0].preview);
  assert.doesNotMatch(JSON.stringify(result), /event_footprint|version_footprint|intent_hash|piece_actual_at/);
});

test('authoritative proof disagreement fails closed rather than returning a short page or false count', async () => {
  const entry = piece('publicacion');
  const row = { total: '1', range_total: '1', fingerprint: 'c'.repeat(64), events: [entry],
    days: [{ date: entry.date, total: '1', preview: [entry] }] };
  for (const change of [{ current_event_id: null }, { event_source: 'legacy' }, { piece_archived: true },
    { cliente_activo: false }, { event_actor_id: 0 }, { revision: '0' }, { event_occurred_at: '2026-10-12T00:00:00.000Z' }]) {
    await assert.rejects(harness({ row, evidenceRows: [{ ...evidence(), ...change }] }).run(), { status: 500 });
  }
});

test('unknown milestone states are excluded by SQL; unexpected counted invalid projection fails closed', async () => {
  const h = harness(); await h.run({ filters: { ...filters, kind: 'hito' } });
  assert.match(h.calls[0].sql, /r.estado IN \('pendiente','completado','cancelado'\)/);
  const entry = { ...task(), source: 'hito', kind: 'hito', key: `hito:hito:${proofId}`,
    raw: { ...task().raw, id: proofId, proyecto_id: proofId, estado: 'unknown' } };
  await assert.rejects(harness({ row: { total: '1', range_total: '1', fingerprint: 'a'.repeat(64), events: [entry],
    days: [{ date: entry.date, total: '1', preview: [entry] }] } }).run(), { status: 500 });
});

test('invalid normalized page values are rejected without any query, including array snapshot coercion', async () => {
  for (const page of [{ limit: 0, offset: 0 }, { limit: 501, offset: 0 }, { limit: '20', offset: 0 },
    { limit: 1, offset: -1 }, { limit: 1, offset: 0.5 }, { limit: 1, offset: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 1, offset: 1 }, { limit: 1, offset: 0, expected_snapshot: ['c1:' + 'a'.repeat(64)] },
    { limit: 1, offset: 0, expected_snapshot: 'c1:' + 'A'.repeat(64) },
    { limit: 1, offset: 0, dia: '2026-11-01' }, { limit: 1, offset: 0, dia: '2026-10-32' },
    { limit: 1, offset: 0, dia: ['2026-10-10'] }, { limit: 1, offset: 0, dia: '0000-01-01' }]) {
    const h = harness(); await assert.rejects(h.run({ page }), { status: 400 }); assert.equal(h.calls.length, 0);
  }
});

test('malformed/count/order/preview disagreements cannot leak partial DTOs', async () => {
  for (const mutate of [row => { row.total = '2502'; }, row => { row.range_total = '2502'; },
    row => { row.total = '9007199254740992'; }, row => { row.fingerprint = 'bad'; },
    row => { row.events.pop(); }, row => { row.events.reverse(); }, row => { row.days[0].preview.pop(); },
    row => { row.days[0].preview[0].date = '2026-10-11'; }, row => { row.events[0].key = 'wrong'; },
    row => { row.days[0].date = '2026-11-01'; }, row => { row.days.push(structuredClone(row.days[0])); }]) {
    const row = populated(); mutate(row);
    await assert.rejects(harness({ row }).run(), { status: 500 });
  }
});

test('trusted SQL must have exactly the removable static terminal cap; faults never trigger transaction writes', async () => {
  for (const taskSql of ['SELECT 1', `${CALENDAR_TASK_SQL};`, CALENDAR_TASK_SQL.replace('LIMIT 2001', 'LIMIT $6'),
    `${CALENDAR_TASK_SQL}; DELETE FROM tareas LIMIT 2001`]) {
    const h = harness(); await assert.rejects(h.run({}, { taskSql }), { status: 500 }); assert.equal(h.calls.length, 0);
  }
  const expected = new Error('synthetic reader fault');
  await assert.rejects(readCalendarPage({ query: async () => { throw expected; } },
    { filters, page: { limit: 2, offset: 0 }, clients, user }, deps), error => error === expected);
});
