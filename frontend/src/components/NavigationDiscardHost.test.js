import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createNavigationDiscardController} from './navigationDiscardController.js';

// Execute actual callbacks/effects with an isolated dialog double. Not a React
// mount or proof of the browser's native focus containment/inert top layer.
const source=readFileSync(new URL('./NavigationDiscardHost.jsx',import.meta.url),'utf8');
const css=readFileSync(new URL('./NavigationDiscardHost.css',import.meta.url),'utf8');
const file=ts.createSourceFile('NavigationDiscardHost.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const nodes=(root,predicate)=>{const result=[];const visit=node=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit)};visit(root);return result};
const fn=name=>file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
const evaluate=(node,deps)=>new Function(...Object.keys(deps),`return (${node.getText(file).replace(/^export /,'')});`)(...Object.values(deps));
const modal=fn('NavigationDiscardModal'),finishNode=nodes(modal,node=>ts.isFunctionDeclaration(node)&&node.name?.text==='finish')[0];
const modalEffect=nodes(modal,node=>ts.isCallExpression(node)&&node.expression.getText(file)==='useLayoutEffect')[0].arguments[0];
function fixture({hiddenInvoker=false,showFails=false,focusFails=false}={}){
 let lifetime={},current=true;const events=[];
 const element=(name,hidden=false)=>({isConnected:true,disabled:false,matches:()=>false,closest:()=>hidden?{}:null,getClientRects:()=>hidden?[]:[{}],focus:options=>{events.push([name,options]);if(focusFails&&name==='invoker')throw Error('Detached')}});
 const invoker=element('invoker',hiddenInvoker),fallback=element('fallback'),keep=element('keep');
 const controller=createNavigationDiscardController({readLifetime:()=>lifetime,getDocument:()=>({activeElement:invoker,querySelector:()=>fallback})});
 const lease=controller.activate(lifetime),host=controller.attachHost(),abort=new AbortController();
 const pending=controller.request({signal:abort.signal,isCurrent:()=>current}),request=controller.getSnapshot();
 class Dialog extends EventTarget{open=false;isConnected=true;showModal(){events.push('showModal');if(showFails)throw Error('unsupported');this.open=true;}close(){events.push('close');this.open=false;this.dispatchEvent(new Event('close'));}}
 const dialog=new Dialog(),sessionRef={current:null},handledRef={current:false};
 const deps={controller,request,sessionRef,handledRef,dialogRef:{current:dialog},keepRef:{current:keep}};
 deps.finish=evaluate(finishNode,deps);const effect=evaluate(modalEffect,deps);
 return{controller,request,pending,lease,host,abort,events,dialog,deps,effect,finish:deps.finish,stale:()=>{current=false},changeLifetime:()=>{lifetime={}},element};
}
test('hook root has no state or external-store subscription; only child host subscribes',()=>{
 assert.equal(file.parseDiagnostics.length,0);
 const root=fn('useNavigationConfirmation'),calls=nodes(root,ts.isCallExpression).map(node=>node.expression.getText(file));
 assert.ok(calls.includes('useRef'));assert.ok(calls.includes('useLayoutEffect'));assert.equal(calls.includes('useState'),false);assert.equal(calls.includes('useSyncExternalStore'),false);
 assert.ok(nodes(fn('NavigationDiscardHost'),ts.isCallExpression).some(node=>node.expression.getText(file)==='useSyncExternalStore'));
 assert.match(root.getText(file),/request:requestRef.current/);assert.match(root.getText(file),/latestLifetime.current=lifetime/);
 assert.doesNotMatch(source,/window\.confirm|history\.|localStorage|sessionStorage|\.inert\s*=|fetch\(|createPortal/);
});
test('actual root setup/cleanup activates current lease while stable request dispatches to fresh owner',async()=>{
 const root=fn('useNavigationConfirmation'),effectNode=nodes(root,node=>ts.isCallExpression(node)&&node.expression.getText(file)==='useLayoutEffect')[0];
 const lifetime={},controller=createNavigationDiscardController({readLifetime:()=>lifetime,getDocument:()=>null});controller.attachHost();
 const effect=evaluate(effectNode.arguments[0],{controller,lifetime});
 const assignment=nodes(root,node=>ts.isBinaryExpression(node)&&node.left.getText(file)==='requestRef.current')[0];
 const request=evaluate(assignment.right,{controllerRef:{current:controller}}),intent=()=>({signal:new AbortController().signal,isCurrent:()=>true});
 assert.equal(await request(intent()),false);const old=effect(),pending=request(intent());old();assert.equal(await pending,false);
 const cleanup=effect(),next=request(intent());old();assert.ok(controller.getSnapshot());controller.resolve(controller.getSnapshot(),true);assert.equal(await next,true);cleanup();assert.equal(await request(intent()),false);
});
test('actual host unmount detaches its lease and denies without unmounting the root hook',async()=>{
 const lifetime={},controller=createNavigationDiscardController({readLifetime:()=>lifetime});controller.activate(lifetime);
 const effect=nodes(fn('NavigationDiscardHost'),node=>ts.isCallExpression(node)&&node.expression.getText(file)==='useLayoutEffect')[0];
 const setup=evaluate(effect.arguments[0],{controller}),cleanup=setup(),pending=controller.request({signal:new AbortController().signal,isCurrent:()=>true});
 cleanup();assert.equal(await pending,false);assert.equal(await controller.request({signal:new AbortController().signal,isCurrent:()=>true}),false);
 const nextCleanup=setup(),next=controller.request({signal:new AbortController().signal,isCurrent:()=>true});controller.resolve(controller.getSnapshot(),false);assert.equal(await next,false);nextCleanup();
});
test('native modal setup focuses keep-editing; cancel restores usable invoker and resolves false once',async()=>{
 const f=fixture(),cleanup=f.effect();assert.deepEqual(f.events,['showModal',['keep',{preventScroll:true}]]);assert.equal(f.dialog.open,true);
 f.finish(false);f.finish(true);assert.equal(await f.pending,false);assert.equal(f.dialog.open,false);assert.equal(f.events.filter(event=>Array.isArray(event)&&event[0]==='invoker').length,1);cleanup();
});
test('mobile hidden/inert invoker falls back to captured menu toggle after keep-editing',async()=>{
 const f=fixture({hiddenInvoker:true}),cleanup=f.effect();f.finish(false);assert.equal(await f.pending,false);assert.ok(f.events.some(event=>Array.isArray(event)&&event[0]==='fallback'));assert.equal(f.events.some(event=>Array.isArray(event)&&event[0]==='invoker'),false);cleanup();
});
test('explicit discard alone returns true, closes modal once and never explicitly restores invoker focus',async()=>{
 const f=fixture(),cleanup=f.effect();f.finish(true);f.finish(true);f.finish(false);assert.equal(await f.pending,true);assert.equal(f.events.filter(event=>event==='close').length,1);assert.equal(f.events.some(event=>Array.isArray(event)&&['invoker','fallback'].includes(event[0])),false);cleanup();
});
test('stale signal/account-route predicate at click cannot approve or transfer focus',async()=>{
 for(const change of ['stale','changeLifetime']){const f=fixture(),cleanup=f.effect();f[change]();f.finish(true);assert.equal(await f.pending,false);assert.equal(f.events.some(event=>Array.isArray(event)&&['invoker','fallback'].includes(event[0])),false);cleanup();}
});
test('abort and cleanup deny pending without focus/callback resurrection',async()=>{
 const f=fixture(),cleanup=f.effect();f.abort.abort();assert.equal(await f.pending,false);cleanup();f.finish(true);assert.equal(f.events.some(event=>Array.isArray(event)&&['invoker','fallback'].includes(event[0])),false);assert.equal(f.controller.getSnapshot(),null);
});
test('effect replay closes/reopens owned native modal; queued old close while reopened does not cancel',async()=>{
 const f=fixture(),old=f.effect();old();const cleanup=f.effect();f.dialog.dispatchEvent(new Event('close'));assert.ok(f.controller.getSnapshot());assert.equal(f.dialog.open,true);assert.equal(f.events.filter(event=>event==='showModal').length,2);f.finish(false);assert.equal(await f.pending,false);cleanup();
});
test('failed native showModal, external close and failed focus restoration never grant discard',async()=>{
 const failed=fixture({showFails:true}),cleanupFailed=failed.effect();assert.equal(await failed.pending,false);cleanupFailed();
 const external=fixture(),cleanupExternal=external.effect();external.dialog.close();assert.equal(await external.pending,false);cleanupExternal();
 const focus=fixture({focusFails:true}),cleanupFocus=focus.effect();focus.finish(false);assert.equal(await focus.pending,false);cleanupFocus();
});
test('actual Escape/cancel handlers stop parent handlers and choose keep-editing, never consent',()=>{
 const opening=nodes(modal,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(file)==='dialog')[0];
 const attribute=name=>opening.attributes.properties.find(node=>node.name?.getText(file)===name).initializer.expression;
 for(const name of ['onCancel','onKeyDownCapture']){const actions=[],handler=evaluate(attribute(name),{finish:value=>actions.push(value)}),event={key:'Escape',preventDefault:()=>actions.push('prevent'),stopPropagation:()=>actions.push('stop')};handler(event);assert.deepEqual(actions,['prevent','stop',false]);}
 assert.match(modal.getText(file),/aria-modal="true" aria-labelledby=\{titleId\} aria-describedby=\{descriptionId\}/);assert.match(modal.getText(file),/autoFocus onClick=\{\(\)=>finish\(false\)\}/);assert.equal((modal.getText(file).match(/finish\(true\)/g)||[]).length,1);
});
test('actual Tab handler wraps both modal boundaries without transferring consent or escaping to body',()=>{
 const opening=nodes(modal,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(file)==='dialog')[0];
 const expression=opening.attributes.properties.find(node=>node.name?.getText(file)==='onKeyDownCapture').initializer.expression;
 const doc={activeElement:null},trace=[],dialog={open:true,ownerDocument:doc},sessionRef={current:{active:true}},handledRef={current:false};let current=true;
 const button=name=>{const element={isConnected:true,disabled:false,matches:()=>false,getClientRects:()=>[{}],focus:options=>{doc.activeElement=element;trace.push(['focus',name,options]);}};return element;};
 const keep=button('keep'),leave=button('leave'),body={};
 const handler=evaluate(expression,{finish:()=>assert.fail('Tab is never consent/cancel'),dialogRef:{current:dialog},keepRef:{current:keep},leaveRef:{current:leave},sessionRef,handledRef,controller:{isCurrent:()=>current},request:{}});
 const press=(active,shiftKey=false,extra={})=>{trace.length=0;doc.activeElement=active;handler({key:'Tab',shiftKey,...extra,preventDefault:()=>trace.push('prevent'),stopPropagation:()=>trace.push('stop')});};
 for(const [active,shift,target,name] of [[leave,false,keep,'keep'],[keep,true,leave,'leave'],[body,false,keep,'keep'],[body,true,leave,'leave']]){
   press(active,shift);assert.equal(doc.activeElement,target);assert.deepEqual(trace,['prevent','stop',['focus',name,{preventScroll:true}]]);
 }
 press(keep,false);assert.deepEqual(trace,[],'Interior forward movement stays native');assert.equal(doc.activeElement,keep);
 press(leave,true);assert.deepEqual(trace,[],'Interior reverse movement stays native');assert.equal(doc.activeElement,leave);
 for(const modifier of ['altKey','ctrlKey','metaKey']){press(leave,false,{[modifier]:true});assert.deepEqual(trace,[],'Browser/OS shortcuts are not trapped');}
 for(const deactivate of [()=>{sessionRef.current.active=false},()=>{handledRef.current=true},()=>{dialog.open=false},()=>{current=false}]){
   sessionRef.current.active=true;handledRef.current=false;dialog.open=true;current=true;deactivate();press(leave);assert.deepEqual(trace,[],'Obsolete/closed/handled dialog does not transfer focus');
 }
});
test('cleanup never explicitly focuses, calls finish, resolves consent or mutates global inert',()=>{
 const cleanup=nodes(modalEffect,node=>ts.isReturnStatement(node)&&node.expression&&ts.isArrowFunction(node.expression))[0].expression.getText(file);
 assert.match(cleanup,/session.active=false/);assert.match(cleanup,/removeEventListener/);assert.doesNotMatch(cleanup,/\.focus\(|finish\(|controller.resolve|\.inert\s*=/);
});
test('dialog content is generic and styles use scoped light tokens, mobile bounds, focus and 44px controls',()=>{
 assert.doesNotMatch(modal.getText(file),/request\.(?:href|url|lifetime)|dangerouslySetInnerHTML/);assert.match(modal.getText(file),/Seguir editando/);assert.match(modal.getText(file),/Descartar y salir/);
 for(const token of ['surface','ink','font','line','accent','accent-ink','danger'])assert.ok(css.includes(`var(--render-${token})`));
 assert.match(css,/min-height:44px/);assert.match(css,/max-height:calc\(100dvh - 32px\)/);assert.match(css,/::backdrop/);assert.match(css,/:focus-visible/);assert.match(css,/prefers-reduced-motion/);
 for(const rule of css.match(/[^{}]+(?=\{)/g)||[]){if(rule.trim().startsWith('@'))continue;for(const selector of rule.split(','))assert.match(selector.trim(),/^\.render-navigation-discard/);}
 assert.doesNotMatch(css,/!important|@import|@font-face|:root|\bbody\s*\{/);
});
test('leaving warning never implies rollback of an already committed operation with a lost response',()=>{
 const description=nodes(modal,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(file)==='p')[0];
 assert.ok(description);
 assert.match(description.getText(file),/Salir no cancela lo que ya se haya guardado\./);
 assert.doesNotMatch(description.getText(file),/se (?:cancelará|eliminará|deshará).*guardad/);
});
