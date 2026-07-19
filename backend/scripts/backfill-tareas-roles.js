// Genera las tareas que faltan para las historias/publicaciones que ya
// existían antes de definir los roles del equipo (la migración masiva de
// Historias y Publicaciones no generó tareas a propósito, para no
// inundar a Augusto/Luciano de golpe — ver importar-planificador-historias.js
// e importar-publicaciones.js).
//
// Alcance deliberadamente acotado al MES ACTUAL (no los 7 meses completos
// migrados) para no volcar cientos de tareas de una sola vez. Los meses
// futuros se van completando solos a medida que ese mes se vuelve
// "actual", corriendo este mismo script de nuevo — o ya quedan cubiertos
// naturalmente por la generación automática en cada creación nueva desde
// la UI.
//
// Reglas (mismas que quedaron en POST /piezas):
//   - historias sin tarea            → diseño, Augusto
//   - publicaciones carrusel sin tarea → diseño, Augusto
//   - publicaciones video sin tarea, cliente con productor asignado
//                                     → producción (Germán) + edición (Luciano)
//   - publicaciones video de otros clientes → sin tarea (sin productor
//     asignado todavía, evita tareas de edición sin material)
//
// Idempotente: solo crea tareas para piezas que todavía no tienen
// ninguna — correrlo de nuevo no duplica nada.
//
// Uso: node scripts/backfill-tareas-roles.js
import "dotenv/config";
import { pool } from "../src/db.js";

const CLIENTES_PRODUCCION_GERMAN = ["Luzin", "Moketa", "Búnker Training", "Bohle", "Capital Motos"];

function fechaVencimiento(fechaProgramada, diasAntes) {
  const f = new Date(`${fechaProgramada}T00:00:00`);
  f.setDate(f.getDate() - diasAntes);
  return f.toISOString().slice(0, 10);
}

async function crearTarea({ titulo, asignado_a, cliente_id, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo }) {
  await pool.query(
    `INSERT INTO tareas (titulo, asignado_a, cliente_id, estado, requiere_aprobacion, propiedades_extra, fecha_vencimiento, historia_id, publicacion_id, tipo_tarea, subtipo, prioridad)
     VALUES ($1, $2, $3, 'pendiente', false, $4, $5, $6, $7, $8, $9, 'media')`,
    [
      titulo,
      asignado_a,
      cliente_id,
      JSON.stringify({ Origen: "Backfill al definir responsabilidades del equipo" }),
      fecha_vencimiento,
      historia_id || null,
      publicacion_id || null,
      tipo_tarea,
      subtipo || null,
    ],
  );
}

async function main() {
  const { rows: rango } = await pool.query(
    `SELECT date_trunc('month', CURRENT_DATE)::date AS inicio,
            (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date AS fin`,
  );
  const { inicio, fin } = rango[0];
  console.log(`Backfill de tareas para el mes actual: ${inicio} a ${fin}\n`);

  // 1) Historias sin tarea → diseño, Augusto
  const { rows: historiasSinTarea } = await pool.query(
    `SELECT h.id, h.cliente_id, h.idea, to_char(h.fecha_programada, 'YYYY-MM-DD') AS fecha_programada
     FROM historias h
     WHERE h.fecha_programada BETWEEN $1 AND $2
       AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.historia_id = h.id)`,
    [inicio, fin],
  );
  for (const h of historiasSinTarea) {
    await crearTarea({
      titulo: `Diseñar historia - ${h.idea || "sin idea"}`,
      asignado_a: "Augusto",
      cliente_id: h.cliente_id,
      fecha_vencimiento: fechaVencimiento(h.fecha_programada, 1),
      historia_id: h.id,
      tipo_tarea: "diseno",
      subtipo: "diseñar",
    });
  }
  console.log(`Historias → tareas de diseño creadas: ${historiasSinTarea.length}`);

  // 2) Publicaciones carrusel sin tarea → diseño, Augusto
  const { rows: carruselesSinTarea } = await pool.query(
    `SELECT p.id, p.cliente_id, p.idea, to_char(p.fecha_programada, 'YYYY-MM-DD') AS fecha_programada
     FROM publicaciones p
     WHERE p.tipo = 'carrusel'
       AND p.fecha_programada BETWEEN $1 AND $2
       AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.publicacion_id = p.id)`,
    [inicio, fin],
  );
  for (const p of carruselesSinTarea) {
    await crearTarea({
      titulo: `Diseñar assets - ${p.idea || "sin idea"}`,
      asignado_a: "Augusto",
      cliente_id: p.cliente_id,
      fecha_vencimiento: fechaVencimiento(p.fecha_programada, 1),
      publicacion_id: p.id,
      tipo_tarea: "diseno",
      subtipo: "diseñar",
    });
  }
  console.log(`Carruseles → tareas de diseño creadas: ${carruselesSinTarea.length}`);

  // 3) Publicaciones video sin tarea, solo clientes con productor asignado
  const { rows: videosSinTarea } = await pool.query(
    `SELECT p.id, p.cliente_id, c.nombre AS cliente_nombre, p.idea, to_char(p.fecha_programada, 'YYYY-MM-DD') AS fecha_programada
     FROM publicaciones p
     JOIN clientes c ON c.id = p.cliente_id
     WHERE p.tipo = 'video'
       AND p.fecha_programada BETWEEN $1 AND $2
       AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.publicacion_id = p.id)`,
    [inicio, fin],
  );
  let videosConProductor = 0;
  let videosSinProductor = 0;
  for (const p of videosSinTarea) {
    if (!CLIENTES_PRODUCCION_GERMAN.includes(p.cliente_nombre)) {
      videosSinProductor++;
      continue;
    }
    await crearTarea({
      titulo: `Filmar video - ${p.idea || "sin idea"}`,
      asignado_a: "Germán",
      cliente_id: p.cliente_id,
      fecha_vencimiento: fechaVencimiento(p.fecha_programada, 3),
      publicacion_id: p.id,
      tipo_tarea: "produccion",
      subtipo: "filmar",
    });
    await crearTarea({
      titulo: `Editar video - ${p.idea || "sin idea"}`,
      asignado_a: "Luciano",
      cliente_id: p.cliente_id,
      fecha_vencimiento: fechaVencimiento(p.fecha_programada, 1),
      publicacion_id: p.id,
      tipo_tarea: "edicion",
      subtipo: "editar",
    });
    videosConProductor++;
  }
  console.log(`Videos con productor asignado → tareas de producción + edición creadas: ${videosConProductor} pares`);
  console.log(`Videos sin productor asignado todavía (sin tarea, sin tocar): ${videosSinProductor}`);

  await pool.end();
  console.log("\nBackfill completo.");
}

main().catch((error) => {
  console.error("Error en el backfill:", error);
  process.exit(1);
});
