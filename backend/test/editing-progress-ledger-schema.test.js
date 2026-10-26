import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITING_PROGRESS_SCHEMA, assertEditingProgressSchema } from '../src/editing-progress-ledger.js';

function catalog() {
  return { columns: Object.entries(EDITING_PROGRESS_SCHEMA.columns).map(([name, [type, notNull]]) => ({ name, type, notNull })),
    constraints: Object.entries(EDITING_PROGRESS_SCHEMA.constraints).map(([name, definition]) => ({ name, definition, validated: true, deferred: false })) };
}
const db = value => ({ async query(sql) { return { rows: sql.includes('FROM pg_constraint') ? [value] : [] }; } });

test('unit schema handshake accepts complete catalog, ignoring only whitespace in deparse', async () => {
  const value = catalog();
  for (const c of value.constraints) c.definition = c.definition.replaceAll(' ', '\n ');
  await assertEditingProgressSchema(db(value));
});

test('unit schema handshake rejects weakened historical pair and wrong FK actions even with correct names', async () => {
  for (const [name, definition] of [
    ['editing_progress_v1_identity', 'CHECK (editor_user_id IS NULL)'],
    ['editing_progress_v1_identity', 'CHECK (delivery_id IS NOT NULL OR task_revision IS NOT NULL)'],
    ['editing_progress_v1_editor_fk', 'FOREIGN KEY (editor_user_id) REFERENCES usuarios(id) ON DELETE CASCADE'],
    ['editing_progress_v1_state', 'CHECK (true)'],
  ]) {
    const value = catalog(); value.constraints.find(c => c.name === name).definition = definition;
    await assert.rejects(assertEditingProgressSchema(db(value)), { status: 503, code: 'editing_progress_schema_unavailable' });
  }
});

test('unit schema export requires nullable historical identity plus complete artifact/revision pair', () => {
  assert.deepEqual(EDITING_PROGRESS_SCHEMA.columns.editor_user_id, ['integer', false]);
  assert.deepEqual(EDITING_PROGRESS_SCHEMA.columns.delivery_id, ['uuid', false]);
  const identity = EDITING_PROGRESS_SCHEMA.constraints.editing_progress_v1_identity;
  assert.match(identity, /\(delivery_id IS NULL\) AND \(task_revision IS NULL\)/);
  assert.match(identity, /\(delivery_id IS NOT NULL\) AND \(task_revision IS NOT NULL\)/);
  assert.match(identity, /WHEN \(origen_registro IS NULL\) THEN \(\(editor_user_id IS NULL\)/);
});
