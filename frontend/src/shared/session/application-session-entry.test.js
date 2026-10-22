import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Entrypoint source contract, not mounted React/cookie acceptance.
const source = readFileSync(new URL('../../main.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('main.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = node => node.getText(file);
test('one document-owned runtime is constructed before the real StrictMode root', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  const declarations = [];
  function visit(node){if(ts.isVariableDeclaration(node))declarations.push(node);ts.forEachChild(node,visit)}
  visit(file);
  const runtime = declarations.filter(node => text(node.name) === 'applicationSession');
  assert.equal(runtime.length, 1);
  const initializer = runtime[0].initializer;
  assert.ok(ts.isCallExpression(initializer));
  assert.equal(text(initializer.expression), 'createApplicationSession');
  const options = initializer.arguments[0];
  assert.ok(ts.isObjectLiteralExpression(options));
  const values = new Map(options.properties.map(property => [text(property.name), text(property.initializer)]));
  assert.equal(values.get('mode'), "'browser'", 'The canonical app uses one server-verified browser runtime');
  assert.equal(values.get('fetchImpl'), 'fetchOriginal');
  assert.equal(values.has('storage'),false);
  assert.equal(values.get('location'), 'window.location');
  assert.equal(values.get('apiBase'), 'API_BASE');
  assert.equal(values.get('locks'),'window.navigator.locks');
  assert.equal(values.get('sessionChanges'),'coordination');
  assert.equal(values.get('notifyChange'),'coordination.notifyChange');
  assert.match(source, /installApplicationSession\(applicationSession\)/);
  assert.match(source, /void applicationSession.start\(\).catch\(\(\) => \{\}\)/);
  const assignments=[];
  function assignmentsIn(node){if(ts.isExpressionStatement(node)&&ts.isBinaryExpression(node.expression)&&text(node.expression.left)==='window.fetch')assignments.push(node);ts.forEachChild(node,assignmentsIn)}
  assignmentsIn(file);
  assert.equal(assignments.length, 1);
  assert.equal(text(assignments[0].expression.right), 'applicationSession.fetch');
  assert.match(source, /root\.render\(<React\.StrictMode><App\s*\/><\/React\.StrictMode>\)/);
  assert.ok(runtime[0].end < assignments[0].getStart(file));
  assert.match(source,/localStorage\.removeItem\('render_sesion'\)/);
  assert.doesNotMatch(source,/localStorage\.(getItem|setItem)|mode: 'bearer'/);
  assert.match(source,/No pudimos iniciar una sesión segura/);
  assert.doesNotMatch(source, /createAuthenticatedApiFetch\(|createBrowserApiFetch\(|applicationSession\.dispose\(|VITE_BROWSER_SESSION/);
});
