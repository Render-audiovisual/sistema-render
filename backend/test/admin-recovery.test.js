import assert from "node:assert/strict";
import test from "node:test";
import {
  isBcryptHash,
  selectRecoverableAdmin,
  validateAdminRecoveryInput,
} from "../src/admin-recovery.js";

test("la recuperación exige usuario, contraseña fuerte y confirmación explícita", () => {
  assert.deepEqual(
    validateAdminRecoveryInput({
      usuario: " Lider ",
      password: "UnaClaveSegura2027",
      confirmation: "RECUPERAR_ADMIN_HOSTINGER",
    }),
    { usuario: "Lider", password: "UnaClaveSegura2027" },
  );
  assert.throws(() => validateAdminRecoveryInput({}), /obligatorio/);
  assert.throws(
    () => validateAdminRecoveryInput({ usuario: "Lider", password: "corta" }),
    /12 caracteres/,
  );
});

test("solo acepta una cuenta admin existente con hash bcrypt válido", () => {
  const hash = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
  assert.equal(isBcryptHash(hash), true);
  assert.equal(
    selectRecoverableAdmin([{ id: 1, usuario: "Lider", rol: "admin", password_hash: hash }], "Lider").id,
    1,
  );
  assert.throws(() => selectRecoverableAdmin([], "Lider"), /único usuario/);
  assert.throws(
    () => selectRecoverableAdmin([{ rol: "diseno", password_hash: hash }], "Lider"),
    /rol administrador/,
  );
  assert.throws(
    () => selectRecoverableAdmin([{ rol: "admin", password_hash: "texto" }], "Lider"),
    /bcrypt válido/,
  );
});
