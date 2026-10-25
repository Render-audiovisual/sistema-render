import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { profileFailureMessage } from '../shared/session/profile-session.js';
import { newPasswordError, PASSWORD_POLICY_MESSAGE } from '../../../shared/password-policy.mjs';

// Actual JSX AST and extracted callbacks only: no React mount/browser claim.
const source = readFileSync(new URL('./Perfil.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Perfil.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const all = [];
function visit(node) { all.push(node); ts.forEachChild(node, visit); } visit(file);
const text = node => node.getText(file);
const declaration = name => all.find(node => ts.isVariableDeclaration(node) && text(node.name) === name);
const callback = (name, bindings) => {
  const actual = { profileFailureMessage, newPasswordError, PASSWORD_POLICY_MESSAGE, ...bindings };
  return new Function(...Object.keys(actual), `return (${text(declaration(name).initializer)});`)(...Object.values(actual));
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('profile capture pins actual runtime and session reader; all three requests delegate to guard, never raw authorization', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  assert.match(text(declaration('capture')), /runtime: getApplicationSession\(\)/);
  assert.match(text(declaration('capture')), /session: sesion, readSession: getSesion/);
  const requests = all.filter(node => ts.isCallExpression(node) && text(node.expression) === 'guard.request');
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(node => node.arguments[1].text).sort(), ['/api/usuarios/foto', '/api/usuarios/password', '/api/usuarios/perfil']);
  for (const request of requests) {
    assert.equal(text(request.arguments[0]), 'fetch');
    assert.match(text(request.arguments[2]), /'Content-Type': 'application\/json'/);
  }
  assert.equal(all.filter(node => ts.isCallExpression(node) && text(node.expression) === 'fetch').length, 0);
  assert.doesNotMatch(source, /guard.headers\(|Authorization|\.token|guardarSesion\(/);
  assert.equal((source.match(/guard.requireReauthentication\(\)/g) || []).length, 2);
});
test('every actual response JSON callback checks current session before and after reading the body', () => {
  const callbacks = all.filter(node => ts.isArrowFunction(node) && /const data = await response.json\(\)/.test(text(node))
    && node.parameters.length === 1 && text(node.parameters[0].name) === 'response');
  assert.equal(callbacks.length, 3);
  for (const callback of callbacks) {
    const statements = callback.body.statements;
    assert.equal(text(statements[0]), 'if (!guard.current()) return null;');
    assert.match(text(statements[1]), /await response.json\(\)/);
    assert.equal(text(statements[2]), 'if (!guard.current()) return null;');
  }
});
test('browser photo refuses any other draft, while legacy preserves existing behavior', () => {
  for (const field of ['usuarioNuevo', 'passwordUsuario', 'actual', 'nueva', 'confirmar']) {
    const bindings = { operationPending: { current: false }, getApplicationSession: () => ({ mode: 'browser' }),
      usuarioNuevo: 'qa', perfilUsuario: { usuario: 'qa' }, passwordUsuario: '', actual: '', nueva: '', confirmar: '',
      setErrorFoto: message => { assert.match(message, /Guardá o descartá/); } };
    bindings[field] = 'draft';
    assert.equal(callback('canChangePhoto', bindings)(), false);
    bindings.getApplicationSession = () => ({ mode: 'bearer' });
    assert.equal(callback('canChangePhoto', bindings)(), true);
  }
});
test('all profile inputs/buttons disable together and imperative handlers reject overlapping operations', () => {
  const controls = all.filter(node => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ['input', 'button'].includes(text(node.tagName)));
  assert.equal(controls.length, 9);
  for (const control of controls) {
    const disabled = control.attributes.properties.find(node => ts.isJsxAttribute(node) && text(node.name) === 'disabled');
    assert.equal(text(disabled.initializer.expression), 'busy');
  }
  assert.match(text(declaration('busy')), /enviandoFoto \|\| enviandoUsuario \|\| enviando/);
  for (const name of ['handleSubmit', 'handleCambiarUsuario']) assert.match(text(declaration(name)), /if \(operationPending.current\) return/);
  for (const name of ['handleFotoPerfil', 'handleQuitarFotoPerfil']) assert.match(text(declaration(name)), /if \(!canChangePhoto\(\)\) return/);
});
test('photo busy starts before FileReader; stale or unmounted conversion cannot send or repaint', async () => {
  const pending = deferred(), events = []; let current = true;
  const operationPending = { current: false };
  const run = callback('handleFotoPerfil', { canChangePhoto: () => true, capture: () => ({ current: () => current }),
    setMensajeFoto: () => {}, setErrorFoto: value => { if (value !== null) events.push('error'); }, operationPending,
    setEnviandoFoto: value => events.push(['busy', value]),
    reducirFotoPerfil: () => { assert.equal(operationPending.current, true); assert.deepEqual(events, [['busy', true]]); return pending.promise; },
    guardarFotoPerfil: () => events.push('send') });
  const result = run({ target: { files: [{ type: 'image/png' }], value: 'file' } });
  current = false; pending.resolve('image'); await result;
  assert.deepEqual(events, [['busy', true]]);
});
test('conversion failure releases busy only for the still-current page', async () => {
  const events = [], operationPending = { current: false };
  const run = callback('handleFotoPerfil', { canChangePhoto: () => true, capture: () => ({ current: () => true }),
    setMensajeFoto: () => {}, setErrorFoto: value => events.push(value), operationPending,
    setEnviandoFoto: value => events.push(value), reducirFotoPerfil: async () => { throw Error('No se pudo leer la imagen.'); } });
  await run({ target: { files: [{ type: 'image/png' }] } });
  assert.equal(operationPending.current, false); assert.deepEqual(events, [null, true, 'No se pudo leer la imagen.', false]);
});
test('photo awaits commit and never paints old browser page; legacy commit still updates identity', async () => {
  for (const mode of ['browser', 'bearer']) {
    const pending = deferred(), paints = [], user = { id: 7, foto_perfil: 'image' };
    const run = callback('actualizarSesionPerfil', { getApplicationSession: () => ({ mode }),
      setPerfilUsuario: value => paints.push(value), setFotoPerfil: value => paints.push(value) });
    const result = run({}, { applyPhoto: () => pending.promise, current: () => true });
    assert.deepEqual(paints, []); pending.resolve(user);
    assert.equal(await result, mode === 'browser' ? null : user);
    assert.deepEqual(paints, mode === 'browser' ? [] : [user, 'image']);
  }
});

const settle = async () => { for (let count = 0; count < 15; count += 1) await Promise.resolve(); };
function passwordForm(nueva, { confirmar = nueva, request = async () => ({ ok:true,json:async()=>({ok:true}) }) } = {}) {
  const events = [], calls = [], operationPending = {current:false}; let current = true;
  const guard = { current:()=>current, request:(transport,url,options)=>{calls.push({url,options});return request(url,options);}, requireReauthentication:()=>events.push(['reauth']) };
  const bindings = { operationPending, capture:()=>guard, nueva, confirmar, actual:'old', usuarioNuevo:'qa_synthetic',passwordUsuario:'',perfilUsuario:{usuario:'qa_synthetic'},fetch:()=>{throw Error('Never direct fetch');},
    ...Object.fromEntries(['Mensaje','Error','Enviando','Actual','Nueva','Confirmar'].map(name=>[`set${name}`,value=>events.push([name,value])])) };
  const submit=callback('handleSubmit',bindings);
  return {events,calls,operationPending,submit:()=>submit({preventDefault(){}}),stale:()=>{current=false;}};
}

test('shared new-password policy blocks invalid values before dispatch or pending state, without changing legacy current password rules',async()=>{
  for(const value of ['', 'short', 'a'.repeat(11), '😀'.repeat(11), 'é'.repeat(37), 'a'.repeat(73), ' '.repeat(12), 'a'.repeat(12)+'\u0000', '\ud800'+'a'.repeat(12), 'a'.repeat(12)+'\udfff']){
    const form=passwordForm(value);form.submit();await settle();assert.equal(form.calls.length,0);assert.equal(form.operationPending.current,false);
    assert.ok(form.events.some(([name,message])=>name==='Error'&&message===newPasswordError(value)));assert.equal(form.events.some(([name])=>name==='Nueva'||name==='Actual'||name==='reauth'),false);
  }
});

test('actual password callback preserves valid Unicode, leading/trailing whitespace and exact 72-byte boundaries',async()=>{
  for(const value of ['  Clave-QA-😀-2026  ', 'é'.repeat(36), '😀'.repeat(18), 'a'.repeat(72), 'a'.repeat(11)+'\n']){
    assert.equal(newPasswordError(value),null);const form=passwordForm(value);form.submit();await settle();assert.equal(form.calls.length,1);
    assert.equal(form.calls[0].url,'/api/usuarios/password');assert.equal(form.calls[0].options.method,'PATCH');
    assert.deepEqual(JSON.parse(form.calls[0].options.body),{usuario:'qa_synthetic',password_actual:'old',password_nueva:value});
    assert.equal(form.operationPending.current,false);assert.ok(form.events.some(([name])=>name==='reauth'));
  }
});

test('confirmation compares exact password including spaces and policy wiring is real with accessible 12/72 hint',async()=>{
  const form=passwordForm('  Clave-QA-2026  ',{confirmar:'Clave-QA-2026'});form.submit();await settle();assert.equal(form.calls.length,0);
  assert.match(text(declaration('handleSubmit')),/newPasswordError\(nueva\)/);assert.doesNotMatch(text(declaration('handleSubmit')),/nueva\.trim\(|nueva\.length < 4/);
  assert.match(source,/from ['"]\.\.\/\.\.\/\.\.\/shared\/password-policy\.mjs['"]/);
  const inputs=all.filter(node=>ts.isJsxSelfClosingElement(node)&&text(node.tagName)==='input'&&node.attributes.properties.some(attr=>ts.isJsxAttribute(attr)&&text(attr.name)==='value'&&['nueva','confirmar'].includes(text(attr.initializer.expression))));
  assert.equal(inputs.length,2);
  for(const input of inputs){const minimum=input.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&text(attr.name)==='minLength');assert.equal(text(minimum.initializer.expression),'12');assert.equal(input.attributes.properties.some(attr=>ts.isJsxAttribute(attr)&&text(attr.name)==='maxLength'),false);}
  assert.match(source,/aria-describedby="profile-password-policy"/);assert.match(source,/id="profile-password-policy">Al menos 12 caracteres y hasta 72 bytes UTF-8/);
});

test('pending password operation rejects duplicate dispatch; late response or body after session change cannot repaint/reauthenticate',async()=>{
  const pending=deferred(),form=passwordForm('Valid-synthetic-2026',{request:()=>pending.promise});form.submit();form.submit();assert.equal(form.calls.length,1);assert.equal(form.operationPending.current,true);
  form.stale();const mark=form.events.length;pending.resolve({ok:true,json:async()=>({ok:true})});await settle();assert.equal(form.events.length,mark);
  const body=deferred(),second=passwordForm('Valid-synthetic-2026',{request:async()=>({ok:true,json:()=>body.promise})});second.submit();await settle();second.stale();const before=second.events.length;body.resolve({ok:true});await settle();assert.equal(second.events.length,before);
});

test('server NEW_PASSWORD_INVALID uses trusted shared copy, does not echo response baggage and retains draft/session',async()=>{
  const privateText='private-api-baggage-not-for-ui';
  const form=passwordForm('Valid-synthetic-2026',{request:async()=>({ok:false,json:async()=>({code:'NEW_PASSWORD_INVALID',error:privateText,password_hash:'never-display'})})});
  form.submit();await settle();assert.ok(form.events.some(([name,value])=>name==='Error'&&value===PASSWORD_POLICY_MESSAGE));
  assert.ok(!JSON.stringify(form.events).includes(privateText));assert.ok(!JSON.stringify(form.events).includes('never-display'));
  assert.equal(form.events.some(([name])=>['Actual','Nueva','Confirmar','reauth'].includes(name)),false);assert.equal(form.operationPending.current,false);
});

test('password requires literal successful ACK before clearing secrets or requesting reauthentication',async()=>{
  for(const value of [null,{},[],{ok:false},{ok:'true'},{ok:1},{error:'private detail'}]){
    const form=passwordForm('Valid-synthetic-2026',{request:async()=>({ok:true,json:async()=>value})});form.submit();await settle();
    assert.equal(form.calls.length,1);assert.equal(form.operationPending.current,false);
    assert.equal(form.events.some(([name])=>['Actual','Nueva','Confirmar','reauth'].includes(name)),false);
    assert.equal(form.events.some(([name,message])=>name==='Mensaje'&&message!==null),false);
    assert.ok(form.events.some(([name,message])=>name==='Error'&&message===profileFailureMessage(new Error('unconfirmed'))));
  }
});

function usernameForm(responseBody, { request, profile = {id:7,usuario:'qa_synthetic',rol:'diseno'} } = {}) {
  const events=[],calls=[],operationPending={current:false};let current=true;
  const guard={current:()=>current,request:(transport,url,options)=>{calls.push({url,options});return request?request(url,options):Promise.resolve({ok:true,json:async()=>responseBody});},requireReauthentication:()=>events.push(['reauth'])};
  const run=callback('handleCambiarUsuario',{operationPending,capture:()=>guard,usuarioNuevo:'  nuevo_qa  ',perfilUsuario:profile,passwordUsuario:'old',actual:'',nueva:'',confirmar:'',fetch:()=>{throw Error('Never direct fetch');},
    ...Object.fromEntries(['MensajeUsuario','ErrorUsuario','EnviandoUsuario'].map(name=>[`set${name}`,value=>events.push([name,value])]))});
  return{events,calls,operationPending,submit:()=>run({preventDefault(){}}),stale:()=>{current=false;}};
}

test('username requires held ID, exact requested login and unchanged role; malformed ACK never navigates or reports success',async()=>{
  for(const body of [null,{},[],{id:8,usuario:'nuevo_qa',rol:'diseno'},{id:'7',usuario:'nuevo_qa',rol:'diseno'},
    {id:7,usuario:'otro_qa',rol:'diseno'},{id:7,usuario:' nuevo_qa ',rol:'diseno'},{id:7,usuario:'nuevo_qa',rol:'admin'},{id:7,usuario:'nuevo_qa'}]){
    const form=usernameForm(body);form.submit();await settle();assert.equal(form.calls.length,1);assert.equal(form.operationPending.current,false);
    assert.equal(form.events.some(([name])=>name==='reauth'),false);assert.equal(form.events.some(([name,value])=>name==='MensajeUsuario'&&value!==null),false);
    assert.ok(form.events.some(([name,value])=>name==='ErrorUsuario'&&value===profileFailureMessage(new Error('unconfirmed'))));
  }
  const valid=usernameForm({id:7,usuario:'nuevo_qa',rol:'diseno'});valid.submit();await settle();assert.ok(valid.events.some(([name])=>name==='reauth'));
  assert.deepEqual(JSON.parse(valid.calls[0].options.body),{usuario_actual:'qa_synthetic',password_actual:'old',usuario_nuevo:'nuevo_qa'});
});

test('username validates captured identity primitives, never mutable later profile data; late success/body retains session fences',async()=>{
  const pending=deferred(),profile={id:7,usuario:'qa_synthetic',rol:'diseno'};
  const form=usernameForm(null,{profile,request:()=>pending.promise});form.submit();profile.id=8;profile.rol='admin';
  pending.resolve({ok:true,json:async()=>({id:8,usuario:'nuevo_qa',rol:'admin'})});await settle();assert.equal(form.events.some(([name])=>name==='reauth'),false);
  const late=deferred(),stale=usernameForm(null,{request:()=>late.promise});stale.submit();stale.stale();const mark=stale.events.length;
  late.resolve({ok:true,json:async()=>({id:7,usuario:'nuevo_qa',rol:'diseno'})});await settle();assert.equal(stale.events.length,mark);
  const body=deferred(),lateBody=usernameForm(null,{request:async()=>({ok:true,json:()=>body.promise})});lateBody.submit();await settle();lateBody.stale();const before=lateBody.events.length;
  body.resolve({id:7,usuario:'nuevo_qa',rol:'diseno'});await settle();assert.equal(lateBody.events.length,before);
});
