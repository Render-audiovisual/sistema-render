export function validateAdminRecoveryInput({ usuario, password, confirmation }) {
  const normalizedUser = typeof usuario === "string" ? usuario.trim() : "";

  if (!normalizedUser) {
    throw new Error("RECOVERY_ADMIN_USER es obligatorio.");
  }
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("RECOVERY_ADMIN_PASSWORD debe tener al menos 12 caracteres.");
  }
  if (confirmation !== "RECUPERAR_ADMIN_HOSTINGER") {
    throw new Error("RECOVERY_CONFIRMATION no coincide con la confirmación requerida.");
  }

  return { usuario: normalizedUser, password };
}

export function isBcryptHash(value) {
  return typeof value === "string" && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}

export function selectRecoverableAdmin(rows, usuario) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`No existe un único usuario llamado ${usuario}.`);
  }

  const account = rows[0];
  if (account.rol !== "admin") {
    throw new Error(`El usuario ${usuario} no tiene rol administrador.`);
  }
  if (!isBcryptHash(account.password_hash)) {
    throw new Error(`El usuario ${usuario} no tiene un password_hash bcrypt válido.`);
  }

  return account;
}
