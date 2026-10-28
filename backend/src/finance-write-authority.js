import { captureFinanceActor } from './finance-snapshot.js';
import { captureOwnerProfileWriteAuthority, retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';

const denied=(status,message)=>Object.assign(new Error(message),{status});

// Account administration and financial writes share this ordering: global
// account mutex first, then current actor SHARE, then domain rows/CAS. Do not
// retain an actor lock while waiting for the mutex used to revoke that actor.
export async function withFinanceWrite(pool, auth, mutate) {
  const observed=captureFinanceActor(auth);
  const delegation=captureOwnerProfileWriteAuthority(auth);
  const db=await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await db.query('SELECT pg_advisory_xact_lock(20261019, 1)');
    await retainCapturedOwnerProfileAuthority(db, delegation);
    const actor=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE',[observed.id])).rows[0];
    if(!actor||actor.id!==observed.id||actor.activo!==true||actor.session_version!==observed.session_version) {
      throw denied(401,'La sesión cambió. Volvé a iniciar sesión.');
    }
    if(actor.rol!=='admin')throw denied(403,'Solo administración puede gestionar contratos financieros.');
    const result=await mutate(db);
    await db.query('COMMIT');
    return result;
  } catch(error) {
    try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}
    throw error;
  } finally { db.release(discard); }
}
