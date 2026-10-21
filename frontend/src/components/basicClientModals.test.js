import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createClientCreation, hasNoConfiguredMonthlyAgreement } from '../pages/clientCreate.js';

// Execute actual callbacks and SSR extracted JSX with injected hooks/effects.
// These are not mounted browser or HTTP tests.
const source=readFileSync(new URL('./ClienteModals.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('ClienteModals.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit)}visit(root);return result;}
const owner=name=>nodes(ast,ts.isFunctionDeclaration).find(n=>n.name?.text===name);
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(ast)});`)(...Object.values(deps));
const callback=(name,deps)=>evaluate(nodes(owner('EditarIdentidadSession'),n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)[0].initializer,deps);
const basic=()=>({id:9,nombre:'Basic QA',activo:true,agreement_revision:'a1:9:1:0:0',grupo_feed_id:null,
  cuota_reels:0,cuota_carruseles:0,rubro:null,fecha_inicio:null,fecha_fin:null,configuracion_vigente_desde:null,configuracion_completa:false});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(request){
  let current={token:'synthetic-A',usuario:{id:7,rol:'admin',activo:true}},live=true,observation={},held=observation;
  const session=current,calls=[],effects=[],saved=[],denials=[];
  const guard=createCapturedRequest({session,readSession:()=>current,isActive:()=>live&&held===observation,
    request:(url,options)=>{calls.push({url,options});return request(url,options)}});
  const deps={cliente:basic(),periodo:'2026-10',capture:()=>guard,hasNoConfiguredMonthlyAgreement,pending:{current:false},locked:{current:false},accessDenied:{current:false},revision:{current:'a1:9:1:0:0'},
    nombre:'Renamed QA',activo:false,snapshot:'draft-name-active',baseline:{current:'original'},confirmReload:true,onClose:()=>effects.push(['close']),
    onAccessDenied:scope=>{scope.assertCurrent();denials.push(scope)},onGuardado:async(value,scope)=>{scope.assertCurrent();saved.push(value)},window:{confirm:()=>true}};
  for(const name of ['Busy','Error','Blocked','Nombre','Activo','Denied','ConfirmReload'])deps[`set${name}`]=value=>effects.push([name,value]);
  for(const name of ['object','sameClient','validPeriod'])deps[name]=evaluate(nodes(ast,n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)[0].initializer,{});
  deps.monthStart=()=>false;deps.agreementParts=evaluate(owner('agreementParts'),deps);deps.assertClientAck=evaluate(owner('assertClientAck'),deps);
  deps.denyIdentityAccess=callback('denyIdentityAccess',deps);
  return{deps,guard,calls,effects,saved,denials,save:()=>callback('saveIdentity',deps)({preventDefault(){}}),reload:()=>callback('reloadIdentity',deps)(),
    replace(){current={token:'synthetic-B',usuario:{id:8,rol:'admin',activo:true}}},unmount(){live=false},aba(){observation={}}};
}

test('basic creation followed by actual identity save renames/deactivates with one CAS PATCH and no finance request',async()=>{
  const f=fixture(async(_url,options)=>options.method==='POST'?basic():{id:9,nombre:'Renamed QA',activo:false,agreement_revision:'a1:9:2:0:0',fecha_fin:'2026-10-21'});
  const creation=createClientCreation({capture:()=>f.guard});const created=await creation.submit({nombre:'Basic QA'},'basic');
  assert.equal(hasNoConfiguredMonthlyAgreement(created),true);f.deps.cliente=created;
  await f.save();assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(f.calls[0].options.body),{nombre:'Basic QA'});
  assert.equal(f.calls[1].url,'/api/clientes/9');assert.equal(f.calls[1].options.method,'PATCH');assert.deepEqual(JSON.parse(f.calls[1].options.body),{nombre:'Renamed QA',activo:false,expected_revision:'a1:9:1:0:0'});
  assert.equal(f.saved.length,1);assert.equal(f.saved[0].nombre,'Renamed QA');assert.equal(f.saved[0].activo,false);assert.equal(f.saved[0].configuracion_completa,false);assert.equal(f.saved[0].abono_mensual,undefined);
  assert.ok(f.calls.every(call=>!/configuraciones|abono/.test(call.url)));
});

for(const outcome of ['network',409,'wrongId','wrongName','wrongActive','noAdvance','wrongAdvance','foreignRevision'])test(`basic ${outcome} retains draft, blocks writes, no automatic GET`,async()=>{
  const f=fixture(async()=>{if(outcome==='network'||outcome===409)throw Object.assign(new Error('uncertain'),{status:outcome===409?409:undefined});
    return{id:outcome==='wrongId'?10:9,nombre:outcome==='wrongName'?'Other':'Renamed QA',activo:outcome==='wrongActive'?true:false,
      agreement_revision:outcome==='noAdvance'?'a1:9:1:0:0':outcome==='wrongAdvance'?'a1:9:3:0:0':outcome==='foreignRevision'?'a1:10:2:0:0':'a1:9:2:0:0'}});
  await f.save();assert.equal(f.calls.length,1);assert.equal(f.saved.length,0);assert.equal(f.deps.locked.current,true);assert.equal(f.deps.nombre,'Renamed QA');assert.equal(f.deps.revision.current,'a1:9:1:0:0');
  await f.save();assert.equal(f.calls.length,1);assert.equal(f.effects.some(([key])=>key==='Nombre'),false);
});

test('explicit two-step reload only GETs after confirmation, then permits a deliberate save with reviewed version',async()=>{
  let attempts=0;const f=fixture(async(_url,options)=>{if(options.method==='GET')return[{...basic(),nombre:'Other admin',agreement_revision:'a1:9:2:0:0'}];if(++attempts===1)throw Object.assign(new Error('conflict'),{status:409});return{id:9,nombre:'Reviewed edit',activo:true,agreement_revision:'a1:9:3:0:0'}});
  await f.save();f.deps.confirmReload=false;await f.reload();assert.equal(f.calls.length,1);
  f.deps.confirmReload=true;await f.reload();assert.equal(f.calls.length,2);assert.equal(f.calls[1].options.method,'GET');assert.equal(f.deps.revision.current,'a1:9:2:0:0');assert.equal(f.deps.locked.current,false);
  f.deps.nombre='Reviewed edit';f.deps.activo=true;await f.save();assert.equal(f.calls.length,3);assert.equal(JSON.parse(f.calls[2].options.body).expected_revision,'a1:9:2:0:0');assert.equal(f.saved.length,1);
});

for(const status of [401,403])for(const stage of ['save','reload'])test(`basic ${stage} ${status} purges identity draft and disallows all subsequent requests`,async()=>{
  const f=fixture(async()=>{throw Object.assign(new Error('private server text'),{status})});
  if(stage==='reload')f.deps.locked.current=true;
  await(stage==='save'?f.save():f.reload());assert.equal(f.deps.accessDenied.current,true);assert.equal(f.deps.revision.current,null);assert.equal(f.denials.length,1);
  assert.ok(f.effects.some(([key,value])=>key==='Nombre'&&value===''));assert.ok(f.effects.some(([key,value])=>key==='Denied'&&value===true));
  assert.equal(JSON.stringify(f.effects).includes('private server text'),false);await f.save();await f.reload();assert.equal(f.calls.length,1);
});

for(const boundary of ['replace','unmount','aba'])for(const stage of ['save','reload'])test(`basic ${stage} ${boundary} drops late effects and cannot dispatch again`,async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise);if(stage==='reload')f.deps.locked.current=true;
  const pending=stage==='save'?f.save():f.reload();f[boundary]();const count=f.effects.length;
  wait.resolve(stage==='save'?{id:9,nombre:'Renamed QA',activo:false,agreement_revision:'a1:9:2:0:0'}:[basic()]);await pending;
  assert.equal(f.effects.length,count);assert.equal(f.saved.length,0);assert.equal(f.denials.length,0);await f.save();await f.reload();assert.equal(f.calls.length,1);
});

test('basic single flight, busy close and global navigation guard preserve draft',async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise),pending=f.save();await f.save();callback('closeIdentity',f.deps)();
  assert.equal(f.calls.length,1);assert.equal(f.effects.some(([key])=>key==='close'),false);assert.deepEqual(callback('identityNavigationStatus',f.deps)(),{dirty:true,busy:true});
  wait.reject(new Error('uncertain'));await pending;assert.deepEqual(callback('identityNavigationStatus',f.deps)(),{dirty:true,busy:false});
  f.deps.window.confirm=()=>false;callback('closeIdentity',f.deps)();assert.equal(f.effects.some(([key])=>key==='close'),false);
});

function renderComponent(name,props,stateOverrides={}){
  let index=0;const deps={React,hasNoConfiguredMonthlyAgreement,useState:initial=>{const own=index++;return[Object.hasOwn(stateOverrides,own)?stateOverrides[own]:initial,()=>{}]},useRef:current=>({current}),useNavigationGuard:()=>{},
    Modal:({children,title})=>React.createElement('section',{},title,children),getEstadoLabel:()=> 'Sin clasificación',getTipoPublicacionLabel:()=> 'Pieza',...props};
  const compiled=ts.transpileModule(owner(name).getText(ast),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  return renderToStaticMarkup(Function(...Object.keys(deps),`${compiled};return ${name}(props);`)(...Object.values(deps),));
}

test('actual basic editor/detail SSR is name/state only: no invented $0, monthly metrics or configuration CTA',()=>{
  // props is deliberately an injected named dependency for the extracted component.
  const props={cliente:basic(),periodo:'2026-10',capture:()=>({current:()=>true}),historias:[],publicaciones:[],onClose:()=>{},onGuardado:()=>{}};
  const editor=renderComponent('EditarIdentidadSession',{props});
  assert.match(editor,/Editar nombre y estado/);assert.match(editor,/Cliente activo/);assert.doesNotMatch(editor,/type="number"|Abono mensual|por mes|Configurar acuerdo/);
  const detail=renderComponent('DetalleClienteSession',{props});assert.match(detail,/Sin acuerdo mensual vigente en este período/);assert.doesNotMatch(detail,/Abono mensual|\$0|cliente-detail-metrics|% del acuerdo|Configurar acuerdo/);
  assert.match(detail,/Piezas del mes/);assert.match(detail,/Editar nombre y estado/);
  const denied=renderComponent('EditarIdentidadSession',{props},{4:true});assert.doesNotMatch(denied,/Basic QA|Nombre del cliente|Guardar cambios/);assert.match(denied,/Acceso no disponible/);
});

test('every actual canonical parent mount wires scope-verified terminal purge; nested denial propagates without a write',()=>{
  const pageSource=readFileSync(new URL('../pages/Clientes.jsx',import.meta.url),'utf8');
  const page=ts.createSourceFile('Clientes.jsx',pageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const parentInit=name=>nodes(page,n=>ts.isVariableDeclaration(n)&&n.name.getText(page)===name)[0].initializer;
  const run=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(page)});`)(...Object.values(deps));
  const mounts=nodes(page,n=>ts.isJsxSelfClosingElement(n)&&['EditarCuotaClienteModal','DetalleClienteModal'].includes(n.tagName.getText(page)));
  assert.equal(mounts.length,2);
  for(const mount of mounts){const prop=mount.attributes.properties.find(p=>p.name?.getText(page)==='onAccessDenied');assert.equal(prop?.initializer?.expression.getText(page),'denyClientAccess');}
  const f=fixture(async()=>{throw new Error('No request during denial')});
  const effects=[],deps={denied:{current:false},loaded:{current:true},loadGeneration:{current:0},overviewLoader:{cancel:()=>effects.push(['cancel'])},modalOpen:{current:true},createRecovery:{current:{snapshot:{blocked:true}}},emptyClientForm:()=>({nombre:'',abono_mensual:''}),createBaseline:{current:'secret'}};
  for(const name of ['NuevoCliente','Clientes','Historias','Publicaciones','ClienteSeleccionado','ClienteCuotaEnEdicion','AltaClienteAbierta','ErrorAltaCliente','CreateStatus','CreationDenied'])deps[`set${name}`]=value=>effects.push([name,value]);
  const terminal=run(parentInit('denyCreationAccess'),deps);
  const notify=run(parentInit('denyClientAccess'),{capture:()=>f.guard,denyCreationAccess:terminal});
  notify({current:()=>false,assertCurrent:()=>assert.fail('obsolete scope cannot assert')});assert.equal(effects.length,0);
  // Execute the actual nested detail callback before the actual parent callback.
  const detailInit=nodes(owner('DetalleClienteSession'),n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='denyDetailAccess')[0].initializer;
  const detail=evaluate(detailInit,{detailAccessDenied:{current:false},nestedEditing:{current:true},setEditandoCuota:()=>{},setError:()=>{},setDetailDenied:()=>{},onAccessDenied:notify});
  detail(f.guard);assert.equal(deps.denied.current,true);assert.equal(deps.createRecovery.current,null);assert.equal(deps.modalOpen.current,false);
  for(const name of ['Clientes','Historias','Publicaciones'])assert.deepEqual(effects.find(([key])=>key===name)?.[1],[]);
  assert.deepEqual(effects.find(([key])=>key==='NuevoCliente')?.[1],{nombre:'',abono_mensual:''});assert.ok(effects.some(([key,value])=>key==='CreationDenied'&&value===true));assert.equal(f.calls.length,0);
  const count=effects.length;f.replace();notify(f.guard);assert.equal(effects.length,count);
  assert.match(pageSource,/if \(creationDenied\) return <main[^\n]*PageState/);
});
