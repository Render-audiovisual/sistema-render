import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { editorialRevision, editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError } from './editorial-patch.js';
import { editorialFields } from '../../components/EditorialPublicationControl.model.js';
import { createStoryCellDraft } from '../../pages/storyCellDraft.js';

const row = (id = 7, revision = 0, rest = {}) => ({ id, publicacion_evidencia: { classification: 'no_publicada', revision, confirmation: null }, ...rest });
const helpers = { editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError };
test('capture exact row revision including zero, preserve fields and never accept caller override', () => {
  for (const revision of [0, 1, 815]) {
    const observed = row(7, revision), fields = { copy: '', fecha_programada: '2026-11-02', metadata: { tipo: 'Promo' }, expected_revision: 999 };
    const body = editorialPatchBody(observed, fields);
    observed.publicacion_evidencia.revision = 900; fields.metadata.tipo = 'Changed';
    assert.deepEqual(JSON.parse(body), { copy: '', fecha_programada: '2026-11-02', metadata: { tipo: 'Promo' }, expected_revision: revision });
  }
});
test('missing, coerced and malformed observations fail closed without fallback to unrelated revision/timestamp', () => {
  for (const observed of [null, {}, { id: 7, revision: 3, updated_at: '2026-10-01' },
    ...[undefined, null, '', '0', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(revision => ({ id: 7, publicacion_evidencia: { revision } }))]) {
    assert.throws(() => editorialPatchBody(observed, { copy: 'Keep draft' }), /Recargá/);
  }
});
test('ACK requires matching identity and advancing server revision', () => {
  const observed = row(7, 5), saved = row(7, 6);
  assert.equal(editorialPatchAck(observed, saved), saved);
  for (const invalid of [{}, row(8, 6), row(7, 5), row(7, 4), row(7, '6')]) {
    assert.throws(() => editorialPatchAck(observed, invalid));
  }
});
test('generic PATCH never substitutes for explicit manual publication', () => {
  assert.throws(() => editorialPatchBody(row(), { estado: 'publicada' }), /confirmación explícita/);
});
test('ACK advances evidence without overwriting newer local drafts or rolling back newer confirmation', () => {
  const draft = row(7, 5, { copy: 'Typing after dispatch', fecha_programada: '2026-11-09' });
  const saved = row(7, 6, { copy: 'Old saved text', fecha_programada: '2026-11-02' });
  assert.deepEqual(mergeEditorialPatchEvidence(draft, saved), { ...draft, publicacion_evidencia: saved.publicacion_evidencia });
  const newer = row(7, 8); assert.equal(mergeEditorialPatchEvidence(newer, saved), newer);
  const other = row(8, 5); assert.equal(mergeEditorialPatchEvidence(other, saved), other);
});

const pages = ['Historias', 'Publicaciones'].map(name => {
  const source = readFileSync(new URL(`../../pages/${name}.jsx`, import.meta.url), 'utf8');
  return { name, source, file: ts.createSourceFile(`${name}.jsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX) };
});
const descendants = (root, predicate) => {
  const found = []; const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }; visit(root); return found;
};
function callback(page, ownerName, name, deps) {
  const owner = page.file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === ownerName);
  const declaration = descendants(owner, node => ts.isVariableDeclaration(node) && node.name.getText(page.file) === name)[0];
  let value = declaration.initializer;
  if (ts.isCallExpression(value) && value.expression.getText(page.file) === 'useCallback') value = value.arguments[0];
  return new Function(...Object.keys(deps), `return (${value.getText(page.file)});`)(...Object.values(deps));
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function sheetFixture(page, request, observation = row()) {
  let rows = [observation]; const errors = [], requests = [], committed = [];
  const scope = { current: () => true, assertCurrent() {}, async request(url, options) { requests.push({ url, options }); return request(url, options); } };
  const deps = { ...helpers, capture: () => scope, view: { role: 'admin' }, editorialFields,
    historias: rows, publicaciones: rows, deleting: { current: new Set() }, pendingWrites: { current: new Set() },
    latestWrites: { current: new Map() }, writeQueues: { current: new Map() }, confirmedRows: { current: new Map() }, listGeneration: { current: 0 },
    cellDraft: { current: { model: createStoryCellDraft() } }, renderCellDraft() {},
    onCommittedChange(change) { committed.push(change); },
    enqueueStoryWrite(queues, id, run) {
      const queued = (queues.current.get(id) || Promise.resolve()).catch(() => {}).then(run);
      queues.current.set(id, queued); return queued;
    },
    setHistorias(update) { rows = update(rows); }, setPublicaciones(update) { rows = update(rows); },
    setErrorHistorias(error) { errors.push(error); }, setError(error) { errors.push(error); } };
  const owner = page.name === 'Historias' ? 'HistoriasPage' : 'PublicacionesPlanillaTab';
  const name = page.name === 'Historias' ? 'guardarHistoriaEnServidor' : 'guardarEnServidor';
  return { save: callback(page, owner, name, deps), deps, requests, errors, committed, get rows() { return rows; } };
}
for (const page of pages) {
  test(`${page.name}: actual sheet callback uses its own row revision, not submitted fields`, async () => {
    const original = row(7, 21, { copy: 'newer draft' });
    const f = sheetFixture(page, async () => row(7, 22, { copy: 'server older text' }), original);
    await f.save(7, { copy: 'submitted', expected_revision: 1000 });
    assert.deepEqual(JSON.parse(f.requests[0].options.body), { copy: 'submitted', expected_revision: 21 });
    assert.equal(f.requests.length, 1); assert.deepEqual(f.errors, []);
    assert.equal(f.rows[0].copy, 'newer draft'); assert.equal(editorialRevision(f.rows[0]), 22);
    if (page.name === 'Publicaciones') assert.equal(f.committed[0].row.copy, 'server older text', 'overview receives committed server data, not newer unsaved draft');
  });
  test(`${page.name}: absent row evidence never sends an unversioned PATCH`, async () => {
    const f = sheetFixture(page, () => assert.fail('No transport without an observation'), { id: 7 });
    await f.save(7, { copy: 'Keep draft' }); assert.equal(f.requests.length, 0); assert.match(f.errors[0], /Recargá/);
  });
  test(`${page.name}: queued captured observation conflicts rather than rebasing after preceding ACK`, async () => {
    let release; const barrier = new Promise(resolve => { release = resolve; }); let version = 0;
    const f = sheetFixture(page, async (_url, options) => {
      const body = JSON.parse(options.body);
      if (version === 0) await barrier;
      if (body.expected_revision !== version) throw Object.assign(Error('stale'), { status: 409 });
      return row(7, ++version);
    });
    const first = f.save(7, { copy: 'A' }); await settle();
    const second = f.save(7, { copy: 'B' }); release(); await Promise.all([first, second]);
    assert.equal(version, 1); assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests.map(item => JSON.parse(item.options.body)), [
      { copy: 'A', expected_revision: 0 }, { copy: 'B', expected_revision: 0 },
    ]);
    assert.equal(editorialRevision(f.rows[0]), 1); assert.equal(f.errors.length, 1); assert.match(f.errors[0], /no se reenviaron/);
    assert.ok(f.requests.every(item => item.options.method === 'PATCH'));
  });
  test(`${page.name}: initial 409 leaves draft and observation intact, without GET/retry`, async () => {
    const original = row(7, 3, { copy: 'local draft' });
    const f = sheetFixture(page, async () => { throw Object.assign(Error('stale'), { status: 409 }); }, original);
    await f.save(7, { copy: 'attempt' }); assert.equal(f.requests.length, 1);
    assert.equal(f.rows[0], original); assert.match(f.errors[0], /Recargá/);
  });
}
test('all six actual PATCH sites capture an observation; archive and publication confirmation stay separate', () => {
  let total = 0;
  for (const page of pages) {
    assert.equal(page.file.parseDiagnostics.length, 0);
    const patches = descendants(page.file, node => ts.isCallExpression(node) && node.expression.getText(page.file) === 'scope.request'
      && node.arguments[1]?.getText(page.file).includes('method: "PATCH"'));
    total += patches.length;
    for (const patch of patches) {
      const text = patch.arguments[1].getText(page.file);
      assert.match(text, /body: editorialPatchBody\(|\bbody,/);
      assert.doesNotMatch(text, /JSON.stringify\(/);
    }
    assert.doesNotMatch(page.source, /method: "DELETE"/);
    assert.match(page.source, /EditorialArchive/);
  }
  assert.equal(total, 6);
});
for (const action of ['cambiarFecha', 'cambiarEstadoPublicacion']) {
  test(`calendar ${action}: exact selected revision and no rebase/refetch on conflict`, async () => {
    const page = pages.find(item => item.name === 'Publicaciones'), requests = [], errors = [];
    const observed = row(17, 39, { tipo: 'video', estado: 'pendiente' });
    const scope = { current: () => true, assertCurrent() {}, async request(url, options) {
      requests.push({ url, options }); throw Object.assign(Error('stale'), { status: 409 });
    } };
    const save = callback(page, 'PublicacionesCalendarioTab', action, { ...helpers, capture: () => scope,
      captureLifetime: () => scope, view: { role: 'admin' }, isConfirmedPublication: () => false,
      selection: { current: {} }, pendingWrites: { current: new Set() }, setGuardandoId() {},
      setError(error) { if (error) errors.push(error); }, setPiezas() { assert.fail('No update on 409'); } });
    await save(observed, action === 'cambiarFecha' ? '2026-11-02' : 'lista');
    assert.equal(requests.length, 1); assert.equal(requests[0].url, '/api/publicaciones/17');
    assert.deepEqual(JSON.parse(requests[0].options.body), action === 'cambiarFecha'
      ? { fecha_programada: '2026-11-02', expected_revision: 39 } : { estado: 'lista', expected_revision: 39 });
    assert.match(errors[0], /no se reenviaron/); assert.equal(editorialRevision(observed), 39);
  });
}
