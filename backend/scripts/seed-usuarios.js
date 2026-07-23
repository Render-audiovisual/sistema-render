// Crea las cuentas que el frontend espera (ver USUARIO_A_RUTA en
// frontend/src/main.jsx). No hardcodea ninguna contraseña: las lee de
// variables de entorno para no dejar credenciales en el código.
//
// Uso:
//   SEED_PASSWORD_DEFAULT="algo-fuerte" node scripts/seed-usuarios.js
//
// O una contraseña distinta por persona:
//   SEED_PASSWORD_LIDER=... node scripts/seed-usuarios.js
//
// Es seguro correrlo más de una vez: si el usuario ya existe, no lo toca
// (no pisa contraseñas que ya se hayan cambiado a mano).
import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

const USUARIOS = [
  { usuario: "lider", nombre: "Líder", rol: "admin" },
  { usuario: "augusto", nombre: "Augusto", rol: "diseno" },
  { usuario: "luciano", nombre: "Luciano", rol: "edicion" },
  { usuario: "german", nombre: "Germán", rol: "produccion" },
  { usuario: "oriana", nombre: "Oriana", rol: "community" },
];

function passwordPara(usuario) {
  const clave = `SEED_PASSWORD_${usuario.toUpperCase()}`;
  return process.env[clave] || process.env.SEED_PASSWORD_DEFAULT || null;
}

async function main() {
  const faltantes = USUARIOS.filter((u) => !passwordPara(u.usuario));
  if (faltantes.length > 0) {
    console.error(
      "Faltan contraseñas para: " +
        faltantes.map((u) => u.usuario).join(", ") +
        ".\nSeteá SEED_PASSWORD_DEFAULT=algo-fuerte (o una por persona, ej. SEED_PASSWORD_AGUSTIN=...) y volvé a correr este script.",
    );
    process.exit(1);
  }

  for (const u of USUARIOS) {
    const { rows: existentes } = await pool.query(
      "SELECT id FROM usuarios WHERE usuario = $1",
      [u.usuario],
    );
    if (existentes.length > 0) {
      console.log(`— ${u.usuario} ya existe, se salta`);
      continue;
    }

    const passwordHash = await bcrypt.hash(passwordPara(u.usuario), 10);
    await pool.query(
      `INSERT INTO usuarios (usuario, nombre, rol, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [u.usuario, u.nombre, u.rol, passwordHash],
    );
    console.log(`✓ ${u.usuario} creado (rol: ${u.rol})`);
  }

  console.log(
    "\nListo. Recomendación: que cada persona entre y cambie su contraseña desde /perfil.",
  );
  await pool.end();
}

main().catch((error) => {
  console.error("Error creando usuarios:", error);
  process.exit(1);
});
