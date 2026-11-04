import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAL_HOME_SQL, HOME_ESCALATIONS_SQL, HOME_TEAM_WORKLOAD_SQL } from '../src/personal-home.js';

test('all home task queues hide prior delivery months without excluding undated work or writing data', () => {
  for (const sql of [PERSONAL_HOME_SQL, HOME_ESCALATIONS_SQL, HOME_TEAM_WORKLOAD_SQL]) {
    assert.match(sql, /t\.fecha_vencimiento IS NULL OR t\.fecha_vencimiento >= date_trunc\('month',\(statement_timestamp\(\) AT TIME ZONE 'America\/Argentina\/Cordoba'\)\)::date/);
    assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT)\b/);
  }
});
