import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../../frontend/src/App.jsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../../frontend/src/pages/MoodboardPreview.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../../frontend/src/pages/MoodboardPreview.css", import.meta.url), "utf8");

test("el moodboard productivo queda disponible para todo el equipo", () => {
  assert.match(app, /path === "\/moodboards"/);
  assert.match(page, /Nueva referencia/);
  assert.match(page, /Aprobadas/);
  assert.match(page, /Descartadas/);
  assert.match(page, /Pegar enlace/);
});

test("el moodboard contempla clientes compartidos, tareas y límites de archivo", () => {
  assert.match(page, /cuentas compartidas/);
  assert.match(page, /Vinculada a tareas/);
  assert.match(page, /10\s*\*\s*1024\s*\*\s*1024/);
  assert.ok(page.includes("/image\\/(jpeg|png)/"));
});

test("la galería tipo Pinterest se adapta a móvil y movimiento reducido", () => {
  assert.match(styles, /columns:4 235px/);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});
