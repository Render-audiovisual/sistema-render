import assert from "node:assert/strict";
import test from "node:test";
import { crearMensajePrivadoTarea, encolarNotificacionPrivadaTarea } from "../src/private-task-notifications.js";

test("arma un aviso privado breve con enlace directo", () => {
  const result = crearMensajePrivadoTarea({
    tarea: { id: 42, titulo: "Carrusel 1", fecha_vencimiento: "2026-09-04", prioridad: "alta" },
    clienteNombre: "Luzin",
    motivo: "comentario",
    detalle: "Oriana: corregir la portada",
  });
  assert.match(result.text, /comentario nuevo/i);
  assert.match(result.text, /Luzin · Carrusel 1/);
  assert.match(result.text, /Oriana: corregir la portada/);
  assert.match(result.text, /workspace\/tareas\?task=42/);
});

test("encola una vez por destinatario, excluye al actor y tolera reintentos", async () => {
  const inserts = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("SELECT usuario, nombre FROM usuarios")) return { rows: [
        { usuario: "German", nombre: "Germán" },
        { usuario: "Oriana", nombre: "Oriana" },
      ] };
      if (sql.includes("SELECT nombre FROM clientes")) return { rows: [{ nombre: "Bohle" }] };
      if (sql.includes("INSERT INTO mia_private_task_notifications")) {
        inserts.push(params);
        return { rows: [{ id: 1, fingerprint: params[0] }] };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const result = await encolarNotificacionPrivadaTarea({
    pool,
    tarea: {
      id: 9, titulo: "Visita", asignado_a: "Germán", cliente_id: 4,
      fecha_vencimiento: "2026-09-02", prioridad: "alta", updated_at: "2026-09-02T12:00:00Z",
      propiedades_extra: { workspace: "render_os", colaboradores: ["Oriana", "GERMÁN"] },
    },
    actor: "Oriana",
  });
  assert.equal(result.encolado, true);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], "Germán");
  assert.equal(inserts[0][2], "german");
});
