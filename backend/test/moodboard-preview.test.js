import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getNavigationGroups } from "../../frontend/src/components/navigation.js";
import { canonicalLegacyRoute } from "../../frontend/src/shared/navigation/legacy-routes.js";

const app = fs.readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../../frontend/src/pages/MoodboardPreview.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../../frontend/src/pages/MoodboardPreview.css", import.meta.url), "utf8");
const sidebar = fs.readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../src/moodboards.js", import.meta.url), "utf8");

test("el moodboard retirado no se importa ni monta; su implementación histórica se conserva", () => {
  assert.doesNotMatch(app, /path === "\/moodboards"/);
  assert.doesNotMatch(app, /import\("\.\/pages\/MoodboardPreview\.jsx"\)/);
  assert.doesNotMatch(app, /<MoodboardPreviewPage\b/);
  assert.match(page, /Nueva referencia/);
  assert.match(page, /Aprobadas/);
  assert.match(page, /Descartadas/);
  assert.match(page, /Pegar enlace/);
  assert.doesNotMatch(page, /Memoria visual compartida|moodboard-rail-tip/);
});

test("el moodboard contempla clientes compartidos, tareas y límites de archivo", () => {
  assert.match(page, /cuentas compartidas/);
  assert.match(page, /Vinculada a tareas/);
  assert.match(page, /10\s*\*\s*1024\s*\*\s*1024/);
  assert.ok(page.includes("/^image\\/(jpeg|png)$/.test(f.type)"));
});

test("la galería tipo Pinterest se adapta a móvil y movimiento reducido", () => {
  assert.match(styles, /columns:4 235px/);
  assert.match(styles, /@media\(max-width:980px\)/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});

test("el componente histórico conserva el scroll separado sin recuperar un montaje canónico", () => {
  assert.doesNotMatch(app, /if \(path === "\/moodboards"\) \{\s*return loadedDashboard/);
  assert.doesNotMatch(page, /Volver a tareas|moodboard-back/);
  assert.match(styles, /\.moodboard-preview-shell\{[^}]*overflow:hidden/);
  assert.match(styles, /\.moodboard-brand-rail nav\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.moodboard-workspace\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.moodboard-header\{[^}]*position:sticky/);
});

test("el formulario nuevo se centra en la galería sin cubrir los dos menús", () => {
  assert.match(styles, /\.moodboard-compose-layer\{[^}]*left:534px/);
  assert.match(styles, /\.moodboard-compose-layer\{[^}]*justify-content:center/);
  assert.match(styles, /@media\(max-width:980px\)[\s\S]*?\.moodboard-compose-layer\{[^}]*inset:64px 0 0/);
});

test("las imágenes quedan fuera de la carpeta versionada de Hostinger", () => {
  assert.match(backend, /hbuilds/);
  assert.match(backend, /MOODBOARD_UPLOAD_DIR/);
  assert.match(backend, /storage.*moodboards/);
});

test("el menú principal retira Moodboards y Drive para todos los roles sin quitar seguimiento", () => {
  assert.match(sidebar, /getNavigationGroups/);
  for (const role of ["admin", "diseno", "edicion", "produccion", "community", "programacion"]) {
    const groups = getNavigationGroups(role);
    const resources = groups.find(group => group.id === "resources");
    assert.ok(resources, `Grupo de recursos para ${role}`);
    assert.ok(resources.links.some(link => link.href === "/reportes-historias"));
    assert.equal(groups.flatMap(group => group.links).some(link => ["/moodboards", "/drive"].includes(link.href)), false);
  }
});

test("los marcadores retirados conservan solo contexto válido de tarea mediante el alias actual", () => {
  for (const path of ["/moodboards", "/drive"]) {
    assert.equal(canonicalLegacyRoute(path), "/inicio");
    assert.equal(canonicalLegacyRoute(`${path}?cliente=7&task=19#detail`), "/workspace/tareas?task=19");
    for (const query of ["task=1&task=2", "task=0", "task=javascript:alert(1)"]) {
      assert.equal(canonicalLegacyRoute(`${path}?${query}`), "/inicio");
    }
    assert.equal(canonicalLegacyRoute(`${path}/unknown`), null);
  }
});

test("el retiro de UI conserva los routers y storage originales sin convertirlo en borrado de datos", () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /router\.use\("\/moodboards", createMoodboardsRouter\(\{ pool \}\)\)/);
  assert.match(server, /router\.use\("\/drive", createGoogleDrivePublicRouter/);
  assert.match(server, /router\.use\("\/drive", createGoogleDriveRouter\(\{ express, pool, requireRole \}\)\)/);
  assert.match(backend, /router\.get\("\/assets\/:filename"/);
  assert.match(backend, /router\.post\("\/boards\/:id\/references"/);
});
