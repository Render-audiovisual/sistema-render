import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { useState, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Execute production JSX and callbacks, without HTTP, browser globals or services.
const source = readFileSync(new URL('./ClientesObjetivos.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ClientesObjetivos.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
const owner = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PieceDetail');
assert.ok(owner);
function nodes(root, predicate) {
  const result = [];
  function walk(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, walk); }
  walk(root); return result;
}
function declaration(name) {
  return nodes(owner, n => ts.isVariableDeclaration(n) && n.name.getText(file) === name)[0];
}
function evaluate(node, deps) {
  assert.ok(node, 'Expected production declaration');
  return Function(...Object.keys(deps), `return (${node.getText(file)});`)(...Object.values(deps));
}
const pieceFixture = extra => ({ id: 3, tarea_id: 9, tipo: 'video', titulo: 'Pieza', copy: 'Copy', estado: 'aprobada', responsables: ['QA'], ...extra });
const harmless = () => {};
const goalId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const compiled = ts.transpileModule(owner.getText(file), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
function render(piece, canManage) {
  const deps = {
    React, useState, useRef, goalId, useEffect: harmless, useGoalDraftMemory: () => null,
    useGoalModalFocus: harmless, useNavigationGuard: harmless,
    useGoalSession: () => ({ capture: () => ({ current: () => true }), captureLifetime: () => ({ current: () => true }) }),
    Modal: ({ children }) => React.createElement('section', null, children),
    GoalIcon: () => null, STATES: {}, done: () => false, pieceLabel: p => p.titulo,
  };
  const Component = Function(...Object.keys(deps), `${compiled};return PieceDetail;`)(...Object.values(deps));
  return renderToStaticMarkup(React.createElement(Component, {
    sesion: {}, piece, client: { clave: 'qa', nombre: 'QA' }, canManage, close: harmless, saved: harmless,
  }));
}

for (const capability of [undefined, false, 'true', 'false', 1, null, true]) {
  for (const tarea_id of [9, null]) {
    test(`actual JSX: capability=${String(capability)} (${typeof capability}), task=${tarea_id}`, () => {
      const piece = pieceFixture({ tarea_id });
      if (capability !== undefined) piece.puede_editar_contenido = capability;
      for (const canManage of [false, true]) {
        const html = render(piece, canManage);
        assert.equal(html.includes('Editar contenido'), capability === true && tarea_id !== null);
        assert.equal(html.includes('Abrir tarea'), tarea_id !== null);
        if (tarea_id) assert.match(html, /href="\/workspace\/tareas\?task=9"/);
      }
    });
  }
}

function callbacks(capability) {
  const calls = [], effects = [];
  const piece = pieceFixture();
  if (capability !== undefined) piece.puede_editar_contenido = capability;
  const version = '2026-10-20T11:00:00.123Z';
  const scope = {
    current: () => true, assertCurrent: harmless,
    request: async (url, options) => {
      calls.push({ url, options });
      return options?.method === 'PATCH'
        ? { revision: 8, updated_at: '2026-10-20T12:00:00.123Z' }
        : { id: 9, revision: 7, updated_at: version, titulo: 'Título leído', propiedades_extra: { copy_trabajo: 'Copy leído' } };
    },
  };
  // Valid editor state deliberately simulates a forged UI/stale open editor.
  const deps = {
    draftMemory: null, readRetainedDraft: () => null, useGoalDraftMemory: () => null,
    piece, editing: true, title: 'Borrador', copy: 'Copy borrador',
    taskRevision: 6, taskVersion: version, pending: { current: false }, editBaseline: { current: null },
    capture: () => scope, captureLifetime: () => scope,
    goalId: value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647,
    goalTime: value => typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)),
    isSessionFailure: () => false, saved: () => effects.push(['saved']),
  };
  const capabilityNode = declaration('canEditContent');
  deps.canEditContent = capabilityNode ? evaluate(capabilityNode.initializer, deps) : undefined;
  for (const name of ['Busy', 'Error', 'Editing', 'Title', 'Copy', 'TaskVersion', 'TaskRevision']) {
    deps[`set${name}`] = value => {
      effects.push([name, value]);
      deps[name[0].toLowerCase() + name.slice(1)] = value;
    };
  }
  return { calls, effects, deps, run: name => evaluate(declaration(name)?.initializer, deps)() };
}

for (const capability of [undefined, false, 'true', 'false', 1, null]) {
  for (const callback of ['beginEdit', 'saveContent']) {
    test(`${callback} denies ${String(capability)} (${typeof capability}) even with forged valid editor state`, async () => {
      const h = callbacks(capability);
      await h.run(callback);
      assert.deepEqual(h.calls, [], 'Denied capability must not dispatch any request');
      assert.deepEqual(h.effects, [], 'Denied callback must not change editor state or report success');
      assert.equal(h.deps.pending.current, false);
    });
  }
}

test('strict true permits actual read followed by content CAS using the read revision', async () => {
  const h = callbacks(true);
  await h.run('beginEdit');
  assert.deepEqual(h.calls, [{ url: '/api/tareas/9?workspace=render_os', options: undefined }]);
  assert.equal(h.deps.editing, true);
  assert.equal(h.deps.title, 'Título leído');
  assert.equal(h.deps.copy, 'Copy leído');
  assert.equal(h.deps.taskRevision, 7);
  assert.equal(h.deps.editBaseline.current, JSON.stringify({ title: 'Título leído', copy: 'Copy leído' }));
  h.deps.title = 'Título editado'; h.deps.copy = 'Copy editado';
  await h.run('saveContent');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].url, '/api/cliente-objetivos/piezas/3/contenido');
  assert.equal(h.calls[1].options.method, 'PATCH');
  assert.deepEqual(h.calls[1].options.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(h.calls[1].options.body), {
    titulo: 'Título editado', copy: 'Copy editado',
    expected_updated_at: '2026-10-20T11:00:00.123Z', expected_revision: 7,
  });
  assert.equal(h.effects.filter(([name]) => name === 'saved').length, 1);
  assert.equal(h.deps.pending.current, false);
});
