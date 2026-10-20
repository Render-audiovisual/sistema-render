import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createSessionView, sessionViewInputs } from '../shared/session/session-view.js';

// Actual callbacks and shared hook with injected React primitives. No mounted
// React, real accounts, mail or browser acceptance is claimed by these tests.
const source=readFileSync(new URL('./Empleados.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('Empleados.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const text=n=>n.getText(file);
function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit);}visit(root);return result;}
const owner=name=>file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const evaluate=(node,deps)=>new Function(...Object.keys(deps),`return (${text(node)});`)(...Object.values(deps));
const callback=(name,deps)=>{const init=nodes(owner('EmpleadosContent'),n=>ts.isVariableDeclaration(n)&&text(n.name)===name)[0].initializer;return evaluate(ts.isCallExpression(init)&&text(init.expression)==='useCallback'?init.arguments[0]:init,deps);};
const employeeId=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const mergeEmployeeAck=evaluate(owner('mergeEmployeeAck'),{employeeId});
const employeeRoster=evaluate(owner('employeeRoster'),{mergeEmployeeAck});
const generateEmployeePassword=evaluate(owner('generateEmployeePassword'),{});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const baseUser={id:9,nombre:'Empleado QA',usuario:'empleado_qa',rol:'diseno',activo:true,email_notificaciones:'avisos@example.test',google_email:'google@example.test',whatsapp_vinculado:true,foto_perfil:null};
function fixture(request,cookie=true){
  const store=createBrowserSessionState();
  const accept=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,usuario:'qa',nombre:'QA',rol:'admin'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
  accept(7);let live=cookie?store.getSession():{token:'original-a',usuario:{id:7,rol:'admin',activo:true}},view=createSessionView(sessionViewInputs(live));
  const refs=[];let cursor=0,layout,cleanup;const calls=[],effects=[];
  const hookSource=readFileSync(new URL('../shared/session/use-scoped-request.js',import.meta.url),'utf8');
  const hookFile=ts.createSourceFile('hook.js',hookSource,ts.ScriptTarget.Latest,true);
  const declaration=hookFile.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useScopedRequest').getText(hookFile).replace(/^export\s+/,'');
  const hookDeps={useRef:initial=>refs[cursor++]||={current:initial},useCallback:fn=>fn,useLayoutEffect:fn=>{layout||=fn;},useSessionView:()=>view,
    getSesion:()=>live,createCapturedRequest,apiRequest:(url,options)=>{calls.push({url,options});return request(url,options);}};
  const hook=new Function(...Object.keys(hookDeps),`return (${declaration});`)(...Object.values(hookDeps));
  const render=context=>{cursor=0;return hook(live,context);};
  const before=render('user:9');assert.equal(before.capture().current(),false);cleanup=layout();const scopes=render('user:9');
  let users=[{...baseUser}],selected={...baseUser};
  const deps={...scopes,captureRoster:scopes.captureLifetime,employeeId,mergeEmployeeAck,employeeRoster,isSessionFailure,
    pending:{current:false},listGeneration:{current:0},usuarioAdministrado:selected,modalAltaAbierto:false,
    nombre:'Nueva QA',usuario:'nueva_qa',rol:'diseno',rolPersonalizado:'',password:'Only-ephemeral-QA-123!',emailNotificaciones:'new@example.test',
    nombreEdicion:'Renombrada QA',usuarioEdicion:'renombrada_qa',rolEdicion:'diseno',rolPersonalizadoEdicion:'',
    correoEdicion:'changed@example.test',googleEmailEdicion:'new-google@example.test',whatsappEdicion:'+5493794000000',
    altaDirty:false,adminDirty:false,window:{confirm:()=>true},normalizarPrimerNombre:value=>value.trim().split(' ')[0].toLowerCase(),
    ...Object.fromEntries(['CargandoUsuarios','Error','MutationBusy','FormError','Mensaje','Nombre','Usuario','Rol','RolPersonalizado','Password','EmailNotificaciones','ModalAltaAbierto','Enviando',
      'CorreoEdicion','GoogleEmailEdicion','WhatsappEdicion','EditandoCorreo','EditandoGoogleEmail','EditandoWhatsapp','EditandoDatos','GuardandoCorreo','GuardandoGoogleEmail','GuardandoWhatsapp','GuardandoDatos','EnviandoInvitacion'].map(name=>[`set${name}`,value=>effects.push([name,value])])),
    setUsuarios:value=>{users=typeof value==='function'?value(users):value;effects.push(['Usuarios',users]);},
    setUsuarioAdministrado:value=>{selected=typeof value==='function'?value(selected):value;effects.push(['UsuarioAdministrado',selected]);}};
  for(const name of ['cargarUsuarios','mergeLocal','runMutation','allowDiscard'])deps[name]=callback(name,deps);
  return{deps,calls,effects,original:live,get users(){return users;},get selected(){return selected;},run:(name,...args)=>callback(name,deps)(...args),
    switch(){if(cookie){accept(8);live=store.getSession();}else live={token:'new-b',usuario:{id:8,rol:'admin',activo:true}};view=createSessionView(sessionViewInputs(live));render('user:9');},
    aba(){render('user:10');render('user:9');},unmount:()=>cleanup()};
}

test('source parses; eight legacy fetches replaced by captured requests, identity-keyed admin-only UI and one mutation ref',()=>{
  assert.equal(file.parseDiagnostics.length,0);
  assert.equal(nodes(file,n=>ts.isCallExpression(n)&&(text(n.expression)==='fetch'||text(n.expression).endsWith('.json'))).length,0);
  assert.match(text(owner('EmpleadosPage')),/view.role !== 'admin'/);assert.match(text(owner('EmpleadosPage')),/key=\{identity.current.epoch\} sesion=\{view.session\}/);
  assert.match(source,/disabled=\{mutationBusy\}/);assert.match(source,/useScopedRequest\(sesion,modalAltaAbierto \? 'create' : `user:/);
});

test('actual name handler suggests only username, never passwords; actual Web Crypto produces 24 ASCII chars with no fallback',()=>{
  const f=fixture(async()=>[]);f.deps.usuario='';f.run('handleNombreChange',{target:{value:'Otro Nombre'}});
  assert.ok(f.effects.some(([name,value])=>name==='Usuario'&&value==='otro'));assert.equal(f.effects.some(([name])=>name==='Password'),false);
  const custom=fixture(async()=>[]);custom.run('handleNombreChange',{target:{value:'Otro Nombre'}});assert.equal(custom.effects.some(([name])=>name==='Usuario'),false);
  const password=generateEmployeePassword(webcrypto);assert.match(password,/^[0-9a-f]{24}$/);assert.notEqual(generateEmployeePassword(webcrypto),password);
  assert.throws(()=>generateEmployeePassword({}));assert.throws(()=>generateEmployeePassword({getRandomValues(){throw Error('unavailable');}}));
  assert.doesNotMatch(source,/Math.random|passwordActualSugerida|nuevoUsuarioSugerido.*1/);
  assert.match(source,/type="password"\s+autoComplete="new-password"/);assert.match(source,/minLength=\{12\}/);assert.doesNotMatch(source,/maxLength=\{?72/);
  assert.match(source,/no se exige un cambio automático/);assert.doesNotMatch(source,/primer login/);
});

test('partial ACK preserves active/contact fields and rejects wrong IDs, malformed fields and duplicate roster IDs',()=>{
  const ack={id:9,nombre:'Actualizado',usuario:'empleado_qa',rol:'diseno',email_notificaciones:null,secret:'drop'};
  const merged=mergeEmployeeAck(baseUser,ack,9,['email_notificaciones']);assert.equal(merged.activo,true);assert.equal(merged.google_email,baseUser.google_email);assert.equal(merged.whatsapp_vinculado,true);assert.equal(merged.email_notificaciones,null);assert.equal(merged.secret,undefined);
  assert.throws(()=>mergeEmployeeAck(baseUser,{...ack,id:10},9));assert.throws(()=>mergeEmployeeAck(baseUser,{...ack,activo:'true'},9));
  assert.throws(()=>employeeRoster([baseUser,baseUser]));assert.throws(()=>employeeRoster([{...baseUser,id:'9'}]));assert.deepEqual(baseUser.email_notificaciones,'avisos@example.test');
});

test('actual email callback merges partial ACK then reads with same captured cookie/bearer, without replacing held editor',async()=>{
  for(const cookie of [true,false]){
    const ack={id:9,nombre:baseUser.nombre,usuario:baseUser.usuario,rol:baseUser.rol,email_notificaciones:'changed@example.test'};
    const f=fixture(async url=>url==='/api/usuarios'?[{...baseUser,...ack}]:ack,cookie);await f.run('guardarCorreo',baseUser);
    assert.equal(f.calls.length,2);assert.equal(f.calls[0].url,'/api/usuarios/9/email-notificaciones');assert.equal(f.calls[1].url,'/api/usuarios');
    assert.deepEqual(JSON.parse(f.calls[0].options.body),{email_notificaciones:'changed@example.test'});
    assert.equal(f.selected.google_email,baseUser.google_email);assert.equal(f.selected.activo,true);assert.equal(f.effects.filter(([name])=>name==='UsuarioAdministrado').length,1);
    if(cookie)for(const call of f.calls){assert.equal(call.options.sessionIntent.session,f.original);assert.equal(call.options.headers.Authorization,undefined);}
    else for(const call of f.calls)assert.equal(call.options.headers.Authorization,'Bearer original-a');
  }
});

test('all mutations share one immediate busy guard; double save/invite cannot dispatch while another action is pending',async()=>{
  const wait=deferred(),f=fixture(url=>url==='/api/usuarios'?Promise.resolve([baseUser]):wait.promise);
  const pending=f.run('guardarCorreo',baseUser);await f.run('guardarGoogleEmail',baseUser);await f.run('enviarInvitacion',baseUser);assert.equal(f.calls.length,1);
  assert.equal(f.deps.pending.current,true);wait.resolve({...baseUser,email_notificaciones:'changed@example.test'});await pending;assert.equal(f.calls.length,2);assert.equal(f.deps.pending.current,false);
});

test('late mutation success/error under account B, target ABA or unmount cannot paint, refresh or retry',async()=>{
  for(const change of ['switch','aba','unmount'])for(const failed of [false,true]){
    const wait=deferred(),f=fixture(()=>wait.promise),promise=f.run('guardarCorreo',baseUser);f[change]();const marker=f.effects.length;
    if(failed)wait.reject(new Error('private old account'));else wait.resolve({...baseUser,email_notificaciones:'changed@example.test'});await promise;
    const late=f.effects.slice(marker);assert.equal(late.some(([name])=>!['MutationBusy','GuardandoCorreo','CargandoUsuarios'].includes(name)),false);
    if(change!=='aba')assert.deepEqual(late,[]);assert.equal(f.calls.length,1);
  }
});

test('confirmed write remains confirmed when its roster refresh fails; unconfirmed or malformed ACK keeps draft and never refreshes',async()=>{
  const f=fixture(async url=>{if(url==='/api/usuarios')throw Error('offline');return{...baseUser,email_notificaciones:'changed@example.test'};});await f.run('guardarCorreo',baseUser);
  assert.ok(f.effects.some(([name])=>name==='Mensaje'));assert.ok(f.effects.some(([name,value])=>name==='Error'&&value.includes('El cambio se confirmó')));assert.equal(f.selected.email_notificaciones,'changed@example.test');assert.equal(f.calls.length,2);
  for(const ack of [{...baseUser,id:10},{}]){const g=fixture(async()=>ack);await g.run('guardarCorreo',baseUser);assert.equal(g.calls.length,1);assert.equal(g.effects.some(([name])=>name==='Mensaje'&&g.effects.find(([key,value])=>key==='Mensaje'&&value)),false);assert.equal(g.effects.some(([name,value])=>name==='EditandoCorreo'&&value===false),false);}
});

test('deactivation/reactivation use the access PATCH, preserve histories/contact fields and never send DELETE',async()=>{
  for(const activo of [true,false]){
    const current={...baseUser,activo},f=fixture(async url=>url==='/api/usuarios'?[{...current,activo:!activo}]:{id:9,nombre:baseUser.nombre,usuario:baseUser.usuario,rol:baseUser.rol,activo:!activo});
    await f.run('handleEliminar',current);assert.equal(f.calls[0].url,'/api/usuarios/9/acceso');assert.equal(f.calls[0].options.method,'PATCH');assert.deepEqual(JSON.parse(f.calls[0].options.body),{activo:!activo});assert.equal(f.selected.google_email,baseUser.google_email);assert.equal(f.selected.activo,!activo);
  }
  assert.doesNotMatch(source,/method:\s*["']DELETE/);
});

test('invitation pins target before dispatch and validates existing no-ID ACK without sending real mail or refreshing roster',async()=>{
  const f=fixture(async()=>({ok:true,destinatario:'avisos@example.test'}));await f.run('enviarInvitacion',baseUser);assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/usuarios/9/invitacion');assert.ok(f.effects.some(([name,value])=>name==='Mensaje'&&value?.includes('Instrucciones enviadas')));
  const g=fixture(async()=>({ok:true,destinatario:'unexpected@example.test'}));await g.run('enviarInvitacion',{...baseUser,id:10});assert.equal(g.calls.length,0);
});

test('actual dirty close/switch/cancel guards refuse during pending, honor confirmation and retain drafts on rejection',()=>{
  const f=fixture(async()=>[]);f.deps.altaDirty=true;f.deps.adminDirty=true;f.deps.window.confirm=()=>false;
  f.run('cerrarAlta');f.run('cerrarAdministracion');f.run('abrirAdministracion',{...baseUser,id:10});f.run('cancelEdit',f.deps.setEditandoCorreo);assert.equal(f.effects.length,0);
  f.deps.window.confirm=()=>true;f.deps.pending.current=true;f.run('cerrarAlta');f.run('cerrarAdministracion');f.run('abrirAlta');assert.equal(f.effects.length,0);
  f.deps.pending.current=false;f.run('cerrarAdministracion');assert.ok(f.effects.some(([name,value])=>name==='UsuarioAdministrado'&&value===null));
  const cancelButtons=nodes(owner('EmpleadosContent'),n=>ts.isJsxElement(n)&&text(n.openingElement.tagName)==='button'&&n.children.some(child=>ts.isJsxText(child)&&child.text.trim()==='Cancelar'));
  assert.equal(cancelButtons.length,5);for(const button of cancelButtons)assert.match(text(button),/cerrarAlta|cancelEdit/);
});

test('create confirms target identity/default access fields, clears password only after confirmation and keeps original scope through refresh',async()=>{
  const created={id:12,nombre:'Nueva QA',usuario:'nueva_qa',rol:'diseno',activo:true,email_notificaciones:'new@example.test',google_email:null,whatsapp_vinculado:false};
  const f=fixture(async url=>url==='/api/usuarios'&&f.calls.at(-1).options.method==='GET'?[baseUser,created]:created);f.deps.modalAltaAbierto=true;
  await f.run('handleCrear',{preventDefault(){}});assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[1].options.method,'GET');assert.equal(f.users.find(user=>user.id===12).activo,true);
  assert.ok(f.effects.some(([name,value])=>name==='Password'&&value===''));assert.ok(f.effects.some(([name,value])=>name==='ModalAltaAbierto'&&value===false));
  const bad=fixture(async()=>({...created,activo:undefined}));bad.deps.modalAltaAbierto=true;await bad.run('handleCrear',{preventDefault(){}});assert.equal(bad.calls.length,1);assert.equal(bad.effects.some(([name])=>name==='Password'),false);assert.equal(bad.effects.some(([name,value])=>name==='ModalAltaAbierto'&&value===false),false);
});
