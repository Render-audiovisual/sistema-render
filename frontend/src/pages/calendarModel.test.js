import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addCalendarDays, calendarDay, calendarEventLabel, calendarEventTitle, calendarGrid, calendarHref, calendarMilestoneState, calendarQuery, calendarTaskState, cordobaToday, createCalendarLoader, decodeCalendar, readCalendarSelection, shiftCalendarMonth } from './calendarModel.js';

const selection = readCalendarSelection('?mes=2026-10&dia=2026-10-19', '2026-10-19');
const visitId = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const proof = () => ({ classification: 'confirmada_manualmente', revision: 1, confirmation: { id: eventId, actor_id: 4, occurred_at: '2026-10-20T01:00:00.000Z', recorded_at: '2026-10-20T02:00:00.000Z', source: 'manual' } });
const taskEvent = () => ({ key: 'tarea:tarea:10', kind: 'tarea', source: 'tarea', source_id: 10, date: '2026-10-19', title: 'Entrega de tarea · Editar video', cliente_id: 3, cliente_nombre: 'Cliente', estado: 'publicada', href: '/workspace/tareas?task=10', responsable_ids: [4], evidence: null });
const visitEvent = () => ({ ...taskEvent(), key: `visita:visita:${visitId}`, kind: 'visita', source: 'visita', source_id: visitId, estado: null, href: `/producciones?visita=${visitId}&mes=2026-10` });
const editorialEvent = (actual = false) => ({ ...taskEvent(), key: `${actual ? 'publicacion' : 'programacion'}:historia:10`, kind: actual ? 'publicacion' : 'programacion', source: 'historia', href: '/planificacion-historias?vista=checklist&cliente=3&mes=2026-10', evidence: actual ? proof() : null });
const milestoneEvent = () => ({ ...taskEvent(), key: `hito:hito:${visitId}`, kind: 'hito', source: 'hito', source_id: visitId, title: 'Hito de proyecto · Presentar identidad', estado: 'pendiente', href: `/proyectos?proyecto=${eventId}` });
function dto(filters = selection, events = []) {
  const { desde, hasta } = calendarGrid(filters.mes);
  return { range: { desde, hasta }, scope: filters.scope, kind: filters.tipo, timezone: 'America/Argentina/Cordoba', clients: [{ id: 3, nombre: 'Cliente' }], events, truncated: false };
}
function pagedDto(filters = selection, events = []) {
  return { ...dto(filters, events), pagination: { version: 1, limit: 200, offset: (filters.pagina || 0) * 200,
    total: events.length, has_more: false, snapshot: `c1:${'a'.repeat(64)}`, day: filters.dia,
    days: events.length ? [{ date: filters.dia, total: events.length, preview: events.slice(0, 2) }] : [] } };
}
const session = rol => ({ token: 'captured-token', usuario: { id: 4, rol: rol || 'employee' } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('date-only arithmetic and Monday-first grids are valid half-open ranges within 62 days', () => {
  for (const mes of ['0001-01', '2024-02', '2026-02', '2026-03', '2026-10', '2026-11', '9999-11']) {
    const grid = calendarGrid(mes);
    assert.equal(new Date(`${grid.desde}T00:00Z`).getUTCDay(), 1);
    assert.equal(grid.days.length % 7, 0); assert.ok(grid.days.length >= 28 && grid.days.length <= 42);
    assert.equal(calendarDay(grid.desde), true); assert.equal(calendarDay(grid.hasta), true);
    assert.equal(addCalendarDays(grid.days.at(-1), 1), grid.hasta);
  }
  assert.equal(calendarDay('0001-01-01'), true); assert.equal(calendarDay('0000-01-01'), false);
  assert.equal(calendarDay('2026-02-30'), false); assert.equal(calendarDay('2024-02-29'), true);
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
});

test('Córdoba today is not the browser UTC date', () => {
  assert.equal(cordobaToday(new Date('2026-10-20T01:00:00Z')), '2026-10-19');
});

test('URL selection round-trips all filters and normalizes invalid or inconsistent day', () => {
  const filters = readCalendarSelection('?mes=2026-11&dia=2026-10-19&scope=team&tipo=visita&cliente=3', '2026-10-19');
  assert.deepEqual(filters, { mes: '2026-11', dia: '2026-11-01', scope: 'team', tipo: 'visita', cliente: '3', pagina: 0 });
  assert.deepEqual(readCalendarSelection(new URL(calendarHref(filters), 'https://example.org').search), filters);
  assert.deepEqual(readCalendarSelection('?mes=bad&dia=impossible&scope=private&tipo=money&cliente=-1', '2026-10-19'), selection);
  assert.equal(readCalendarSelection('?dia=2026-11-15', '2026-10-19').mes, '2026-11');
  assert.equal(shiftCalendarMonth(selection, 3).mes, '2027-01');
});

test('unsupported upper-bound month normalizes before any invalid API request', async () => {
  const normalized = readCalendarSelection('?mes=9999-12&dia=9999-12-31', '2026-10-19');
  assert.equal(normalized.mes, '2026-10'); assert.doesNotMatch(calendarQuery(normalized), /010000|9999/);
  assert.throws(() => calendarGrid('9999-12'));
  assert.equal(shiftCalendarMonth({ ...selection, mes: '9999-11', dia: '9999-11-01' }, 1).mes, '9999-11');
  let calls = 0; const current = session();
  const loader = createCalendarLoader({ request: async () => { calls++; }, sesion: current, readSession: () => current });
  await assert.rejects(loader.load({ ...selection, mes: '9999-12' })); assert.equal(calls, 0); loader.dispose();
});

test('paged request key includes selected day/page as well as API kind/client_id and range/scope', () => {
  assert.notEqual(calendarQuery(selection), calendarQuery({ ...selection, dia: '2026-10-21' }));
  assert.notEqual(calendarQuery(selection), calendarQuery({ ...selection, pagina: 1 }));
  assert.notEqual(calendarHref(selection), calendarHref({ ...selection, dia: '2026-10-21' }));
  const query = new URL(calendarQuery({ ...selection, tipo: 'visita', cliente: '3', scope: 'team' }), 'https://example.org').searchParams;
  assert.equal(query.get('kind'), 'visita'); assert.equal(query.get('cliente_id'), '3'); assert.equal(query.get('scope'), 'team');
  assert.equal(query.get('dia'), selection.dia); assert.equal(query.get('limit'), '200'); assert.equal(query.get('offset'), '0'); assert.equal(query.has('tipo'), false);
});

test('decoder accepts all four sources, null visit state and closed manual proof', () => {
  const result = decodeCalendar(dto(selection, [taskEvent(), visitEvent(), editorialEvent(), editorialEvent(true)]), selection);
  assert.equal(result.events.length, 4); assert.equal(new Set(result.events.map(e => e.key)).size, 4);
  assert.equal(result.events.find(e => e.kind === 'visita').estado, null);
  assert.equal(result.events.find(e => e.kind === 'publicacion').evidence.confirmation.source, 'manual');
});

test('milestones accept UUID identity and existing project context without colliding with visit UUID or task', () => {
  const result = decodeCalendar(dto(selection, [milestoneEvent(), visitEvent(), taskEvent()]), selection);
  assert.equal(result.events.length, 3); assert.equal(new Set(result.events.map(row => row.key)).size, 3);
  const row = result.events.find(row => row.kind === 'hito');
  assert.equal(row.source_id, visitId); assert.equal(row.href, `/proyectos?proyecto=${eventId}`);
  assert.equal(row.evidence, null); assert.equal(calendarEventLabel(row), 'Hito de proyecto');
  assert.equal(calendarEventTitle(row), 'Presentar identidad');
  assert.equal(calendarEventTitle({ ...row, title: 'Presentar identidad' }), 'Presentar identidad');
});

test('milestone filter round-trips URL/API query and excludes other kinds and mismatched clients/range', () => {
  const filters = readCalendarSelection('?mes=2026-10&dia=2026-10-19&scope=team&tipo=hito&cliente=3');
  assert.equal(filters.tipo, 'hito');
  assert.equal(new URL(calendarQuery(filters), 'https://example.org').searchParams.get('kind'), 'hito');
  assert.deepEqual(readCalendarSelection(new URL(calendarHref(filters), 'https://example.org').search), filters);
  assert.equal(decodeCalendar(dto(filters, [milestoneEvent()]), filters).events.length, 1);
  assert.throws(() => decodeCalendar(dto(filters, [taskEvent()]), filters));
  for (const patch of [{ cliente_id: 9 }, { cliente_id: null, cliente_nombre: null }, { date: null }, { date: '2026-12-01' }]) {
    assert.throws(() => decodeCalendar(dto(filters, [{ ...milestoneEvent(), ...patch }]), filters));
  }
});

test('milestone rejects non-UUID source identity and wrong source/key pair', () => {
  for (const patch of [{ source_id: 10 }, { source_id: 'not-a-uuid' }, { source: 'tarea' }, { source: 'visita' }, { key: `visita:visita:${visitId}` }]) {
    assert.throws(() => decodeCalendar(dto(selection, [{ ...milestoneEvent(), ...patch }]), selection));
  }
});

test('milestone href permits only one project UUID query on the existing project route', () => {
  for (const href of ['/proyectos', '/proyectos?proyecto=10', '/proyectos?proyecto=not-a-uuid', `/proyectos?proyecto=${eventId}&hito=${visitId}`,
    `/proyectos?proyecto=${eventId}&mes=2026-10`, `/proyectos?proyecto=${eventId}&proyecto=${visitId}`, `/proyectos?proyecto=${eventId}#hito`,
    `/proyectos/${eventId}`, `https://evil.example/proyectos?proyecto=${eventId}`, `//evil.example/proyectos?proyecto=${eventId}`]) {
    assert.throws(() => decodeCalendar(dto(selection, [{ ...milestoneEvent(), href }]), selection));
  }
});

test('milestone states stay distinct from task/publication and imply no actual completion date', () => {
  for (const [estado, label] of [['pendiente', 'Hito pendiente'], ['completado', 'Hito completado'], ['cancelado', 'Hito cancelado']]) {
    const row = decodeCalendar(dto(selection, [{ ...milestoneEvent(), estado }]), selection).events[0];
    assert.equal(calendarMilestoneState(row.estado), label); assert.equal(row.date, '2026-10-19'); assert.equal(row.evidence, null);
  }
  for (const estado of [null, 'finalizada', 'publicada', 'aprobada', 'en_revision', 'unknown']) {
    assert.throws(() => decodeCalendar(dto(selection, [{ ...milestoneEvent(), estado }]), selection));
  }
  assert.equal(calendarTaskState('publicada'), 'Finalizada');
  assert.equal(calendarMilestoneState('publicada'), 'Estado de hito sin clasificar');
  assert.throws(() => decodeCalendar(dto(selection, [{ ...milestoneEvent(), evidence: proof() }]), selection));
});

test('decoder drops arbitrary metadata and client financial fields', () => {
  const raw = dto(selection, [{ ...taskEvent(), metadata: { private: 'sentinel' }, monto: 'sentinel' }]);
  raw.clients[0].saldo = 'sentinel'; raw.range.private = 'sentinel';
  const clean = decodeCalendar(raw, selection);
  assert.equal(JSON.stringify(clean).includes('sentinel'), false);
  assert.deepEqual(Object.keys(clean.clients[0]), ['id', 'nombre']);
});

test('publication requires actual manual proof, date in Córdoba and matching work state', () => {
  for (const change of [row => { row.evidence = null; }, row => { row.evidence = 'confirmed'; }, row => { row.evidence.confirmation.source = 'legacy'; },
    row => { row.evidence.confirmation.actor_id = 0; }, row => { row.estado = 'lista'; }, row => { row.date = '2026-10-20'; }]) {
    const row = editorialEvent(true); change(row); assert.throws(() => decodeCalendar(dto(selection, [row]), selection));
  }
  assert.throws(() => decodeCalendar(dto(selection, [{ ...editorialEvent(), evidence: proof() }]), selection));
});

test('labels distinguish finished task from manual publication, schedule and recorded visit', () => {
  assert.equal(calendarTaskState('publicada'), 'Finalizada'); assert.equal(calendarTaskState('finalizada'), 'Finalizada');
  assert.equal(calendarEventLabel(editorialEvent()), 'Programación editorial');
  assert.equal(calendarEventLabel(visitEvent()), 'Visita de producción');
  assert.equal(calendarEventLabel(editorialEvent(true)), 'Publicación confirmada manualmente');
});

test('event titles remove only the exact leading kind prefix and preserve actual content or fallback', () => {
  for (const row of [taskEvent(), visitEvent(), editorialEvent(), editorialEvent(true)]) {
    const title = 'Video · Octubre: lanzamiento';
    assert.equal(calendarEventTitle({ ...row, title: `${calendarEventLabel(row)} · ${title}` }), title);
    assert.equal(calendarEventTitle({ ...row, title }), title);
    assert.equal(calendarEventTitle({ ...row, title: `Otro · ${calendarEventLabel(row)} · ${title}` }), `Otro · ${calendarEventLabel(row)} · ${title}`);
    assert.equal(calendarEventTitle({ ...row, title: `${calendarEventLabel(row)} · ` }), `${calendarEventLabel(row)} · `);
  }
  assert.equal(calendarEventTitle(taskEvent()), 'Editar video');
});

test('source/ID/key/range/filter/shape violations fail closed rather than inventing empty success', () => {
  for (const patch of [{ source_id: 0 }, { source: 'historia' }, { key: 'other' }, { date: '2026-12-01' }, { responsable_ids: ['4'] }, { cliente_id: -1 }, { estado: {} }]) {
    assert.throws(() => decodeCalendar(dto(selection, [{ ...taskEvent(), ...patch }]), selection));
  }
  assert.throws(() => decodeCalendar(dto(selection, [taskEvent(), taskEvent()]), selection));
  assert.throws(() => decodeCalendar({ ...dto(), events: {} }, selection));
  assert.throws(() => decodeCalendar({ ...dto(), scope: 'team' }, selection));
  assert.throws(() => decodeCalendar({ ...dto(), range: { desde: '2026-10-01', hasta: '2026-11-01' } }, selection));
  const filtered = { ...selection, cliente: '7' }; assert.throws(() => decodeCalendar(dto(filtered, [taskEvent()]), filtered));
  const kind = { ...selection, tipo: 'visita' }; assert.throws(() => decodeCalendar(dto(kind, [taskEvent()]), kind));
  assert.doesNotThrow(() => decodeCalendar(dto(selection, [{ ...taskEvent(), cliente_id: null, cliente_nombre: null }]), selection));
});

test('unsafe/off-origin or false contextual hrefs are rejected', () => {
  for (const href of ['https://evil.example/', '//evil.example/', '/workspace/tareas?task=11', '/workspace/tareas?task=10&task=11', '/workspace/tareas?task=10#x', '/\\evil', '/admin']) {
    assert.throws(() => decodeCalendar(dto(selection, [{ ...taskEvent(), href }]), selection));
  }
  assert.throws(() => decodeCalendar(dto(selection, [{ ...editorialEvent(), href: '/planificacion-historias?vista=checklist&cliente=9&mes=2026-10' }]), selection));
});

test('truncated is preserved even for empty filtered events, not inferred from array length', () => {
  const raw = { ...dto(), truncated: true }; assert.equal(decodeCalendar(raw, selection).truncated, true);
  assert.equal(decodeCalendar(dto(), selection).truncated, false);
});

test('loader is GET-only and has no role/name matching or additional endpoints', async () => {
  for (const role of ['admin', 'employee', 'diseno', 'edicion', 'produccion', 'community']) {
    const current = session(role); let calls = 0;
    const loader = createCalendarLoader({ sesion: current, readSession: () => current, request: async (url, options) => {
      calls++; assert.equal(url, calendarQuery(selection)); assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal); return pagedDto();
    } });
    assert.ok(await loader.load(selection)); assert.equal(calls, 1); loader.dispose();
  }
});

test('obsolete month success or transport failure is suppressed even if AbortSignal is ignored', async () => {
  for (const fail of [false, true]) {
    const first = deferred(), second = deferred(), current = session(); let calls = 0;
    const next = { ...selection, mes: '2026-11', dia: '2026-11-01' };
    const loader = createCalendarLoader({ sesion: current, readSession: () => current, request: () => ++calls === 1 ? first.promise : second.promise });
    const old = loader.load(selection), latest = loader.load(next); second.resolve(pagedDto(next)); assert.ok(await latest);
    if (fail) first.reject(new Error('private')); else first.resolve(pagedDto()); assert.equal(await old, undefined); loader.dispose();
  }
});

test('ID/token/role session switch suppresses pending data/errors and prevents dispatch without rerender', async () => {
  for (const field of ['id', 'token', 'role']) for (const fail of [false, true]) {
    const current = session(), wait = deferred(); let calls = 0, invalidations = 0;
    const loader = createCalendarLoader({ sesion: current, readSession: () => current, onInvalidated: () => invalidations++, request: () => { calls++; return wait.promise; } });
    const pending = loader.load(selection);
    if (field === 'id') current.usuario.id = 5; else if (field === 'token') current.token = 'changed'; else current.usuario.rol = 'admin';
    if (fail) wait.reject(new Error()); else wait.resolve(pagedDto());
    assert.equal(await pending, undefined); assert.equal(invalidations, 1);
    await assert.rejects(loader.load(selection), /sesión cambió/); assert.equal(calls, 1); loader.dispose();
  }
});

test('cancel/dispose suppress pending response and cancel permits a subsequent intentional refresh', async () => {
  const wait = deferred(), current = session(); let calls = 0;
  const loader = createCalendarLoader({ sesion: current, readSession: () => current, request: () => ++calls === 1 ? wait.promise : pagedDto() });
  const pending = loader.load(selection); loader.cancel(); wait.resolve(pagedDto()); assert.equal(await pending, undefined);
  assert.ok(await loader.load(selection)); loader.dispose(); assert.equal(await loader.load(selection), undefined);
});

test('current failures reject bounded errors; explicit retry can reflect changed source dates', async () => {
  const current = session(); let fail = true;
  const next = { ...selection, dia: '2026-10-21' };
  const loader = createCalendarLoader({ sesion: current, readSession: () => current, request: async () => { if (fail) throw new Error('private-diagnostic'); return pagedDto(next, [{ ...taskEvent(), date: '2026-10-21' }]); } });
  await assert.rejects(loader.load(selection), error => !error.message.includes('private') && error.message.includes('Reintentá'));
  fail = false; assert.equal((await loader.load(next)).events[0].date, '2026-10-21'); loader.dispose();
});

test('source contracts protect selected-day pagination, history cleanup, honest full counts and sidebar geometry', () => {
  const jsx = readFileSync(new URL('./Calendar.jsx', import.meta.url), 'utf8');
  assert.match(jsx, /\[requestKey, retry\]/); assert.match(jsx, /requestKey = calendarQuery\(selection\)/);
  assert.match(jsx, /removeEventListener\('popstate'/); assert.match(jsx, /history.replaceState/); assert.match(jsx, /navigateWithinApp/);
  assert.match(jsx, /Agenda paginada/); assert.match(jsx, /recuentos del calendario incluyen todos/); assert.match(jsx, /data\?\.pagination.days/);
  assert.doesNotMatch(jsx, /localStorage|sessionStorage|method: 'POST'|method: 'PATCH'/);
  const css = readFileSync(new URL('./Calendar.css', import.meta.url), 'utf8');
  assert.match(css, /margin-left:var\(--render-sidebar-width,236px\)/); assert.match(css, /max-width:980px.*margin-left:0/);
  assert.match(css, /min-height:44px/); assert.match(css, /focus-visible/);
  assert.doesNotMatch(css, /text-transform:capitalize/);
  assert.match(jsx, /calendarDateLabel as dateLabel/);
  const dateHelper=readFileSync(new URL('./calendarDateLabel.js',import.meta.url),'utf8');
  assert.match(dateHelper, /toLocaleUpperCase\('es-AR'\)\+label.slice\(1\)/);
  assert.match(dateHelper, /timeZone:'UTC'/);
  assert.match(jsx, /count === 1 \? "publicación" : "publicaciones"/);
  assert.match(jsx, /calendarPublicationLabel\(item\).*<\/h3>/);
  assert.match(jsx, /label="Contenido"/);
  assert.match(jsx, /readPublicationCalendarSelection as readCalendarSelection/);
  assert.doesNotMatch(jsx, /calendarTaskState|calendarMilestoneState|Abrir proyecto/);
  assert.match(jsx, /item.kind === 'publicacion'\?' · Publicado'/);
  assert.equal((jsx.match(/<main\b/g) || []).length, 1);
});
