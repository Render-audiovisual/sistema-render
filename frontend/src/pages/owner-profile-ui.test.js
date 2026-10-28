import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { parseBrowserSession } from '../shared/session/browser-session-state.js';
import { ownerProfileCapability, activeOwnerProfileLabel } from '../shared/session/owner-profiles.js';

const read = value => readFileSync(new URL(value, import.meta.url), 'utf8');
const homeSource = read('./QuickHome.jsx'), sidebarSource = read('../components/Sidebar.jsx');
const home = ts.createSourceFile('QuickHome.jsx', homeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const sidebar = ts.createSourceFile('Sidebar.jsx', sidebarSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function element(tree, className) {
  let found;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr =>
      attr.name?.getText(tree) === 'className' && attr.initializer?.text === className)) found = node;
    ts.forEachChild(node, visit);
  }; visit(tree); assert.ok(found); return found;
}
function evaluate(expression, tree, deps) {
  const js = ts.transpileModule(`const value=(${expression.getText(tree)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None },
  }).outputText;
  return Function('React', ...Object.keys(deps), `${js};return value;`)(React, ...Object.values(deps));
}
const dto = active => parseBrowserSession({ usuario: { id: active === null ? 91001 : active === 'franco' ? 91005 : 91006,
  usuario: 'synthetic-qa', nombre: 'Not a source of capability', rol: 'admin' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43),
  owner_profiles: { principal_id: 91001, active, profiles: [{ key: 'franco', user_id: 91005, name: 'Franco QA' },
    { key: 'agustin', user_id: 91006, name: 'Agustín QA' }] } });
function controls(sesion, overrides = {}) {
  return evaluate(element(home, 'qh-owner-access').parent, home, {
    ownerProfiles: ownerProfileCapability(sesion), sesion, onChangeOwner() {}, activeOwnerProfileLabel,
    validIdentity: true, editorialRecordOpen: false, ownerProfileState: { busy: false }, ...overrides,
  });
}

// Actual JSX expressions rendered on the server: no claim of a mounted browser
// journey, computed CSS or physical backend acceptance.
test('actual Home profile controls require explicit server capability, never admin/name inference', () => {
  for (const sesion of [null, { usuario: { id: 91001, rol: 'admin', nombre: 'Franco' } },
    { token: 'legacy', ...dto(null) }]) assert.equal(renderToStaticMarkup(controls(sesion)), '');
  const html = renderToStaticMarkup(controls(dto(null)));
  assert.match(html, /Cuenta Render · perfil principal/); assert.equal((html.match(/<button/g) || []).length, 2);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 2);
  assert.doesNotMatch(html, /91001|91005|91006|session_context|csrf_token/);
});
test('actual buttons show server active state and delegate only profile key; pending/unsaved locks disable them', () => {
  const calls = [], session = dto('franco'), group = controls(session, { onChangeOwner: profile => calls.push(profile) });
  const html = renderToStaticMarkup(group); assert.match(html, /perfil activo: Franco QA/);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  const buttons = group.props.children.flatMap(child => Array.isArray(child) ? child : [child]).filter(child => child?.type === 'button');
  buttons[1].props.onClick(); assert.deepEqual(calls, ['agustin']);
  for (const override of [{ ownerProfileState: { busy: true } }, { editorialRecordOpen: true }, { validIdentity: false }]) {
    const disabled = renderToStaticMarkup(controls(session, override)); assert.equal((disabled.match(/disabled=""/g) || []).length, 2);
  }
});
test('actual Sidebar active label comes only from session metadata and offers no profile switching control', () => {
  const target = element(sidebar, 'user-owner-profile').parent;
  const session = dto('agustin');
  assert.match(renderToStaticMarkup(evaluate(target, sidebar, { ownerProfileLabel: activeOwnerProfileLabel(session) })), /perfil activo: Agustín QA/);
  assert.equal(renderToStaticMarkup(evaluate(target, sidebar, { ownerProfileLabel: null })), '');
  assert.doesNotMatch(sidebarSource, /onChangeOwner|perfil-dueno|changeProfile\(/);
  assert.match(read('./QuickHome.css'), /\.quick-home \.qh-owner-access button\[aria-pressed="true"\]/);
  assert.match(read('../components/Sidebar.css'), /\.sidebar \.user-owner-profile/);
});
