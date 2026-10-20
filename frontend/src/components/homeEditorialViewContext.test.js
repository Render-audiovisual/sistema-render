import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEditorialView, readEditorialLocation, editorialViewStorageKey,
  loadEditorialView, saveEditorialView, editorialViewUrl } from './homeEditorialViewContext.js';

const initial = { bucket: 'today', offset: 0 };
function memoryStorage() {
  const values = new Map(), reads = [], writes = [];
  return { values, reads, writes, getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem(key, value) { writes.push([key, value]); values.set(key, value); } };
}

test('location ignores unrelated parameters but distinguishes absence from invalid editorial context', () => {
  for (const search of ['', '?', '?view=board&task=2', '?editorial=blocked']) assert.equal(readEditorialLocation(search), null);
  assert.deepEqual(readEditorialLocation('?editorial_view=blocked'), { bucket: 'blocked', offset: 0 });
  for (const bucket of ['today', 'overdue', 'blocked', 'upcoming_ready']) {
    assert.deepEqual(readEditorialLocation(`?q=x&editorial_view=${bucket}&editorial_page=1000000`), { bucket, offset: 1000000 });
  }
  assert.throws(() => readEditorialLocation('?editorial_page=0'));
});

test('query duplicates, malformed canonical offsets, unsupported buckets and invalid bounds reject', () => {
  for (const search of ['?editorial_view=today&editorial_view=today', '?editorial_view=today&editorial_page=0&editorial_page=20',
    '?editorial_view=today&editorial%5fview=blocked', '?editorial_view=', '?editorial_view=all', '?editorial_view=Today',
    ...['', '-1', '+20', '020', '1', '19', '21', '20.0', '2e1', '1000020', '9007199254740992', '%200', '0%0a', 'NaN']
      .map(offset => `?editorial_view=today&editorial_page=${offset}`)]) assert.throws(() => readEditorialLocation(search), search);
  for (const search of [null, 1, {}, []]) assert.throws(() => readEditorialLocation(search));
});

test('normalizer returns only valid selection fields without mutation or operational bags', () => {
  const raw = Object.freeze({ bucket: 'overdue', offset: 20, usuario: 'Admin', metadata: { finance: 99 }, items: [{ id: 1 }] });
  assert.deepEqual(normalizeEditorialView(raw), { bucket: 'overdue', offset: 20 });
  for (const value of [null, undefined, [], 'today', {}, { bucket: 'today' }, { bucket: 'today', offset: '0' },
    { bucket: 'today', offset: 1 }, { bucket: 'today', offset: Infinity }, { bucket: 'today', offset: 1000020 },
    { bucket: 'today', offset: -20 }, { bucket: 'unknown', offset: 0 }]) assert.throws(() => normalizeEditorialView(value));
});

test('storage keys use positive PG integer identity only; invalid IDs never access storage', () => {
  assert.equal(editorialViewStorageKey(7), 'render2:editorial-view:v1:7');
  assert.equal(editorialViewStorageKey(2147483647), 'render2:editorial-view:v1:2147483647');
  for (const id of [undefined, null, 0, -1, '7', 'Franco', { id: 7, nombre: 'Admin' }, 1.5, Infinity, 2147483648]) {
    assert.equal(editorialViewStorageKey(id), null);
    const storage = memoryStorage();
    assert.deepEqual(loadEditorialView(storage, id), initial);
    assert.equal(saveEditorialView(storage, id, initial), false);
    assert.deepEqual(storage.reads, []); assert.deepEqual(storage.writes, []);
  }
});

test('preferences remain independent across IDs even when users share names; only closed v1 selection persists', () => {
  const storage = memoryStorage();
  const first = { id: 7, nombre: 'Alex' }, second = { id: 8, nombre: 'Alex' };
  assert.equal(saveEditorialView(storage, first.id, { bucket: 'blocked', offset: 40, nombre: first.nombre, finance: 999, raw: {} }), true);
  assert.equal(saveEditorialView(storage, second.id, { bucket: 'upcoming_ready', offset: 20 }), true);
  assert.deepEqual(loadEditorialView(storage, first.id), { bucket: 'blocked', offset: 40 });
  assert.deepEqual(loadEditorialView(storage, second.id), { bucket: 'upcoming_ready', offset: 20 });
  assert.deepEqual(loadEditorialView(storage, 9), initial);
  assert.deepEqual(JSON.parse(storage.values.get(editorialViewStorageKey(first.id))), { version: 1, bucket: 'blocked', offset: 40 });
  assert.doesNotMatch([...storage.values.values()].join(''), /Alex|finance|nombre|raw/);
});

test('malformed/tampered storage defaults safely, while extra input fields never escape projection', () => {
  const storage = memoryStorage(), key = editorialViewStorageKey(7);
  for (const raw of ['{', 'null', '[]', '"text"', '{}', '{"version":2,"bucket":"blocked","offset":0}',
    '{"version":1,"bucket":"blocked","offset":"0"}', '{"version":1,"bucket":"blocked","offset":1}',
    '{"version":1,"bucket":"all","offset":0}', '{"version":1,"bucket":"today","offset":1000020}']) {
    storage.values.set(key, raw); assert.deepEqual(loadEditorialView(storage, 7), initial);
  }
  storage.values.set(key, '{"version":1,"bucket":"today","offset":20,"finance":{"secret":1}}');
  assert.deepEqual(loadEditorialView(storage, 7), { bucket: 'today', offset: 20 });
});

test('storage availability/errors never throw; invalid selection throws before any attempted write', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  for (const storage of [null, undefined, {}, broken]) {
    assert.deepEqual(loadEditorialView(storage, 7), initial);
    assert.equal(saveEditorialView(storage, 7, initial), false);
  }
  const storage = memoryStorage();
  assert.throws(() => saveEditorialView(storage, 7, { bucket: 'today', offset: '0' }));
  assert.throws(() => saveEditorialView(storage, 'invalid-user', { bucket: 'today', offset: '0' }));
  assert.deepEqual(storage.writes, []);
});

test('URL helper returns only /inicio URL context, canonical keys and preserved unrelated query/hash', () => {
  const original = 'https://render.test/inicio?x=1&x=2&task=7&editorial_view=old&editorial_view=bad&editorial_page=40#section';
  const url = editorialViewUrl(original, initial);
  assert.ok(url instanceof URL); assert.equal(url.pathname, '/inicio'); assert.equal(url.origin, 'https://render.test');
  assert.deepEqual(url.searchParams.getAll('x'), ['1', '2']); assert.equal(url.searchParams.get('task'), '7');
  assert.deepEqual(url.searchParams.getAll('editorial_view'), ['today']);
  assert.deepEqual(url.searchParams.getAll('editorial_page'), ['0']); assert.equal(url.hash, '#section');
  assert.deepEqual(readEditorialLocation(url.search), initial);
  assert.equal(original.includes('editorial_view=old'), true);
  for (const currentUrl of ['', 'not a URL', '/inicio', 'https://render.test/inicio/', 'https://render.test/workspace/tareas',
    'https://user:pass@render.test/inicio', 'javascript:alert(1)', 'ftp://render.test/inicio', 'https://render.test/inicio\n']) {
    assert.throws(() => editorialViewUrl(currentUrl, initial), currentUrl);
  }
  assert.throws(() => editorialViewUrl('https://render.test/inicio', { bucket: 'unknown', offset: 0 }));
});
