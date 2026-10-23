import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const files = ['HomeEditorialControl', 'HomeEscalations', 'HomeTeamWorkload', 'HomeProductionMonthly', 'EditorialPieceDetails'];
const sourceFor = name => readFileSync(new URL(`./${name}.jsx`, import.meta.url), 'utf8');
function nodes(root, predicate) {
  const found = []; const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }; visit(root); return found;
}
for (const name of files) test(`${name}: actual JSX forwards exact stable session view and retains cleanup/fences (source/AST, not mounted)`, () => {
  const source = sourceFor(name), file = ts.createSourceFile(`${name}.jsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length, 0);
  assert.match(source, /import \{ useSessionView \} from '..\/shared\/session\/use-session-view.js'/);
  assert.match(source, /const view = useSessionView\(sesion\)/);
  assert.doesNotMatch(source, /\.token\b|\{ token, usuario:|session_context:|csrf_token:/);
  const calls = nodes(file, node => ts.isCallExpression(node) && /^create(?:Home|EditorialPieceDetail).*Loader$/.test(node.expression.getText(file)));
  assert.equal(calls.length, 1);
  const options = calls[0].arguments[0]; assert.ok(ts.isObjectLiteralExpression(options));
  const session = options.properties.find(property => property.name?.getText(file) === 'sesion');
  assert.equal(session.initializer.getText(file), 'view.session', 'Never rebuild or clone cookie DTO');
  const effects = nodes(file, node => ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect');
  assert.ok(effects.length > 0);
  for (const effect of effects) {
    const deps = effect.arguments[1]; assert.ok(ts.isArrayLiteralExpression(deps));
    const names = deps.elements.map(node => node.getText(file));
    assert.ok(names.includes('view')); assert.equal(names.includes('sesion'), false);
    assert.equal(names.includes('token'), false);
  }
  assert.match(source, /loader.dispose\(\)/);
  assert.match(source, /(?:identityRef.current === identity|scopeRef.current === scope)/);
  assert.match(source, /result\?\.(?:identity === identity|scope === scope)/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|guardarSesion|render_sesion/);
});
test('editorial wrapper preserves open-record refresh deferral, location preferences and captured-session children', () => {
  const source = sourceFor('HomeEditorialControl');
  assert.match(source, /recordOpenRef.current \|\| !selectionRef.current \? false : loader.refresh\(options\)/);
  assert.match(source, /if \(recordOpenRef.current\) \{ deferredLocationRef.current = applyLocation; return; \}/);
  assert.match(source, /if \(!open && deferredLocationRef.current\)/);
  assert.match(source, /window.removeEventListener\('popstate', onLocation\)/);
  assert.match(source, /loadEditorialView\(storage, id\)/); assert.match(source, /saveEditorialView\(storage, id, selected\)/);
  assert.match(source, /onOpenChange=\{changeRecordOpen\}/);
  assert.match(source, /<EditorialPieceDetails piece=\{item\} sesion=\{view.session\} request=\{request\}/);
  assert.match(source, /pieza=\{homeEditorialRecordPiece\(item\)\} sesion=\{view.session\}/);
  assert.match(source, /disabled=\{recordOpen \|\| !data.has_more/);
});
test('piece and monthly scopes combine session view with existing domain/client/month boundaries', () => {
  const piece = sourceFor('EditorialPieceDetails'), monthly = sourceFor('HomeProductionMonthly');
  assert.match(piece, /useMemo\(\(\) => \(\{ id, domain, clientId, view \}\), \[id, domain, clientId, view\]\)/);
  assert.match(piece, /if \(!open \|\| !allowed\) return undefined/);
  assert.match(piece, /piece.estado, piece.fecha_programada/);
  // Domain identity is stable across refreshed parent data; snapshot ownership
  // independently fences reads so keeping the page never admits old results.
  assert.match(monthly, /useMemo\(\(\) => \(\{ period, view \}\), \[period, view\]\)/);
  assert.match(monthly, /useMemo\(\(\) => \(\{ data, scope, request \}\), \[data, scope, request\]\)/);
  assert.match(monthly, /if \(offsetRef.current.scope !== scope\) offsetRef.current = \{ scope, offset: 0 \}/);
  assert.match(monthly, /result\?\.scope === scope && result.snapshot === snapshot/);
  assert.match(monthly, /scopeRef.current === scope && snapshotRef.current === snapshot/);
  assert.match(monthly, /loader.refresh\(\{ offset: offsetRef.current.offset \}\)/);
  assert.match(monthly, /snapshot !== snapshotRef.current \|\| binding.snapshot !== snapshotRef.current/);
  assert.match(monthly, /const page = current \? current.data : snapshot === initialSnapshot.current/);
  assert.match(monthly, /Sin resultado confirmado/);
  assert.match(monthly, /aria-label="Páginas de producción por cliente"/);
  assert.match(monthly, /offset: 0, has_more: data.client_count > PRODUCTION_PAGE_LIMIT/);
});
test('admin visibility and semantic pagination/navigation controls remain unchanged', () => {
  for (const name of ['HomeEscalations', 'HomeTeamWorkload']) {
    const source = sourceFor(name);
    assert.match(source, /canReadHomeEscalations\(view.session\)/); assert.match(source, /if \(!allowed\) return null/);
    assert.match(source, /subscribePersonalHomeRefresh\(loader\)/); assert.match(source, /unsubscribe\(\)/);
    assert.match(source, /personalHomeNavigate\(/); assert.match(source, /role="status"/);
    assert.match(source, /role="alert"/); assert.match(source, />Anterior<\/button>/); assert.match(source, />Siguiente<\/button>/);
  }
});
