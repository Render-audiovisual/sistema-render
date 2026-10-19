import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Definition/equivalence checks only: actual UPDATE, populated invariance,
// delivery/approval races and rollback remain coordinated PostgreSQL QA.
const read = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const source = read('066_task_editing_approval.sql');
const compact = value => value.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const sql = compact(source);
const previous = compact(read('058_task_work_states.sql').match(/CREATE OR REPLACE FUNCTION invalidar_aprobacion_tarea_modificada\(\)[\s\S]*?END \$\$;/)?.[0] ?? '');

test('066 replaces only the existing invalidation function, retaining the installed 058 trigger and all history', () => {
  assert.match(sql, /^CREATE OR REPLACE FUNCTION invalidar_aprobacion_tarea_modificada\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.equal(sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*END \$\$;/, '').trim(), '');
  assert.doesNotMatch(sql, /\b(?:ALTER TABLE|CREATE TABLE|CREATE TRIGGER|DROP|INSERT INTO|UPDATE \w+ SET|DELETE FROM|TRUNCATE)\b/i);
  assert.match(read('058_task_work_states.sql'), /CREATE TRIGGER tareas_invalidar_aprobacion BEFORE UPDATE ON tareas\s+FOR EACH ROW EXECUTE FUNCTION invalidar_aprobacion_tarea_modificada\(\)/);
});

test('outside the three prospective bound-approval deltas, the complete function is exactly 058 business semantics', () => {
  assert.ok(previous);
  const withoutDelta = sql.replace(
    "IF contenido_cambio AND (OLD.estado = 'aprobada' OR (OLD.estado IN ('finalizada','publicada') AND OLD.propiedades_extra->>'revision_aprobada_entrega_id' IS NOT NULL)) THEN",
    "IF contenido_cambio AND OLD.estado = 'aprobada' THEN",
  ).replace("'revision_aprobada_entrega_id', NULL, ", '')
    .replace(" OR (OLD.propiedades_extra->>'revision_aprobada_entrega_id' IS NOT NULL AND NEW.propiedades_extra->'guiones' IS DISTINCT FROM OLD.propiedades_extra->'guiones')", '');
  assert.equal(withoutDelta, previous);
});

test('only actual content changes reopen bound final aliases, using SQL nonnull rather than JSON null presence', () => {
  assert.match(sql, /contenido_cambio := NEW.aclaraciones IS DISTINCT FROM OLD.aclaraciones OR NEW.material_referencia IS DISTINCT FROM OLD.material_referencia OR NEW.propiedades_extra->'copy_trabajo' IS DISTINCT FROM OLD.propiedades_extra->'copy_trabajo'/);
  assert.match(sql, /IF contenido_cambio AND \(OLD.estado = 'aprobada' OR \(OLD.estado IN \('finalizada','publicada'\) AND OLD.propiedades_extra->>'revision_aprobada_entrega_id' IS NOT NULL\)\) THEN NEW.estado := 'en_revision'; END IF;/);
  assert.doesNotMatch(sql, /propiedades_extra\s*\?\s*'revision_aprobada_entrega_id'|->'revision_aprobada_entrega_id' IS NOT NULL/);
  assert.equal((sql.match(/NEW.estado :=/g) || []).length, 1);
  assert.match(sql, /OLD.propiedades_extra->>'revision_aprobada_entrega_id' IS NOT NULL AND NEW.propiedades_extra->'guiones' IS DISTINCT FROM OLD.propiedades_extra->'guiones'/);
});

test('every previous full approval/finalization clear also clears the concrete delivery binding', () => {
  const clearing = sql.match(/NEW.propiedades_extra := NEW.propiedades_extra \|\| jsonb_build_object\((.*?)\);/)?.[1];
  assert.ok(clearing);
  assert.equal((sql.match(/NEW.propiedades_extra :=/g) || []).length, 1);
  assert.deepEqual([...clearing.matchAll(/'([^']+)', (false|NULL)/g)].map(match => [match[1], match[2]]), [
    ['revision_aprobada', 'false'], ['revision_aprobada_por', 'NULL'], ['revision_aprobada_por_id', 'NULL'],
    ['revision_aprobada_at', 'NULL'], ['revision_aprobada_entrega_id', 'NULL'], ['finalizada_at', 'NULL'],
  ]);
  assert.match(sql, /NEW.estado IN \('pendiente','en_progreso','en_revision'\) AND \(NEW.estado IS DISTINCT FROM OLD.estado OR NEW.propiedades_extra->'revision_aprobada' IS DISTINCT FROM OLD.propiedades_extra->'revision_aprobada'\)/);
  assert.ok(sql.indexOf("NEW.estado := 'en_revision'") < sql.indexOf("NEW.estado IN ('pendiente','en_progreso','en_revision')"),
    'bound final reopening reaches the full clearing branch even if prior flag is absent/false');
});

test('approval remains prospective and cannot manufacture an artifact, publication or changed operational fields', () => {
  assert.doesNotMatch(sql, /\bSELECT\b|FOR UPDATE|FOR SHARE|pg_advisory|task_editing_deliveries|publicaciones|historias|cliente_objetivo/);
  assert.doesNotMatch(sql, /NEW\.(?:asignado_a|fecha_vencimiento|material_referencia|aclaraciones|revision)\s*:=/);
  assert.doesNotMatch(sql, /'revision_aprobada', true|jsonb_build_object\([^;]*'revision_aprobada_entrega_id', (?!NULL)/);
  assert.match(sql, /RETURN NEW; END \$\$;$/);
});
