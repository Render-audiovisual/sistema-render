import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { productionReadUrl, assertProductionClient } from './productionRouteContext.js';
import { verifiedProductionDraftVisit } from './productionDraft.js';
import { createProductionVisitObserver, newestProductionVisit, reconcileProductionVisitList } from './productionVisitObservation.js';

// Actual collection effect/refresh handler with controlled requests and setters.
// Reconciliation is injected from the real product module, never replaced by
// a test-only admission algorithm.
const source = readFileSync(new URL('./Productions.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Productions.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(ast.parseDiagnostics.length, 0);
const nodes = []; (function walk(node) { nodes.push(node); ts.forEachChild(node, walk); })(ast);
const effect = nodes.filter(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect')
  .find(node => node.arguments[0].getText(ast).includes('Promise.all([apiRequest(productionReadUrl'));
assert.ok(effect, 'Actual production collection effect');
const refresh = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'refreshVisit');
assert.ok(refresh);
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(ast)});`)(...Object.values(deps));
const id = '11111111-1111-4111-8111-111111111111';
const visit = (revision, fields = {}) => ({ id, revision, cliente_id: 7, cliente_nombre: 'Synthetic', fecha: '2026-10-20',
  titulo: `Revision ${revision}`, observaciones: '', drive_url: '', participante_ids: [], videos: [], fotos: [], ...fields });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(initial = [visit(1)]) {
  const collection = deferred(), paints = [], errors = [];
  let visits = initial, selected = initial[0];
  const deps = {
    newestProductionVisit, reconcileProductionVisitList, AbortController, productionReadUrl, assertProductionClient, verifiedProductionDraftVisit,
    readEpoch: { current: 0 }, openVersion: { current: 1 }, refreshVersion: { current: 0 },
    month: '2026-10', clientId: '7', tab: 'calendar', contextError: '',
    positiveId: value => Number.isSafeInteger(value) && value > 0,
    apiRequest: async url => {
      if (url === '/api/producciones?mes=2026-10&cliente_id=7') return collection.promise;
      if (url === `/api/producciones/${id}`) return visit(3);
      if (url === '/api/usuarios' || url === '/api/clientes') return [];
      assert.fail(`Unexpected request: ${url}`);
    },
    setVisits(value) { visits = typeof value === 'function' ? value(visits) : value; paints.push(['visits', visits]); },
    setSelected(value) { selected = typeof value === 'function' ? value(selected) : value; },
    setError(value) { errors.push(value); },
    ...Object.fromEntries(['Loading', 'ListAvailable', 'Pending', 'PendingPhotos', 'Users', 'Clients'].map(name =>
      [`set${name}`, value => paints.push([name, value])])),
  };
  const observer = createProductionVisitObserver(() => deps.readEpoch.current);
  deps.visitObserver = {current:observer};
  deps.setBankObservation = value=>paints.push(['BankObservation',value]);
  deps.observeProductionVisit = value => observer.observe(value);
  return { deps, collection, paints, errors, run: () => evaluate(effect.arguments[0], deps)(),
    refresh: () => evaluate(refresh.initializer, deps)(id), get visits() { return visits; }, get selected() { return selected; } };
}

test('collection rev2 arriving after actual detail refresh rev3 cannot downgrade the existing list observation', async () => {
  const f = fixture(), cleanup = f.run();
  try {
    await f.refresh();
    assert.equal(f.selected.revision, 3); assert.equal(f.visits[0].revision, 3);
    f.collection.resolve({ visitas: [visit(2)] }); await settle();
    assert.equal(f.visits[0].revision, 3); assert.equal(f.visits[0].titulo, 'Revision 3');
    assert.equal(f.selected.revision, 3); assert.deepEqual(f.errors, ['']);
  } finally { cleanup(); }
});

test('incoming collection membership remains authoritative and never resurrects an absent current row', async () => {
  const f = fixture([visit(3)]), cleanup = f.run();
  try { f.collection.resolve({ visitas: [] }); await settle(); assert.deepEqual(f.visits, []); assert.equal(f.selected.revision, 3); }
  finally { cleanup(); }
});

for (const fields of [{ fecha: '2026-11-20' }]) {
  test(`newer existing row outside the selected month/client must not revive an older matching row: ${JSON.stringify(fields)}`, async () => {
    const f = fixture([visit(3, fields)]), cleanup = f.run();
    try { f.collection.resolve({ visitas: [visit(2)] }); await settle(); assert.deepEqual(f.visits, []); }
    finally { cleanup(); }
  });
}

test('newer cross-client observation suppresses the stale list candidate without donating foreign data into detail', async () => {
  const known = visit(3, { cliente_id: 8, titulo: 'Other client observation' });
  const before = structuredClone(known), f = fixture([known]), cleanup = f.run();
  try {
    f.collection.resolve({ visitas: [visit(2)] }); await settle();
    assert.deepEqual(f.visits, []);
    // newestProductionVisit intentionally compares revisions only within the
    // same client. The detail may adopt the validated selected-client DTO,
    // never a higher revision's fields from a different client observation.
    assert.deepEqual(f.selected, visit(2));
    assert.deepEqual(known, before);
  } finally { cleanup(); }
});

test('equal revision admits refreshed derived task state instead of freezing an old aggregate', async () => {
  const video = { id: '22222222-2222-4222-8222-222222222222', visita_id: id, video_origen_id: null,
    titulo: 'Video', guion: '', estado: 'grabado', material_url: '', observaciones: '',
    tarea_edicion_id: null, editor_id: null, fecha_entrega: null, publicacion_id: null,
    tarea_entrega_id: null, cliente_editorial_id: null, editor_actual_id: null,
    fecha_entrega_actual: null, tarea_cliente_id: null, editor_handoff_id: null, fecha_entrega_handoff: null };
  const current = visit(3, { videos: [{ ...video, tarea_estado: 'en_revision' }] });
  const incoming = visit(3, { videos: [{ ...video, tarea_estado: 'finalizada' }] });
  const before = structuredClone(current), f = fixture([current]), cleanup = f.run();
  try {
    f.collection.resolve({ visitas: [incoming] }); await settle();
    assert.equal(f.visits[0].videos[0].tarea_estado, 'finalizada');
    assert.equal(f.selected.videos[0].tarea_estado, 'finalizada');
    assert.deepEqual(current, before);
  } finally { cleanup(); }
});

test('newer incoming collection revision is admitted normally', async () => {
  const f = fixture([visit(3)]), cleanup = f.run();
  try { f.collection.resolve({ visitas: [visit(4)] }); await settle(); assert.equal(f.visits[0].revision, 4); assert.equal(f.selected.revision, 4); }
  finally { cleanup(); }
});

test('collection rev3 advances an existing rev2 detail and list together without merging fields', async () => {
  const f = fixture([visit(2)]), cleanup = f.run();
  const incoming = visit(3, { titulo: 'Whole fresh aggregate', observaciones: 'Fresh observation' });
  try {
    f.collection.resolve({ visitas: [incoming] }); await settle();
    assert.deepEqual(f.visits, [incoming]); assert.deepEqual(f.selected, incoming);
    assert.deepEqual(f.errors, ['']);
  } finally { cleanup(); }
});

test('malformed collection candidate cannot paint detail/list or mark the list available', async () => {
  const f = fixture([visit(2)]), cleanup = f.run(), before = structuredClone(f.visits);
  try {
    f.collection.resolve({ visitas: [visit(3), { ...visit(4), id: 'other', fotos: null }] }); await settle();
    assert.deepEqual(f.visits, before); assert.deepEqual(f.selected, before[0]);
    assert.equal(f.paints.some(([key]) => key === 'visits'), false);
    assert.equal(f.paints.some(([key, value]) => key === 'ListAvailable' && value === true), false);
    assert.ok(f.errors.at(-1));
  } finally { cleanup(); }
});

for (const boundary of ['cleanup', 'epoch']) test(`obsolete collection after ${boundary} cannot publish`, async () => {
  const f = fixture([visit(3)]), cleanup = f.run();
  if (boundary === 'cleanup') cleanup(); else f.deps.readEpoch.current++;
  const count = f.paints.length;
  f.collection.resolve({ visitas: [visit(2)] }); await settle();
  assert.equal(f.paints.length, count); assert.equal(f.visits[0].revision, 3);
  cleanup();
});
