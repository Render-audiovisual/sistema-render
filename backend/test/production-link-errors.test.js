import test from 'node:test';
import assert from 'node:assert/strict';
import { productionEditorialConflict } from '../src/production-link-errors.js';

test('only named production integrity constraints map to a safe conflict', () => {
  for (const code of ['23503', '23505', '23514']) {
    assert.equal(productionEditorialConflict({code,constraint:'produccion_editorial_video_task_fk'}), true);
  }
  for (const error of [null, {}, { code:'P0001',constraint:'produccion_editorial_fault' },
    {code:'23503',constraint:'unrelated_task_fk'}, {code:'23514'}, {code:'23503',detail:'produccion_editorial private SQL detail'}]) {
    assert.equal(productionEditorialConflict(error), false);
  }
});
