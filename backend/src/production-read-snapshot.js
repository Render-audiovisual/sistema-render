const obsolete=()=>Object.assign(new Error('La sesión cambió. Volvé a iniciar sesión.'),{status:401});
const identity=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;

// Authorization and all inputs use one point-in-time read snapshot. A later
// revocation is not serialized behind this read; no row locks or writes occur.
export async function withProductionReadSnapshot(pool,auth,read) {
  const id=auth?.id,version=auth?.session_version;
  if(!identity(id)||!identity(version))throw obsolete();
  const db=await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1',[id])).rows[0];
    if(!actor||actor.id!==id||actor.activo!==true||actor.session_version!==version)throw obsolete();
    const result=await read(db);
    await db.query('COMMIT');
    return result;
  }catch(error){
    try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}
    throw error;
  }finally{db.release(discard);}
}
