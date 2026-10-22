import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';
import { PROJECT_STATES } from '../pages/projectsModel.js';
import { CALENDAR_KINDS } from '../pages/calendarModel.js';

// Actual consumer JSX/callbacks plus CSS-AST ownership checks. Extracted JSX
// and SSR are NOT mounted React, native select interaction or computed layout.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const parse = (name, source) => {
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(tree.parseDiagnostics.length, 0, `${name} parses`);
  return tree;
};
const routes = Object.fromEntries(['Projects', 'Productions', 'Calendar'].map(name =>
  [name, parse(`${name}.jsx`, read(`../pages/${name}.jsx`))]));
function find(root, predicate) {
  const result = [];
  function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }
  visit(root); return result;
}
const attribute = (node, name) => node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.text === name);
const label = node => attribute(node.openingElement, 'label')?.initializer?.text;
const adopted = tree => find(tree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'FilterSelect');
const control = (route, name) => {
  const result = adopted(routes[route]).filter(node => label(node) === name);
  assert.equal(result.length, 1, `${route}/${name} has exactly one shared control`);
  return result[0];
};
function evaluate(source, bindings = {}) {
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('React', ...Object.keys(bindings), `${js}\nreturn result;`)(React, ...Object.values(bindings));
}
const componentTree = parse('FilterSelect.jsx', read('./FilterSelect.jsx'));
const component = componentTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'FilterSelect');
assert.ok(component, 'Use the actual shared component, not a test substitute');
const FilterSelect = evaluate(`const result = (${component.getText(componentTree).replace(/^export\s+/, '')});`);
const optionsFunction = routes.Projects.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Options');
const Options = evaluate(`const result = (${optionsFunction.getText(routes.Projects)});`);
function element(route, name, bindings) {
  return evaluate(`const result = (${control(route, name).getText(routes[route])});`, { FilterSelect, Options, PROJECT_STATES, CALENDAR_KINDS, ...bindings });
}
function optionRows(element) {
  const rows = [];
  function walk(node) {
    React.Children.forEach(node, child => {
      if (!React.isValidElement(child)) return;
      if (typeof child.type === 'function') { walk(child.type(child.props)); return; }
      if (child.type === 'option') rows.push({ value: child.props.value, disabled: child.props.disabled === true,
        text: React.Children.toArray(child.props.children).join('') });
      else walk(child.props.children);
    });
  }
  walk(element); return rows;
}
const row = (value, text, disabled = false) => ({ value, text, disabled });

test('only six intended filter controls adopt the real shared import, never business editors', () => {
  for (const [name, labels] of Object.entries({ Projects: ['Cliente', 'Estado'], Productions: ['Cliente'], Calendar: ['Ámbito', 'Tipo', 'Cliente'] })) {
    const tree = routes[name];
    assert.deepEqual(adopted(tree).map(label), labels);
    const imports = tree.statements.filter(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === '../components/FilterSelect.jsx');
    assert.equal(imports.length, 1);
    assert.ok(imports[0].importClause.namedBindings.elements.some(node => node.name.text === 'FilterSelect' && !node.propertyName));
    for (const node of adopted(tree)) {
      let parent = node.parent, nestedLabel = false;
      while (parent) {
        if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(tree) === 'label') nestedLabel = true;
        parent = parent.parent;
      }
      assert.equal(nestedLabel, false, `${name}/${label(node)} does not nest labels`);
      assert.ok(attribute(node.openingElement, 'value'));
      assert.ok(attribute(node.openingElement, 'onChange'));
    }
  }
  for (const route of ['Projects', 'Productions']) {
    const native = find(routes[route], node => ts.isJsxElement(node) && node.openingElement.tagName.getText(routes[route]) === 'select');
    assert.ok(native.some(node => attribute(node.openingElement, 'required')), `${route} business selects remain native and required`);
  }
});

test('Projects keeps invalid/missing client context, ID labels and exact filter callbacks', () => {
  const calls = [];
  const bindings = { filters: { invalid: false, clientId: 73, estado: '' }, filterClients: { items: [{ id: 11, nombre: 'Cuenta' }] },
    chooseClient: value => calls.push(['client', value]), changeListFilters: value => calls.push(['filters', value]) };
  const client = element('Projects', 'Cliente', bindings);
  assert.equal(client.props['aria-label'], 'Filtrar proyectos por cliente');
  assert.equal(client.props.value, 73);
  assert.deepEqual(optionRows(client), [row('', 'Todos los clientes'), row(73, 'Cliente ID 73'), row(11, 'Cuenta · ID 11')]);
  client.props.onChange({ target: { value: '11' } });
  const state = element('Projects', 'Estado', bindings);
  state.props.onChange({ target: { value: 'en_progreso' } });
  assert.deepEqual(calls, [['client', '11'], ['filters', { estado: 'en_progreso', offset: 0 }]]);
  assert.deepEqual(optionRows(state), [row('', 'Todos los estados'), ...Object.entries(PROJECT_STATES).map(([id, text]) => row(id, text))]);
  const invalid = { ...bindings, filters: { ...bindings.filters, invalid: true } };
  assert.equal(element('Projects', 'Cliente', invalid).props.value, 'invalid');
  assert.deepEqual(optionRows(element('Projects', 'Cliente', invalid))[0], row('invalid', 'Filtro inválido', true));
  assert.equal(element('Projects', 'Estado', invalid).props.disabled, true);
});

test('Productions preserves client IDs, inactive aliases and the selected tab in its real callback', () => {
  const calls = [];
  const bindings = { clientId: '73', tab: 'pending', clients: [{ id: 11, nombre: 'Cuenta', activo: false }], changeContext: (...args) => calls.push(args) };
  const client = element('Productions', 'Cliente', bindings);
  assert.equal(client.props.value, '73');
  assert.deepEqual(optionRows(client), [row('', 'Todos los clientes'), row('73', 'Cliente #73'), row(11, 'Cuenta (inactivo)')]);
  client.props.onChange({ target: { value: '11' } });
  client.props.onChange({ target: { value: '' } });
  assert.deepEqual(calls, [['11', 'pending'], ['', 'pending']]);
  assert.equal(optionRows(element('Productions', 'Cliente', { ...bindings, clientId: '11' })).length, 2, 'Known ID has no duplicate fallback');
});

test('Calendar keeps scope/type catalogs, missing client option and field-specific navigation', () => {
  const calls = [];
  const bindings = { selection: { scope: 'team', tipo: 'visita', cliente: '73' }, data: { clients: [{ id: 11, nombre: 'Cuenta' }] }, change: value => calls.push(value) };
  const scope = element('Calendar', 'Ámbito', bindings), type = element('Calendar', 'Tipo', bindings), client = element('Calendar', 'Cliente', bindings);
  assert.equal(scope.props.value, 'team'); assert.equal(type.props.value, 'visita'); assert.equal(client.props.value, '73');
  assert.deepEqual(optionRows(scope), [row('mine', 'Lo mío'), row('team', 'Equipo')]);
  assert.deepEqual(optionRows(type), Object.entries(CALENDAR_KINDS).map(([id, text]) => row(id, text)));
  assert.deepEqual(optionRows(client), [row('', 'Todos los clientes'), row('73', 'Cliente #73'), row(11, 'Cuenta')]);
  scope.props.onChange({ target: { value: 'mine' } }); type.props.onChange({ target: { value: 'hito' } }); client.props.onChange({ target: { value: '' } });
  assert.deepEqual(calls, [{ scope: 'mine' }, { tipo: 'hito' }, { cliente: '' }]);
  assert.deepEqual(optionRows(element('Calendar', 'Cliente', { ...bindings, data: null })), [row('', 'Todos los clientes'), row('73', 'Cliente #73')]);
});

test('adopted controls render actual wrapping labels/native selects without custom widget semantics', () => {
  const onChange = () => {}, ref = { current: null };
  const node = FilterSelect({ label: 'Cliente', id: 'qa-client', name: 'cliente', value: '11', disabled: true,
    required: true, 'aria-describedby': 'qa-help', onChange, ref, children: React.createElement('option', { value: '11' }, 'Cuenta') });
  assert.equal(node.type, 'label');
  const select = React.Children.toArray(node.props.children).find(child => child.type === 'select');
  assert.ok(select); assert.equal(select.props.ref, ref); assert.equal(select.props.onChange, onChange);
  for (const [key, value] of Object.entries({ id: 'qa-client', name: 'cliente', value: '11', disabled: true, required: true, 'aria-describedby': 'qa-help' })) assert.equal(select.props[key], value);
  assert.match(renderToStaticMarkup(node), /<label[^>]*><span>Cliente<\/span><select/);
  assert.equal(find(component, node => ts.isCallExpression(node) && /^(?:React\.)?use[A-Z]/.test(node.expression.getText(componentTree))).length, 0, 'No independent selection state');
  assert.doesNotMatch(renderToStaticMarkup(node), /role="(?:combobox|listbox)"|<button/);
});

test('all three route sheets exclude shared control paint/type/focus while retaining layout and editor styles', () => {
  const owned = /^(?:font(?:-.+)?|color|background(?:-.+)?|border(?:-.+)?|padding(?:-.+)?|min-height|appearance|outline(?:-.+)?)$/;
  for (const name of ['Projects', 'Productions', 'Calendar']) {
    const root = postcss.parse(read(`../pages/${name}.css`));
    const fieldScopes = { Projects: ['.projects-page label', '.pr-filters label'], Productions: ['.productions-page label', '.prod-toolbar>label'], Calendar: ['.principal-calendar-filters label'] }[name];
    let excludedSelect = 0, excludedLabel = 0;
    root.walkRules(rule => {
      const paints = rule.nodes.some(node => node.type === 'decl' && owned.test(node.prop));
      if (!paints) return;
      // Commas inside :is(...) must not be split as independent selectors.
      for (const selector of postcss.list.comma(rule.selector)) {
        if (/(?:^|[\s>+~,(])select(?=$|[\s.#[:>+~,)])/.test(selector) || selector.includes(':focus-visible')) {
          assert.ok(selector.includes(':not(.render-filter-select)'), `${name} must not reclaim shared presentation: ${selector}`);
          excludedSelect++;
        }
        if (fieldScopes.some(scope => selector.startsWith(scope)) && rule.nodes.some(node => node.type === 'decl' && /^(?:font(?:-.+)?|color)$/.test(node.prop))) {
          assert.ok(selector.includes(':not(.render-filter-field)'), `${name} label presentation excludes shared field: ${selector}`);
          excludedLabel++;
        }
      }
    });
    assert.ok(excludedSelect > 0 && excludedLabel > 0, `${name} explicitly delegates both select and label`);
  }
});

test('shared CSS owns 44px controls, mobile readable text and focus; consumers keep layout constraints', () => {
  const root = postcss.parse(read('./FilterSelect.css'));
  const rule = selector => {
    const found = []; root.walkRules(node => { if (node.selector === selector && node.parent.type === 'root') found.push(node); });
    assert.equal(found.length, 1, selector); return Object.fromEntries(found[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  };
  const base = rule('select.render-filter-select');
  assert.ok(parseFloat(base['min-height']) >= 44); assert.equal(base.color, 'var(--render-ink)');
  assert.equal(base['background-color'], 'var(--render-surface)');
  assert.equal(rule('select.render-filter-select:focus-visible').outline, '2px solid var(--render-accent)');
  let mobile = false;
  root.walkAtRules('media', media => { if (media.params.replaceAll(' ', '') === '(max-width:1024px)') media.walkDecls('font-size', decl => { if (decl.parent.selector === 'select.render-filter-select' && decl.value === '16px') mobile = true; }); });
  assert.ok(mobile, 'Shared mobile text sizing is owned once');
  for (const [name, selector, property] of [['Productions', '.prod-toolbar>label', 'min-width'], ['Calendar', '.principal-calendar-filters select', 'max-width']]) {
    let retained = false; postcss.parse(read(`../pages/${name}.css`)).walkRules(rule => { if (rule.selector === selector && rule.nodes.some(node => node.prop === property)) retained = true; });
    assert.ok(retained, `${name} retains route layout, not duplicated control presentation`);
  }
});
