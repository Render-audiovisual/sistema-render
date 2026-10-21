import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { projectHref, projectLocation, projectLocationUrl, projectListLocation, projectListLocationUrl,
  projectsListUrl, parseProjectsPage, parseProject, buildProjectMutation, createProjectsTransport, projectError } from './projectsModel.js';

const ID = '10000000-0000-4000-8000-000000000001';
const NEXT = '20000000-0000-4000-8000-000000000002';
const source = readFileSync(new URL('./Projects.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Projects.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && ['navigate', 'captureAction'].includes(node.name.getText(ast))) functions.set(node.name.getText(ast), `const ${node.name.getText(ast)} = ${node.initializer.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
function callback(name, deps) {
  assert.ok(functions.has(name), `Actual ${name} callback exists`);
  return new Function(...Object.keys(deps), `${functions.get(name)};return ${name};`)(...Object.values(deps));
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function summary(clientId = 11) {
  return { id: ID, revision: 3, titulo: 'Shared project', cliente: { id: clientId, nombre: 'Client' }, responsable: { id: 7, nombre: 'QA' },
    tipo: 'web', estado: 'en_curso', fecha_inicio: null, fecha_entrega: null, archivado: false, counts: { tareas: 0, finalizadas: 0, hitos: 0, entregables: 0 } };
}
const page = (clientId = 11) => ({ proyectos: [summary(clientId)], limit: 50, offset: 0, total: 1 });
function fixture(href = `https://render.test/proyectos?cliente=11&proyecto=${ID}`, request = async () => page()) {
  const effects = [], calls = [], mounted = { current: true }, filtersRef = { current: projectListLocation(href) };
  const selectionRef = { current: projectLocation(href) };
  const originalSelection = selectionRef.current;
  const formRef = { current: { kind: 'project', projectId: ID, baseRevision: 3,
    draft: { titulo: 'Unsaved' }, initial: { titulo: 'Original' }, busy: true, uncertain: true, requestId: 'immutable-request' } };
  const originalForm = formRef.current;
  const transport = createProjectsTransport(async (url, options) => { calls.push({ url, options }); return request(url, options); });
  const win = { location: new URL(href, 'https://render.test'), history: { state: { origin: 'client-hub' }, pushState(state, _title, path) {
    effects.push(['push', path, state]); win.location = new URL(path, win.location);
  }, replaceState(state, _title, path) { effects.push(['replace', path, state]); win.location = new URL(path, win.location); } } };
  const deps = { window: win, mounted, filtersRef, selectionRef, formRef, transport,
    projectListLocation, projectListLocationUrl, projectLocation, projectLocationUrl, projectsListUrl, parseProjectsPage, projectError,
    filterClients: { items: [{ id: 11, nombre: 'Same name' }, { id: 22, nombre: 'Same name' }] },
    setContextHref: value => effects.push(['context', value]), setFilters: value => effects.push(['filters', value]),
    setList: value => effects.push(['list', value]), setForm: value => effects.push(['form', value]),
    setMessage: value => effects.push(['message', value]), setSelection: value => effects.push(['selection', value]) };
  deps.restoreListContext = callback('restoreListContext', deps);
  deps.changeListFilters = callback('changeListFilters', deps);
  return { ...deps, effects, calls, originalSelection, originalForm,
    load: callback('loadProjectList', deps), navigate: callback('navigate', deps), choose: callback('chooseClient', deps),
    select: callback('selectProject', deps), dispose() { mounted.current = false; transport.dispose(); } };
}

test('client URL accepts only one exact positive int32; invalid context can never construct an all-projects query', () => {
  for (const id of ['1', '11', '2147483647']) assert.equal(projectListLocation(`/proyectos?cliente=${id}`).clientId, Number(id));
  assert.equal(projectListLocation('/proyectos').clientId, null);
  assert.equal(projectListLocation('/proyectos').invalid, false);
  for (const query of ['cliente=', 'cliente=0', 'cliente=-1', 'cliente=01', 'cliente=1.0', 'cliente=1e2', 'cliente=%2B1',
    'cliente=%201', 'cliente=1%20', 'cliente=1%0A', 'cliente=2147483648', 'cliente=NaN', 'cliente=none',
    'cliente=11&cliente=11', 'cliente=11&cliente=22', 'cliente[]=11', 'cliente[0]=11', 'cliente=11&cliente[]=22']) {
    const parsed = projectListLocation(`/proyectos?${query}`);
    assert.equal(parsed.invalid, true, query);
    assert.throws(() => projectsListUrl(parsed), query);
  }
  for (const query of ['offset=-1', 'offset=01', 'offset=1&offset=2', 'estado=', 'estado=unknown', 'estado=en_curso&estado=pausado', 'archivados=yes']) {
    assert.throws(() => projectsListUrl(projectListLocation(`/proyectos?cliente=11&${query}`)), query);
  }
});
test('API includes client ID, list state and pagination but never interprets a hub period as a monthly project filter', () => {
  const filters = projectListLocation('/proyectos?cliente=11&offset=50&estado=en_curso&archivados=true&periodo=2026-10');
  assert.equal(projectsListUrl(filters), '/api/proyectos?limit=50&offset=50&estado=en_curso&archivados=true&cliente_id=11');
  for (const clientId of ['11', [], {}, 0, -1, 2147483648, NaN]) assert.throws(() => projectsListUrl({ clientId }));
  assert.equal(projectsListUrl(), '/api/proyectos?limit=50&offset=0');
});
test('selection, full back link and listing URL retain client/page/unrelated context/hash across reload', () => {
  const href = `https://render.test/proyectos?cliente=11&offset=50&estado=en_curso&periodo=2026-10&tab=activity#detail`;
  const selected = projectHref(ID, href), back = projectLocationUrl(selected, null);
  assert.equal(selected, `/proyectos?cliente=11&offset=50&estado=en_curso&periodo=2026-10&tab=activity&proyecto=${ID}#detail`);
  assert.equal(back, '/proyectos?cliente=11&offset=50&estado=en_curso&periodo=2026-10&tab=activity#detail');
  assert.deepEqual(projectListLocation(back), projectListLocation(href));
  const changed = projectListLocationUrl(selected, { ...projectListLocation(href), clientId: 22, offset: 0 });
  assert.equal(projectLocation(changed).id, ID);
  assert.equal(projectListLocation(changed).clientId, 22);
  assert.equal(projectListLocation(changed).offset, 0);
  assert.match(changed, /periodo=2026-10/); assert.match(changed, /#detail$/);
});
test('actual same-project client/page popstate preserves form identity, busy/uncertain recovery, CAS and action scope', () => {
  const h = fixture();
  for (const context of ['cliente=22&offset=50', 'cliente=11', 'cliente=11&cliente=22']) {
    h.window.location = new URL(`https://render.test/proyectos?proyecto=${ID}&${context}`);
    h.navigate();
    assert.equal(h.formRef.current, h.originalForm);
    assert.equal(h.selectionRef.current, h.originalSelection);
    assert.equal(h.formRef.current.baseRevision, 3); assert.equal(h.formRef.current.busy, true);
    assert.equal(h.formRef.current.uncertain, true); assert.equal(h.formRef.current.requestId, 'immutable-request');
  }
  assert.ok(!h.effects.some(([kind]) => ['form', 'selection', 'push', 'replace'].includes(kind)));
  h.window.location = new URL(`https://render.test/proyectos?proyecto=${NEXT}&cliente=22`);
  h.navigate();
  assert.equal(h.selectionRef.current.id, NEXT); assert.equal(h.formRef.current, null);
});
test('actual client chooser only accepts canonical catalog IDs, resets page and never changes the selected project/form', () => {
  const h = fixture(`https://render.test/proyectos?cliente=11&offset=50&proyecto=${ID}#detail`);
  for (const invalid of ['Same name', '999', '022', '22 ', 'invalid']) h.choose(invalid);
  assert.equal(h.effects.length, 0);
  h.choose('22');
  assert.equal(h.filtersRef.current.clientId, 22); assert.equal(h.filtersRef.current.offset, 0);
  assert.equal(h.selectionRef.current, h.originalSelection); assert.equal(h.formRef.current, h.originalForm);
  assert.equal(h.window.location.searchParams.get('proyecto'), ID); assert.equal(h.window.location.hash, '#detail');
  assert.equal(h.effects.filter(([kind]) => kind === 'push').length, 1);
});
test('actual invalid URL load and refresh dispatch no global list request until explicit correction', async () => {
  const h = fixture('/proyectos?cliente=11&cliente=22', async () => ({ proyectos: [], limit: 50, offset: 0, total: 0 }));
  await h.load(); await h.load(); assert.equal(h.calls.length, 0);
  assert.equal(h.effects.at(-1)[1].status, 'error'); assert.equal(h.effects.at(-1)[1].data, null);
  h.choose('22'); await h.load();
  assert.equal(new URL(h.calls[0].url, 'https://render.test').searchParams.get('cliente_id'), '22');
  assert.equal(h.calls.length, 1);
  assert.equal(h.effects.at(-1)[1].status, 'ready');
});
test('actual A→B→A loader rejects old successes/failures even when the final URL equals the original', async () => {
  for (const outcome of ['success', 'failure']) {
    const first = deferred(); let count = 0;
    const h = fixture(undefined, () => ++count === 1 ? first.promise : Promise.resolve(page()));
    const pending = h.load();
    h.restoreListContext(`/proyectos?cliente=22&proyecto=${ID}`);
    h.restoreListContext(`/proyectos?cliente=11&proyecto=${ID}`);
    await h.load(); const effects = h.effects.length;
    outcome === 'success' ? first.resolve(page()) : first.reject(new Error('private old failure'));
    await pending;
    assert.equal(h.effects.length, effects);
    assert.equal(h.effects.at(-1)[1].status, 'ready');
    assert.equal(h.formRef.current, h.originalForm);
  }
});
test('actual list refuses incompatible client DTOs and suppresses paints after disposal', async () => {
  const foreign = fixture(undefined, async () => page(22)); await foreign.load();
  assert.equal(foreign.effects.at(-1)[1].status, 'error'); assert.equal(foreign.effects.at(-1)[1].data, null);
  const late = deferred(), h = fixture(undefined, () => late.promise), pending = h.load();
  const before = h.effects.length; h.dispose(); late.resolve(page()); await pending;
  assert.equal(h.effects.length, before);
});
test('actual project selection preserves list context; back removes only project identity and does not reset the client page', () => {
  const h = fixture(`https://render.test/proyectos?cliente=11&offset=50&periodo=2026-10#detail`);
  h.select(ID);
  assert.equal(h.window.location.searchParams.get('cliente'), '11');
  assert.equal(h.window.location.searchParams.get('offset'), '50');
  h.select(null);
  assert.equal(h.window.location.searchParams.has('proyecto'), false);
  assert.equal(h.window.location.searchParams.get('cliente'), '11');
  assert.equal(h.window.location.searchParams.get('offset'), '50');
  assert.equal(h.window.location.searchParams.get('periodo'), '2026-10');
});
test('actual filter changes preserve original action scope; a later project/session switch invalidates it', () => {
  const h = fixture();
  const sesion = { token: 'QA-A', usuario: { id: 7, rol: 'admin' } }; let live = sesion;
  const capture = callback('captureAction', { selectionRef: h.selectionRef, mounted: h.mounted,
    sesion, getSesion: () => live, request: async () => ({}), createCapturedRequest });
  const guard = capture();
  h.choose('22'); assert.equal(guard.current(), true);
  h.choose('11'); assert.equal(guard.current(), true);
  h.select(NEXT); assert.equal(guard.current(), false);
  const next = capture(); live = { token: 'QA-B', usuario: { id: 8, rol: 'admin' } };
  assert.equal(next.current(), false);
});
test('actual pending write ACK cannot restore an old client/page or wipe a replacement project form', async () => {
  for (const switchProject of [false, true]) {
    const h = fixture(`https://render.test/proyectos?cliente=11&offset=50&proyecto=${ID}`), reply = deferred();
    const sesion = { token: 'QA-A', usuario: { id: 7, rol: 'admin' } };
    const capture = callback('captureAction', { selectionRef: h.selectionRef, mounted: h.mounted,
      sesion, getSesion: () => sesion, request: () => reply.promise, createCapturedRequest });
    const form = { seq: 1, kind: 'stage-edit', projectId: ID, childId: NEXT, baseRevision: 3,
      draft: { titulo: 'Observed stage', estado: 'pendiente' }, initial: { titulo: 'Old stage', estado: 'pendiente' },
      busy: false, conflict: false, scope: capture() };
    h.formRef.current = form;
    const paints = [], deps = { formRef: h.formRef, mutationBusy: { current: false }, detailReadGeneration: { current: 0 },
      buildProjectMutation, parseProject, projectError, sesion,
      transport: { cancel() {}, write: (mutation, scope) => scope.request(mutation.path, { method: mutation.method, body: JSON.stringify(mutation.body) }) },
      setDetail: value => paints.push(['detail', value]), setForm: value => { h.formRef.current = typeof value === 'function' ? value(h.formRef.current) : value; paints.push(['form']); },
      setMessage: value => paints.push(['message', value]), setListRefresh: () => paints.push(['refresh']), selectProject: h.select };
    const submit = callback('submit', deps), pending = submit({ preventDefault() {} });
    h.choose('22'); assert.equal(h.window.location.searchParams.get('offset'), null);
    const replacement = { seq: 2, draft: { titulo: 'Replacement' }, initial: {}, baseRevision: 9 };
    if (switchProject) { h.select(NEXT); h.formRef.current = replacement; }
    const before = paints.length;
    reply.resolve({ proyecto: { ...summary(), revision: 4, descripcion: '', miembro_ids: [], tareas_no_disponibles: 0,
      permissions: { administrar: true, editar: true }, etapas: [], hitos: [], entregables: [], tareas: [], actividad: [] } });
    await pending;
    assert.equal(h.window.location.searchParams.get('cliente'), '22');
    assert.equal(h.window.location.searchParams.has('offset'), false);
    if (switchProject) { assert.equal(paints.length, before); assert.equal(h.formRef.current, replacement); }
    else { assert.equal(h.formRef.current, null); assert.ok(paints.some(([kind]) => kind === 'refresh')); }
  }
});
test('source uses separate catalog read and filter context, preserves native links and states all-time semantics', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.match(source, /projectHref\(item.id, contextHref\)/);
  assert.match(source, /href=\{projectLocationUrl\(contextHref, null\)\}/);
  assert.match(source, /aria-label="Filtrar proyectos por cliente"/);
  assert.match(source, /transport.read\('filter-clients', '\/api\/clientes'\)/);
  assert.match(source, /Proyectos de todos los períodos/);
  assert.match(source, /list.context === filters/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
