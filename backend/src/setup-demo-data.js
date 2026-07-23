import { pool } from "./db.js";

const clientesReales = [
  ["RPM Chevrolet", 4, 4],
  ["iPhone Shop", 8, 4],
  ["Luzin", 8, 4],
  ["Moketa", 4, 4],
  ["Lavalle Hortícola", 0, 0],
  ["Lavalle Market", 0, 0],
  ["El Ángel Azul Turismo", 4, 4],
  ["El Ángel Azul Estudiantil", 4, 4],
  ["Litoral Maq", 8, 2],
  ["Búnker Training", 4, 2],
  ["Bendita", 4, 4],
  ["Bohle", 6, 0],
  ["Capital Motos", 6, 0],
];

export async function setupDemoClientes() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      cuota_reels INTEGER NOT NULL DEFAULT 0,
      cuota_carruseles INTEGER NOT NULL DEFAULT 0
    )
  `);

  for (const [nombre, cuotaReels, cuotaCarruseles] of clientesReales) {
    await pool.query(
      `
        INSERT INTO clientes (nombre, cuota_reels, cuota_carruseles)
        VALUES ($1, $2, $3)
        ON CONFLICT (nombre)
        DO UPDATE SET
          cuota_reels = EXCLUDED.cuota_reels,
          cuota_carruseles = EXCLUDED.cuota_carruseles
      `,
      [nombre, cuotaReels, cuotaCarruseles],
    );
  }

  await pool.query(`
    INSERT INTO grupos_feed (nombre, cuota_mensual)
    VALUES ('Lavalle', 16)
    ON CONFLICT (nombre)
    DO UPDATE SET cuota_mensual = EXCLUDED.cuota_mensual
  `);
  await pool.query(`
    UPDATE clientes
    SET grupo_feed_id = (SELECT id FROM grupos_feed WHERE nombre = 'Lavalle')
    WHERE nombre IN ('Lavalle Hortícola', 'Lavalle Market')
  `);
}
