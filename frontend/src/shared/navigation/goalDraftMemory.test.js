import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalDraftMemory, makeGoalDraftHref, resolveGoalDraftPiece } from './goalDraftMemory.js';

const input = (patch = {}) => ({ pieceId: 3, taskId: 4, clientId: 9, period: '2026-10',
  title: '', copy: 'Unsaved', baseline: JSON.stringify({ title: 'Server title', copy: 'Server copy' }),
  taskVersion: '2026-10-24T12:00:00Z', taskRevision: 1, ...patch });
const memory = () => createGoalDraftMemory({ isCurrent: () => true });
const data = () => ({ periodo: '2026-10', clientes: [{ cuentas: [{ id: 8 }, { id: 9 }],
  piezas: [{ id: 3, tarea_id: 4, puede_editar_contenido: true }] }] });
const search = '?cliente=9&periodo=2026-10&borrador=3';

test('stable immutable primitive capture and document-only server snapshot', () => {
  const m = memory(), source = input(), d = m.retain(source);
  assert.ok(Object.isFrozen(d)); assert.equal(d.status, 'editing');
  source.title = 'Changed'; source.taskRevision = 20;
  assert.equal(d.title, ''); assert.equal(d.taskRevision, 1);
  assert.equal(m.getSnapshot(), d); assert.equal(m.getSnapshot(), d);
  assert.equal(m.getServerSnapshot(), null);
});

test('one identity, CAS clear, saving rejection and uncertain transition', () => {
  const m = memory(), first = m.retain(input());
  assert.equal(m.retain(input({ pieceId: 5 })), null); assert.equal(m.getSnapshot(), first);
  const second = m.retain(input({ title: 'New draft' }));
  assert.notEqual(first, second); assert.equal(m.clear(first), false);
  assert.equal(m.markSaving(first), null); assert.equal(m.markUncertain(second), null);
  const saving = m.markSaving(second); assert.equal(saving.status, 'saving');
  assert.equal(m.retain(input()), null); assert.equal(m.markUncertain(second), null);
  const uncertain = m.markUncertain(saving);
  assert.equal(uncertain.status, 'uncertain'); assert.ok(Object.isFrozen(uncertain));
  assert.equal(m.clear(saving), false); assert.equal(m.clear(second), false);
  assert.equal(m.clear(uncertain), true); assert.equal(m.getSnapshot(), null);
});

test('subscriptions publish changes, unsubscribe and reset without owner', () => {
  let owner = true, count = 0;
  const m = createGoalDraftMemory({ isCurrent: () => owner });
  const off = m.subscribe(() => count++);
  m.retain(input()); assert.equal(count, 1);
  owner = false; m.reset(); assert.equal(count, 2);
  assert.equal(m.getSnapshot(), null); off(); m.reset(); assert.equal(count, 2);
});

test('observed owner loss is terminal across ABA and every mutator fails closed', () => {
  let owner = true;
  const m = createGoalDraftMemory({ isCurrent: () => owner }), d = m.retain(input());
  owner = false; assert.equal(m.getSnapshot(), null);
  owner = true;
  assert.equal(m.getSnapshot(), null); assert.equal(m.retain(input()), null);
  assert.equal(m.clear(d), false); assert.equal(m.markSaving(d), null); assert.equal(m.markUncertain(d), null);
  let called = false; m.subscribe(() => { called = true; }); m.reset(); assert.equal(called, false);
});

test('missing or throwing owner fails closed', () => {
  for (const options of [undefined, {}, { isCurrent: () => { throw Error('obsolete'); } }]) {
    const m = createGoalDraftMemory(options);
    assert.equal(m.retain(input()), null); assert.equal(m.getSnapshot(), null);
  }
});

test('validation rejects invalid input without replacing existing snapshot', () => {
  const m = memory(), d = m.retain(input());
  const invalid = [null, [], {}, input({ title: null }), input({ title: 'a'.repeat(501) }),
    input({ copy: 'a'.repeat(20001) }), input({ baseline: '{}' }), input({ baseline: 'bad JSON' }),
    input({ baseline: JSON.stringify({ title: '', copy: '' }) }), input({ taskVersion: 'invalid' }),
    input({ taskRevision: 0 }), input({ taskRevision: Number.MAX_SAFE_INTEGER + 1 }), input({ status: 'done' })];
  for (const key of ['pieceId', 'taskId', 'clientId']) for (const value of [0, -1, 2147483648, '3', 1.5, NaN]) invalid.push(input({ [key]: value }));
  for (const period of ['0000-10', '2026-00', '2026-13', '2026-1', '2026-10\n', ' 2026-10']) invalid.push(input({ period }));
  for (const value of invalid) { assert.equal(m.retain(value), null); assert.equal(m.getSnapshot(), d); }
  assert.ok(memory().retain(input({ title: 'a'.repeat(500), copy: 'b'.repeat(20000), taskRevision: Number.MAX_SAFE_INTEGER })));
});

test('reentrant or throwing listeners cannot corrupt published state', () => {
  const m = memory(); m.subscribe(() => { throw Error('listener'); });
  const d = m.retain(input()); assert.equal(m.getSnapshot(), d);
  assert.equal(m.clear(d), true);
});

test('href uses only canonical validated IDs and period', () => {
  assert.equal(makeGoalDraftHref(input()), '/clientes?cliente=9&periodo=2026-10&borrador=3');
  for (const value of [null, input({ pieceId: '3' }), input({ taskId: 0 }), input({ clientId: 2147483648 }), input({ period: '2026-10\n' })]) assert.equal(makeGoalDraftHref(value), null);
});

test('resolver matches group account and stable piece/task IDs, never names', () => {
  const value = data(), d = input(), piece = value.clientes[0].piezas[0];
  assert.equal(resolveGoalDraftPiece(value, d, search), piece);
  assert.equal(resolveGoalDraftPiece(value, d, search.slice(1)), piece);
  for (const patch of [{ id: 5 }, { tarea_id: 7 }, { puede_editar_contenido: false }, { puede_editar_contenido: 'true' }]) {
    const changed = data(); Object.assign(changed.clientes[0].piezas[0], patch);
    assert.equal(resolveGoalDraftPiece(changed, d, search), null);
  }
  const wrong = data(); wrong.clientes[0].cuentas = [{ id: 99, nombre: 'Same name' }]; wrong.clientes[0].cliente_id = 9;
  assert.equal(resolveGoalDraftPiece(wrong, d, search), null);
  assert.equal(resolveGoalDraftPiece({ ...data(), periodo: '2026-11' }, d, search), null);
});

test('resolver rejects duplicate, missing, malformed and mismatched query context', () => {
  for (const query of ['', '?borrador=3', search + '&borrador=3', search + '&cliente=9', search + '&periodo=2026-10',
    search.replace('borrador=3', 'borrador=03'), search.replace('cliente=9', 'cliente=+9'),
    search.replace('2026-10', '0000-10'), search.replace('borrador=3', 'borrador=4'), search.replace('cliente=9', 'cliente=8')]) {
    assert.equal(resolveGoalDraftPiece(data(), input(), query), null, query);
  }
  const ambiguous = data(); ambiguous.clientes.push(ambiguous.clientes[0]);
  assert.equal(resolveGoalDraftPiece(ambiguous, input(), search), null);
  for (const invalid of [null, {}, { clientes: [] }]) assert.equal(resolveGoalDraftPiece(invalid, input(), search), null);
});
