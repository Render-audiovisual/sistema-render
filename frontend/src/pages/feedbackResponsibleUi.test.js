import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as responsible from './feedbackResponsibleSelection.js';

const source=readFileSync(new URL('./Feedback.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Feedback.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),nodes=[];
(function walk(node){nodes.push(node);ts.forEachChild(node,walk);})(tree);
assert.deepEqual(tree.parseDiagnostics,[]);
function nodeFor(name){const node=nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name
  ||ts.isVariableDeclaration(n)&&n.name.getText(tree)===name);assert.ok(node,name);return ts.isVariableDeclaration(node)?node.initializer:node;}
function evaluate(node,deps={}){
  const compiled=ts.transpileModule(`const extracted=(${node.getText(tree).replace(/^export\s+/,'')});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  return Function(...Object.keys(deps),compiled+';return extracted;')(...Object.values(deps));
}
const emptyDraft=evaluate(nodeFor('emptyDraft')),feedbackResponsibles=evaluate(nodeFor('feedbackResponsibles'));
const business=evaluate(nodeFor('feedbackBusinessInput'));
const Picker=evaluate(nodeFor('FeedbackResponsiblePicker'),{React,...responsible});
const users=[{id:12,nombre:'Same Name',usuario:'first',activo:true},{id:13,nombre:'Same Name',usuario:'second',activo:true},
  {id:14,nombre:'Former',usuario:'inactive',activo:false}];
test('real picker distinguishes loading from unavailable catalog without clearing held IDs',()=>{
  const props={feedback:{responsable_ids:[13]},users:[],ready:false,onToggle(){}};
  const loading=renderToStaticMarkup(Picker({...props,loading:true}));
  assert.match(loading,/Cargando personas…/);assert.doesNotMatch(loading,/No está disponible el catálogo/);
  assert.match(loading,/Usuario #13/);assert.match(loading,/checked/);
  const failed=renderToStaticMarkup(Picker({...props,loading:false}));
  assert.match(failed,/No está disponible el catálogo/);assert.doesNotMatch(failed,/Cargando personas/);
});
function childrenOf(node,type){const found=[];function walk(value){if(!value||typeof value!=='object')return;
  if(value.type===type)found.push(value);React.Children.forEach(value.props?.children,walk);}
  walk(node);return found;}

test('real picker distinguishes homonyms by login/ID, checks only the explicit ID and delegates numeric ID',()=>{
  const calls=[],props={feedback:{responsable_ids:[13],responsables:['Same Name']},users,ready:true,onToggle:id=>calls.push(id)};
  const element=Picker(props),html=renderToStaticMarkup(element),inputs=childrenOf(element,'input');
  assert.match(html,/Same Name · first · #12/);assert.match(html,/Same Name · second · #13/);
  assert.deepEqual(inputs.map(input=>input.props.checked),[false,true]);inputs[1].props.onChange();assert.deepEqual(calls,[13]);
});
test('real legacy editor shows previous names and never infers checked IDs, even with matching catalog names',()=>{
  const element=Picker({feedback:{responsables:['Same Name']},users,ready:true,onToggle(){}}),html=renderToStaticMarkup(element);
  assert.match(html,/Responsables anteriores: Same Name/);assert.match(html,/Elegí las personas para cambiar la asignación/);
  assert.ok(childrenOf(element,'input').every(input=>input.props.checked===false));
});
test('real picker retains inactive/missing selected IDs and permits their explicit removal while catalog is unavailable',()=>{
  const calls=[],element=Picker({feedback:{responsable_ids:[14,15]},users,ready:false,onToggle:id=>calls.push(id)});
  const html=renderToStaticMarkup(element),inputs=childrenOf(element,'input');
  assert.match(html,/Former · inactive · #14 \(inactivo\)/);assert.match(html,/Usuario #15 \(no disponible\)/);
  const selected=inputs.filter(input=>input.props.checked);assert.equal(selected.length,2);
  for(const input of selected){assert.notEqual(input.props.disabled,true);input.props.onChange();}
  assert.deepEqual(calls,[14,15]);assert.ok(inputs.filter(input=>!input.props.checked).every(input=>input.props.disabled));
});
test('new draft has explicit empty IDs; real edit handler removes inherited defaults only for legacy notes',()=>{
  assert.deepEqual(emptyDraft('clients').feedback.responsable_ids,[]);
  for(const feedback of [{responsables:['Same Name']},{responsable_ids:[13],responsables:['Same Name']}]){
    const note={id:7,section:'clients',feedback},before=structuredClone(note);let edited;
    const deps={lock:{current:false},mutationRef:{current:null},recordSelected(){},section:'clients',emptyDraft,feedbackResponsibles,
      setDraft:value=>{edited=value;},setSelected(){},setBaseline(){},setError(){},setConflict(){},setDuplicates(){}};
    evaluate(nodeFor('editNote'),deps)(note);
    assert.equal(Object.hasOwn(edited.feedback,'responsable_ids'),Object.hasOwn(feedback,'responsable_ids'));
    if(feedback.responsable_ids)assert.deepEqual(edited.feedback.responsable_ids,[13]);assert.deepEqual(note,before);
  }
});
test('actual business projection clones IDs and omits provenance, preserving optional presence',()=>{
  const raw={responsable_ids:[13],responsables:['Snapshot'],origen:'manual',confirmado_por_id:7};
  const projected=business(raw);assert.deepEqual(projected,{responsable_ids:[13],responsables:['Snapshot']});
  projected.responsable_ids[0]=12;assert.deepEqual(raw.responsable_ids,[13]);assert.equal(Object.hasOwn(business({responsables:['Legacy']}),'responsable_ids'),false);
});
test('actual numeric toggle replaces labels only after human action and fences retained callbacks to the original draft',()=>{
  const original={feedback:{responsables:['Same Name']}};let live=original;
  const deps={draft:original,lock:{current:false},mutationRef:{current:null},users,...responsible,
    setDraft:update=>{live=update(live);},setError:()=>assert.fail('valid selection')};
  const toggle=evaluate(nodeFor('toggleResponsible'),deps);toggle(13);assert.deepEqual(live.feedback.responsable_ids,[13]);
  const replacement={feedback:{responsable_ids:[12]}};live=replacement;toggle(13);assert.equal(live,replacement);
  deps.lock.current=true;live=original;toggle(13);assert.equal(live,original);
});
test('real save-button guard denies empty explicit IDs despite old text, but permits unrelated legacy/inactive-ID edits',()=>{
  const button=nodes.find(n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==='button'
    &&n.attributes.properties.some(a=>a.name?.text==='type'&&a.initializer?.text==='submit')
    &&n.attributes.properties.some(a=>a.name?.text==='disabled'&&a.initializer.getText(tree).includes('responsibleSelectionReady')));
  assert.ok(button);const disabled=button.attributes.properties.find(a=>a.name?.text==='disabled').initializer.expression;
  const cases=[
    [{feedback:{responsable_ids:[],responsables:['Old text']}},true],
    [{id:7,feedback:{responsable_ids:[],responsables:['Old text']}},true],
    [{feedback:{responsables:['Legacy but new']}},true],
    [{id:7,feedback:{responsables:['Legacy']}},false],
    [{id:7,feedback:{responsables:[]}},true],
    [{id:7,feedback:{responsable_ids:[14]}},false],
    [{feedback:{responsable_ids:[13]}},false],
  ];
  for(const [draft,expected]of cases){
    const ready=evaluate(nodeFor('responsibleSelectionReady'),{draft,feedbackResponsibles});
    assert.equal(evaluate(disabled,{conflict:false,mutation:{locked:false},responsibleSelectionReady:ready}),expected);
    assert.equal(evaluate(disabled,{conflict:true,mutation:{locked:false},responsibleSelectionReady:ready}),true);
    assert.equal(evaluate(disabled,{conflict:false,mutation:{locked:true},responsibleSelectionReady:ready}),true);
  }
});
test('actual submit retains absence for a legacy unrelated edit and carries explicit IDs for a new note',async()=>{
  for(const draft of [
    {id:7,updated_at:'2026-10-22T12:00:00.123000Z',titulo:'Title',contenido:'Body',categoria:'general',feedback:{cliente:'Client',responsables:['Legacy']}},
    {titulo:'Title',contenido:'Body',categoria:'general',feedback:{cliente:'Client',responsables:['Same Name'],responsable_ids:[13]}},
  ]){
    const writes=[],deps={draft,section:'clients',lock:{current:false},mutationRef:{current:null},conflict:false,feedbackResponsibles,
      feedbackBusinessInput:business,runMutation:callback=>callback({start:(...args)=>{writes.push(args);}})};
    await evaluate(nodeFor('persistDraft'),deps)();assert.equal(writes.length,1);
    assert.equal(Object.hasOwn(writes[0][0].fields.feedback,'responsable_ids'),Object.hasOwn(draft.feedback,'responsable_ids'));
    if(!draft.id)assert.deepEqual(writes[0][0].fields.feedback.responsable_ids,[13]);
  }
});
