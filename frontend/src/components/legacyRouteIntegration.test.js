import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Inspect the actual App AST, not a replacement resolver or a simulated router.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../App.jsx');
const file = ts.createSourceFile('App.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const app = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'App');
assert.ok(app?.body, 'Actual App function exists');
const text = (node) => node.getText(file);
const nodes = (root, predicate) => {
  const found = [];
  const visit = (node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return found;
};
const calls = (root, name) => nodes(root, (n) => ts.isCallExpression(n) && text(n.expression) === name);
const declarationFor = (expression) => nodes(app.body, (n) => ts.isVariableDeclaration(n) && n.initializer && expression(n.initializer))[0];
const destination = () => declarationFor((n) => ts.isCallExpression(n) && text(n.expression) === 'canonicalLegacyRoute');
const token = () => declarationFor((n) => ts.isPropertyAccessExpression(n) && n.name.text === 'token' && text(n.expression) === 'sesion');
const hasReturn = (node) => nodes(node, ts.isReturnStatement).length > 0;
const compact = (node) => text(node).replace(/\s+/g, '');

test('App imports real closed-policy helpers and resolves the complete reactive route', () => {
  const imported = file.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './shared/navigation/legacy-routes.js');
  assert.ok(imported, 'Import real shared policy');
  const names = imported.importClause.namedBindings.elements.map((n) => n.name.text);
  assert.ok(names.includes('canonicalLegacyRoute') && names.includes('replaceLegacyRoute'));
  const value = destination();
  assert.ok(value, 'Resolve legacy destination in App');
  assert.equal(text(value.initializer.arguments[0]), 'route', 'Pass query/hash context, not pathname alone');
  assert.match(source, /readRouteKey\(window\)/);
  assert.doesNotMatch(source, /function\s+canonicalLegacyRoute|canonicalLegacyRoute\s*=|function\s+replaceLegacyRoute/);
});

test('all App hooks, including canonical replacement effect, precede conditional returns', () => {
  const firstReturn = nodes(app.body, ts.isReturnStatement)
    .filter((n) => {
      for (let p = n.parent; p && p !== app; p = p.parent) {
        if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) return false;
      }
      return true;
    }).sort((a, b) => a.pos - b.pos)[0];
  assert.ok(firstReturn);
  const hooks = nodes(app.body, (n) => ts.isCallExpression(n) && /^(?:React\.)?use[A-Z]/.test(text(n.expression)));
  assert.ok(hooks.length > 0);
  for (const hook of hooks) {
    assert.ok(hook.pos < firstReturn.pos, `${text(hook.expression)} precedes returns`);
    let statement = hook;
    while (statement.parent !== app.body && statement.parent) statement = statement.parent;
    assert.ok(ts.isExpressionStatement(statement) || ts.isVariableStatement(statement), 'Hook is unconditional at App scope');
  }
  const effect = calls(app.body, 'React.useEffect').find((n) => calls(n.arguments[0], 'replaceLegacyRoute').length);
  assert.ok(effect, 'Canonical replacement runs in an unconditional React effect');
  const dest = destination(), session = token();
  assert.ok(dest && session, 'Destination and parsed-session token are reactive values');
  const replace = calls(effect.arguments[0], 'replaceLegacyRoute');
  assert.equal(replace.length, 1);
  assert.deepEqual(replace[0].arguments.map(text), ['window', text(dest.name)]);
  const guard = nodes(effect.arguments[0], ts.isIfStatement).find((n) => calls(n.thenStatement, 'replaceLegacyRoute').length);
  assert.ok(guard, 'Replacement is gated inside effect');
  const operands = compact(guard.expression).replace(/^\(|\)$/g, '').split('&&');
  assert.ok(operands.includes(text(session.name)) && operands.includes(text(dest.name)), 'Both session token and recognized destination required');
  assert.ok(ts.isArrayLiteralExpression(effect.arguments[1]));
  assert.deepEqual(new Set(effect.arguments[1].elements.map(text)), new Set([text(session.name), text(dest.name)]));
  assert.equal(calls(app.body, 'replaceLegacyRoute').length, 1, 'No render-time duplicate replacement');
});

test('initial mount subscribes to route updates before an alias emits popstate', () => {
  const effects = calls(app.body, 'React.useEffect');
  const subscription = effects.find(n => text(n.arguments[0]).includes('window.addEventListener("popstate", syncPath)'));
  const replacement = effects.find(n => calls(n.arguments[0], 'replaceLegacyRoute').length);
  assert.ok(subscription && replacement);
  assert.ok(subscription.pos < replacement.pos, 'Subscription must be installed before canonicalization');
});

test('anonymous login gate and root handling precede loading guard; permissions and mounts follow', () => {
  const dest = destination();
  assert.ok(dest);
  const statements = [...app.body.statements];
  const gate = statements.findIndex((n) => ts.isIfStatement(n) && compact(n.expression) === '!sesion' && hasReturn(n));
  const root = statements.findIndex((n) => ts.isIfStatement(n) && /path===["']\/["']/.test(compact(n.expression)));
  const loading = statements.findIndex((n) => ts.isIfStatement(n) && compact(n.expression) === text(dest.name) && /<RouteLoading\s*\//.test(text(n.thenStatement)));
  const permissions = statements.findIndex((n) => ts.isIfStatement(n) && compact(n.expression) === '!rutaPermitida');
  const dashboard = declarationFor((n) => text(n).includes('<QuickHomePage'));
  assert.ok(gate >= 0 && root > gate && loading > root, 'Anonymous/root handling before alias loading guard');
  assert.ok(permissions > loading, 'Aliases canonicalize before route permission fallback');
  assert.ok(dashboard && dashboard.pos > statements[loading].pos, 'No operational page mounts while canonicalizing');
  assert.match(source, /return\s+<LoginPage\s*\//);
});

test('all named dashboard imports and mounts retire while original source files remain preserved', () => {
  for (const name of ['Augusto', 'Luciano', 'Oriana', 'Lider', 'German']) {
    const modulePath = `./pages/dashboards/${name}.jsx`;
    const imports = nodes(file, n => ts.isStringLiteral(n) && n.text === modulePath);
    assert.equal(imports.length, 0, `${name} has no static/lazy App module import`);
    const mounts = nodes(app.body, n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))
      && text(n.tagName) === `${name}Dashboard`);
    assert.equal(mounts.length, 0, `${name} has no live App mount`);
    const reference = read(`../pages/dashboards/${name}.jsx`);
    assert.ok(reference.length > 0, `${name} reference file is retained, not deleted`);
    assert.match(reference, new RegExp(`export\\s+(?:function|const)\\s+${name}Dashboard\\b`));
  }
});

test('approved deprecated aliases no longer have App hard-reload/render branches', () => {
  const aliases = new Set(['/agustin', '/franco', '/augusto', '/luciano', '/oriana', '/lider', '/german', '/equipo', '/piezas', '/wilson-conversaciones']);
  const aliasBranches = nodes(app.body, ts.isIfStatement).filter((n) => nodes(n.expression, (x) => ts.isStringLiteral(x) && aliases.has(x.text)).length);
  assert.equal(aliasBranches.length, 0, 'Closed policy replaces only approved alias-specific branches');
});

test('real shared policy retains only canonical task context from the full App route', async () => {
  const { canonicalLegacyRoute } = await import('../shared/navigation/legacy-routes.js');
  for (const alias of ['/agustin', '/franco', '/augusto', '/luciano', '/oriana', '/lider', '/german']) {
    assert.equal(canonicalLegacyRoute(`${alias}?usuario=other&rol=admin&cliente=99#unknown`), '/inicio');
    assert.equal(canonicalLegacyRoute(`${alias}?task=42&asignado_a=other#unknown`), '/workspace/tareas?task=42');
    assert.equal(canonicalLegacyRoute(`${alias}?task=42&task=43`), '/inicio');
    assert.equal(canonicalLegacyRoute(`${alias}?task=0`), '/inicio');
  }
  for (const alias of ['/piezas', '/wilson-conversaciones']) {
    assert.equal(canonicalLegacyRoute(`${alias}?task=42&rol=admin`), '/workspace/tareas?task=42');
  }
  assert.equal(canonicalLegacyRoute('/equipo?usuario=other'), '/reportes-historias');
  for (const canonical of ['/inicio', '/workspace/tareas?task=42', '/reportes-historias']) {
    assert.equal(canonicalLegacyRoute(canonical), null);
  }
  assert.equal(canonicalLegacyRoute('/unknown?task=42'), null);
});

test('real helper keeps noncanonical production paths unmapped, including task context', async () => {
  const { canonicalLegacyRoute } = await import('../shared/navigation/legacy-routes.js');
  for (const alias of ['/German', '/german/']) {
    for (const suffix of ['', '?task=42', '?task=42&task=43', '?usuario=other&rol=admin#unknown']) {
      assert.equal(canonicalLegacyRoute(`${alias}${suffix}`), null, `${alias}${suffix} must remain live, not canonicalized`);
    }
  }
});

test('canonical home uses current session; workspace task context and shared navigation remain', () => {
  const homeBranch = nodes(app.body, ts.isIfStatement).find((n) => /path===["']\/inicio["']/.test(compact(n.expression)));
  assert.ok(homeBranch);
  assert.match(compact(homeBranch.thenStatement), /<QuickHomePagesesion=\{sesion\}onNavigate=\{navigate\}/);
  assert.match(source, /<WorkspaceReadOnlyPage\s+path=\{path\}\s+sesion=\{sesion\}/);
  assert.match(source, /navigateWithinApp\(window,\s*href\)/);
  const home = read('../pages/QuickHome.jsx');
  assert.match(home, /userId\s*=\s*sesion\?\.usuario\?\.id/);
  assert.match(home, /createPersonalHomeLoader\(\{\s*request,\s*userId/);
  const workspace = read('../pages/WorkspaceReadOnly.jsx');
  assert.match(workspace, /URLSearchParams\(window.location.search\)\.get\(["']task["']\)/);
  assert.match(workspace, /useNavigationGuard\(/);
  for (const component of ['DesignPreview', 'CommentsProposal', 'LocalDesignShell']) {
    // These wrappers are preexisting local-only work, not required artifacts in
    // a clean checkout. If present, they must remain gated to development.
    if (source.includes(`const ${component} =`)) {
      assert.match(source, new RegExp(`const ${component} = import\\.meta\\.env\\.DEV`));
    }
  }
});
