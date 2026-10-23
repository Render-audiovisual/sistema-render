import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { canonicalLegacyRoute } from './legacy-routes.js';

// Integration boundaries, not a DOM/focus emulator: real App/hook functions
// are extracted verbatim; SSR and hook leases are tested independently from
// the manager's DOM tests. No git, listeners, browser or service is started.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const parse = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const appSource = read('../../App.jsx'), app = parse('App.jsx', appSource);
const hookSource = read('../../components/SectionContentFocus.jsx'), hook = parse('SectionContentFocus.jsx', hookSource);
function nodes(root, predicate) {
  const result = []; const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }; visit(root); return result;
}
const fn = (tree, name) => {
  const found = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.ok(found, name); return found;
};
const compile = (tree, names) => ts.transpileModule(names.map(name => fn(tree, name).getText(tree)).join('\n'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function exported(code, deps) {
  const exports = {}; new Function('exports', ...Object.keys(deps), code)(exports, ...Object.values(deps)); return exports;
}
const appFunction = fn(app, 'App'), hookFunction = fn(hook, 'useSectionContentFocus');
const hookCode = compile(hook, ['useSectionContentFocus']);
const focusCall = nodes(appFunction, ts.isCallExpression).find(n => n.expression.getText(app) === 'useSectionContentFocus');

test('actual hook import resolves to a real exported manager rather than being hidden by extraction seams', () => {
  const declaration = hook.statements.filter(ts.isImportDeclaration).find(n =>
    n.importClause?.namedBindings?.elements?.some(e => e.name.text === 'createSectionFocusManager'));
  assert.ok(declaration);
  const target = new URL(declaration.moduleSpecifier.text, new URL('../../components/SectionContentFocus.jsx', import.meta.url));
  const actual = parse(target.pathname, readFileSync(target, 'utf8'));
  const manager = fn(actual, 'createSectionFocusManager');
  assert.ok(manager.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
});

test('App imports the genuine hook and section classifier and calls it unconditionally before every early return', () => {
  const imports = app.statements.filter(ts.isImportDeclaration);
  assert.ok(imports.some(n => n.moduleSpecifier.text === './components/SectionContentFocus.jsx'
    && n.importClause.namedBindings.elements.some(e => e.name.text === 'useSectionContentFocus')));
  assert.ok(imports.some(n => n.moduleSpecifier.text === './shared/navigation/section-focus.js'
    && n.importClause.namedBindings.elements.some(e => e.name.text === 'sectionFocusKey')));
  assert.ok(focusCall);
  const statement = appFunction.body.statements.find(n => n.pos <= focusCall.pos && n.end >= focusCall.end);
  assert.ok(ts.isVariableStatement(statement), 'Hook must not be under a conditional/callback');
  const firstReturn = nodes(appFunction.body, ts.isReturnStatement).sort((a, b) => a.pos - b.pos)[0];
  assert.ok(focusCall.end < firstReturn.pos);
  const options = new Map(focusCall.arguments[0].properties.map(p => [p.name.getText(app), p.initializer]));
  assert.deepEqual([...options.keys()].sort(), ['enabled', 'owner', 'sectionKey']);
  assert.equal(options.get('owner').getText(app), 'sessionRenderEpoch', 'Opaque presentation epoch, not session/credentials');
  assert.equal(options.get('sectionKey').expression.getText(app), 'sectionFocusKey');
  assert.doesNotMatch(options.get('sectionKey').getText(app), /window|session|token/);
  assert.ok(appSource.indexOf('useNavigationConfirmation({') < focusCall.pos);
});

async function renderApp(route, { status = 'authenticated', session = { usuario: { id: 7, usuario: 'QA', rol: 'admin', activo: true } } } = {}) {
  const { sectionFocusKey } = await import('./section-focus.js');
  const observed = [], redirects = [];
  const parsed = new URL(route, 'https://render.test');
  const location = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash,
    get href() { return parsed.href; }, set href(value) { redirects.push(value); }, replace(value) { redirects.push(value); } };
  const snapshot = { status, session };
  const deps = { React, window: { location }, URLSearchParams,
    readRouteKey: () => `${location.pathname}${location.search}${location.hash}`,
    useApplicationSession: () => snapshot, sessionViewKey: value => value ? 'opaque-session' : null,
    getApplicationSessionSnapshot: () => snapshot, canonicalLegacyRoute, sectionFocusKey,
    useSectionContentFocus: options => { observed.push(options); return {
      skipLink: React.createElement('a', { 'data-qa-shell-skip': true, href: '#render-main-content' }, 'Ir al contenido'),
      marker: React.createElement('span', { 'data-qa-shell-marker': true, id: 'render-main-content', hidden: true }),
    }; },
    useNavigationConfirmation: () => ({ request() { throw Error('SSR must not request navigation'); }, dialog: null }),
    getRutaUsuario: () => '/inicio', canUseSharedCalendarRole: () => true,
    resolveLoginDestination: () => '/inicio', readLoginDestination: () => null, loginHrefForDestination: () => '/login',
    cerrarSesion() { throw Error('SSR cannot log out'); }, getRolLabel: value => value, ROL_LABELS: {},
    navigateWithinApp() { throw Error('SSR cannot navigate'); }, navigateWithConfirmation() { throw Error('SSR cannot navigate'); },
    Sidebar: () => React.createElement('nav', { 'data-qa-sidebar': true }, 'Navegación'),
  };
  const pageNames = new Set(nodes(appFunction, n => ts.isJsxSelfClosingElement(n) && /Page$/.test(n.tagName.getText(app))).map(n => n.tagName.getText(app)));
  for (const name of pageNames) deps[name] = () => name === 'LoginPage'
    ? React.createElement('form', { 'data-qa-login': true })
    : React.createElement('main', { 'data-qa-page': name }, React.createElement('h1', null, name));
  const actual = exported(compile(app, ['RouteLoading', 'App']), deps).App;
  return { html: renderToStaticMarkup(React.createElement(actual)), observed, redirects };
}

test('actual App gate disables loading/error/anonymous/login/root/legacy focus and renders controls only beside a dashboard', async () => {
  for (const [route, options, enabled, rendered] of [
    ['/inicio', {}, true, true], ['/proyectos?cliente=4', {}, true, true],
    ['/inicio', { status: 'unknown' }, false, false], ['/inicio', { status: 'loading' }, false, false],
    ['/inicio', { status: 'error' }, false, false], ['/inicio', { status: 'anonymous', session: null }, false, false],
    ['/login', { status: 'anonymous', session: null }, false, false], ['/login', {}, false, false],
    ['/', {}, false, false], ['/agustin?task=12', {}, false, false], ['/not-a-dashboard', {}, true, false],
  ]) {
    const result = await renderApp(route, options);
    assert.equal(result.observed.length, 1, route);
    assert.equal(result.observed[0].enabled, enabled, route);
    assert.equal(typeof result.observed[0].owner, 'number');
    assert.equal(result.html.includes('data-qa-shell-skip'), rendered, route);
    assert.equal(result.html.includes('data-qa-shell-marker'), rendered, route);
    if (route.startsWith('/agustin')) assert.match(result.html, /route-loading/);
  }
});

test('actual root Fragment keeps skip, Sidebar, marker and Suspense as siblings without wrapping any dashboard', async () => {
  const returned = appFunction.body.statements.filter(ts.isReturnStatement).at(-1).expression;
  const fragment = ts.isParenthesizedExpression(returned) ? returned.expression : returned;
  assert.ok(ts.isJsxFragment(fragment));
  const children = fragment.children.filter(n => !ts.isJsxText(n) || n.text.trim());
  assert.equal(children[0].expression.getText(app), 'contentFocus.skipLink');
  assert.equal(children[1].tagName.getText(app), 'Sidebar');
  assert.equal(children[2].expression.getText(app), 'contentFocus.marker');
  assert.equal(children[3].expression.getText(app), 'loadedDashboard');
  for (const route of ['/inicio', '/workspace/tareas?view=list', '/clientes?gestion=1', '/clientes']) {
    const { html } = await renderApp(route);
    assert.ok(html.indexOf('data-qa-shell-skip') < html.indexOf('data-qa-sidebar'));
    assert.ok(html.indexOf('</nav>') < html.indexOf('data-qa-shell-marker'));
    assert.match(html, /<span[^>]*data-qa-shell-marker[^>]*><\/span>(?:<!--[^>]*-->)*<main/);
    assert.equal((html.match(/data-qa-shell-marker=/g) || []).length, 1);
  }
  const suspense = nodes(appFunction, ts.isJsxElement).find(n => n.openingElement.tagName.getText(app) === 'React.Suspense');
  assert.ok(suspense);
  assert.match(suspense.openingElement.getText(app), /fallback=\{<RouteLoading/);
  assert.match(fn(app, 'RouteLoading').getText(app), /className="route-loading"/);
});

test('real classifier ignores query/hash/page churn but separates client management from objectives and pathname changes', async () => {
  const { sectionFocusKey } = await import('./section-focus.js');
  for (const [path, queries] of [
    ['/calendario', ['', '?mes=2026-10&dia=2026-10-20&pagina=2', '?cliente=7&scope=team']],
    ['/producciones', ['', '?mes=2026-10&visita=synthetic&tab=calendario']],
    ['/workspace/tareas', ['', '?task=7&view=list&board_column=en_revision']],
    ['/clientes', ['', '?periodo=2026-10&cliente=3', '?gestion=0']],
  ]) {
    const observed = await Promise.all(queries.map(query => renderApp(`${path}${query}#some-panel`)));
    assert.ok(observed.every(result => result.observed[0].sectionKey === sectionFocusKey(path, queries[0])));
  }
  assert.notEqual(sectionFocusKey('/clientes', '?gestion=1'), sectionFocusKey('/clientes', ''));
  assert.equal(sectionFocusKey('/clientes', '?gestion=1&periodo=2026-10'), sectionFocusKey('/clientes', '?gestion=1&periodo=2026-11'));
  assert.notEqual(sectionFocusKey('/inicio', ''), sectionFocusKey('/proyectos', ''));
});

test('actual hook SSR supplies a native skip anchor and hidden ref marker, never a dashboard wrapper or a focus call', () => {
  let managerCalls = 0;
  const useActualHook = exported(hookCode, { React, useRef: React.useRef, useLayoutEffect: React.useLayoutEffect,
    createSectionFocusManager() { managerCalls++; throw Error('SSR must not create a DOM manager'); } }).useSectionContentFocus;
  const render = enabled => {
    function Content() {
      const value = useActualHook({ sectionKey: '/inicio', owner: 1, enabled });
      return React.createElement(React.Fragment, null, value.skipLink, React.createElement('nav'), value.marker,
        React.createElement('main', null, React.createElement('h1', null, 'Contenido')));
    }
    return renderToStaticMarkup(React.createElement(Content));
  };
  const html = render(true);
  assert.match(html, /^<a[^>]+href="#render-main-content"[^>]*>Ir al contenido<\/a><nav><\/nav><span/);
  assert.match(html, /id="render-main-content"[^>]*hidden=""[^>]*aria-hidden="true"/);
  assert.equal((html.match(/<main/g) || []).length, 1);
  assert.doesNotMatch(render(false), /render-main-content|Ir al contenido/);
  assert.equal(managerCalls, 0);
});

function hookFixture() {
  const slots = [], managers = []; let cursor = 0, effects = [], value;
  const deps = { React, document: {}, window: {},
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useLayoutEffect(callback, dependencies) {
      const i = cursor++, old = slots[i];
      if (!old || dependencies.some((v, j) => !Object.is(v, old.dependencies[j]))) {
        slots[i] = { dependencies, cleanup: old?.cleanup };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = callback(); });
      }
    },
    createSectionFocusManager(options) {
      const calls = [], manager = { options, calls, disposed: false,
        request(request) { calls.push(request); return options.isCurrent(); },
        dispose() { manager.disposed = true; } };
      managers.push(manager); return manager;
    },
  };
  const useActualHook = exported(hookCode, deps).useSectionContentFocus;
  const props = { sectionKey: '/inicio', owner: 1, enabled: true };
  return { managers, render(changes = {}) { Object.assign(props, changes); cursor = 0; value = useActualHook({ ...props }); return value; },
    commit() { const pending = effects; effects = []; pending.forEach(fn => fn()); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); }, get value() { return value; } };
}

test('actual hook fences section ABA, owner and disabled observations before cleanup; cleanup only disposes', () => {
  for (const change of [{ sectionKey: '/proyectos' }, { owner: 2 }, { enabled: false }]) {
    const f = hookFixture(); f.render(); f.commit(); const first = f.managers[0];
    assert.equal(first.options.isCurrent(), true); assert.equal(first.calls.length, 1);
    f.render(change); assert.equal(first.options.isCurrent(), false);
    // A -> B -> A must not revive the first lease, even before any cleanup.
    f.render({ sectionKey: '/inicio', owner: 1, enabled: true });
    assert.equal(first.options.isCurrent(), false);
    f.commit(); assert.equal(first.disposed, true); assert.equal(first.calls.length, 1);
    f.dispose(); assert.ok(f.managers.every(m => m.disposed));
  }
});

test('actual skip callback is intentional focus only: modifiers remain native, stale handler cannot borrow new lease', () => {
  const f = hookFixture(); const first = f.render(); f.commit();
  const click = (handler, patch = {}) => { let prevented = 0; handler({ button: 0, preventDefault() { prevented++; }, ...patch }); return prevented; };
  for (const patch of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }]) {
    assert.equal(click(first.skipLink.props.onClick, patch), 0);
  }
  assert.equal(f.managers[0].calls.length, 1);
  assert.equal(click(first.skipLink.props.onClick), 1);
  assert.deepEqual(f.managers[0].calls.at(-1), { explicit: true });
  assert.equal(click(first.skipLink.props.onClick, { button: undefined }), 1, 'Keyboard activation');
  f.render({ sectionKey: '/proyectos' }); f.commit(); const second = f.managers[1];
  assert.equal(click(first.skipLink.props.onClick), 1); assert.equal(second.calls.length, 1);
  assert.doesNotMatch(hookFunction.getText(hook), /pushState|replaceState|location\s*\.|navigateWithinApp|window\.confirm|dispatchEvent/);
  f.dispose(); const before = second.calls.length; click(f.value.skipLink.props.onClick); assert.equal(second.calls.length, before);
});
