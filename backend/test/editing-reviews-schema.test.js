import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pure source contracts only. Actual PostgreSQL constraints, populated upgrade
// invariance and transaction/race behavior belong to guarded coordinator QA.
const source = readFileSync(new URL('../migrations/068_task_editing_reviews.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const definition = sql.match(/CREATE TABLE task_editing_reviews \(([\s\S]*?)\);/)?.[1];

test('068 only adds the exact delivery candidate key and new empty decision history', () => {
  assert.ok(definition);
  assert.deepEqual([...sql.matchAll(/ALTER TABLE (\w+)/g)].map(match => match[1]), ['task_editing_deliveries']);
  assert.match(sql, /^ALTER TABLE task_editing_deliveries ADD CONSTRAINT task_editing_deliveries_task_id_unique UNIQUE \(task_id,id\);/);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]), ['task_editing_reviews']);
  const installation = sql.replace(/CREATE FUNCTION[\s\S]*?END \$\$;/g, '');
  assert.doesNotMatch(installation, /\b(?:INSERT INTO|UPDATE \w+ SET|DELETE FROM|TRUNCATE|DROP|SELECT|DO)\b/i);
  assert.doesNotMatch(sql, /CREATE EXTENSION|gen_random_uuid|uuid_generate|propiedades_extra|material_referencia|publicaciones|historias|cliente_objetivo/);
});

test('decision schema is closed, UUID based and timestamped by the database clock', () => {
  const columns = [...definition.trim().matchAll(/(?:^|, )(\w+) (?:UUID|INTEGER|TEXT|TIMESTAMPTZ)\b/g)].map(match => match[1]);
  assert.deepEqual(columns, ['id', 'task_id', 'delivery_id', 'actor_id', 'action', 'task_revision', 'notes', 'request_id', 'payload_hash', 'recorded_at']);
  assert.match(definition, /id UUID CONSTRAINT task_editing_reviews_pk PRIMARY KEY/);
  assert.match(definition, /delivery_id UUID NOT NULL/);
  assert.match(definition, /recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp\(\)/);
  assert.match(definition, /request_id UUID, payload_hash TEXT,/);
  assert.doesNotMatch(definition, /JSON|BYTEA|actor_name|snapshot|expires_at|metadata|DEFAULT.*uuid/i);
});

test('positive actor/task/revision and restrictive exact-task delivery foreign keys are enforced', () => {
  for (const [field, relation] of [['task_id', 'tareas'], ['actor_id', 'usuarios']]) {
    assert.match(definition, new RegExp(`${field} INTEGER NOT NULL CONSTRAINT task_editing_reviews_\\w+_fk REFERENCES ${relation}\\(id\\) ON DELETE RESTRICT`));
    assert.ok(definition.includes(`CHECK (${field} > 0)`));
  }
  assert.match(definition, /task_revision INTEGER NOT NULL/);
  assert.match(definition, /CONSTRAINT task_editing_reviews_revision_positive CHECK \(task_revision > 0\)/);
  assert.match(definition, /CONSTRAINT task_editing_reviews_delivery_fk FOREIGN KEY \(task_id,delivery_id\) REFERENCES task_editing_deliveries\(task_id,id\) ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.equal((definition.match(/REFERENCES /g) || []).length, 3);
  assert.doesNotMatch(sql, /(?:ON DELETE|ON UPDATE) (?:CASCADE|SET NULL|SET DEFAULT)|DEFERRABLE/);
});

test('only approval/correction actions exist with action-specific bounded notes', () => {
  assert.match(definition, /action TEXT NOT NULL/);
  assert.match(definition, /CONSTRAINT task_editing_reviews_action CHECK \(action IN \('aprobada','correcciones'\)\)/);
  assert.match(definition, /notes TEXT NOT NULL/);
  assert.ok(definition.includes("char_length(notes) <= 4000 AND ( (action='aprobada' AND notes='') OR (action='correcciones' AND char_length(notes) > 0 AND notes=btrim(notes) AND notes !~ '^[[:space:]]|[[:space:]]$') )"));
  assert.doesNotMatch(definition, /substring\(|left\(/i);
});

test('approvals forbid replay metadata and corrections require both replay fields and a canonical hash', () => {
  assert.match(definition, /CONSTRAINT task_editing_reviews_request_pair CHECK \( \(action='aprobada' AND request_id IS NULL AND payload_hash IS NULL\) OR \(action='correcciones' AND request_id IS NOT NULL AND payload_hash IS NOT NULL\) \)/);
  assert.match(definition, /CONSTRAINT task_editing_reviews_hash CHECK \( payload_hash IS NULL OR \(char_length\(payload_hash\)=64 AND payload_hash ~ '\^\[0-9a-f\]\{64\}\$'\) \)/);
  assert.match(definition, /CONSTRAINT task_editing_reviews_request_unique UNIQUE \(actor_id,request_id\)/);
  assert.match(definition, /CONSTRAINT task_editing_reviews_task_revision_unique UNIQUE \(task_id,task_revision\)/);
  assert.doesNotMatch(definition, /NULLS NOT DISTINCT|UNIQUE \(task_id\)|UNIQUE \(delivery_id\)|UNIQUE \(request_id\)/);
});

test('unconditional row immutability blocks all updates/deletes with a named controlled error', () => {
  const fn = sql.match(/CREATE FUNCTION task_editing_reviews_reject_mutation\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)END \$\$;/)?.[1];
  assert.ok(fn);
  assert.match(fn, /RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='task_editing_reviews_immutable'/);
  assert.doesNotMatch(fn, /IF |RETURN NEW|RETURN OLD|SELECT|INSERT|UPDATE|DELETE|pg_advisory|FOR SHARE|FOR UPDATE/);
  assert.match(sql, /CREATE TRIGGER task_editing_reviews_immutable BEFORE UPDATE OR DELETE ON task_editing_reviews FOR EACH ROW EXECUTE FUNCTION task_editing_reviews_reject_mutation\(\)/);
  assert.equal((sql.match(/CREATE TRIGGER/g) || []).length, 1);
});

test('history index serves newest bounded task revisions and named constraints fit PostgreSQL identifiers', () => {
  assert.match(sql, /CREATE INDEX task_editing_reviews_history_idx ON task_editing_reviews\(task_id,task_revision DESC,id DESC\)/);
  const names = [...sql.matchAll(/CONSTRAINT(?:\s*=)?\s*'?(\w+)/g)].map(match => match[1]);
  assert.ok(names.length >= 13);
  assert.ok(names.every(name => name.startsWith('task_editing_reviews_') || name === 'task_editing_deliveries_task_id_unique'));
  assert.ok(names.every(name => name.length <= 63));
  assert.equal(new Set(names.filter(name => name !== 'task_editing_reviews_immutable')).size, names.filter(name => name !== 'task_editing_reviews_immutable').length);
});
