import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/wilson-integration.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/017_integracion_auditoria.sql", import.meta.url), "utf8");

test("Mia consulta exclusivamente tareas activas de RENDER OS", () => {
  assert.match(source, /router\.get\("\/tareas"/);
  assert.match(source, /propiedades_extra->>'workspace'='render_os'/);
  assert.match(source, /archivada_render_os' IS DISTINCT FROM 'true'/);
});

test("crear y editar desde Mia dejan auditoría privada, no comentarios visibles", () => {
  const start = source.indexOf('async function executeTaskReceiptOperation(');
  const end = source.indexOf('  router.post("/tareas",', start);
  assert.ok(start >= 0 && end > start);
  const mutator = source.slice(start, end);
  assert.match(mutator, /await writeWilsonAudit\(client,req,\{action:\{crear:'crear_tarea',editar:'editar_tarea',archivar:'archivar_tarea',eliminar:'eliminar_tarea'\}\[operation\]/);
  assert.match(mutator, /taskId:task.id,details:\{outcome,changed_fields:changedFields\}/);
  assert.ok(mutator.indexOf('await writeWilsonAudit(') < mutator.indexOf('await insertTaskOperationReceipt('));
  assert.ok(mutator.indexOf("await client.query('COMMIT')", mutator.indexOf('await insertTaskOperationReceipt(')) > mutator.indexOf('await insertTaskOperationReceipt('));
  assert.doesNotMatch(mutator, /INSERT INTO tarea_comentarios/);
  assert.doesNotMatch(source, /Creó esta tarea desde Telegram/);
  assert.doesNotMatch(source, /Actualizó esta tarea desde Telegram/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS integracion_auditoria/);
});

test("Mia archiva solo RENDER OS y elimina definitivamente solo desde Papelera", () => {
  assert.match(source, /router\.post\("\/tareas\/:id\/archivar"/);
  assert.match(source, /router\.delete\("\/tareas\/:id"/);
  assert.match(source, /operation==='eliminar'&&wilson.actorRole!=='admin'/);
  assert.match(source, /task.propiedades_extra\?\.workspace!=='render_os'\|\|privateCurrentTaskError\(req,null,task\)/);
  assert.match(source, /taskOperationHidden=task=>\['archivada_render_os','papelera_render_os'\]\.some\(key=>\[true,'true'\]\.includes\(task.propiedades_extra\?\.\[key\]\)\)/);
  assert.match(source, /if\(intent.operation==='eliminar'\?!taskOperationHidden\(task\):taskOperationHidden\(task\)\)throw taskOperationError/);
  assert.match(source, /await client.query\('DELETE FROM tareas WHERE id=\$1 AND revision=\$2',\[current.id,intent.expected_revision\]\)/);
});

test("Mia reserva los resúmenes de forma atómica antes de enviarlos", () => {
  assert.match(source, /const claimed = \[\]/);
  assert.match(source, /ON CONFLICT\(fingerprint\) DO UPDATE/);
  assert.match(source, /status'='sending'/);
  assert.match(source, /if \(reservation\.rows\[0\]\) claimed\.push\(digest\)/);
  assert.match(source, /status: "delivered"/);
});
