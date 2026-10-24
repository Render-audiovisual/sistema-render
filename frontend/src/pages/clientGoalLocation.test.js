import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parseGoalClientId, goalClientHref, goalClientLocationUrl, resolveGoalClient } from './clientGoalLocation.js';

test('optional account ID parses only a single canonical positive int32 without coercion', () => {
  for (const search of ['', '?periodo=2026-10', '?otro=x#y']) assert.equal(parseGoalClientId(search), null);
  assert.equal(parseGoalClientId('?cliente=1'), 1);
  assert.equal(parseGoalClientId('?cliente=2147483647&periodo=2026-10'), 2147483647);
  for (const search of ['?cliente=', '?cliente=0', '?cliente=-1', '?cliente=01', '?cliente=1.0', '?cliente=1e2',
    '?cliente=2147483648', '?cliente=NaN', '?cliente=true', '?cliente=grupo-7', '?cliente=%207', '?cliente=7%20', '?cliente=7%0A',
    '?cliente=7&cliente=7', '?cliente=7&cliente=8', '?cliente[]=7', '?cliente[id]=7', '?cliente=7&cliente[]=8', '?cliente=7&cliente[x][y]=8']) {
    assert.throws(() => parseGoalClientId(search), Error, search);
  }
});
test('canonical links contain only actual account ID and exact month, never a group key or name', () => {
  assert.equal(goalClientHref(7, '2026-10'), '/clientes?cliente=7&periodo=2026-10');
  assert.equal(goalClientHref(2147483647, '0001-01'), '/clientes?cliente=2147483647&periodo=0001-01');
  for (const id of [undefined, null, 0, -1, '7', true, 1.5, 2147483648, 'Feed compartido']) assert.equal(goalClientHref(id, '2026-10'), null);
  for (const period of ['0000-01', '2026-00', '2026-13', '2026-1', '2026-10\n', null, 202610]) assert.equal(goalClientHref(7, period), null);
});
test('writer preserves unrelated query entries/hash and returns route-local URL without mutating its input', () => {
  const initial = 'https://render.test/clientes?periodo=2026-09&cliente=8&panel=x&panel=y&gestion=0#objetivo';
  const next = goalClientLocationUrl(initial, {clientId:7,period:'2026-10'});
  assert.equal(next, '/clientes?panel=x&panel=y&gestion=0&cliente=7&periodo=2026-10#objetivo');
  assert.equal(parseGoalClientId(new URL(next, 'https://render.test').search), 7);
  assert.equal(initial, 'https://render.test/clientes?periodo=2026-09&cliente=8&panel=x&panel=y&gestion=0#objetivo');
  for (const clientId of [null, undefined]) assert.equal(goalClientLocationUrl(initial, {clientId,period:'2026-11'}), '/clientes?panel=x&panel=y&gestion=0&periodo=2026-11#objetivo');
});
test('writer canonicalizes controlled duplicate/array params only and rejects invalid route/identity/month', () => {
  assert.equal(goalClientLocationUrl('http://127.0.0.1:1234/clientes?cliente=7&cliente=8&cliente[]=9&periodo=old&periodo[x]=x&otro=z#h', {clientId:7,period:'2026-10'}), '/clientes?otro=z&cliente=7&periodo=2026-10#h');
  for (const href of ['https://render.test/proyectos', 'https://render.test/clientes/', 'file:///clientes', 'https://user:password@render.test/clientes']) assert.throws(() => goalClientLocationUrl(href, {clientId:7,period:'2026-10'}));
  for (const clientId of [0, -1, '7', true, 2147483648]) assert.throws(() => goalClientLocationUrl('https://render.test/clientes', {clientId,period:'2026-10'}));
  assert.throws(() => goalClientLocationUrl('https://render.test/clientes', {clientId:7,period:'2026-10\n'}));
});

const clients = Object.freeze([
  Object.freeze({clave:'cliente-1',nombre:'Mismo nombre',cuentas:Object.freeze([Object.freeze({id:1,nombre:'Cuenta'})])}),
  Object.freeze({clave:'grupo-9',nombre:'Mismo nombre',cuentas:Object.freeze([Object.freeze({id:7,nombre:'Otra'}),Object.freeze({id:8,nombre:'Hermana'})])}),
]);
test('explicit account selects its shared feed by ID, including its second account, not fallback/name/key', () => {
  assert.equal(resolveGoalClient(clients, 1, 'grupo-9'), clients[0]);
  assert.equal(resolveGoalClient(clients, 7, 'cliente-1'), clients[1]);
  assert.equal(resolveGoalClient(clients, 8, 'cliente-1'), clients[1]);
  for (const id of [9, 0, -1, '7', true, 1.5]) assert.equal(resolveGoalClient(clients, id, 'cliente-1'), null);
  assert.equal(resolveGoalClient([], 7, 'cliente-1'), null);
});
test('null/undefined retain legacy fallback only; no available rows return null', () => {
  for (const id of [null, undefined]) {
    assert.equal(resolveGoalClient(clients, id, 'grupo-9'), clients[1]);
    assert.equal(resolveGoalClient(clients, id, 'removed-key'), clients[0]);
    assert.equal(resolveGoalClient([], id, ''), null);
    assert.equal(resolveGoalClient(undefined, id, ''), null);
  }
});
test('a historical overlapping account retains a matching fallback, never an unrelated group; inputs stay intact', () => {
  const historical = {clave:'historical-7',cuentas:[{id:7}]};
  const rows = [...clients, historical], before = structuredClone(rows);
  assert.equal(resolveGoalClient(rows, 7, 'historical-7'), historical);
  assert.equal(resolveGoalClient(rows, 7, 'cliente-1'), clients[1]);
  assert.equal(resolveGoalClient(rows, 99, 'historical-7'), null);
  assert.deepEqual(rows, before);
});
test('actual Goals JSX parses and keeps the new optional selection state after all existing state slots', () => {
  const file=ts.createSourceFile('ClientesObjetivos.jsx',readFileSync(new URL('./ClientesObjetivos.jsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length,0);
  const page=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='GoalPage');
  const slots=[];
  function visit(node){if(ts.isVariableDeclaration(node)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(file)==='useState') slots.push(node.name.getText(file));ts.forEachChild(node,visit);}
  visit(page);
  assert.equal(slots.at(-1),'[selectedClientId, setSelectedClientId]');
  assert.equal(slots.length,11);
});
test('actual existing period parser rejects bracket/array pollution instead of resolving to the current month', () => {
  const file=ts.createSourceFile('ClientesObjetivos.jsx',readFileSync(new URL('./ClientesObjetivos.jsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const declaration=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='goalPeriod');
  const parse=Function('currentMonth',`${declaration.getText(file)};return goalPeriod;`)(()=> '2099-01');
  assert.equal(parse('?cliente=7'), '2099-01');
  assert.equal(parse('?cliente=7&periodo=2026-10'), '2026-10');
  for (const query of ['?periodo[]=2026-10','?periodo[x]=2026-10','?periodo=2026-10&periodo[]=2026-11','?periodo=2026-10&periodo=2026-11']) assert.throws(()=>parse(query),/Período inválido/);
});
