import "dotenv/config";
import { pool } from "../src/db.js";

const motivo = "limpieza tablero /piezas solicitada por Agus";

async function archivarTabla(tabla) {
  const { rows } = await pool.query(
    `
      UPDATE ${tabla}
      SET
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'archivado_tablero', true,
          'archivado_tablero_at', now()::text,
          'archivado_tablero_motivo', $1::text
        ),
        updated_at = now()
      WHERE metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
      RETURNING id
    `,
    [motivo],
  );

  return rows.length;
}

async function main() {
  const publicaciones = await archivarTabla("publicaciones");
  const historias = await archivarTabla("historias");

  console.log(
    JSON.stringify(
      {
        ok: true,
        publicaciones_archivadas: publicaciones,
        historias_archivadas: historias,
        total_archivado: publicaciones + historias,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
