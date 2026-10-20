import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Migration source contracts only; PostgreSQL enforcement and API replay/locking
// are verified separately. Comments describe app immutability, not a DB trigger.
const source = readFileSync(new URL('../migrations/069_production_reconciliation.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const receipt = sql.match(/CREATE TABLE produccion_reconciliaciones \(([\s\S]*?)\);/)?.[1];
const mapping = sql.match(/CREATE TABLE produccion_reconciliacion_videos \(([\s\S]*?)\);/)?.[1];

test('migration creates exactly the two additive reconciliation tables and no historical backfill', () => {
  assert.ok(receipt); assert.ok(mapping);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]),
    ['produccion_reconciliaciones', 'produccion_reconciliacion_videos']);
  assert.equal(sql.split(';').filter(statement => statement.trim()).length, 2);
  assert.doesNotMatch(sql.replace(/ON DELETE RESTRICT/g, ''), /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|SELECT|DO|GRANT|REVOKE|POLICY|TRIGGER|FUNCTION)\b/i);
  assert.match(source, /no automatic conversion or backfill/);
  assert.match(source, /without legacy editing children/);
});

test('receipt identity, actor/request idempotency and source/visit uniqueness are durable', () => {
  assert.match(receipt, /\bid UUID PRIMARY KEY/);
  assert.match(receipt, /actor_user_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(receipt, /request_id UUID NOT NULL/);
  assert.match(receipt, /UNIQUE \(actor_user_id, request_id\)/);
  assert.match(receipt, /tarea_origen_id INTEGER NOT NULL UNIQUE REFERENCES tareas\(id\) ON DELETE RESTRICT/);
  assert.match(receipt, /visita_id UUID NOT NULL UNIQUE REFERENCES produccion_visitas\(id\) ON DELETE RESTRICT/);
  assert.match(receipt, /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
});

test('only lowercase 64-character hashes and a positive source revision are recorded', () => {
  for (const key of ['payload_hash', 'source_history_hash']) {
    assert.ok(receipt.includes(`${key} CHAR(64) NOT NULL`));
    assert.ok(receipt.includes(`CHECK (${key} ~ '^[0-9a-f]{64}$')`));
  }
  assert.match(receipt, /source_revision INTEGER NOT NULL/);
  assert.match(receipt, /CHECK \(source_revision > 0\)/);
  assert.doesNotMatch(sql, /\bJSONB?\b|metadata|snapshot|payload\s+(?:TEXT|BYTEA)|source_history\s+(?:TEXT|BYTEA)|nombre|usuario\s+TEXT|finance|salario|abono/i);
});

test('each video belongs to only one immutable reconciliation with restricted references', () => {
  assert.match(mapping, /reconciliacion_id UUID NOT NULL REFERENCES produccion_reconciliaciones\(id\) ON DELETE RESTRICT/);
  assert.match(mapping, /video_id UUID NOT NULL UNIQUE REFERENCES produccion_videos\(id\) ON DELETE RESTRICT/);
  assert.match(mapping, /PRIMARY KEY \(reconciliacion_id, video_id\)/);
  assert.equal((sql.match(/ON DELETE RESTRICT/g) || []).length, 5);
  assert.doesNotMatch(sql, /CASCADE|SET NULL|SET DEFAULT/i);
  assert.match(source, /Application inserts once and never updates\/deletes/);
});

test('explicit input order uses a bounded nonnull smallint ordinal unique within reconciliation', () => {
  assert.match(mapping, /ordinal SMALLINT NOT NULL/);
  assert.match(mapping, /CHECK \(ordinal BETWEEN 1 AND 50\)/);
  assert.match(mapping, /UNIQUE \(reconciliacion_id, ordinal\)/);
  assert.doesNotMatch(mapping, /ordinal[^,]*DEFAULT/);
});

test('receipt and mapping have only the agreed fields with no stored sensitive bags or mutable lifecycle fields', () => {
  const lines = source.replace(/--[^\n]*/g, '').split('\n');
  const columns = lines.map(line => line.trim().match(/^(\w+)\s+(?:UUID|INTEGER|SMALLINT|CHAR\(64\)|TIMESTAMPTZ)(?=\s|,|$)/)?.[1]).filter(Boolean);
  assert.deepEqual(columns, ['id', 'actor_user_id', 'request_id', 'payload_hash', 'tarea_origen_id', 'source_revision',
    'source_history_hash', 'visita_id', 'created_at', 'reconciliacion_id', 'video_id', 'ordinal']);
  assert.doesNotMatch(sql, /updated_at|deleted_at|archivado|raw_|observaciones|guion|copy|material|aclaraciones/);
});

test('visit and video UUID references match the existing 059 registry without modifying its relationships', () => {
  const registry = readFileSync(new URL('../migrations/059_production_registry.sql', import.meta.url), 'utf8');
  assert.match(registry, /CREATE TABLE produccion_visitas \(\s*id UUID PRIMARY KEY/);
  assert.match(registry, /CREATE TABLE produccion_videos \(\s*id UUID PRIMARY KEY/);
  assert.match(registry, /tarea_origen_id INTEGER UNIQUE REFERENCES tareas\(id\) ON DELETE RESTRICT/);
  assert.match(registry, /tarea_edicion_id INTEGER UNIQUE REFERENCES tareas\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /ALTER TABLE|UPDATE produccion_|UPDATE tareas/);
});
