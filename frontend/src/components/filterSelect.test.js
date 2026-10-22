import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';

const source = readFileSync(new URL('./FilterSelect.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('FilterSelect.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const declaration = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'FilterSelect');
const compiled = ts.transpileModule(declaration.getText(file).replace(/^export /, ''), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
const FilterSelect = new Function('React', `${compiled};return FilterSelect;`)(React);
const css = postcss.parse(readFileSync(new URL('./FilterSelect.css', import.meta.url), 'utf8'));

test('actual React element forwards native props, handlers, ref and options without transforming values', () => {
  const ref = React.createRef(), value = ['7'], onChange = () => {}, onKeyDown = () => {};
  const children = React.createElement('option', { value: '7' }, 'Cliente observado');
  const element = FilterSelect({ label: 'Cliente', className: 'local-field', selectClassName: 'local-select', ref,
    children, value, onChange, onKeyDown, multiple: true, size: 4, disabled: true, required: true,
    name: 'cliente', id: 'cliente', form: 'filters', 'aria-describedby': 'help', 'data-context': 'list', autoFocus: true });
  assert.equal(element.type, 'label'); assert.equal(element.props.className, 'render-filter-field local-field');
  const [label, select] = element.props.children;
  assert.equal(label.props.children, 'Cliente'); assert.equal(select.type, 'select');
  assert.equal(select.props.className, 'render-filter-select local-select');
  assert.equal(select.props.ref, ref); assert.equal(select.props.children, children);
  for (const [name, expected] of Object.entries({ value, onChange, onKeyDown, multiple: true, size: 4, disabled: true,
    required: true, name: 'cliente', id: 'cliente', form: 'filters', 'aria-describedby': 'help', 'data-context': 'list', autoFocus: true })) assert.equal(select.props[name], expected, name);
});

test('SSR is one implicitly labelled native select with unchanged options and no button/menu/keyboard interception', () => {
  const html = renderToStaticMarkup(React.createElement(FilterSelect, { label: 'Estado', defaultValue: 'legacy', 'aria-label': 'Filtrar estado' },
    React.createElement('option', { value: '' }, 'Todos'), React.createElement('option', { value: 'legacy', disabled: true }, 'Histórico')));
  assert.equal((html.match(/<select\b/g) || []).length, 1);
  assert.match(html, /^<label class="render-filter-field"><span>Estado<\/span><select/);
  assert.match(html, /aria-label="Filtrar estado"/); assert.match(html, /value="legacy" disabled="" selected=""/);
  assert.doesNotMatch(html, /<button|role="(?:combobox|listbox|menu)"|tabindex/i);
  const select = FilterSelect({ label: 'Estado' }).props.children[1];
  assert.equal(select.props.onKeyDown, undefined); assert.equal(select.props.onClick, undefined);
  assert.equal(file.parseDiagnostics.length, 0);
});

function rule(selector, media = null) {
  const found = [];
  css.walkRules(node => { if (node.selector === selector && (media === null ? node.parent.type === 'root' : node.parent.params === media)) found.push(node); });
  assert.equal(found.length, 1, `${selector} / ${media}`);
  return Object.fromEntries(found[0].nodes.map(n => [n.prop, n.value]));
}
test('CSS AST pins touch, typography, focus and disabled contracts without important or global selectors', () => {
  const base = rule('select.render-filter-select');
  assert.equal(base['min-height'], '44px'); assert.equal(base['font-family'], 'var(--render-font)');
  assert.equal(base['font-size'], '14px'); assert.equal(base['border-radius'], '8px');
  assert.equal(base['background-color'], 'var(--render-surface)');
  assert.equal(rule('select.render-filter-select', '(max-width:1024px)')['font-size'], '16px');
  assert.deepEqual(rule('select.render-filter-select:focus-visible'), { outline: '2px solid var(--render-accent)', 'outline-offset': '3px' });
  assert.equal(rule('select.render-filter-select:disabled').opacity, '.6');
  css.walkDecls(n => assert.equal(!!n.important, false));
  css.walkRules(n => assert.ok(n.selector.startsWith('select.render-filter-select') || n.selector === 'label.render-filter-field'));
});
test('chevron applies only to single dropdowns and forced colors restores native arrow', () => {
  const selector = 'select.render-filter-select:not([multiple]):is(:not([size]), [size="0"], [size="1"])';
  const normal = rule(selector), forced = rule(selector, '(forced-colors:active)');
  assert.equal(normal.appearance, 'none'); assert.equal(normal['padding-right'], '36px');
  assert.equal(normal['background-size'], '12px 12px'); assert.equal(normal['background-position'], 'right 12px center');
  assert.match(normal['background-image'], /^url\("data:image\/svg\+xml,/);
  assert.equal(forced.appearance, 'auto'); assert.equal(forced['background-image'], 'none');
});
