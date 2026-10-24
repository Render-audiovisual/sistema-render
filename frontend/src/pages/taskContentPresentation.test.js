import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';
import { getTaskContentPresentation } from '../features/render-os/utils/task-content-presentation.js';
import { insertTaskContentBlock } from '../features/render-os/utils/task-content-insertion.js';
import { getUnifiedTaskContent, isLinkedProductionEditorialTask } from '../features/render-os/utils/task-content.js';

// Execute canonical JSX, not a replacement component. SSR/element callbacks
// prove presentation and draft wiring, not mounted browser or HTTP behavior.
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
const declaration = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TaskContentWorkspace');
assert.ok(declaration);
const js = ts.transpileModule(declaration.getText(file), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const Component = Function('React', 'getUnifiedTaskContent', 'isLinkedProductionEditorialTask', 'getTaskContentPresentation', 'renderizarTextoTarea',
  `${js};return TaskContentWorkspace;`)(React, getUnifiedTaskContent, isLinkedProductionEditorialTask, getTaskContentPresentation, value => value);
const task = (extra = {}) => ({ id: 81, revision: 7, tipo_tarea: 'desarrollo', subtipo: 'web', titulo: 'Sitio',
  aclaraciones: 'Requisitos originales', propiedades_extra: { guiones: 'Guion legado', copy_trabajo: 'Copy legado', resumen: 'Conservar', custom: { immutable: true } }, ...extra });
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function setup(row, overrides = {}) {
  const calls = [], draft = freeze({ ...row, aclaraciones: getUnifiedTaskContent(row), localOnly: 'Conservar borrador' });
  const props = { task: row, metadata: row.propiedades_extra, editing: true, draft, editorRef: { current: null },
    setDraft: value => calls.push(['draft', value]), onInsertTemplate: value => calls.push(['template', value]),
    onEditContent: () => calls.push(['edit']), onCancelEdit: () => calls.push(['cancel']),
    onSaveEdit: () => calls.push(['save']), saving: false, canSave: true, ...overrides };
  return { props, calls, tree: Component(props), html: () => renderToStaticMarkup(React.createElement(Component, props)) };
}
function nodes(root, predicate) {
  if (Array.isArray(root)) return root.flatMap(n => nodes(n, predicate));
  if (!React.isValidElement(root)) return [];
  return [...(predicate(root) ? [root] : []), ...nodes(root.props.children, predicate)];
}
const text = node => Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);

for (const [kind, subtype] of [['desarrollo', 'web'], ['administracion', null], ['diseno', 'landing']]) {
  test(`${kind}/${subtype}: real brief changes presentation but retains all legacy content and exact template callbacks`, () => {
    const row = freeze(task({ tipo_tarea: kind, subtipo: subtype })), before = structuredClone(row);
    const h = setup(row), presentation = getTaskContentPresentation(row);
    const textarea = nodes(h.tree, n => n.type === 'textarea');
    assert.equal(textarea.length, 1);
    assert.equal(textarea[0].props.value, 'Requisitos originales\n\nGuion legado\n\nCopy legado');
    assert.equal(textarea[0].props.placeholder, presentation.placeholder);
    assert.match(presentation.description, /requisitos/i);
    assert.match(presentation.description, /criteri/i);
    assert.match(presentation.description, /entregable/i);
    const tools = nodes(h.tree, n => n.props.className === 'ros-content-tools')[0];
    const buttons = nodes(tools, n => n.type === 'button');
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons.map(text), presentation.templates.map(t => t.label));
    assert.deepEqual(buttons.map(text), ['+ Requisito', '+ Criterios de aceptación', '+ Entregable']);
    assert.doesNotMatch(buttons.map(text).join(' '), /Video|Escena|Guion|Copy|Placa|CTA/);
    for (const button of buttons) { assert.equal(button.props.type, 'button'); button.props.onClick(); }
    assert.deepEqual(h.calls, presentation.templates.map(t => ['template', t.value]));
    assert.deepEqual(h.calls, [
      ['template', 'REQUISITO\nQué hay que resolver:\nAlcance:'],
      ['template', 'CRITERIOS DE ACEPTACIÓN\nCondiciones que debe cumplir:\nCómo comprobarlas:'],
      ['template', 'ENTREGABLE\nResultado esperado:\nFormato y ubicación:'],
    ]);
    const html = h.html();
    for (const value of ['Guion legado', 'Copy legado', presentation.description]) assert.ok(html.includes(value));
    assert.equal(nodes(h.tree, n => n.type === 'aside').length, 0);
    assert.deepEqual(row, before);
  });
}

test('actual onChange replaces only aclaraciones and preserves draft fields and metadata identity', () => {
  const row = freeze(task()), h = setup(row), previous = structuredClone(h.props.draft);
  nodes(h.tree, n => n.type === 'textarea')[0].props.onChange({ target: { value: 'Nuevo requerimiento\nCriterio explícito' } });
  assert.equal(h.calls.length, 1);
  const [kind, next] = h.calls[0]; assert.equal(kind, 'draft');
  assert.deepEqual(next, { ...h.props.draft, aclaraciones: 'Nuevo requerimiento\nCriterio explícito' });
  assert.equal(next.propiedades_extra, row.propiedades_extra);
  assert.deepEqual(h.props.draft, previous);
  assert.notEqual(next, h.props.draft);
});

test('real cancel/save callbacks and disabled/saving states remain unchanged', () => {
  for (const saving of [false, true]) for (const canSave of [false, true]) {
    const h = setup(freeze(task()), { saving, canSave });
    const actions = nodes(h.tree, n => n.props.className === 'ros-content-edit-actions')[0];
    const buttons = nodes(actions, n => n.type === 'button');
    const cancel = buttons.find(n => text(n) === 'Cancelar'), save = buttons.find(n => n.props.className === 'primary');
    assert.equal(cancel.props.onClick, h.props.onCancelEdit);
    assert.equal(save.props.onClick, h.props.onSaveEdit);
    assert.equal(save.props.disabled, saving || !canSave);
    assert.equal(text(save), saving ? 'Guardando…' : 'Guardar texto');
    cancel.props.onClick();
    if (!save.props.disabled) save.props.onClick(); // Do not emulate native disabled clicks.
    assert.deepEqual(h.calls, [['cancel'], ...(!saving && canSave ? [['save']] : [])]);
    assert.match(h.html(), saving || !canSave ? /class="primary"[^>]*disabled=""/ : /class="primary" type="button">Guardar texto/);
  }
});

test('non-editorial empty and read-only branches keep honest text and render old content rather than suppressing it', () => {
  const empty = freeze(task({ aclaraciones: '', propiedades_extra: { guiones: '', copy_trabajo: '' } }));
  const h = setup(empty, { editing: false });
  const presentation = getTaskContentPresentation(empty);
  assert.ok(h.html().includes(presentation.empty));
  assert.doesNotMatch(presentation.empty, /guion|copy|video/i);
  nodes(h.tree, n => n.type === 'button' && text(n) === 'Escribir contenido')[0].props.onClick();
  assert.deepEqual(h.calls, [['edit']]);
  const viewer = setup(freeze(task()), { editing: false, onEditContent: null });
  for (const value of ['Requisitos originales', 'Guion legado', 'Copy legado']) assert.ok(viewer.html().includes(value));
  const content = nodes(viewer.tree, n => n.props.className?.includes('ros-content-viewer'))[0];
  assert.equal(content.props.role, undefined); assert.equal(content.props.tabIndex, undefined);
});

test('linked production editorial script excludes copy but keeps the actual read-only aside and fallback', () => {
  const row = freeze(task({ publicacion_id: 19, propiedades_extra: { guiones: 'Guion vinculado', copy_trabajo: '<Copy editorial>', origen_produccion_video_id: '10000000-0000-4000-8000-000000000001' } }));
  for (const editing of [true, false]) {
    const h = setup(row, { editing });
    const aside = nodes(h.tree, n => n.type === 'aside');
    assert.equal(aside.length, 1); assert.equal(aside[0].props['aria-label'], 'Copy editorial');
    assert.ok(text(aside[0]).includes('<Copy editorial>'));
    assert.match(h.html(), /&lt;Copy editorial&gt;/);
    if (editing) {
      assert.equal(nodes(h.tree, n => n.type === 'textarea')[0].props.value, 'Requisitos originales\n\nGuion vinculado');
      const tools = nodes(h.tree, n => n.props.className === 'ros-content-tools')[0];
      assert.deepEqual(nodes(tools, n => n.type === 'button').map(text), getTaskContentPresentation(row).templates.map(t => t.label));
      assert.doesNotMatch(text(tools), /Placa|Cierre \/ CTA/);
    }
  }
  const emptyCopy = task({ ...row, propiedades_extra: { ...row.propiedades_extra, copy_trabajo: '' } });
  assert.match(setup(emptyCopy).html(), /El copy editorial se gestiona en la pieza vinculada\./);
});

test('ordinary editorial tasks retain all six original insertion actions without a separate copy aside', () => {
  const row = freeze(task({ tipo_tarea: 'edicion', subtipo: 'reel' })), h = setup(row);
  const tools = nodes(h.tree, n => n.props.className === 'ros-content-tools')[0];
  const buttons = nodes(tools, n => n.type === 'button');
  assert.deepEqual(buttons.map(text), ['+ Video', '+ Escena', '+ Placa', '+ Cierre / CTA', '+ Objetivo', '+ Requisito']);
  buttons.forEach(button => button.props.onClick());
  assert.deepEqual(h.calls, [
    ['template', 'VIDEO\nIdea:\nGuion:\nReferencia:'], ['template', 'ESCENA\nVisual:\nTexto / diálogo:'],
    ['template', 'PLACA\nTexto:\nVisual:'], ['template', 'CIERRE / CTA\nAcción esperada:'],
    ['template', 'OBJETIVO\n'], ['template', '• '],
  ]);
  assert.equal(nodes(h.tree, n => n.type === 'aside').length, 0);
  assert.match(h.html(), /Guion, copy e indicaciones en un solo lugar/);
});

function insertionCallback(bindings) {
  const owner = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TaskDetail');
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'insertContentTemplate') found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(owner);
  assert.equal(found.length, 1);
  assert.ok(ts.isArrowFunction(found[0].initializer));
  return Function(...Object.keys(bindings), `return (${found[0].initializer.getText(file)});`)(...Object.values(bindings));
}

test('actual insertion callback uses the shared block helper at start, selected range and end, retaining draft metadata and caret', () => {
  const row = freeze(task()), content = getUnifiedTaskContent(row);
  const template = getTaskContentPresentation(row).templates[0].value;
  const selectedStart = content.indexOf('Guion legado'), selectedEnd = selectedStart + 'Guion legado'.length;
  for (const [name, start, end] of [['start', 0, 0], ['selection', selectedStart, selectedEnd], ['end', content.length, content.length]]) {
    const draft = freeze({ ...row, localOnly: 'No cambiar', aclaraciones: content });
    const observed = [], before = structuredClone(draft);
    const textarea = { selectionStart: start, selectionEnd: end,
      focus: () => observed.push(['focus']), setSelectionRange: (...args) => observed.push(['caret', ...args]) };
    const expected = insertTaskContentBlock(content, template, start, end);
    let ack;
    insertionCallback({ task: row, draft, scriptEditorRef: { current: textarea }, getUnifiedTaskContent,
      insertTaskContentBlock: (...args) => { observed.push(['insert', ...args]); return insertTaskContentBlock(...args); },
      setDraft: value => { observed.push(['draft']); ack = value; },
      requestAnimationFrame: fn => { observed.push(['frame']); fn(); },
    })(template);
    assert.deepEqual(observed, [['insert', content, template, start, end], ['draft'], ['frame'], ['focus'], ['caret', expected.cursor, expected.cursor]], name);
    assert.deepEqual(ack, { ...draft, aclaraciones: expected.value }, name);
    assert.equal(ack.propiedades_extra, draft.propiedades_extra);
    assert.deepEqual(draft, before);
    assert.ok(expected.value.includes(template));
    if (name === 'start') assert.ok(expected.value.endsWith(content), 'Original whole document retained after inserted block');
    if (name === 'end') assert.ok(expected.value.startsWith(content), 'Original whole document retained before inserted block');
    if (name === 'selection') {
      assert.ok(expected.value.startsWith(content.slice(0, start)));
      assert.ok(expected.value.endsWith(content.slice(end)));
      assert.equal(expected.value.includes('Guion legado'), false, 'Only the explicitly selected text is replaced');
    }
    assert.ok(expected.cursor >= template.length && expected.cursor <= expected.value.length);
  }
});

test('insertion honors a newer draft instead of the old saved document, and absent textarea safely appends without focus', () => {
  const row = freeze(task()), draft = freeze({ ...row, aclaraciones: 'Borrador aún no guardado', localOnly: 42 });
  const template = getTaskContentPresentation(row).templates[2].value;
  const calls = [];
  let ack;
  insertionCallback({ task: row, draft, scriptEditorRef: { current: null }, getUnifiedTaskContent, insertTaskContentBlock,
    setDraft: value => { ack = value; }, requestAnimationFrame: fn => { calls.push('frame'); fn(); },
  })(template);
  assert.deepEqual(ack, { ...draft, aclaraciones: insertTaskContentBlock(draft.aclaraciones, template, draft.aclaraciones.length, draft.aclaraciones.length).value });
  assert.ok(ack.aclaraciones.startsWith(draft.aclaraciones));
  assert.deepEqual(calls, ['frame']);
  assert.equal(ack.propiedades_extra, draft.propiedades_extra);
});

test('actual mobile template toolbar wraps every button with visible overflow and minimum44px targets', () => {
  const css = postcss.parse(readFileSync(new URL('./TaskDetailNotion.css', import.meta.url), 'utf8'));
  const mobile = [];
  css.walkAtRules('media', media => {
    if (media.params.replace(/\s/g, '') === '(max-width:600px)') mobile.push(media);
  });
  assert.equal(mobile.length, 1);
  const declarations = selector => {
    const result = {};
    mobile[0].walkRules(rule => {
      if (postcss.list.comma(rule.selector).includes(selector)) rule.walkDecls(d => { result[d.prop] = d.value; });
    });
    return result;
  };
  const toolbar = declarations('.render-workspace .ros-content-tools');
  assert.equal(toolbar['flex-wrap'], 'wrap');
  assert.equal(toolbar['overflow-x'], 'visible');
  assert.notEqual(toolbar.overflow, 'hidden');
  const button = declarations('.render-workspace .ros-content-tools button');
  assert.equal(button.flex, '0 1 auto');
  assert.equal(button['max-width'], '100%');
  assert.equal(button['white-space'], 'normal');
  assert.equal(button['min-height'], '44px');
});
