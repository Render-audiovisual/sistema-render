import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectLocation } from './projectsModel.js';

// Execute only small page-owned controllers extracted from trusted JSX source.
// No React mount, browser, history monkeypatch, server or business-data storage.
const source = readFileSync(new URL('./Projects.jsx', import.meta.url), 'utf8');
const ID = '10000000-0000-4000-8000-000000000001';
const NEXT = '20000000-0000-4000-8000-000000000002';
const section = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} controller boundaries exist`);
  return source.slice(start, end);
};
const statusSource = section('  function navigationStatus(', '  useNavigationGuard(navigationStatus);');
const leaveSource = section('  function canLeave()', '  function navigationStatus(');
const popSource = section('    const navigate = () => {', '    window.addEventListener("popstate", navigate);');

function state() {
  const formRef = { current: null }, mutationBusy = { current: false }, selectionRef = { current: { id: ID, invalid: false } };
  const win = { location: new URL(`https://render.test/proyectos?proyecto=${ID}`) };
  let current=true;
  const status = new Function('formRef', 'mutationBusy', 'selectionRef', 'projectLocation', 'window', 'captureAction', `${statusSource}\nreturn navigationStatus;`)(formRef, mutationBusy, selectionRef, projectLocation, win,()=>({current:()=>current}));
  return { formRef, mutationBusy, selectionRef, win, status,obsolete(){current=false} };
}
const dirtyForm = () => ({ draft: { titulo: 'Borrador' }, initial: { titulo: 'Original' }, busy: false, baseRevision: 3, conflict: true });

test('Projects registers one shared hook and removes page-level confirmation/unload/rollback listeners', () => {
  assert.match(source, /import \{ useNavigationGuard \} from "\.\.\/shared\/navigation\/useNavigationGuard.js"/);
  assert.equal((source.match(/useNavigationGuard\(navigationStatus\)/g) || []).length, 1);
  assert.doesNotMatch(source, /render:before-navigation|beforeunload|approvedHref|queueMicrotask/);
  assert.match(source, /addEventListener\("popstate", navigate\)/);
  assert.match(source, /removeEventListener\("popstate", navigate\)/);
  assert.doesNotMatch(popSource, /canLeave|confirm|replaceState|pushState|history\.go|history\.back/);
});

test('getter reads latest draft/form busy and mutation lock refs, not captured snapshots', () => {
  const h = state(), context = { type: 'traverse', to: '/inicio' };
  assert.deepEqual(h.status(context), { dirty: false, busy: false });
  const draft = dirtyForm(); h.formRef.current = draft;
  assert.deepEqual(h.status(context), { dirty: true, busy: false });
  draft.busy = true;
  assert.deepEqual(h.status(context), { dirty: true, busy: true });
  h.formRef.current = null;
  h.mutationBusy.current = true;
  assert.deepEqual(h.status(context), { dirty: false, busy: true });
  h.mutationBusy.current = false;
  h.formRef.current = { draft: { titulo: 'Guardado' }, initial: { titulo: 'Guardado' }, busy: false };
  assert.deepEqual(h.status(context), { dirty: false, busy: false });
  h.formRef.current=dirtyForm();h.mutationBusy.current=true;h.obsolete();assert.deepEqual(h.status(context),{dirty:false,busy:false});
});

test('same-project URL context preserves draft, different/invalid project and unload remain guarded', () => {
  const h = state(); h.formRef.current = dirtyForm();
  assert.deepEqual(h.status({ type: 'link', to: `/proyectos?proyecto=${ID}&tab=actividad#detalle` }), { dirty: false, busy: false });
  assert.deepEqual(h.status({ type: 'traverse', to: `/proyectos?proyecto=${NEXT}` }), { dirty: true, busy: false });
  assert.deepEqual(h.status({ type: 'link', to: '/proyectos?proyecto=invalid' }), { dirty: true, busy: false });
  assert.deepEqual(h.status({ type: 'link', to: `https://other.test/proyectos?proyecto=${ID}` }), { dirty: true, busy: false });
  assert.deepEqual(h.status({ type: 'unload', to: `/proyectos?proyecto=${ID}` }), { dirty: true, busy: false });
  assert.equal(h.formRef.current.draft.titulo, 'Borrador');
  assert.equal(h.formRef.current.baseRevision, 3);
});

test('getter never confirms or mutates drafts; local canLeave confirms once and busy refuses silently', () => {
  const h = state(); let prompts = 0, accepted = false;
  h.win.confirm = () => { prompts += 1; return accepted; };
  const canLeave = new Function('formRef', 'mutationBusy', 'window', `${leaveSource}\nreturn canLeave;`)(h.formRef, h.mutationBusy, h.win);
  h.formRef.current = dirtyForm();
  h.status({ type: 'traverse', to: '/inicio' });
  assert.equal(prompts, 0);
  assert.equal(canLeave(), false);
  assert.equal(prompts, 1);
  assert.equal(h.formRef.current.draft.titulo, 'Borrador');
  accepted = true;
  assert.equal(canLeave(), true);
  assert.equal(prompts, 2);
  h.mutationBusy.current = true;
  assert.equal(canLeave(), false);
  assert.equal(prompts, 2);
});

test('local cancel preserves refusal and clears form/ref only after one accepted decision', () => {
  const h = state(), calls = [];
  const cancelSource = section('  function cancelForm()', '  function moveStage(');
  let allowed = false, checks = 0;
  const cancel = new Function('canLeave', 'setForm', 'formRef', `${cancelSource}\nreturn cancelForm;`)(() => { checks += 1; return allowed; }, value => calls.push(value), h.formRef);
  h.formRef.current = dirtyForm();
  cancel();
  assert.equal(checks, 1);
  assert.deepEqual(calls, []);
  assert.equal(h.formRef.current.draft.titulo, 'Borrador');
  allowed = true; cancel();
  assert.equal(checks, 2);
  assert.deepEqual(calls, [null]);
  assert.equal(h.formRef.current, null);
});

test('committed popstate restores project selection once, never asks again or rewrites history', () => {
  const h = state(), updates = [];
  const contexts = [];
  const pop = new Function('window', 'projectLocation', 'selectionRef', 'formRef', 'setForm', 'setMessage', 'setSelection', 'restoreListContext', `${popSource}\nreturn navigate;`)(
    h.win, projectLocation, h.selectionRef, h.formRef, value => updates.push(['form', value]), value => updates.push(['message', value]), value => updates.push(['selection', value]), href => contexts.push(href));
  h.formRef.current = dirtyForm();
  h.win.confirm = () => { throw new Error('must not confirm after approval'); };
  h.win.history = new Proxy({}, { get() { throw new Error('must not repair history'); } });
  pop(); // harmless same-project context preserves open draft
  assert.equal(updates.length, 0);
  h.win.location = new URL(`https://render.test/proyectos?proyecto=${NEXT}`);
  pop();
  assert.deepEqual(h.selectionRef.current, { id: NEXT, invalid: false });
  assert.equal(h.formRef.current, null);
  assert.equal(updates.filter(([key]) => key === 'selection').length, 1);
  pop();
  assert.equal(updates.filter(([key]) => key === 'selection').length, 1);
  assert.equal(contexts.length, 3, 'List context is restored even when project selection is unchanged');
});

test('task link delegates to shared navigation exactly once, with no pre-confirm or draft clearing', () => {
  const controller = section('  function openTask(event, href)', '\n  const shownList =');
  assert.doesNotMatch(controller, /canLeave|confirm|setForm|formRef|pushState/);
  const calls = [];
  const plain = event => event.button === 0 && !event.ctrlKey;
  const make = onNavigate => new Function('plainClick', 'onNavigate', 'navigateWithinApp', 'window', `${controller}\nreturn openTask;`)(plain, onNavigate, (_win, href) => calls.push(['shared', href]), {});
  const event = { button: 0, preventDefault() { calls.push(['prevent']); } };
  make(null)(event, '/workspace/tareas?task=8');
  assert.deepEqual(calls, [['prevent'], ['shared', '/workspace/tareas?task=8']]);
  calls.length = 0;
  make(href => calls.push(['parent', href]))(event, '/workspace/tareas?task=8');
  assert.deepEqual(calls, [['prevent'], ['parent', '/workspace/tareas?task=8']]);
  calls.length = 0;
  make(null)({ ...event, ctrlKey: true }, '/workspace/tareas?task=8');
  assert.deepEqual(calls, []);
});

test('select/cancel local gates and successful-save reset stay separate from shared navigation', () => {
  assert.match(source, /selection.id !== item.id && canLeave\(\)\) selectProject\(item.id\)/);
  assert.match(source, /if \(canLeave\(\)\) selectProject\(null\)/);
  assert.match(source, /function openForm\(kind, item\) \{\s*const scope=captureAction\(\);if\(!scope.current\(\)\)return;\s*if \(!canLeave\(\)\) return/);
  assert.match(source, /setForm\(null\); formRef.current = null;\s*if \(current.kind === "create"\) selectProject\(data.id\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|history\.go\(|history\.back\(/);
});
