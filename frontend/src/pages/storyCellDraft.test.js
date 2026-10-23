import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryCellDraft } from './storyCellDraft.js';

// Pure model contracts only. No React batching simulation, HTTP, Storage or DB.
const state = model => ({ ...model.snapshot });
const row = (id, revision, extra = {}) => ({ id, revision, idea: `Idea ${id}`, metadata: { copy: `Copy ${id}` }, ...extra });
function frozenRows(...rows) {
  for (const value of rows) { if (value.metadata) Object.freeze(value.metadata); Object.freeze(value); }
  return Object.freeze(rows);
}

test('initial state is clean; reads do not rotate the opaque observation, but edits do synchronously', () => {
  const model = createStoryCellDraft(), original = model.observation;
  assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
  assert.equal(model.observation, original);
  model.edit(1, { idea: 'unsent' });
  assert.deepEqual(state(model), { dirty: true, busy: false, blocked: false });
  const edited = model.observation;
  assert.notEqual(edited, original); assert.equal(model.observation, edited);
  model.edit(1, { idea: 'same top field, another typing generation' });
  assert.notEqual(model.observation, edited, 'Identical field keys still represent a later edit');
});

test('begin without a prior blur/edit marks the sent fields dirty and makes busy immediate', () => {
  const model = createStoryCellDraft(), original = model.observation;
  const intent = model.begin(1, { idea: 'first observed blur value' });
  assert.deepEqual(state(model), { dirty: true, busy: true, blocked: false });
  assert.notEqual(model.observation, original); assert.equal(model.canDispatch(intent), true);
  assert.equal(model.canDispatch({}), false); assert.equal(model.canDispatch(null), false);
  model.succeed(intent);
  assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
  assert.equal(model.canDispatch(intent), false, 'Consumed observation cannot be dispatched again');
});

test('ACK of an older value never clears a newer edit of the same top-level field', () => {
  const model = createStoryCellDraft();
  model.edit(1, { idea: 'v1' }); const first = model.begin(1, { idea: 'v1' });
  model.edit(1, { idea: 'v2' }); const typing = model.observation;
  model.succeed(first);
  assert.deepEqual(state(model), { dirty: true, busy: false, blocked: false });
  assert.notEqual(model.observation, typing);
  const second = model.begin(1, { idea: 'v2' });
  assert.equal(model.canDispatch(second), true); model.succeed(second);
  assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
});

test('ACK clears only captured field generations, retaining sibling fields and another row', () => {
  const model = createStoryCellDraft();
  model.edit(1, { idea: 'idea', metadata: { copy: 'copy' } });
  model.edit(2, { estado: 'en_revision' });
  const idea = model.begin(1, { idea: 'idea' }); model.succeed(idea);
  assert.equal(model.snapshot.dirty, true);
  const metadata = model.begin(1, { metadata: { copy: 'copy' } }); model.succeed(metadata);
  assert.equal(model.snapshot.dirty, true, 'Row two is still unsaved');
  const secondRow = model.begin(2, { estado: 'en_revision' }); model.succeed(secondRow);
  assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
});

test('partial metadata ACK clears tipo only, retaining the unsent hora generation and original row CAS', () => {
  const model = createStoryCellDraft();
  model.edit(1, { metadata: { hora: '10:30', tipo: 'A' } });
  const tipo = model.begin(1, { metadata: { tipo: 'A' } });
  model.succeed(tipo);
  assert.deepEqual(state(model), { dirty: true, busy: false, blocked: false });
  const local = row(1, 3, { metadata: { hora: '10:30', tipo: 'A' } });
  const incoming = row(1, 4, { metadata: { hora: '09:00', tipo: 'A' } });
  assert.equal(model.preserve(frozenRows(incoming), frozenRows(local))[0], local, 'Tipo ACK is not permission to replace unsaved hora or its captured revision');
  const hora = model.begin(1, { metadata: { hora: '10:30' } }); model.succeed(hora);
  assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
});

test('later edit to the same metadata subkey survives its older ACK independently of sibling subkeys', () => {
  const model = createStoryCellDraft();
  model.edit(1, { metadata: { hora: '10:30', tipo: 'A' } });
  const hora = model.begin(1, { metadata: { hora: '10:30' } });
  model.edit(1, { metadata: { hora: '11:00' } }); model.succeed(hora);
  const tipo = model.begin(1, { metadata: { tipo: 'A' } }); model.succeed(tipo);
  assert.equal(model.snapshot.dirty, true);
  const latest = model.begin(1, { metadata: { hora: '11:00' } }); model.succeed(latest);
  assert.equal(model.snapshot.dirty, false);
});

test('follow rejects a different partial metadata key set without rotating observation or absorbing sibling edits', () => {
  const model = createStoryCellDraft();
  model.edit(1, { metadata: { hora: '10:30', tipo: 'A' } });
  const intent = model.begin(1, { metadata: { tipo: 'A' } });
  for (const metadata of [{ hora: '10:30' }, { tipo: 'A', hora: '10:30' }, {}]) {
    const observation = model.observation;
    assert.equal(model.follow(intent, { metadata }), false);
    assert.equal(model.observation, observation);
  }
  model.edit(1, { metadata: { tipo: 'A' } });
  assert.equal(model.follow(intent, { metadata: { tipo: 'A' } }), true);
  model.succeed(intent); assert.equal(model.snapshot.dirty, true, 'Followed tipo still cannot acknowledge hora');
  const hora = model.begin(1, { metadata: { hora: '10:30' } }); model.succeed(hora);
  assert.equal(model.snapshot.dirty, false);
});

test('metadata subkey discovery never reads values; empty/nonplain/accessor metadata uses its top-key fallback', () => {
  let reads = 0;
  const metadata = Object.create(null);
  for (const key of ['hora', 'tipo']) Object.defineProperty(metadata, key, { enumerable: true, get() { reads++; throw Error('Do not read nested content'); } });
  const model = createStoryCellDraft(); model.edit(1, { metadata });
  const tipo = model.begin(1, { metadata: { tipo: 'A' } }); model.succeed(tipo);
  assert.equal(model.snapshot.dirty, true);
  const hora = model.begin(1, { metadata: { hora: '10:30' } }); model.succeed(hora);
  assert.equal(model.snapshot.dirty, false); assert.equal(reads, 0);
  const accessor = Object.defineProperty({}, 'metadata', { enumerable: true, get() { reads++; throw Error('Do not invoke metadata getter'); } });
  for (const fields of [{ metadata: {} }, { metadata: [] }, { metadata: new Date() }, accessor]) {
    const fallback = createStoryCellDraft(); fallback.edit(1, fields);
    const intent = fallback.begin(1, fields); fallback.succeed(intent);
    assert.deepEqual(state(fallback), { dirty: false, busy: false, blocked: false });
  }
  assert.equal(reads, 0);
});

test('all queued begins count as busy until settled; failure blocks subsequent same-row dispatch and preserves dirty rows', () => {
  const model = createStoryCellDraft();
  const first = model.begin(1, { idea: 'first' });
  const queued = model.begin(1, { metadata: { copy: 'queued' } });
  assert.equal(model.snapshot.busy, true);
  model.fail(first);
  assert.equal(model.canDispatch(first), false); assert.equal(model.canDispatch(queued), false);
  assert.deepEqual(state(model), { dirty: true, busy: true, blocked: true });
  model.fail(queued);
  assert.deepEqual(state(model), { dirty: true, busy: false, blocked: true });
  model.edit(1, { idea: 'corrected text is not permission to retry an uncertain write' });
  assert.equal(model.snapshot.blocked, true);
  assert.throws(() => model.begin(1, { idea: 'blocked retry' }));
  assert.equal(model.has(1), true);
});

test('a failed row does not turn another independently queued row into a blocked retry', () => {
  const model = createStoryCellDraft();
  const failed = model.begin(1, { idea: 'one' }), independent = model.begin(2, { idea: 'two' });
  model.fail(failed);
  assert.equal(model.canDispatch(independent), true);
  model.succeed(independent);
  assert.equal(model.has(2), false); assert.equal(model.has(1), true);
  assert.deepEqual(state(model), { dirty: true, busy: false, blocked: true });
});

test('an older successful queued write cannot erase a failure block or later dirty generations', () => {
  const model = createStoryCellDraft();
  const first = model.begin(1, { idea: 'sent' });
  const second = model.begin(2, { idea: 'will fail' });
  model.fail(second); model.edit(1, { idea: 'later unsent' }); model.succeed(first);
  assert.deepEqual(state(model), { dirty: true, busy: false, blocked: true });
});

test('preserve takes the WHOLE dirty current row, never newer GET CAS or a shallow metadata merge', () => {
  const model = createStoryCellDraft(); model.edit(1, { idea: 'local' });
  const local = row(1, 3, { idea: 'local', metadata: { copy: 'local copy' } });
  const server = row(1, 99, { idea: 'server', metadata: { copy: 'server copy', extra: 'not adopted' } });
  const clean = row(2, 8), previousClean = row(2, 1);
  const current = frozenRows(local, previousClean), incoming = frozenRows(server, clean);
  const before = JSON.stringify({ current, incoming }), observation = model.observation;
  const result = model.preserve(incoming, current);
  assert.equal(result.find(value => value.id === 1), local);
  assert.equal(result.find(value => value.id === 1).revision, 3);
  assert.equal(result.find(value => value.id === 2), clean);
  assert.equal(model.observation, observation, 'Reading/preserving data does not acknowledge local drafts');
  assert.equal(JSON.stringify({ current, incoming }), before);
});

test('dirty, busy and failed rows absent from incoming GET remain available without fabricated rows or stale CAS adoption', () => {
  for (const mode of ['dirty', 'busy', 'blocked']) {
    const model = createStoryCellDraft(), local = row(1, 3);
    if (mode === 'dirty') model.edit(1, { idea: 'local' });
    else { const intent = model.begin(1, { idea: 'sent' }); if (mode === 'blocked') model.fail(intent); }
    const next = row(2, 8);
    const result = model.preserve(frozenRows(next), frozenRows(local, row(2, 1)));
    assert.equal(result.length, 2); assert.equal(result.find(value => value.id === 1), local, mode);
    assert.equal(result.find(value => value.id === 2), next);
  }
});

test('clean rows refresh normally, and a successful current ACK releases only its protected row', () => {
  const model = createStoryCellDraft(), old = row(1, 1), fresh = row(1, 2), deleted = row(2, 1);
  assert.deepEqual(model.preserve(frozenRows(fresh), frozenRows(old, deleted)), [fresh]);
  const intent = model.begin(1, { idea: 'sent' }); model.succeed(intent);
  assert.equal(model.preserve(frozenRows(fresh), frozenRows(old))[0], fresh);
});

test('IDs and field records are validated without mutating a clean model', () => {
  const model = createStoryCellDraft(), observation = model.observation;
  for (const id of [null, undefined, '1', 0, -1, 1.5, NaN, Infinity, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => model.edit(id, { idea: 'bad' }));
    assert.throws(() => model.begin(id, { idea: 'bad' }));
  }
  const customPrototype = Object.assign(Object.create({ marker: true }), { idea: 'own value, nonplain prototype' });
  const classInstance = new (class { constructor() { this.idea = 'own value, nonplain instance'; } })();
  for (const fields of [undefined, null, {}, [], 'idea', 1, new Date(), Object.create({ idea: 'inherited only' }), customPrototype, classInstance]) {
    assert.throws(() => model.edit(1, fields)); assert.throws(() => model.begin(1, fields));
  }
  assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
  assert.equal(model.observation, observation);
  model.edit(2147483647, { idea: 'valid maximum ID' });
  assert.equal(model.snapshot.dirty, true);
});

test('intents track only keys/generations, not field values, and a different model cannot dispatch them', () => {
  const model = createStoryCellDraft(); let reads = 0;
  const fields = Object.defineProperty({}, 'idea', { enumerable: true, get() { reads++; throw Error('Do not inspect commercial content'); } });
  model.edit(1, fields); const intent = model.begin(1, fields);
  assert.equal(reads, 0);
  assert.equal(createStoryCellDraft().canDispatch(intent), false);
  assert.equal(model.canDispatch(intent), true);
  assert.deepEqual(Object.keys(model.snapshot).sort(), ['blocked', 'busy', 'dirty']);
  assert.equal(Object.hasOwn(model, 'reset'), false, 'Discard/reset requires a new observed context, not a silent model reset');
  model.succeed(intent); assert.equal(model.snapshot.dirty, false);
});

test('follow binds a verified duplicate blur to current generations so its single ACK clears both observations', () => {
  const model = createStoryCellDraft();
  const fields = Object.freeze({ idea: 'same frozen body', metadata: Object.freeze({ copy: 'same copy' }) });
  model.edit(1, fields); const intent = model.begin(1, fields);
  model.edit(1, fields); // A duplicate blur may report an edit with identical values.
  const observation = model.observation;
  // Exact body/scope verification belongs to the caller, not this keys-only model.
  assert.equal(model.follow(intent, fields), true);
  assert.notEqual(model.observation, observation);
  assert.equal(model.canDispatch(intent), true);
  assert.deepEqual(state(model), { dirty: true, busy: true, blocked: false });
  model.succeed(intent);
  assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
  const settled = model.observation;
  assert.equal(model.follow(intent, fields), false);
  assert.equal(model.observation, settled, 'Consumed token cannot bind another blur');
});

test('an edit after follow is still newer than the bound ACK and remains protected from GET', () => {
  const model = createStoryCellDraft();
  model.edit(1, { idea: 'sent' }); const intent = model.begin(1, { idea: 'sent' });
  model.edit(1, { idea: 'sent' }); assert.equal(model.follow(intent, { idea: 'sent' }), true);
  model.edit(1, { idea: 'new unsent value' }); model.succeed(intent);
  assert.deepEqual(state(model), { dirty: true, busy: false, blocked: false });
  const local = row(1, 3, { idea: 'new unsent value' }), server = row(1, 4, { idea: 'sent' });
  assert.equal(model.preserve(frozenRows(server), frozenRows(local))[0], local);
});

test('follow requires the exact field-key set, ignores key ordering and does not inspect values', () => {
  const model = createStoryCellDraft();
  const intent = model.begin(1, { idea: 'sent', metadata: {} });
  model.edit(1, { idea: 'duplicate', metadata: {} });
  for (const fields of [{ idea: 'missing metadata' }, { copy: 'wrong key', metadata: {} }, { idea: 'extra', metadata: {}, estado: 'pendiente' }]) {
    const observation = model.observation;
    assert.equal(model.follow(intent, fields), false);
    assert.equal(model.observation, observation);
    assert.deepEqual(state(model), { dirty: true, busy: true, blocked: false });
  }
  let reads = 0;
  const reversed = {};
  for (const key of ['metadata', 'idea']) Object.defineProperty(reversed, key, {
    enumerable: true, get() { reads++; throw Error('Values are not part of the generation model'); },
  });
  assert.equal(model.follow(intent, reversed), true); assert.equal(reads, 0);
  model.succeed(intent); assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
});

test('foreign/unknown tokens and blocked pending rows cannot follow or clear dirty generations', () => {
  const model = createStoryCellDraft(), other = createStoryCellDraft();
  const foreign = other.begin(1, { idea: 'other model' });
  const failing = model.begin(1, { idea: 'first' }), queued = model.begin(1, { idea: 'queued' });
  for (const token of [foreign, {}, null, undefined]) {
    const observation = model.observation;
    assert.equal(model.follow(token, { idea: 'untrusted' }), false);
    assert.equal(model.observation, observation);
  }
  model.fail(failing);
  const blocked = model.observation;
  assert.equal(model.follow(queued, { idea: 'same keys cannot override failed row' }), false);
  assert.equal(model.follow(failing, { idea: 'consumed failure' }), false);
  assert.equal(model.observation, blocked);
  assert.equal(model.canDispatch(queued), false);
  assert.deepEqual(state(model), { dirty: true, busy: true, blocked: true });
  model.fail(queued); assert.deepEqual(state(model), { dirty: true, busy: false, blocked: true });
});

test('isEdited precisely queries simple and partial metadata keys without changing state or observation', () => {
  const model = createStoryCellDraft();
  const query = (id, fields, expected) => {
    const observation = model.observation, before = state(model);
    assert.equal(model.isEdited(id, fields), expected);
    assert.equal(model.observation, observation);
    assert.deepEqual(state(model), before);
  };
  query(1, { copy: 'unchanged observed value' }, false);
  model.edit(1, { copy: 'edited copy', metadata: { hora: '10:30' } });
  query(1, { copy: 'values are irrelevant to this predicate' }, true);
  query(1, { idea: 'clean sibling' }, false);
  query(2, { copy: 'same key on another row' }, false);
  query(1, { metadata: { hora: 'any' } }, true);
  query(1, { metadata: { tipo: 'clean sibling' } }, false);
  query(1, { metadata: { tipo: 'clean', hora: 'edited' } }, true);
  query(1, { idea: 'clean', metadata: { hora: 'edited' } }, true);
  query(1, { metadata: {} }, false, 'A fallback top key is not an edited metadata subkey');
  const copy = model.begin(1, { copy: 'edited copy' });
  query(1, { copy: 'pending copy' }, true);
  model.succeed(copy);
  query(1, { copy: 'saved' }, false);
  query(1, { metadata: { hora: 'still unsent' } }, true);
  const hora = model.begin(1, { metadata: { hora: '10:30' } }); model.succeed(hora);
  query(1, { metadata: { hora: 'saved', tipo: 'clean sibling' } }, false);
  assert.deepEqual(state(model), { dirty: false, busy: false, blocked: false });
});
