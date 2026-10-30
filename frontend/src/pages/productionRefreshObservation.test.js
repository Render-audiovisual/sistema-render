import { createProductionCatalogReader } from "./productionCatalogReader.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { verifiedProductionDraftVisit } from './productionDraft.js';
import { assertProductionClient } from './productionRouteContext.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createProductionVisitObserver, newestProductionVisit, reconcileProductionVisitList } from './productionVisitObservation.js';

// Actual callbacks and DTO validator; controlled transport/setters, not mounted
// React, native navigation, physical HTTP or persisted revision assertions.
const source = readFileSync(new URL('./Productions.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Productions.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(ast.parseDiagnostics.length, 0);
const nodes = []; (function walk(node) { nodes.push(node); ts.forEachChild(node, walk); })(ast);
function callback(name, deps) {
  const matches = nodes.filter(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  assert.equal(matches.length, 1, name);
  return new Function(...Object.keys(deps), `return (${matches[0].initializer.getText(ast)});`)(...Object.values(deps));
}
const id = '11111111-1111-4111-8111-111111111111';
const visit = revision => ({ id, revision, cliente_id: 7, cliente_nombre: 'Synthetic client', fecha: '2026-10-20',
  titulo: `Observation ${revision}`, observaciones: '', drive_url: '', participante_ids: [], videos: [], fotos: [] });
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let selected = visit(1), visits = [selected], session = { token: 'synthetic-A', usuario: { id: 7, rol: 'edicion' } };
  const held = [], paints = [], errors = [];
  const request = url => new Promise((resolve, reject) => { held.push({ url, resolve, reject }); });
  const deps={productionCatalog:{current:{reader:createProductionCatalogReader()}},
    readEpoch: { current: 0 }, openVersion: { current: 1 }, refreshVersion: { current: 0 },
    clientId: '7', month: '2026-10', selected, verifiedProductionDraftVisit, assertProductionClient, newestProductionVisit, reconcileProductionVisitList, apiRequest: request,
    setSelected(update) { selected = update(selected); paints.push(['selected', selected]); },
    setVisits(update) { visits = update(visits); paints.push(['visits', visits]); },
    setError(message) { errors.push(message); }, setReload() {},
    mayLeave() { assert.fail('Selected-detail retry must not replace the form or prompt'); },
    navigationRef: { current() { assert.fail('Selected-detail retry must not restore navigation'); } },
  };
  const observer = createProductionVisitObserver(()=>deps.readEpoch.current);
  deps.observeProductionVisit = value=>observer.observe(value);
  const refresh = callback('refreshVisit', deps);
  const retry = callback('retryProductionPage', { ...deps, refreshVisit: refresh });
  return { deps, held, paints, errors, refresh, retry, get selected() { return selected; }, get visits() { return visits; },
    guard: () => createCapturedRequest({ session, readSession: () => session, request }),
    replaceSession() { session = { token: 'synthetic-B', usuario: { id: 8, rol: 'edicion' } }; } };
}
const observe = promise => promise.then(value => ({ value }), error => ({ error }));

test('external reschedule updates the same detail and removes old-month membership without replacing the form context',async()=>{
  const f=fixture(),pending=f.refresh(id);
  f.held[0].resolve({...visit(2),fecha:'2026-11-03'});await pending;
  assert.equal(f.selected.id,id);assert.equal(f.selected.fecha,'2026-11-03');
  assert.deepEqual(f.visits,[]);assert.deepEqual(f.errors,[]);
  assert.equal(f.deps.month,'2026-10','Refreshing alone must not silently navigate or discard a form');
});

test('latest same-UUID refresh wins when an older valid response arrives last', async () => {
  const f = fixture();
  const old = observe(f.refresh(id)), current = f.refresh(id);
  f.held[1].resolve(visit(3)); await current;
  assert.equal(f.selected.revision, 3);
  const paints = f.paints.length;
  f.held[0].resolve(visit(2));
  assert.equal((await old).error?.code, 'production_read_obsolete');
  assert.equal(f.paints.length, paints);
  assert.equal(f.selected.revision, 3); assert.equal(f.visits[0].revision, 3);
});

for (const outcome of ['success', 'failure']) test(`retry ignores obsolete ${outcome} after a newer success without showing an old error`, async () => {
  const f = fixture(); f.retry(); f.retry();
  assert.equal(f.held.length, 2);
  f.held[1].resolve(visit(3)); await settle();
  const paints = f.paints.length;
  if (outcome === 'success') f.held[0].resolve(visit(2));
  else f.held[0].reject(new Error('Old read failure'));
  await settle();
  assert.equal(f.selected.revision, 3); assert.equal(f.visits[0].revision, 3);
  assert.equal(f.paints.length, paints); assert.deepEqual(f.errors, []);
});

for (const boundary of ['openVersion ABA', 'readEpoch']) test(`${boundary} invalidates a held response even when the selected UUID is unchanged`, async () => {
  const f = fixture(), pending = observe(f.refresh(id));
  if (boundary === 'openVersion ABA') f.deps.openVersion.current += 2;
  else f.deps.readEpoch.current++;
  f.held[0].resolve(visit(2));
  assert.equal((await pending).error?.code, 'production_read_obsolete');
  assert.deepEqual(f.paints, []); assert.equal(f.selected.revision, 1); assert.equal(f.visits[0].revision, 1);
});

test('current read failure is not swallowed by retry and leaves the existing observation unchanged', async () => {
  const f = fixture(); f.retry();
  f.held[0].reject(new Error('Current read unavailable')); await settle();
  assert.deepEqual(f.errors, ['Current read unavailable']);
  assert.equal(f.selected.revision, 1); assert.deepEqual(f.paints, []);
});

test('a refresh started between admitted rejection and retry catch prevents the older error from publishing', async () => {
  const f = fixture();
  f.retry();
  f.held[0].reject(new Error('Admitted error from the first observation'));
  // The refresh await/catch resumes first and rejects its returned promise.
  // This continuation runs before retry's downstream catch: the first error
  // was current at admission, so obsolete-code filtering alone cannot help.
  await Promise.resolve();
  assert.deepEqual(f.errors, []);
  const newer = f.refresh(id);
  assert.equal(f.held.length, 2);
  await settle();
  assert.deepEqual(f.errors, [], 'Error publication must recheck the live refresh observation');
  f.held[1].resolve(visit(3));
  await newer;
  assert.equal(f.selected.revision, 3); assert.equal(f.visits[0].revision, 3);
  assert.deepEqual(f.errors, []);
});

test('retained session guard refuses dispatch after replacement and refuses publishing a held old response', async () => {
  const f = fixture(), guard = f.guard(); f.replaceSession();
  await assert.rejects(f.refresh(id, guard), { code: 'session_binding_obsolete' });
  assert.equal(f.held.length, 0); assert.deepEqual(f.paints, []);
  const g = fixture(), heldGuard = g.guard(), pending = observe(g.refresh(id, heldGuard));
  g.replaceSession(); g.held[0].resolve(visit(2));
  assert.equal((await pending).error?.code, 'session_binding_obsolete');
  assert.deepEqual(g.paints, []); assert.equal(g.selected.revision, 1);
});

test('obsolete guard cannot increment refresh observation or invalidate an already current read', async () => {
  const f = fixture(), oldGuard = f.guard();
  f.replaceSession();
  const current = f.refresh(id);
  const version = f.deps.refreshVersion.current;
  await assert.rejects(f.refresh(id, oldGuard), { code: 'session_binding_obsolete' });
  assert.equal(f.deps.refreshVersion.current, version);
  assert.equal(f.held.length, 1, 'Retired guard never dispatches a competing read');
  f.held[0].resolve(visit(3));
  assert.equal((await current).revision, 3);
  assert.equal(f.selected.revision, 3); assert.equal(f.visits[0].revision, 3);
});
