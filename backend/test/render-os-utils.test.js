import assert from "node:assert/strict";
import test from "node:test";
import { areaForTask, emojiForTaskCard, formatDate, initials, personForTask } from "../../frontend/src/features/render-os/utils/task-formatters.js";

test("los formateadores puros de RENDER OS conservan sus resultados", () => {
  assert.equal(areaForTask({ titulo: "Landing institucional" }), "web");
  assert.equal(areaForTask({ titulo: "Pieza", tipo_tarea: "diseno" }), "carruseles");
  assert.equal(areaForTask({ titulo: "Video 1", subtipo: "video", tipo_tarea: "administracion" }), "planificacion");
  assert.equal(formatDate("2026-08-03"), "03/08/2026");
  assert.equal(formatDate(null), "Sin fecha");
  assert.equal(initials("Render Audiovisual"), "RA");
  assert.deepEqual(
    personForTask({ asignado_a: "AGUSTÍN" }, [{ id: 7, nombre: "Agustín", usuario: "agus" }]),
    { id: 7, nombre: "Agustín", usuario: "agus" },
  );
});

test("las tarjetas de tareas reciben el emoji de su categoría automáticamente", () => {
  assert.equal(emojiForTaskCard({ titulo: "Video 1", subtipo: "video", tipo_tarea: "administracion" }), "🗓️");
  assert.equal(emojiForTaskCard({ titulo: "Carrusel de lanzamiento", tipo_tarea: "diseno" }), "🎠");
  assert.equal(emojiForTaskCard({ titulo: "Visita de producción", tipo_tarea: "produccion" }), "📹");
  assert.equal(emojiForTaskCard({ titulo: "Edición del reel", tipo_tarea: "edicion" }), "🎬");
  assert.equal(emojiForTaskCard({ titulo: "Historia promocional", tipo_tarea: "community" }), "🎨");
  assert.equal(emojiForTaskCard({ titulo: "Landing web institucional" }), "💻");
  assert.equal(emojiForTaskCard({ titulo: "Configurar chatbot de ventas" }), "🤖");
  assert.equal(emojiForTaskCard({ titulo: "Cartelería para el local" }), "🪧");
  assert.equal(emojiForTaskCard({ titulo: "Tarea general sin categoría" }), "📌");
});
