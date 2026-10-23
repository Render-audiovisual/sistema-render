import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Actual component SSR + extracted callbacks/AST. No mounted dialog/focus,
// browser backdrop/Escape, network, persistence or native top-layer claims.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function parse(source) { const tree=ts.createSourceFile('contract.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);assert.equal(tree.parseDiagnostics.length,0);return tree; }
const source=read('./PersonalLists.jsx'),tree=parse(source),modalTree=parse(read('../components/Modal.jsx'));
function find(root,predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(root);return result;}
const fn=(name,file=tree)=>{const node=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,name);return node;};
function evaluate(code,bindings={}){const js=ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;return Function('React','useState','useRef','useEffect',...Object.keys(bindings),`${js};return result;`)(React,React.useState,React.useRef,React.useEffect,...Object.values(bindings));}
const Modal=evaluate(`const result=(${fn('Modal',modalTree).getText().replace(/^export\s+/,'')});`);
const systemDeclaration=tree.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>item.name.getText()==='SYSTEM_TEMPLATES'));assert.ok(systemDeclaration);
const SYSTEM_TEMPLATES=evaluate(`${['uid','newTableContent','newBlock'].map(name=>fn(name).getText()).join('\n')}\n${systemDeclaration.getText()}\nconst result=SYSTEM_TEMPLATES;`);
const TemplateDialog=evaluate(`const result=(${fn('TemplateDialog').getText()});`,{Modal,SYSTEM_TEMPLATES});
const NameTemplateDialog=evaluate(`const result=(${fn('NameTemplateDialog').getText()});`,{Modal});
const attr=(node,name)=>node.attributes.properties.find(node=>ts.isJsxAttribute(node)&&node.name.text===name);
function childrenOfType(element,type){const result=[];function visit(children){React.Children.forEach(children,child=>{if(!React.isValidElement(child))return;if(child.type===type)result.push(child);visit(child.props.children);});}visit(element.props.children);return result;}
const custom=Object.freeze({id:'73',titulo:'Mi plantilla QA',emoji:'📝',bloques:[]});
const properties=(root,name)=>find(root,node=>ts.isVariableDeclaration(node)&&node.name.getText()===name);

test('template chooser renders real native Modal with default templates and preserves exact choice/delete callbacks',()=>{
  assert.deepEqual(SYSTEM_TEMPLATES.map(row=>row.key),['blank','week','tasks','day']);
  const choices=[],deleted=[];
  const element=TemplateDialog({templates:[custom],creating:false,onChoose:value=>choices.push(value),onDelete:value=>deleted.push(value),onClose:()=>{}});
  assert.equal(element.type,Modal);assert.equal(element.props.native,true);assert.equal(element.props.closeOnBackdropClick,true);
  assert.equal(element.props.overlayAriaLabel,'Nueva página');assert.equal(element.props.className,'personal-template-modal');assert.equal(element.props.closeDisabled,false);
  const buttons=childrenOfType(element,'button');assert.equal(buttons.length,6);
  for(const button of buttons)assert.equal(button.props.type,'button');
  for(const button of buttons.slice(0,5))button.props.onClick();
  buttons[5].props.onClick();
  assert.deepEqual(choices,[...SYSTEM_TEMPLATES,custom]);assert.equal(choices.at(-1),custom);assert.deepEqual(deleted,[custom]);
  assert.equal(buttons[5].props['aria-label'],'Eliminar plantilla Mi plantilla QA');
  const html=renderToStaticMarkup(element);assert.match(html,/<dialog\b/);assert.match(html,/aria-label="Nueva página"/);
  for(const template of SYSTEM_TEMPLATES)assert.ok(html.includes(template.titulo));
  assert.ok(html.includes('Mis plantillas'));
  const blank=renderToStaticMarkup(React.createElement(TemplateDialog,{templates:[],creating:false,onChoose:()=>{},onClose:()=>{},onDelete:()=>{}}));
  assert.ok(!blank.includes('Mis plantillas'));
});

test('creating disables every system/custom choice, delete and native close without removing content',()=>{
  const element=TemplateDialog({templates:[custom],creating:true,onChoose:()=>{},onDelete:()=>{},onClose:()=>{}});
  assert.equal(element.props.closeDisabled,true);
  assert.ok(childrenOfType(element,'button').every(button=>button.props.disabled===true));
  const html=renderToStaticMarkup(element);
  assert.match(html,/aria-busy="true"/);
  assert.equal([...html.matchAll(/<button\b[^>]*disabled=""/g)].length,7,'Six chooser actions plus the shared close button');
  assert.ok(html.includes('Mi plantilla QA'));
});

test('name dialog uses native Modal, shared focus ref and disabled input/cancel/submit while saving',()=>{
  const node=fn('NameTemplateDialog');
  const modal=find(node,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText()==='Modal');assert.equal(modal.length,1);
  assert.equal(attr(modal[0],'native').initializer,undefined);
  assert.equal(attr(modal[0],'overlayAriaLabel').initializer.text,'Guardar como plantilla');
  assert.equal(attr(modal[0],'closeDisabled').initializer.expression.getText(),'saving');
  assert.equal(attr(modal[0],'initialFocusRef').initializer.expression.getText(),'nameRef');
  const input=find(node,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText()==='input');assert.equal(input.length,1);
  assert.equal(attr(input[0],'ref').initializer.expression.getText(),'nameRef');
  assert.equal(attr(input[0],'disabled').initializer.expression.getText(),'saving');
  const ref=properties(node,'nameRef');assert.equal(ref.length,1);assert.equal(ref[0].initializer.expression.getText(),'useRef');assert.equal(ref[0].initializer.arguments[0].kind,ts.SyntaxKind.NullKeyword);
  const html=renderToStaticMarkup(React.createElement(NameTemplateDialog,{defaultName:'Actual title',saving:true,onSave:()=>{},onClose:()=>{}}));
  assert.match(html,/<dialog\b[^>]*aria-label="Guardar como plantilla"[^>]*aria-busy="true"/);
  assert.match(html,/<input[^>]*disabled=""[^>]*maxLength="120"[^>]*value="Actual title"/);
  assert.equal([...html.matchAll(/<button\b[^>]*disabled=""/g)].length,3,'Native close, Cancel and Save are disabled');
  const defaultHtml=renderToStaticMarkup(React.createElement(NameTemplateDialog,{defaultName:'',saving:false,onSave:()=>{},onClose:()=>{}}));
  assert.match(defaultHtml,/value="Mi plantilla"/);
});

test('actual submit trims a nonempty name and rejects empty/busy submissions while preventing form navigation',()=>{
  const forms=find(fn('NameTemplateDialog'),n=>ts.isJsxOpeningElement(n)&&n.tagName.getText()==='form');assert.equal(forms.length,1);
  const callback=attr(forms[0],'onSubmit').initializer.expression.getText();
  for(const saving of [false,true])for(const name of ['', '   \n ', '  Plantilla QA  ']){
    const saved=[];let prevented=0;
    const submit=Function('saving','name','onSave',`return (${callback});`)(saving,name,value=>saved.push(value));
    submit({preventDefault(){prevented++;}});
    assert.equal(prevented,1);assert.deepEqual(saved,!saving&&name.trim()?['Plantilla QA']:[]);
  }
  const input=find(fn('NameTemplateDialog'),n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText()==='input')[0];
  const changes=[];
  Function('setName',`return (${attr(input,'onChange').initializer.expression.getText()});`)(value=>changes.push(value))({target:{value:'  Keep typing  '}});
  assert.deepEqual(changes,['  Keep typing  '],'Typing is not prematurely trimmed');
});

test('parent chooser props combine structural/create busy and consult the latest synchronous pending counter on every close',()=>{
  const declarations=properties(tree,'templateDialogProps');assert.equal(declarations.length,1);
  const expression=declarations[0].initializer.getText();
  for(const creating of [false,true])for(const structuralBusy of [false,true]){
    const pendingSaves={current:0},closed=[],templates=[custom],createList=()=>{},deleteTemplate=()=>{};
    const props=Function('templates','creating','structuralBusy','createList','deleteTemplate','pendingSaves','setTemplateOpen',`return (${expression});`)(templates,creating,structuralBusy,createList,deleteTemplate,pendingSaves,value=>closed.push(value));
    assert.equal(props.creating,creating||structuralBusy);assert.equal(props.templates,templates);assert.equal(props.onChoose,createList);assert.equal(props.onDelete,deleteTemplate);
    pendingSaves.current=1;props.onClose();assert.deepEqual(closed,[],'Counter changes after callback creation still block close');
    pendingSaves.current=0;props.onClose();assert.deepEqual(closed,[false]);
    pendingSaves.current=2;props.onClose();assert.deepEqual(closed,[false]);
  }
  const mounts=find(tree,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText()==='TemplateDialog');assert.equal(mounts.length,2,'Empty and populated page use the same guarded props');
  for(const mount of mounts)assert.ok(mount.attributes.properties.some(node=>ts.isJsxSpreadAttribute(node)&&node.expression.getText()==='templateDialogProps'));
});

test('parent name-dialog close uses latest pendingSaves and passes structural busy without stale captured state',()=>{
  const mounts=find(tree,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText()==='NameTemplateDialog');assert.equal(mounts.length,1);
  const mount=mounts[0];assert.equal(attr(mount,'saving').initializer.expression.getText(),'structuralBusy');
  const pendingSaves={current:0},closed=[];
  const close=Function('pendingSaves','setSaveTemplateOpen',`return (${attr(mount,'onClose').initializer.expression.getText()});`)(pendingSaves,value=>closed.push(value));
  pendingSaves.current=1;close();assert.deepEqual(closed,[]);
  pendingSaves.current=0;close();assert.deepEqual(closed,[false]);
});

test('each real rendered dialog owns exactly one dialog role and no retired custom backdrop',()=>{
  assert.doesNotMatch(source,/personal-modal-backdrop/);
  for(const [Component,props] of [[TemplateDialog,{templates:[],creating:false,onChoose:()=>{},onDelete:()=>{},onClose:()=>{}}],
    [NameTemplateDialog,{defaultName:'QA',saving:false,onSave:()=>{},onClose:()=>{}}]]){
    const html=renderToStaticMarkup(React.createElement(Component,props));
    assert.equal([...html.matchAll(/role="dialog"/g)].length,1);assert.equal([...html.matchAll(/aria-modal="true"/g)].length,1);
    assert.equal([...html.matchAll(/<dialog\b/g)].length,1);
  }
});
