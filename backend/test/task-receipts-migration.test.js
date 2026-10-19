import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pure schema contract checks only: PostgreSQL constraint behavior, populated
// upgrade invariance and transactional races belong to guarded independent QA.
const source = readFileSync(new URL('../migrations/062_task_operation_receipts.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

test('062 only defines an empty receipt table without historical DML or promotion', () => {
  assert.match(sql, /^CREATE TABLE task_operation_receipts \(/);
  assert.equal((sql.match(/;/g) || []).length, 1);
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE \w+ SET|DELETE FROM|TRUNCATE|DROP|ALTER|SELECT|FUNCTION|TRIGGER)\b/i);
});

test('stable positive actor FK is restrictive and operation/key scope is unique', () => {
  assert.match(sql, /id BIGSERIAL PRIMARY KEY/);
  assert.match(sql, /actor_user_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /CHECK \(actor_user_id > 0\)/);
  assert.match(sql, /operation TEXT NOT NULL/);
  assert.match(sql, /operation IN \('crear', 'editar', 'archivar', 'eliminar'\)/);
  assert.match(sql, /UNIQUE \(actor_user_id, operation, idempotency_key\)/);
});

test('key rejects oversized, untrimmed or control-bearing input; hash is lowercase SHA256', () => {
  assert.match(sql, /idempotency_key TEXT NOT NULL/);
  assert.match(sql, /char_length\(idempotency_key\) BETWEEN 1 AND 200/);
  assert.match(sql, /idempotency_key = btrim\(idempotency_key\)/);
  assert.ok(sql.includes("idempotency_key !~ '[[:cntrl:]]'"));
  assert.match(sql, /payload_hash TEXT NOT NULL/);
  assert.ok(sql.includes("char_length(payload_hash) = 64 AND payload_hash ~ '^[0-9a-f]{64}$'"));
  assert.doesNotMatch(sql, /\b(?:left|substr|substring)\s*\(/i);
});

test('positive task identity/revision survives task purge without a task FK', () => {
  assert.match(sql, /task_id BIGINT NOT NULL,/);
  assert.match(sql, /CHECK \(task_id > 0\)/);
  assert.match(sql, /task_revision INTEGER NOT NULL/);
  assert.match(sql, /CHECK \(task_revision > 0\)/);
  assert.match(sql, /committed_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.equal((sql.match(/REFERENCES /g) || []).length, 1);
  assert.doesNotMatch(sql, /REFERENCES tareas|ON DELETE (?:CASCADE|SET NULL)/i);
});

test('closed outcomes match operation and durable no-op preserves an empty diff', () => {
  assert.match(sql, /outcome TEXT NOT NULL/);
  assert.match(sql, /outcome IN \('created', 'updated', 'unchanged', 'archived', 'deleted'\)/);
  for (const pair of ["operation = 'crear' AND outcome = 'created'", "operation = 'editar' AND outcome IN ('updated', 'unchanged')",
    "operation = 'archivar' AND outcome = 'archived'", "operation = 'eliminar' AND outcome = 'deleted'"])
    assert.ok(sql.includes(pair));
  assert.match(sql, /outcome <> 'unchanged' OR cardinality\(changed_fields\) = 0/);
});

test('changed_fields is a closed scalar vocabulary including normalized assignments', () => {
  assert.match(sql, /changed_fields TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\]/);
  const vocabulary = sql.match(/changed_fields <@ ARRAY\[([^\]]+)\]::TEXT\[\]/)?.[1];
  assert.ok(vocabulary);
  assert.deepEqual([...vocabulary.matchAll(/'([^']+)'/g)].map(match => match[1]), [
    'titulo', 'asignado_a', 'colaboradores', 'cliente_id', 'fecha_vencimiento', 'tipo_tarea', 'subtipo',
    'prioridad', 'aclaraciones', 'material_referencia', 'referencia', 'produccion_videos_previstos',
    'asignado_a_id', 'colaborador_ids']);
  assert.match(sql, /CASE WHEN cardinality\(changed_fields\) = 0 THEN TRUE WHEN array_ndims\(changed_fields\) = 1 THEN array_position\(changed_fields, NULL\) IS NULL ELSE FALSE END/);
});

test('minimal receipt contains no names, content, ACL snapshots, tokens or retention machinery', () => {
  const columns = [...sql.matchAll(/(?:\( |, )(\w+) (?:BIGSERIAL|INTEGER|TEXT|BIGINT|TIMESTAMPTZ)\b/g)].map(match => match[1]);
  assert.deepEqual(columns, ['id', 'actor_user_id', 'operation', 'idempotency_key', 'payload_hash',
    'task_id', 'task_revision', 'outcome', 'changed_fields', 'committed_at']);
  assert.doesNotMatch(sql, /\b(?:JSONB?|BYTEA|expires_at|confirmation_token|actor_name|snapshot|mutated|resulting_revision)\b/i);
});
