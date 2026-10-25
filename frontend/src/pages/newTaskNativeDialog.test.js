import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {isNewTaskDraftDirty} from '../features/render-os/utils/task-view-state.js';
import {createTaskCreationAttempt} from './taskCreationAttempt.js';

const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length,0);
const owner=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='NewTaskModal');assert.ok(owner);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(root);return result;}
const named=name=>nodes(owner,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)[0]?.initializer;
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
const opening=nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='Modal')[0];assert.ok(opening);
const attr=(node,key)=>node.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.getText(tree)===key);
const expression=(node,key)=>attr(node,key)?.initializer?.expression?.getText(tree);
const key='11111111-2222-4333-8444-555555555555';
const draft=()=>({titulo:'QA task',asignado_a_id:7,colaborador_ids:[],tipo_tarea:'desarrollo',estado:'pendiente'});
const ack=()=>({version:1,operation:{request_id:key,task_id:21,replayed:false},task:{id:21,revision:1,titulo:'QA task',
  propiedades_extra:{workspace:'render_os'},asignado_a_id:7,colaborador_ids:[]}});

test('actual NewTaskModal opts into native chrome-free kernel with scoped backdrop, naming, busy and custom focus ref',()=>{
  assert.ok(attr(opening,'native'));assert.equal(attr(opening,'native').initializer,undefined);
  assert.equal(expression(opening,'chrome'),'false');assert.equal(expression(opening,'closeDisabled'),'saving');
  assert.ok(attr(opening,'closeOnBackdropClick'));assert.equal(expression(opening,'onClose'),'closeModal');
  assert.equal(expression(opening,'initialFocusRef'),'newTaskCloseRef');
  assert.equal(attr(opening,'overlayClassName').initializer.text,'ros-drawer-backdrop ros-modal-backdrop');
  assert.equal(attr(opening,'overlayAriaLabel').initializer.text,'Nueva tarea');
  const imports=tree.statements.filter(ts.isImportDeclaration);
  assert.ok(imports.some(node=>node.moduleSpecifier.text==='../components/Modal.jsx'
    &&node.importClause.namedBindings.elements.some(binding=>binding.name.text==='Modal')));
  assert.equal(named('newTaskCloseRef').getText(tree),'useRef(null)');
});

test('unchanged custom section/form owns one explicit close control, no competing autofocus or backdrop close handler',()=>{
  const buttons=nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='button');
  const close=buttons.filter(node=>expression(node,'ref')==='newTaskCloseRef');assert.equal(close.length,1);
  assert.equal(attr(close[0],'aria-label').initializer.text,'Cerrar nueva tarea');
  assert.equal(attr(close[0],'className').initializer.text,'modal-close');
  assert.deepEqual(evaluate(attr(close[0],'style').initializer.expression,{}),
    {color:'var(--render-ink)',background:'transparent',border:0});
  assert.equal(attr(close[0],'type').initializer.text,'button');assert.equal(expression(close[0],'onClick'),'closeModal');
  assert.equal(nodes(owner,node=>ts.isJsxAttribute(node)&&node.name.getText(tree)==='autoFocus').length,0);
  const sections=nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='section');
  assert.equal(attr(sections[0],'className').initializer.text,'ros-modal ros-quick-task-modal');
  assert.equal(expression(sections[0],'onClick'),'(event) => event.stopPropagation()');
  const forms=nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='form');
  assert.equal(forms.length,1);assert.equal(expression(forms[0],'onSubmit'),'submit');
  assert.equal(nodes(owner,node=>ts.isJsxAttribute(node)&&['onMouseDown','onKeyDown'].includes(node.name.getText(tree))).length,0);
});

test('actual close guard refuses busy, preserves uncertain/dirty state on cancel and closes only with explicit discard',()=>{
  for(const [busy,locked,dirty] of [[true,false,false],[true,true,true],[false,true,false],[false,false,true],[false,false,false]]) {
    const held=draft();if(!dirty){held.titulo='';held.tipo_tarea='';}held.asignado_a_id=null;
    const creation={snapshot:{busy,locked}},before=structuredClone({held,snapshot:creation.snapshot});
    let asks=0,closes=0,answer=false;const messages=[];
    const close=evaluate(named('closeModal'),{creation,draft:held,isNewTaskDraftDirty,
      window:{confirm(message){asks++;messages.push(message);return answer;}},onClose(){closes++;}});
    close();assert.equal(closes,!busy&&!locked&&!dirty?1:0);
    assert.equal(asks,!busy&&(locked||dirty)?1:0);
    if(locked&&!busy)assert.match(messages[0],/Salir no cancela la creación.*no sobrevive a una recarga/);
    answer=true;close();assert.equal(closes,busy?0:!locked&&!dirty?2:1);
    assert.deepEqual({held,snapshot:creation.snapshot},before);
  }
});

test('actual submit never starts another creation when model is locked or busy',()=>{
  for(const snapshot of [{locked:true,busy:false},{locked:false,busy:true},{locked:true,busy:true}]) {
    let prevented=0;
    const submit=evaluate(named('submit'),{creation:{snapshot},runCreation:()=>assert.fail('Must retain the existing intent')});
    submit({preventDefault(){prevented++;}});assert.equal(prevented,1);
  }
});

test('creation factory remains one real shared attempt per instance and recovery bypasses the locked fieldset',()=>{
  const state=nodes(owner,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='[creation]')[0];
  assert.ok(state);assert.match(state.initializer.getText(tree),/^useState\(\(\)=>createTaskCreationAttempt/);
  const code=owner.getText(tree);
  assert.match(code,/send:\(body,options\)=>createCallback.current\(body,options\)/);
  assert.match(code,/runCreation\(\(\)=>creation.verify\(\)\)/);assert.match(code,/runCreation\(\(\)=>creation.retry\(\)\)/);
  const fieldsets=nodes(owner,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='fieldset');
  assert.equal(fieldsets.length,1);assert.equal(expression(fieldsets[0].openingElement,'disabled'),'creationState.locked||saving');
  assert.doesNotMatch(fieldsets[0].getText(tree),/creation\.verify|creation\.retry/);
  assert.doesNotMatch(code,/fetch\(|apiRequest\(|localStorage|sessionStorage/);
});

test('actual runCreation adopts a real UUID attempt once and never delivers late acceptance after scope retirement',async()=>{
  for(const retire of [false,true]) {
    let resolve,active=true,created=0,sends=0;
    const response=new Promise(yes=>{resolve=yes;});
    const guard={current:()=>active},completedRef={current:false};
    const creation=createTaskCreationAttempt({capture:()=>guard,randomUUID:()=>key,send:async()=>{sends++;return response;}});
    const run=evaluate(named('runCreation'),{captureRequest:()=>guard,completedRef,creation,onCreated(task){created++;assert.equal(task.id,21);}});
    const pending=run(()=>creation.start(draft()));assert.equal(sends,1);
    if(retire)active=false;resolve(ack());await pending;
    assert.equal(created,retire?0:1);assert.equal(completedRef.current,!retire);
    await run(()=>creation.start(draft()));assert.equal(sends,1);assert.equal(created,retire?0:1);
  }
});

test('actual navigation getter keeps unresolved empty attempts dirty and pending attempts busy',()=>{
  const call=nodes(owner,node=>ts.isCallExpression(node)&&node.expression.getText(tree)==='useNavigationGuard')[0];assert.ok(call);
  const creation={snapshot:{locked:true,busy:false}},completedRef={current:false};
  const getter=evaluate(call.arguments[0],{creation,completedRef,draft:{},isNewTaskDraftDirty});
  assert.deepEqual(getter(),{dirty:true,busy:false});creation.snapshot.busy=true;
  assert.deepEqual(getter(),{dirty:true,busy:true});completedRef.current=true;
  assert.deepEqual(getter(),{dirty:false,busy:false});
});
