import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getTaskViewState, writeTaskViewUrl } from '../features/render-os/utils/task-view-state.js';
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import { calendarHref, readCalendarSelection } from './calendarModel.js';
import { projectListLocationUrl, projectLocationUrl } from './projectsModel.js';

function extract(path, name, deps) {
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let found;
  function walk(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n; ts.forEachChild(n, walk); }
  walk(file); assert.ok(found, name);
  return Function(...Object.keys(deps), `return (${found.getText(file)});`)(...Object.values(deps));
}
function browser(href) {
  const events = [], writes = [], order = [], state = { opaque: true };
  const win = { location: new URL(href), history: { state },
    CustomEvent: class { constructor(type) { this.type = type; } },
    dispatchEvent(event) { events.push({ type: event.type, href: win.location.href }); order.push(event.type); return true; } };
  for (const method of ['replaceState', 'pushState']) win.history[method] = (held, _title, url) => {
    assert.equal(held, state); writes.push(method); order.push(method); win.location = new URL(url, win.location);
  };
  return { win, events, writes, order };
}
function notified(h) {
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, 'render:view-preference-change');
  assert.equal(h.events[0].href, h.win.location.href);
  assert.deepEqual(h.order, [h.writes[0], 'render:view-preference-change']);
}

test('actual task writer notifies only after replace, preserving history state, selected task and hash', () => {
  const h = browser('https://render.test/workspace/tareas?task=9#detail');
  const result = writeTaskViewUrl(h.win, { ...getTaskViewState(h.win.location.search), view: 'list', client: '7' });
  notified(h); assert.equal(result.href, h.win.location.href);
  assert.equal(result.searchParams.get('view'), 'list'); assert.equal(result.searchParams.get('task'), '9'); assert.equal(result.hash, '#detail');
  h.win.history.replaceState = () => { throw new Error('Blocked history'); };
  assert.throws(() => writeTaskViewUrl(h.win, getTaskViewState('')), /Blocked history/);
  assert.equal(h.events.length, 1);
});

test('actual production writer notifies push/replace but neither exact no-op nor failed history write', () => {
  for (const replace of [true, false]) {
    const h = browser('https://render.test/producciones?mes=2026-10#detail');
    const write = extract('./Productions.jsx', 'writeProductionLocation', { window: h.win, notifyViewPreferenceChange });
    const selection = { month: '2026-10', day: '2026-10-21', clientId: '7', tab: 'pending', replace };
    write(selection); notified(h); assert.deepEqual(h.writes, [replace ? 'replaceState' : 'pushState']);
    write(selection); assert.equal(h.events.length, 1);
    h.win.history[replace ? 'replaceState' : 'pushState'] = () => { throw new Error('Blocked history'); };
    assert.throws(() => write({ ...selection, day: '2026-10-22' }), /Blocked history/); assert.equal(h.events.length, 1);
  }
});

test('actual calendar filter change notifies only a successful router commit, never a veto', () => {
  for (const allowed of [true, false]) {
    const h = browser('https://render.test/calendario?mes=2026-10');
    const change = extract('./Calendar.jsx', 'change', { window: h.win, notifyViewPreferenceChange, calendarHref, readCalendarSelection,
      selection: readCalendarSelection(h.win.location.search, '2026-10-21'), today: '2026-10-21',
      navigateWithinApp(win, href) { if (!allowed) return false; win.history.pushState(win.history.state, '', href); return true; } });
    change({ scope: 'team' });
    if (allowed) { notified(h); assert.equal(h.win.location.searchParams.get('scope'), 'team'); }
    else { assert.deepEqual(h.events, []); assert.deepEqual(h.writes, []); }
  }
});

test('actual project filters and selection notify after their own successful history writes', () => {
  for (const kind of ['filters', 'select', 'replace']) {
    const h = browser('https://render.test/proyectos?cliente=7#detail');
    const deps = { window: h.win, notifyViewPreferenceChange, projectListLocationUrl, projectLocationUrl,
      filtersRef: { current: { clientId: 7, offset: 0, estado: '', archivados: false } }, restoreListContext() {},
      setForm() {}, formRef: { current: null }, setMessage() {}, setSelection() {}, selectionRef: { current: null }, publishDetail() {} };
    const fn = extract('./Projects.jsx', kind === 'filters' ? 'changeListFilters' : 'selectProject', deps);
    if (kind === 'filters') fn({ estado: 'en_curso' }); else fn(null, kind === 'replace');
    notified(h); assert.deepEqual(h.writes, [kind === 'replace' ? 'replaceState' : 'pushState']);
    assert.equal(h.win.location.hash, '#detail'); assert.equal(h.win.location.searchParams.get('cliente'), '7');
    h.win.history[kind === 'replace' ? 'replaceState' : 'pushState'] = () => { throw new Error('Blocked history'); };
    assert.throws(() => kind === 'filters' ? fn({ estado: 'pausado' }) : fn(null, kind === 'replace'), /Blocked history/);
    assert.equal(h.events.length, 1);
  }
});
