import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CLIENT_STRUCTURE_UPSERT_SQL } from '../src/client-structure.js';

const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../../frontend/src/pages/Historias.jsx", import.meta.url), "utf8");

test("la estructura semanal actualiza una celda existente", () => {
  assert.match(server, /res\.status\(201\)\.json\(await saveClientStructure\(pool, req\.auth, req\.body\)\)/);
  assert.match(CLIENT_STRUCTURE_UPSERT_SQL, /ON CONFLICT \(cliente_id, dia_semana\) DO UPDATE SET/);
  assert.match(CLIENT_STRUCTURE_UPSERT_SQL, /tema = EXCLUDED\.tema/);
});

test("Historias abre en estructura y oculta la planilla de la navegación", () => {
  assert.match(page, /initialTab = "estructura"/);
  assert.doesNotMatch(page, />Planificación<\/button>/);
  assert.match(page, />Checklist de historias<\/button>/);
  assert.match(page, />Fechas especiales<\/button>/);
});

test("la matriz semanal permite editar únicamente el tema", () => {
  assert.match(page, /aria-label={`\$\{cliente\.nombre\}, \$\{dia\.label\}`}/);
  assert.match(page, /guardarTema\(cliente\.id, dia\.id/);
  assert.doesNotMatch(page, /className="weekly-structure-time"/);
});
