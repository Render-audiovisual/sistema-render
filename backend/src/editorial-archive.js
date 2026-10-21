import {createHash,randomUUID} from 'node:crypto';
import {editorialPieceIdentity} from './editorial-publication.js';
import {captureEditorialActor,currentEditorialActor} from './editorial-piece-write.js';
import {annotateEditorialEvidence} from './editorial-evidence-read.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const domains=['historia','publicacion'];
const archived=row=>String(row.metadata?.archivado_tablero)==='true';

export function normalizeEditorialArchiveInput(action,body) {
  if(!['archivar','restaurar'].includes(action)||!body||typeof body!=='object'||Array.isArray(body)
    ||Object.keys(body).some(key=>!['request_id','expected_revision','motivo'].includes(key)))throw fail('Operación de archivo inválida.');
  if(!Object.hasOwn(body,'expected_revision')||!Object.hasOwn(body,'request_id'))throw fail('Falta la revisión o el identificador del intento.',428);
  if(!uuid(body.request_id)||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)throw fail('Intento o revisión de archivo inválidos.');
  const motivo=body.motivo??'';
  if(typeof motivo!=='string'||[...motivo].length>1000||motivo.includes('\u0000'))throw fail('Motivo de archivo inválido.');
  return {request_id:body.request_id.toLowerCase(),expected_revision:body.expected_revision,motivo};
}

export function normalizeEditorialArchiveQuery(query={}) {
  if(!query||typeof query!=='object'||Array.isArray(query)
    ||Object.keys(query).some(key=>!['dominio','cliente_id','offset','limit'].includes(key))
    ||!domains.includes(query.dominio))throw fail('Filtro de archivo inválido.');
  function number(value,fallback,min,max) {
    if(value===undefined)return fallback;
    if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value))throw fail('Paginación o cliente inválido.');
    const parsed=Number(value);
    if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw fail('Paginación o cliente inválido.');
    return parsed;
  }
  return {dominio:query.dominio,cliente_id:number(query.cliente_id,null,1,2147483647),
    offset:number(query.offset,0,0,1000000),limit:number(query.limit,20,1,50)};
}

export function editorialArchiveHash(identity,action,input) {
  return createHash('sha256').update(JSON.stringify([identity.domain,identity.id,action,input.expected_revision,input.motivo])).digest('hex');
}

const pieceSelect=identity=>`SELECT p.id,p.cliente_id,p.estado,
    ${identity.domain==='historia'?"'historia'::text":'p.tipo'} AS tipo,
    to_char(p.fecha_programada,'YYYY-MM-DD') AS fecha_programada,p.fecha_publicación_real,
    p.metadata,left(COALESCE(NULLIF(btrim(p.idea),''),left(p.copy,160),''),160) AS titulo,
    c.nombre AS cliente_nombre,c.activo AS cliente_activo,COALESCE(v.revision,0)::text AS revision,v.current_event_id
    FROM ${identity.table} p JOIN clientes c ON c.id=p.cliente_id
    LEFT JOIN editorial_publicacion_versiones v ON v.dominio='${identity.domain}' AND v.pieza_id=p.id`;

function withRevision(row) {
  const revision=Number(row.revision);
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Revisión editorial no representable.');
  return {...row,revision,current_event_id:row.current_event_id??null};
}

async function observedPiece(db,identity,lock=false) {
  const row=(await db.query(`${pieceSelect(identity)} WHERE p.id=$1${lock?' FOR UPDATE OF p':''}`,[identity.id])).rows[0];
  if(!row)throw fail('Pieza no encontrada.',404);
  // A joined version can belong to the pre-wait statement snapshot. Once the
  // piece lock is held, read the trigger-owned version in a fresh RC statement.
  if(lock) {
    const version=(await db.query('SELECT revision,current_event_id FROM editorial_publicacion_versiones WHERE dominio=$1 AND pieza_id=$2',[identity.domain,identity.id])).rows[0];
    row.revision=version?.revision??0;row.current_event_id=version?.current_event_id??null;
  }
  return withRevision(row);
}

async function pieceDto(db,identity,row,alreadyAnnotated=null) {
  const annotated=alreadyAnnotated??(await annotateEditorialEvidence(db,identity.domain,[row]))[0];
  const isArchived=archived(row),active=row.cliente_activo!==false;
  return {id:row.id,dominio:identity.domain,cliente:{id:row.cliente_id,nombre:row.cliente_nombre,activo:active},
    titulo:row.titulo,tipo:row.tipo,estado:row.estado,fecha_programada:row.fecha_programada,revision:row.revision,
    archived:isArchived,can_archive:active&&!isArchived&&row.estado!=='publicada'&&!row.fecha_publicación_real&&!row.current_event_id,
    can_restore:active&&isArchived,publication_classification:annotated.publicacion_evidencia.classification};
}

export async function changeEditorialArchive(pool,auth,domain,rawId,action,body) {
  const identity=editorialPieceIdentity(domain,rawId),input=normalizeEditorialArchiveInput(action,body);
  const observed=captureEditorialActor(auth),db=await pool.connect();let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await db.query('SELECT pg_advisory_xact_lock(20261019, 1)');
    const user=await currentEditorialActor(db,observed,true),hash=editorialArchiveHash(identity,action,input);
    const receipt=(await db.query(`SELECT id,payload_hash,action FROM editorial_archive_events
      WHERE actor_user_id=$1 AND request_id=$2`,[user.id,input.request_id])).rows[0];
    if(receipt&&receipt.payload_hash!==hash)throw fail('Ese intento de archivo ya se usó con otros datos.',409);
    const found=(await db.query(`SELECT cliente_id FROM ${identity.table} WHERE id=$1`,[identity.id])).rows[0];
    if(!found)throw fail('Pieza no encontrada.',404);
    const client=(await db.query('SELECT id,activo FROM clientes WHERE id=$1 FOR SHARE',[found.cliente_id])).rows[0];
    let row=await observedPiece(db,identity,true);
    if(!client||row.cliente_id!==found.cliente_id)throw fail('La pieza cambió de cliente. Actualizá el registro.',409);
    let operation;
    if(receipt) {
      operation={id:receipt.id,request_id:input.request_id,action:receipt.action,replayed:true};
    } else {
      if(client.activo===false)throw fail('El cliente está inactivo. No se cambia su archivo ni se lo reactiva automáticamente.',409);
      if(row.revision!==input.expected_revision)throw fail('La pieza cambió. Actualizá antes de archivar o restaurar.',409);
      if(archived(row)===(action==='archivar'))throw fail('La pieza ya está en ese estado de archivo. Revisá su versión actual.',409);
      if(action==='archivar'&&(row.estado==='publicada'||row.fecha_publicación_real||row.current_event_id)) {
        throw fail('Esta pieza tiene publicación registrada. Se conserva sin archivar para proteger su evidencia.',409);
      }
      await db.query(`UPDATE ${identity.table} SET metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('archivado_tablero',$2::boolean),
        updated_at=clock_timestamp() WHERE id=$1`,[identity.id,action==='archivar']);
      row=await observedPiece(db,identity);
      const id=randomUUID();
      await db.query(`INSERT INTO editorial_archive_events(id,actor_user_id,request_id,payload_hash,dominio,pieza_id,historia_id,publicacion_id,
        action,expected_revision,result_revision,motivo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id,user.id,input.request_id,hash,identity.domain,identity.id,identity.domain==='historia'?identity.id:null,
        identity.domain==='publicacion'?identity.id:null,action,input.expected_revision,row.revision,input.motivo]);
      operation={id,request_id:input.request_id,action,replayed:false};
    }
    const result={version:1,piece:await pieceDto(db,identity,row),operation};
    await db.query('COMMIT');return {status:receipt?200:201,body:result};
  } catch(error) {
    try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}
    throw error;
  } finally {db.release(discard);}
}

export async function readEditorialArchive(pool,auth,query) {
  const filter=normalizeEditorialArchiveQuery(query),identity=editorialPieceIdentity(filter.dominio,'1');
  const observed=captureEditorialActor(auth),db=await pool.connect();let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user=await currentEditorialActor(db,observed,false);
    if(user.rol!=='admin')throw fail('Solo administración puede consultar el archivo editorial.',403);
    const where="metadata->>'archivado_tablero'='true' AND ($1::int IS NULL OR cliente_id=$1)";
    const total=(await db.query(`SELECT count(*)::int AS total FROM ${identity.table} WHERE ${where}`,[filter.cliente_id])).rows[0].total;
    const rows=(await db.query(`${pieceSelect(identity)} WHERE p.metadata->>'archivado_tablero'='true'
      AND ($1::int IS NULL OR p.cliente_id=$1) ORDER BY p.fecha_programada DESC,p.id ASC OFFSET $2 LIMIT $3`,
      [filter.cliente_id,filter.offset,filter.limit])).rows.map(withRevision);
    const annotated=await annotateEditorialEvidence(db,identity.domain,rows);
    const items=await Promise.all(rows.map((row,index)=>pieceDto(db,identity,row,annotated[index])));
    const result={version:1,...filter,total,has_more:total>filter.offset+filter.limit,items};
    // cliente_id is a query context, not part of the public envelope contract.
    delete result.cliente_id;
    await db.query('COMMIT');return result;
  } catch(error) {
    try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}
    throw error;
  } finally {db.release(discard);}
}

export function createEditorialArchiveRouter({express,pool}) {
  const router=express.Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const rejected=(error,res,next)=>[400,401,403,404,409,428].includes(error.status)
    ?res.status(error.status).json({error:error.message}):next(error);
  router.get('/',async(req,res,next)=>{
    try{return res.json(await readEditorialArchive(pool,req.auth,req.query));}catch(error){return rejected(error,res,next);}
  });
  router.post('/:dominio/:id/:action',async(req,res,next)=>{
    try {
      if(Object.keys(req.query??{}).length)throw fail('No se admiten filtros al cambiar el archivo.');
      const result=await changeEditorialArchive(pool,req.auth,req.params.dominio,req.params.id,req.params.action,req.body);
      return res.status(result.status).json(result.body);
    }catch(error){return rejected(error,res,next);}
  });
  return router;
}
