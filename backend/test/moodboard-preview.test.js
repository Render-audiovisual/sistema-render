import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../../frontend/src/pages/MoodboardPreview.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../../frontend/src/pages/MoodboardPreview.css", import.meta.url), "utf8");
const sidebar = fs.readFileSync(new URL("../../frontend/src/components/Sidebar.jsx", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../src/moodboards.js", import.meta.url), "utf8");

test("el moodboard productivo queda disponible para todo el equipo", () => {
  assert.match(app, /path === "\/moodboards"/);
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
  assert.ok(page.includes("/image\\/(jpeg|png)/"));
});

test("la galería tipo Pinterest se adapta a móvil y movimiento reducido", () => {
  assert.match(styles, /columns:4 235px/);
  assert.match(styles, /@media\(max-width:980px\)/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});

test("el moodboard conserva el menú principal y separa el scroll de clientes y galería", () => {
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

test("el menú principal muestra Moodboard inmediatamente después de Lista", () => {
  assert.match(sidebar, /href: "\/lista", label: "Lista"[\s\S]*?href: "\/moodboards", label: "Moodboard"/);
});
