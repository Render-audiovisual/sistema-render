import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest } from './captured-request.js';
import { createBrowserSessionState } from './browser-session-state.js';
import { createSessionView, sessionViewInputs } from './session-view.js';

// Execute the actual hook with injected React effect/ref primitives. This is
// binding/lifecycle coverage, not mounted React or native-browser acceptance.
const source = readFileSync(new URL('./use-scoped-request.js', import.meta.url),'utf8');
const file = ts.createSourceFile('hook.js',source,ts.ScriptTarget.Latest,true);
const declaration = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'useScopedRequest');
const hookSource = declaration.getText(file).replace(/^export\s+/, '');
function fixture() {
  const store = createBrowserSessionState();
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario:{id,usuario:'qa',nombre:'QA',rol:'admin'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43) });
  accept(7); let live=store.getSession(), view=createSessionView(sessionViewInputs(live));
  const refs=[];let cursor=0, effect,cleanup;const calls=[];
  const deps={useRef:initial=>refs[cursor++] ||= {current:initial},useCallback:fn=>fn,useLayoutEffect:fn=>{effect ||= fn;},
    getSesion:()=>live,useSessionView:()=>view,createCapturedRequest,apiRequest:async(url,options)=>{calls.push({url,options});return [];} };
  const hook=new Function(...Object.keys(deps),`return (${hookSource});`)(...Object.values(deps));
  const render=context=>{cursor=0;return hook(live,context);};
  return {render,calls,mount(){cleanup=effect();},unmount(){cleanup();},switch(){accept(8);live=store.getSession();view=createSessionView(sessionViewInputs(live));}};
}
test('layout lifetime prevents pre-mount/after-unmount dispatch and retains genuine cookie intent',async()=>{
  const f=fixture(), view=f.render('client1'), scope=view.capture();
  assert.equal(scope.current(),false);f.mount();await scope.request('/api/clientes');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.sessionIntent.session,view.view.session);
  assert.equal(f.calls[0].options.headers.Authorization,undefined);
  f.unmount();await assert.rejects(scope.request('/api/clientes'),error=>error.code==='session_binding_obsolete');
  assert.equal(f.calls.length,1);
});
test('client ABA invalidates old action while same mounted identity can finish busy cleanup',async()=>{
  const f=fixture(), first=f.render('client1');f.mount();const action=first.capture(),life=first.captureLifetime();
  assert.equal(action.current(),true);f.render('client2');const last=f.render('client1');
  assert.ok(last.epoch>first.epoch);assert.equal(action.current(),false);assert.equal(life.current(),true);
  await assert.rejects(action.request('/api/clientes'),error=>error.code==='session_binding_obsolete');assert.equal(f.calls.length,0);
});
test('new account invalidates actions and lifetime cleanup; exact unchanged context remains current',()=>{
  const f=fixture(),first=f.render('month1');f.mount();const action=first.capture(),life=first.captureLifetime();
  f.render('month1');assert.equal(action.current(),true);
  f.switch();f.render('month1');assert.equal(action.current(),false);assert.equal(life.current(),false);
});
