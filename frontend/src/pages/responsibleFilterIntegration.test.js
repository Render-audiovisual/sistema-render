import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildTaskPageUrl } from '../features/render-os/services/render-os-api.js';
import { responsibleFilterId, resolveResponsibleFilter, buildResponsibleOptions, taskMatchesResponsible } from '../features/render-os/utils/task-responsible-filter.js';
import { getTaskViewState, updateTaskViewUrl } from '../features/render-os/utils/task-view-state.js';

// Actual Workspace AST and production helpers, not a substitute filter/router.
// These tests do not mount React or claim browser/network verification.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('./WorkspaceReadOnly.jsx');
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = node => node.getText(file);
function nodes(root, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root); return found;
}
const calls = (root, name) => nodes(root, node => ts.isCallExpression(node) && text(node.expression) === name);
const directCalls = (root, id) => calls(root, 'guard.request').filter(call =>
  text(call.arguments[0]) === '`/api/tareas/${' + id + '}?workspace=render_os`');
const functionNamed = name => nodes(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name)[0];
const users = [{ id: 7, nombre: 'Alex', usuario: 'alex-a' }, { id: 8, nombre: 'Alex', usuario: 'alex-b' },
  { id: 9, nombre: 'Única', usuario: 'unique' }];

test('real service builder sends stable IDs only and preserves independent filters', () => {
  const url = new URL(buildTaskPageUrl({ responsible: 'id:7', offset: 50, limit: 25, archiveMode: 'trash',
    client: 'none', sector: 'produccion', priority: 'alta', area: 'edicion', query: '  búsqueda  ' }), 'https://render.test');
  assert.equal(url.pathname, '/api/tareas');
  assert.deepEqual(Object.fromEntries(url.searchParams), { workspace: 'render_os', limit: '25', offset: '50',
    papelera: 'true', asignado_a_id: '7', cliente_id: 'none', tipo_tarea: 'produccion', prioridad: 'alta', area: 'edicion', q: 'búsqueda' });
  assert.equal(url.searchParams.has('asignado_a'), false);
  assert.equal(new URL(buildTaskPageUrl({ responsible: 'all' }), url).searchParams.has('asignado_a_id'), false);
  for (const responsible of ['Alex', 'unique', '7', 'id:0', 'id:-1', 'id:01', 'id:1.5', 'id:2147483648',
    'id:7&rol=admin', 'invalid:duplicate', 'id:7,id:8']) {
    assert.throws(() => buildTaskPageUrl({ responsible }), responsible);
  }
});

test('legacy names resolve only exact unique catalog identities; pending and ambiguity stay blocked', () => {
  assert.equal(resolveResponsibleFilter('unique', users, false, true).ready, false);
  for (const legacy of ['Alex', 'missing', 'alex', ' UNIQUE ', 'invalid:duplicate']) {
    const resolution = resolveResponsibleFilter(legacy, users, true, true);
    assert.equal(resolution.ready, false);
    assert.ok(resolution.message, `Blocked ${legacy} needs a notice`);
    assert.throws(() => buildTaskPageUrl({ responsible: resolution.value }));
  }
  for (const legacy of ['Única', 'unique']) {
    const resolved = resolveResponsibleFilter(legacy, users, true, true);
    assert.equal(resolved.value, 'id:9');
    assert.equal(resolveResponsibleFilter(resolved.value, users, true).ready, true);
  }
  assert.equal(responsibleFilterId('id:7'), 7);
  assert.equal(responsibleFilterId('id:2147483647'), 2147483647);
  assert.equal(responsibleFilterId('id:2147483648'), null);
});

test('default and nonadmin incomplete catalogs never auto-recover even apparently unique legacy names', () => {
  for (const legacy of ['Única', 'unique']) {
    for (const result of [resolveResponsibleFilter(legacy, users, true), resolveResponsibleFilter(legacy, users, true, false)]) {
      assert.equal(result.status, 'unresolved');
      assert.equal(result.ready, false);
      assert.equal(result.value, legacy);
      assert.ok(result.message, 'Explain explicit ID selection rather than guessing from active-only users');
      assert.throws(() => buildTaskPageUrl({ responsible: result.value }));
    }
  }
  for (const completeCatalog of [false, true]) {
    assert.equal(resolveResponsibleFilter('id:9', users, true, completeCatalog).ready, true);
    assert.equal(resolveResponsibleFilter('all', users, true, completeCatalog).ready, true);
  }
});

test('option values and client-side matching use IDs, not shared display names', () => {
  const options = buildResponsibleOptions(users, [{ asignado_a_id: 10, colaborador_ids: [11] }], 'id:12');
  for (const id of [7, 8, 9, 10, 11, 12]) {
    const option = options.find(value => value.value === `id:${id}`);
    assert.ok(option); assert.equal(option.label,users.find(user=>user.id===id)?.nombre || 'No disponible');
  }
  assert.equal(taskMatchesResponsible({ asignado_a_id: 7, asignado_a: 'Alex' }, 'id:7'), true);
  assert.equal(taskMatchesResponsible({ asignado_a_id: 8, asignado_a: 'Alex', propiedades_extra: { colaboradores: ['Alex'] } }, 'id:7'), false);
  assert.equal(taskMatchesResponsible({ asignado_a_id: 8, colaborador_ids: [7] }, 'id:7'), true);
  assert.equal(taskMatchesResponsible({ asignado_a_id: '7', colaborador_ids: ['7'] }, 'id:7'), false);
  assert.equal(taskMatchesResponsible({ asignado_a: 'Alex' }, 'Alex'), false);
});

test('actual URL helpers reject duplicated responsible parameters and round-trip stable selection', () => {
  for (const query of ['?responsible=id%3A7&responsible=id%3A8', '?responsible=id%3A7&responsible=id%3A7',
    '?responsible=all&responsible=Alex']) {
    const state = getTaskViewState(query);
    assert.equal(resolveResponsibleFilter(state.responsible, users, true).ready, false);
    assert.throws(() => buildTaskPageUrl({ responsible: state.responsible }));
  }
  const state = getTaskViewState('?view=list&responsible=id%3A7&client=3&sector=edicion&priority=alta&q=hello');
  const url = updateTaskViewUrl('https://render.test/workspace/tareas?task=42', state);
  assert.equal(getTaskViewState(url.search).responsible, 'id:7');
  assert.equal(url.searchParams.get('task'), '42');
  assert.equal(url.searchParams.get('client'), '3');
});

test('Workspace imports production helpers; real Responsible selector uses option value and label', () => {
  const imported = file.statements.find(node => ts.isImportDeclaration(node)
    && node.moduleSpecifier.text.endsWith('/task-responsible-filter.js'));
  assert.ok(imported, 'Main must import actual filter helpers');
  const view = functionNamed('TasksView'); assert.ok(view);
  assert.ok(calls(view, 'buildResponsibleOptions').length, 'Build real ID options');
  assert.ok(calls(view, 'taskMatchesResponsible').length, 'Use actual client matcher');
  const select = nodes(view, ts.isJsxElement).find(node => {
    const opening = node.openingElement;
    return text(opening.tagName) === 'FilterSelect' && opening.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && text(attribute.name) === 'aria-label' && attribute.initializer?.text === 'Responsable');
  });
  assert.ok(select, 'Inspect actual shared Responsable selector');
  assert.ok(file.statements.some(node => ts.isImportDeclaration(node)
    && node.moduleSpecifier.text === '../components/FilterSelect.jsx'));
  const mappedOption = nodes(select, ts.isJsxElement).find(node => text(node.openingElement.tagName) === 'option'
    && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
      && text(attribute.name) === 'value' && attribute.initializer && /\.value\}/.test(text(attribute.initializer))));
  assert.ok(mappedOption, 'Option value must be option.value, never name');
  assert.match(text(mappedOption), /\{\w+\.label\}/);
  assert.doesNotMatch(text(view), /task\.asignado_a\s*===\s*responsible|collaborators\.includes\(responsible\)/);
});

test('catalog resolution and blocked notice are wired before first-page and load-more APIs', () => {
  const resolutionCall = calls(file, 'resolveResponsibleFilter').find(call => call.arguments.length >= 3 && text(call.arguments[2]) !== 'true');
  assert.ok(resolutionCall, 'Workspace must resolve against current catalog');
  let resolution = resolutionCall.parent;
  while (resolution && !ts.isVariableDeclaration(resolution)) resolution = resolution.parent;
  assert.ok(resolution, 'Capture real resolution, including memoized initialization');
  const name = text(resolution.name), args = resolutionCall.arguments;
  assert.equal(args.length, 4, 'Resolver receives readiness and explicit complete-catalog authority');
  assert.match(text(args[3]), /^sesion\?\.usuario\?\.rol\s*===\s*['"]admin['"]$/,
    'Only current admin role can assert a complete user catalog');
  const noticeCall = calls(functionNamed('TasksView'), 'resolveResponsibleFilter')[0];
  assert.ok(noticeCall, 'Notice uses the actual resolver too');
  assert.equal(noticeCall.arguments.length, 4);
  assert.match(text(noticeCall.arguments[3]), /^sesion\?\.usuario\?\.rol\s*===\s*['"]admin['"]$/,
    'Active-only employee catalog cannot resolve names for the notice');
  const catalog = text(args[2]);
  assert.notEqual(catalog, 'true', 'Do not assume the catalog is loaded');
  assert.match(source, /responsibleNotice|responsible\w*\.message/i, 'Expose blocked-filter notice');
  assert.match(source, /\{responsibleNotice\}|\{responsible\w*\.message\}/i, 'Render the notice, not just calculate it');
  const requests = calls(file, 'apiTaskPage'); assert.ok(requests.length >= 2);
  for (const request of requests) {
    let owner = request.parent;
    while (owner && !(ts.isArrowFunction(owner) || ts.isFunctionDeclaration(owner))) owner = owner.parent;
    // A debounce callback may be nested inside the gated effect.
    const scopes = [];
    while (owner) {
      scopes.push(owner);
      owner = owner.parent;
      while (owner && !(ts.isArrowFunction(owner) || ts.isFunctionDeclaration(owner))) owner = owner.parent;
    }
    const gated = scopes.some(scope => nodes(scope, ts.isIfStatement).some(guard => guard.pos < request.pos
      && text(guard.expression).includes(`${name}.ready`) && nodes(guard.thenStatement, ts.isReturnStatement).length));
    assert.ok(gated, `API at line ${file.getLineAndCharacterOfPosition(request.getStart(file)).line + 1} must return before unresolved dispatch`);
  }
  assert.ok(source.includes(catalog), 'Actual catalog readiness participates in resolution');
});

test('name-to-ID filter migration is never passed into authorization/session mutation', () => {
  const authNames = ['canUserEditTask', 'canUserDeleteTask', 'canUserMoveTask', 'canUserMoveTaskToState', 'guardarSesion'];
  for (const name of authNames) for (const call of calls(file, name)) {
    assert.doesNotMatch(call.arguments.map(text).join(','), /responsible|resolveResponsibleFilter|buildResponsibleOptions/,
      `${name} must use current identity and task assignment, not the board filter`);
  }
  const helper = read('../features/render-os/utils/task-responsible-filter.js');
  assert.doesNotMatch(helper, /guardarSesion|localStorage|sessionStorage|\.rol\s*=(?!=)|\.usuario\s*=(?!=)/);
});

test('resolved legacy selection is committed explicitly and catalog readiness follows user data', () => {
  const effects = calls(file, 'useEffect');
  const migration = effects.find(effect => calls(effect.arguments[0], 'setResponsible').some(call =>
    text(call.arguments[0]) === 'responsibleSelection.value'));
  assert.ok(migration, 'Commit resolved token to selected filter/URL state');
  const condition = nodes(migration.arguments[0], ts.isIfStatement).find(node =>
    /responsibleSelection\.status\s*===\s*['"]resolved['"]/.test(text(node.expression)));
  assert.ok(condition, 'Only unique resolution commits a migrated ID');
  const catalogEffect = effects.find(effect => calls(effect.arguments[0], 'setUsers').length);
  assert.ok(catalogEffect);
  const usersSet = calls(catalogEffect.arguments[0], 'setUsers')[0];
  const readySet = calls(catalogEffect.arguments[0], 'setCatalogReady').find(call => text(call.arguments[0]) === 'true');
  assert.ok(readySet && readySet.pos > usersSet.pos, 'Mark catalog ready only after installing the current user catalog');
});

test('filter effect invalidates pagination generations before unresolved or debounced loading', () => {
  const effect = calls(file, 'useEffect').find(call => nodes(call.arguments[0], node =>
    ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusPlusToken
      && text(node.operand) === 'taskQueryGenerationRef.current').length);
  assert.ok(effect, 'Actual query effect increments pagination generation');
  const body = effect.arguments[0].body;
  const increment = nodes(body, node => ts.isPrefixUnaryExpression(node)
    && node.operator === ts.SyntaxKind.PlusPlusToken && text(node.operand) === 'taskQueryGenerationRef.current')[0];
  const readiness = nodes(body, ts.isIfStatement).find(node => text(node.expression).includes('responsibleSelection.ready'));
  const timer = calls(body, 'window.setTimeout')[0];
  assert.ok(readiness && timer);
  assert.ok(increment.pos < readiness.pos && increment.pos < timer.pos,
    'Invalidate old load-more requests even when new selection is unresolved');
  const reset = calls(body, 'setLoadingMore').find(call => text(call.arguments[0]) === 'false');
  assert.ok(reset && reset.pos < readiness.pos, 'New query owns resetting its loading-more state');
  const dependencies = text(effect.arguments[1]);
  for (const dependency of ['query', 'area', 'responsibleSelection.ready', 'responsibleSelection.status',
    'responsibleSelection.value', 'client', 'sector', 'priority', 'archiveMode', 'reloadKey']) {
    assert.ok(dependencies.includes(dependency), `Invalidate pagination when ${dependency} changes`);
  }
});

test('load-more guards tasks, totals, error notification and finally against stale generations', () => {
  const declaration = nodes(file, node => ts.isVariableDeclaration(node) && text(node.name) === 'loadMoreTasks')[0];
  assert.ok(declaration && ts.isArrowFunction(declaration.initializer));
  const body = declaration.initializer.body;
  const capture = nodes(body, node => ts.isVariableDeclaration(node)
    && node.initializer && text(node.initializer) === 'taskQueryGenerationRef.current')[0];
  assert.ok(capture, 'Capture generation before dispatch');
  const generation = text(capture.name);
  const request = calls(body, 'apiTaskPage')[0];
  assert.ok(request && capture.pos < request.pos);
  const attempt = nodes(body, ts.isTryStatement)[0]; assert.ok(attempt);
  const staleGuard = attempt.tryBlock.statements.find(node => ts.isIfStatement(node)
    && text(node.expression).replace(/\s/g, '') === `${generation}!==taskQueryGenerationRef.current`
    && nodes(node.thenStatement, ts.isReturnStatement).length);
  assert.ok(staleGuard && staleGuard.pos > request.pos, 'After await, reject obsolete successful responses');
  for (const name of ['setTasks', 'setTotalTasks']) {
    const writes = calls(attempt.tryBlock, name); assert.ok(writes.length);
    for (const write of writes) assert.ok(write.getStart(file) >= staleGuard.end, `${name} occurs only after stale response guard`);
  }
  function guardedByCurrent(call, boundary) {
    for (let parent = call.parent; parent && parent !== boundary; parent = parent.parent) {
      if (ts.isIfStatement(parent) && text(parent.expression).replace(/\s/g, '').split('&&').includes(`${generation}===taskQueryGenerationRef.current`)
        && call.pos >= parent.thenStatement.pos && call.end <= parent.thenStatement.end) return true;
    }
    return false;
  }
  assert.ok(attempt.catchClause && attempt.finallyBlock);
  const notices = calls(attempt.catchClause.block, 'notify'); assert.ok(notices.length);
  for (const notice of notices) assert.ok(guardedByCurrent(notice, attempt.catchClause.block), 'Stale errors cannot notify the new query');
  const resets = calls(attempt.finallyBlock, 'setLoadingMore'); assert.ok(resets.length);
  for (const reset of resets) assert.ok(guardedByCurrent(reset, attempt.finallyBlock), 'Old finally cannot clear a newer loading-more flag');
});

test('blocked responsible filters retain selected task identity and mark it direct-only instead of clearing an editor', () => {
  const blocked = nodes(file, ts.isIfStatement).find(node => text(node.expression) === '!responsibleSelection.ready || queryNotice');
  assert.ok(blocked, 'Inspect real blocked-list branch');
  const writes = calls(blocked.thenStatement, 'setTasks');
  const preserve = writes.find(call => ts.isArrowFunction(call.arguments[0]));
  assert.ok(preserve, 'Preserve selected context using functional task update');
  assert.match(text(preserve.arguments[0]), /\.filter\(task => task\.id === contextId\)/);
  assert.match(text(preserve.arguments[0]), /\.map\(task => \(\{ \.\.\.task, __renderOsDirectOnly: true \}\)\)/);
  assert.ok(calls(blocked.thenStatement, 'setTotalTasks').some(call => text(call.arguments[0]) === '0'));
  for (const call of writes) assert.notEqual(text(call.arguments[0]), '[]', 'Blocked filter must not clear selected editor task');
  assert.doesNotMatch(text(blocked.thenStatement), /setSelectedId\(null\)|setEditing\(false\)|setDraft\(/);
  const lookup = directCalls(blocked.thenStatement, 'contextId')[0];
  assert.ok(lookup);
  const lookupGuard = nodes(blocked.thenStatement, ts.isIfStatement).reverse().find(node =>
    lookup.pos >= node.thenStatement.pos && lookup.end <= node.thenStatement.end);
  assert.ok(lookupGuard);
  assert.match(text(lookupGuard.expression), /Number\.isSafeInteger\(contextId\)/);
  assert.match(text(lookupGuard.expression), /contextId > 0 && contextId <= 2147483647/);
  assert.match(text(lookupGuard.expression), /!tasksRef\.current\.some/);
});

test('blocked direct-context lookup success and failure check active generation and current URL before side effects', () => {
  const blocked = nodes(file, ts.isIfStatement).find(node => text(node.expression) === '!responsibleSelection.ready || queryNotice');
  assert.ok(blocked);
  const handlers = nodes(blocked.thenStatement, node => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression) && ['then', 'catch'].includes(node.expression.name.text)
    && directCalls(node.expression.expression, 'contextId').length > 0);
  assert.equal(handlers.length, 2, 'Inspect actual direct-context success and error callbacks');
  for (const handler of handlers) {
    const callback = handler.arguments[0];
    assert.ok(ts.isArrowFunction(callback) && ts.isBlock(callback.body));
    const guard = callback.body.statements[0];
    assert.ok(ts.isIfStatement(guard) && nodes(guard.thenStatement, ts.isReturnStatement).length);
    assert.match(text(guard.expression), /!active/);
    assert.match(text(guard.expression), /generation !== taskQueryGenerationRef\.current/);
    assert.match(text(guard.expression), /Number\(new URLSearchParams\(window\.location\.search\)\.get\('task'\)\) !== contextId/);
    for (const name of ['setTasks', 'notify']) for (const call of calls(callback.body, name)) {
      assert.ok(call.getStart(file) >= guard.end, `${name} must not publish after task URL/filter changes`);
    }
  }
});

test('normal direct-task success guards immediately after await before merge; failure guards URL mutations', () => {
  const directTry = nodes(file, ts.isTryStatement).find(node => directCalls(node.tryBlock, 'directTaskId').length > 0);
  assert.ok(directTry?.catchClause, 'Inspect actual first-page direct-task recovery');
  const successStatements = directTry.tryBlock.statements;
  const awaitIndex = successStatements.findIndex(statement => nodes(statement, ts.isAwaitExpression)
    .some(awaited => directCalls(awaited, 'directTaskId').length > 0));
  assert.ok(awaitIndex >= 0, 'Find actual awaited direct-task fetch');
  const successGuard = successStatements[awaitIndex + 1];
  assert.ok(successGuard && ts.isIfStatement(successGuard), 'Guard must immediately follow the awaited fetch');
  assert.ok(ts.isReturnStatement(successGuard.thenStatement), 'Stale direct-task success must return, not merely skip a notification');
  assert.match(text(successGuard.expression), /!active/);
  assert.match(text(successGuard.expression), /generation !== taskQueryGenerationRef\.current/);
  assert.match(text(successGuard.expression), /Number\(new URLSearchParams\(window\.location\.search\)\.get\('task'\)\) !== directTaskId/);
  const merges = calls(directTry.tryBlock, 'mergeRelatedTasks');
  assert.equal(merges.length, 1, 'Inspect actual direct-task merge');
  assert.ok(merges[0].getStart(file) >= successGuard.end, 'Never merge a stale task into the current list');
  assert.equal(text(merges[0].arguments[0]), 'items');
  assert.match(text(merges[0].arguments[1]), /\.\.\.directTask, __renderOsDirectOnly: true/);
  const block = directTry.catchClause.block;
  const guard = block.statements[0];
  assert.ok(ts.isIfStatement(guard) && nodes(guard.thenStatement, ts.isReturnStatement).length);
  assert.match(text(guard.expression), /!active/);
  assert.match(text(guard.expression), /generation !== taskQueryGenerationRef\.current/);
  assert.match(text(guard.expression), /Number\(new URLSearchParams\(window\.location\.search\)\.get\('task'\)\) !== directTaskId/);
  for (const name of ['notify', 'url.searchParams.delete', 'window.history.replaceState', 'window.dispatchEvent']) {
    const effects = calls(block, name); assert.ok(effects.length, `Actual ${name} is covered`);
    for (const effect of effects) assert.ok(effect.getStart(file) >= guard.end, `${name} is downstream of all stale checks`);
  }
  assert.match(text(block), /new PopStateEvent\("popstate"\)/);
});
