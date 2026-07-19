// Migra la planificación de publicaciones (julio 2026 - enero 2027) desde
// el Google Sheet "PUBLICACIONES RENDER" hacia Render OS, usando
// exclusivamente las tablas y columnas que ya existen — no crea entidades
// nuevas ni cambia el schema.
//
// La fuente real dentro del Sheet es la pestaña LISTA_PUBLICACIONES (las
// pestañas de mes son solo la vista visual de checkboxes de la que esa
// lista se generó — no tienen datos adicionales). Idea y Copy están
// siempre vacíos en el Sheet: lo que se migra es el esqueleto de
// programación (fecha + cliente + tipo + si ya se publicó), no contenido
// creativo — no existe todavía en el Sheet.
//
// Corrección aplicada al extraer el dataset: la pestaña ENERO del Sheet
// tenía el año 2026 desactualizado en la plantilla (rompía la secuencia
// consecutiva jul-dic 2026); se corrigió a enero 2027, confirmado con el
// dueño del sistema antes de migrar.
//
// Es seguro correrlo más de una vez: cada publicación que inserta este
// script queda marcada con metadata.origen = "migracion_google_sheet_publicaciones",
// y se salta por cliente si ese cliente ya tiene publicaciones con esa
// marca en el rango de fechas del dataset.
//
// Uso: node scripts/importar-publicaciones.js
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data", "publicaciones-julio2026-enero2027.json"),
    "utf8",
  ),
);

const ORIGEN = "migracion_google_sheet_publicaciones";

async function mapaClientes() {
  const { rows } = await pool.query("SELECT id, nombre FROM clientes");
  return new Map(rows.map((r) => [r.nombre, r.id]));
}

async function main() {
  console.log(`Dataset: ${dataset.publicaciones.length} publicaciones\n`);

  const mapa = await mapaClientes();
  const porCliente = new Map();
  for (const p of dataset.publicaciones) {
    if (!porCliente.has(p.cliente)) porCliente.set(p.cliente, []);
    porCliente.get(p.cliente).push(p);
  }

  const faltantes = [...porCliente.keys()].filter((n) => !mapa.has(n));
  if (faltantes.length > 0) {
    console.error("Clientes del dataset que NO existen en la base (revisar antes de continuar):", faltantes);
    process.exit(1);
  }

  let totalInsertadas = 0;
  let totalSalteadas = 0;

  for (const [nombreCliente, publicaciones] of porCliente) {
    const clienteId = mapa.get(nombreCliente);

    const { rows: existentes } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM publicaciones
       WHERE cliente_id = $1 AND metadata->>'origen' = $2`,
      [clienteId, ORIGEN],
    );
    if (existentes[0].n > 0) {
      console.log(`— ${nombreCliente}: ya tiene ${existentes[0].n} publicaciones de esta migración, se saltea todo el cliente`);
      totalSalteadas += publicaciones.length;
      continue;
    }

    for (const p of publicaciones) {
      await pool.query(
        `INSERT INTO publicaciones
           (cliente_id, tipo, estado, fecha_programada, responsable,
            idea, copy, material_referencia, aclaraciones, prioridad,
            duracion_segundos, metadata)
         VALUES ($1, $2, $3, $4, 'Augusto', '', '', '', '', 'media', $5, $6::jsonb)`,
        [
          clienteId,
          p.tipo,
          p.publicado ? "publicada" : "pendiente",
          p.fecha_programada,
          p.tipo === "video" ? 30 : null,
          JSON.stringify({ origen: ORIGEN }),
        ],
      );
      totalInsertadas++;
    }
    console.log(`✓ ${nombreCliente}: ${publicaciones.length} publicaciones importadas`);
  }

  console.log(`\nPublicaciones insertadas: ${totalInsertadas} | clientes salteados (ya tenían datos): ${totalSalteadas}`);

  await pool.end();
  console.log("\nMigración completa.");
}

main().catch((error) => {
  console.error("Error en la migración:", error);
  process.exit(1);
});
