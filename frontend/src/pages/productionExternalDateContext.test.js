import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {validProductionDay} from './productionRouteContext.js';

const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function find(predicate){let result;function walk(node){if(predicate(node))result=node;ts.forEachChild(node,walk);}walk(tree);assert.ok(result);return result;}
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
const declaration=name=>find(node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)===name);
const visit={id:'11111111-1111-4111-8111-111111111111',fecha:'2026-11-03'};

test('calendar date mismatch is explicit only for an open visit outside the selected day',()=>{
  const expression=declaration('visitOutsideDay').initializer;
  for(const [tab,selected,day,expected] of [
    ['calendar',visit,'2026-10-20',true],['calendar',visit,'2026-11-02',true],
    ['calendar',visit,visit.fecha,false],['pending',visit,'2026-10-20',false],['calendar',null,'2026-10-20',false],
  ])assert.equal(Boolean(evaluate(expression,{tab,selected,day,validProductionDay})),expected);
});

test('following the verified visit date changes only calendar context and replaces the same visit URL',()=>{
  const node=declaration('showVisitDay').initializer,events=[];
  const deps={selected:visit,clientId:'7',tab:'calendar',validProductionDay,calendarHeadingRef:{current:{focus(){events.push(['focus']);}}},writeLock:{current:false},batchDraft:{current:{busy:false}},resultDraft:{current:{busy:false,locked:false}},
    setMonth:value=>events.push(['month',value]),setDay:value=>events.push(['day',value]),writeProductionLocation:value=>events.push(['url',value])};
  evaluate(node,deps)();
  assert.deepEqual(events,[['month','2026-11'],['day','2026-11-03'],['url',{id:visit.id,month:'2026-11',day:visit.fecha,clientId:'7',tab:'calendar',replace:true}],['focus']]);
  for(const blocked of [{selected:null},{tab:'pending'},{selected:{...visit,fecha:'2026-02-30'}},{writeLock:{current:true}},{batchDraft:{current:{busy:true}}},{resultDraft:{current:{busy:true}}},{resultDraft:{current:{locked:true}}}]){
    events.length=0;evaluate(node,{...deps,...blocked})();assert.deepEqual(events,[]);
  }
  assert.doesNotMatch(node.getText(tree),/setSelected|openVisit|openVersion|dirty|setCreating|setReload|apiRequest|productionWrite/);
});

test('the rendered notice identifies recording date, offers one explicit action and remains present while busy',()=>{
  const node=find(node=>ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(attr=>attr.name?.getText(tree)==='className'&&attr.initializer?.text==='prod-notice prod-date-context'));
  const compiled=ts.transpileModule(`const result=(${node.getText(tree)});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const busy of [false,true]){
    const element=Function('React','selected','busy','dateLabel','showVisitDay',`${compiled}\nreturn result;`)(React,visit,busy,value=>value,()=>{});
    const html=renderToStaticMarkup(element);
    assert.match(html,/role="status"/);assert.match(html,/Fecha de grabación/);assert.match(html,/2026-11-03/);
    assert.match(html,/Ver día de la visita/);assert.equal((html.match(/<button/g)||[]).length,1);
    assert.equal(html.includes('disabled=""'),busy);
  }
});
