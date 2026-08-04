import assert from "node:assert/strict";
import test from "node:test";

import { groupFilmingTasksByClient, isFilmingTask } from "../../frontend/src/shared/reports/report-utils.js";

test("identifica filmaciones sin contar tareas de edición", () => {
  assert.equal(isFilmingTask({ tipo_tarea: "produccion", titulo: "Visita al local" }), true);
  assert.equal(isFilmingTask({ subtipo: "filmar", titulo: "Video Chevrolet" }), true);
  assert.equal(isFilmingTask({ tipo_tarea: "edicion", titulo: "Editar video Chevrolet" }), false);
});

test("agrupa los videos de Germán por cliente y separa grabados de pendientes", () => {
  const result = groupFilmingTasksByClient([
    { cliente_nombre: "Moketa", tipo_tarea: "produccion", estado: "publicada" },
    { cliente_nombre: "Moketa", subtipo: "filmar", estado: "pendiente" },
    { cliente_nombre: "Luzin", titulo: "Grabación en local", estado: "publicada" },
    { cliente_nombre: "Luzin", tipo_tarea: "edicion", titulo: "Editar video", estado: "publicada" },
  ]);

  assert.deepEqual(result, [
    { nombre: "Moketa", total: 2, grabados: 1, pendientes: 1 },
    { nombre: "Luzin", total: 1, grabados: 1, pendientes: 0 },
  ]);
});
