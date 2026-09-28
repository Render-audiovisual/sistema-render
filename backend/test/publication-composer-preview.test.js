import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composerSource = readFileSync(
  new URL("../../frontend/src/components/PublicationComposer.jsx", import.meta.url),
  "utf8",
);
const publicationsSource = readFileSync(
  new URL("../../frontend/src/pages/Publicaciones.jsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../../frontend/src/App.jsx", import.meta.url),
  "utf8",
);

test("el prototipo de publicación nunca llama a Meta ni modifica datos reales", () => {
  assert.match(composerSource, /Ningún botón publica contenido real/);
  assert.match(composerSource, /apiRequest\("\/api\/publicacion-envios"/);
  assert.match(composerSource, /window\.localStorage\.setItem/);
  assert.doesNotMatch(composerSource, /fetch\(/);
  assert.doesNotMatch(composerSource, /graph\.facebook\.com|graph\.instagram\.com/);
});

test("Publicaciones ofrece preparación, programación e historial separados", () => {
  assert.match(publicationsSource, /id: "preparar", label: "Preparar"/);
  assert.match(publicationsSource, /id: "programadas", label: "Programadas"/);
  assert.match(publicationsSource, /id: "historial", label: "Historial"/);
  assert.match(publicationsSource, /<PublicationComposer/);
  assert.match(publicationsSource, /\["admin", "community"\]\.includes/);
  assert.match(appSource, /<PublicacionesPage[^>]+sesion=\{sesion\}/);
});

test("el preparador contempla los datos acordados para Instagram y Facebook", () => {
  assert.match(composerSource, /Instagram/);
  assert.match(composerSource, /Facebook/);
  assert.match(composerSource, /Primer comentario/);
  assert.match(composerSource, /Colaboradores/);
  assert.match(composerSource, /Ubicación/);
  assert.match(composerSource, /Etiquetas/);
  assert.match(composerSource, /Proponer con Mía/);
  assert.match(composerSource, /Probar programación/);
});

test("el preparador permite cargar material local con reglas claras por formato", () => {
  assert.match(composerSource, /type="file"/);
  assert.match(composerSource, /Seleccionar MP4/);
  assert.match(composerSource, /Seleccionar fotos/);
  assert.match(composerSource, /video\/mp4/);
  assert.match(composerSource, /image\/jpeg/);
  assert.match(composerSource, /entre 2 y 10 piezas/);
  assert.match(composerSource, /Elegir desde Drive/);
  assert.match(composerSource, /URL\.revokeObjectURL/);
  assert.match(composerSource, /Subir a Drive/);
  assert.match(composerSource, /Guardar borrador/);
  assert.match(composerSource, /Borradores guardados/);
  assert.match(composerSource, /publicationUploadPlan/);
});
