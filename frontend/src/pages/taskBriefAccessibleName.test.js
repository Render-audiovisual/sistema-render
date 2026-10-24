import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { getUnifiedTaskContent, isLinkedProductionEditorialTask } from '../features/render-os/utils/task-content.js';
import { getTaskContentPresentation } from '../features/render-os/utils/task-content-presentation.js';

// Actual component JSX and event handler; no native AX/focus or persistence claim.
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function one(root, predicate) {
  const found = [];
  (function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); })(root);
  assert.equal(found.length, 1);
  return found[0];
}
const component = one(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === 'TaskContentWorkspace');
const textarea = one(component, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'textarea');
const attr = name => textarea.attributes.properties.find(node => node.name?.getText(ast) === name);
const code = ts.transpileModule(`const extracted=(${component.getText(ast)});`, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
const Content = new Function('React', 'getUnifiedTaskContent', 'isLinkedProductionEditorialTask', 'getTaskContentPresentation',
  'renderizarTextoTarea', `${code};return extracted;`)(React, getUnifiedTaskContent, isLinkedProductionEditorialTask,
  getTaskContentPresentation, value => value);

test('real brief editor exposes a stable descriptive accessible name independent of placeholder or draft', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.equal(attr('aria-label').initializer.text, 'Brief · Contenido de trabajo');
  for (const text of ['', 'Borrador exacto', '<contenido & especial>']) {
    const html = renderToStaticMarkup(React.createElement(Content, {
      task: { id: 1, tipo_tarea: 'edicion', aclaraciones: 'Inicial', propiedades_extra: {} }, metadata: {},
      editing: true, draft: { aclaraciones: text }, setDraft() {}, editorRef: { current: null },
      onInsertTemplate() {}, onCancelEdit() {}, onSaveEdit() {}, saving: false, canSave: true,
    }));
    const tag = html.match(/<textarea\b[^>]*>/g);
    assert.equal(tag?.length, 1);
    assert.match(tag[0], /aria-label="Brief · Contenido de trabajo"/);
  }
});

test('brief onChange retains its exact existing draft update and wiring', () => {
  const handler = attr('onChange').initializer.expression.getText(ast);
  assert.equal(handler, '(event) => setDraft({ ...draft, aclaraciones: event.target.value })');
  assert.equal(attr('value').initializer.expression.getText(ast), 'value');
  assert.equal(attr('ref').initializer.expression.getText(ast), 'editorRef');
  assert.equal(attr('placeholder').initializer.expression.getText(ast), 'presentation.placeholder');
  const draft = Object.freeze({ id: 1, revision: 8, aclaraciones: 'Original', titulo: 'Preservado' });
  const updates = [];
  const change = new Function('draft', 'setDraft', `return (${handler});`)(draft, value => updates.push(value));
  change({ target: { value: 'Nuevo texto exacto' } });
  assert.deepEqual(updates, [{ ...draft, aclaraciones: 'Nuevo texto exacto' }]);
  assert.equal(draft.aclaraciones, 'Original');
});
