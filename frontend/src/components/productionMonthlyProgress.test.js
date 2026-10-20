import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHomeMonthlyProgress } from './homeMonthlyProgress.js';

const dto = () => ({ period: '2026-10', total: 4, completed: 2,
  by_sector: [{ sector: 'produccion', total: 4, completed: 2 }],
  production: { total: 4, completed: 2, client_count: 3, clients: [
    { client: { id: 1, nombre: 'Mismo nombre' }, total: 2, completed: 1 },
    { client: { id: 2, nombre: 'Mismo nombre' }, total: 1, completed: 1 },
    { client: null, total: 1, completed: 0 },
  ] } });
const parse = value => parseHomeMonthlyProgress(value, '2026-10-19');

test('production keeps distinct client IDs and unassigned client group, not name identity', () => {
  assert.deepEqual(parse(dto()), dto());
  const empty = { period: '2026-10', total: 0, completed: 0, by_sector: [],
    production: { total: 0, completed: 0, client_count: 0, clients: [] } };
  assert.deepEqual(parse(empty), empty);
});

test('production is optional for an earlier server but malformed supplied data fails closed', () => {
  const old = dto(); delete old.production;
  assert.deepEqual(parse(old), old);
  for (const patch of [null, {}, { ...dto().production, total: 3 }, { ...dto().production, completed: 1 },
    { ...dto().production, client_count: 2 }, { ...dto().production, clients: [] },
    { ...dto().production, client_count: '3' }]) {
    assert.throws(() => parse({ ...dto(), production: patch }));
  }
});

test('reject duplicate IDs, wrong order, impossible counts and unsafe client data', () => {
  for (const patch of [{ client: { id: 1, nombre: 'Other' } }, { client: { id: 0, nombre: 'Bad' } },
    { client: { id: 2, nombre: null } }, { total: 0 }, { total: 3 }, { completed: 2 },
    { completed: -1 }, { completed: '1' }]) {
    const value = dto(); Object.assign(value.production.clients[1], patch);
    assert.throws(() => parse(value));
  }
  const reversed = dto(); reversed.production.clients.reverse(); assert.throws(() => parse(reversed));
});

test('bounded first twenty rows retain full totals and enforce remainder consistency', () => {
  const value = { period: '2026-10', total: 24, completed: 3,
    by_sector: [{ sector: 'produccion', total: 24, completed: 3 }],
    production: { total: 24, completed: 3, client_count: 24,
      clients: Array.from({ length: 20 }, (_, index) => ({ client: { id: index + 1, nombre: 'Cliente' }, total: 1, completed: 0 })) } };
  assert.deepEqual(parse(value), value);
  const tooFew = structuredClone(value); tooFew.production.clients.pop(); assert.throws(() => parse(tooFew));
  const tooManyGroups = structuredClone(value); tooManyGroups.production.client_count = 25; assert.throws(() => parse(tooManyGroups));
  const remainder = structuredClone(value); remainder.completed = remainder.by_sector[0].completed = remainder.production.completed = 5;
  assert.throws(() => parse(remainder));
});

test('production projection strips arbitrary private metadata from each level', () => {
  const value = dto(); value.production.salary = 99; value.production.clients[0].finance = 100;
  value.production.clients[0].client.contract = 'private';
  const before = structuredClone(value);
  assert.deepEqual(parse(value), dto()); assert.deepEqual(value, before);
});

test('shared monthly component renders a compact disclosed list with explicit truncation and honest labels', () => {
  const source = readFileSync(new URL('./HomeProductionMonthly.jsx', import.meta.url), 'utf8');
  for (const text of ['<details className="qh-monthly-production">', 'Producción por cliente',
    'No cuenta videos grabados ni cuotas', 'row.client?.id', 'Sin cliente',
    'Los totales incluyen todos los grupos.']) assert.ok(source.includes(text), text);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|localStorage|fetch\(/);
});
