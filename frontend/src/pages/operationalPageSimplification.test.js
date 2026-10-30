import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { ESTADOS_HISTORIA } from '../constants.js';
import { storyWorkStateLabel } from './storyWorkStateLabel.js';
import { readFeedbackNotesLocation, feedbackNotesLocationUrl } from './feedbackNotesPagination.js';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const tree = name => ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function declaration(file, name) {
  let found;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); };
  visit(file); assert.ok(found, name); return found;
}
function evaluate(node, file, deps) {
  const js = ts.transpileModule(node.getText(file).replace(/^export /, ''), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(deps), `${js};return ${node.name.text};`)(...Object.values(deps));
}
function elements(root, type) {
  const values = []; const walk = node => { if (!node || typeof node !== 'object') return;
    if (node.type === type) values.push(node); React.Children.forEach(node.props?.children, walk); };
  walk(root); return values;
}
test('right-side story panel uses real IDs and emits only existing work states, never publication', () => {
  const file = tree('./StoryWorkPanel.jsx'), calls = [];
  const Panel = evaluate(declaration(file, 'StoryWorkPanel'), file, { React, Modal: ({ children }) => React.createElement(React.Fragment, null, children), storyWorkStateLabel });
  const story = { id: 95001, cliente_id: 95002, estado: 'pendiente', fecha_programada: '2026-10-27', idea: 'Synthetic story' };
  const props = { story, states: ESTADOS_HISTORIA, disabled: false, onChange: (...args) => calls.push(args), onClose() {} };
  const component = Panel(props), control = elements(component, 'select')[0];
  const html = renderToStaticMarkup(component);
  assert.match(html, /Bloqueado/); assert.match(html, /En proceso/); assert.doesNotMatch(html, /value="en_proceso"/);
  for (const estado of ['bloqueada', 'en_diseño', 'publicada', 'en_proceso', 'invalid']) control.props.onChange({ target: { value: estado } });
  assert.deepEqual(calls, [[95001, { estado: 'bloqueada' }], [95001, { estado: 'en_diseño' }]]);
  elements(Panel({ ...props, disabled: true }), 'select')[0].props.onChange({ target: { value: 'bloqueada' } });
  assert.equal(calls.length, 2);
  assert.match(read('./StoryWorkPanel.css'), /story-work-overlay\{justify-content:flex-end/);
  assert.match(read('./Historias.jsx'), /setOpenedStoryId\(h.id\)/);
  assert.match(read('./Historias.jsx'), /actualizarLocal\(id, fields\); guardarEnServidor\(id, fields\)/);
});
test('feedback has two note tabs and no list filters or task inventory; editing core remains', () => {
  const source = read('./Feedback.jsx');
  assert.match(source, /<b>Cliente<\/b>/); assert.match(source, /<b>Equipo<\/b>/);
  assert.doesNotMatch(source, /<FeedbackTaskInventory|className="rf-toolbar"|Buscar feedback|Filtrar categoría de notas/);
  for (const name of ['createFeedbackNotesMutation', 'verifyMutation', 'FeedbackResponsiblePicker', 'trashAction', 'editNote', 'createNote']) assert.ok(source.includes(name));
});
test('retired feedback filters cannot hide notes; valid pagination and linked IDs survive', () => {
  const file = tree('./Feedback.jsx');
  const location = search => evaluate(declaration(file, 'feedbackNotesLocation'), file, { window: { location: { search } }, readFeedbackNotesLocation })();
  const old = location('?section=all&note=95003&categoria=reunion&q=hidden&offset=50&expected_snapshot=' + 'a'.repeat(64));
  assert.equal(old.selection.note, 95003); assert.equal(old.selection.q, ''); assert.equal(old.selection.categoria, null);
  assert.equal(old.selection.offset, 0); assert.equal(old.selection.expected_snapshot, null);
  const paged = location('?section=team&offset=50&expected_snapshot=' + 'a'.repeat(64));
  assert.equal(paged.selection.section, 'team'); assert.equal(paged.selection.offset, 50);
  assert.equal(location('?section=clients&section=team').selection, null);
});
test('linked team-note restart uses authoritative detail section and preserves note ID/trash, clearing old filters', () => {
  const file = tree('./Feedback.jsx'), effects = [], item = { id: 95003, section: 'team' };
  const restart = evaluate(declaration(file, 'restartNotes'), file, {
    contextEpoch: { current: 0 }, panelEpoch: { current: 0 }, readerRef: { current: { invalidate() {} } },
    selection: { ...readFeedbackNotesLocation('?section=clients&mode=trash'), q: 'old', categoria: 'web' },
    window: { location: { href: 'https://render.test/feedback?section=all&note=95003' }, history: { state: {}, replaceState: (...args) => effects.push(args) } },
    feedbackNotesLocationUrl, notifyViewPreferenceChange() {}, linkedNoteId: { current: null }, preparedPage: { current: null },
    setNotes() {}, setPage() {}, setLoading() {}, setLocation: value => effects.push(value),
  });
  restart(item);
  const next = effects[1].selection;
  assert.equal(next.section, 'team'); assert.equal(next.note, 95003); assert.equal(next.papelera, true);
  assert.equal(next.q, ''); assert.equal(next.categoria, null);
  assert.match(read('./Feedback.jsx'), /if\(item.section!==selection.section\) restartNotes\(item\)/);
});
test('actual linked-detail callback opens a team note from the old all link and fences stale callbacks', () => {
  const file = tree('./Feedback.jsx'); let callback;
  const walk = node => {
    if (ts.isArrowFunction(node) && node.parameters[0]?.name.getText(file) === 'item'
      && node.getText(file).includes('restartNotes(item)')) callback = node;
    ts.forEachChild(node, walk);
  };
  walk(file); assert.ok(callback);
  const effects = [], reader = {}, readerRef = { current: reader }, panelEpoch = { current: 0 }, linkedNoteId = { current: 95003 };
  const dependencies = { reader, readerRef, panelEpoch, observedPanel: 0, linkedNoteId, selection: { section: 'clients' },
    restartNotes: item => effects.push(['section', item.section, item.id]), setSelected: item => effects.push(['detail', item]) };
  const js = ts.transpileModule(`const callback=(${callback.getText(file)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const accept = Function(...Object.keys(dependencies), `${js};return callback;`)(...Object.values(dependencies));
  const item = { id: 95003, section: 'team', categoria: 'reunion' };
  accept(item); assert.deepEqual(effects, [['section', 'team', 95003], ['detail', item]]); assert.equal(linkedNoteId.current, null);
  effects.length = 0; panelEpoch.current++; accept(item); assert.deepEqual(effects, []);
  panelEpoch.current = 0; readerRef.current = {}; accept(item); assert.deepEqual(effects, []);
});
test('productions exposes only the client list filter and retains recording/resume functions', () => {
  const source = read('./Productions.jsx'), file = tree('./Productions.jsx'); assert.deepEqual(file.parseDiagnostics, []);
  const nav = source.slice(source.indexOf('<nav className="prod-toolbar"'), source.indexOf('</nav>', source.indexOf('<nav className="prod-toolbar"')));
  assert.equal((nav.match(/<FilterSelect/g) || []).length, 1); assert.match(nav, /label="Cliente"/);
  assert.doesNotMatch(nav, /Quitar filtro de cliente/);
  assert.match(nav, /<option value="">Todos los clientes<\/option>/);
  assert.doesNotMatch(nav, /prod-refresh/);
  assert.match(source, /className="prod-heading-actions"/);
  assert.match(source, /className="prod-refresh"[^>]*onClick=\{retryProductionPage\}/);
  assert.match(nav, /Videos pendientes/); assert.doesNotMatch(source, /Banco de pendientes/);
  for (const name of ['CreateVisit', 'VisitDetail', 'Participants', 'writeVisit', 'Retomar en la visita seleccionada']) assert.ok(source.includes(name));
  const Item = evaluate(declaration(file, 'VisitAgendaItem'), file, { React, dateLabel: date => date,
    productionResultStatus: () => ({ label: 'Sin resultado registrado' }), VIDEO_STATES: {}, PHOTO_STATES: {} });
  const visit = { id: 'synthetic', fecha: '2026-10-27', titulo: 'Local only', cliente_nombre: 'Synthetic client', participante_ids: [95001, 95002], videos: [], fotos: [] };
  const calls = [], component = Item({ visit, users: [{ id: 95001, nombre: 'Synthetic participant' }], onOpen: id => calls.push(id) });
  const html = renderToStaticMarkup(component);
  for (const text of ['Synthetic client', '2026-10-27', 'Synthetic participant', 'Usuario #95002']) assert.ok(html.includes(text));
  elements(component, 'button')[0].props.onClick(); assert.deepEqual(calls, ['synthetic']);
});
