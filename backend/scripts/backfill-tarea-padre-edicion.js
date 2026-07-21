// Vincula pares producción/edición creados ANTES de que existiera
// tarea_padre_id (ver server.js, POST /piezas) — sin esto, Luciano no ve
// "esperando material" en tareas de edición que ya estaban abiertas.
//
// Empareja por publicacion_id: la tarea de producción (filmar) de esa
// misma publicación pasa a ser el padre de la tarea de edición (editar).
// Solo toca tareas de edición que todavía no tienen tarea_padre_id —
// correrlo de nuevo no cambia nada ya vinculado.
//
// Uso: node scripts/backfill-tarea-padre-edicion.js
import "dotenv/config";
import { pool } from "../src/db.js";

async function main() {
  const { rows: pares } = await pool.query(
    `SELECT edicion.id AS edicion_id, produccion.id AS produccion_id
     FROM tareas edicion
     JOIN tareas produccion
       ON produccion.publicacion_id = edicion.publicacion_id
      AND produccion.tipo_tarea = 'produccion'
     WHERE edicion.tipo_tarea = 'edicion'
       AND edicion.tarea_padre_id IS NULL
       AND edicion.publicacion_id IS NOT NULL`,
  );

  for (const { edicion_id, produccion_id } of pares) {
    await pool.query(`UPDATE tareas SET tarea_padre_id = $1 WHERE id = $2`, [
      produccion_id,
      edicion_id,
    ]);
  }

  console.log(`Tareas de edición vinculadas a su producción: ${pares.length}`);

  await pool.end();
}

main().catch((error) => {
  console.error("Error en el backfill:", error);
  process.exit(1);
});
