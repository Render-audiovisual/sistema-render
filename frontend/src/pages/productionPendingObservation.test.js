import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {productionReadUrl,assertProductionClient} from './productionRouteContext.js';
import {verifiedProductionDraftVisit} from './productionDraft.js';
import {createProductionVisitObserver,newestProductionVisit,reconcileProductionVisitList} from './productionVisitObservation.js';

const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
assert.equal(ast.parseDiagnostics.length,0);
const nodes=[];(function walk(node){nodes.push(node);ts.forEachChild(node,walk);})(ast);
const effect=nodes.find(node=>ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0].getText(ast).includes('Promise.all([apiRequest(productionReadUrl'));
const available=nodes.find(node=>ts.isVariableDeclaration(node)&&node.name.getText(ast)==='pendingAvailable');
assert.ok(effect);assert.ok(available);
const evaluate=(node,deps)=>new Function(...Object.keys(deps),`return (${node.getText(ast)});`)(...Object.values(deps));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const id='11111111-1111-4111-8111-111111111111';
const visit=revision=>({id,revision,cliente_id:7,cliente_nombre:'Synthetic',fecha:'2026-10-20',titulo:'Visit',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]});
const photo={id:'22222222-2222-4222-8222-222222222222',visita_id:id,cliente_id:7,estado:'pendiente'};
function fixture(){
  const collection=deferred(),bank=deferred(),requests=[],writes=[],errors=[];
  let bankObservation=null,pending=[],pendingPhotos=[],selected=visit(2),visits=[visit(2)];
  // No draft setter is supplied: any attempt to clear/reset an editor fails.
  const draft=Object.freeze({copy:'Unsaved exact text',revision:2});
  const deps={AbortController,productionReadUrl,assertProductionClient,verifiedProductionDraftVisit,newestProductionVisit,reconcileProductionVisitList,
    month:'2026-10',clientId:'7',tab:'pending',contextError:'',readEpoch:{current:0},positiveId:value=>Number.isSafeInteger(value)&&value>0,
    apiRequest(url){requests.push(url);if(url==='/api/producciones?mes=2026-10&cliente_id=7')return collection.promise;
      if(url===productionReadUrl({month:'2026-10',clientId:'7',tab:'pending'}))return bank.promise;
      if(url==='/api/usuarios'||url==='/api/clientes')return Promise.resolve([]);assert.fail(url);},
    setVisits(value){visits=typeof value==='function'?value(visits):value;writes.push('visits');},
    setSelected(value){selected=typeof value==='function'?value(selected):value;writes.push('selected');},
    setPending(value){pending=value;writes.push('pending');},setPendingPhotos(value){pendingPhotos=value;writes.push('photos');},
    setBankObservation(value){bankObservation=value;writes.push('observation');},setError(value){errors.push(value);},
    ...Object.fromEntries(['Loading','ListAvailable','Users','Clients'].map(name=>[`set${name}`,value=>writes.push([name,value])]))};
  deps.visitObserver={current:createProductionVisitObserver(()=>deps.readEpoch.current)};
  deps.observeProductionVisit=value=>deps.visitObserver.current.observe(value);
  return {deps,collection,bank,requests,writes,errors,draft,run:()=>evaluate(effect.arguments[0],deps)(),
    available:()=>evaluate(available.initializer,{...deps,bankObservation}),
    get pending(){return pending;},get photos(){return pendingPhotos;},get observation(){return bankObservation;}};
}
async function startBank(f){f.collection.resolve({visitas:[visit(2)]});await settle();assert.equal(f.requests.length,4);}

test('actual effect starts bank only after validating and observing the collection; admits independent bank membership',async()=>{
  const f=fixture(),cleanup=f.run();try{
    assert.equal(f.requests.length,3);assert.equal(f.available(),false);
    await startBank(f);const token=f.deps.visitObserver.current.token;
    // A bank photo need not appear in this month aggregate (lineage/all-period membership).
    f.bank.resolve({videos:[],fotos:[photo]});await settle();
    assert.deepEqual(f.photos,[photo]);assert.deepEqual(f.pending,[]);assert.equal(f.observation.token,token);assert.equal(f.available(),true);
    assert.deepEqual(f.draft,{copy:'Unsaved exact text',revision:2});
  }finally{cleanup();}
});

test('new detail observation while bank is pending rejects the old bank without publishing or touching draft',async()=>{
  const f=fixture(),cleanup=f.run();try{await startBank(f);f.deps.observeProductionVisit(visit(3));
    f.bank.resolve({videos:[],fotos:[photo]});await settle();
    assert.equal(f.available(),false);assert.equal(f.observation,null);assert.deepEqual(f.photos,[]);
    assert.equal(f.writes.includes('selected'),false);assert.equal(f.writes.includes('pending'),false);assert.match(f.errors.at(-1),/cambiaron/);
    assert.equal(f.draft.copy,'Unsaved exact text');
  }finally{cleanup();}
});

test('rejected bank recovers through actual manual reload in the same instance and epoch',async()=>{
  const f=fixture(),observer=f.deps.visitObserver.current,draft=f.draft,epoch=f.deps.readEpoch.current;
  let cleanup=f.run();
  try{
    await startBank(f);
    f.deps.observeProductionVisit(visit(3));const freshToken=observer.token;
    f.bank.resolve({videos:[],fotos:[photo]});await settle();
    assert.match(f.errors.at(-1),/cambiaron/);assert.equal(f.available(),false);
    assert.equal(f.observation,null);assert.equal(f.requests.length,4);

    const collection=deferred(),bank=deferred();let reload=0;
    const retry=nodes.find(node=>ts.isVariableDeclaration(node)&&node.name.getText(ast)==='retryPendingBank');
    assert.ok(retry,'Actual manual bank retry handler');
    evaluate(retry.initializer,{writeLock:{current:false},batchDraft:{current:{busy:false}},setReload:update=>{reload=update(reload);}})();
    assert.equal(reload,1);
    cleanup();
    // Replace only the transport's held responses, preserving all state,
    // setters, observer, epoch, draft and request/publication history.
    const priorRequest=f.deps.apiRequest;
    f.deps.apiRequest=url=>{
      if(url===productionReadUrl({month:'2026-10',clientId:'7',tab:'calendar'})){f.requests.push(url);return collection.promise;}
      if(url===productionReadUrl({month:'2026-10',clientId:'7',tab:'pending'})){f.requests.push(url);return bank.promise;}
      return priorRequest(url);
    };
    cleanup=f.run();assert.equal(f.requests.length,7);
    collection.resolve({visitas:[visit(3)]});await settle();
    assert.equal(f.requests.length,8);assert.equal(observer.token,freshToken);
    assert.equal(f.observation,null);assert.equal(f.writes.includes('selected'),false);
    bank.resolve({videos:[],fotos:[]});await settle();
    assert.equal(f.available(),true);assert.deepEqual(f.pending,[]);assert.deepEqual(f.photos,[]);
    assert.deepEqual(f.observation,{epoch,token:freshToken});assert.equal(f.errors.at(-1),'');
    assert.equal(f.deps.visitObserver.current,observer);assert.equal(f.deps.readEpoch.current,epoch);
    assert.equal(f.draft,draft);assert.deepEqual(f.draft,{copy:'Unsaved exact text',revision:2});
    await settle();assert.equal(f.requests.length,8,'No automatic retry requests');
  }finally{cleanup();}
});

for(const revision of [2,1])test(`same/older detail ${revision} does not invalidate bank admission`,async()=>{
  const f=fixture(),cleanup=f.run();try{await startBank(f);const token=f.deps.visitObserver.current.token;
    f.deps.observeProductionVisit(visit(revision));assert.equal(f.deps.visitObserver.current.token,token);
    f.bank.resolve({videos:[],fotos:[]});await settle();assert.equal(f.available(),true);
  }finally{cleanup();}
});

test('previously admitted bank becomes unavailable immediately when a detail advances, without clearing its arrays',async()=>{
  const f=fixture(),cleanup=f.run();try{await startBank(f);f.bank.resolve({videos:[],fotos:[photo]});await settle();assert.equal(f.available(),true);
    f.deps.observeProductionVisit(visit(3));assert.equal(f.available(),false);assert.deepEqual(f.photos,[photo]);assert.equal(f.draft.revision,2);
  }finally{cleanup();}
});

for(const bank of [{videos:[],fotos:null},{videos:[],fotos:[{...photo,cliente_id:8}]}])test(`malformed or foreign bank cannot publish: ${JSON.stringify(bank)}`,async()=>{
  const f=fixture(),cleanup=f.run();try{await startBank(f);f.bank.resolve(bank);await settle();
    assert.equal(f.observation,null);assert.equal(f.writes.includes('pending'),false);assert.ok(f.errors.at(-1));
  }finally{cleanup();}
});

test('invalid collection never dispatches the sequential bank GET',async()=>{
  const f=fixture(),cleanup=f.run();try{f.collection.resolve({visitas:[{...visit(2),fotos:null}]});await settle();
    assert.equal(f.requests.length,3);assert.equal(f.observation,null);assert.ok(f.errors.at(-1));
  }finally{cleanup();}
});

for(const boundary of ['epoch','cleanup'])test(`pending bank completion after ${boundary} cannot publish`,async()=>{
  const f=fixture(),cleanup=f.run();try{await startBank(f);if(boundary==='epoch')f.deps.readEpoch.current++;else cleanup();
    const before=f.writes.length;f.bank.resolve({videos:[],fotos:[photo]});await settle();
    assert.equal(f.writes.length,before);assert.equal(f.observation,null);assert.equal(f.available(),false);
  }finally{cleanup();}
});
