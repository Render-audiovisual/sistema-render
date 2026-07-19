// Migra la planificación real de julio 2026 desde el Google Sheet
// "PLANIFICADOR DE HISTORIAS" (13 clientes) hacia Render OS, usando
// exclusivamente las tablas y columnas que ya existen — no crea entidades
// nuevas ni cambia el schema.
//
// El dataset ya viene extraído y limpio en data/planificador-historias-julio-2026.json
// (generado una sola vez a partir del .xlsx exportado del Sheet). Este
// script solo hace los INSERTs.
//
// Es seguro correrlo más de una vez:
//   - historias: se salta por cliente si ese cliente ya tiene historias
//     cargadas en julio 2026 (evita duplicar si se corre dos veces)
//   - estructura_cliente: ON CONFLICT (cliente_id, dia_semana) DO NOTHING
//   - check_publicacion: ON CONFLICT (cliente_id, fecha) DO NOTHING
//   - fechas_especiales: se salta entera si la tabla ya tiene datos
//
// Uso: node scripts/importar-planificador-historias.js
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data", "planificador-historias-julio-2026.json"),
    "utf8",
  ),
);

const HOY_ISO = new Date().toISOString().slice(0, 10);

async function mapaClientes() {
  const { rows } = await pool.query("SELECT id, nombre FROM clientes");
  const mapa = new Map(rows.map((r) => [r.nombre, r.id]));
  return mapa;
}

async function importarHistorias(mapa) {
  const porCliente = new Map();
  for (const h of dataset.historias) {
    if (!porCliente.has(h.cliente)) porCliente.set(h.cliente, []);
    porCliente.get(h.cliente).push(h);
  }

  // Set de "cliente+fecha publicados" para inferir estado de las
  // historias con fecha pasada.
  const publicadosSet = new Set(
    dataset.check_publicacion.map((c) => `${c.cliente}|${c.fecha}`),
  );

  let totalInsertadas = 0;
  let totalSalteadas = 0;

  for (const [nombreCliente, historias] of porCliente) {
    const clienteId = mapa.get(nombreCliente);
    if (!clienteId) {
      console.warn(`⚠ Cliente no encontrado en la base: "${nombreCliente}" — se saltea (${historias.length} historias)`);
      continue;
    }

    const { rows: existentes } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM historias
       WHERE cliente_id = $1 AND fecha_programada BETWEEN '2026-07-01' AND '2026-07-31'`,
      [clienteId],
    );
    if (existentes[0].n > 0) {
      console.log(`— ${nombreCliente}: ya tiene ${existentes[0].n} historias en julio 2026, se saltea todo el cliente`);
      totalSalteadas += historias.length;
      continue;
    }

    for (const h of historias) {
      const yaPublicado =
        h.fecha_programada < HOY_ISO &&
        publicadosSet.has(`${nombreCliente}|${h.fecha_programada}`);

      await pool.query(
        `INSERT INTO historias
           (cliente_id, estado, fecha_programada, responsable, responsable_diseño,
            idea, copy, material_referencia, aclaraciones, prioridad, metadata)
         VALUES ($1, $2, $3, 'Augusto', 'Augusto', '', $4, '', '', 'media', $5::jsonb)`,
        [
          clienteId,
          yaPublicado ? "publicada" : "pendiente",
          h.fecha_programada,
          h.copy || "",
          JSON.stringify({ tipo: h.tema, hora: h.hora, formato: h.formato, cta: h.cta }),
        ],
      );
      totalInsertadas++;
    }
    console.log(`✓ ${nombreCliente}: ${historias.length} historias importadas`);
  }

  console.log(`\nHistorias insertadas: ${totalInsertadas} | clientes salteados (ya tenían datos): ${totalSalteadas}`);
}

async function importarEstructura(mapa) {
  let insertadas = 0;
  for (const e of dataset.estructura) {
    const clienteId = mapa.get(e.cliente);
    if (!clienteId) continue;
    const res = await pool.query(
      `INSERT INTO estructura_cliente (cliente_id, dia_semana, tema, horario, cta_fijo, tipo)
       VALUES ($1, $2, $3, $4, $5, 'historia')
       ON CONFLICT (cliente_id, dia_semana) DO NOTHING
       RETURNING id`,
      [clienteId, e.dia_semana, e.tema, e.horario, e.cta_fijo],
    );
    if (res.rows.length > 0) insertadas++;
  }
  console.log(`Estructura: ${insertadas} filas insertadas (de ${dataset.estructura.length} en el dataset)`);
}

async function importarFechasEspeciales(mapa) {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM fechas_especiales");
  if (rows[0].n > 0) {
    console.log(`Fechas especiales: la tabla ya tiene ${rows[0].n} filas, se saltea todo el bloque`);
    return;
  }

  let insertadas = 0;
  for (const f of dataset.fechas_especiales) {
    const clienteId = f.cliente ? mapa.get(f.cliente) : null;
    if (f.cliente && !clienteId) {
      console.warn(`⚠ Fecha especial con cliente no encontrado: "${f.cliente}" — se saltea "${f.evento}"`);
      continue;
    }
    await pool.query(
      `INSERT INTO fechas_especiales (cliente_id, fecha, evento, tipo, anticipacion_dias, idea, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [clienteId, f.fecha, f.evento, f.tipo, f.anticipacion_dias, f.idea, f.estado],
    );
    insertadas++;
  }
  console.log(`Fechas especiales: ${insertadas} filas insertadas`);
}

async function importarCheckPublicacion(mapa) {
  let insertadas = 0;
  for (const c of dataset.check_publicacion) {
    const clienteId = mapa.get(c.cliente);
    if (!clienteId) continue;
    const res = await pool.query(
      `INSERT INTO check_publicacion (cliente_id, fecha, publicado, confirmado_por, confirmado_at)
       VALUES ($1, $2, true, 'Migración Google Sheet', now())
       ON CONFLICT (cliente_id, fecha) DO NOTHING
       RETURNING id`,
      [clienteId, c.fecha],
    );
    if (res.rows.length > 0) insertadas++;
  }
  console.log(`Check publicación: ${insertadas} filas insertadas (de ${dataset.check_publicacion.length} en el dataset)`);
}

async function main() {
  console.log(`Dataset: ${dataset.historias.length} historias, ${dataset.estructura.length} estructura, ${dataset.fechas_especiales.length} fechas especiales, ${dataset.check_publicacion.length} check publicación\n`);

  const mapa = await mapaClientes();
  const faltantes = [
    ...new Set(dataset.historias.map((h) => h.cliente)),
  ].filter((n) => !mapa.has(n));
  if (faltantes.length > 0) {
    console.error("Clientes del dataset que NO existen en la base (revisar antes de continuar):", faltantes);
    process.exit(1);
  }

  await importarHistorias(mapa);
  await importarEstructura(mapa);
  await importarFechasEspeciales(mapa);
  await importarCheckPublicacion(mapa);

  await pool.end();
  console.log("\nMigración completa.");
}

main().catch((error) => {
  console.error("Error en la migración:", error);
  process.exit(1);
});
