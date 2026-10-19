import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readMigration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const original = readMigration("048_cliente_objetivos_mensuales.sql");
const forward = readMigration("055_decouple_goal_publication.sql");
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, "").trim();
const functionPattern = /CREATE OR REPLACE FUNCTION sincronizar_cliente_objetivo_tarea\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$[\s\S]*?END \$\$;/;
const originalFunction = original.match(functionPattern)?.[0];
const replacement = forward.match(functionPattern)?.[0];

test("055 replaces only the attached function; no historical DML or schema expansion executes", () => {
  assert.ok(originalFunction);
  assert.ok(replacement);
  assert.equal(withoutComments(forward), replacement);
  assert.doesNotMatch(replacement, /\b(?:ALTER|DROP|DELETE|TRUNCATE|EXECUTE|PERFORM)\b/i);
  assert.match(original, /CREATE TRIGGER cliente_objetivo_tarea_cambio[\s\S]*?EXECUTE FUNCTION sincronizar_cliente_objetivo_tarea\(\)/);
});

test("only the task-driven editorial state/date block is removed from the original function", () => {
  const coupling = /    IF pieza\.publicacion_id IS NOT NULL AND NEW\.estado IS DISTINCT FROM pieza\.estado\n[\s\S]*?    END IF;\n/;
  const removed = originalFunction.match(coupling)?.[0];
  assert.ok(removed, "baseline must contain the known publication coupling");
  assert.match(removed, /UPDATE publicaciones SET[\s\S]*estado = CASE[\s\S]*fecha_publicación_real = CASE/);
  assert.equal(replacement, originalFunction.replace(coupling, ""));
});

test("all editorial writes are strictly copy-only, independent of finish/reopen state", () => {
  const writes = [...replacement.matchAll(/UPDATE\s+(publicaciones|historias)\s+SET\s+([\s\S]*?);/gi)];
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], "publicaciones");
  assert.equal(writes[0][2].replace(/\s+/g, " ").trim(),
    "copy=COALESCE(NEW.propiedades_extra->>'copy_trabajo',''), updated_at=now() WHERE id=pieza.publicacion_id");
  assert.doesNotMatch(writes[0][0], /\bestado\b|fecha_publicación_real|NEW\.estado|OLD\.estado/);
  assert.doesNotMatch(replacement, /fecha_publicación_real/);
  assert.match(replacement, /IF pieza\.publicacion_id IS NOT NULL\s+AND NEW\.propiedades_extra->'copy_trabajo' IS DISTINCT FROM OLD\.propiedades_extra->'copy_trabajo' THEN\s+UPDATE publicaciones/);
  assert.deepEqual([...replacement.matchAll(/\b(?:UPDATE|INSERT INTO)\s+(\w+)\s*(?:SET|\()/g)].map((match) => match[1]),
    ["cliente_objetivo_piezas", "publicaciones", "cliente_objetivo_eventos"]);
});

test("goal completion/reopen, title, copy, responsible people and audit synchronization remain", () => {
  assert.match(replacement, /WHERE tarea_id = NEW\.id FOR UPDATE LOOP/);
  assert.match(replacement, /titulo = NEW\.titulo/);
  assert.match(replacement, /ELSE copy END/);
  assert.match(replacement, /jsonb_agg\(DISTINCT persona\)/);
  assert.match(replacement, /jsonb_build_array\(NEW\.asignado_a\)/);
  assert.match(replacement, /jsonb_typeof\(NEW\.propiedades_extra->'colaboradores'\) = 'array'/);
  assert.match(replacement, /estado = NEW\.estado/);
  assert.match(replacement, /completada_at = CASE WHEN NEW\.estado = 'publicada'\s+THEN COALESCE\(pieza\.completada_at, now\(\)\) ELSE NULL END/);
  assert.match(replacement, /IF pieza\.estado IS DISTINCT FROM NEW\.estado THEN\s+INSERT INTO cliente_objetivo_eventos/);
  assert.match(replacement, /VALUES\(pieza\.id, pieza\.estado, NEW\.estado, NEW\.id\)/);
  assert.match(replacement, /RETURN NEW;/);
});
