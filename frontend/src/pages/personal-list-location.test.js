import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { personalListId, readPersonalListId, personalListUrl, keepsPersonalListDrafts } from './personalListLocation.js';
import { createPersonalListCreation, reconcilePersonalListCreation } from './personalListCreation.js';

// Pure helpers and actual extracted callbacks; no browser/HTTP persistence claim.
const source = readFileSync(new URL('./PersonalLists.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('PersonalLists.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const page = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PersonalListsPage');
const text = n => n.getText(file);
const nodes = (root, predicate) => { const out = []; const visit = n => { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); }; visit(root); return out; };
const evaluate = (n, deps) => new Function(...Object.keys(deps), `return (${text(n)});`)(...Object.values(deps));
const init = name => nodes(page, n => ts.isVariableDeclaration(n) && text(n.name) === name)[0].initializer;
const callback = (name, deps) => evaluate(init(name), deps);
const effects = () => nodes(page, n => ts.isCallExpression(n) && text(n.expression) === 'useEffect');
const helpers = { personalListId, readPersonalListId, personalListUrl, keepsPersonalListDrafts };
function locationFixture(search = '?lista=2&other=keep') {
  const writes = [], location = { href: `https://render.test/lista${search}#section` };
  Object.defineProperty(location, 'search', { get: () => new URL(location.href).search });
  const window = { location, history: { state: { keep: 1 }, replaceState(state, title, url) { writes.push({ state, url }); location.href = new URL(url, location.href).href; } }, confirm: () => true };
  return { window, writes };
}
test('canonical bigint IDs accept exact strings and safe numbers without rounding or coercive aliases', () => {
  for (const [input, expected] of [[1, '1'], ['1', '1'], [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)], ['9223372036854775807', '9223372036854775807']]) assert.equal(personalListId(input), expected);
  for (const input of [null, undefined, '', 0, -1, 1.5, NaN, Infinity, 9007199254740992, '01', '+1', '1.0', '1e3', ' 1', '1\n', '9223372036854775808', '99999999999999999999', {}, ['1']]) assert.equal(personalListId(input), '', String(input));
});
test('query distinguishes absent from invalid explicit IDs including duplicates/brackets', () => {
  assert.equal(readPersonalListId('?other=1'), null);
  assert.equal(readPersonalListId('?lista=9223372036854775807'), '9223372036854775807');
  for (const query of ['?lista=', '?lista=0', '?lista=01', '?lista=1&lista=1', '?lista=1&lista=2', '?lista[]=1', '?lista[x]=1', '?lista=1&lista[x]=2']) assert.equal(readPersonalListId(query), '', query);
});
test('URL selection preserves unrelated query/hash and explicit clear removes only lista', () => {
  const href = 'https://render.test/lista?lista=2&other=keep#section';
  assert.equal(personalListUrl(href, '9223372036854775807'), '/lista?lista=9223372036854775807&other=keep#section');
  assert.equal(personalListUrl(href, null), '/lista?other=keep#section');
  for (const id of ['', '01', '9223372036854775808']) assert.throws(() => personalListUrl(href, id));
});
test('only link/traverse within same origin and exact lista path preserve drafts, never refresh/unload', () => {
  const href = 'https://render.test/lista?lista=1';
  for (const type of ['link', 'traverse']) assert.equal(keepsPersonalListDrafts(href, { type, to: '/lista?lista=2#section' }), true);
  for (const type of ['refresh', 'unload', undefined, null, 'other']) assert.equal(keepsPersonalListDrafts(href, { type, to: '/lista?lista=2' }), false);
  for (const to of [null, '', '/lista/', '/inicio', 'https://other.test/lista', 'https://user:pass@render.test/lista']) assert.equal(keepsPersonalListDrafts(href, { type: 'link', to }), false);
  assert.equal(keepsPersonalListDrafts(href, null), false);
  assert.equal(keepsPersonalListDrafts('https://render.test/inicio', { type: 'link', to: '/lista' }), false);
});
test('actual initial selection does not fallback for invalid or unavailable explicit IDs', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  const state = init('[activeId, setActiveId]');
  for (const [search, expected] of [['', null], ['?lista=2', '2'], ['?lista=bad', '']]) {
    assert.equal(evaluate(state.arguments[0], { readPersonalListId, window: { location: { search } } })(), expected);
  }
  const memo = init('activeList').arguments[0];
  for (const [activeId, expected] of [[null, 1], ['2', 2], ['', undefined], ['99', undefined]]) {
    const value = evaluate(memo, { activeId, lists: [{ id: 1 }, { id: '2' }], personalListId })(); assert.equal(value?.id?.toString(), expected?.toString());
  }
});
test('actual guard exempts internal queue state but never structural busy, external dirty/busy or stale session', () => {
  const hook = nodes(page, n => ts.isCallExpression(n) && text(n.expression) === 'useNavigationGuard')[0];
  for (const current of [true, false]) for (const pending of [0, 1]) {
    const deps = { ...helpers, currentSession: () => current, window: { location: { href: 'https://render.test/lista?lista=1' } },
      creation:{current:null},pendingSaves: { current: pending }, queue: { current: { snapshot: () => ({ dirty: true, busy: true }) } }, statusRef: { current: 'error' } };
    const guard = evaluate(hook.arguments[0], deps);
    assert.deepEqual(guard({ type: 'link', to: '/lista?lista=2' }), { dirty: !current, busy: Boolean(pending || !current) });
    for (const context of [null, { type: 'refresh', to: '/lista?lista=2' }, { type: 'unload', to: null }, { type: 'link', to: '/inicio' }]) assert.deepEqual(guard(context), { dirty: true, busy: true });
  }
});
test('actual popstate restores only selection/UI, rotates observation, cleans listener and never flushes/discards/fetches', () => {
  const effect = effects().find(n => text(n.arguments[0]).includes("addEventListener('popstate'"));
  const f = locationFixture(), listeners = new Map(), calls = [], selection = { current: { id: '2' } }; let current = true;
  Object.assign(f.window, { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: (key, fn) => { assert.equal(listeners.get(key), fn); listeners.delete(key); } });
  const fail = () => assert.fail('Restore must not touch queue, network or history');
  const deps = { ...helpers, window: f.window, currentSession: () => current, listSelection: selection, setActiveId: id => calls.push(['id', id]), setEmojiOpen: value => calls.push(['emoji', value]), setSaveTemplateOpen: value => calls.push(['template', value]), queue: { current: { flush: fail, discard: fail } }, scopedRequest: fail, load: fail };
  const cleanup = evaluate(effect.arguments[0], deps)();
  for (const [query, expected] of [['?lista=3', '3'], ['?lista=bad', ''], ['', null], ['?lista=2', '2']]) {
    f.window.location.href = `https://render.test/lista${query}`; const before = selection.current; calls.length = 0;
    listeners.get('popstate')(); assert.deepEqual(calls, [['id', expected], ['emoji', false], ['template', false]]); assert.notEqual(selection.current, before);
  }
  calls.length = 0; current = false; listeners.get('popstate')(); assert.deepEqual(calls, []); assert.deepEqual(f.writes, []);
  cleanup(); assert.equal(listeners.size, 0);
});
test('actual canonical effect replaces absent selection only; explicit links and stale/loading state are not retargeted', () => {
  const effect = effects().find(n => text(n.arguments[0]).includes('const explicit ='));
  for (const [query, activeId, loading, current] of [['', null, false, true], ['?lista=99', null, false, true], ['?lista=bad', '', false, true], ['', '2', false, true], ['', null, true, true], ['', null, false, false]]) {
    const f = locationFixture(query), selected = [];
    evaluate(effect.arguments[0], { ...helpers, window: f.window, loading, activeId, lists: [{ id: '2' }], currentSession: () => current, setActiveId: id => selected.push(id) })();
    const eligible = activeId === null && !loading && current;
    assert.deepEqual(selected, eligible ? [query ? '99' : '2'] : []);
    assert.equal(f.writes.length, eligible && !query ? 1 : 0);
  }
});
test('actual selection delegates navigation only; denied/stale/busy/invalid requests cannot directly change selection', () => {
  for (const [current, pending, id, allow] of [[true, 0, '3', true], [true, 0, '3', false], [false, 0, '3', true], [true, 1, '3', true], [true, 0, 'bad', true]]) {
    const f = locationFixture(), calls = [];
    callback('selectList', { ...helpers, window: f.window, currentSession: () => current, pendingSaves: { current: pending }, navigateWithinApp: (win, url) => { assert.equal(win, f.window); calls.push(url); return allow; }, setRailOpen: () => {}, setActiveId: () => assert.fail('Selection must restore via navigation') })(id);
    assert.deepEqual(calls, current && !pending && id === '3' ? ['/lista?lista=3&other=keep#section'] : []); assert.deepEqual(f.writes, []);
  }
});
test('actual create ACK selects only original selection observation; late/ABA/session changes preserve current URL', async () => {
  for (const mode of ['same', 'changed', 'aba', 'stale']) {
    const f = locationFixture(), selection = { current: { id: '2' } }, calls = []; let release, current = true;
    const deps = { ...helpers, window: f.window, creating: false, listSelection: selection, currentSession: () => current,
      creation:{current:null},creationOrigin:{current:null},mounted:{current:true},pendingSaves:{current:0},
      setCreating: () => {},setCreationState:()=>{},setTemplates:()=>{},setSaveTemplateOpen:()=>{},
      runSaving: fn => fn(), scopedRequest: () => new Promise(resolve => { release = resolve; }), cloneTemplateBlocks: value => value,
      createPersonalListCreation:options=>createPersonalListCreation({...options,createRequestId:()=> '10000000-0000-4000-8000-000000000164'}),reconcilePersonalListCreation,
      updateLists: fn => calls.push(['rows', fn([])]), setActiveId: id => calls.push(['id', id]), setTemplateOpen: () => {} };
    const effect=effects().find(n=>text(n.arguments[0]).includes('const model=createPersonalListCreation'));
    const cleanup=evaluate(effect.arguments[0],deps)();
    const pending = callback('createList', deps)({ titulo: 'New', emoji: 'x', bloques: [] });
    if (mode === 'changed' || mode === 'aba') selection.current = { id: mode === 'aba' ? '2' : '3' };
    if (mode === 'stale') current = false;
    release({id:'4',titulo:'New',emoji:'x',posicion:0,version:1,created_at:'2026-10-23T12:00:00Z',updated_at:'2026-10-23T12:00:00Z',
      creation_request_id:'10000000-0000-4000-8000-000000000164',bloques:[],secciones:[]}); await pending;
    assert.equal(f.writes.length, mode === 'same' ? 1 : 0); assert.deepEqual(calls.filter(([key]) => key === 'id'), mode === 'same' ? [['id', '4']] : mode==='stale' ? [['id',null]] : []);
    if (mode === 'same') assert.equal(f.writes[0].url, '/lista?lista=4&other=keep#section');
    if (mode === 'stale') assert.deepEqual(calls, [['rows',[]],['id',null]],'Retired session purges private view without selecting created page or changing URL');
    cleanup();
  }
});
test('actual delete ACK clears only deleted URL selection; other selection/query/hash survive', async () => {
  for (const mode of ['same', 'other', 'stale']) {
    const f = locationFixture(), calls = []; let release, current = true;
    const deps = { ...helpers, window: f.window, activeList: { id: '2', titulo: 'A' }, currentSession: () => current,
      runSaving: fn => fn(), scopedRequest: () => new Promise(resolve => { release = resolve; }), updateLists: fn => calls.push(['rows', fn([{ id: '2' }, { id: '3' }])]), setActiveId: id => calls.push(['id', id]) };
    const pending = callback('deleteList', deps)();
    if (mode === 'other') f.window.location.href = 'https://render.test/lista?lista=3&other=keep#section';
    if (mode === 'stale') current = false;
    release({ ok: true }); await pending;
    assert.equal(f.writes.length, mode === 'same' ? 1 : 0);
    if (mode === 'same') { assert.equal(f.writes[0].url, '/lista?other=keep#section'); assert.deepEqual(calls.at(-1), ['id', null]); }
    if (mode === 'other') assert.equal(f.window.location.href, 'https://render.test/lista?lista=3&other=keep#section');
    if (mode === 'stale') assert.deepEqual(calls, []);
  }
});

test('cancelled or rejected deletion never changes the selected URL, inventory or selected ID', async () => {
  for (const mode of ['cancel', 'failure']) {
    const f = locationFixture(), calls = [];
    f.window.confirm = () => mode !== 'cancel';
    await callback('deleteList', { ...helpers, window: f.window, activeList: { id: '2', titulo: 'A' }, currentSession: () => true,
      runSaving: async fn => { calls.push('operation'); return fn(); },
      scopedRequest: async () => { throw Error('Synthetic deletion failure'); },
      updateLists: () => assert.fail('No inventory change without ACK'), setActiveId: () => assert.fail('No selection change without ACK') })();
    assert.deepEqual(calls, mode === 'cancel' ? [] : ['operation']);
    assert.deepEqual(f.writes, []);
    assert.equal(f.window.location.href, 'https://render.test/lista?lista=2&other=keep#section');
  }
});
