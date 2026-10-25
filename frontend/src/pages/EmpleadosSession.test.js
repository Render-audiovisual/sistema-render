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
const employeeRevision=evaluate(owner('employeeRevision'),{employeeId});
const mergeEmployeeAck=evaluate(owner('mergeEmployeeAck'),{employeeId,employeeRevision});
const employeeRoster=evaluate(owner('employeeRoster'),{mergeEmployeeAck});
const generateEmployeePassword=evaluate(owner('generateEmployeePassword'),{});
test('create-account dialog uses shared native modality, busy close and explicit focus ownership',()=>{
  const [modal]=nodes(owner('EmpleadosContent'),n=>ts.isJsxOpeningElement(n)&&text(n.tagName)==='Modal');
  const attribute=(node,name)=>node.attributes.properties.find(prop=>prop.name?.getText(file)===name);
  assert.ok(attribute(modal,'native'));assert.equal(attribute(modal,'native').initializer,undefined);
  assert.equal(attribute(modal,'closeDisabled')?.initializer?.expression?.getText(file),'mutationBusy');
  assert.equal(attribute(modal,'onClose')?.initializer?.expression?.getText(file),'cerrarAlta');
  assert.equal(attribute(modal,'initialFocusRef')?.initializer?.expression?.getText(file),'createNameRef');
  assert.equal(attribute(modal,'returnFocusRef')?.initializer?.expression?.getText(file),'createButtonRef');
  const [nameInput]=nodes(owner('EmpleadosContent'),n=>ts.isJsxSelfClosingElement(n)&&text(n.tagName)==='input'&&attribute(n,'value')?.initializer?.expression?.getText(file)==='nombre');
  assert.equal(attribute(nameInput,'ref')?.initializer?.expression?.getText(file),'createNameRef');
  assert.equal(attribute(nameInput,'autoFocus'),undefined);
  const [invoker]=nodes(owner('EmpleadosContent'),n=>ts.isJsxOpeningElement(n)&&text(n.tagName)==='button'&&attribute(n,'onClick')?.initializer?.expression?.getText(file)==='abrirAlta');
  assert.equal(attribute(invoker,'ref')?.initializer?.expression?.getText(file),'createButtonRef');
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const baseUser={id:9,nombre:'Empleado QA',usuario:'empleado_qa',rol:'diseno',activo:true,email_notificaciones:'avisos@example.test',google_email:'google@example.test',whatsapp_vinculado:true,foto_perfil:null,admin_revision:'ua1:9:1'};
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
  const deps={...scopes,captureRoster:scopes.captureLifetime,employeeId,employeeRevision,mergeEmployeeAck,employeeRoster,isSessionFailure,
    editObservations:{current:{}},blockedTargetsRef:{current:new Set()},recoveryIntent:{current:null},ROL_LABELS:{diseno:'Diseño'},getRolLabel:value=>value,
    pending:{current:false},listGeneration:{current:0},usuarioAdministrado:selected,modalAltaAbierto:false,
    nombre:'Nueva QA',usuario:'nueva_qa',rol:'diseno',rolPersonalizado:'',password:'Only-ephemeral-QA-123!',emailNotificaciones:'new@example.test',
    nombreEdicion:'Renombrada QA',usuarioEdicion:'renombrada_qa',rolEdicion:'diseno',rolPersonalizadoEdicion:'',
    correoEdicion:'changed@example.test',googleEmailEdicion:'new-google@example.test',whatsappEdicion:'+5493794000000',
    altaDirty:false,adminDirty:false,window:{confirm:()=>true},normalizarPrimerNombre:value=>value.trim().split(' ')[0].toLowerCase(),
    ...Object.fromEntries(['CargandoUsuarios','Error','MutationBusy','FormError','Mensaje','Nombre','Usuario','Rol','RolPersonalizado','Password','EmailNotificaciones','ModalAltaAbierto','Enviando',
      'CorreoEdicion','GoogleEmailEdicion','WhatsappEdicion','EditandoCorreo','EditandoGoogleEmail','EditandoWhatsapp','EditandoDatos','GuardandoCorreo','GuardandoGoogleEmail','GuardandoWhatsapp','GuardandoDatos','EnviandoInvitacion','BlockedTargets','NombreEdicion','UsuarioEdicion','RolEdicion','RolPersonalizadoEdicion','RecoveryRequested'].map(name=>[`set${name}`,value=>effects.push([name,value])])),
    setUsuarios:value=>{users=typeof value==='function'?value(users):value;effects.push(['Usuarios',users]);},
    setUsuarioAdministrado:value=>{selected=typeof value==='function'?value(selected):value;effects.push(['UsuarioAdministrado',selected]);}};
  for(const name of ['clearRecovery','heldUser','blockTarget','cargarUsuarios','mergeLocal','runMutation','allowDiscard'])deps[name]=callback(name,deps);
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
  const ack={id:9,nombre:'Actualizado',usuario:'empleado_qa',rol:'diseno',email_notificaciones:null,secret:'drop',admin_revision:'ua1:9:2'};
  const merged=mergeEmployeeAck(baseUser,ack,9,['email_notificaciones']);assert.equal(merged.activo,true);assert.equal(merged.google_email,baseUser.google_email);assert.equal(merged.whatsapp_vinculado,true);assert.equal(merged.email_notificaciones,null);assert.equal(merged.secret,undefined);
  assert.throws(()=>mergeEmployeeAck(baseUser,{...ack,id:10},9));assert.throws(()=>mergeEmployeeAck(baseUser,{...ack,activo:'true'},9));
  assert.throws(()=>employeeRoster([baseUser,baseUser]));assert.throws(()=>employeeRoster([{...baseUser,id:'9'}]));assert.deepEqual(baseUser.email_notificaciones,'avisos@example.test');
});

test('actual email callback merges partial ACK then reads with same captured cookie/bearer, without replacing held editor',async()=>{
  for(const cookie of [true,false]){
    const ack={id:9,nombre:baseUser.nombre,usuario:baseUser.usuario,rol:baseUser.rol,email_notificaciones:'changed@example.test',admin_revision:'ua1:9:2'};
    const f=fixture(async url=>url==='/api/usuarios'?[{...baseUser,...ack}]:ack,cookie);await f.run('guardarCorreo',baseUser);
    assert.equal(f.calls.length,2);assert.equal(f.calls[0].url,'/api/usuarios/9/email-notificaciones');assert.equal(f.calls[1].url,'/api/usuarios');
    assert.deepEqual(JSON.parse(f.calls[0].options.body),{email_notificaciones:'changed@example.test',expected_revision:'ua1:9:1'});
    assert.equal(f.selected.google_email,baseUser.google_email);assert.equal(f.selected.activo,true);assert.equal(f.effects.filter(([name])=>name==='UsuarioAdministrado').length,1);
    if(cookie)for(const call of f.calls){assert.equal(call.options.sessionIntent.session,f.original);assert.equal(call.options.headers.Authorization,undefined);}
    else for(const call of f.calls)assert.equal(call.options.headers.Authorization,'Bearer original-a');
  }
});

test('all mutations share one immediate busy guard; double save/invite cannot dispatch while another action is pending',async()=>{
  const wait=deferred(),f=fixture(url=>url==='/api/usuarios'?Promise.resolve([{...baseUser,admin_revision:'ua1:9:2'}]):wait.promise);
  const pending=f.run('guardarCorreo',baseUser);await f.run('guardarGoogleEmail',baseUser);await f.run('enviarInvitacion',baseUser);assert.equal(f.calls.length,1);
  assert.equal(f.deps.pending.current,true);wait.resolve({...baseUser,email_notificaciones:'changed@example.test',admin_revision:'ua1:9:2'});await pending;assert.equal(f.calls.length,2);assert.equal(f.deps.pending.current,false);
});

test('late mutation success/error under account B, target ABA or unmount cannot paint, refresh or retry',async()=>{
  for(const change of ['switch','aba','unmount'])for(const failed of [false,true]){
    const wait=deferred(),f=fixture(()=>wait.promise),promise=f.run('guardarCorreo',baseUser);f[change]();const marker=f.effects.length;
    if(failed)wait.reject(new Error('private old account'));else wait.resolve({...baseUser,email_notificaciones:'changed@example.test',admin_revision:'ua1:9:2'});await promise;
    const late=f.effects.slice(marker);assert.equal(late.some(([name])=>!['MutationBusy','GuardandoCorreo','CargandoUsuarios'].includes(name)),false);
    if(change!=='aba')assert.deepEqual(late,[]);assert.equal(f.calls.length,1);
  }
});

test('confirmed write remains confirmed when its roster refresh fails; unconfirmed or malformed ACK keeps draft and never refreshes',async()=>{
  const f=fixture(async url=>{if(url==='/api/usuarios')throw Error('offline');return{...baseUser,email_notificaciones:'changed@example.test',admin_revision:'ua1:9:2'};});await f.run('guardarCorreo',baseUser);
  assert.ok(f.effects.some(([name])=>name==='Mensaje'));assert.ok(f.effects.some(([name,value])=>name==='Error'&&value.includes('El cambio se confirmó')));assert.equal(f.selected.email_notificaciones,'changed@example.test');assert.equal(f.calls.length,2);
  for(const ack of [{...baseUser,id:10},{}]){const g=fixture(async()=>ack);await g.run('guardarCorreo',baseUser);assert.equal(g.calls.length,1);assert.equal(g.effects.some(([name])=>name==='Mensaje'&&g.effects.find(([key,value])=>key==='Mensaje'&&value)),false);assert.equal(g.effects.some(([name,value])=>name==='EditandoCorreo'&&value===false),false);}
});

test('deactivation/reactivation use the access PATCH, preserve histories/contact fields and never send DELETE',async()=>{
  for(const activo of [true,false]){
    const current={...baseUser,activo},f=fixture(async url=>url==='/api/usuarios'?[{...current,activo:!activo,admin_revision:'ua1:9:2'}]:{id:9,nombre:baseUser.nombre,usuario:baseUser.usuario,rol:baseUser.rol,activo:!activo,admin_revision:'ua1:9:2'});
    await f.run('handleEliminar',current);assert.equal(f.calls[0].url,'/api/usuarios/9/acceso');assert.equal(f.calls[0].options.method,'PATCH');assert.deepEqual(JSON.parse(f.calls[0].options.body),{activo:!activo,expected_revision:'ua1:9:1'});assert.equal(f.selected.google_email,baseUser.google_email);assert.equal(f.selected.activo,!activo);
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
  const created={id:12,nombre:'Nueva QA',usuario:'nueva_qa',rol:'diseno',activo:true,email_notificaciones:'new@example.test',google_email:null,whatsapp_vinculado:false,admin_revision:'ua1:12:1'};
  const f=fixture(async url=>url==='/api/usuarios'&&f.calls.at(-1).options.method==='GET'?[baseUser,created]:created);f.deps.modalAltaAbierto=true;
  await f.run('handleCrear',{preventDefault(){}});assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[1].options.method,'GET');assert.equal(f.users.find(user=>user.id===12).activo,true);
  assert.ok(f.effects.some(([name,value])=>name==='Password'&&value===''));assert.ok(f.effects.some(([name,value])=>name==='ModalAltaAbierto'&&value===false));
  assert.equal(Object.hasOwn(JSON.parse(f.calls[0].options.body),'expected_revision'),false);
  const bad=fixture(async()=>({...created,activo:undefined}));bad.deps.modalAltaAbierto=true;await bad.run('handleCrear',{preventDefault(){}});assert.equal(bad.calls.length,1);assert.equal(bad.effects.some(([name])=>name==='Password'),false);assert.equal(bad.effects.some(([name,value])=>name==='ModalAltaAbierto'&&value===false),false);
  const nonInitial=fixture(async()=>({...created,admin_revision:'ua1:12:2'}));nonInitial.deps.modalAltaAbierto=true;await nonInitial.run('handleCrear',{preventDefault(){}});assert.equal(nonInitial.calls.length,1);assert.equal(nonInitial.effects.some(([name,value])=>name==='ModalAltaAbierto'&&value===false),false);
});

test('admin revision is exact, resource-bound positive int32; ACK must advance while initial catalogue only requires valid revision',()=>{
  for(const token of [undefined,null,1,'ua1:9:1\n','ua1:09:1','ua1:9:01','ua1:9:0','ua1:10:2','ua1:9:2147483648','ua1:9:2:extra',' ua1:9:2'])assert.equal(employeeRevision(token,9),null,String(token));
  assert.equal(employeeRevision('ua1:9:2147483647',9),2147483647);
  for(const token of [undefined,'ua1:9:1','ua1:9:3','ua1:10:2','ua1:9:2\n'])assert.throws(()=>mergeEmployeeAck(baseUser,{...baseUser,admin_revision:token},9));
  assert.equal(mergeEmployeeAck(baseUser,{...baseUser,admin_revision:'ua1:9:2'},9).admin_revision,'ua1:9:2');
  assert.equal(employeeRoster([baseUser])[0].admin_revision,'ua1:9:1');assert.throws(()=>employeeRoster([{...baseUser,admin_revision:undefined}]));
});

test('all five PATCH bodies carry only original revision and their closed business fields, invitation carries no CAS',async()=>{
  for(const [name,args,keys]of [
    ['guardarCorreo',[baseUser],['email_notificaciones','expected_revision']],['guardarGoogleEmail',[baseUser],['google_email','expected_revision']],
    ['guardarWhatsapp',[baseUser,''],['whatsapp','expected_revision']],['guardarDatos',[baseUser],['nombre','usuario','rol','expected_revision']],
    ['handleEliminar',[baseUser],['activo','expected_revision']],
  ]){
    const f=fixture(async()=>{throw Object.assign(new Error('Fixture conflict'),{status:409});});await f.run(name,...args);
    assert.equal(f.calls.length,1);const payload=JSON.parse(f.calls[0].options.body);assert.deepEqual(Object.keys(payload).sort(),keys.sort());assert.equal(payload.expected_revision,'ua1:9:1');
  }
  const f=fixture(async()=>({ok:true,destinatario:'avisos@example.test'}));await f.run('enviarInvitacion',baseUser);assert.equal(f.calls[0].options.body,undefined);
});

test('conflict freezes same-user writes and retains open draft, even after a catalogue refresh or close/reopen',async()=>{
  const f=fixture(async url=>{if(url==='/api/usuarios')return[{...baseUser,admin_revision:'ua1:9:8'}];throw Object.assign(new Error('USER_ADMIN_REVISION_CONFLICT'),{status:409});});
  await f.run('guardarCorreo',baseUser);assert.equal(f.calls.length,1);assert.equal(f.deps.blockedTargetsRef.current.has(9),true);
  for(const name of ['CorreoEdicion','GoogleEmailEdicion','WhatsappEdicion','EditandoCorreo','EditandoGoogleEmail','EditandoWhatsapp','EditandoDatos','UsuarioAdministrado'])assert.equal(f.effects.some(([effect])=>effect===name),false,name);
  await f.run('guardarDatos',baseUser);await f.run('handleEliminar',baseUser);assert.equal(f.calls.length,1);
  await f.deps.cargarUsuarios();assert.equal(f.calls.length,2);assert.equal(f.selected.admin_revision,'ua1:9:1');assert.equal(f.deps.blockedTargetsRef.current.has(9),true);
  f.run('cerrarAdministracion');f.run('abrirAdministracion',{...baseUser,admin_revision:'ua1:9:8'});await f.run('guardarCorreo',{...baseUser,admin_revision:'ua1:9:8'});assert.equal(f.calls.length,2);
});

test('ambiguous transport/missing/wrong/nonadvanced ACK freezes write without clearing draft or retrying',async()=>{
  for(const result of [new Error('offline'),{}, {...baseUser,admin_revision:'ua1:9:1'}, {...baseUser,admin_revision:'ua1:9:3'}, {...baseUser,admin_revision:'ua1:10:2'},{...baseUser,admin_revision:'ua1:9:2\n'}]){
    const f=fixture(async()=>{if(result instanceof Error)throw result;return result;});await f.run('guardarCorreo',baseUser);
    assert.equal(f.calls.length,1);assert.equal(f.deps.blockedTargetsRef.current.has(9),true);await f.run('guardarGoogleEmail',baseUser);assert.equal(f.calls.length,1);
    assert.equal(f.effects.some(([name,value])=>name==='EditandoCorreo'&&value===false),false);assert.equal(f.selected.admin_revision,'ua1:9:1');
  }
});

test('each editor sends its held opening revision, not a later verified ACK from another editor',async()=>{
  const f=fixture(async()=>{throw Object.assign(new Error('conflict'),{status:409});});
  f.run('iniciarEdicionGoogleEmail');assert.equal(f.deps.editObservations.current.google.admin_revision,'ua1:9:1');
  const later={...baseUser,admin_revision:'ua1:9:2'};f.deps.usuarioAdministrado=later;
  await f.run('guardarGoogleEmail',later);assert.equal(JSON.parse(f.calls[0].options.body).expected_revision,'ua1:9:1');
  assert.equal(f.deps.blockedTargetsRef.current.has(9),true);
});

test('in-panel recovery request/cancel does not GET or discard; only confirmed verified reload permits the next revision',async()=>{
  let latest={...baseUser,admin_revision:'ua1:9:6'};const wait=deferred();let reloadPending=true;
  const f=fixture(async(url,options)=>{
    if(options.method==='GET')return reloadPending?wait.promise:[latest];
    const payload=JSON.parse(options.body);assert.equal(payload.expected_revision,'ua1:9:6');latest={...latest,email_notificaciones:payload.email_notificaciones,admin_revision:'ua1:9:7'};return latest;
  });
  f.deps.blockedTargetsRef.current.add(9);f.deps.window.confirm=()=>{throw Error('Recovery must not use native confirm');};
  await f.run('reloadManagedUser');assert.equal(f.calls.length,0);
  f.run('requestReloadManagedUser');assert.equal(f.calls.length,0);assert.equal(f.deps.recoveryIntent.current.id,9);
  f.run('cancelReloadManagedUser');assert.equal(f.deps.recoveryIntent.current,null);await f.run('reloadManagedUser');assert.equal(f.calls.length,0);assert.equal(f.deps.blockedTargetsRef.current.has(9),true);
  f.run('requestReloadManagedUser');const pending=f.run('reloadManagedUser');assert.equal(f.calls.length,1);assert.equal(f.effects.some(([name])=>['UsuarioAdministrado','CorreoEdicion','EditandoCorreo'].includes(name)),false);
  const mark=f.effects.length;f.run('cancelReloadManagedUser');f.run('cerrarAdministracion');f.run('requestReloadManagedUser');await f.run('guardarDatos',baseUser);await f.run('reloadManagedUser');assert.equal(f.calls.length,1);assert.equal(f.effects.length,mark);
  reloadPending=false;wait.resolve([latest]);await pending;assert.equal(f.deps.blockedTargetsRef.current.has(9),false);assert.equal(f.selected.admin_revision,'ua1:9:6');
  assert.ok(f.effects.some(([name,value])=>name==='EditandoCorreo'&&value===false));
  await f.run('guardarCorreo',f.selected);assert.equal(f.selected.admin_revision,'ua1:9:7');assert.equal(f.calls.length,3);
});

test('reload failure/missing same user/unknown revision never discards or selects another account; late A/B or ABA cannot clear block',async()=>{
  for(const result of [new Error('offline'),[{...baseUser,id:10,admin_revision:'ua1:10:3'}],[{...baseUser,admin_revision:undefined}]]){
    const f=fixture(async()=>{if(result instanceof Error)throw result;return result;});f.deps.blockedTargetsRef.current.add(9);f.run('requestReloadManagedUser');await f.run('reloadManagedUser');
    assert.equal(f.selected.admin_revision,'ua1:9:1');assert.equal(f.deps.blockedTargetsRef.current.has(9),true);assert.equal(f.effects.some(([name])=>['CorreoEdicion','UsuarioAdministrado'].includes(name)),false);
  }
  for(const change of ['switch','aba','unmount']){
    const wait=deferred(),f=fixture(()=>wait.promise);f.deps.blockedTargetsRef.current.add(9);f.run('requestReloadManagedUser');const promise=f.run('reloadManagedUser');f[change]();const mark=f.effects.length;wait.resolve([{...baseUser,admin_revision:'ua1:9:3'}]);await promise;
    assert.equal(f.deps.blockedTargetsRef.current.has(9),true);assert.equal(f.effects.slice(mark).some(([name])=>name!=='MutationBusy'),false);
  }
});

test('frozen editor still exposes explicit reload outside the disabled fieldset, wired to the same held user',()=>{
  assert.match(source,/disabled=\{mutationBusy \|\| Boolean\(blockedTargets\[usuarioAdministrado.id\]\)\}/);
  const button=nodes(owner('EmpleadosContent'),n=>ts.isJsxElement(n)&&text(n.openingElement.tagName)==='button'&&text(n).includes('onClick={reloadManagedUser}'))[0];assert.ok(button);
  for(let parent=button.parent;parent;parent=parent.parent)if(ts.isJsxElement(parent))assert.notEqual(text(parent.openingElement.tagName),'fieldset');
  assert.match(source,/Descartar y recargar/);assert.match(source,/Conservar borrador/);
  for(const name of ['requestReloadManagedUser','reloadManagedUser','cancelReloadManagedUser']){
    const node=nodes(owner('EmpleadosContent'),n=>ts.isVariableDeclaration(n)&&text(n.name)===name)[0];assert.doesNotMatch(text(node),/window.confirm/);
  }
  assert.match(source,/\{blockedTargets\[usuarioAdministrado.id\] && <div/);
  assert.doesNotMatch(source,/La recarga permite revisar la versión guardada/);
});

test('recovery confirmation retains the original genuine actor and context, refusing ABA/account changes before any GET',async()=>{
  for(const change of ['switch','aba','unmount']){
    const f=fixture(async()=>[{...baseUser,admin_revision:'ua1:9:6'}]);f.deps.blockedTargetsRef.current.add(9);
    f.run('requestReloadManagedUser');const held=f.deps.recoveryIntent.current;assert.equal(held.guard.current(),true);
    f[change]();const mark=f.effects.length;await f.run('reloadManagedUser');f.run('cancelReloadManagedUser');assert.equal(f.calls.length,0);assert.equal(f.effects.length,mark);assert.equal(f.deps.blockedTargetsRef.current.has(9),true);
  }
  const f=fixture(async()=>[]);f.deps.blockedTargetsRef.current.add(9);f.run('requestReloadManagedUser');f.run('cerrarAdministracion');assert.equal(f.deps.recoveryIntent.current,null);
});

test('typed namespace rejection preserves draft and held revision without success, refresh or recovery block; corrected value can retry same observation',async()=>{
  let rejected=true;
  const f=fixture(async(url,options)=>{
    if(options.method==='GET')return[{...baseUser,nombre:'Renombrada QA',usuario:'disponible_qa',admin_revision:'ua1:9:2'}];
    const body=JSON.parse(options.body);assert.equal(body.expected_revision,'ua1:9:1');
    if(rejected)throw Object.assign(new Error('private conflicting account@example.test'),{status:409,code:'LOGIN_IDENTIFIER_UNAVAILABLE'});
    return{id:9,nombre:body.nombre,usuario:body.usuario,rol:baseUser.rol,admin_revision:'ua1:9:2'};
  });
  f.run('iniciarEdicionDatos');f.effects.length=0;
  await f.run('guardarDatos',baseUser);
  assert.equal(f.calls.length,1);assert.equal(f.deps.blockedTargetsRef.current.has(9),false);assert.equal(f.selected.admin_revision,'ua1:9:1');
  assert.equal(f.deps.editObservations.current.datos.admin_revision,'ua1:9:1');
  assert.ok(f.effects.some(([name,value])=>name==='FormError'&&value==='Ese usuario o email de acceso no está disponible. Elegí otro.'));
  assert.ok(!JSON.stringify(f.effects).includes('private conflicting'));
  for(const name of ['Usuarios','UsuarioAdministrado','NombreEdicion','UsuarioEdicion','EditandoDatos','BlockedTargets'])assert.equal(f.effects.some(([effect])=>effect===name),false,name);
  assert.equal(f.effects.some(([name,value])=>name==='Mensaje'&&value!==null),false);assert.equal(f.deps.pending.current,false);
  rejected=false;f.deps.usuarioEdicion='disponible_qa';await f.run('guardarDatos',baseUser);
  assert.equal(f.calls.length,3);assert.equal(f.selected.admin_revision,'ua1:9:2');assert.equal(JSON.parse(f.calls[1].options.body).expected_revision,'ua1:9:1');
});

test('namespace rejection on Google preserves exact observed revision; real CAS and unknown409 still block without rebasing',async()=>{
  for(const code of ['LOGIN_IDENTIFIER_UNAVAILABLE','USER_ADMIN_REVISION_CONFLICT',undefined,'unknown']){
    const f=fixture(async()=>{throw Object.assign(new Error('private diagnostic'),{status:409,...(code?{code}:{})});});
    f.run('iniciarEdicionGoogleEmail');f.effects.length=0;await f.run('guardarGoogleEmail',baseUser);
    assert.equal(f.calls.length,1);assert.equal(f.selected.admin_revision,'ua1:9:1');assert.equal(f.deps.editObservations.current.google.admin_revision,'ua1:9:1');
    assert.equal(f.deps.blockedTargetsRef.current.has(9),code!=='LOGIN_IDENTIFIER_UNAVAILABLE');
    assert.equal(f.effects.some(([name,value])=>name==='EditandoGoogleEmail'&&value===false),false);
    assert.equal(f.effects.some(([name,value])=>name==='Mensaje'&&value!==null),false);
    if(code!=='LOGIN_IDENTIFIER_UNAVAILABLE'){await f.run('guardarGoogleEmail',baseUser);assert.equal(f.calls.length,1);}
  }
  const uncertain=fixture(async()=>{throw Object.assign(new Error('unconfirmed'),{status:500,code:'LOGIN_IDENTIFIER_UNAVAILABLE'});});await uncertain.run('guardarDatos',baseUser);assert.equal(uncertain.deps.blockedTargetsRef.current.has(9),true);
});

test('typed namespace rejection arriving after actor change, target ABA or unmount cannot paint or change recovery state',async()=>{
  for(const change of ['switch','aba','unmount']){
    const wait=deferred(),f=fixture(()=>wait.promise);const promise=f.run('guardarDatos',baseUser);f[change]();const mark=f.effects.length;
    wait.reject(Object.assign(new Error('private identity'),{status:409,code:'LOGIN_IDENTIFIER_UNAVAILABLE'}));await promise;
    assert.equal(f.calls.length,1);assert.equal(f.deps.blockedTargetsRef.current.has(9),false);
    assert.equal(f.effects.slice(mark).some(([name])=>!['MutationBusy','GuardandoDatos','CargandoUsuarios'].includes(name)),false);
  }
});

test('typed create namespace rejection keeps entered fields and permits a corrected explicit POST without fabricated success',async()=>{
  let first=true,created;
  const f=fixture(async(url,options)=>{
    if(options.method==='GET')return[baseUser,created];
    if(first)throw Object.assign(new Error('private conflicting login'),{status:409,code:'LOGIN_IDENTIFIER_UNAVAILABLE'});
    const body=JSON.parse(options.body);assert.equal(Object.hasOwn(body,'expected_revision'),false);
    created={id:12,nombre:body.nombre,usuario:body.usuario,rol:'diseno',activo:true,email_notificaciones:body.email_notificaciones,google_email:null,whatsapp_vinculado:false,admin_revision:'ua1:12:1'};return created;
  });
  f.deps.modalAltaAbierto=true;await f.run('handleCrear',{preventDefault(){}});assert.equal(f.calls.length,1);
  for(const name of ['Password','Nombre','Usuario','ModalAltaAbierto','Usuarios'])assert.equal(f.effects.some(([effect])=>effect===name),false,name);
  assert.ok(f.effects.some(([name,value])=>name==='FormError'&&value==='Ese usuario o email de acceso no está disponible. Elegí otro.'));
  first=false;f.deps.usuario='disponible_new';await f.run('handleCrear',{preventDefault(){}});assert.equal(f.calls.length,3);assert.equal(f.users.find(user=>user.id===12).usuario,'disponible_new');
});
