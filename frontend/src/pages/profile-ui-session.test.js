import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { profileFailureMessage } from '../shared/session/profile-session.js';

// Actual JSX AST and extracted callbacks only: no React mount/browser claim.
const source = readFileSync(new URL('./Perfil.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Perfil.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const all = [];
function visit(node) { all.push(node); ts.forEachChild(node, visit); } visit(file);
const text = node => node.getText(file);
const declaration = name => all.find(node => ts.isVariableDeclaration(node) && text(node.name) === name);
const callback = (name, bindings) => {
  const actual = { profileFailureMessage, ...bindings };
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
