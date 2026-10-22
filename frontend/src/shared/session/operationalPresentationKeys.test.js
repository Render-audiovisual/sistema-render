import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sessionViewKey } from './session-view.js';
import { createBrowserSessionState } from './browser-session-state.js';
import { isEditingDeliveryTask } from '../../components/EditingDeliveries.model.js';

const definitions = [
  ['CalendarPage', '../../pages/Calendar.jsx', 'CalendarContent'],
  ['EditingDeliveries', '../../components/EditingDeliveries.jsx', 'DeliverySection'],
  ['EditingReviews', '../../components/EditingReviews.jsx', 'ReviewsSection'],
];
const wrappers = definitions.map(([name, path, child]) => {
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length, 0);
  const node = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  const js = ts.transpileModule(node.getText(file).replace(/^export /, ''), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  const React = { createElement: (type, props) => ({ type, key: props.key, props }) };
  return { name, editing: name !== 'CalendarPage', render: new Function('React', 'sessionViewKey', 'isEditingDeliveryTask', child,
    `${js};return ${name};`)(React, sessionViewKey, isEditingDeliveryTask, child), child };
});
const task = { id: 31, revision: 1, tipo_tarea: 'edicion', propiedades_extra: { workspace: 'render_os' } };
const bearer = (token = 'synthetic-secret-one', role = 'edicion') => ({ token, usuario: { id: 7, rol: role, activo: true } });
const dto = (role = 'edicion') => ({ usuario: { id: 7, rol: role, nombre: 'Synthetic', usuario: 'qa' }, session_context: 'C'.repeat(43), csrf_token: 'D'.repeat(43) });
function observe(store, role) { store.acceptBootstrap(store.beginBootstrap(), dto(role)); return store.getSession(); }
function key(wrapper, sesion, currentTask = task) {
  const element = wrapper.render({ task: currentTask, sesion });
  assert.equal(element.props.sesion, sesion);
  assert.equal(element.type, wrapper.child);
  assert.equal(typeof element.key, 'string');
  for (const secret of [sesion.token, sesion.session_context, sesion.csrf_token].filter(Boolean))
    assert.equal(element.key.includes(secret), false, 'Presentation key must not contain session authority');
  return element.key;
}

for (const wrapper of wrappers) {
  test(`${wrapper.name}: exact bearer clones retain key; changed and returned observations get fresh opaque keys`, () => {
    const a = bearer(), first = key(wrapper, a);
    assert.equal(key(wrapper, structuredClone(a)), first);
    const second = key(wrapper, bearer('synthetic-secret-two'));
    assert.notEqual(second, first);
    const returned = key(wrapper, a); assert.notEqual(returned, first); assert.notEqual(returned, second);
    assert.notEqual(key(wrapper, bearer(a.token, 'admin')), returned);
  });
  test(`${wrapper.name}: registered cookie rebootstrap and different owner/role observations never reuse prior key`, () => {
    const store = createBrowserSessionState(), other = createBrowserSessionState();
    const a = observe(store), first = key(wrapper, a);
    assert.equal(key(wrapper, a), first);
    const repeated = observe(store); assert.equal(repeated.usuario.id, a.usuario.id);
    const next = key(wrapper, repeated); assert.notEqual(next, first);
    const foreign = key(wrapper, observe(other)); assert.notEqual(foreign, next);
    const role = key(wrapper, observe(store, 'admin')); assert.notEqual(role, foreign); assert.notEqual(role, next);
  });
  test(`${wrapper.name}: actual wrapper forwards caller props by identity and retains editing guard`, () => {
    const props = { task, sesion: bearer(), onSaved() {}, onDirty() {}, onBusy() {}, onReviewContext() {}, onNavigate() {}, disabled: true };
    const element = wrapper.render(props);
    const names = wrapper.editing ? ['task', 'sesion', 'onSaved', 'onDirty', 'onBusy'] : ['sesion', 'onNavigate'];
    if (wrapper.name === 'EditingDeliveries') names.push('onReviewContext');
    if (wrapper.name === 'EditingReviews') names.push('disabled');
    for (const name of names) assert.equal(element.props[name], props[name], name);
    if (wrapper.editing) {
      assert.equal(wrapper.render({ ...props, task: { ...task, tipo_tarea: 'administracion' } }), null);
      assert.equal(wrapper.render({ ...props, task: null }), null);
      const session = observe(createBrowserSessionState());
      assert.notEqual(key(wrapper, session, task), key(wrapper, session, { ...task, id: 32 }));
      const originalKey = key(wrapper, session, task);
      assert.equal(key(wrapper, session, { ...task, revision: 2, estado: 'en_revision' }), originalKey,
        'Task revision/status changes must not remount dirty editing forms');
      if (wrapper.name === 'EditingReviews') {
        const defaultProps = { ...props }; delete defaultProps.disabled;
        assert.equal(wrapper.render(defaultProps).props.disabled, false);
      }
    }
  });
}
