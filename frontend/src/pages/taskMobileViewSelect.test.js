import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import ts from 'typescript';
import postcss from 'postcss';

const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length,0);
const owner=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='TasksView');assert.ok(owner);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(root);return result;}
const attr=(node,key)=>node.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.getText(tree)===key);
const expr=(node,key)=>attr(node,key)?.initializer?.expression?.getText(tree);
const openings=nodes(owner,node=>ts.isJsxOpeningElement(node));
const views=[['board','Tablero'],['list','Lista'],['calendar','Calendario'],['clients','Por cliente'],['responsibles','Por responsable']];
function requiredOpening(predicate){const found=openings.filter(predicate);assert.equal(found.length,1);return found[0];}
function renderNode(node,bindings){
  const code=ts.transpileModule(`const result=(${node.getText(tree)});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  return Function('React',...Object.keys(bindings),`${code}\nreturn result;`)(React,...Object.values(bindings));
}
function text(value){return Array.isArray(value)?value.map(text).join(''):React.isValidElement(value)?text(value.props.children):value==null||typeof value==='boolean'?'':String(value);}

test('actual mobile shared select is controlled by the existing view setter and retains all five native options',()=>{
  const opening=requiredOpening(node=>node.tagName.getText(tree)==='FilterSelect'&&attr(node,'className')?.initializer?.text==='ros-mobile-view-select');
  assert.equal(attr(opening,'label').initializer.text,'Vista de tareas');assert.equal(expr(opening,'value'),'view');
  function FilterSelect(){return null;}
  for(const [value] of views){
    const calls=[];const element=renderNode(opening.parent,{FilterSelect,view:value,setView:next=>calls.push(next)});
    assert.equal(element.type,FilterSelect);assert.equal(element.props.label,'Vista de tareas');assert.equal(element.props.value,value);
    const options=React.Children.toArray(element.props.children);assert.equal(options.length,5);
    assert.deepEqual(options.map(option=>[option.props.value,text(option)]),views);
    assert.ok(options.every(option=>option.type==='option'));
    element.props.onChange({target:{value}});assert.deepEqual(calls,[value]);
  }
  assert.match(expr(opening,'onChange'),/^\(?event\)?\s*=>\s*setView\(event\.target\.value\)$/);
});

test('desktop tabs keep the same five choices without a task-header Feedback shortcut or polling',()=>{
  const navigation=requiredOpening(node=>attr(node,'className')?.initializer?.text==='ros-primary-navigation');
  const tabs=requiredOpening(node=>attr(node,'className')?.initializer?.text==='ros-view-tabs');
  assert.ok(nodes(navigation.parent,node=>node===tabs).length);
  const calls=[];function TaskViewIcon(){return null;}
  const element=renderNode(tabs.parent,{view:'responsibles',setView:value=>calls.push(value),TaskViewIcon});
  const buttons=React.Children.toArray(element.props.children);assert.equal(buttons.length,5);
  assert.deepEqual(buttons.map(button=>text(button.props.children)),views.map(([,label])=>label));
  buttons.forEach(button=>button.props.onClick());assert.deepEqual(calls,views.map(([value])=>value));
  assert.deepEqual(buttons.map(button=>button.props['aria-pressed']),[false,false,false,false,true]);
  assert.equal(openings.some(node=>node.tagName.getText(tree)==='button'&&expr(node,'onClick')==='openFeedback'),false);
  assert.doesNotMatch(owner.getText(tree), /refreshFeedbackCount|newFeedbackCount|\/api\/notas\/nuevas/);
});

const sheets=['WorkspaceReadOnly','TaskHeader'];
const styles=sheets.map(name=>postcss.parse(readFileSync(new URL(`./${name}.css`,import.meta.url),'utf8')));
const selectors={
  '.ros-view-tabs':['.render-workspace .ros-view-tabs','.render-workspace .ros-controls .ros-view-tabs'],
  '.ros-mobile-view-select':['.render-workspace .ros-mobile-view-select','.render-workspace .ros-controls .ros-mobile-view-select'],
  '.ros-primary-navigation':['.render-workspace .ros-primary-navigation','.render-workspace .ros-controls>div.ros-primary-navigation:first-child'],
  '.ros-feedback-link':['.render-workspace .ros-feedback-link','.render-workspace .ros-controls .ros-feedback-link'],
};
const normalize=selector=>selector.replace(/\s*>\s*/g,'>').replace(/\s+/g,' ').trim();
function value(selector,property,width){
  let result;
  for(const css of styles)css.walkRules(rule=>{
    if(!postcss.list.comma(rule.selector).map(normalize).some(s=>selectors[selector].includes(s)))return;
    if(!rule.nodes.some(node=>node.type==='decl'&&node.prop===property))return;
    for(let parent=rule.parent;parent&&parent!==css;parent=parent.parent){
      if(parent.type!=='atrule'||parent.name!=='media')continue;
      const max=/max-width:\s*(\d+)px/.exec(parent.params),min=/min-width:\s*(\d+)px/.exec(parent.params);
      if((max&&width>Number(max[1]))||(min&&width<Number(min[1])))return;
      assert.match(parent.params,/^(?:\(max-width:\s*\d+px\)|\(min-width:\s*\d+px\))$/);
    }
    rule.nodes.filter(node=>node.type==='decl'&&node.prop===property).forEach(node=>{result=node.value;});
  });return result;
}

test('scoped CSS swaps only mobile tabs for select and keeps selector plus Feedback in two columns',()=>{
  assert.ok(source.indexOf('import "./WorkspaceReadOnly.css"')<source.indexOf('import "./TaskHeader.css"'));
  for(const width of [320,390,700]){
    assert.equal(value('.ros-view-tabs','display',width),'none');
    assert.ok(['block','flex','grid'].includes(value('.ros-mobile-view-select','display',width)));
    assert.equal(value('.ros-primary-navigation','display',width),'grid');
    assert.match(value('.ros-primary-navigation','grid-template-columns',width),/^(?:1fr|minmax\(0,\s*1fr\)) auto$/);
    assert.equal(value('.ros-feedback-link','white-space',width),'nowrap');
    assert.equal(value('.ros-feedback-link','width',width),'auto');
    assert.equal(value('.ros-feedback-link','align-self',width),'end');
  }
  for(const width of [701,900,1280]){
    // Existing nonmobile breakpoints use flex or contents. Both retain the
    // five rendered buttons; neither may inherit the mobile display:none.
    assert.ok(['flex','contents'].includes(value('.ros-view-tabs','display',width)));
    assert.equal(value('.ros-mobile-view-select','display',width),'none');
  }
});
