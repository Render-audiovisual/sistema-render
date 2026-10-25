import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {readStoryPlanillaFilter,storyPlanillaFilterQuery} from './storyPlanillaContext.js';
import {readUrlContext,readMonthContext,formatMonthContext,buildContextUrl} from '../shared/navigation/url-context.js';

const text=readFileSync(new URL('./Historias.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Historias.jsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),nodes=[];
(function walk(n){nodes.push(n);ts.forEachChild(n,walk);})(tree);
const variable=name=>nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)===name).initializer;
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
const helpers={readStoryPlanillaFilter,storyPlanillaFilterQuery,readUrlContext,readMonthContext,formatMonthContext};
function initial(search,initialTab='estructura'){
  const initialContext=readUrlContext(search,{vista:initialTab,cliente:'',filtro:'',mes:''});
  return evaluate(variable('[filtroClientePlanilla, setFiltroClientePlanilla]'),{...helpers,initialContext,window:{location:{search}},useState:x=>x});
}
function restore(search){let value;
  evaluate(variable('restoreContext'),{...helpers,window:{location:{search}},hoyDate:new Date('2026-10-24T12:00:00Z'),
    setVista(){},setClienteSeleccionado(){},setFiltroClientePlanilla:x=>{value=x;},setYear(){},setMonth(){}})();
  return value;
}
test('actual mount and Back agree on explicit all, numeric filter and legacy absence/empty',()=>{
  for(const [query,expected]of [
    ['vista=planilla&cliente=2&filtro=all',''],['vista=planilla&cliente=2&filtro=3','3'],
    ['vista=planilla&cliente=2','2'],['vista=planilla&cliente=2&filtro=',''],
    ['vista=checklist&cliente=2',''],['vista=planilla',''],
  ]){assert.equal(initial('?'+query),expected,query+' mount');assert.equal(restore('?'+query),expected,query+' Back');}
});
test('actual mount preserves initialTab=planilla legacy fallback when URL has no vista, but explicit Todos wins',()=>{
  assert.equal(initial('?cliente=2','planilla'),'2');
  assert.equal(initial('?vista=&cliente=2','planilla'),'2');
  assert.equal(initial('?cliente=2&filtro=all','planilla'),'');
  assert.equal(initial('?cliente=2&filtro=','planilla'),'');
  assert.equal(initial('?vista=checklist&cliente=2','planilla'),'');
  assert.equal(initial('?cliente=2','estructura'),'');
});
test('actual Todos UI action writes explicit all, preserves creation client, reload and history filters',()=>{
  const select=nodes.find(n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==='select'&&n.attributes.properties.some(p=>p.name?.text==='aria-label'&&p.initializer?.text==='Filtrar planilla por cliente'));
  const change=select.attributes.properties.find(p=>p.name?.text==='onChange').initializer.expression;
  let href='/planificacion-historias?vista=planilla&cliente=2&filtro=2&mes=2026-10',filter='2';const history=[href],approved=[];
  const handler=evaluate(change,{...helpers,approveContextChange:value=>{approved.push(value);return true;},
    pushUrlContext:changes=>{href=buildContextUrl('https://render.test'+href,changes);history.push(href);},setFiltroClientePlanilla:value=>{filter=value;}});
  handler({target:{value:''}});
  assert.equal(filter,'');assert.deepEqual(approved,[{filtro:'all'}]);
  assert.equal(new URL(href,'https://render.test').searchParams.get('filtro'),'all');
  assert.equal(new URL(href,'https://render.test').searchParams.get('cliente'),'2');
  assert.equal(initial(new URL(href,'https://render.test').search),'');
  assert.equal(restore(new URL(history[0],'https://render.test').search),'2');
  assert.equal(restore(new URL(history[1],'https://render.test').search),'');
  const count=history.length;evaluate(change,{...helpers,approveContextChange:()=>false,pushUrlContext:()=>assert.fail('vetoed URL write'),setFiltroClientePlanilla:()=>assert.fail('vetoed state')})({target:{value:'3'}});
  assert.equal(history.length,count);
});
test('actual canonical writer retains explicit all instead of deleting preference on rerender',()=>{
  const effect=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.arguments[0]?.getText(tree).includes('replaceUrlContext({ vista, cliente:'));
  let written;
  evaluate(effect.arguments[0],{...helpers,vista:'planilla',clienteSeleccionado:2,filtroClientePlanilla:'',year:2026,month:9,
    replaceUrlContext:changes=>{written=changes;}})();
  assert.equal(written.filtro,'all');assert.equal(written.cliente,2);assert.equal(written.mes,'2026-10');
  const url=buildContextUrl('https://render.test/planificacion-historias',written);
  assert.equal(initial(new URL(url,'https://render.test').search),'');assert.equal(restore(new URL(url,'https://render.test').search),'');
});
