import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import { buildContextUrl } from '../shared/navigation/url-context.js';
import { navigateWithinApp } from '../shared/navigation/location.js';
import { readFeedbackNotesLocation, feedbackNotesLocationUrl } from './feedbackNotesPagination.js';

function load(path) { return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX); }
const raw = load('../shared/navigation/url-context.js'), feedback = load('./Feedback.jsx');
function extract(file, name, deps) {
  const matches = [];
  function walk(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) matches.push(n); ts.forEachChild(n, walk); }
  walk(file); assert.equal(matches.length, 1, name);
  return Function(...Object.keys(deps), `return (${matches[0].getText(file).replace(/^export\s+/, '')});`)(...Object.values(deps));
}
function browser(href) {
  const order = [], events = [], writes = [], state = { fromTasks: '/workspace/tareas?task=7' };
  class UIEvent { constructor(type, options = {}) { Object.assign(this, { type, defaultPrevented: false }, options); } preventDefault() { this.defaultPrevented = true; } }
  const win = { location: new URL(href), history: { state }, CustomEvent: UIEvent, PopStateEvent: UIEvent,
    dispatchEvent(event) { events.push({ type: event.type, href: win.location.href }); order.push(event.type); return true; }, scrollTo() {} };
  for (const method of ['replaceState', 'pushState']) win.history[method] = (next, title, href) => {
    writes.push({ method, state: next, title }); order.push(method); win.history.state = next; win.location = new URL(href, win.location);
  };
  return { win, events, writes, order };
}
const notices = h => h.events.filter(e => e.type === 'render:view-preference-change');
for (const path of ['./Historias.jsx', './Publicaciones.jsx']) {
  for (const mode of ['push', 'replace']) {
    test(`${path} actual ${mode} wrapper notifies exactly after raw URL write, preserving owned and unrelated context`, () => {
      const file = load(path), h = browser('https://render.test/editorial?mes=2026-10&selectedPerson=7&seg_responsable=Legacy#detail');
      const name = `${mode}UrlContext`, rawName = `${mode}RawUrlContext`;
      const writer = extract(file, name, { window: h.win, notifyViewPreferenceChange,
        [rawName]: extract(raw, name, { window: h.win, buildContextUrl }) });
      writer({ mes: '2026-11', cliente: 9 });
      assert.deepEqual(h.order, [`${mode}State`, 'render:view-preference-change']);
      assert.equal(h.writes.length, 1); assert.equal(notices(h).length, 1);
      assert.equal(notices(h)[0].href, h.win.location.href);
      assert.equal(h.win.location.searchParams.get('mes'), '2026-11'); assert.equal(h.win.location.searchParams.get('cliente'), '9');
      assert.equal(h.win.location.searchParams.get('selectedPerson'), '7'); assert.equal(h.win.location.searchParams.get('seg_responsable'), 'Legacy');
      assert.equal(h.win.location.hash, '#detail');
      h.win.history[`${mode}State`] = () => { throw new Error('History failed'); };
      assert.throws(() => writer({ mes: '2026-12' }), /History failed/); assert.equal(notices(h).length, 1);
    });
  }
}
function feedbackFixture() {
  const h = browser('https://render.test/feedback?section=clients&note=7#detail');
  const deps = { window: h.win, notifyViewPreferenceChange, navigateWithinApp, feedbackNotesLocationUrl,
    selection: readFeedbackNotesLocation(h.win.location.search), contextEpoch: { current: 0 }, panelEpoch: { current: 0 },
    readerRef: { current: { invalidate() {} } }, linkedNoteId: { current: null }, preparedPage: { current: null },
    canLeave: () => true, setError() {},
  };
  for (const name of ['Notes', 'Page', 'Loading', 'Location', 'Selected', 'Draft', 'Baseline', 'Message', 'Conflict']) deps[`set${name}`] = () => {};
  deps.recordSelected = note => extract(feedback, 'recordSelected', deps)(note);
  return { ...h, deps, run: (name, ...args) => extract(feedback, name, deps)(...args) };
}

test('feedback actual move notifies after successful router commit; veto, same URL, missing selection and errors do not notify', () => {
  const h = feedbackFixture();
  h.run('moveNotes', { section: 'team', offset: 0 });
  assert.deepEqual(h.order, ['render:before-navigation', 'pushState', 'popstate', 'render:view-preference-change']);
  assert.equal(h.writes.length, 1); assert.equal(notices(h)[0].href, h.win.location.href);
  h.run('moveNotes', { section: 'team', offset: 0 }); assert.equal(notices(h).length, 1);
  h.deps.navigateWithinApp = () => false; h.run('moveNotes', { section: 'clients' }); assert.equal(notices(h).length, 1);
  const errors = []; h.deps.setError = value => errors.push(value);
  h.deps.navigateWithinApp = () => { throw new Error('Navigation failed'); };
  h.run('moveNotes', { section: 'clients' }); assert.deepEqual(errors, ['Navigation failed']); assert.equal(notices(h).length, 1);
  h.deps.selection = null; h.run('moveNotes', {}); assert.equal(notices(h).length, 1);
});

test('feedback actual restart replaces once then notifies without routing events; history failure does not notify', () => {
  const h = feedbackFixture(); h.run('restartNotes', { id: 8 });
  assert.deepEqual(h.order, ['replaceState', 'render:view-preference-change']);
  assert.equal(h.writes[0].state.fromTasks, '/workspace/tareas?task=7');
  assert.equal(h.win.location.searchParams.get('note'), '8'); assert.equal(h.deps.linkedNoteId.current, 8);
  assert.equal(notices(h)[0].href, h.win.location.href);
  h.win.history.replaceState = () => { throw new Error('History failed'); };
  assert.throws(() => h.run('restartNotes'), /History failed/); assert.equal(notices(h).length, 1);
});

test('feedback actual openNote keeps discard veto and only notifies when recordSelected writes a URL', () => {
  const h = feedbackFixture();
  h.deps.canLeave = () => false; h.run('openNote', { id: 8 }); assert.deepEqual(h.order, []);
  h.deps.canLeave = () => true; h.run('openNote', { id: 8 });
  assert.deepEqual(h.order, ['replaceState', 'render:view-preference-change']);
  assert.equal(h.win.location.searchParams.get('note'), '8'); assert.equal(notices(h)[0].href, h.win.location.href);
  h.deps.selection = null; h.run('openNote', { id: 9 }); assert.equal(notices(h).length, 1);
  h.deps.selection = readFeedbackNotesLocation('?section=clients'); h.win.history.replaceState = () => { throw new Error('History failed'); };
  assert.throws(() => h.run('openNote', { id: 9 }), /History failed/); assert.equal(notices(h).length, 1);
});
