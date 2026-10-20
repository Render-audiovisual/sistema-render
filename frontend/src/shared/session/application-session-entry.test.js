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
  const declarations = file.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations]);
  const runtime = declarations.filter(node => text(node.name) === 'applicationSession');
  assert.equal(runtime.length, 1);
  const initializer = runtime[0].initializer;
  assert.ok(ts.isCallExpression(initializer));
  assert.equal(text(initializer.expression), 'createApplicationSession');
  const options = initializer.arguments[0];
  assert.ok(ts.isObjectLiteralExpression(options));
  const values = new Map(options.properties.map(property => [text(property.name), text(property.initializer)]));
  assert.equal(values.get('mode'), "'bearer'", 'Cookie cutover is not publicly enabled before root/Login/Profile adoption');
  assert.equal(values.get('fetchImpl'), 'fetchOriginal');
  assert.equal(values.get('storage'), 'localStorage');
  assert.equal(values.get('location'), 'window.location');
  assert.equal(values.get('apiBase'), 'API_BASE');
  assert.equal(values.get('eventTarget'), 'window');
  assert.match(source, /installApplicationSession\(applicationSession\)/);
  assert.match(source, /void applicationSession.start\(\).catch\(\(\) => \{\}\)/);
  const assignments = file.statements.filter(ts.isExpressionStatement)
    .filter(statement => ts.isBinaryExpression(statement.expression) && text(statement.expression.left) === 'window.fetch');
  assert.equal(assignments.length, 1);
  assert.equal(text(assignments[0].expression.right), 'applicationSession.fetch');
  const root = file.statements.find(statement => text(statement).startsWith('createRoot('));
  assert.ok(root);
  assert.ok(runtime[0].end < assignments[0].getStart(file) && assignments[0].end < root.getStart(file));
  assert.match(text(root), /<React\.StrictMode>/);
  assert.match(text(root), /<App\s*\/>/);
  assert.doesNotMatch(source, /createAuthenticatedApiFetch\(|createBrowserApiFetch\(|applicationSession\.dispose\(|VITE_BROWSER_SESSION/);
});
