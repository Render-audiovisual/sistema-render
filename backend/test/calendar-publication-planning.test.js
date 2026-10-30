import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCalendarQuery, buildCalendarEvents, calendarEditorialSql, CALENDAR_TASK_SQL, CALENDAR_VISIT_SQL, CALENDAR_MILESTONE_SQL } from '../src/calendar.js';
import { readCalendarPage } from '../src/calendar-pagination.js';

const query = { desde: '2027-01-01', hasta: '2027-02-01', vista: 'publicaciones' };
test('format filtering is validated and applied in SQL before full month counts/pagination',async()=>{
  assert.throws(()=>normalizeCalendarQuery({...query,formato:'unknown'}),{status:400});
  assert.throws(()=>normalizeCalendarQuery({desde:query.desde,hasta:query.hasta,formato:'reel'}),{status:400});
  const snapshots=[];
  for(const formato of ['reel','carrusel']){
    const filters=normalizeCalendarQuery({...query,formato});
    let sql;
    const db={async query(value){sql=value;return {rows:[{total:'0',range_total:'0',fingerprint:'a'.repeat(64),events:[],days:[]}]};}};
    const result=await readCalendarPage(db,{filters,page:{limit:200,offset:0},clients:[],user:{id:3,rol:'edicion',session_version:1}},
      {taskSql:CALENDAR_TASK_SQL,visitSql:CALENDAR_VISIT_SQL,milestoneSql:CALENDAR_MILESTONE_SQL,editorialSql:calendarEditorialSql,buildEvents:buildCalendarEvents});
    assert.doesNotMatch(sql,/FROM produccion_visitas/);
    assert.match(sql,formato==='reel'?/p.tipo IN \('video','reel'\)/:/p.tipo='carrusel'/);
    snapshots.push(result.pagination.snapshot);
  }
  assert.notEqual(snapshots[0],snapshots[1]);
});
test('explicit editorial view ignores retired scope/type filters, preserves legacy API defaults and validates the view', () => {
  const filters = normalizeCalendarQuery({ ...query, scope: 'mine', kind: 'tarea', cliente_id: '14' });
  assert.equal(filters.scope, 'team'); assert.equal(filters.kind, 'all'); assert.equal(filters.cliente_id, 14);
  assert.equal(normalizeCalendarQuery({ desde: query.desde, hasta: query.hasta }).scope, 'mine');
  assert.throws(() => normalizeCalendarQuery({ ...query, vista: 'private' }), { status: 400 });
});

test('future dates remain planned, completed tasks never imply publication and only reels/carrusels survive', () => {
  const filters = normalizeCalendarQuery(query);
  const row = { id: 1, cliente_id: 14, cliente_nombre: 'Cliente', tipo: 'video', titulo: 'Reel futuro', estado: 'publicada',
    fecha_programada: '2027-01-12', fecha_publicación_real: '2027-01-12T12:00:00.000Z', responsable_ids: [] };
  const events = buildCalendarEvents({ tasks: [{ ...row, date: '2027-01-12', estado: 'finalizada' }],
    historias: [row], publicaciones: [row, { ...row, id: 2, tipo: 'carrusel' }, { ...row, id: 3, tipo: 'flyer' }] }, filters);
  assert.deepEqual(events.map(e => e.key), ['programacion:publicacion:1', 'programacion:publicacion:2']);
  assert.match(events[0].title, /Reel/); assert.equal(events[0].evidence, null);
  assert.equal(events[0].date, '2027-01-12');
  assert.match(events[0].href, /cliente=14&mes=2027-01/);
  assert.match(calendarEditorialSql('publicacion', 'all', 'publicaciones'), /p.tipo IN \('video','reel','carrusel'\)/);
  assert.doesNotMatch(calendarEditorialSql('publicacion', 'all'), /p.tipo IN/);
});

test('monthly publication view counts only reel/carrusel pieces before pagination; snapshot binds view', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ total: '0', range_total: '0', fingerprint: 'a'.repeat(64), events: [], days: [] }] }; } };
  const filters = normalizeCalendarQuery(query);
  const deps = { taskSql: CALENDAR_TASK_SQL, visitSql: CALENDAR_VISIT_SQL, milestoneSql: CALENDAR_MILESTONE_SQL,
    editorialSql: calendarEditorialSql, buildEvents: buildCalendarEvents, annotateEvidence() { assert.fail('No evidence query for empty month'); } };
  const input = { filters, page: { limit: 200, offset: 0 }, clients: [], user: { id: 3, rol: 'edicion', session_version: 1 } };
  const result = await readCalendarPage(db, input, deps);
  const { sql, params } = calls[0];
  assert.doesNotMatch(sql, /task_rows AS|milestone_rows AS|FROM historias|FROM proyectos/);
  assert.doesNotMatch(sql, /FROM produccion_visitas/); assert.match(sql, /FROM publicaciones/);
  assert.match(sql, /p.tipo IN \('video','reel','carrusel'\)/);
  assert.equal(params[4], true);
  const legacy = await readCalendarPage(db, { ...input, filters: { ...filters, vista: undefined } }, deps);
  assert.notEqual(legacy.pagination.snapshot, result.pagination.snapshot);
});
