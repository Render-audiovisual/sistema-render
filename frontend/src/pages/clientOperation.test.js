import test from 'node:test';
import assert from 'node:assert/strict';
import { clientOperationHref, readClientOperationLocation, clientOperationLocationUrl, parseClientOperation, createClientOperationLoader } from './clientOperation.js';
import { goalClientHref } from './clientGoalLocation.js';
import { productionLocation, productionReadUrl } from './productionRouteContext.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const selection={clientId:7,period:'2026-10'};
const uid='11111111-2222-4333-8444-555555555555';
const sect=(scope,counts,items)=>({scope,counts,total:items.length,items,has_more:false,href:'javascript:untrusted'});
function fixture() {
 const account={id:7,nombre:'Marca <script>'};
 return {version:1,generated_at:'2026-10-21T12:00:00.000Z',periodo:'2026-10',cliente:{...account,activo:true,rubro:null,fee:999},
 tareas:sect('render_os_cliente_sin_archivo_ni_papelera',{pendiente:1,en_progreso:0,en_revision:0,aprobada:0,finalizada:0,otros:0},[{id:8,titulo:'Trabajo',estado:'pendiente',revision:1,fecha_vencimiento:null,href:'https://evil.test'}]),
 proyectos:sect('compartidos_no_archivados_todos_los_periodos',{no_archivados:1},[{id:uid,titulo:'Web',tipo:'web',estado:'en_progreso',revision:2,fecha_inicio:null,fecha_entrega:'2026-11-01',responsable:{id:11,nombre:'Alex'},counts:{tareas:2,finalizadas:1,hitos:0,entregables:0}}]),
 producciones:sect('visitas_mes_y_banco_pendiente_global',{visitas:1,videos_registrados:3,videos_reutilizados:1,registros_fotos:1,pendientes_banco_todos_los_periodos:4,fotos_pendientes_banco_todos_los_periodos:2},[{id:uid,titulo:'Visita',revision:1,fecha:'2026-10-03',videos_registrados:3,registros_fotos:1}]),
 editorial:sect('cohorte_mes_programado_visible',{confirmada_manualmente:0,historica_sin_confirmacion:1,no_publicada:1},['historia','publicacion'].map(domain=>({domain,id:8,titulo:'<img src=x onerror=alert(1)>',tipo:domain==='historia'?'historia':'video',estado:domain==='historia'?'publicada':'lista',fecha_programada:'2026-10-05',publicacion_evidencia:{classification:domain==='historia'?'historica_sin_confirmacion':'no_publicada',revision:0,confirmation:null}}))),
 objetivos:sect('objetivos_mes_por_grupo_sin_sumar_cuotas',{preparados:1,por_preparar:0},[{id:9,clave:'grupo-5',nombre:'Feed compartido',cuentas:[account,{id:12,nombre:'Otra cuenta'}],preparado:true,quota:{reels:3,carruseles:1},cuota_actual:{reels:4,carruseles:1},cuota_desactualizada:true,progress:{reels:{total:3,completed:1},carruseles:{total:1,completed:0}},extras:{total:2,completed:1}}]),
 financial:{salary:'SECRET'},metadata:{private:'SECRET'}};
}
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const session=id=>({token:`synthetic-${id}`,usuario:{id,rol:'admin',activo:true}});

test('operation URL is a real client ID and explicit month, never a feed key or name',()=>{
  assert.equal(clientOperationHref(7,'2026-10'),'/clientes/operacion?cliente=7&periodo=2026-10');
  for(const id of ['7','grupo-7','cliente-7','Same name',0,-1,2147483648]) assert.equal(clientOperationHref(id,'2026-10'),null);
  for(const period of ['2026-13','0000-01','2026-10\n','2026-1',null]) assert.equal(clientOperationHref(7,period),null);
});

test('closed DTO projects safe links, preserves domain collisions and separate shared goals/extras without mutation or finance',()=>{
 const raw=fixture(),before=structuredClone(raw),data=parseClientOperation(raw,selection);
 assert.deepEqual(raw,before);assert.equal(data.tareas.items[0].href,'/workspace/tareas?task=8');
 assert.equal(data.editorial.items.length,2);assert.equal(data.editorial.items[0].cliente.id,7);
 assert.equal(data.objetivos.items[0].cuentas.length,2);assert.deepEqual(data.objetivos.items[0].extras,{total:2,completed:1});
 assert.doesNotMatch(JSON.stringify(data),/SECRET|financial|metadata|fee|javascript|evil/);
 raw.objetivos.items.push({...structuredClone(raw.objetivos.items[0]),id:10,clave:'cliente-7'});raw.objetivos.total=2;raw.objetivos.counts.preparados=2;
 assert.equal(parseClientOperation(raw,selection).objetivos.items.length,2);
});
test('invalid identities, counts, dates, memberships, duplicate domain keys, progress and unknown shapes fail closed',()=>{
 const corrupt=[x=>x.version=2,x=>x.cliente.id=9,x=>x.periodo='2026-09',x=>delete x.tareas.counts.otros,x=>x.proyectos.items[0].id=7,x=>x.tareas.total=0,x=>x.tareas.has_more=true,x=>x.producciones.items[0].fecha='2026-02-30',x=>x.producciones.items[0].fecha='2026-11-01',x=>x.editorial.items[1].domain='historia',x=>x.editorial.items[0].publicacion_evidencia.classification='no_publicada',x=>x.objetivos.items[0].cuentas=[{id:9,nombre:'wrong'}],x=>x.objetivos.items[0].progress.reels.completed=4,x=>x.objetivos.items[0].preparado='true',x=>x.producciones.counts.registros_fotos=-1,x=>x.tareas.items[0].revision=2147483648];
 for(const change of corrupt){const raw=fixture();change(raw);assert.throws(()=>parseClientOperation(raw,selection));}
 const valid=fixture();valid.proyectos.items[0].fecha_entrega='2028-02-29';assert.ok(parseClientOperation(valid,selection));
});
test('confirmed publication requires the exact manual evidence shape, never a task state or metadata flag',()=>{
 const raw=fixture(),item=raw.editorial.items[0];item.publicacion_evidencia={classification:'confirmada_manualmente',revision:1,confirmation:{id:uid,actor_id:11,occurred_at:'2026-10-05T12:00:00.000Z',recorded_at:'2026-10-05T12:01:00.000Z',source:'manual'}};raw.editorial.counts={confirmada_manualmente:1,historica_sin_confirmacion:0,no_publicada:1};
 assert.equal(parseClientOperation(raw,selection).editorial.items[0].publication_classification,'confirmada_manualmente');
 for(const change of [x=>x.revision=0,x=>x.confirmation={},x=>x.confirmation.source='metadata',x=>x.confirmation.actor_id='11',x=>x.confirmation.recorded_at='2026-02-30T12:00:00.000Z']){const bad=structuredClone(raw);change(bad.editorial.items[0].publicacion_evidencia);assert.throws(()=>parseClientOperation(bad,selection));}
});
test('loader uses exact bounded GET original bearer; superseded period/client/ABA, errors and disposal never publish',async()=>{
 const a=session(11);let live=a;const pending=[],states=[];
 const loader=createClientOperationLoader({capture:()=>createCapturedRequest({session:a,readSession:()=>live,request:(url,options)=>{const d=defer();pending.push({url,options,...d});return d.promise;}}),onChange:s=>states.push(s)});
 const first=loader.load(selection);assert.equal(pending[0].url,'/api/clientes/7/operacion?periodo=2026-10');assert.equal(pending[0].options.headers.Authorization,'Bearer synthetic-11');
 const second=loader.load({...selection,period:'2026-11'});const third=loader.load(selection);
 assert.equal(pending[0].options.signal.aborted,true);pending[0].resolve(fixture());pending[1].reject(Error('private error'));pending[2].resolve(fixture());await Promise.all([first,second,third]);
 assert.equal(states.filter(s=>s.status==='ready').length,1);assert.equal(states.at(-1).data.periodo,'2026-10');
 const fourth=loader.load(selection);live=session(22);pending[3].resolve(fixture());assert.equal(await fourth,null);assert.equal(states.at(-1).status,'loading');
 live=a;const fifth=loader.load(selection);loader.dispose();pending[4].reject(Error('late'));await fifth;assert.notEqual(states.at(-1).status,'error');
});
test('403 and 401 purge ready data, stay denied and cannot retry GET; generic errors expose no raw message',async()=>{
 for(const status of [401,403,500]){
  let requestCount=0, fail=false;const states=[];const a=session(11);
  const loader=createClientOperationLoader({capture:()=>createCapturedRequest({session:a,readSession:()=>a,request:async()=>{requestCount++;if(fail)throw Object.assign(Error('SECRET'),{status});return fixture();}}),onChange:s=>states.push(s)});
  await loader.load(selection);assert.equal(states.at(-1).status,'ready');fail=true;await loader.load(selection);
  assert.equal(states.at(-1).data,null);assert.doesNotMatch(states.at(-1).error,/SECRET/);
  assert.equal(states.at(-1).status,status===500?'error':'denied');await loader.load(selection);assert.equal(requestCount,status===500?3:2);
 }
});
test('genuine cookie session passes intent without Authorization and fresh generation invalidates old same-ID DTO',async()=>{
 const store=createBrowserSessionState();const install=()=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id:11,nombre:'QA',usuario:'qa',rol:'admin',activo:true},session_context:'A'.repeat(43),csrf_token:'C'.repeat(43)});
 install();const a=store.getSession(),wait=defer(),states=[];let options;
 const loader=createClientOperationLoader({capture:()=>createCapturedRequest({session:a,readSession:store.getSession,request:async(url,opts)=>{options=opts;return wait.promise;}}),onChange:s=>states.push(s)});
 const result=loader.load(selection);assert.ok(options.sessionIntent);assert.equal(options.headers.Authorization,undefined);install();wait.resolve(fixture());assert.equal(await result,null);assert.equal(states.length,1);
});

const source=readFileSync(new URL('./ClientOperationPage.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('ClientOperationPage.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function componentFunctions(){const names=['HubLink','Preview','Block','ClientOperationRead'];return ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['states','evidence'].includes(d.name.getText(ast)))).map(n=>n.getText(ast)).join('\n');}
function renderHub(data,role='admin') {
 const code=ts.transpileModule(componentFunctions(),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
 const Component=new Function('goalClientHref','React','useScopedRequest','useState','useRef','useEffect','canReadEditorialControl','EditorialPieceDetails',`${code};return ClientOperationRead;`)(goalClientHref,React,()=>({view:{session:session(11),role},capture:()=>{}}),()=>[{status:'ready',data,error:''},()=>{}],()=>({current:null}),()=>{},()=>true,props=>React.createElement('span',{'data-domain':props.piece.domain,'data-id':props.piece.id},'Detalle de pieza'));
 return renderToStaticMarkup(React.createElement(Component,{session:session(11),selection}));
}
test('actual hub JSX SSR shows real scopes, accounts, extras, evidence and inline exact pieces, no finance or unsafe URLs',()=>{
 assert.equal(ast.parseDiagnostics.length,0);const data=parseClientOperation(fixture(),selection),html=renderHub(data);
 assert.match(html,/todos los períodos/);assert.match(html,/Feed compartido/);assert.match(html,/Otra cuenta \(#12\)/);assert.match(html,/Contenido adicional/);
 assert.match(html,/trabajo no confirma una publicación/);assert.match(html,/histórica sin confirmación/);assert.match(html,/data-domain="historia"/);assert.match(html,/data-domain="publicacion"/);
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|javascript:|SECRET|fee|salary/);assert.match(html,/Administrar cliente/);assert.doesNotMatch(renderHub(data,'edicion'),/Administrar cliente/);
 assert.equal((html.match(/href="\/clientes\?cliente=7&amp;periodo=2026-10"/g)||[]).length,2,'Both return links retain exact client and month');
});
test('client bank distinguishes video and photo backlogs, independent of monthly photo records',()=>{
 const raw=fixture();raw.producciones.counts.pendientes_banco_todos_los_periodos=0;
 raw.producciones.counts.registros_fotos=0;
 const parsed=parseClientOperation(raw,selection),html=renderHub(parsed,'edicion');
 assert.equal(parsed.producciones.counts.fotos_pendientes_banco_todos_los_periodos,2);
 assert.match(html,/Videos pendientes · todos los períodos<\/dt><dd>0/);
 assert.match(html,/Fotos pendientes · todos los períodos<\/dt><dd>2/);
 assert.match(html,/href="\/producciones\?cliente=7&amp;tab=pending"[^>]*>Abrir banco de pendientes/);
 const destination=productionLocation('http://localhost/producciones?cliente=7&tab=pending');
 assert.equal(destination.tab,'pending');assert.equal(destination.clientId,'7');assert.equal(destination.month,null);
 assert.equal(productionReadUrl(destination),'/api/producciones/pendientes?cliente_id=7');
 assert.doesNotMatch(html,/Banco pendiente · todos los períodos/);
 for(const value of [undefined,-1,'2',null,NaN]){
  const invalid=fixture();invalid.producciones.counts.fotos_pendientes_banco_todos_los_periodos=value;
  assert.throws(()=>parseClientOperation(invalid,selection));
 }
});
test('actual unprepared goal render never claims zero-ratio completion; prepared goals retain observed progress',()=>{
 const raw=fixture(),goal=raw.objetivos.items[0];goal.preparado=false;goal.quota={reels:0,carruseles:0};goal.progress={reels:{total:0,completed:0},carruseles:{total:0,completed:0}};goal.extras={total:0,completed:0};raw.objetivos.counts={preparados:0,por_preparar:1};
 const basic=renderHub(parseClientOperation(raw,selection));assert.match(basic,/Todavía no se preparó el objetivo de este mes\./);assert.doesNotMatch(basic,/0\/0|Reels · trabajo completado|Carruseles · trabajo completado|Contenido adicional · fuera de cuota|Cuota prevista/);
 goal.quota={reels:3,carruseles:1};goal.progress={reels:{total:3,completed:0},carruseles:{total:1,completed:0}};
 const nominal=renderHub(parseClientOperation(raw,selection));assert.match(nominal,/Cuota prevista: 3 reels · 1 carruseles/);assert.doesNotMatch(nominal,/0\/3|0\/1|0\/0/);
 const prepared=renderHub(parseClientOperation(fixture(),selection));assert.match(prepared,/Reels · trabajo completado/);assert.match(prepared,/1\/3/);assert.match(prepared,/0\/1/);assert.match(prepared,/1\/2 completado/);assert.doesNotMatch(prepared,/Todavía no se preparó/);
});
test('source wiring preserves URL-before-GET, popstate cleanup, keyed session/context and actual per-account entries',()=>{
 assert.ok(source.indexOf('window.history.replaceState')<source.indexOf('void current.load(selection)'));
 assert.match(source,/removeEventListener\('popstate',pop\)/);assert.match(source,/key=\{view.key\}/);assert.match(source,/key=\{`\$\{location.epoch\}/);assert.match(source,/current.dispose\(\)/);
 assert.doesNotMatch(source,/localStorage|fetch\(|dangerouslySetInnerHTML|\/piezas\?/);
 const goals=readFileSync(new URL('./ClientesObjetivos.jsx',import.meta.url),'utf8'),modals=readFileSync(new URL('../components/ClienteModals.jsx',import.meta.url),'utf8');
 assert.match(goals,/client.cuentas.map\(account => <a/);assert.match(goals,/clientOperationHref\(account.id, period\)/);assert.match(modals,/clientOperationHref\(cliente.id, periodo\)/);
 const css=readFileSync(new URL('./ClientOperation.css',import.meta.url),'utf8');assert.match(css,/min-height:44px/);assert.match(css,/focus-visible/);assert.match(css,/max-width:700px/);assert.doesNotMatch(css,/--render-border|--render-text|--render-font-body/);
});
test('hub CSS uses canonical sidebar token for expanded/collapsed direct-main shell and clears offset below desktop breakpoint',()=>{
 const css=readFileSync(new URL('./ClientOperation.css',import.meta.url),'utf8'),sidebar=readFileSync(new URL('../components/Sidebar.css',import.meta.url),'utf8'),tokens=readFileSync(new URL('../design-system.css',import.meta.url),'utf8');
 const base=css.match(/^\.client-operation\{([^}]+)\}/)[1];
 assert.match(base,/box-sizing:border-box/);assert.match(base,/margin:0 0 0 var\(--render-sidebar-width,236px\)/);assert.match(base,/width:calc\(100% - var\(--render-sidebar-width,236px\)\)/);assert.match(base,/max-width:none/);
 assert.match(tokens,/--render-sidebar-width: 236px/);
 assert.match(sidebar,/@media \(min-width: 981px\)/);assert.match(sidebar,/\.sidebar\[data-collapsed="true"\] ~ main,[\s\S]*?--render-sidebar-width: 72px;[\s\S]*?width: calc\(100% - 72px\)/);
 assert.match(css,/@media\(max-width:980px\)\{\.client-operation\{margin-left:0;width:100%;padding-top:calc\(var\(--render-mobile-header-height,64px\) \+ 16px\)\}/);
 const mobile=css.match(/@media\(max-width:700px\)\{\.client-operation\{([^}]+)\}/)[1];assert.match(mobile,/padding-inline:16px/);assert.doesNotMatch(mobile,/(?:^|;)padding:|margin-left|width:/);
});

test('missing period is visible current month and must be canonicalized before GET; malformed/duplicate keys never select another client',()=>{
  assert.deepEqual(readClientOperationLocation('?cliente=7','2026-10-21'),{clientId:7,period:'2026-10',needsPeriod:true});
  assert.deepEqual(readClientOperationLocation('?cliente=7&periodo=2025-08','2026-10-21'),{clientId:7,period:'2025-08',needsPeriod:false});
  for(const query of ['', '?cliente=7&cliente=8','?cliente=07','?cliente=7%0A','?cliente=grupo-7','?cliente=2147483648','?cliente=7&periodo=','?cliente=7&periodo=2026-10&periodo=2026-11','?cliente=7&periodo=2026-13']) assert.throws(()=>readClientOperationLocation(query,'2026-10-21'));
  const selection=readClientOperationLocation('?cliente=7','2026-10-21');
  assert.equal(clientOperationLocationUrl('https://render.test/clientes/operacion?cliente=7&other=x#summary',selection),'/clientes/operacion?cliente=7&other=x&periodo=2026-10#summary');
  assert.throws(()=>clientOperationLocationUrl('https://render.test/clientes',{clientId:7,period:'2026-10'}));
  for(const search of ['?cliente=7&cliente[]=8','?cliente=7&cliente[id]=8','?cliente=7&periodo[]=2026-10','?cliente=7&periodo=2026-10&periodo[x]=2025-01']) assert.throws(()=>readClientOperationLocation(search,'2026-10-21'));
  for(const generated_at of ['2026-02-30T12:00:00.000Z','2026-10-21T24:00:00.000Z','2026-10-21T12:00:00.000Z\n','0000-10-21T12:00:00.000Z']) assert.throws(()=>parseClientOperation({...fixture(),generated_at},selection));
});
