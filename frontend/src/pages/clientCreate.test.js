import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCreatePayload, hasNoConfiguredMonthlyAgreement, verifiedCreatedClient, createClientCreation, CLIENT_CREATE_MODES } from './clientCreate.js';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';

test('basic creation projects only name despite previously entered editorial and unknown fields', () => {
  const form = { nombre: '  Sitio QA  ', rubro: 'Servicios', cuota_reels: '8', cuota_carruseles: '4',
    dias_historias: [1], dias_reels: [2], dias_carruseles: [3], disenador_responsable: 'Histórico',
    abono_mensual: '200000', vigente_desde: '2026-10', client_type: 'project', finance: { private: true } };
  const before = structuredClone(form);
  assert.deepEqual(buildClientCreatePayload(form, 'basic'), { nombre: 'Sitio QA' });
  assert.deepEqual(form, before);
});

test('editorial remains default, projects its existing fields and snapshots day arrays', () => {
  const form = { nombre: ' Editorial ', rubro: 'Servicios', cuota_reels: '2', cuota_carruseles: '0',
    dias_historias: [1], dias_reels: [], dias_carruseles: [], disenador_responsable: 'Histórico',
    abono_mensual: '100', vigente_desde: '2026-10', creation_mode: 'basic' };
  const payload = buildClientCreatePayload(form);
  assert.equal(payload.nombre, 'Editorial'); assert.equal(payload.cuota_reels, 2);
  assert.equal(Object.hasOwn(payload, 'creation_mode'), false);
  form.dias_historias.push(2); assert.deepEqual(payload.dias_historias, [1]);
  assert.throws(() => buildClientCreatePayload(form, 'project'));
  assert.throws(() => buildClientCreatePayload({ nombre: ' ' }, 'basic'));
});

test('missing configuration never erases legacy quotas/feed/fee or invents client type', () => {
  const basic = { configuracion_completa: false, cuota_reels: 0, cuota_carruseles: 0 };
  assert.equal(hasNoConfiguredMonthlyAgreement(basic), true);
  for (const fields of [{ configuracion_completa: undefined }, { configuracion_completa: true },
    { cuota_reels: 2 }, { cuota_carruseles: 1 }, { grupo_feed_id: 9 }, { cuota_feed_reels: 4 },
    { cuota_feed_carruseles: 1 }, { cuota_feed_compartida: 3 }, { abono_mensual: '100' }, { abono_mensual: 0 },
    { configuracion_vigente_desde: '2026-10-01' }, { abono_vigente_desde: '2026-10-01' }, { dias_historias: [1] }]) {
    assert.equal(hasNoConfiguredMonthlyAgreement({ ...basic, ...fields }), false, JSON.stringify(fields));
  }
});

const form = () => ({ nombre:' QA ',rubro:'Servicios',cuota_reels:'2',cuota_carruseles:'0',dias_historias:[1],dias_reels:[],dias_carruseles:[],disenador_responsable:'QA',abono_mensual:'100',vigente_desde:'2026-10' });
const basicAck = () => ({id:9,nombre:'QA',activo:true,agreement_revision:'a1:9:1:0:0',grupo_feed_id:null,rubro:null,cuota_reels:0,cuota_carruseles:0,fecha_inicio:null,configuracion_vigente_desde:null,configuracion_completa:false});
const editorialAck = () => ({...basicAck(),...buildClientCreatePayload(form()),abono_mensual:'100.00',fecha_inicio:'2026-10-01',configuracion_vigente_desde:'2026-10-01',configuracion_completa:true});
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{resolve,reject,promise}};

test('ACK verifies basic has no configuration, while editorial confirms the complete observed agreement', () => {
  assert.equal(verifiedCreatedClient(basicAck(),buildClientCreatePayload(form(),'basic'),'basic').id,9);
  assert.equal(verifiedCreatedClient(editorialAck(),buildClientCreatePayload(form()),'editorial').id,9);
  for(const patch of [{},{id:10},{nombre:'Other'},{activo:false},{agreement_revision:'a1:10:1:0:0'},{agreement_revision:'a1:9:1:0:0\n'},{configuracion_completa:true},{configuracion_vigente_desde:'2026-10-01'},{cuota_reels:2},{abono_mensual:'100'},{grupo_feed_id:1}]) {
    const value=Object.keys(patch).length?{...basicAck(),...patch}:{};
    assert.throws(()=>verifiedCreatedClient(value,{nombre:'QA'},'basic'));
  }
  for(const patch of [{configuracion_completa:false},{dias_historias:[2]},{dias_reels:[3]},{abono_mensual:'200.00'},{disenador_responsable:'Other'},{configuracion_vigente_desde:'2026-11-01'},{cuota_reels:3}]) {
    assert.throws(()=>verifiedCreatedClient({...editorialAck(),...patch},buildClientCreatePayload(form()),'editorial'));
  }
});

const source=readFileSync(new URL('./Clientes.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('Clientes.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function find(predicate){let found;function visit(node){if(predicate(node)&&!found)found=node;ts.forEachChild(node,visit)}visit(ast);assert.ok(found);return found;}
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(ast)});`)(...Object.values(deps));
const callback=(name,deps)=>evaluate(find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name).initializer,deps);
function fixture(request){
  let live={token:'synthetic-A',usuario:{id:7,rol:'admin',activo:true}},mounted=true,observation={};const original=live,held=observation,calls=[],effects=[];
  const scope=createCapturedRequest({session:original,readSession:()=>live,isActive:()=>mounted&&observation===held,request:async(url,options)=>{calls.push({url,options});return request(url,options)}});
  const deps={capture:()=>scope,captureLifetime:()=>scope,createClientCreation,isSessionFailure,createRecovery:{current:null},creating:{current:false},denied:{current:false},loaded:{current:true},loadGeneration:{current:0},overviewLoader:{cancel:()=>effects.push(['cancelRead'])},modalOpen:{current:true},createBaseline:{current:''},view:{role:'admin'},basicCreation:true,nuevoCliente:form(),altaClienteValida:true,validarCuota:()=>true,
    mesSeleccionado:'2026-10',emptyClientForm:()=>({}),deferredLoad:{current:false},closeModal:()=>effects.push(['close'])};
  for(const name of ['GuardandoCliente','ErrorAltaCliente','Clientes','NuevoCliente','AltaClienteAbierta','CreateStatus','Historias','Publicaciones','ClienteSeleccionado','ClienteCuotaEnEdicion','CreationDenied'])deps[`set${name}`]=value=>effects.push([name,value]);
  deps.denyCreationAccess=callback('denyCreationAccess',deps);
  return{deps,calls,effects,submit:()=>callback('crearCliente',deps)({preventDefault(){}}),refresh:()=>callback('refreshCreationPortfolio',deps)(),replace(){live={token:'synthetic-B',usuario:{id:8,rol:'admin',activo:true}}},unmount(){mounted=false},aba(){observation={}}};
}

for(const basic of [true,false])test(`actual ${basic?'basic':'editorial'} callback captures body and single flight, only verified ACK closes`,async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise);f.deps.basicCreation=basic;
  const pending=f.submit();await f.submit();assert.equal(f.calls.length,1);
  const body=JSON.parse(f.calls[0].options.body);assert.deepEqual(body,basic?{nombre:'QA'}:buildClientCreatePayload(form()));
  f.deps.nuevoCliente.nombre='Changed';f.deps.nuevoCliente.dias_historias.push(2);assert.equal(body.nombre,'QA');
  wait.resolve(basic?basicAck():editorialAck());await pending;assert.ok(f.effects.some(([name])=>name==='close'));
});

for(const basic of [true,false])for(const failure of ['network','malformed',400,409,503])test(`actual ${basic?'basic':'editorial'} ${failure} locks POST, refresh is GET-only and same-name row never ACK`,async()=>{
  const f=fixture(async(_url,options)=>{if(options.method==='GET')return[basicAck()];if(failure==='malformed')return{};throw Object.assign(new Error('failure'),{status:typeof failure==='number'?failure:undefined})});f.deps.basicCreation=basic;
  await f.submit();assert.equal(f.calls.length,1);assert.equal(f.deps.createRecovery.current.snapshot.blocked,true);assert.equal(f.effects.some(([name])=>name==='close'),false);
  await f.submit();assert.equal(f.calls.length,1);
  await f.refresh();assert.equal(f.calls.length,2);assert.equal(f.calls[1].options.method,'GET');assert.equal(f.calls[1].url,'/api/clientes?periodo=2026-10');
  assert.equal(f.deps.createRecovery.current.snapshot.blocked,true);assert.equal(f.effects.some(([name])=>name==='close'),false);assert.equal(f.deps.nuevoCliente.nombre,' QA ');
  await f.submit();assert.equal(f.calls.length,2);
});

for(const basic of [true,false])for(const [status,code,message] of [[400,'CLIENT_CREATE_INPUT_INVALID','El rubro es obligatorio.'],[409,'CLIENT_NAME_EXISTS','Ya existe un cliente con ese nombre.']])test(`actual ${basic?'basic':'editorial'} typed ${code} preserves form and permits only a manual corrected submission`,async()=>{
  let attempts=0;const f=fixture(async()=>{if(++attempts===1)throw Object.assign(new Error(message),{status,code});return{...(basic?basicAck():editorialAck()),nombre:'Corrected QA'}});f.deps.basicCreation=basic;
  const before=structuredClone(f.deps.nuevoCliente);await f.submit();
  assert.equal(f.calls.length,1);assert.deepEqual(f.deps.nuevoCliente,before);assert.equal(f.effects.some(([key])=>key==='close'),false);
  assert.equal(f.deps.createRecovery.current.snapshot.blocked,false);assert.equal(f.deps.createRecovery.current.snapshot.submitted,false);
  assert.ok(f.effects.some(([key,value])=>key==='ErrorAltaCliente'&&value===message));
  await assert.rejects(f.deps.createRecovery.current.refresh('2026-10'));assert.equal(f.calls.length,1,'A safe rejection does not start a GET or retry');
  f.deps.nuevoCliente.nombre='Corrected QA';await f.submit();assert.equal(f.calls.length,2);
  assert.equal(JSON.parse(f.calls[1].options.body).nombre,'Corrected QA');assert.ok(f.calls.every(call=>call.options.method==='POST'));
  assert.ok(f.effects.some(([key])=>key==='close'));assert.equal(attempts,2);
});

for(const [status,code] of [[400,'CLIENT_NAME_EXISTS'],[409,'CLIENT_CREATE_INPUT_INVALID'],[501,'CLIENT_NAME_EXISTS'],[503,'CLIENT_CREATE_INPUT_INVALID'],[409,'CLIENT_NAME_EXISTS\n'],[400,undefined]])test(`non-exact status/code ${status}/${code} remains uncertain and cannot resubmit`,async()=>{
  const f=fixture(async()=>{throw Object.assign(new Error('Do not interpret as rejection'),{status,code})});await f.submit();
  assert.equal(f.deps.createRecovery.current.snapshot.blocked,true);assert.equal(f.deps.createRecovery.current.snapshot.rejection,null);
  f.deps.nuevoCliente.nombre='Corrected';await f.submit();assert.equal(f.calls.length,1);
});

test('late typed duplicate rejection after actor replacement cannot unlock or paint the old form',async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise),pending=f.submit();f.replace();const count=f.effects.length;
  wait.reject(Object.assign(new Error('Old actor name conflict'),{status:409,code:'CLIENT_NAME_EXISTS'}));await pending;
  assert.equal(f.effects.length,count);assert.equal(f.deps.createRecovery.current.snapshot.blocked,true);await f.submit();assert.equal(f.calls.length,1);
});

for(const boundary of ['replace','unmount','aba'])for(const stage of ['post','refresh'])test(`actual ${stage} ${boundary} suppresses late publication and followups`,async()=>{
  const wait=deferred(),f=fixture(async(_url,options)=>{if(stage==='refresh'&&options.method==='POST')throw new TypeError('uncertain');return wait.promise});
  let pending;if(stage==='refresh'){await f.submit();pending=f.refresh()}else pending=f.submit();
  f[boundary]();const count=f.effects.length;wait.resolve(stage==='refresh'?[basicAck()]:basicAck());await pending;
  assert.equal(f.effects.length,count);assert.equal(f.calls.length,stage==='refresh'?2:1);await f.submit();assert.equal(f.calls.length,stage==='refresh'?2:1);
});

test('actual navigation status treats mode changes and uncertain attempts as dirty, stale identity never traps reauth',()=>{
  const base=form(),recovery={current:null},deps={capture:()=>({current:()=>true}),denied:{current:false},altaClienteAbierta:true,nuevoCliente:base,createBaseline:{current:JSON.stringify(base)},creating:{current:false},createRecovery:recovery};
  assert.deepEqual(callback('clientCreateNavigationStatus',deps)(),{dirty:false,busy:false});base.creation_mode='basic';assert.equal(callback('clientCreateNavigationStatus',deps)().dirty,true);
  deps.createBaseline.current=JSON.stringify(base);recovery.current={snapshot:{blocked:true}};assert.equal(callback('clientCreateNavigationStatus',deps)().dirty,true);
  deps.creating.current=true;assert.equal(callback('clientCreateNavigationStatus',deps)().busy,true);
  deps.capture=()=>({current:()=>false});assert.deepEqual(callback('clientCreateNavigationStatus',deps)(),{dirty:false,busy:false});
});

for(const status of [401,403])for(const stage of ['post','refresh'])test(`${stage} ${status} purges private state and denies every subsequent POST/GET`,async()=>{
  const f=fixture(async(_url,options)=>{if(stage==='refresh'&&options.method==='POST')throw new TypeError('uncertain');throw Object.assign(new Error('private denial detail'),{status})});
  let operation;if(stage==='refresh'){await f.submit();operation=f.deps.createRecovery.current;await f.refresh()}else{const pending=f.submit();operation=f.deps.createRecovery.current;await pending;}
  assert.equal(operation.snapshot.denied,true);assert.equal(operation.snapshot.blocked,false);assert.equal(operation.snapshot.busy,false);
  assert.equal(f.deps.denied.current,true);assert.equal(f.deps.createRecovery.current,null);assert.equal(f.deps.modalOpen.current,false);assert.equal(f.deps.loadGeneration.current,1);
  for(const name of ['Clientes','Historias','Publicaciones'])assert.deepEqual(f.effects.find(([key])=>key===name)?.[1],[]);
  assert.deepEqual(f.effects.find(([key])=>key==='NuevoCliente')?.[1],{});
  assert.ok(f.effects.some(([key,value])=>key==='CreationDenied'&&value===true));
  assert.ok(f.effects.some(([key])=>key==='cancelRead'));assert.equal(f.effects.some(([,value])=>typeof value==='string'&&value.includes('private denial detail')),false);
  const count=f.calls.length;await f.submit();await f.refresh();await assert.rejects(operation.submit(form(),'basic'));await assert.rejects(operation.refresh('2026-10'));assert.equal(f.calls.length,count);
});

test('actual modal SSR shows a name-only basic step, keeps editorial steps, and recovery exposes only read/exit actions',()=>{
  const modal=find(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='Modal');
  const compiled=ts.transpileModule(`function render(){return (${modal.getText(ast)});}`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  function render(basic,blocked=false){const noop=()=>{},deps={React,Modal:({children})=>React.createElement('section',{},children),epoch:0,mesSeleccionado:'2026-10',cerrarAltaCliente:noop,crearCliente:noop,refreshCreationPortfolio:noop,
    guardandoCliente:false,createStatus:{blocked},nuevoCliente:{...form(),creation_mode:basic?'basic':'editorial'},basicCreation:basic,createRecovery:{current:null},creating:{current:false},CLIENT_CREATE_MODES,
    pasoAltaCliente:1,pasoIdentidadValido:true,pasoAcuerdoValido:true,pasoResponsableValido:true,altaClienteValida:true,RUBROS:[],WEEKDAYS:[],setNuevoCliente:noop,setPasoAltaCliente:noop,errorAltaCliente:blocked?'Alta sin confirmar':null};
    return renderToStaticMarkup(Function(...Object.keys(deps),`${compiled};return render();`)(...Object.values(deps)));}
  const basic=render(true);assert.match(basic,/Sin acuerdo mensual/);assert.match(basic,/Nombre del cliente/);assert.doesNotMatch(basic,/Configuración desde|Rubro|Diseñador responsable|Abono mensual|Paso 1 de 3/);assert.match(basic,/Crear cliente/);
  const editorial=render(false);assert.match(editorial,/Paso 1 de 3/);assert.match(editorial,/Rubro/);assert.match(editorial,/Configuración desde/);
  const recovery=render(true,true);assert.match(recovery,/<fieldset disabled=""/);assert.match(recovery,/Actualizar cartera sin crear/);assert.match(recovery,/Salir y revisar cartera/);assert.doesNotMatch(recovery,/Verificar creación|Reintentar creación/);
  const css=readFileSync(new URL('./ClientesCreate.css',import.meta.url),'utf8');assert.match(css,/min-height: 44px/);assert.match(css,/@media \(max-width: 600px\)/);assert.match(css,/flex-wrap: wrap/);assert.match(css,/focus-visible/);
});
