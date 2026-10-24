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
  const discardIntentRef={current:null},discardClosingRef={current:false};
  const win = { location: new URL(`https://render.test/proyectos?proyecto=${ID}`) };
  let current=true;
  const status = new Function('formRef', 'mutationBusy', 'selectionRef', 'projectLocation', 'window', 'captureAction','discardIntentRef','discardClosingRef', `${statusSource}\nreturn navigationStatus;`)(formRef, mutationBusy, selectionRef, projectLocation, win,()=>({current:()=>current}),discardIntentRef,discardClosingRef);
  return { formRef, mutationBusy, selectionRef,discardIntentRef,discardClosingRef, win, status,obsolete(){current=false} };
}
const dirtyForm = () => ({ kind:'stage-edit',scope:{current:()=>true},draft: { titulo: 'Borrador' }, initial: { titulo: 'Original' }, busy: false, baseRevision: 3, conflict: true });
function cancellation(h) {
  const calls=[],intents=[],{discardIntentRef,discardClosingRef}=h,formReturnFocus={current:null};
  const setDiscardIntent=value=>intents.push(value);
  const controllers=new Function('formRef','mutationBusy','discardIntentRef','discardClosingRef','setDiscardIntent','setForm','formReturnFocus',
    `${section('  function cancelForm()', '  function moveStage(')}\nreturn {cancelForm,closeProjectForm,keepProjectForm,discardProjectForm};`)(
    h.formRef,h.mutationBusy,discardIntentRef,discardClosingRef,setDiscardIntent,value=>calls.push(value),formReturnFocus);
  const effectStart=source.indexOf('  useEffect(() => {',source.indexOf('  const discardClosingRef'));
  const effectEnd=source.indexOf('  const formReturnFocus',effectStart);
  assert.ok(effectStart>=0&&effectEnd>effectStart);
  return {...controllers,calls,intents,discardIntentRef,discardClosingRef,formReturnFocus,
    commitClosed(){
      assert.equal(discardIntentRef.current,null);assert.equal(intents.at(-1),null);
      new Function('useEffect','discardClosingRef','discardIntentRef','setDiscardIntent','form','discardIntent',
        source.slice(effectStart,effectEnd))(effect=>effect(),discardClosingRef,discardIntentRef,setDiscardIntent,h.formRef.current,null);
    }};
}

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
  const canLeave = new Function('formRef', 'mutationBusy', 'window','discardIntentRef','discardClosingRef', `${leaveSource}\nreturn canLeave;`)(h.formRef, h.mutationBusy, h.win,h.discardIntentRef,h.discardClosingRef);
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

test('open or closing discard dialog fences all navigation before same-project shortcuts without a second prompt',()=>{
  const h=state(),c=cancellation(h),original=dirtyForm();h.formRef.current=original;
  let prompts=0;h.win.confirm=()=>{prompts++;return true;};
  const canLeave=new Function('formRef','mutationBusy','window','discardIntentRef','discardClosingRef',
    `${leaveSource}\nreturn canLeave;`)(h.formRef,h.mutationBusy,h.win,h.discardIntentRef,h.discardClosingRef);
  const contexts=[{type:'link',to:`/proyectos?proyecto=${ID}&tab=actividad`},
    {type:'traverse',to:`/proyectos?proyecto=${ID}`},{type:'traverse',to:'/inicio'},{type:'unload'}];
  c.cancelForm();const intent=c.discardIntentRef.current;
  assert.equal(intent.form,original);
  for(const phase of ['open','closing']){
    if(phase==='closing')c.keepProjectForm(intent);
    for(const context of contexts)assert.deepEqual(h.status(context),{dirty:true,busy:true},phase);
    assert.equal(canLeave(),false,phase);assert.equal(prompts,0);
    assert.equal(h.formRef.current,original);assert.equal(c.formReturnFocus.current,null);
  }
  c.commitClosed();
  assert.deepEqual(h.status(contexts[0]),{dirty:false,busy:false});
  assert.deepEqual(h.status({type:'traverse',to:'/inicio'}),{dirty:true,busy:false});
  assert.equal(canLeave(),true);assert.equal(prompts,1);
  h.discardClosingRef.current=true;h.obsolete();assert.deepEqual(h.status(contexts[0]),{dirty:false,busy:false});
});

test('local cancel preserves refusal and clears form/ref only after one accepted decision', () => {
  const h = state(), c=cancellation(h);
  h.win.confirm=()=>assert.fail('Local cancellation must use the explicit dialog, not window.confirm');
  h.formRef.current = dirtyForm();
  const original=h.formRef.current;
  c.cancelForm();const first=c.discardIntentRef.current;
  assert.deepEqual(first,{form:original,scope:original.scope});
  c.cancelForm();assert.equal(c.discardIntentRef.current,first);assert.deepEqual(c.intents,[first]);
  c.keepProjectForm(first);
  assert.equal(c.discardIntentRef.current,null);
  assert.deepEqual(c.calls, []);
  assert.equal(c.formReturnFocus.current, null);
  assert.equal(h.formRef.current.draft.titulo, 'Borrador');
  assert.equal(c.discardClosingRef.current,true);
  c.cancelForm();assert.equal(c.discardIntentRef.current,null,'No reopen before closed state commits');
  assert.deepEqual(c.intents,[first,null]);
  c.commitClosed();assert.equal(c.discardClosingRef.current,false);
  c.cancelForm();const accepted=c.discardIntentRef.current;
  assert.notEqual(accepted,first);
  c.discardProjectForm(first);assert.equal(c.discardIntentRef.current,accepted);
  c.discardProjectForm(accepted);
  assert.equal(c.discardIntentRef.current,null);
  assert.equal(c.discardClosingRef.current,true);
  assert.deepEqual(c.calls, [null]);
  assert.equal(h.formRef.current, null);
  assert.deepEqual(c.formReturnFocus.current,{kind:original.kind,scope:original.scope});
  c.discardProjectForm(accepted);assert.deepEqual(c.calls,[null]);
});

test('reentrant discard decision cannot cancel a replacement form or queue focus for it', () => {
  const h = state(), c=cancellation(h), replacement = dirtyForm();
  h.formRef.current = dirtyForm();
  c.cancelForm();const intent=c.discardIntentRef.current;
  h.formRef.current=replacement;
  c.discardProjectForm(intent);
  assert.equal(c.discardIntentRef.current,null);
  assert.equal(h.formRef.current, replacement); assert.deepEqual(c.calls, []); assert.equal(c.formReturnFocus.current, null);
});

test('committed popstate restores project selection once, never asks again or rewrites history', () => {
  const h = state(), updates = [];
  const contexts = [];
  const pop = new Function('window', 'projectLocation', 'selectionRef', 'formRef', 'setForm', 'setMessage', 'setSelection', 'restoreListContext', 'publishDetail', `${popSource}\nreturn navigate;`)(
    h.win, projectLocation, h.selectionRef, h.formRef, value => updates.push(['form', value]), value => updates.push(['message', value]), value => updates.push(['selection', value]), href => contexts.push(href), value => updates.push(['detail', value]));
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
  assert.deepEqual(updates.find(([key]) => key === 'detail')[1], { status: 'loading', data: null, error: '' });
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
  assert.match(source, /function openForm\(kind, item\) \{\s*const scope=captureAction\(\);if\(!scope.current\(\)\)return;\s*if \(!canUseProjectObservation\(kind\)\) return;\s*if \(!canLeave\(\)\) return/);
  assert.match(source, /setForm\(null\); formRef.current = null;\s*if \(current.kind === "create"\) selectProject\(data.id\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|history\.go\(|history\.back\(/);
});
