import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePersonalListEmoji, normalizePersonalListText } from "../src/personal-lists.js";

const migration = readFileSync(new URL("../migrations/040_listas_personales.sql", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../src/personal-lists.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../frontend/src/pages/PersonalLists.jsx", import.meta.url), "utf8");

test("las listas personales tienen estructura privada y borrado en cascada", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS listas_personales/);
  assert.match(migration, /usuario_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE CASCADE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lista_secciones/);
  assert.match(migration, /lista_id BIGINT NOT NULL REFERENCES listas_personales\(id\) ON DELETE CASCADE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lista_items/);
  assert.match(migration, /seccion_id BIGINT NOT NULL REFERENCES lista_secciones\(id\) ON DELETE CASCADE/);
});

test("la API deriva el propietario de la sesión y verifica pertenencia en cada nivel", () => {
  assert.match(routerSource, /Number\(req\.auth\.id\)/);
  assert.match(routerSource, /WHERE usuario_id=\$1/);
  assert.match(routerSource, /JOIN listas_personales l ON l\.id=s\.lista_id/);
  assert.match(routerSource, /l\.usuario_id=\$[234]/);
  assert.doesNotMatch(routerSource, /req\.body\?\.usuario_id/);
});

test("los títulos, pendientes y emojis se limpian y validan", () => {
  assert.equal(normalizePersonalListText("  Comprar   insumos  "), "Comprar insumos");
  assert.equal(normalizePersonalListEmoji(" ✅ "), "✅");
  assert.throws(() => normalizePersonalListText("   "), /no puede quedar vacío/);
  assert.throws(() => normalizePersonalListText("x".repeat(501)), /demasiado largo/);
});

test("Lista está disponible para todos los usuarios y conserva la interacción tipo checklist", () => {
  assert.match(appSource, /"\/lista"/);
  assert.match(appSource, /<PersonalListsPage/);
  assert.match(sidebarSource, /href: "\/lista", label: "Lista"/);
  assert.match(pageSource, /type="checkbox"/);
  assert.match(pageSource, /Nueva sección/);
  assert.match(pageSource, /Todo se guarda automáticamente/);
  assert.match(pageSource, /Solo vos podés ver este espacio/);
});
