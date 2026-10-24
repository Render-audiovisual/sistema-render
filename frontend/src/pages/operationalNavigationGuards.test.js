import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { navigateWithinApp } from '../shared/navigation/location.js';
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import { readFeedbackNotesLocation, feedbackNotesLocationUrl } from './feedbackNotesPagination.js';
import { feedbackNotesMutationBody } from './feedbackNotesMutation.js';
import { productionCalendarDay } from './productionRouteContext.js';
import ts from 'typescript';

// Extract real non-JSX handlers. These are protocol/source tests, not mounted
// React or native browser traversal verification.
const production = readFileSync(new URL('./Productions.jsx', import.meta.url), 'utf8');
const feedback = readFileSync(new URL('./Feedback.jsx', import.meta.url), 'utf8');
const feedbackInventory = readFileSync(new URL('./FeedbackTaskInventory.jsx', import.meta.url), 'utf8');
const feedbackTree=ts.createSourceFile('Feedback.jsx',feedback,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const productionTree=ts.createSourceFile('Productions.jsx',production,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];const visit=node=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit)};visit(root);return result;}
const feedbackGuards=nodes(feedbackTree,node=>ts.isCallExpression(node)&&node.expression.getText(feedbackTree)==='useNavigationGuard');
const productionGuards=nodes(productionTree,node=>ts.isCallExpression(node)&&node.expression.getText(productionTree)==='useNavigationGuard');
function evaluate(node,bindings){return Function(...Object.keys(bindings),`return (${node.getText(feedbackTree).replace(/^export /,'')});`)(...Object.values(bindings));}
function feedbackHandler(name, bindings) {
  const start = feedback.indexOf(`  function ${name}(`);
  const end = feedback.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start);
  return Function(...Object.keys(bindings), `${feedback.slice(start, end)};return ${name};`)(...Object.values(bindings));
}
class Custom extends Event { constructor(type, options = {}) { super(type, options); this.detail = options.detail; } }
class Pop extends Event { constructor(type, options = {}) { super(type, options); this.state = options.state; } }
class FakeWindow extends EventTarget {
  constructor(href = 'https://render.test/feedback?section=clients&note=7', state = {}) {
    super(); this.location = new URL(href); this.trace = []; this.CustomEvent = Custom; this.PopStateEvent = Pop;
    const win = this;
    this.history = { state, pushState(next, title, href) { win.trace.push('push'); win.location = new URL(href, win.location.href); this.state = next; } };
  }
  dispatchEvent(event) { this.trace.push(event.type); return super.dispatchEvent(event); }
  scrollTo() { this.trace.push('scroll'); }
}
function sectionHarness(win) {
  const state = { selected: { id: 7 }, draft: { titulo: 'No perder' }, baseline: 'original', section: 'clients' };
  const changes = [];
  const bindings = { notifyViewPreferenceChange, window: win, navigateWithinApp, selection:readFeedbackNotesLocation(win.location.search), section:'clients', feedbackNotesLocationUrl,
    setError: error => { throw error; }, contextEpoch:{current:0}, panelEpoch:{current:0}, readerRef:{current:null}, linkedNoteId:{current:null},
    setQuery(){},setNotes(){},setPage(){},setConflict(){},setDuplicates(){},
    feedbackNotesLocation:()=>({selection:readFeedbackNotesLocation(win.location.search),error:''}) };
  for (const [name, key] of [['setSection', 'section'], ['setSelected', 'selected'], ['setDraft', 'draft'], ['setBaseline', 'baseline']]) {
    bindings[name] = value => { changes.push([key, value]); state[key] = value; };
  }
  bindings.setLocation = next => { changes.push(['section',next.selection.section]); state.section=next.selection.section; };
  bindings.moveNotes = feedbackHandler('moveNotes', bindings);
  const start=feedback.indexOf('  restoreLocationRef.current = () => {'),end=feedback.indexOf('  useEffect(() => {',start);
  const restoreLocationRef={current:null};
  Function(...Object.keys(bindings),'restoreLocationRef',feedback.slice(start,end))(...Object.values(bindings),restoreLocationRef);
  win.addEventListener('popstate',()=>restoreLocationRef.current());
  return { state, changes, change: feedbackHandler('changeSection', bindings) };
}

test('both pages register live dirty/busy getters and remove duplicate unload/custom guards', () => {
  assert.equal(productionTree.parseDiagnostics.length,0);
  assert.equal(productionGuards.length,1,'Productions registers one live product guard');
  assert.equal(productionGuards[0].arguments.length,2,'Productions explicitly wires its ref-only observation provider');
  assert.equal(feedbackTree.parseDiagnostics.length,0);
  assert.equal(feedbackGuards.length,1,'Feedback registers one live product guard');
  for (const source of [production, feedback]) {
    assert.doesNotMatch(source, /addEventListener\(['"]beforeunload|addEventListener\(['"]render:before-navigation/);
    assert.match(source, /useNavigationGuard.*shared\/navigation\/useNavigationGuard/);
  }
});

test('production getter reads mutable set/write lock at navigation time without clearing either', () => {
  const expression = productionGuards[0].arguments[0].getText(productionTree);
  const dirty = { current: new Set() }, writeLock = { current: false }, batchDraft = { current: {busy:false} };
  const getter = Function('dirty', 'writeLock', 'batchDraft', `return ${expression};`)(dirty, writeLock, batchDraft);
  assert.deepEqual(getter(), { dirty: false, busy: false }); dirty.current.add('video'); writeLock.current = true;
  assert.deepEqual(getter(), { dirty: true, busy: true }); assert.equal(dirty.current.size, 1);
  writeLock.current = false; assert.deepEqual(getter(), { dirty: true, busy: false });
  batchDraft.current.busy = true; assert.deepEqual(getter(), { dirty: true, busy: true });
  assert.equal(dirty.current.size,1); assert.equal(writeLock.current,false);
});

test('production explicit provider reads the current opaque observation without mutating guard state',()=>{
  const provider=productionGuards[0].arguments[1];assert.ok(provider);
  const productionObservation={current:Symbol('first')};
  const read=Function('productionObservation',`return (${provider.getText(productionTree)});`)(productionObservation);
  const first=productionObservation.current;assert.equal(read(),first);assert.equal(read(),first);
  productionObservation.current=Symbol('next');assert.equal(read(),productionObservation.current);assert.notEqual(read(),first);
});

test('feedback getter uses render dirty, synchronous lock and live unresolved receipt ownership', () => {
  const lock = { current: false },mutationRef={current:{model:{snapshot:{locked:false,phase:'idle'}}}};
  const render=dirty=>evaluate(feedbackGuards[0].arguments[0],{dirty,lock,mutationRef});
  let latest = render(false); assert.deepEqual(latest(), { dirty: false, busy: false });
  latest = render(true); lock.current = true; assert.deepEqual(latest(), { dirty: true, busy: true });
  lock.current = false; latest = render(false); assert.deepEqual(latest(), { dirty: false, busy: false });
  for(const phase of ['preflight','writing','uncertain','read_failed','conflict','reviewed']){
    const snapshot={locked:true,phase};mutationRef.current.model.snapshot=snapshot;
    assert.deepEqual(latest(),{dirty:true,busy:true},`${phase} cannot discard/rebase an unresolved operation`);
    assert.equal(mutationRef.current.model.snapshot,snapshot,'Reading the guard never resolves the receipt');
  }
  mutationRef.current.model.snapshot={locked:true,phase:'duplicates'};
  assert.deepEqual(latest(),{dirty:true,busy:false},'Known-unsent duplicate requires discard confirmation, not an uncertain-write lock');
  lock.current=true;assert.deepEqual(latest(),{dirty:true,busy:true});lock.current=false;
  mutationRef.current.model.snapshot={locked:false,phase:'idle'};
  assert.deepEqual(latest(),{dirty:false,busy:false});latest=render(true);assert.deepEqual(latest(),{dirty:true,busy:false});
});

test('rejected section navigation preserves URL/history, selected note, draft and baseline', () => {
  const win = new FakeWindow(); const initial = win.location.href, initialState = win.history.state;
  const panel = sectionHarness(win);
  win.addEventListener('render:before-navigation', event => event.preventDefault());
  panel.change('team');
  assert.equal(win.location.href, initial); assert.equal(win.history.state, initialState);
  assert.deepEqual(panel.changes, []); assert.equal(panel.state.draft.titulo, 'No perder'); assert.equal(panel.state.selected.id, 7);
  assert.deepEqual(win.trace, ['render:before-navigation']);
});

test('accepted section navigation asks protocol before clearing and commits exactly one push/popstate', () => {
  const win = new FakeWindow(), panel = sectionHarness(win);
  win.addEventListener('render:before-navigation', event => {
    assert.equal(event.cancelable, true); assert.equal(panel.changes.length, 0);
    assert.equal(panel.state.draft.titulo, 'No perder'); assert.equal(event.detail.href, '/feedback?section=team&limit=50&offset=0');
  });
  panel.change('team');
  assert.equal(win.location.search, '?section=team&limit=50&offset=0'); assert.equal(panel.state.section, 'team');
  assert.equal(panel.state.draft, null); assert.equal(panel.state.selected, null); assert.equal(panel.state.baseline, '');
  assert.deepEqual(win.trace, ['render:before-navigation', 'push', 'popstate', 'scroll', 'render:view-preference-change']);
});

test('same section exact URL no-op never discards the active draft', () => {
  const win = new FakeWindow('https://render.test/feedback?section=clients'); const panel = sectionHarness(win);
  panel.change('clients'); assert.deepEqual(panel.changes, []); assert.deepEqual(win.trace, []);
});

test('related task and back-to-task links honor cancellation without local double confirmation', () => {
  for (const name of ['backToTasks']) {
    const win = new FakeWindow('https://render.test/feedback?section=team', { fromTasks: '/workspace/tareas?task=21&sector=edicion' });
    win.addEventListener('render:before-navigation', event => event.preventDefault());
    const handler = feedbackHandler(name, { window: win, navigateWithinApp });
    assert.equal(handler(17), false); assert.equal(win.location.pathname, '/feedback');
    assert.deepEqual(win.trace, ['render:before-navigation']);
  }
  const win = new FakeWindow('https://render.test/feedback?section=team');
  win.addEventListener('render:before-navigation', event => event.preventDefault());
  const openTaskLine = feedbackInventory.split('\n').find(line => line.startsWith('  const openTask = '));
  assert.ok(openTaskLine, 'Exercise the actual inventory link handler, not the retired synthetic-note handler');
  const open = Function('window', 'navigateWithinApp', `${openTaskLine};return openTask;`)(win, navigateWithinApp);
  let prevented = false;
  open({ button: 0, preventDefault() { prevented = true; } }, '/workspace/tareas?task=17');
  assert.equal(prevented, true); assert.equal(win.location.pathname, '/feedback');
  assert.deepEqual(win.trace, ['render:before-navigation']);
});

test('back-to-task context is retained only for a valid same-origin task route', () => {
  for (const [fromTasks, expected] of [
    ['/workspace/tareas?task=21&sector=edicion#detalle', '/workspace/tareas?task=21&sector=edicion#detalle'],
    ['https://evil.example/workspace/tareas', '/workspace/tareas'], ['/finanzas', '/workspace/tareas'],
  ]) {
    const win = new FakeWindow('https://render.test/feedback', { fromTasks });
    const handler = feedbackHandler('backToTasks', { window: win, navigateWithinApp });
    assert.equal(handler(), true); assert.equal(`${win.location.pathname}${win.location.search}${win.location.hash}`, expected);
    assert.equal(win.trace.filter(value => value === 'push').length, 1);
  }
  assert.doesNotMatch(feedback, /history\.pushState|history\.back\(/);
});

test('production committed popstate restoration does not prompt or roll back the URL', async () => {
  const start = production.indexOf('  const restoreProductionLocation = async');
  const end = production.indexOf('  navigationRef.current = restoreProductionLocation;', start);
  const handlerSource = production.slice(start, end);
  assert.doesNotMatch(handlerSource, /mayLeave|writeProductionLocation|window.confirm|replaceState/);
  const dirty = { current: new Set(['draft']) }, openVersion = { current: 0 }, updates = [];
  const bindings = { window: { location: { href: 'https://render.test/producciones?mes=2026-11' } },
    readEpoch:{current:0},setListAvailable:()=>{},setContextError:()=>{},setClientId:()=>{},setTab:()=>{},setReload:()=>{},
    productionLocation: () => ({ id: null, month: '2026-11' }), productionCalendarDay, dirty, openVersion, today: '2026-10-19',
    openVisit: async () => { throw new Error('not expected'); } };
  for (const name of ['setSelected', 'setCreating', 'setDetailLoading', 'setError', 'setMonth', 'setDay']) bindings[name] = value => updates.push([name, value]);
  const restore = Function(...Object.keys(bindings), `${handlerSource};return restoreProductionLocation;`)(...Object.values(bindings));
  await restore(); assert.equal(dirty.current.size, 1, 'initial/manual restore is not a confirmed discard');
  await restore({ discardDrafts: true }); assert.equal(dirty.current.size, 0);
  assert.ok(updates.some(([name, value]) => name === 'setMonth' && value === '2026-11'));
  assert.match(production, /discardDrafts:event\?\.type === 'popstate'/);
});

test('production local controls retain one explicit confirmation and busy denies without discard', () => {
  const source = /  const mayLeave = ([^\n]+);/.exec(production)[1];
  const dirty = { current: new Set(['draft']) }, writeLock = { current: false }, batchDraft = { current: {busy:false} }; let asks = 0, answer = false;
  const mayLeave = Function('window', 'dirty', 'writeLock', 'batchDraft', `return ${source};`)({ confirm() { asks++; return answer; } }, dirty, writeLock, batchDraft);
  assert.equal(mayLeave(), false); assert.equal(dirty.current.size, 1); assert.equal(asks, 1);
  writeLock.current = true; assert.equal(mayLeave(), false); assert.equal(asks, 1); assert.equal(dirty.current.size, 1);
  writeLock.current = false; batchDraft.current.busy=true; assert.equal(mayLeave(),false);assert.equal(asks,1);assert.equal(dirty.current.size,1);
  batchDraft.current.busy=false; answer = true; assert.equal(mayLeave(), true); assert.equal(dirty.current.size, 0); assert.equal(asks, 2);
  assert.match(production, /if\(!selected && !mayLeave\(\)\) return;/);
});

test('feedback local panel close retains draft on refused discard and permits deliberate accepted close', () => {
  let allow = false; const changes = [];
  const bindings = { canLeave: () => allow, recordSelected: value => changes.push(['recordSelected',value]) };
  for (const name of ['setSelected', 'setDraft', 'setBaseline', 'setConflict', 'setDuplicates']) bindings[name] = value => changes.push([name, value]);
  const close = feedbackHandler('closePanel', bindings);
  close(); assert.equal(changes.length, 0); allow = true; close(); assert.ok(changes.some(([name, value]) => name === 'setDraft' && value === null));
});

test('popstate listeners restore location only, clean up and preserve exact DTO observation through canonical mutation serializer', async () => {
  assert.match(production, /removeEventListener\('popstate',restore\)/);
  assert.match(feedback, /removeEventListener\("popstate", restore\)/);
  const start = feedback.indexOf('  restoreLocationRef.current = () => {'), end = feedback.indexOf('  useEffect(() => {', start);
  assert.doesNotMatch(feedback.slice(start, end), /canLeave|confirm|history\.|replaceState/);
  assert.match(feedback, /if \(!\["\/feedback", "\/bloc-notas"\].includes\(window.location.pathname\)\) return;/);
  assert.match(production, /expected_revision:visit.revision/);
  const draft={id:620,updated_at:'2026-10-22T10:00:00.123456Z',titulo:'User title',contenido:'Keep my text',categoria:'general',feedback:{cliente:'Client',responsables:['Ana'],origen:'server-only',wilson_idempotency_key:'private'}};
  const project=evaluate(nodes(feedbackTree,node=>ts.isFunctionDeclaration(node)&&node.name?.text==='feedbackBusinessInput')[0],{});
  const captured=[];
  const model={snapshot:{locked:false},start:(input,options)=>{captured.push({input,options});}};
  const persist=evaluate(nodes(feedbackTree,node=>ts.isFunctionDeclaration(node)&&node.name?.text==='persistDraft')[0],{
    draft,section:'clients',lock:{current:false},conflict:false,mutationRef:{current:{model}},feedbackResponsibles:item=>item.feedback.responsables,
    feedbackBusinessInput:project,runMutation:action=>action(model),
  });
  await persist();assert.equal(captured.length,1);assert.deepEqual(captured[0].input.note,{id:620,updated_at:draft.updated_at});
  const body=feedbackNotesMutationBody(captured[0].input,'00000000-0000-4000-8000-000000000001');
  assert.equal(body.action,'edit');assert.equal(body.note_id,draft.id);assert.equal(body.expected_updated_at,draft.updated_at);
  assert.equal(body.fields.contenido,draft.contenido);assert.equal(Object.hasOwn(body.fields.feedback,'origen'),false);assert.equal(Object.hasOwn(body.fields.feedback,'wilson_idempotency_key'),false);
  assert.equal(captured[0].options.checkDuplicates,false,'An observed edit never queues a duplicate-create preflight');
  assert.doesNotMatch(production + feedback, /localStorage|sessionStorage/);
});
