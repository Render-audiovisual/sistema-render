import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const appPath = path.join(root, 'frontend/src/App.jsx');
const forbidden = /(?:DesignPreview|PreviewCommentsProposal|LocalDesignShell|\/design-preview|\/sandbox-api|pre-unification-dev-entry\.patch)/;
function parse(filename) {
  const source = readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, filename);
  return { source, ast };
}
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)); }
function imports(ast) {
  const result = [];
  walk(ast, node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      assert.ok(node.arguments.length && ts.isStringLiteral(node.arguments[0]), 'entry graph imports must be statically inspectable');
      result.push(node.arguments[0].text);
    }
  });
  return result;
}

test('canonical App has no preview imports, wrappers or pre-auth preview routes', () => {
  const { source, ast } = parse(appPath);
  assert.doesNotMatch(source, forbidden);
  walk(ast, node => {
    if (ts.isIdentifier(node)) assert.ok(!['DesignPreview', 'CommentsProposal', 'LocalDesignShell'].includes(node.text));
    if (ts.isStringLiteral(node)) assert.doesNotMatch(node.text, /design-preview|sandbox-api/);
  });
  assert.ok(imports(ast).includes('./shared/navigation/legacy-routes.js'), 'retain canonical legacy routing');
  assert.match(source, /if\s*\(!sesion\)/, 'retain authenticated application gate');
});

test('App local runtime import graph cannot reach recovery references or parallel preview app', () => {
  const pending = [appPath], seen = new Set();
  while (pending.length) {
    const filename = pending.pop();
    if (seen.has(filename)) continue;
    seen.add(filename);
    for (const specifier of imports(parse(filename).ast)) {
      assert.doesNotMatch(specifier, forbidden, `${filename}: ${specifier}`);
      if (!specifier.startsWith('.')) continue;
      const base = path.resolve(path.dirname(filename), specifier);
      assert.ok(!base.startsWith(path.join(root, 'docs') + path.sep), 'documentation must not enter runtime graph');
      if (/\.(?:css|png|svg|jpg|jpeg|webp|woff2?)$/.test(base)) continue;
      const resolved = [base, ...['.js', '.jsx', '.mjs', '/index.js', '/index.jsx'].map(ext => base + ext)]
        .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      assert.ok(resolved, `Unresolved local runtime import: ${filename}: ${specifier}`);
      if (/\.(?:js|jsx|mjs)$/.test(resolved)) pending.push(resolved);
    }
  }
  assert.ok(seen.size > 1, 'inspect transitive imports, not only App');
});

test('actual Vite config exports only the primary API proxy without starting Vite', async () => {
  const { default: config } = await import(pathToFileURL(path.join(root, 'frontend/vite.config.js')).href);
  assert.equal(typeof config, 'object');
  assert.deepEqual(Object.keys(config.server.proxy), ['/api']);
  assert.equal(config.server.proxy['/api'].target, process.env.VITE_BACKEND_URL || 'http://localhost:3001');
  assert.equal(config.server.proxy['/api'].changeOrigin, true);
  assert.equal(config.server.proxy['/api'].rewrite, undefined);
  assert.ok(config.plugins.length > 0, 'retain React plugin configuration');
});

test('non-executable recovery patch preserves the exact inherited App/Vite features', () => {
  const filename = path.join(root, 'docs/render-2/references/pre-unification-dev-entry.patch');
  const bytes = readFileSync(filename);
  // Captured from git diff --binary HEAD -- frontend/src/App.jsx frontend/vite.config.js
  // before Main's narrow reversal. Never execute/apply this reference patch.
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '2375ab67ba7f2b5e269caf33b6d042208045e92fe9905c29bd8021af7ec749c1');
  assert.equal(statSync(filename).mode & 0o111, 0, 'reference patch is not executable');
  const source = bytes.toString('utf8');
  for (const feature of ['DesignPreview', 'CommentsProposal', 'LocalDesignShell', '/design-preview/comments-proposal', '/sandbox-api', 'http://127.0.0.1:5190'])
    assert.ok(source.includes(feature), `Preserve inherited ${feature}`);
  assert.deepEqual([...source.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map(match => [match[1], match[2]]), [
    ['frontend/src/App.jsx', 'frontend/src/App.jsx'], ['frontend/vite.config.js', 'frontend/vite.config.js'],
  ]);
});
