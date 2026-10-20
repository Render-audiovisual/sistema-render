import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { homeEditorialRecordPiece } from './homeEditorialControl.js';

// Pure projection plus actual source wiring only: no component/browser mount.
const base = () => ({ domain: 'historia', id: 42, cliente: { id: 7 }, estado: 'lista', fecha_programada: '2026-10-19' });
test('record projection contains only minimal server-lookup context, never supplied proof or financial fields', () => {
  for (const domain of ['historia', 'publicacion']) {
    for (const estado of ['pendiente', 'en_diseño', 'en_edición', 'en_revision', 'en_revisión', 'lista', 'publicada', 'bloqueada', 'rechazada']) {
      const item = Object.freeze({ ...base(), domain, estado, cliente_id: 999,
        titulo: 'Not record context', revision: 99, publication_classification: 'confirmada_manualmente',
        publicacion_evidencia: { classification: 'confirmada_manualmente' }, current_confirmation: { id: 'forged' },
        fecha_publicacion_real: '2026-10-19T12:00:00Z', 'fecha_publicación_real': '2026-10-19T12:00:00Z',
        metadata: { importe: 981231.42 }, private_finance: 'private', href: '/forged' });
      const result = homeEditorialRecordPiece(item);
      assert.deepEqual(result, { id: 42, cliente_id: 7, estado, fecha_programada: '2026-10-19' });
      assert.notEqual(result, item);
      assert.deepEqual(Object.keys(result).sort(), ['cliente_id', 'estado', 'fecha_programada', 'id']);
    }
  }
  assert.deepEqual(homeEditorialRecordPiece({ ...base(), estado: 'bloqueada', fecha_programada: null }),
    { id: 42, cliente_id: 7, estado: 'bloqueada', fecha_programada: null }, 'Nullable schedule is preserved, never invented');
  assert.deepEqual(homeEditorialRecordPiece({ ...base(), id: 2147483647, cliente: { id: 2147483647 }, fecha_programada: '2024-02-29' }),
    { id: 2147483647, cliente_id: 2147483647, estado: 'lista', fecha_programada: '2024-02-29' });
});

test('record projection rejects malformed input, IDs, domains, dates and task-only states', () => {
  for (const item of [null, undefined, false, 1, 'piece', [], {}]) assert.equal(homeEditorialRecordPiece(item), null);
  for (const value of [null, undefined, 0, -1, 1.5, '42', {}, [], true, NaN, Infinity, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(homeEditorialRecordPiece({ ...base(), id: value }), null);
    assert.equal(homeEditorialRecordPiece({ ...base(), cliente: { id: value } }), null);
  }
  for (const cliente of [null, undefined, {}, [], 7]) assert.equal(homeEditorialRecordPiece({ ...base(), cliente }), null);
  for (const domain of [null, undefined, '', 'Historia', 'tarea', 'historias', {}, []])
    assert.equal(homeEditorialRecordPiece({ ...base(), domain }), null);
  for (const fecha_programada of [undefined, '', '2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01',
    '2026-1-01', '2026-10-19T00:00:00Z', ' 2026-10-19', 42, {}, []])
    assert.equal(homeEditorialRecordPiece({ ...base(), fecha_programada }), null);
  for (const estado of [null, undefined, '', 'finalizada', 'aprobada', 'programada', 'LISTA', {}, []])
    assert.equal(homeEditorialRecordPiece({ ...base(), estado }), null);
});

const parse = path => ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const file = parse('./HomeEditorialControl.jsx'), home = parse('../pages/QuickHome.jsx');
const text = n => n.getText(n.getSourceFile());
const nodes = (root, predicate) => {
  const result = [];
  const visit = n => { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); };
  visit(root); return result;
};
const calls = (root, name) => nodes(root, n => ts.isCallExpression(n) && text(n.expression) === name);
const decl = (root, name) => nodes(root, n => ts.isVariableDeclaration(n) && text(n.name) === name)[0];
const attr = (tag, name) => tag.attributes.properties.find(n => ts.isJsxAttribute(n) && text(n.name) === name);
const expr = (tag, name) => {
  const value = attr(tag, name)?.initializer;
  assert.ok(value && ts.isJsxExpression(value) && value.expression, `${name} expression exists`);
  return value.expression;
};
const tags = root => nodes(root, n => ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n));
const record = () => {
  const found = tags(file).filter(n => text(n.tagName) === 'EditorialPublicationControl');
  assert.equal(found.length, 1); return found[0];
};

test('card mounts existing guarded publication control with minimal context, no request override or fake evidence', () => {
  assert.ok(file.statements.some(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './EditorialPublicationControl.jsx'));
  const tag = record();
  assert.equal(text(expr(tag, 'dominio')), 'item.domain');
  const piece = expr(tag, 'pieza');
  assert.ok(ts.isCallExpression(piece));
  assert.equal(text(piece.expression), 'homeEditorialRecordPiece');
  assert.deepEqual(piece.arguments.map(text), ['item']);
  assert.equal(text(expr(tag, 'sesion')), 'view.session', 'Publication control receives the exact stable-view session DTO');
  assert.ok(!tag.attributes.properties.some(ts.isJsxSpreadAttribute), 'No spread can smuggle a request/proof override');
  assert.equal(attr(tag, 'request'), undefined, 'Existing control keeps its API/session guard');
  assert.ok(attr(tag, 'hideSummary') && !attr(tag, 'hideSummary').initializer);
  assert.equal(attr(tag, 'openLabel')?.initializer?.text, 'Ver registro de publicación');
  const saved = expr(tag, 'onSaved');
  const callback = ts.isIdentifier(saved) ? decl(file, text(saved))?.initializer : saved;
  assert.ok(callback && ts.isArrowFunction(callback));
  const refresh = calls(callback, 'loaderRef.current?.refresh');
  assert.equal(refresh.length, 1); assert.equal(refresh[0].arguments.length, 0, 'Reload full server state, not callback DTO totals');
  assert.equal(calls(callback, 'setResult').length, 0);
  assert.equal(calls(callback, 'homeEditorialRecordPiece').length, 0);
});

test('stable open callbacks update refs synchronously before state and notify the guarded parent', () => {
  assert.equal(text(expr(record(), 'onOpenChange')), 'changeRecordOpen');
  const mount = tags(home).find(n => text(n.tagName) === 'HomeEditorialControl');
  assert.ok(mount);
  assert.equal(text(expr(mount, 'onRecordOpenChange')), 'recordOpenChanged');
  for (const [root, name, ref, setter, deps] of [
    [file, 'changeRecordOpen', 'recordOpenRef', 'setRecordOpen', ['onRecordOpenChange']],
    [home, 'recordOpenChanged', 'editorialRecordOpenRef', 'setEditorialRecordOpen', []],
  ]) {
    const memo = decl(root, name)?.initializer;
    assert.ok(memo && ts.isCallExpression(memo) && text(memo.expression) === 'useCallback');
    assert.deepEqual(memo.arguments[1].elements.map(text), deps);
    const callback = memo.arguments[0];
    const writes = nodes(callback, n => ts.isBinaryExpression(n) && text(n.left) === `${ref}.current`);
    assert.equal(writes.length, 1); assert.equal(text(writes[0].right), 'open');
    const state = calls(callback, setter); assert.equal(state.length, 1);
    assert.ok(writes[0].pos < state[0].pos, 'Ref is visible before React state commit');
    if (root === file) {
      const notify = calls(callback, 'onRecordOpenChange');
      assert.equal(notify.length, 1);
      assert.deepEqual(notify[0].arguments.map(text), ['open']);
      assert.ok(writes[0].pos < notify[0].pos, 'Notify parent only after the local ref is current');
    }
  }
});

test('both actual refresh subscriptions and manual refreshes refuse while publication record is open', () => {
  for (const [root, ref] of [[file, 'recordOpenRef'], [home, 'editorialRecordOpenRef']]) {
    const subscribe = calls(root, 'subscribePersonalHomeRefresh'); assert.equal(subscribe.length, 1);
    const options = subscribe[0].arguments[0]; assert.ok(ts.isObjectLiteralExpression(options));
    const property = options.properties.find(n => ts.isPropertyAssignment(n) && text(n.name) === 'refresh');
    assert.ok(property && ts.isArrowFunction(property.initializer));
    const callback = property.initializer;
    const state = { current: true }, events = [];
    const selectionRef = { current: { bucket: 'today', offset: 0 } };
    const invoke = new Function(ref, 'loader', 'selectionRef', `return (${text(callback)});`)(state,
      { refresh: options => { events.push(options); return 'refreshed'; } }, selectionRef);
    const refreshOptions = { background: true };
    assert.equal(invoke(refreshOptions), false); assert.deepEqual(events, []);
    state.current = false; assert.equal(invoke(refreshOptions), 'refreshed'); assert.deepEqual(events, [refreshOptions]);
    if (ref === 'recordOpenRef') {
      selectionRef.current = null;
      assert.equal(invoke(refreshOptions), false);
      assert.deepEqual(events, [refreshOptions], 'Invalid URL selection must not trigger background fallback requests');
    }
    const manual = decl(root, 'refresh')?.initializer; assert.ok(manual && ts.isArrowFunction(manual));
    const manualCalls = [];
    const click = new Function(ref, 'loaderRef', `return (${text(manual)});`)(state, { current: { refresh: () => manualCalls.push('refresh') } });
    state.current = true; click(); assert.deepEqual(manualCalls, []);
    state.current = false; click(); assert.deepEqual(manualCalls, ['refresh']);
    const button = tags(root).find(n => text(n.tagName) === 'button' && attr(n, 'className')?.initializer?.text === 'qh-refresh');
    assert.ok(button);
    assert.ok(nodes(expr(button, 'disabled'), ts.isIdentifier).some(n => text(n) === (root === file ? 'recordOpen' : 'editorialRecordOpen')));
  }
});
