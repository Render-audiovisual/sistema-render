// Recognition-only history of the deployed branch, inspected against a restored
// authorized backup. These scripts are NOT part of the executable migration
// chain: some contain one-off financial/history DML that must never be replayed
// on a fresh database or used as an inferred baseline. Existing ledger rows stay
// unchanged. Hashes document source provenance, not proof of an applied schema:
// the inherited ledger did not record SQL hashes.
export const DEPLOYED_HISTORY_COMMIT = '43f02707e299293c5b0c2bb6f12386bd4642746b';
export const DEPLOYED_MIGRATION_HISTORY = Object.freeze({
  '050_registro_entregas_edicion_septiembre_2026.sql': '24f9235c8be62b240c67f8555e1e08213ce08956607c90f880c7f91a0712e8f7',
  '051_progreso_edicion_auditable.sql': '858f69ede3f8dc7e2542e7a28c656921f1e9935bc1869e2fc69118cf69db7edd',
  '052_reubicar_backfill_progreso_edicion.sql': '032ba209ab4ea544cc17c70603d8d8696d142d5e392ec66e56dfc3b5c04dd897',
  '054_cierre_reportes_septiembre_2026.sql': '559dcd2b108528c203cee05c2fa62e27cf0c54d98a9d04e4e478d1b0af15a50b',
  '055_cierre_reportes_identidad_septiembre_2026.sql': 'bb47e9d7bbf43f38977eef595cd62a1236b9bef254155942beb9dedbe174faf9',
});
export function isRecognizedDeployedMigration(name) {
  return typeof name === 'string' && Object.hasOwn(DEPLOYED_MIGRATION_HISTORY, name);
}
