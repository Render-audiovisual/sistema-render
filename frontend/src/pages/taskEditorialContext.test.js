import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { isTaskEditorialContext } from '../features/render-os/utils/task-editorial-context.js';

const source=ts.createSourceFile('WorkspaceReadOnly.jsx',readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const found=[];function visit(n){if(predicate(n))found.push(n);ts.forEachChild(n,visit);}visit(root);return found;}
const owner=name=>source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
function evaluate(node,deps={}){const js=ts.transpileModule(`const result=(${node.getText(source)});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;return Function('React',...Object.keys(deps),`${js};return result;`)(React,...Object.values(deps));}
const initializer=(scope,name)=>nodes(owner(scope),n=>ts.isVariableDeclaration(n)&&n.name.getText(source)===name)[0].initializer;
const task=extra=>({id:7,revision:4,estado:'en_revision',tipo_tarea:'desarrollo',subtipo:'web',cliente_id:2,...extra});

test('explicit non-editorial types/subtypes exclude editorial presentation without guessing from titles or people',()=>{
  for(const tipo_tarea of ['desarrollo','administracion','Administración'])assert.equal(isTaskEditorialContext(task({tipo_tarea,subtipo:null})),false);
  for(const subtipo of ['web','página web','pagina_web','landing','landing-page','chatbot','chatbots','mantenimiento','automatización'])assert.equal(isTaskEditorialContext(task({tipo_tarea:'diseno',subtipo})),false,subtipo);
  assert.equal(isTaskEditorialContext(task({titulo:'Reel para Instagram',asignado_a:'Community',responsable_publicacion_id:5,propiedades_extra:{objetivo_periodo:'2026-10',objetivo_clave:'monthly',responsable_publicacion:'Publicador'}})),false);
});
test('valid explicit editorial IDs override historical type contradictions; malformed IDs never confer context',()=>{
  for(const key of ['publicacion_id','historia_id','objetivo_id','objetivo_pieza_id']){
    assert.equal(isTaskEditorialContext(task({[key]:23})),true,key);
    for(const value of [0,-1,'23',true,1.2,2147483648,{},[]])assert.equal(isTaskEditorialContext(task({[key]:value})),false,key);
  }
  for(const key of ['objetivo_id','objetivo_pieza_id'])assert.equal(isTaskEditorialContext(task({propiedades_extra:{[key]:23}})),true);
});
test('design/reels/carousels/stories and unknown legacy tasks retain compatible editorial controls',()=>{
  for(const [tipo_tarea,subtipo] of [['diseno','carrusel'],['edicion','reel'],['edicion','video'],['diseno','historia'],['diseno','flyer'],['custom','legacy'],[undefined,undefined]]){
    const row=task({tipo_tarea,subtipo});const before=structuredClone(row);assert.equal(isTaskEditorialContext(row),true);assert.deepEqual(row,before);
  }
});
test('actual GoalTaskLink JSX excludes non-editorial monthly UI but keeps explicit publications and existing domain exclusions',()=>{
  const file=ts.createSourceFile('GoalTaskLink.jsx',readFileSync(new URL('../features/render-os/GoalTaskLink.jsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length,0);
  const node=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='GoalTaskLink');
  const js=ts.transpileModule(`const component=(${node.getText(file).replace(/^export\s+/, '')});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  const component=Function('React','useState','useRef','useEffect','isTaskEditorialContext',`${js};return component;`)(React,()=>[null,()=>{}],value=>({current:value}),()=>{},isTaskEditorialContext);
  for(const row of [task(),task({tipo_tarea:'administracion'}),task({historia_id:3}),task({tipo_tarea:'produccion'})])assert.equal(component({task:row,canManage:true}),null);
  for(const row of [task({publicacion_id:3}),task({tipo_tarea:'diseno',subtipo:'carrusel'}),task({tipo_tarea:'unknown',subtipo:null})])assert.match(renderToStaticMarkup(component({task:row,canManage:true})),/Objetivo del mes/);
  assert.equal(component({task:task({publicacion_id:3}),canManage:false}),null);
});
test('actual approval JSX is neutral with no publisher controls for development, while editorial paths remain available',()=>{
  assert.equal(source.parseDiagnostics.length,0);
  const expression=nodes(owner('TaskDetail'),n=>ts.isJsxExpression(n)&&n.expression?.getText(source).startsWith('canApproveForOriana && <section'))[0].expression;
  for(const row of [task(),task({publicacion_id:23}),task({tipo_tarea:'edicion',subtipo:'reel'})]){
    const editorialContext=isTaskEditorialContext(row);
    const element=evaluate(expression,{canApproveForOriana:true,editorialContext,usesEditingReview:false,approving:false,saving:false,deliveryBusy:false,deliveryDirty:false,mayApproveObservedDelivery:true,publicationResponsible:null,users:[],selectedPublisher:null,approveForOriana:()=>{}});
    const html=renderToStaticMarkup(element);
    assert.match(html,/Aprobar revisión/);
    if(editorialContext){assert.match(html,/Publica \(opcional\)/);assert.match(html,/Aprobar y enviar/);}else{assert.doesNotMatch(html,/Publica|publica|Aprobar y enviar|<select/);assert.match(html,/Después se podrá finalizar/);}
  }
});
test('actual approved banner ignores stale publication-person labels for a non-editorial task',()=>{
  const expression=nodes(owner('TaskDetail'),n=>ts.isJsxExpression(n)&&n.expression?.getText(source).startsWith('task.estado === "aprobada" && <div'))[0].expression;
  for(const editorialContext of [false,true]){
    const html=renderToStaticMarkup(evaluate(expression,{task:task({estado:'aprobada'}),editorialContext,metadata:{revision_aprobada_por:'Revisor',responsable_publicacion:'Persona histórica'}}));
    if(editorialContext)assert.match(html,/Persona histórica se encarga de publicarla/);else{assert.doesNotMatch(html,/Persona histórica|publicarla/);assert.match(html,/Lista para finalizar/);}
  }
});
test('actual approval handler blocks imperative with-publisher bypass, retains neutral approval and strict editing observation',async()=>{
  for(const row of [task(),task({publicacion_id:23}),task({tipo_tarea:'edicion',subtipo:'reel',propiedades_extra:{workspace:'render_os'}})]){
    const calls=[],editingReview={task:{revision:4},latestDelivery:{id:'delivery'}};
    const deps={task:row,isTaskEditorialContext,captureRequest:()=>({current:()=>true}),canApproveForOriana:true,approvalPendingRef:{current:false},approving:false,saving:false,deliveryBusy:false,deliveryDirty:false,mayApproveObservedDelivery:true,selectedPublisher:{id:9},usesEditingReview:row.tipo_tarea==='edicion',editingReview,onApprove:async(...args)=>calls.push(args),setApproving(){},setReviewAcknowledged(){},setReviewError(){}};
    const approve=evaluate(initializer('TaskDetail','approveForOriana'),deps);
    const editorial=isTaskEditorialContext(row);assert.equal(await approve(true),editorial);assert.equal(calls.length,editorial?1:0);
    assert.equal(await approve(false),true);assert.equal(calls.at(-1)[1],undefined);
    if(deps.usesEditingReview)assert.deepEqual(calls.at(-1)[2],{revision:4,deliveryId:'delivery'});
    deps.mayApproveObservedDelivery=false;assert.equal(await evaluate(initializer('TaskDetail','approveForOriana'),deps)(true),false);
  }
});
test('actual parent approval callback independently blocks publisher dispatch for non-editorial tasks but allows ordinary approval',async()=>{
  const calls=[];
  const approve=evaluate(initializer('WorkspaceReadOnlyPage','approveTask'),{
    isTaskEditorialContext,captureRequest:()=>({assertCurrent(){},current:()=>true}),users:[{id:9,rol:'community'}],
    updateTask:async(...args)=>{calls.push(['update',...args]);},isSessionFailure:()=>false,notify:()=>{},markReviewQueueStale:()=>{},
  });
  await assert.rejects(approve(task(),9),/sin responsable de publicación/);assert.deepEqual(calls,[]);
  await approve(task());assert.deepEqual(calls,[['update',7,{estado:'aprobada'},'aprobó la revisión de la tarea',4]]);
});
