const unauthorized = () => Object.assign(new Error('La sesión cambió. Volvé a iniciar sesión.'), { status: 401 });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

function captureActor(auth) {
  const { id, rol, session_version } = auth || {};
  if (!positive(id) || !positive(session_version) || typeof rol !== 'string' || !rol.trim()) throw unauthorized();
  return Object.freeze({ id, rol, session_version });
}

function freezeInput(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeInput(child, seen);
  return Object.freeze(value);
}

// Callers normalize business input before entering. Capture before the pool
// lease, and never let callbacks send HTTP or perform external work here.
export async function withPersonalListWrite(pool, auth, normalizedInput, run) {
  const observed = captureActor(auth);
  const input = freezeInput(structuredClone(normalizedInput));
  if (typeof run !== 'function') throw new TypeError('Personal list write callback required');
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Same exclusive first user lock as087. No SHARE->UPDATE upgrade, and no
    // domain/advisory lock before the user; MIA locks its target SHARE first.
    const current = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR UPDATE', [observed.id])).rows[0];
    if (!current || current.id !== observed.id || current.activo !== true
      || current.session_version !== observed.session_version || current.rol !== observed.rol) throw unauthorized();
    const result = await run(db, input, observed);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
    throw error;
  } finally {
    db.release(discard);
  }
}
