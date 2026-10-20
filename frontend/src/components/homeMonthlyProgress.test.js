import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHomeMonthlyProgress } from './homeMonthlyProgress.js';

const sectors = ['administracion', 'community', 'desarrollo', 'diseno', 'edicion', 'produccion', 'sin_sector'];
const dto = () => ({ period: '2026-10', total: 14, completed: 7,
  by_sector: sectors.map(sector => ({ sector, total: 2, completed: 1 })) });

test('all seven actual sectors survive in stable alphabetical order', () => {
  const parsed = parseHomeMonthlyProgress(dto(), '2026-10-19');
  assert.deepEqual(parsed, dto());
  assert.deepEqual(parsed.by_sector.map(row => row.sector), sectors);
});

test('zero, complete, incomplete and sparse monthly totals are valid', () => {
  assert.deepEqual(parseHomeMonthlyProgress({ period: '2026-10', total: 0, completed: 0, by_sector: [] }, '2026-10-01'),
    { period: '2026-10', total: 0, completed: 0, by_sector: [] });
  for (const completed of [0, 1, 2]) {
    const value = { period: '2026-10', total: 2, completed, by_sector: [{ sector: 'community', total: 2, completed }] };
    assert.deepEqual(parseHomeMonthlyProgress(value, '2026-10-31'), value);
  }
});

test('today must be a real date and period must exactly match its month', () => {
  for (const today of [undefined, null, 20261019, '', '2026-10', '2026-10-00', '2026-10-32',
    '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-19T00:00:00Z', '2026-10-19\n']) {
    assert.throws(() => parseHomeMonthlyProgress(dto(), today));
  }
  for (const period of ['2026-09', '2027-10', '2026-1', '2026-13', '', null, 202610, '2026-10\n']) {
    assert.throws(() => parseHomeMonthlyProgress({ ...dto(), period }, '2026-10-19'));
  }
  for (const today of ['2028-02-29', '2026-12-31', '2027-01-01']) {
    assert.equal(parseHomeMonthlyProgress({ period: today.slice(0, 7), total: 0, completed: 0, by_sector: [] }, today).period, today.slice(0, 7));
  }
});

test('required parser rejects absence, nonintegers, negatives, overflow and inconsistent sums', () => {
  for (const value of [undefined, null, {}, [], 'progress']) assert.throws(() => parseHomeMonthlyProgress(value, '2026-10-19'));
  for (const count of [-1, 0.5, '14', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of ['total', 'completed']) assert.throws(() => parseHomeMonthlyProgress({ ...dto(), [key]: count }, '2026-10-19'));
  }
  for (const patch of [{ total: 13 }, { completed: 6 }, { completed: 15 }, { by_sector: null }, { by_sector: [] }]) {
    assert.throws(() => parseHomeMonthlyProgress({ ...dto(), ...patch }, '2026-10-19'));
  }
  const overflow = { period: '2026-10', total: Number.MAX_SAFE_INTEGER, completed: 0, by_sector: [
    { sector: 'diseno', total: Number.MAX_SAFE_INTEGER, completed: 0 }, { sector: 'edicion', total: 1, completed: 0 },
  ] };
  assert.throws(() => parseHomeMonthlyProgress(overflow, '2026-10-19'));
});

test('row allowlist, uniqueness, alphabetical order and positive totals fail closed', () => {
  for (const patch of [{ sector: 'finance' }, { sector: null }, { sector: 'Diseño' }, { total: 0 }, { total: -1 },
    { total: '2' }, { completed: 3 }, { completed: -1 }, { completed: false }]) {
    const value = dto(); Object.assign(value.by_sector[0], patch);
    assert.throws(() => parseHomeMonthlyProgress(value, '2026-10-19'));
  }
  const duplicate = dto(); duplicate.by_sector[1].sector = duplicate.by_sector[0].sector;
  assert.throws(() => parseHomeMonthlyProgress(duplicate, '2026-10-19'));
  const reversed = dto(); reversed.by_sector.reverse();
  assert.throws(() => parseHomeMonthlyProgress(reversed, '2026-10-19'));
  const tooMany = dto(); tooMany.by_sector.push({ sector: 'sin_sector', total: 1, completed: 0 });
  assert.throws(() => parseHomeMonthlyProgress(tooMany, '2026-10-19'));
});

test('closed projection drops raw metadata and financial fields without mutating inputs', () => {
  const rows = Object.freeze(dto().by_sector.map(row => Object.freeze({ ...row, metadata: { secret: 'hidden' }, salary: 99 })));
  const value = Object.freeze({ ...dto(), by_sector: rows, finance: 500, raw: { usuario: 'not authority' } });
  const before = JSON.stringify(value);
  const parsed = parseHomeMonthlyProgress(value, '2026-10-19');
  assert.deepEqual(parsed, dto());
  parsed.by_sector[0].total = 100;
  assert.equal(JSON.stringify(value), before);
  assert.equal(parseHomeMonthlyProgress(value, '2026-10-19').by_sector[0].total, 2);
});

test('component source presents completed tasks honestly with labeled bounded progress and no new data flows', () => {
  // Structural source checks only; no mounted rendering or browser QA claimed.
  const source = readFileSync(new URL('./HomeMonthlyProgress.jsx', import.meta.url), 'utf8');
  for (const text of ['if (!data) return null', 'Mi avance del mes', 'Tareas terminadas',
    'Por fecha de entrega; sin fecha, se usa la última actualización. No mide publicaciones.',
    'className="qh-section"', 'aria-labelledby={titleId}', 'dateTime={data.period}',
    'data.total > 0 ?', 'htmlFor={progressId}', 'max={data.total} value={data.completed}',
    '<dl', '<dt>', '<dd', 'Comunicación', 'Administración', 'Desarrollo', 'Sin sector']) assert.ok(source.includes(text), text);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|fetch\(|apiRequest|useEffect|\.css['"]|Math\.round|\*\s*100|%|publicadas|finanzas|salary/);
});
