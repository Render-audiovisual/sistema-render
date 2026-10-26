import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {personalListId, personalListUrl} from './personalListLocation.js';
import {navigateWithinApp} from '../shared/navigation/location.js';

// Execute the current page callback, actual URL builder and shared navigation.
// The window is in-memory: no browser/focus or persistence acceptance claim.
const source = readFileSync(new URL('./PersonalLists.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PersonalLists.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selectList') callback = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(callback);
const js = ts.transpileModule(`const callback=(${callback.getText(ast)});`, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None},
}).outputText;

function fixture({href = 'https://render.test/lista?lista=1', mobile = true, denied = false} = {}) {
  const effects = [], target = new EventTarget();
  let current = new URL(href), railOpen = true, live = true;
  const pendingSaves = {current: 0};
  const draft = {text: 'Unsubmitted private item', token: {}, block: {texto: 'Unsaved block'}};
  const draftBefore = structuredClone(draft), tokenBefore = draft.token, blockBefore = draft.block;
  class CustomEvent extends Event {constructor(type, options = {}) {super(type, options); this.detail = options.detail;}}
  class PopStateEvent extends Event {constructor(type, options = {}) {super(type); this.state = options.state;}}
  const win = {
    get location() {return current;},
    CustomEvent, PopStateEvent,
    matchMedia(query) {assert.equal(query, '(max-width: 980px)'); return {matches: mobile};},
    history: {state: {}, pushState(state, _title, url) {effects.push(['push', url]); this.state = state; current = new URL(url, current);},
      replaceState() {assert.fail('Selection must not replace history');}},
    dispatchEvent(event) {effects.push(['event', event.type]); return target.dispatchEvent(event);},
    scrollTo(options) {effects.push(['scroll', options]);},
  };
  if (denied) target.addEventListener('render:before-navigation', event => event.preventDefault());
  const deps = {window: win, globalThis: {matchMedia: query => win.matchMedia(query)}, URL,
    currentSession: () => live, pendingSaves, personalListId, personalListUrl,
    navigateWithinApp(window, url) {effects.push(['navigate', url]); return navigateWithinApp(window, url);},
    setRailOpen(value) {effects.push(['rail', value]); railOpen = value;},
    // Any accidental editor/reset/write dependency must fail, not be silently stubbed.
    itemDrafts: {current: {clear() {assert.fail('No draft discard');}}},
    queue: {current: {discard() {assert.fail('No queued draft discard');}, flush() {assert.fail('No save');}}},
    setActiveId() {assert.fail('Selection must use shared navigation, not directly rebind editor');},
  };
  const select = new Function(...Object.keys(deps), `${js};return callback;`)(...Object.values(deps));
  return {select, effects, win, pendingSaves, rail: () => railOpen,
    retire() {live = false;},
    assertDraft() {assert.deepEqual(draft, draftBefore); assert.strictEqual(draft.token, tokenBefore); assert.strictEqual(draft.block, blockBefore);},
  };
}

test('actual mobile selection of the same canonical URL closes rail without navigation/events or draft changes', () => {
  const f = fixture(); f.select('1');
  assert.equal(f.rail(), false, 'Current page selection must dismiss the mobile rail');
  assert.deepEqual(f.effects, [['rail', false]]);
  assert.equal(f.win.location.href, 'https://render.test/lista?lista=1'); f.assertDraft();
});

test('actual mobile different-page selection navigates once and closes after admitted navigation', () => {
  const f = fixture(); f.select('2');
  assert.equal(f.rail(), false); assert.equal(f.win.location.href, 'https://render.test/lista?lista=2');
  assert.deepEqual(f.effects.map(row => row[0]), ['navigate', 'event', 'push', 'event', 'scroll', 'rail']);
  assert.equal(f.effects.filter(row => row[0] === 'navigate').length, 1); f.assertDraft();
});

test('actual denied different-page navigation keeps rail, URL and drafts without history/popstate', () => {
  const f = fixture({denied: true}); f.select('2');
  assert.equal(f.rail(), true); assert.equal(f.win.location.href, 'https://render.test/lista?lista=1');
  assert.deepEqual(f.effects, [['navigate', '/lista?lista=2'], ['event', 'render:before-navigation']]); f.assertDraft();
});

test('desktop selection never dismisses rail for either current or different page', () => {
  for (const id of ['1', '2']) {
    const f = fixture({mobile: false}); f.select(id);
    assert.equal(f.rail(), true); assert.equal(f.effects.some(row => row[0] === 'rail'), false); f.assertDraft();
  }
});

test('retired session and pending structural operation prevent even same-page mobile dismissal', () => {
  for (const blocked of ['session', 'pending']) {
    const f = fixture();
    if (blocked === 'session') f.retire(); else f.pendingSaves.current = 1;
    for (const id of ['1', '2']) f.select(id);
    assert.equal(f.rail(), true); assert.deepEqual(f.effects, []); f.assertDraft();
  }
});

test('invalid IDs cannot navigate, dismiss or coerce adjacent BIGINT IDs', () => {
  const f = fixture();
  for (const id of ['', '0', '01', '-1', '1e0', '0x1', '1\n', '9223372036854775808', 9007199254740992, {}, null]) f.select(id);
  assert.equal(f.rail(), true); assert.deepEqual(f.effects, []); f.assertDraft();
});

test('adjacent valid BIGINT strings remain distinct targets without Number precision loss', () => {
  const f = fixture({href: 'https://render.test/lista?lista=9007199254740992&keep=1#note'});
  f.select('9007199254740993');
  assert.equal(f.win.location.search, '?lista=9007199254740993&keep=1');
  assert.equal(f.win.location.hash, '#note'); assert.equal(f.rail(), false); f.assertDraft();
});

test('live URL A→B→A canonical comparison uses current URL, preserving query and hash', () => {
  const f = fixture({href: 'https://render.test/lista?lista=1&keep=1#note', mobile: false});
  f.select('2'); f.select('1');
  assert.equal(f.win.location.href, 'https://render.test/lista?lista=1&keep=1#note');
  assert.equal(f.effects.filter(row => row[0] === 'push').length, 2);
  assert.equal(f.rail(), true); f.assertDraft();
});
