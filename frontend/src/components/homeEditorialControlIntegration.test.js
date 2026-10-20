import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Actual component/mount/style source contracts only. No React/browser mount,
// network call, helper/model substitute or screenshot/accessibility claim.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('./HomeEditorialControl.jsx');
const homeSource = read('../pages/QuickHome.jsx');
const css = read('../pages/QuickHome.css');
const parse = (name, value) => ts.createSourceFile(name, value, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const file = parse('HomeEditorialControl.jsx', source);
const home = parse('QuickHome.jsx', homeSource);
const text = node => node.getText(node.getSourceFile());
const nodes = (root, predicate) => {
  const result = [];
  const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(root); return result;
};
const calls = (root, name) => nodes(root, n => ts.isCallExpression(n) && text(n.expression) === name);
const component = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'HomeEditorialControl');
assert.ok(component?.body, 'Inspect actual HomeEditorialControl');
const declaration = name => nodes(component.body, n => ts.isVariableDeclaration(n) && text(n.name) === name)[0];
const compact = node => text(node).replace(/\s+/g, '');
const jsxTags = root => nodes(root, n => ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n));
const attr = (tag, name) => tag.attributes.properties.find(n => ts.isJsxAttribute(n) && text(n.name) === name);
const value = (tag, name) => {
  const initializer = attr(tag, name)?.initializer;
  assert.ok(initializer, `Missing ${name} attribute`);
  return ts.isJsxExpression(initializer) ? initializer.expression : initializer;
};
const objectProperty = (object, name) => object.properties.find(n => ts.isPropertyAssignment(n) && text(n.name) === name);
const elementFor = tag => ts.isJsxOpeningElement(tag) ? tag.parent : tag;

test('QuickHome mounts once with real session/navigation/request and shared CSS, not a separate theme', () => {
  const imported = home.statements.find(n => ts.isImportDeclaration(n)
    && n.moduleSpecifier.text === '../components/HomeEditorialControl.jsx');
  assert.ok(imported);
  const mounts = jsxTags(home).filter(n => text(n.tagName) === 'HomeEditorialControl');
  assert.equal(mounts.length, 1);
  for (const prop of ['sesion', 'onNavigate', 'request']) assert.equal(text(value(mounts[0], prop)), prop);
  assert.ok(home.statements.some(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './QuickHome.css'));
  assert.ok(!file.statements.some(n => ts.isImportDeclaration(n) && /\.css$/.test(n.moduleSpecifier.text)));
  const tags = jsxTags(component.body);
  assert.ok(tags.some(tag => attr(tag, 'className')?.initializer?.text === 'qh-section'));
  assert.match(css, /\.quick-home \[aria-label="Vistas del control editorial"\] button\[aria-pressed="true"\]/);
  assert.match(css, /\.quick-home \[aria-labelledby="qh-editorial-title"\] \.qh-compact-row a\{[^}]*min-height:44px/);
  assert.match(css, /:focus-visible\{[^}]*outline:/);
});

test('component delegates role/session policy and gates loading/rendering without conditional hooks', () => {
  const policyImport = file.statements.find(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './homeEditorialControl.js');
  assert.ok(policyImport, 'Reuse real editorial loader/policy module');
  assert.equal(compact(declaration('allowed').initializer), 'canReadEditorialControl(sesion)');
  const effects = calls(component.body, 'useEffect');
  assert.equal(effects.length, 1);
  const effect = effects[0].arguments[0];
  const first = effect.body.statements[0];
  assert.ok(ts.isIfStatement(first) && compact(first.expression) === '!allowed');
  assert.ok(nodes(first.thenStatement, ts.isReturnStatement).length);
  const renderGate = component.body.statements.find(n => ts.isIfStatement(n) && compact(n.expression) === '!allowed');
  assert.ok(renderGate && /return\s+null/.test(text(renderGate)));
  assert.ok(effects[0].pos < renderGate.pos, 'Hook is declared before auth-dependent return');
  assert.equal(compact(declaration('data').initializer), 'allowed?current?.data:null');
  assert.equal(calls(component.body, 'fetch').length, 0);
  assert.equal(calls(component.body, 'apiRequest').length, 0, 'No inline endpoint bypass of the loader');
});

test('primitive identity memo, stale-result fence and loader cleanup preserve current bucket state', () => {
  const expected = { id: 'sesion?.usuario?.id', role: 'sesion?.usuario?.rol', active: 'sesion?.usuario?.activo', token: 'sesion?.token' };
  for (const [name, expression] of Object.entries(expected)) assert.equal(compact(declaration(name).initializer), expression);
  const memo = declaration('identity').initializer;
  assert.equal(text(memo.expression), 'useMemo');
  assert.deepEqual(memo.arguments[1].elements.map(text), ['id', 'role', 'active', 'token']);
  assert.match(source, /identityRef\.current\s*=\s*identity/);
  assert.equal(compact(declaration('current').initializer), 'result?.identity===identity?result:null');
  assert.equal(compact(declaration('bucket').initializer), "current?.bucket??'today'");
  const effect = calls(component.body, 'useEffect')[0];
  const dependencies = effect.arguments[1].elements.map(text);
  for (const name of ['identity', 'allowed', 'request', 'id', 'role', 'active', 'token']) assert.ok(dependencies.includes(name));
  assert.ok(!dependencies.includes('sesion'), 'Object identity alone must not reset selected bucket');
  const create = calls(effect.arguments[0], 'createHomeEditorialLoader');
  assert.equal(create.length, 1);
  const options = create[0].arguments[0];
  assert.equal(text(objectProperty(options, 'readSession').initializer), 'getSesion');
  const onChange = objectProperty(options, 'onChange').initializer;
  const fence = nodes(onChange, ts.isIfStatement).find(n => compact(n.expression).includes('identityRef.current===identity'));
  assert.ok(fence && calls(fence.thenStatement, 'setResult').length === 1);
  assert.match(compact(fence.expression), /state.bucket===selected.bucket/);
  assert.match(compact(fence.expression), /state.offset===selected.offset/);
  assert.match(compact(fence.thenStatement), /setResult\(\{\.\.\.state,identity\}\)/);
  const cleanup = nodes(effect.arguments[0], ts.isReturnStatement).find(n => n.expression && ts.isArrowFunction(n.expression));
  assert.ok(cleanup);
  assert.equal(calls(cleanup, 'unsubscribe').length, 1);
  assert.equal(calls(cleanup, 'loader.dispose').length, 1);
  assert.match(compact(cleanup), /if\(loaderRef.current===loader\)loaderRef.current=null/);
});

test('bucket buttons expose pressed state, reset pagination and use loader refs; pagination has semantic limits', () => {
  const tags = jsxTags(component.body);
  const buttons = tags.filter(n => text(n.tagName) === 'button');
  assert.ok(buttons.length >= 5);
  for (const button of buttons) assert.equal(value(button, 'type').text, 'button');
  const bucketButton = buttons.find(n => attr(n, 'aria-pressed'));
  assert.ok(bucketButton);
  assert.equal(compact(value(bucketButton, 'aria-pressed')), 'bucket===option.value');
  const bucketClick = value(bucketButton, 'onClick');
  assert.equal(calls(bucketClick, 'selectPage').length, 1);
  const options = calls(bucketClick, 'selectPage')[0].arguments[0];
  assert.equal(compact(objectProperty(options, 'bucket').initializer), 'option.value');
  assert.equal(compact(objectProperty(options, 'offset').initializer), '0');
  const previous = buttons.find(n => /Anterior/.test(text(elementFor(n))));
  const next = buttons.find(n => /Siguiente/.test(text(elementFor(n))));
  assert.ok(previous && next);
  assert.equal(compact(value(previous, 'disabled')), 'recordOpen||data.offset===0');
  assert.match(compact(value(previous, 'onClick')), /Math.max\(0,data.offset-EDITORIAL_LIMIT\)/);
  assert.equal(calls(value(previous, 'onClick'), 'selectPage').length, 1);
  assert.equal(compact(value(next, 'disabled')), 'recordOpen||!data.has_more||data.offset+EDITORIAL_LIMIT>1000000');
  assert.match(compact(value(next, 'onClick')), /offset:data.offset\+EDITORIAL_LIMIT/);
  assert.equal(calls(value(next, 'onClick'), 'selectPage').length, 1);
  assert.ok(tags.some(n => text(n.tagName) === 'nav' && attr(n, 'aria-label')?.initializer?.text === 'Páginas del control editorial'));
  assert.ok(tags.some(n => attr(n, 'role')?.initializer?.text === 'status'));
  assert.ok(tags.some(n => attr(n, 'role')?.initializer?.text === 'alert'));
});

test('React text uses verified classification labels, never HTML/task-state publication claims', () => {
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/);
  const labels = nodes(file, n => ts.isVariableDeclaration(n) && text(n.name) === 'evidenceLabel')[0];
  assert.ok(labels);
  const mapping = nodes(labels, ts.isObjectLiteralExpression)[0];
  for (const [key, label] of Object.entries({
    confirmada_manualmente: 'Publicación confirmada manualmente',
    historica_sin_confirmacion: 'Registro histórico sin confirmación',
    no_publicada: 'Sin publicación confirmada',
  })) assert.equal(objectProperty(mapping, key).initializer.text, label);
  const evidenceCalls = calls(component.body, 'evidenceLabel');
  assert.equal(evidenceCalls.length, 1);
  assert.equal(text(evidenceCalls[0].arguments[0]), 'item.publication_classification');
  assert.ok(nodes(component.body, ts.isJsxExpression).some(n => {
    const expression = n.expression;
    return expression && ts.isBinaryExpression(expression)
      && expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
      && text(expression.left) === 'item.titulo'
      && ts.isStringLiteral(expression.right) && expression.right.text === 'Sin título';
  }));
  assert.match(source, /Una pieza puede aparecer en más de una vista/);
  assert.match(source, /key=\{`\$\{item.domain\}:\$\{item.id\}`\}/);
});

test('context link explicitly opens client planning, not a claimed exact piece deep link', () => {
  const href = nodes(component.body, n => ts.isVariableDeclaration(n) && text(n.name) === 'href')[0];
  assert.ok(href);
  assert.equal(compact(href.initializer), 'homeEditorialContextHref(item)');
  const anchors = jsxTags(component.body).filter(n => text(n.tagName) === 'a');
  assert.equal(anchors.length, 1);
  assert.equal(text(value(anchors[0], 'href')), 'href');
  assert.match(text(elementFor(anchors[0])), /Ver planificación del cliente/);
  const navigation = calls(value(anchors[0], 'onClick'), 'personalHomeNavigate');
  assert.equal(navigation.length, 1);
  assert.deepEqual(navigation[0].arguments.map(text), ['event', 'href', 'onNavigate']);
  assert.match(source, /Sin fecha de planificación\. Consultá la pieza en su sección\./);
  assert.doesNotMatch(text(elementFor(anchors[0])), /Abrir pieza|Ver pieza|Publicar|Confirmar publicación/);
});
