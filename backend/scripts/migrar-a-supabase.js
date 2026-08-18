// Copia todos los datos de la base actual (Render u otra) a una base
// nueva (Supabase u otra) — pensado para no depender de pg_dump/psql, que
// no estaban instalados en esta máquina. Usa el mismo paquete `pg` que ya
// es dependencia del backend.
//
// Requisito previo: correr `npm run migrate` contra la base DESTINO para
// que exista el schema (tablas vacías) antes de copiar datos.
//
// Uso:
//   SOURCE_DATABASE_URL="postgres://...(base vieja)..." \
//   TARGET_DATABASE_URL="postgres://...(supabase)..." \
//   node scripts/migrar-a-supabase.js
//
// Es seguro correrlo más de una vez: usa ON CONFLICT (id) DO NOTHING, así
// que filas ya copiadas no se duplican ni fallan.
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// Orden por dependencias de foreign key (padres antes que hijos).
const TABLAS_EN_ORDEN = [
  "usuarios",
  "grupos_feed",
  "clientes",
  "historias",
  "publicaciones",
  "tareas",
  "tarea_comentarios",
  "estructura_cliente",
  "check_publicacion",
  "fechas_especiales",
];

function crearPool(connectionString, nombre) {
  if (!connectionString) {
    console.error(`Falta ${nombre}. Revisá las variables de entorno.`);
    process.exit(1);
  }
  return new Pool({
    connectionString,
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });
}

async function copiarTabla(origen, destino, tabla) {
  const { rows } = await origen.query(`SELECT * FROM ${tabla}`);
  if (rows.length === 0) {
    console.log(`— ${tabla}: sin filas, se salta`);
    return;
  }

  const columnas = Object.keys(rows[0]);
  const columnasSQL = columnas.map((c) => `"${c}"`).join(", ");

  let copiadas = 0;
  for (const fila of rows) {
    const valores = columnas.map((c) => fila[c]);
    const placeholders = columnas.map((_, i) => `$${i + 1}`).join(", ");
    const resultado = await destino.query(
      `INSERT INTO ${tabla} (${columnasSQL}) VALUES (${placeholders})
       ON CONFLICT (id) DO NOTHING`,
      valores,
    );
    if (resultado.rowCount > 0) copiadas++;
  }

  // Sin esto, la próxima fila creada a mano (sin id explícito) podría
  // chocar con un id ya copiado — la secuencia del destino sigue en 1.
  if (columnas.includes("id")) {
    await destino.query(
      `SELECT setval(pg_get_serial_sequence('${tabla}', 'id'), COALESCE((SELECT MAX(id) FROM ${tabla}), 1))`,
    );
  }

  console.log(`✓ ${tabla}: ${copiadas} de ${rows.length} filas copiadas`);
}

async function main() {
  const origen = crearPool(process.env.SOURCE_DATABASE_URL, "SOURCE_DATABASE_URL");
  const destino = crearPool(process.env.TARGET_DATABASE_URL, "TARGET_DATABASE_URL");

  for (const tabla of TABLAS_EN_ORDEN) {
    await copiarTabla(origen, destino, tabla);
  }

  console.log("\nListo. Verificá contando filas en ambas bases antes de cortar la vieja.");
  await origen.end();
  await destino.end();
}

main().catch((error) => {
  console.error("Error migrando datos:", error);
  process.exit(1);
});
