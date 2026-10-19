import test from 'node:test';
import assert from 'node:assert/strict';
import { editingDeliveryDomainConflict } from '../src/editing-deliveries-errors.js';

test('only named delivery ledger constraints become public conflicts', () => {
  for (const code of ['23503','23505','23514']) assert.equal(editingDeliveryDomainConflict({code,constraint:'task_editing_deliveries_task_id_fkey'}),true);
  for (const error of [{code:'XX000',constraint:'task_editing_deliveries_immutable'}, {code:'P0001',constraint:'task_editing_deliveries_immutable'}, {code:'23514',constraint:'other_constraint'}, {}, null]) assert.equal(editingDeliveryDomainConflict(error),false);
});
