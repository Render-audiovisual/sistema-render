import test from 'node:test';
import assert from 'node:assert/strict';
import { readPersonalHome, readHomeEscalations, readHomeTeamWorkload, readHomeProductionPage,
  PERSONAL_HOME_SQL, HOME_ESCALATIONS_SQL, HOME_TEAM_WORKLOAD_SQL, HOME_PRODUCTION_PAGE_SQL } from '../src/personal-home.js';

// Injected driver failures, not a claim of physical network failure coverage.
const begin = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const actor = { id: 22, session_version: 3 };
const account = { ...actor, nombre: 'QA owner', rol: 'admin', activo: true };
const readers = [
  ['personal', readPersonalHome, {}, PERSONAL_HOME_SQL, 'home'],
  ['escalations', readHomeEscalations, {}, HOME_ESCALATIONS_SQL, 'queue'],
  ['team', readHomeTeamWorkload, {}, HOME_TEAM_WORKLOAD_SQL, 'workload'],
  ['monthly production', readHomeProductionPage, { period: '2026-10' }, HOME_PRODUCTION_PAGE_SQL, 'production_page'],
];

for (const [label, read, query, aggregate, field] of readers) {
  for (const failAt of [begin, aggregate, 'COMMIT']) {
    test(`${label}: failed rollback discards client and preserves primary ${failAt === aggregate ? 'query' : failAt} error`, async () => {
      const primary = new Error('Primary failure'), rollback = new Error('Rollback failure');
      const calls = [], releases = [];
      const db = { release(error) { releases.push(error); }, async query(sql) {
        calls.push(sql);
        if (sql === failAt) throw primary;
        if (sql === 'ROLLBACK') throw rollback;
        if (sql.startsWith('SELECT id,nombre,rol,activo,session_version')) return { rows: [account] };
        return { rows: [{ [field]: { version: 1 } }] };
      } };
      await assert.rejects(read({ connect: async () => db }, actor, query), error => error === primary);
      assert.equal(calls.at(-1), 'ROLLBACK');
      assert.deepEqual(releases, [rollback], 'node-postgres must remove the uncertain connection, exactly once');
    });
  }
  test(`${label}: successful rollback does not discard a healthy connection`, async () => {
    const primary = new Error('Query failure'), releases = [];
    const db = { release(error) { releases.push(error); }, async query(sql) {
      if (sql === aggregate) throw primary;
      if (sql.startsWith('SELECT id,nombre,rol,activo,session_version')) return { rows: [account] };
      return { rows: [] };
    } };
    await assert.rejects(read({ connect: async () => db }, actor, query), error => error === primary);
    assert.deepEqual(releases, [undefined]);
  });
}
