import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source contracts only. The populated registry integration fixture applies the
// actual SQL separately; this suite never starts PostgreSQL or a service.
const source = readFileSync(new URL('../migrations/070_production_editing_adoptions.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

test('070 creates only an additive closed adoption table without backfill or history rewrites', () => {
  assert.match(sql, /^CREATE TABLE produccion_edicion_adopciones \(/);
  assert.equal(sql.split(';').filter(statement => statement.trim()).length, 1);
  const body = sql.replace(/ON DELETE RESTRICT/g, '');
  assert.doesNotMatch(body, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|SELECT|TRIGGER|GRANT|POLICY)\b/i);
  assert.doesNotMatch(sql, /JSONB?|metadata|snapshot|payload|nombre|guion|material|updated_at|deleted_at/i);
  assert.match(source, /Application inserts once and never updates\/deletes/);
});

test('reconciliation primary key and unique video/task references enforce one-to-one adoption with restrictive FKs', () => {
  assert.match(sql, /reconciliacion_id UUID PRIMARY KEY REFERENCES produccion_reconciliaciones\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /video_id UUID NOT NULL UNIQUE REFERENCES produccion_videos\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /tarea_edicion_id INTEGER NOT NULL UNIQUE REFERENCES tareas\(id\) ON DELETE RESTRICT/);
  assert.equal((sql.match(/ON DELETE RESTRICT/g) || []).length, 4);
  assert.match(sql,/FOREIGN KEY \(reconciliacion_id, video_id\) REFERENCES produccion_reconciliacion_videos\(reconciliacion_id, video_id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /CASCADE|SET NULL/);
  // PK/UNIQUE indexes cover all three foreign-key columns; no redundant index.
  assert.doesNotMatch(sql, /CREATE INDEX/);
});

test('captured task revision is required positive integer and creation timestamp defaults now', () => {
  assert.match(sql, /task_revision INTEGER NOT NULL CHECK \(task_revision > 0\)/);
  assert.match(sql, /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  const lines = source.replace(/--[^\n]*/g, '').split('\n');
  const columns = lines.map(line => line.trim().match(/^(\w+)\s+(?:UUID|INTEGER|TIMESTAMPTZ)\b/)?.[1]).filter(Boolean);
  assert.deepEqual(columns, ['reconciliacion_id', 'video_id', 'tarea_edicion_id', 'task_revision', 'created_at']);
});

test('fixture defers dependent 070 together with 069 when production registry 059 is deferred', () => {
  const harness = readFileSync(new URL('../scripts/render2-local-test.js', import.meta.url), 'utf8');
  assert.match(harness, /process\.env\.RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION === 'true' \? \['069_production_reconciliation\.sql', '070_production_editing_adoptions\.sql'\] : \[\]/);
  assert.match(harness, /process\.env\.RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION === 'true' \? \['059_production_registry\.sql'\]/);
});

test('populated integration applies real 070 after real 069 before adoption ledger entry and asserts unchanged history', () => {
  const integration = readFileSync(new URL('./render2-production-registry.integration.test.js', import.meta.url), 'utf8');
  const install069 = integration.indexOf("readFile(new URL('../migrations/069_production_reconciliation.sql'");
  const install070 = integration.indexOf("readFile(new URL('../migrations/070_production_editing_adoptions.sql'");
  const ledger070 = integration.indexOf("INSERT INTO _migrations(nombre) VALUES ('070_production_editing_adoptions.sql')");
  assert.ok(install069 >= 0 && install070 > install069 && ledger070 > install070);
  assert.match(integration, /assert\.deepEqual\(await history\(\), beforeAdoptions/);
  assert.match(integration, /SELECT count\(\*\)::int AS count FROM produccion_edicion_adopciones/);
});
