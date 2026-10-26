import { createHash } from 'node:crypto';
import { readMigrationIdentity } from './migrations.js';
import { assertMigrationTargetIdentity, isLoopbackAddress } from './startup-policy.js';

// Offline, explicit-ID reconciliation for an inspected local copy. Not an API,
// login mechanism, name resolver, automatic backfill, or production migrator.
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const positive = id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
const keys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === allowed.length && allowed.every(k => Object.hasOwn(v, k));
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const md5 = v => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
const sha = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function normalizeChoices(choices) {
  if (!Array.isArray(choices) || !choices.length || choices.length > 10000) throw fail('Elegí las tareas a conciliar por ID.');
  const seen = new Set();
  return choices.map(c => {
    if (!keys(c, ['task_id','owner_id','collaborator_ids']) || !positive(c.task_id) || !positive(c.owner_id)
      || !Array.isArray(c.collaborator_ids) || c.collaborator_ids.length > 100
      || c.collaborator_ids.some(id => !positive(id) || id === c.owner_id)
      || new Set(c.collaborator_ids).size !== c.collaborator_ids.length || seen.has(c.task_id)) {
      throw fail('Plan de asignaciones inválido o duplicado.');
    }
    seen.add(c.task_id);
    return { task_id:c.task_id, owner_id:c.owner_id, collaborator_ids:[...c.collaborator_ids].sort((a,b)=>a-b) };
  }).sort((a,b)=>a.task_id-b.task_id);
}
function guardOptions({ environment, expectedIdentity } = {}) {
  if (!['development','sandbox','test'].includes(environment) || !isLoopbackAddress(expectedIdentity?.address)
    || !positive(expectedIdentity?.port) || expectedIdentity.port > 65535
    || typeof expectedIdentity?.database !== 'string' || !expectedIdentity.database
    || typeof expectedIdentity?.username !== 'string' || !expectedIdentity.username) {
    throw fail('La conciliación solo admite una copia local no productiva con identidad explícita.');
  }
  return { environment, expectedIdentity:{database:expectedIdentity.database,username:expectedIdentity.username,
    address:expectedIdentity.address,port:expectedIdentity.port} };
}
async function readSnapshot(db, choices, lock = false) {
  const taskIds = choices.map(c=>c.task_id), userIds = [...new Set(choices.flatMap(c=>[c.owner_id,...c.collaborator_ids]))].sort((a,b)=>a-b);
  const tasks = (await db.query(`SELECT t.id,md5(to_jsonb(t)::text) AS source_hash FROM tareas t
    WHERE t.id=ANY($1::int[]) ORDER BY t.id${lock?' FOR UPDATE OF t':''}`, [taskIds])).rows;
  if (tasks.length !== taskIds.length || !same(tasks.map(t=>t.id),taskIds) || tasks.some(t=>!md5(t.source_hash))) throw fail('Las tareas cambiaron o no están disponibles.',409);
  const users = (await db.query(`SELECT id,usuario,nombre,rol,activo,session_version FROM usuarios
    WHERE id=ANY($1::int[]) ORDER BY id${lock?' FOR SHARE':''}`,[userIds])).rows;
  if (users.length !== userIds.length || !same(users.map(u=>u.id),userIds) || users.some(u=>u.activo!==true || !positive(u.session_version))) throw fail('Hay usuarios inexistentes o inactivos.',409);
  const existing = (await db.query(`SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones
    WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id,usuario_id`,[taskIds])).rows;
  if (existing.length) throw fail('Hay asignaciones existentes: revisalas, no se sobrescriben.',409);
  return { tasks:tasks.map(t=>({id:t.id,source_hash:t.source_hash})), users:users.map(u=>({id:u.id,usuario:u.usuario,nombre:u.nombre,rol:u.rol,activo:u.activo,session_version:u.session_version})) };
}
async function transact(pool, options, write, work) {
  const guard=guardOptions(options), db=await pool.connect();let discard;
  try {
    // Verify the connection before taking any write-path lock. The same leased
    // connection cannot change database/user/address between these statements.
    let identity;
    if(write){
      identity=await readMigrationIdentity(db);
      assertMigrationTargetIdentity(identity,guard.expectedIdentity);
      if(!isLoopbackAddress(identity.address))throw fail('La base actual no es la copia local autorizada.');
    }
    await db.query(write?'BEGIN ISOLATION LEVEL SERIALIZABLE':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL timezone='UTC'");
    await db.query("SET LOCAL statement_timeout='15000ms'");
    await db.query("SET LOCAL lock_timeout='3000ms'");
    // A short offline reconciliation must also exclude direct assignment DML
    // that does not follow the application's parent-task locking protocol.
    // Take this lock before the first SELECT establishes the serial snapshot.
    if(write)await db.query('LOCK TABLE public.tarea_asignaciones IN SHARE ROW EXCLUSIVE MODE');
    identity??=await readMigrationIdentity(db);
    assertMigrationTargetIdentity(identity,guard.expectedIdentity);
    if (!isLoopbackAddress(identity.address)) throw fail('La base actual no es la copia local autorizada.');
    if(write) await db.query("SELECT pg_advisory_xact_lock(hashtext('render_legacy_assignment_reconciliation'))");
    const result=await work(db,guard.environment,identity);
    await db.query('COMMIT');return result;
  } catch(error) {try{await db.query('ROLLBACK');}catch(e){discard=e;}throw error;}
  finally {db.release(discard);}
}
export async function planLegacyAssignments(pool, choices, options) {
  const selected=normalizeChoices(choices);
  return transact(pool,options,false,async(db,environment,identity)=>{
    const snapshot=await readSnapshot(db,selected);
    const body={version:1,environment,identity,choices:selected,snapshot};
    return {...body,plan_hash:digest(body)};
  });
}
export async function applyLegacyAssignments(pool, plan, options = {}) {
  guardOptions(options);
  if (!keys(plan,['version','environment','identity','choices','snapshot','plan_hash']) || plan.version!==1
    || !sha(plan.plan_hash) || options.approvedPlanHash!==plan.plan_hash) throw fail('Falta aprobar el hash exacto del plan.');
  const choices=normalizeChoices(plan.choices);
  // Capture caller-owned objects before waiting for a connection. Mutating the
  // reviewed input must not change either the approval or the subsequent DML.
  let snapshot,identity;
  try {snapshot=structuredClone(plan.snapshot);identity=structuredClone(plan.identity);}catch{throw fail('Plan inválido.');}
  const body={version:1,environment:plan.environment,identity,choices,snapshot};
  if (!same(plan.choices,choices) || digest(body)!==plan.plan_hash || plan.environment!==options.environment) throw fail('El plan fue modificado.');
  return transact(pool,options,true,async(db,environment,currentIdentity)=>{
    if(environment!==body.environment || !same(currentIdentity,identity)) throw fail('La identidad del plan cambió.',409);
    const current=await readSnapshot(db,choices,true);
    if(!same(current,snapshot)) throw fail('Los datos cambiaron desde la revisión. Generá y revisá otro plan.',409);
    const taskIds=[],userIds=[],types=[];
    for(const c of choices)for(const id of [c.owner_id,...c.collaborator_ids]){
      taskIds.push(c.task_id);userIds.push(id);types.push(id===c.owner_id?'responsable':'colaborador');
    }
    const result=await db.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
      SELECT tarea_id,usuario_id,tipo FROM unnest($1::int[],$2::int[],$3::text[]) AS selected(tarea_id,usuario_id,tipo)
      RETURNING tarea_id,usuario_id,tipo`,[taskIds,userIds,types]);
    if(result.rowCount!==taskIds.length)throw fail('No se confirmó toda la conciliación.',409);
    return {version:1,plan_hash:digest(body),tasks:choices.length,assignments:result.rowCount};
  });
}
