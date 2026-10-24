import test from 'node:test';
import assert from 'node:assert/strict';
import { saveRememberedView, readRememberedView } from './rememberedViews.js';
import { getTaskViewState } from '../../features/render-os/utils/task-view-state.js';
import { productionLocation } from '../../pages/productionRouteContext.js';
import { readCalendarSelection } from '../../pages/calendarModel.js';
import { projectListLocation } from '../../pages/projectsModel.js';

function storage() {
  const records = new Map(), calls = [];
  return { records, calls, setItem(key, value) { calls.push(['set', key]); records.set(key, value); },
    getItem(key) { calls.push(['get', key]); return records.get(key) ?? null; } };
}
const key = (path, id = 7) => `render:view:v1:${id}:${path}`;
function inject(s, path, query, extra = {}) { s.records.set(key(path), JSON.stringify({ version: 1, path, query, ...extra })); }
const cases = [
  ['/workspace/tareas', 'view=list&mode=trash&month=2026-10&estado=aprobada&responsible=id%3A7&client=9&sector=edicion&priority=alta&area=edicion&sort=manual&board_column=finalizadas'],
  ['/producciones', 'mes=2024-02&dia=2024-02-29&cliente=9&tab=pending'],
  ['/calendario', 'mes=2024-02&dia=2024-02-29&scope=team&tipo=visita&cliente=9'],
  ['/proyectos', 'cliente=9&estado=en_curso&archivados=true'],
];
for (const [path, query] of cases) {
  test(`${path}: closed preferences round trip and are user/path isolated`, () => {
    const s = storage(); assert.equal(saveRememberedView(s, 7, `${path}?${query}`), true);
    const record = JSON.parse(s.records.get(key(path)));
    assert.deepEqual(Object.keys(record), ['version', 'path', 'query']);
    assert.equal(record.version, 1); assert.equal(record.path, path);
    assert.equal(new TextEncoder().encode(s.records.get(key(path))).length <= 4096, true);
    const restored = readRememberedView(s, 7, path);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(restored.split('?')[1])), Object.fromEntries(new URLSearchParams(query)));
    assert.equal(readRememberedView(s, 8, path), path);
    for (const [other] of cases.filter(([other]) => other !== path)) assert.equal(readRememberedView(s, 7, other), other);
  });
}

test('round trips agree with actual page parsers, including numeric task client and ID-only responsible', () => {
  const s = storage();
  for (const [path, query] of cases) saveRememberedView(s, 7, `${path}?${query}`);
  const tasks = getTaskViewState(new URL(readRememberedView(s, 7, '/workspace/tareas'), 'https://render.test').search);
  assert.equal(tasks.responsible, 'id:7'); assert.equal(tasks.client, '9'); assert.equal(tasks.boardColumn, 'finalizadas');
  const production = productionLocation(`https://render.test${readRememberedView(s, 7, '/producciones')}`);
  assert.equal(production.tab, 'pending'); assert.equal(production.day, '2024-02-29'); assert.equal(production.clientId, '9');
  const calendar = readCalendarSelection(new URL(readRememberedView(s, 7, '/calendario'), 'https://render.test').search);
  assert.equal(calendar.scope, 'team'); assert.equal(calendar.tipo, 'visita'); assert.equal(calendar.dia, '2024-02-29');
  const project = projectListLocation(readRememberedView(s, 7, '/proyectos'));
  assert.equal(project.invalid, false); assert.equal(project.clientId, 9); assert.equal(project.archivados, true);
});

test('selected resources, free text, credentials, names, hashes and pagination never enter storage', () => {
  const s = storage();
  const secrets = 'task=PRIVATE_TASK&proyecto=PRIVATE_PROJECT&visita=PRIVATE_VISIT&borrador=PRIVATE_DRAFT&q=PRIVATE_TEXT&token=PRIVATE_TOKEN&nombre=PRIVATE_NAME&offset=99&page=8&pagina=7';
  for (const [path] of cases) assert.equal(saveRememberedView(s, 7, `${path}?${secrets}#PRIVATE_HASH`), true);
  for (const raw of s.records.values()) { assert.doesNotMatch(raw, /PRIVATE|offset|page|pagina|token|nombre|borrador/); assert.equal(JSON.parse(raw).query, ''); }
  assert.equal(saveRememberedView(s, 7, '/workspace/tareas?view=list&responsible=PRIVATE_NAME&client=PRIVATE_CLIENT&q=SECRET'), true);
  assert.equal(readRememberedView(s, 7, '/workspace/tareas'), '/workspace/tareas?view=list');
});

test('explicit links including empty query/hash win without reading storage', () => {
  const s = { getItem() { assert.fail('Explicit links must not read storage'); } };
  for (const [path] of cases) for (const suffix of ['?', '#', '?task=7', '?view=list', '#focus', '?cliente=8#focus']) {
    assert.equal(readRememberedView(s, 7, path + suffix), path + suffix);
  }
});

test('duplicate allowed keys reject whole save and preserve prior valid record; unknown duplicates are stripped', () => {
  const s = storage(); saveRememberedView(s, 7, '/workspace/tareas?view=list'); const prior = s.records.get(key('/workspace/tareas'));
  for (const query of ['view=board&view=list', 'estado=pendiente&estado=pendiente', 'client=7&client=8', 'responsible=id:7&responsible=id:7']) {
    assert.equal(saveRememberedView(s, 7, `/workspace/tareas?${query}`), false);
    assert.equal(s.records.get(key('/workspace/tareas')), prior);
  }
  assert.equal(saveRememberedView(s, 7, '/workspace/tareas?view=calendar&task=1&task=2'), true);
  assert.equal(readRememberedView(s, 7, '/workspace/tareas'), '/workspace/tareas?view=calendar');
});

test('bare save and no safe query explicitly replace old preferences with defaults', () => {
  const s = storage();
  for (const [path, query] of cases) {
    saveRememberedView(s, 7, `${path}?${query}`); assert.equal(saveRememberedView(s, 7, path), true);
    assert.equal(JSON.parse(s.records.get(key(path))).query, ''); assert.equal(readRememberedView(s, 7, path), path);
  }
});

test('IDs are canonical int32 positives; names, prefixes not supported by parsers, and coercions are omitted', () => {
  const s = storage();
  for (const value of ['0', '-1', '01', '1.5', '2147483648', '9007199254740992', '1e2', '+7', ' 7 ', 'Augusto']) {
    for (const [path, field] of [['/producciones', 'cliente'], ['/calendario', 'cliente'], ['/proyectos', 'cliente'], ['/workspace/tareas', 'client'], ['/workspace/tareas', 'responsible']]) {
      saveRememberedView(s, 7, `${path}?${field}=${encodeURIComponent(field === 'responsible' ? `id:${value}` : value)}`);
      assert.equal(readRememberedView(s, 7, path), path);
    }
  }
  saveRememberedView(s, 7, '/workspace/tareas?responsible=id:2147483647&client=2147483647');
  assert.match(readRememberedView(s, 7, '/workspace/tareas'), /2147483647/);
  saveRememberedView(s, 7, '/workspace/tareas?client=id:7&responsible=7');
  assert.equal(readRememberedView(s, 7, '/workspace/tareas'), '/workspace/tareas');
});

test('known enums only; no invented task type field or unknown board/status aliases', () => {
  const s = storage();
  saveRememberedView(s, 7, '/workspace/tareas?view=unknown&mode=archive&estado=publicada&board_column=finalizada&sector=secret&priority=urgent&area=secret&sort=secret&review_scope=secret&tipo=video');
  assert.equal(readRememberedView(s, 7, '/workspace/tareas'), '/workspace/tareas');
  saveRememberedView(s, 7, '/workspace/tareas?view=board&estado=en_revision&review_scope=personal&mode=active&sort=date');
  assert.equal(new URLSearchParams(readRememberedView(s, 7, '/workspace/tareas').split('?')[1]).get('review_scope'), 'personal');
  for (const [path, query] of [['/producciones', 'tab=photos'], ['/calendario', 'scope=admin&tipo=secret'], ['/proyectos', 'archivados=1&estado=finalizada']]) {
    saveRememberedView(s, 7, `${path}?${query}`); assert.equal(readRememberedView(s, 7, path), path);
  }
});

test('Gregorian month/day validation rejects overflow, nonleap and mismatched months', () => {
  const s = storage();
  for (const path of ['/producciones', '/calendario']) {
    for (const dia of ['2023-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '2026-1-01', '2026-13-01']) {
      saveRememberedView(s, 7, `${path}?dia=${dia}`); assert.equal(readRememberedView(s, 7, path), path);
    }
    saveRememberedView(s, 7, `${path}?mes=2026-10&dia=2026-11-01`);
    assert.equal(readRememberedView(s, 7, path), `${path}?mes=2026-10`);
    saveRememberedView(s, 7, `${path}?dia=2000-02-29`); assert.match(readRememberedView(s, 7, path), /2000-02-29/);
    for (const mes of ['0000-01', '2026-00', '2026-13', '2026-1', '2026-10-01']) {
      saveRememberedView(s, 7, `${path}?mes=${mes}`); assert.equal(readRememberedView(s, 7, path), path);
    }
  }
});

test('unsupported/external/noncanonical paths and malformed URLs cannot write or restore', () => {
  const s = storage();
  for (const href of ['/clientes', '/sueldos', '/workspace/tareas/', '//evil.test/producciones', 'https://render.test/producciones', 'https://evil.test/producciones', 'producciones', '/x/../producciones', '/%70roducciones', '/producciones\\evil', '/producciones?tab=%ZZ', '/producciones?tab=%FF', '/producciones\n']) {
    assert.equal(saveRememberedView(s, 7, href), false, href); assert.equal(readRememberedView(s, 7, href), href);
  }
  assert.equal(s.records.size, 0);
});

test('invalid owner never accesses storage; different numeric users never share keys', () => {
  const s = storage();
  for (const id of [null, undefined, '7', 0, -1, 1.5, 2147483648, NaN, Infinity, {}, true]) {
    assert.equal(saveRememberedView(s, id, '/producciones?tab=pending'), false);
    assert.equal(readRememberedView(s, id, '/producciones'), '/producciones');
  }
  assert.deepEqual(s.calls, []);
  saveRememberedView(s, 7, '/producciones?tab=pending'); saveRememberedView(s, 8, '/producciones?tab=calendar');
  assert.equal(readRememberedView(s, 7, '/producciones'), '/producciones?tab=pending');
  assert.equal(readRememberedView(s, 8, '/producciones'), '/producciones?tab=calendar');
});

test('corrupt, oversized, extra-key and unsafe stored queries fail closed without repair writes', () => {
  const path = '/producciones', s = storage();
  for (const raw of ['{', 'null', '[]', '42', 'x'.repeat(4097), JSON.stringify({ version: 2, path, query: 'tab=pending' }),
    JSON.stringify({ version: 1, path: '/calendario', query: 'tab=pending' }),
    JSON.stringify({ version: 1, path, query: 4 }), JSON.stringify({ version: 1, path, query: 'tab=pending', token: 'secret' })]) {
    s.records.set(key(path), raw); assert.equal(readRememberedView(s, 7, path), path);
  }
  for (const query of ['tab=pending&token=secret', 'tab=pending&tab=calendar', 'cliente=2147483648', 'mes=2026-10&dia=2026-11-01', 'tab=secret', 'q=free', 'visita=selected', 'tab=pending' + '&'.repeat(4096)]) {
    inject(s, path, query); assert.equal(readRememberedView(s, 7, path), path);
  }
  assert.equal(s.calls.some(([method]) => method === 'set'), false);
});

test('throwing/unavailable storage is harmless and never escapes', () => {
  for (const s of [null, undefined, {}, { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Quota'); } },
    new Proxy({}, { get() { throw new Error('Storage unavailable'); } })]) {
    assert.equal(saveRememberedView(s, 7, '/proyectos?estado=en_curso'), false);
    assert.equal(readRememberedView(s, 7, '/proyectos'), '/proyectos');
  }
});
