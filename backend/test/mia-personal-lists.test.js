import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { nextReminderDate, resolveListItem } from "../src/mia-personal-lists.js";

const migration = readFileSync(new URL("../migrations/042_mia_listas_personales.sql", import.meta.url), "utf8");
const integration = readFileSync(new URL("../src/wilson-integration.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../scripts/mia_render_os_task.py", import.meta.url), "utf8");

const rows = [{
  id: 7, lista_id: 2, lista_titulo: "Semana", version: 4,
  contenido: { titulo: "Lunes", items: [
    { id: "uno", texto: "Terminar carrusel de Búnker", completado: false },
    { id: "dos", texto: "Terminar carrusel de Bendita", completado: false },
  ] },
}];

test("Mía resuelve un pendiente exacto y no adivina coincidencias ambiguas", () => {
  assert.equal(resolveListItem("Búnker", rows).status, "resolved");
  assert.equal(resolveListItem("terminar carrusel", rows).status, "ambiguous");
  assert.equal(resolveListItem("presupuesto", rows).status, "not_found");
});

test("los recordatorios calculan recurrencias sin repetir fines de semana", () => {
  assert.equal(nextReminderDate("2026-10-02T11:00:00.000Z", "dias_habiles").toISOString(), "2026-10-05T11:00:00.000Z");
  assert.equal(nextReminderDate("2026-10-02T11:00:00.000Z", "semanal").toISOString(), "2026-10-09T11:00:00.000Z");
  assert.equal(nextReminderDate("2026-10-02T11:00:00.000Z", "una_vez"), null);
});

test("la identidad se vincula por hash y las propuestas no tienen vencimiento", () => {
  assert.match(migration, /whatsapp_id_hash CHAR\(64\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mia_lista_propuestas/);
  assert.doesNotMatch(migration, /mia_lista_propuestas[\s\S]*expires_at/);
  assert.match(integration, /unlinked_whatsapp/);
  assert.match(integration, /alertUnlinkedWhatsapp/);
});

test("el cliente firmado expone consulta, propuesta y confirmación de Lista", () => {
  assert.match(client, /commands\.add_parser\("personal-list"\)/);
  assert.match(client, /commands\.add_parser\("propose-list"\)/);
  assert.match(client, /commands\.add_parser\("confirm-list"\)/);
});
