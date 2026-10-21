import express from 'express';
import { createHash, randomUUID } from 'node:crypto';

const fail=(status,message,code)=>Object.assign(new Error(message),{status,...(code?{code}:{})});
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function boardId(value){
  if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||String(Number(value))!==value||!positive(Number(value)))throw fail(400,'Moodboard inválido.');
  return Number(value);
}
function noQuery(query){if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).length)throw fail(400,'No se permiten parámetros de consulta.');}
function actorObservation(auth){
  if(!positive(auth?.id)||!positive(auth?.session_version)||typeof auth?.rol!=='string'||!auth.rol.trim())throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
  return Object.freeze({id:auth.id,session_version:auth.session_version,rol:auth.rol});
}
async function currentActor(db,observed,write){
  const actor=(await db.query(`SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1${write?' FOR SHARE':''}`,[observed.id])).rows[0];
  if(!actor||actor.id!==observed.id||actor.activo!==true||actor.session_version!==observed.session_version||actor.rol!==observed.rol)throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
  return actor;
}
function name(value){
  if(typeof value!=='string'||!value.trim()||Array.from(value.trim()).length>200||/[\u0000-\u001f\u007f]/.test(value))throw fail(400,'Ingresá un nombre de categoría de hasta 200 caracteres.');
  return value.trim();
}
export function normalizeMoodboardCategoryChanges(body){
  if(!closed(body,['request_id','expected_revision','changes'])||typeof body.request_id!=='string'
    ||body.request_id.length!==36||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.request_id)
    ||!revision(body.expected_revision)||!Array.isArray(body.changes)||body.changes.length<1||body.changes.length>100)throw fail(400,'El lote de categorías o su revisión no es válido.');
  const ids=new Set();
  const changes=body.changes.map(change=>{
    if(change?.type==='create'&&closed(change,['type','name']))return Object.freeze({type:'create',name:name(change.name)});
    const keys=change?.type==='rename'?['type','id','name']:change?.type==='delete'?['type','id']:null;
    if(!keys||!closed(change,keys)||!positive(change.id)||ids.has(change.id))throw fail(400,'Cada categoría sólo puede cambiar una vez por lote.');
    ids.add(change.id);return Object.freeze({type:change.type,id:change.id,...(change.type==='rename'?{name:name(change.name)}:{})});
  });
  return Object.freeze({request_id:body.request_id.toLowerCase(),expected_revision:body.expected_revision,changes:Object.freeze(changes)});
}
function storedRevision(value){
  if(typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER))return Number(value);
  if(revision(value))return value;
  throw fail(500,'No se pudo verificar la revisión de categorías.');
}
async function snapshot(db,id,locked=false){
  const board=(await db.query(`SELECT id,category_revision FROM moodboard_boards WHERE id=$1${locked?' FOR NO KEY UPDATE':''}`,[id])).rows[0];
  if(!board)throw fail(404,'Moodboard no encontrado.');
  if(board.id!==id)throw fail(500,'No se pudo verificar el moodboard.');
  const rows=(await db.query('SELECT id,nombre,orden FROM moodboard_categories WHERE board_id=$1 ORDER BY orden,nombre,id',[id])).rows;
  const seen=new Set();
  const categories=rows.map(row=>{
    if(!positive(row?.id)||seen.has(row.id)||typeof row.nombre!=='string'||!row.nombre.trim()
      ||!Number.isInteger(row.orden)||row.orden< -2147483648||row.orden>2147483647)throw fail(500,'No se pudo verificar la lista de categorías.');
    seen.add(row.id);return{id:row.id,nombre:row.nombre,orden:row.orden};
  });
  return{version:1,board_id:id,revision:storedRevision(board.category_revision),categories};
}
function storageError(error){
  if(error.code==='23505')return fail(409,'Ese nombre de categoría ya existe. Revisá el lote.','MOODBOARD_CATEGORY_NAME_CONFLICT');
  if(['40P01','40001'].includes(error.code))return fail(409,'Otra operación cambió el moodboard. Volvé a leerlo antes de enviar otro lote.','MOODBOARD_CATEGORY_CONFLICT');
  return error;
}

// Point-in-time shared category read. Custom roles retain existing access.
export async function readMoodboardCategorySnapshot(pool,auth,rawBoardId,query={}){
  const observed=actorObservation(auth),id=boardId(rawBoardId);noQuery(query);
  const db=await pool.connect();let discard;
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await currentActor(db,observed,false);
    const result=await snapshot(db,id);
    await db.query('COMMIT');return result;
  }catch(error){try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw storageError(error);}
  finally{db.release(discard);}
}

export async function applyMoodboardCategoryChanges(pool,auth,rawBoardId,body,query={}){
  const observed=actorObservation(auth),id=boardId(rawBoardId);noQuery(query);
  const input=normalizeMoodboardCategoryChanges(body);
  const hash=createHash('sha256').update(JSON.stringify({board_id:id,expected_revision:input.expected_revision,changes:input.changes})).digest('hex');
  const db=await pool.connect();let discard;
  try{
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await db.query('SELECT pg_advisory_xact_lock(20261019,1)');
    await currentActor(db,observed,true);
    const board=(await db.query('SELECT id,category_revision FROM moodboard_boards WHERE id=$1 FOR NO KEY UPDATE',[id])).rows[0];
    if(!board)throw fail(404,'Moodboard no encontrado.');
    const receipt=(await db.query('SELECT board_id,payload_hash,result_revision FROM moodboard_category_operations WHERE actor_user_id=$1 AND request_id=$2',[observed.id,input.request_id])).rows[0];
    if(receipt){
      if(receipt.board_id!==id||receipt.payload_hash!==hash)throw fail(409,'La clave ya corresponde a otro lote.','MOODBOARD_CATEGORY_REPLAY_MISMATCH');
      const result={...await snapshot(db,id),operation:{request_id:input.request_id,replayed:true,result_revision:storedRevision(receipt.result_revision)}};
      await db.query('COMMIT');return result;
    }
    if(storedRevision(board.category_revision)!==input.expected_revision)throw fail(409,'Las categorías cambiaron. Volvé a leerlas antes de guardar.','MOODBOARD_CATEGORY_CONFLICT');
    const rows=(await db.query('SELECT id,nombre,orden FROM moodboard_categories WHERE board_id=$1 ORDER BY id FOR UPDATE',[id])).rows;
    const ids=new Set(rows.map(row=>row.id));
    if(input.changes.some(change=>change.type!=='create'&&!ids.has(change.id)))throw fail(409,'Una categoría ya no pertenece a este moodboard.','MOODBOARD_CATEGORY_CONFLICT');
    const changesById=new Map(input.changes.filter(change=>change.type!=='create').map(change=>[change.id,change]));
    const finalNames=rows.filter(row=>changesById.get(row.id)?.type!=='delete').map(row=>changesById.get(row.id)?.name??row.nombre)
      .concat(input.changes.filter(change=>change.type==='create').map(change=>change.name));
    // Use PostgreSQL's exact existing lower(nombre) index semantics, not JS
    // casing/locale rules. Validate final inventory before any category DML.
    const duplicates=(await db.query('SELECT lower(name) AS normalized FROM unnest($1::text[]) AS proposed(name) GROUP BY lower(name) HAVING count(*)>1',[finalNames])).rows;
    if(duplicates.length)throw fail(409,'Ese nombre de categoría ya existe. Revisá el lote.','MOODBOARD_CATEGORY_NAME_CONFLICT');
    const renames=input.changes.filter(change=>change.type==='rename').sort((a,b)=>a.id-b.id);
    const reserved=rows.map(row=>row.nombre).concat(finalNames),temporary=new Map();
    for(const change of renames){
      let candidate;
      for(let attempt=0;attempt<10;attempt++){
        const proposed=`__render_category_${change.id}_${randomUUID()}`;
        const collision=(await db.query('SELECT EXISTS(SELECT 1 FROM unnest($1::text[]) AS names(name) WHERE lower(name)=lower($2)) AS collision',[reserved,proposed])).rows[0];
        if(collision?.collision===false){candidate=proposed;break;}
      }
      if(!candidate)throw fail(409,'No se pudo reservar el cambio de nombres. Volvé a leer las categorías.','MOODBOARD_CATEGORY_CONFLICT');
      temporary.set(change.id,candidate);reserved.push(candidate);
    }
    for(const change of input.changes.filter(change=>change.type==='delete').sort((a,b)=>a.id-b.id))
      await db.query('DELETE FROM moodboard_categories WHERE id=$1 AND board_id=$2',[change.id,id]);
    for(const change of renames)
      await db.query('UPDATE moodboard_categories SET nombre=$1 WHERE id=$2 AND board_id=$3',[temporary.get(change.id),change.id,id]);
    for(const change of renames)
      await db.query('UPDATE moodboard_categories SET nombre=$1 WHERE id=$2 AND board_id=$3',[change.name,change.id,id]);
    for(const change of input.changes.filter(change=>change.type==='create'))
      await db.query('INSERT INTO moodboard_categories(board_id,nombre,orden) VALUES($1,$2,(SELECT COALESCE(max(orden),0)+1 FROM moodboard_categories WHERE board_id=$1))',[id,change.name]);
    const current=await snapshot(db,id);
    await db.query('INSERT INTO moodboard_category_operations(actor_user_id,request_id,board_id,payload_hash,result_revision) VALUES($1,$2,$3,$4,$5)',[observed.id,input.request_id,id,hash,current.revision]);
    const result={...current,operation:{request_id:input.request_id,replayed:false,result_revision:current.revision}};
    await db.query('COMMIT');return result;
  }catch(error){try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw storageError(error);}
  finally{db.release(discard);}
}

export function createMoodboardCategoriesRouter({pool}){
  const router=express.Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const handle=write=>async(req,res,next)=>{
    try{const result=write?await applyMoodboardCategoryChanges(pool,req.auth,req.params.id,req.body,req.query)
      :await readMoodboardCategorySnapshot(pool,req.auth,req.params.id,req.query);
      res.status(write&&!result.operation.replayed?201:200).json(result);
    }catch(error){if([400,401,403,404,409,428].includes(error.status))return res.status(error.status).json({error:error.message,...(error.code?{code:error.code}:{})});next(error);}
  };
  router.get('/boards/:id/category-snapshot',handle(false));
  router.post('/boards/:id/category-changes',handle(true));
  return router;
}
