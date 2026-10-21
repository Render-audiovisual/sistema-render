const failure = (status, message) => Object.assign(new Error(message), { status });

export function financePeriod(query) {
  if (!query || Object.keys(query).length !== 1 || typeof query.periodo !== 'string'
    || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(query.periodo)
    || query.periodo.length !== 7 || query.periodo < '2026-09') {
    throw failure(400, 'Usá un único período válido YYYY-MM, desde septiembre de 2026.');
  }
  return query.periodo;
}

export function captureFinanceActor(auth) {
  if (![auth?.id, auth?.session_version].every(value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647)) {
    throw failure(401, 'La sesión cambió. Volvé a iniciar sesión.');
  }
  return Object.freeze({ id: auth.id, session_version: auth.session_version });
}

// Capture before provider/pool waits. One read-only snapshot owns all financial
// inputs; labels in cached request auth never authorize financial disclosure.
export async function withFinanceSnapshot(pool, captured, read) {
  const observed = captureFinanceActor(captured);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [observed.id])).rows[0];
    if (!actor || actor.id !== observed.id || actor.activo !== true || actor.session_version !== observed.session_version) {
      throw failure(401, 'La sesión cambió. Volvé a iniciar sesión.');
    }
    if (actor.rol !== 'admin') throw failure(403, 'Solo administración puede consultar Finanzas.');
    const result = await read(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
