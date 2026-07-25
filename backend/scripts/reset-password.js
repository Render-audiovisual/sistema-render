// Resetea la contraseña de un usuario existente. A diferencia de
// seed-usuarios.js (que solo crea usuarios faltantes y nunca pisa
// contraseñas), este script SÍ sobreescribe la contraseña de alguien
// que ya existe — para eso es.
//
// Uso (necesita DATABASE_URL apuntando a la base correcta, típicamente
// la misma que usa el backend en producción):
//   DATABASE_URL="postgres://..." node scripts/reset-password.js lider "nueva-contraseña-fuerte"
import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

const [usuario, nuevaPassword] = process.argv.slice(2);

async function main() {
  if (!usuario || !nuevaPassword) {
    console.error('Uso: node scripts/reset-password.js <usuario> "<nueva-contraseña>"');
    process.exit(1);
  }
  if (nuevaPassword.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(nuevaPassword, 10);
  const { rowCount } = await pool.query(
    "UPDATE usuarios SET password_hash = $1 WHERE usuario = $2",
    [passwordHash, usuario],
  );

  if (rowCount === 0) {
    console.error(`No existe ningún usuario "${usuario}".`);
    process.exit(1);
  }

  console.log(`✓ Contraseña de "${usuario}" actualizada.`);
  await pool.end();
}

main().catch((error) => {
  console.error("Error reseteando contraseña:", error);
  process.exit(1);
});
