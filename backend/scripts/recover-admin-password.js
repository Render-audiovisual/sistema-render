import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";
import {
  selectRecoverableAdmin,
  validateAdminRecoveryInput,
} from "../src/admin-recovery.js";

async function main() {
  const { usuario, password } = validateAdminRecoveryInput({
    usuario: process.env.RECOVERY_ADMIN_USER,
    password: process.env.RECOVERY_ADMIN_PASSWORD,
    confirmation: process.env.RECOVERY_CONFIRMATION,
  });

  const database = await pool.query("SELECT current_database() AS name");
  const expectedDatabase = process.env.RECOVERY_EXPECTED_DATABASE?.trim();
  if (!expectedDatabase || database.rows[0]?.name !== expectedDatabase) {
    throw new Error("La base conectada no coincide con RECOVERY_EXPECTED_DATABASE.");
  }

  const result = await pool.query(
    `SELECT id, usuario, rol, password_hash
     FROM usuarios
     WHERE lower(usuario) = lower($1)`,
    [usuario],
  );
  const account = selectRecoverableAdmin(result.rows, usuario);
  const passwordHash = await bcrypt.hash(password, 10);

  const update = await pool.query(
    `UPDATE usuarios
     SET password_hash = $1
     WHERE id = $2 AND password_hash = $3`,
    [passwordHash, account.id, account.password_hash],
  );
  if (update.rowCount !== 1) {
    throw new Error("La cuenta cambió durante la operación; no se actualizó la contraseña.");
  }

  console.log(`Contraseña recuperada para el administrador ${account.usuario}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
