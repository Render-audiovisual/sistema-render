// Serializes owner-changing operations so concurrent requests cannot remove
// the final active administrator. No inferred identity or name-based grants.
export async function administerUser(pool, id, next, mutate) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(20261019, 1)");
    const { rows } = await client.query("SELECT id,rol,activo FROM usuarios WHERE id=$1 FOR UPDATE", [id]);
    const target = rows[0];
    if (!target) { const error = new Error("Usuario no encontrado."); error.status = 404; throw error; }
    const removesOwner = next.delete === true || next.activo === false
      || (next.rol !== undefined && next.rol !== "admin");
    if (target.rol === "admin" && target.activo && removesOwner) {
      const remaining = await client.query("SELECT count(*)::int AS count FROM usuarios WHERE rol='admin' AND activo=TRUE");
      if (remaining.rows[0].count <= 1) {
        const error = new Error("Debe quedar al menos un administrador activo."); error.status = 409; throw error;
      }
    }
    const result = await mutate(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
