import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {sectionFocusKey} from '../shared/navigation/section-focus.js';

// Execute the actual class, not a test-only boundary. SSR here exercises its
// already-failed render; it does not claim React SSR catches child errors.
const source=readFileSync(new URL('./SectionErrorBoundary.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('SectionErrorBoundary.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const all=root=>{const result=[];(function walk(node){result.push(node);ts.forEachChild(node,walk);})(root);return result;};
const one=(root,predicate)=>{const result=all(root).filter(predicate);assert.equal(result.length,1);return result[0];};
const declaration=one(ast,node=>ts.isClassDeclaration(node)&&node.name?.text==='SectionErrorBoundary');
const code=ts.transpileModule(`const Boundary=(${declaration.getText(ast).replace(/^export\s+(default\s+)?/,'')});`,{
  compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022},
}).outputText;
function load(window){return new Function('React','window',`${code};return Boundary;`)(React,window);}
function elements(root){if(!React.isValidElement(root))return [];return [root,...React.Children.toArray(root.props.children).flatMap(elements)];}

test('healthy boundary preserves the exact child and performs no browser recovery',()=>{
  let reloads=0;const Boundary=load({location:{reload(){reloads++;}}});
  const child=React.createElement('section',{'data-child':'real'},'Section content');
  const boundary=new Boundary({children:child});
  assert.equal(boundary.state.failed,false);assert.equal(boundary.render(),child);
  assert.match(renderToStaticMarkup(boundary.render()),/Section content/);assert.equal(reloads,0);
});

test('error derivation is constant and exposes neither message nor stack in fallback',()=>{
  const Boundary=load({location:{reload(){assert.fail('Automatic reload');}}});
  const error=new Error('SECRET_MESSAGE_247');error.stack='SECRET_STACK_247';error.token='SECRET_TOKEN_247';
  const derived=Boundary.getDerivedStateFromError(error);assert.deepEqual(derived,{failed:true});
  const boundary=new Boundary({children:React.createElement('span',null,'PRIVATE_CHILD_247')});boundary.state=derived;
  const tree=boundary.render(),html=renderToStaticMarkup(tree);
  assert.equal(tree.type,'main');assert.equal(tree.props.role,'alert');assert.equal(tree.props.className,'section-error');
  assert.equal(tree.props.children.type,'div');assert.equal(tree.props.children.props.className,'section-error-content');
  assert.match(html,/No pudimos abrir esta sección/);assert.match(html,/menú/i);
  assert.match(html,/No se recarga la página ni se descartan borradores automáticamente/);
  assert.match(html,/puede haberse guardado/i);
  assert.doesNotMatch(html,/Si recargás|se perderán/);
  assert.doesNotMatch(html,/SECRET_|PRIVATE_CHILD_247/);
});

test('retry is exclusively an explicit callback; parent owns guarded reset and lazy identity',()=>{
  let retries=0;const Boundary=load({location:{reload(){assert.fail('No hard reload');}}});
  const boundary=new Boundary({children:null,onRetry:()=>{retries++;}});boundary.state=Boundary.getDerivedStateFromError(new Error('hidden'));
  const first=boundary.render();boundary.render();renderToStaticMarkup(first);assert.equal(retries,0);
  assert.match(renderToStaticMarkup(first),/Podés reintentar o usar el menú/);
  const buttons=elements(first).filter(element=>element.type==='button');assert.equal(buttons.length,1);
  assert.equal(buttons[0].props.type,'button');assert.equal(buttons[0].props.children,'Reintentar sección');
  buttons[0].props.onClick();assert.equal(retries,1);
  assert.equal(boundary.state.failed,true,'No local reset before parent navigation guard permits retry');
  // A section failure must not retry a business operation or schedule recovery.
  const calls=all(declaration).filter(ts.isCallExpression).map(node=>node.expression.getText(ast));
  assert.deepEqual(calls,[]);
});

test('absent retry callback offers menu recovery without an inert button or hard reload',()=>{
  const Boundary=load({location:{reload(){assert.fail('No hard reload');}}});
  for(const onRetry of [undefined,null,false,'invalid']){
    const boundary=new Boundary({children:null,onRetry});boundary.state={failed:true};
    assert.equal(elements(boundary.render()).filter(element=>element.type==='button').length,0);
    assert.match(renderToStaticMarkup(boundary.render()),/puede haberse guardado/);
  }
});

test('App isolates only dashboard under the boundary and retains Sidebar and draft provider outside it',()=>{
  const appSource=readFileSync(new URL('../App.jsx',import.meta.url),'utf8');
  const app=ts.createSourceFile('App.jsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(app.parseDiagnostics.length,0);
  const name=node=>ts.isJsxElement(node)?node.openingElement.tagName.getText(app):ts.isJsxSelfClosingElement(node)?node.tagName.getText(app):null;
  const boundary=one(app,node=>name(node)==='SectionErrorBoundary');
  const attrs=boundary.openingElement.attributes.properties;
  const key=attrs.find(attr=>attr.name?.getText(app)==='key');assert.ok(key);
  const expression=key.initializer.expression;
  assert.ok(ts.isTemplateExpression(expression));
  assert.equal(expression.templateSpans[0].expression.getText(app),'sessionRenderEpoch');
  assert.equal(expression.templateSpans[1].expression.getText(app),"sectionFocusKey(path,route.slice(path.length).split('#',1)[0])");
  assert.equal(expression.head.text,'section:');
  assert.equal(expression.templateSpans[0].literal.text,':');
  assert.equal(expression.templateSpans[1].literal.text,':');
  assert.equal(expression.templateSpans.length,3);
  assert.equal(expression.templateSpans[2].expression.getText(app),'sectionRetryEpoch');
  assert.equal(expression.templateSpans[2].literal.text,'');
  const onRetry=attrs.find(attr=>attr.name?.getText(app)==='onRetry');
  assert.equal(onRetry?.initializer.expression.getText(app),'retrySection');
  const retry=one(app,node=>ts.isVariableDeclaration(node)&&node.name.getText(app)==='retrySection');
  const guarded=one(retry,node=>ts.isCallExpression(node)&&node.expression.getText(app)==='requestSectionRetry');
  assert.equal(guarded.arguments[0].getText(app),'window');
  const options=guarded.arguments[1];
  assert.ok(ts.isObjectLiteralExpression(options));
  assert.ok(options.properties.some(prop=>prop.name?.getText(app)==='isCurrent'));
  const perform=options.properties.find(prop=>prop.name?.getText(app)==='retry');
  assert.ok(perform);
  assert.ok(all(perform).some(node=>ts.isCallExpression(node)&&node.expression.getText(app)==='dashboard.type.retry'));
  const increment=one(perform,node=>ts.isCallExpression(node)&&node.expression.getText(app)==='setSectionRetryEpoch');
  assert.equal(increment.arguments[0].getText(app),'value=>value+1');
  assert.equal(all(boundary).some(node=>name(node)==='Sidebar'||name(node)==='GoalDraftMemoryProvider'),false);
  const descendants=all(boundary);
  assert.ok(descendants.some(node=>ts.isJsxExpression(node)&&node.expression?.getText(app)==='dashboard'));
  assert.ok(descendants.some(node=>name(node)==='React.Suspense'));
  const provider=all(app).filter(node=>name(node)==='GoalDraftMemoryProvider')
    .find(node=>all(node).some(child=>name(child)==='Sidebar'));
  assert.ok(provider,'Canonical shell retains provider and menu');
  assert.ok(all(provider).some(node=>ts.isJsxExpression(node)&&node.expression?.getText(app)==='loadedDashboard'));
  const loaded=one(app,node=>ts.isVariableDeclaration(node)&&node.name.getText(app)==='loadedDashboard');
  assert.ok(all(loaded).includes(boundary),'Only the loaded dashboard is wrapped');
  const keyFor=(route,sessionRenderEpoch=1,sectionRetryEpoch=0)=>{
    const path=route.split(/[?#]/,1)[0];
    return new Function('sectionFocusKey','route','path','sessionRenderEpoch','sectionRetryEpoch',`return (${expression.getText(app)});`)(sectionFocusKey,route,path,sessionRenderEpoch,sectionRetryEpoch);
  };
  assert.equal(keyFor('/clientes'),'section:1:/clientes:0');
  assert.equal(keyFor('/clientes?gestion=1'),'section:1:/clientes?gestion=1:0');
  assert.equal(keyFor('/clientes',1,2),'section:1:/clientes:2');
  assert.notEqual(keyFor('/clientes',1,0),keyFor('/clientes',1,1),'Explicit retry epoch remounts failed boundary');
  for(const route of ['/clientes?cliente=7&periodo=2026-10#piece','/clientes?cliente=8&periodo=2026-11','/clientes?gestion=0'])
    assert.equal(keyFor(route),keyFor('/clientes'),'Filters do not reset objectives boundary');
  assert.equal(keyFor('/clientes?gestion=1&cliente=7#heading'),keyFor('/clientes?gestion=1'));
  assert.equal(keyFor('/workspace/tareas?view=list&task=7#brief'),keyFor('/workspace/tareas?view=board'));
  assert.notEqual(keyFor('/clientes'),keyFor('/clientes?gestion=1'));
  assert.notEqual(keyFor('/clientes',1),keyFor('/clientes',2),'Session epoch resets failure state');
  assert.notEqual(keyFor('/clientes'),keyFor('/proyectos'),'Different section resets failure state');
});

test('fallback main and heading are not classified as loading by the existing focus-manager selector',()=>{
  const focusSource=readFileSync(new URL('../shared/navigation/section-focus.js',import.meta.url),'utf8');
  const focusTree=ts.createSourceFile('section-focus.js',focusSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const loading=one(focusTree,node=>ts.isVariableDeclaration(node)&&node.name.getText(focusTree)==='LOADING');
  assert.equal(loading.initializer.text,'.route-loading,[data-render-route-loading]');
  const Boundary=load({location:{reload(){assert.fail('Unexpected reload');}}});
  const boundary=new Boundary({children:null});boundary.state={failed:true};
  const tree=boundary.render();
  assert.equal(tree.type,'main');assert.equal(elements(tree).filter(element=>element.type==='h1').length,1);
  for(const element of elements(tree)){
    assert.equal((element.props.className||'').split(/\s+/).includes('route-loading'),false);
    assert.equal(Object.hasOwn(element.props,'data-render-route-loading'),false);
  }
  // Structural selector compatibility, not a native keyboard/focus claim.
});
