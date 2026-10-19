import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pure DDL contract checks; these do not execute PostgreSQL or prove races/FKs.
const source = readFileSync(new URL('../migrations/061_feedback_operation_receipts.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

test('061 installs additive definitions without rewriting or promoting history', () => {
  assert.match(sql, /^CREATE TABLE feedback_operation_receipts \(/);
  const installation = sql.replace(/CREATE FUNCTION[\s\S]*?END \$\$;/g, '');
  assert.equal((installation.match(/;/g) || []).length, 2);
  assert.doesNotMatch(installation, /\b(?:INSERT INTO|UPDATE \w+ SET|DELETE FROM|TRUNCATE|DROP|ALTER|SELECT)\b/i);
});

test('all future note updates strictly advance the browser-visible millisecond CAS version', () => {
  assert.match(sql, /CREATE FUNCTION feedback_notes_monotonic_version\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$/);
  assert.match(sql, /NEW.updated_at = GREATEST\( date_trunc\('milliseconds', clock_timestamp\(\)\), date_trunc\('milliseconds', OLD.updated_at\) \+ interval '1 millisecond' \); RETURN NEW;/);
  assert.match(sql, /CREATE TRIGGER feedback_notes_monotonic_version BEFORE UPDATE ON notas_compartidas FOR EACH ROW EXECUTE FUNCTION feedback_notes_monotonic_version\(\)/);
  assert.doesNotMatch(sql, /BEFORE UPDATE OF|WHEN\s*\(/i);
});

test('receipt identity is scoped uniquely to a durable positive user ID, operation and key', () => {
  assert.match(sql, /id BIGSERIAL PRIMARY KEY/);
  assert.match(sql, /actor_user_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /CHECK \(actor_user_id > 0\)/);
  assert.match(sql, /operation TEXT NOT NULL/);
  assert.match(sql, /operation IN \('crear_feedback', 'editar_feedback'\)/);
  assert.match(sql, /UNIQUE \(actor_user_id, operation, idempotency_key\)/);
});

test('keys are bounded and canonical, hashes are required lowercase SHA256', () => {
  assert.match(sql, /idempotency_key TEXT NOT NULL/);
  assert.match(sql, /char_length\(idempotency_key\) BETWEEN 1 AND 200/);
  assert.match(sql, /idempotency_key = btrim\(idempotency_key\)/);
  assert.match(sql, /payload_hash TEXT NOT NULL/);
  assert.ok(sql.includes("char_length(payload_hash) = 64 AND payload_hash ~ '^[0-9a-f]{64}$'"));
  assert.doesNotMatch(sql, /\b(?:left|substring|substr)\s*\(/i);
});

test('receipt survives note purge and retains required immutable result timestamps', () => {
  assert.match(sql, /note_id BIGINT NOT NULL,/);
  assert.match(sql, /CHECK \(note_id > 0\)/);
  assert.match(sql, /note_updated_at TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /committed_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.doesNotMatch(sql, /REFERENCES notas_compartidas|ON DELETE (?:CASCADE|SET NULL)/i);
  assert.equal((sql.match(/REFERENCES /g) || []).length, 1);
});

test('storage has only explicit minimal receipt fields and no expiry or open snapshots', () => {
  const columns = [...sql.matchAll(/(?:\( |, )(\w+) (?:BIGSERIAL|INTEGER|TEXT|BIGINT|TIMESTAMPTZ)\b/g)].map(match => match[1]);
  assert.deepEqual(columns, ['id', 'actor_user_id', 'operation', 'idempotency_key',
    'payload_hash', 'note_id', 'note_updated_at', 'committed_at']);
  assert.doesNotMatch(sql, /\b(?:JSONB?|BYTEA|expires_at|confirmation_token|contenido|titulo|feedback)\b/i);
});
