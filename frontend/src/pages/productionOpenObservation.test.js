import { createProductionCatalogReader } from "./productionCatalogReader.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createProductionVisitObserver,newestProductionVisit,reconcileProductionVisitList} from './productionVisitObservation.js';
import {verifiedProductionDraftVisit,createProductionDraft,productionVisitDraft} from './productionDraft.js';
import {assertProductionClient,productionReadUrl} from './productionRouteContext.js';

const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const nodes=[];(function walk(n){nodes.push(n);ts.forEachChild(n,walk);})(tree);
function evaluate(node,deps){assert.ok(node);return Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));}
function callback(name,deps){return evaluate(nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)===name)?.initializer,deps);}
const id='11111111-1111-4111-8111-111111111111';
const visit=revision=>({id,revision,cliente_id:7,cliente_nombre:'QA',fecha:'2026-10-20',titulo:`Revision ${revision}`,observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  let selected=null,visits=[];
  const held=[],urls=[],errors=[];
  const deps={productionCatalog:{current:{reader:createProductionCatalogReader()}},readEpoch:{current:0},openVersion:{current:0},refreshVersion:{current:0},month:'2026-10',clientId:'7',tab:'calendar',contextError:'',
    AbortController,productionReadUrl,verifiedProductionDraftVisit,assertProductionClient,newestProductionVisit,reconcileProductionVisitList,
    mayLeave:action=>action(),apiRequest:(url,options)=>new Promise((resolve,reject)=>held.push({url,options,resolve,reject})),
    setSelected:value=>{selected=typeof value==='function'?value(selected):value;},
    setVisits:value=>{visits=typeof value==='function'?value(visits):value;},
    setError:value=>errors.push(value),writeProductionLocation:value=>urls.push(value)};
  const observer=createProductionVisitObserver(()=>deps.readEpoch.current);
  deps.visitObserver={current:observer};deps.setBankObservation=()=>{};
  deps.observeProductionVisit=value=>observer.observe(value);
  deps.openVisit=(...args)=>callback('openVisit',deps)(...args);
  for(const name of ['Creating','DetailLoading','Month','Day','Loading','ListAvailable','Pending','PendingPhotos','Users','Clients'])deps[`set${name}`]=()=>{};
  const effect=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.arguments[0]?.getText(tree).includes('Promise.all([apiRequest(productionReadUrl'));
  return{deps,held,urls,errors,open:callback('openVisit',deps),refresh:callback('refreshVisit',deps),
    collection:()=>evaluate(effect.arguments[0],deps)(),get selected(){return selected;},get visits(){return visits;}};
}
async function resolveCollection(f,start,revision){
  f.held[start].resolve({visitas:[visit(revision)]});f.held[start+1].resolve([]);f.held[start+2].resolve([]);await settle();
}

test('actual pending open uses collection floor before publishing detail or URL',async()=>{
  const f=fixture(),pending=f.open(id),cleanup=f.collection();
  await resolveCollection(f,1,3);
  assert.equal(f.selected,null);assert.equal(f.visits[0].revision,3);
  f.held[0].resolve(visit(2));await pending;
  assert.equal(f.selected.revision,3);assert.equal(f.visits[0].revision,3);
  assert.equal(f.selected.titulo,'Revision 3');assert.equal(f.urls.length,1);
  assert.deepEqual(f.errors.filter(Boolean),[]);cleanup();
});
test('actual refresh returns floor3 to a pending baseline1 model, not merely to React setters',async()=>{
  const f=fixture(),model=createProductionDraft(visit(1),productionVisitDraft(visit(1)));
  model.begin(visit(1));const pending=f.refresh(id),cleanup=f.collection();
  await resolveCollection(f,1,3);
  model.observe(visit(3),productionVisitDraft(visit(3)));
  assert.equal(model.snapshot.visit.revision,1,'pending model has not adopted the collection');
  f.held[0].resolve(visit(2));const result=await pending;
  assert.equal(result.revision,3);assert.equal(f.visits[0].revision,3);
  model.complete(result,productionVisitDraft(result));
  assert.equal(model.snapshot.visit.revision,3);assert.equal(model.snapshot.pending,false);cleanup();
});
test('new epoch clears the observer floor for a fresh open of the same UUID',async()=>{
  const f=fixture(),cleanup=f.collection();await resolveCollection(f,0,3);cleanup();
  ++f.deps.readEpoch.current;++f.deps.openVersion.current;
  const pending=f.open(id);f.held[3].resolve(visit(2));await pending;
  assert.equal(f.selected.revision,2,'prior-context floor must not leak into the new context');
  assert.equal(f.deps.observeProductionVisit(visit(1)).revision,2);
});
