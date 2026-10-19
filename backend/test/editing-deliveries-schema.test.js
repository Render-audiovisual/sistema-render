import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pure SQL-source contracts. Real populated-upgrade invariance, immutability,
// restrictive FKs, URL checks and transaction behavior require coordinated QA.
const source = readFileSync(new URL('../migrations/065_task_editing_deliveries.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const definition = sql.match(/CREATE TABLE task_editing_deliveries \(([\s\S]*?)\);/)?.[1];

test('065 defines only the new empty delivery history without changing tasks or promoting old artifacts', () => {
  assert.ok(definition);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]), ['task_editing_deliveries']);
  const installation = sql.replace(/CREATE FUNCTION[\s\S]*?END \$\$;/g, '');
  assert.doesNotMatch(installation, /\b(?:ALTER|INSERT|UPDATE \w+ SET|DELETE FROM|TRUNCATE|DROP|SELECT)\b/i);
  assert.doesNotMatch(sql, /gen_random_uuid|uuid_generate|CREATE EXTENSION|material_referencia|propiedades_extra|INSERT INTO tareas|UPDATE tareas SET/);
});

test('immutable event columns are an explicit closed schema with application-supplied UUIDs', () => {
  const columns = [...definition.trim().matchAll(/(?:^|, )(\w+) (?:UUID|INTEGER|TEXT|TIMESTAMPTZ)\b/g)].map(match => match[1]);
  assert.deepEqual(columns, ['id', 'task_id', 'actor_id', 'request_id', 'payload_hash', 'task_revision', 'url', 'notes', 'recorded_at']);
  assert.match(definition, /id UUID CONSTRAINT task_editing_deliveries_pk PRIMARY KEY/);
  assert.match(definition, /request_id UUID NOT NULL/);
  assert.match(definition, /recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp\(\)/);
  assert.doesNotMatch(definition, /JSON|BYTEA|current_event|actor_name|snapshot|expires_at|metadata/i);
});

test('positive task and actor identities use restrictive FKs preserving delivered history', () => {
  for (const [field, relation] of [['task_id', 'tareas'], ['actor_id', 'usuarios']]) {
    assert.match(definition, new RegExp(`${field} INTEGER NOT NULL CONSTRAINT task_editing_deliveries_\\w+_fk REFERENCES ${relation}\\(id\\) ON DELETE RESTRICT`));
    assert.ok(definition.includes(`CHECK (${field} > 0)`));
  }
  assert.equal((definition.match(/REFERENCES /g) || []).length, 2);
  assert.doesNotMatch(sql, /ON DELETE (?:CASCADE|SET NULL)/);
});

test('actor/request identity is unique and canonical SHA256 plus task revision are required', () => {
  assert.match(definition, /CONSTRAINT task_editing_deliveries_request_unique UNIQUE \(actor_id,request_id\)/);
  assert.match(definition, /payload_hash TEXT NOT NULL/);
  assert.ok(definition.includes("char_length(payload_hash)=64 AND payload_hash ~ '^[0-9a-f]{64}$'"));
  assert.match(definition, /task_revision INTEGER NOT NULL/);
  assert.match(definition, /CONSTRAINT task_editing_deliveries_revision_positive CHECK \(task_revision > 0\)/);
  assert.doesNotMatch(definition, /UNIQUE \(task_id\)|UNIQUE \(task_id,task_revision\)/);
});

test('URL storage is bounded trimmed HTTP(S), excludes controls and authority credentials; notes are bounded plain text', () => {
  assert.match(definition, /url TEXT NOT NULL/);
  assert.match(definition, /char_length\(url\) BETWEEN 1 AND 2000 AND url=btrim\(url\)/);
  assert.ok(definition.includes("url !~ '[[:cntrl:]]'"));
  assert.ok(definition.includes("url ~ '^https?://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$'"));
  assert.match(definition, /notes TEXT NOT NULL/);
  assert.match(definition, /CHECK \(char_length\(notes\) <= 4000\)/);
  assert.doesNotMatch(definition, /char_length\(notes\) BETWEEN 1|substring\(|left\(/i);
});

test('every delivery UPDATE/DELETE raises a controlled immutable error without task or editorial side effects', () => {
  const fn = sql.match(/CREATE FUNCTION task_editing_deliveries_reject_mutation\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)END \$\$;/)?.[1];
  assert.ok(fn);
  assert.match(fn, /RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='task_editing_deliveries_immutable'/);
  assert.doesNotMatch(fn, /IF |RETURN NEW|RETURN OLD|SELECT|INSERT|UPDATE|DELETE|pg_advisory|FOR SHARE|FOR UPDATE/);
  assert.match(sql, /CREATE TRIGGER task_editing_deliveries_immutable BEFORE UPDATE OR DELETE ON task_editing_deliveries FOR EACH ROW EXECUTE FUNCTION task_editing_deliveries_reject_mutation\(\)/);
  assert.doesNotMatch(sql, /ON (?:tareas|publicaciones|historias)|current_event|UPDATE (?:tareas|publicaciones|historias)/);
});

test('ordered history index covers task FK and all constraint names are bounded and consistently prefixed', () => {
  assert.match(sql, /CREATE INDEX task_editing_deliveries_history_idx ON task_editing_deliveries\(task_id,recorded_at,id\)/);
  const names = [...sql.matchAll(/CONSTRAINT(?:\s*=)?\s*'?(\w+)/g)].map(match => match[1]);
  assert.ok(names.length >= 10);
  assert.ok(names.every(name => name.startsWith('task_editing_deliveries_') && name.length <= 63));
});
