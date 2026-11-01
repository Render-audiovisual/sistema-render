import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {isSessionFailure} from '../shared/session/captured-request.js';

const source=readFileSync(new URL('./InstagramClientReport.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('InstagramClientReport.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const css=readFileSync(new URL('./InstagramClientReport.css',import.meta.url),'utf8');
const code=ts.transpileModule(tree.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(tree)).join('\n'),
  {compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function compile(overrides={}){
  const deps={React,useEffect:React.useEffect,useState:React.useState,useRef:React.useRef,isSessionFailure,
    getSesion:()=>({usuario:{id:7,rol:'admin'}}),useScopedRequest:()=>({view:{role:'admin',key:'qa',session:{}},epoch:0,capture:()=>{throw Error('SSR never requests');}}),
    window:{location:{search:'?cliente=cliente-1&periodo=2026-10'}},...overrides};
  const exports={};Function('exports',...Object.keys(deps),code)(exports,...Object.values(deps));return exports;
}
const api=compile();
const params={cliente:'cliente-1',periodo:'2026-10'};
function fixture(status='historical',reels=3,carruseles=1){
  return {clave:'cliente-1',cliente:'Cliente de prueba',periodo:'2026-10',cuentas:['cuenta_qa'],
    format_counts:{status,reels,carruseles,checkedAt:'2026-11-01T15:00:00.000Z'},
    fulfillment:{reels:{cantidad:reels,cuota:4,porcentaje:reels===null?null:Math.min(100,reels/4*100)},carruseles:{cantidad:carruseles,cuota:2,porcentaje:carruseles===null?null:Math.min(100,carruseles/2*100)}},
    coverage:{status,source:'profile_observations',complete:true,checkedAt:'2026-11-01T15:00:00.000Z',render_count_known:status==='owner_record'},
    dataFecha:'2026-11-01T15:00:00.000Z',actual:{piezas:25,reels:999,carruseles:888,alcance:2000,vistas:3000,interacciones:100},anterior:{},formatos:{},piezas:[],destacadas:[]};
}
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('strict route parser and per-client links reject duplicates, unexpected fields, overflow and invalid periods',()=>{
  assert.deepEqual(api.readReportParams('?periodo=2026-10&cliente=cliente-1'),params);
  for(const key of ['cliente-1','grupo-7','cliente-2147483647']){
    assert.equal(api.clientReportHref(key,'2026-11'),`/instagram/reporte?cliente=${key}&periodo=2026-11`);
    assert.equal(api.readReportParams(`cliente=${key}&periodo=2026-11`).cliente,key);
  }
  for(const search of ['',null,'cliente=cliente-0&periodo=2026-10','cliente=cliente-2147483648&periodo=2026-10','cliente=grupo-01&periodo=2026-10',
    'cliente=cliente-1&periodo=2026-13','cliente=cliente-1&periodo=1999-10','cliente=cliente-1&periodo=2026-10&cliente=cliente-1',
    'cliente=cliente-1&periodo=2026-10&periodo=2026-10','cliente=cliente-1&periodo=2026-10&token=bad','cliente=cliente-1%0A&periodo=2026-10'])assert.equal(api.readReportParams(search),null);
  assert.equal(api.clientReportHref('cliente-1','2026-13'),null);
});

test('two independent server format cards never use legacy actual counts or blend formats',()=>{
  const data=fixture();
  const reels=render(api.ClientReportFormatCard,{label:'Reels',format:'reels',data});
  const carruseles=render(api.ClientReportFormatCard,{label:'Carruseles',format:'carruseles',data});
  assert.match(reels,/<strong>3<\/strong>/);assert.match(reels,/aria-valuetext="3 de 4"/);assert.match(reels,/width:75%/);
  assert.match(carruseles,/<strong>1<\/strong>/);assert.match(carruseles,/aria-valuetext="1 de 2"/);assert.match(carruseles,/width:50%/);
  assert.doesNotMatch(reels+carruseles,/999|888/);
  data.fulfillment.reels.cantidad=99;assert.equal(api.reportFormatState(data,'reels').percentage,null);
});

test('unknown is not zero, empty verified remains zero, and stale keeps its dated count',()=>{
  const unknown=fixture('unavailable',0,0);
  assert.equal(api.reportFormatState(unknown,'reels').count,null);
  const html=render(api.ClientReportFormatCard,{label:'Reels',format:'reels',data:unknown});
  assert.match(html,/<strong>—<\/strong>/);assert.doesNotMatch(html,/role="progressbar"/);
  const zero=render(api.ClientReportFormatCard,{label:'Reels',format:'reels',data:fixture('current',0,0)});
  assert.match(zero,/<strong>0<\/strong>/);assert.match(zero,/role="progressbar"/);
  assert.match(api.reportEvidenceLabel(fixture('stale').format_counts),/Última comprobación.*Pendiente de actualizar/);
  const legacy=fixture();delete legacy.format_counts;assert.equal(api.reportFormatState(legacy,'reels').count,null);
});

test('zero quota locks but preserves extras; null quota is unconfigured, never excluded',()=>{
  const data=fixture();data.fulfillment.carruseles.cuota=0;data.fulfillment.carruseles.porcentaje=null;
  const extra=render(api.ClientReportFormatCard,{label:'Carruseles',format:'carruseles',data});
  assert.match(extra,/<strong>1<\/strong>/);assert.match(extra,/No incluido/);assert.match(extra,/fuera de la cuota/);assert.doesNotMatch(extra,/role="progressbar"/);
  data.fulfillment.reels.cuota=null;
  const missing=render(api.ClientReportFormatCard,{label:'Reels',format:'reels',data});
  assert.match(missing,/Sin configuración/);assert.doesNotMatch(missing,/No incluido|role="progressbar"/);
});

test('owner record keeps 3/1, dates its record and never claims closure or identifies particular Render posts',()=>{
  const data=fixture('owner_record');const html=render(api.ClientReportDocument,{data});
  assert.match(html,/Registrado por dirección/);assert.match(html,/No acredita el cierre/);assert.doesNotMatch(html,/Cierre comprobado|Confirmado por dirección/);
  assert.match(html,/Dirección registró 3 reels y 1 carruseles de Render/);
  assert.match(html,/no identifica qué publicaciones realizó Render/);
  assert.equal(api.reportFormatState(data,'reels').count,3);assert.equal(api.reportFormatState(data,'carruseles').count,1);
  assert.match(html,/Fecha del dato:/);assert.doesNotMatch(html,/Emitido:/);
});

test('advanced statistics and all public posts remain inside closed details, without internal IDs as keys',()=>{
  const data=fixture();data.piezas=Array.from({length:31},(_,i)=>({permalink:`https://www.instagram.com/p/Post${i}/`,tipo:i%2?'reel':'carrusel',publicado_at:'2026-10-05T15:00:00.000Z',metricas:{alcance:i,vistas:null}}));
  data.destacadas=[{...data.piezas[0],caption:'Texto de prueba'}];
  const html=render(api.ClientReportDocument,{data});
  assert.match(html,/<details class="ig-client-report-statistics"><summary>Más estadísticas/);assert.doesNotMatch(html,/<details[^>]* open/);
  assert.match(html,/Post30/);assert.equal((html.match(/<li>/g)||[]).length,32);assert.match(html,/no son personas únicas/);
  assert.equal((source.match(/key=\{p.permalink\}/g)||[]).length,2);assert.doesNotMatch(source,/p\.ig_media_id|responsables|publicacion_id/);
});

test('empty document, safe logos/fallback and only safe public post links',()=>{
  const data=fixture('unavailable',null,null);data.cuentas=[];data.logo='https://external.invalid/tracker.png';
  const html=render(api.ClientReportDocument,{data});
  assert.match(html,/Sin cuenta vinculada/);assert.match(html,/No hay publicaciones registradas/);assert.match(html,/>CD<\/span>/);assert.doesNotMatch(html,/<img|external.invalid/);
  for(const value of ['javascript:alert(1)','data:image/svg+xml;base64,AAAA','https://host/logo.png'])assert.equal(api.safeReportLogo(value),null);
  assert.equal(api.safeReportLogo('data:image/png;base64,AAAA'),'data:image/png;base64,AAAA');
  for(const value of ['javascript:alert(1)','https://www.instagram.com.evil/p/X/','https://user@www.instagram.com/p/X/'])assert.equal(api.safeInstagramPostUrl(value),null);
  assert.equal(api.safeInstagramPostUrl('https://www.instagram.com/p/X/?tracking=1'),'https://www.instagram.com/p/X/');
});

test('invalid params never capture or fetch; current load clears previous data and requests only private endpoint',async()=>{
  let captures=0;const effects=[],calls=[];
  const capture=()=>{captures++;return {current:()=>true,async request(url,options){calls.push({url,options});return fixture();}};};
  api.beginClientReportLoad(capture,{cliente:'cliente-0',periodo:'2026-10'},s=>effects.push(s));assert.equal(captures,0);
  const cleanup=api.beginClientReportLoad(capture,params,s=>effects.push(s));assert.equal(effects[0].data,null);assert.equal(effects[0].loading,true);
  await tick();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/instagram/clientes/cliente-1/reporte?periodo=2026-10');assert.equal(calls[0].options.cache,'no-store');
  assert.equal(effects.at(-1).data.clave,'cliente-1');cleanup();assert.equal(calls[0].options.signal.aborted,true);
});

test('late success/error cannot mix another client, month, session, unmount or ABA with current view',async()=>{
  for(const fail of [false,true])for(const mode of ['client','month','session','unmount','ABA']){
    const wait=deferred(),effects=[];let live=true;
    const cleanup=api.beginClientReportLoad(()=>({current:()=>live,request:()=>wait.promise}),params,s=>effects.push(s));await tick();
    if(mode==='session')live=false;else cleanup();
    const mark=effects.length;
    if(fail)wait.reject(Error('private failure'));else wait.resolve(fixture());await tick();assert.equal(effects.length,mark,`${mode}/${fail}`);
  }
});

test('response must match mandatory clave and period; errors discard data and never expose raw diagnostics',async()=>{
  for(const change of [{clave:undefined},{clave:'cliente-2'},{periodo:'2026-11'}]){
    const states=[];api.beginClientReportLoad(()=>({current:()=>true,request:async()=>({...fixture(),...change})}),params,s=>states.push(s));await tick();
    assert.equal(states.at(-1).data,null);assert.ok(states.at(-1).error);
  }
  const states=[];api.beginClientReportLoad(()=>({current:()=>true,request:async()=>{throw Error('RAW_SECRET');}}),params,s=>states.push(s));await tick();
  assert.doesNotMatch(states.at(-1).error,/RAW_SECRET/);
});

function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit);}visit(root);return result;}
const owner=name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
test('actual month callback preserves client in URL and popstate listener follows location, with cleanup',()=>{
  const page=owner('InstagramClientReportPage');const calls=[],effects=[],listeners=new Map();
  const window={location:{search:'?cliente=grupo-7&periodo=2026-10'},history:{pushState(_state,_title,url){calls.push(url);window.location.search=new URL(url,'https://local.invalid').search;}},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
  const node=nodes(page,n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)==='changePeriod')[0].initializer;
  const change=evaluate(node,{params:{cliente:'grupo-7',periodo:'2026-10'},clientReportHref:api.clientReportHref,window,setSearch:s=>effects.push(s)});
  change('2026-11');assert.equal(calls[0],'/instagram/reporte?cliente=grupo-7&periodo=2026-11');assert.equal(effects[0],'?cliente=grupo-7&periodo=2026-11');change('2026-13');assert.equal(calls.length,1);
  const effect=nodes(page,n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect')[0].arguments[0];
  const cleanup=evaluate(effect,{window,setSearch:s=>effects.push(s)})();window.location.search='?cliente=cliente-9&periodo=2026-09';listeners.get('popstate')();assert.equal(effects.at(-1),window.location.search);cleanup();assert.equal(listeners.size,0);
});

test('actual page gates Leader and invalid URL before request component; key scopes identity, client and month',()=>{
  const denied=compile({useScopedRequest:()=>({view:{role:'edicion',session:{}},epoch:1})});
  assert.match(render(denied.InstagramClientReportPage,{}),/Disponible solo para Líder/);
  const invalid=compile({window:{location:{search:'?cliente=cliente-1&periodo=2026-10&periodo=2026-11'}}});
  assert.match(render(invalid.InstagramClientReportPage,{}),/no son válidos/);
  const valid=render(api.InstagramClientReportPage,{});assert.match(valid,/href="\/instagram\?periodo=2026-10"/);assert.match(valid,/type="month"/);assert.match(valid,/disabled=""/);
  assert.match(source,/key=\{`\$\{view.key\}:\$\{epoch\}:\$\{params.cliente\}:\$\{params.periodo\}`\}/);
  assert.doesNotMatch(source,/import .*InstagramPanel|fetch\(/);
  assert.equal(tree.parseDiagnostics.length,0);
});

test('print opens all report details and restores original state; CSS isolates print and respects mobile header',()=>{
  const details=[{open:false},{open:true}],listeners=new Map();
  const events={addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);}};
  const cleanup=api.prepareClientReportPrint({current:{querySelectorAll:()=>details}},events);
  listeners.get('beforeprint')();assert.deepEqual(details.map(d=>d.open),[true,true]);listeners.get('beforeprint')();listeners.get('afterprint')();assert.deepEqual(details.map(d=>d.open),[false,true]);
  listeners.get('beforeprint')();cleanup();assert.deepEqual(details.map(d=>d.open),[false,true]);assert.equal(listeners.size,0);
  assert.match(source,/window\.print\(\)/);assert.match(css,/@media print/);assert.match(css,/padding:0!important/);assert.match(css,/margin:0!important/);
  assert.match(css,/\.ig-client-report-page,\.ig-client-report-page \*\{visibility:visible\}/);assert.match(css,/break-inside:avoid/);
  const mobile='@media(max-width:980px){.ig-client-report-page{padding-top:88px}}';assert.ok(css.includes(mobile));assert.ok(css.indexOf(mobile)>css.indexOf('@media(max-width:420px)'));
  assert.match(css,/min-height:44px/);assert.doesNotMatch(css,/#(?:188038|00ff00)|\bgreen\b/i);
});
