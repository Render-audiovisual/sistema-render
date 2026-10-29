import test from 'node:test';
import assert from 'node:assert/strict';
import {runScheduledEditorial} from '../src/scheduled-editorial.js';

for (const [date, expected] of [
  ['2026-10-28T02:59:00Z', ['calendar:2026-10', 'goals:2026-10']],
  ['2026-10-28T03:00:00Z', ['calendar:2026-10', 'goals:2026-10', 'calendar:2026-11']],
  ['2026-12-31T15:00:00Z', ['calendar:2026-12', 'goals:2026-12', 'calendar:2027-01']],
]) test(`editorial preserves Córdoba schedule ${date}`, async () => {
  const calls = [], pool = {};
  await runScheduledEditorial(pool, {now: new Date(date),
    calendar: async (db, period) => {assert.equal(db, pool); calls.push(`calendar:${period}`);},
    goals: async (db, period) => {assert.equal(db, pool); calls.push(`goals:${period}`);},
  });
  assert.deepEqual(calls, expected);
});
test('calendar failure stops goals and next month', async () => {
  let called = false;
  await assert.rejects(runScheduledEditorial({}, {now: new Date('2026-10-29T15:00:00Z'),
    calendar: async () => {throw new Error('test');}, goals: async () => {called = true;},
  }));
  assert.equal(called, false);
});
test('invalid clock fails before domain imports', async () => {
  await assert.rejects(runScheduledEditorial({}, {now: new Date('invalid')}));
});
