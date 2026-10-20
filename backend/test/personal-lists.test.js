import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePersonalListEmoji, normalizePersonalListText, personalRecordId, nestPersonalLists } from "../src/personal-lists.js";
import { normalizeBlockContent, normalizeBlocks } from "../src/personal-list-blocks.js";
import { getNavigationGroups } from "../../frontend/src/components/navigation.js";

const migration = readFileSync(new URL("../migrations/040_listas_personales.sql", import.meta.url), "utf8");
const blocksMigration = readFileSync(new URL("../migrations/041_listas_bloques_personalizables.sql", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../src/personal-lists.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../frontend/src/pages/PersonalLists.jsx", import.meta.url), "utf8");

test('personal BIGINT record identities remain exact and nested records never bleed between adjacent IDs',()=>{
  for(const id of ['1','9007199254740992','9007199254740993','9223372036854775807'])assert.equal(personalRecordId(id),id);
  assert.equal(personalRecordId(1),'1');
  for(const id of [0,-1,1.5,9007199254740992,'01','-1','9223372036854775808',null])assert.throws(()=>personalRecordId(id));
  const a='9007199254740992',b='9007199254740993';
  const rows=nestPersonalLists([{id:a},{id:b}],[],[],[{id:'1',lista_id:a},{id:'2',lista_id:b}]);
  assert.deepEqual(rows.map(row=>row.bloques.map(block=>block.id)),[['1'],['2']]);
});

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

test("los bloques personalizables conservan privacidad y migran checklists anteriores", () => {
  assert.match(blocksMigration, /CREATE TABLE IF NOT EXISTS lista_bloques/);
  assert.match(blocksMigration, /CREATE TABLE IF NOT EXISTS lista_plantillas_personales/);
  assert.match(blocksMigration, /usuario_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE CASCADE/);
  assert.match(blocksMigration, /INSERT INTO lista_bloques[\s\S]*FROM lista_secciones/);
  assert.match(routerSource, /FROM lista_plantillas_personales WHERE usuario_id=\$1/);
  assert.match(routerSource, /JOIN listas_personales l ON l\.id=b\.lista_id/);
});

test("tablas, listados y checklists se validan antes de persistir", () => {
  const table = normalizeBlockContent("tabla", {
    titulo: "Semana",
    columnas: [{ id: "lunes", titulo: "Lunes" }],
    filas: [{ id: "fila-1", celdas: { lunes: { texto: "Publicar", completado: true } } }],
  });
  assert.equal(table.columnas[0].titulo, "Lunes");
  assert.equal(table.filas[0].celdas.lunes.completado, true);
  assert.deepEqual(normalizeBlockContent("checklist", { titulo: "Hoy", items: [] }).items, []);
  assert.throws(() => normalizeBlocks(Array.from({ length: 81 }, () => ({ tipo: "texto", contenido: { texto: "x" } }))), /más de 80 bloques/);
  assert.throws(() => normalizeBlockContent("tabla", { columnas: [], filas: [] }), /entre 1 y 14 columnas/);
});

test("Lista está disponible para todos y ofrece editor por bloques y plantillas", () => {
  assert.match(appSource, /"\/lista"/);
  assert.match(appSource, /<PersonalListsPage/);
  assert.match(sidebarSource, /getNavigationGroups/);
  for (const role of ["admin", "diseno", "edicion", "produccion", "community", "programacion"]) {
    const groups = getNavigationGroups(role);
    const personal = groups.find(group => group.id === "personal");
    assert.ok(personal, `Grupo personal para ${role}`);
    const list = personal.links.filter(link => link.href === "/lista");
    assert.equal(list.length, 1);
    assert.ok(["Lista", "Mi lista"].includes(list[0].label));
    assert.equal(groups.flatMap(group => group.links).filter(link => link.href === "/lista").length, 1);
  }
  assert.match(pageSource, /type="checkbox"/);
  assert.match(pageSource, /Agregar bloque/);
  assert.match(pageSource, /Guardar como plantilla/);
  assert.match(pageSource, /Lunes.*Martes.*Miércoles/);
  assert.match(pageSource, /Los cambios se guardan automáticamente; revisá el estado antes de salir/);
  assert.match(pageSource, /useNavigationGuard/);
  assert.match(pageSource, /queue.current\?\.snapshot\(\).dirty/);
  assert.match(pageSource, /solo vos podés verlo/);
  assert.match(pageSource, /personal-list-rail-toggle/);
  assert.match(pageSource, /personal-table-navigator/);
  assert.match(pageSource, /scrollToColumn/);
});
