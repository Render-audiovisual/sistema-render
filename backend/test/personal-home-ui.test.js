import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPersonalHomeLoader, parsePersonalHome, homeDate, homeDeadline, homeStateLabel, personalHomeNavigate, subscribePersonalHomeRefresh } from '../../frontend/src/pages/personalHome.js';

const source = readFileSync(new URL('../../frontend/src/pages/QuickHome.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../frontend/src/pages/QuickHome.css', import.meta.url), 'utf8');
const secret = 'PRIVATE_HOME_SENTINEL';
function fixture(id = 11) {
  const task = { id: 101, titulo: 'Revisar guion', estado: 'en_progreso', prioridad: 'alta', fecha_vencimiento: '2026-10-19', cliente: { id: 1, nombre: 'Cliente' }, revision: 7, href: '/workspace/tareas?task=101' };
  const visitId = '00000000-0000-4000-8000-000000000011';
  return { version: 1, generated_at: '2026-10-19T12:00:00Z', today: '2026-10-19', user: { id, nombre: 'Mismo nombre' },
    summary: { open: 15, overdue: 3, today: 1, upcoming: 6, undated: 5, awaiting_review: 1 }, tasks: [task],
    review: { scope: 'personal', total: 1, items: [{ ...task, estado: 'en_revision' }] }, clients: [{ id: 1, nombre: 'Cliente', open: 15 }],
    visits: [{ id: visitId, titulo: 'Visita', fecha: '2026-10-20', cliente: { id: 1, nombre: 'Cliente' }, href: `/producciones?visita=${visitId}&mes=2026-10` }],
    activity: [{ task_id: 101, titulo: 'Revisar guion', estado: 'en_progreso', updated_at: '2026-10-19T12:00:00Z', href: '/workspace/tareas?task=101' }],
    list_totals: { clients: 1, visits: 1, activity: 1 }, capabilities: { projects: false } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('home DTO projection keeps operational fields and totals, never arbitrary metadata, even for admin', () => {
  for (const admin of [false, true]) {
    const input = fixture();
    input.importe = secret;
    input.user.token = secret;
    input.tasks[0].propiedades_extra = { copy_trabajo: secret, sueldo: secret };
    input.tasks[0].cliente.finanzas = secret;
    input.review.items[0].comments = secret;
    input.visits[0].drive_secret = secret;
    input.activity[0].audit = secret;
    input.clients[0].amount = secret;
    input.review.scope = admin ? 'team' : 'personal';
    const before = structuredClone(input);
    const result = parsePersonalHome(input, 11, admin);
    assert.equal(result.summary.open, 15);
    assert.equal(result.tasks[0].revision, 7);
    assert.deepEqual(result.list_totals, { ...input.list_totals, projects: 0 });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.deepEqual(input, before);
  }
});

test('same display name cannot substitute for current stable user ID; team queue is admin-only', () => {
  assert.throws(() => parsePersonalHome(fixture(12), 11));
  assert.throws(() => parsePersonalHome(fixture(), null));
  const data = fixture(); data.review.scope = 'team';
  assert.throws(() => parsePersonalHome(data, 11));
  assert.equal(parsePersonalHome(data, 11, true).review.scope, 'team');
});

test('home parser projects optional monthly task progress without treating it as publication or retaining extra metadata', () => {
  const value = fixture();
  value.monthly_progress = { period: value.today.slice(0, 7), total: 3, completed: 1,
    by_sector: [{ sector: 'desarrollo', total: 1, completed: 0 }, { sector: 'diseno', total: 2, completed: 1 }],
    finanzas: secret, publicaciones: 500 };
  const result = parsePersonalHome(value, 11);
  assert.deepEqual(result.monthly_progress, { period: '2026-10', total: 3, completed: 1,
    by_sector: [{ sector: 'desarrollo', total: 1, completed: 0 }, { sector: 'diseno', total: 2, completed: 1 }] });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(Object.hasOwn(parsePersonalHome(fixture(), 11), 'monthly_progress'), false);
  value.monthly_progress.completed = 4;
  assert.throws(() => parsePersonalHome(value, 11));
});

test('connected assigned projects retain bounded totals and safe real links, without metadata or financial bags', () => {
  const data = fixture();
  const id = '00000000-0000-4000-8000-000000000063';
  data.capabilities.projects = true;
  data.list_totals.projects = 12;
  data.projects = [{ id, titulo: 'Web institucional', tipo: 'web', estado: 'en_curso', revision: 3,
    fecha_entrega: '2026-11-03', cliente: {id: 1, nombre: 'Cliente', importe: secret},
    href: `/proyectos?proyecto=${id}`, finanzas: {sueldo: secret}, descripcion: secret }];
  const before = structuredClone(data);
  const result = parsePersonalHome(data, 11);
  assert.equal(result.capabilities.projects, true);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].revision, 3);
  assert.equal(result.list_totals.projects, 12);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(data, before);
  for (const change of [
    value => { value.projects[0].href = 'https://example.invalid/private'; },
    value => { value.projects[0].revision = 0; },
    value => { value.projects[0].fecha_entrega = '2026-02-30'; },
    value => { value.list_totals.projects = 0; },
    value => { value.projects = Array(9).fill(value.projects[0]); },
  ]) { const invalid = structuredClone(data); change(invalid); assert.throws(() => parsePersonalHome(invalid, 11)); }
});

test('bounded lists retain exact larger counts and support empty, undated, unknown historical and finalized states', () => {
  const data = fixture();
  data.tasks = Array.from({ length: 12 }, (_, index) => ({ ...data.tasks[0], id: index + 1, href: `/workspace/tareas?task=${index + 1}` }));
  data.tasks[0].estado = 'historic_unknown'; data.tasks[0].fecha_vencimiento = null; data.tasks[0].cliente = null;
  data.activity[0].estado = 'publicada';
  const result = parsePersonalHome(data, 11);
  assert.equal(result.tasks.length, 12); assert.equal(result.summary.open, 15);
  assert.equal(result.tasks[0].estado, 'historic_unknown');
  assert.equal(homeStateLabel('historic_unknown'), 'Estado: historic_unknown');
  assert.equal(homeStateLabel('publicada'), 'Finalizada');
  assert.equal(homeStateLabel('aprobada'), 'Aprobada');
  data.tasks.push({ ...data.tasks[0], id: 20, href: '/workspace/tareas?task=20' });
  assert.throws(() => parsePersonalHome(data, 11));
  const empty = fixture();
  for (const key of Object.keys(empty.summary)) empty.summary[key] = 0;
  empty.tasks = []; empty.review.items = []; empty.review.total = 0;
  empty.clients = []; empty.visits = []; empty.activity = [];
  empty.list_totals = { clients: 0, visits: 0, activity: 0 };
  assert.deepEqual(parsePersonalHome(empty, 11), {...empty, projects: [], list_totals: {...empty.list_totals, projects: 0}});
});

test('malformed or external links and impossible totals/dates fail closed instead of inventing success', () => {
  const cases = [
    data => { data.tasks[0].href = 'javascript:alert(1)'; },
    data => { data.activity[0].href = 'https://example.test'; },
    data => { data.visits[0].href = '//example.test'; },
    data => { data.today = '2026-02-30'; },
    data => { data.tasks[0].revision = 0; },
    data => { data.summary.open = 0; },
    data => { data.list_totals.visits = 0; },
    data => { data.capabilities.projects = true; },
  ];
  for (const change of cases) { const data = fixture(); change(data); assert.throws(() => parsePersonalHome(data, 11)); }
});

test('date labels use server today without local-clock or timezone day shifts', () => {
  assert.equal(homeDeadline(null, '2026-10-19'), 'Sin fecha');
  assert.equal(homeDeadline('2026-10-19', '2026-10-19'), 'Hoy');
  assert.match(homeDeadline('2026-10-18', '2026-10-19'), /^Venció el 18/);
  assert.match(homeDate('2026-10-19', true), /lunes.*19.*octubre/);
});

test('real links preserve modifier/middle click and use SPA navigation only for plain left click', () => {
  let navigated, prevented = false;
  const base = { button: 0, preventDefault() { prevented = true; } };
  for (const flags of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    personalHomeNavigate({ ...base, ...flags }, '/workspace/tareas?task=101', href => { navigated = href; });
    assert.equal(navigated, undefined); assert.equal(prevented, false);
  }
  personalHomeNavigate(base, '/workspace/tareas?task=101', href => { navigated = href; });
  assert.equal(navigated, '/workspace/tareas?task=101'); assert.equal(prevented, true);
});

test('loader uses only current-user endpoint, cancels older requests and ignores out-of-order responses', async () => {
  const calls = [], states = [], pending = [];
  const loader = createPersonalHomeLoader({ userId: 11, onChange: state => states.push(state), request: (url, options) => {
    calls.push({ url, options }); const next = deferred(); pending.push(next); return next.promise;
  } });
  const first = loader.refresh(); const second = loader.refresh();
  assert.equal(calls[0].url, '/api/inicio'); assert.equal(calls[1].url, '/api/inicio');
  assert.equal(calls[0].options.signal.aborted, true);
  pending[1].resolve(fixture()); await second;
  const before = states.length;
  pending[0].resolve(fixture(12)); await first;
  assert.equal(states.length, before); assert.equal(states.at(-1).data.user.id, 11);
  loader.dispose();
});

test('dispose/session switch aborts request and prevents previous user data from being published', async () => {
  const pending = deferred(), states = []; let signal;
  const loader = createPersonalHomeLoader({ userId: 11, onChange: state => states.push(state), request: (_url, options) => { signal = options.signal; return pending.promise; } });
  const result = loader.refresh(); loader.dispose(); pending.resolve(fixture()); await result;
  assert.equal(signal.aborted, true); assert.deepEqual(states.map(state => state.status), ['loading']);
  assert.equal(await loader.refresh(), false);
  const nextStates = [];
  const next = createPersonalHomeLoader({ userId: 12, onChange: state => nextStates.push(state), request: async () => fixture(12) });
  await next.refresh(); assert.equal(nextStates.at(-1).data.user.id, 12); next.dispose();
});

test('revocation clears prior success; temporary failure retains an explicitly stale snapshot without leaking errors', async () => {
  for (const status of [401, 403, 404, 500]) {
    const states = []; let attempt = 0;
    const loader = createPersonalHomeLoader({ userId: 11, onChange: state => states.push(state), request: async () => {
      if (++attempt === 2) throw Object.assign(new Error(secret), { status });
      return fixture();
    } });
    await loader.refresh(); const previous = states.at(-1).data;
    await loader.refresh();
    assert.equal(states.at(-1).status, 'error');
    assert.equal(states.at(-1).data, status === 500 ? previous : null);
    assert.equal(/última consulta/.test(states.at(-1).error), status === 500);
    assert.equal(states.at(-1).error.includes(secret), false);
    await loader.refresh(); assert.equal(states.at(-1).status, 'ready'); assert.equal(attempt, 3);
    loader.dispose();
  }
});

test('background refresh is bounded, does not overlap or retry automatically, and event listeners clean up', async () => {
  let clock = 1000, requests = 0;
  const loader = createPersonalHomeLoader({ userId: 11, now: () => clock, onChange() {}, request: async () => { requests++; return fixture(); } });
  await loader.refresh();
  assert.equal(await loader.refresh({ background: true }), false);
  clock += 30000; await loader.refresh({ background: true }); assert.equal(requests, 2);
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'hidden';
  const cleanup = subscribePersonalHomeRefresh(loader, win, doc);
  clock += 30000; win.dispatchEvent(new Event('focus')); assert.equal(requests, 2);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('online'));
  assert.equal(requests, 3);
  await Promise.resolve(); await Promise.resolve();
  cleanup(); clock += 30000;
  win.dispatchEvent(new Event('focus')); win.dispatchEvent(new Event('online')); doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(requests, 3); loader.dispose();
});

test('principal UI binds state to session identity, keeps honest totals and operational secondary links only', () => {
  assert.match(source, /result\?\.identity === identity/);
  assert.match(source, /identityRef\.current === identity/);
  assert.match(source, /const identity = useSessionView\(sesion\)/);
  assert.match(source, /sessionBindingMatches\(captured\.binding, getSesion\(\)\)/);
  assert.match(source, /sessionRequestOptions\(captured\.binding, options\)/);
  assert.match(source, /\[identity, request, validIdentity, userId, role\]/);
  assert.match(source, /loader\.dispose\(\)/);
  assert.match(source, /unsubscribe\(\)/);
  assert.match(source, /Mostrando \$\{shown\} de \$\{total\}/);
  assert.match(source, /shown=\{data\.tasks\.length\} total=\{data\.summary\.open\}/);
  assert.match(source, /Tareas actualizadas/);
  assert.match(source, /href=\{task\.href\}/);
  assert.match(source, /href=\{visit\.href\}/);
  assert.match(source, /role="alert"/); assert.match(source, /role="status"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|Math\.random|\/sueldos|\/finanzas|dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /Mis proyectos|href=\{project.href\}/);
  assert.doesNotMatch(source, /title: "(?:Proyectos|Publicaciones)"/);
  assert.match(source, /href: "\/calendario", title: "Calendario"/);
  assert.match(css, /min-height:44px/); assert.match(css, /focus-visible/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /max-width:1440px/); assert.match(css, /@media\(max-width:440px\)/);
});
