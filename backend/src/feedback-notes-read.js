import { createHash } from 'node:crypto';
import { normalizeFeedbackText, resolveFeedbackClient, isClientFeedback } from '../../shared/feedback-client.mjs';

const fail=(status,message,code)=>Object.assign(new Error(message),{status,...(code?{code}:{})});
const positive=value=>Number.isSafeInteger(value)&&value>0;
const categories=new Set(['general','diseno','web','reunion','contenido']);
const sections=new Set(['all','clients','team']);
const hashPattern=/^[0-9a-f]{64}$/;
function actorObservation(auth){
  if(!positive(auth?.id)||auth.id>2147483647||!positive(auth?.session_version)||auth.session_version>2147483647
    ||typeof auth?.rol!=='string'||!auth.rol.trim())throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
  return Object.freeze({id:auth.id,session_version:auth.session_version,rol:auth.rol});
}
function recordId(value){
  if(typeof value==='number'&&positive(value))return value;
  if(typeof value==='string'&&/^[1-9]\d*$/.test(value)&&positive(Number(value))&&String(Number(value))===value)return Number(value);
  throw fail(400,'Nota inválida.');
}
function integer(value,fallback,max){
  if(value===undefined)return fallback;
  if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value)||String(Number(value))!==value||!Number.isSafeInteger(Number(value))||Number(value)>max)throw fail(400,'Paginación inválida.');
  return Number(value);
}
function mode(value){if(value===undefined||value==='false')return false;if(value==='true')return true;throw fail(400,'Papelera inválida.');}
function queryObject(query,allowed){
  if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(key=>!allowed.includes(key)))throw fail(400,'Parámetros de notas inválidos.');
  for(const key of Object.keys(query))if(typeof query[key]!=='string')throw fail(400,'Cada parámetro debe ser un único texto.');
}
export function normalizeFeedbackNotesQuery(query={},legacy=false){
  queryObject(query,legacy?['papelera','categoria','q']:['limit','offset','expected_snapshot','section','papelera','categoria','q']);
  const limit=legacy?500:integer(query.limit,50,100),offset=legacy?0:integer(query.offset,0,1000000);
  if(limit<1)throw fail(400,'El límite debe ser positivo.');
  const section=legacy?'all':query.section??'all';if(!sections.has(section))throw fail(400,'Sección inválida.');
  const papelera=mode(query.papelera),categoria=query.categoria??null;
  if(categoria!==null&&!categories.has(categoria))throw fail(400,'Categoría de nota inválida.');
  const q=(query.q??'').trim();
  if(Array.from(query.q??'').length>200||/[\u0000-\u001f\u007f]/.test(query.q??''))throw fail(400,'La búsqueda debe tener hasta 200 caracteres sin controles.');
  const expected=query.expected_snapshot??null;
  if(expected!==null&&(expected.length!==64||!hashPattern.test(expected)))throw fail(400,'Observación de notas inválida.','FEEDBACK_NOTES_SNAPSHOT_INVALID');
  if(offset>0&&!expected)throw fail(428,'Actualizá las notas desde el principio antes de seguir.','FEEDBACK_NOTES_SNAPSHOT_REQUIRED');
  return Object.freeze({limit,offset,expected,context:Object.freeze({section,papelera,categoria,q})});
}
function instant(value,nullable=false){
  if(nullable&&value===null)return null;
  if(typeof value!=='string'||value.length!==27||!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)
    ||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw fail(500,'No se pudo verificar la fecha de una nota.');
  return value;
}
export function feedbackNoteMetadataDto(value){
  const feedback={};
  if(value!==null&&value!==undefined&&(typeof value!=='object'||Array.isArray(value)))throw fail(500,'No se pudo verificar el feedback.');
  const source=value??{};
  for(const key of ['cliente','responsable','referencia','estado','vigencia','flujo','origen','confirmado_por','confirmado_at']){
    if(!Object.hasOwn(source,key))continue;
    if(source[key]!==null&&typeof source[key]!=='string')throw fail(500,'No se pudo verificar el feedback.');
    feedback[key]=source[key];
  }
  for(const key of ['confirmado_por_id','provenance_version']){
    if(!Object.hasOwn(source,key))continue;
    if(source[key]!==null&&!positive(source[key]))throw fail(500,'No se pudo verificar el origen del feedback.');
    feedback[key]=source[key];
  }
  if(Object.hasOwn(source,'responsables')){
    if(!Array.isArray(source.responsables)||source.responsables.some(value=>typeof value!=='string'))throw fail(500,'No se pudo verificar los responsables.');
    feedback.responsables=[...source.responsables];
  }
  return feedback;
}
function dto(row){
  if(!row||!positive(row.id)||!categories.has(row.categoria)||['titulo','contenido','creado_por','modificado_por'].some(key=>typeof row[key]!=='string'))throw fail(500,'No se pudo verificar una nota.');
  const feedback=feedbackNoteMetadataDto(row.feedback);
  return{id:row.id,titulo:row.titulo,contenido:row.contenido,categoria:row.categoria,feedback,
    creado_por:row.creado_por,modificado_por:row.modificado_por,eliminado_at:instant(row.eliminado_at,true),
    created_at:instant(row.created_at),updated_at:instant(row.updated_at)};
}
const projection=`id,titulo,contenido,categoria,feedback,creado_por,modificado_por,
  to_char(eliminado_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS eliminado_at,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;
const modeSql='(($1::boolean AND eliminado_at IS NOT NULL) OR (NOT $1::boolean AND eliminado_at IS NULL))';
async function clientCatalog(db,papelera){
  const rows=(await db.query(`SELECT nombre FROM clientes
    UNION SELECT feedback->>'cliente' AS nombre FROM notas_compartidas WHERE ${modeSql}
      AND jsonb_typeof(feedback->'cliente')='string' ORDER BY nombre`,[papelera])).rows;
  if(rows.some(row=>typeof row.nombre!=='string'))throw fail(500,'No se pudo verificar el catálogo de clientes.');
  return [...new Set(rows.map(row=>row.nombre).filter(Boolean))].sort((left,right)=>left.localeCompare(right,'es'));
}
function classified(row,catalog){
  return{...row,resolved_client:resolveFeedbackClient(row,catalog),section:isClientFeedback(row,catalog)?'clients':'team'};
}
async function transaction(pool,observed,read){
  const db=await pool.connect();let discard;
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor=(await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1',[observed.id])).rows[0];
    if(!actor||actor.id!==observed.id||actor.activo!==true||actor.session_version!==observed.session_version||actor.rol!==observed.rol)throw fail(401,'La sesión cambió. Volvé a iniciar sesión.');
    const result=await read(db);await db.query('COMMIT');return result;
  }catch(error){try{await db.query('ROLLBACK');}catch(rollback){discard=rollback;}throw error;}
  finally{db.release(discard);}
}
async function page(pool,observed,selection){
  return transaction(pool,observed,async db=>{
    const {limit,offset,expected,context}=selection,catalog=await clientCatalog(db,context.papelera);
    const digest=createHash('sha256').update(JSON.stringify({version:1,actor:observed,context,catalog}));
    const search=normalizeFeedbackText(context.q),items=[];let total=0,cursor=null;
    while(true){
      const rows=(await db.query(`SELECT ${projection} FROM notas_compartidas WHERE ${modeSql}
        AND ($2::timestamptz IS NULL OR (updated_at,id)<($2::timestamptz,$3::bigint))
        ORDER BY updated_at DESC,id DESC LIMIT 500`,[context.papelera,cursor?.updated_at??null,cursor?.id??null])).rows;
      if(rows.length>500)throw fail(500,'No se pudo verificar el lote de notas.');
      for(const raw of rows){
        const note=dto(raw);
        if((note.eliminado_at!==null)!==context.papelera)throw fail(500,'No se pudo verificar la colección de notas.');
        if(cursor&&(note.updated_at>cursor.updated_at||note.updated_at===cursor.updated_at&&note.id>=cursor.id))throw fail(500,'El orden de notas no es válido.');
        cursor={updated_at:note.updated_at,id:note.id};
        const item=classified(note,catalog);
        if(context.section!=='all'&&item.section!==context.section||context.categoria&&item.categoria!==context.categoria)continue;
        const searchable=[item.titulo,item.contenido,item.categoria,item.creado_por,item.modificado_por,item.resolved_client,...Object.values(item.feedback)].join(' ');
        if(!normalizeFeedbackText(searchable).includes(search))continue;
        digest.update('\n'+JSON.stringify(item));
        if(total>=offset&&items.length<limit)items.push(item);
        total++;if(!Number.isSafeInteger(total))throw fail(500,'La cantidad de notas no es válida.');
      }
      if(rows.length<500)break;
    }
    const snapshot=digest.update('\n'+String(total)).digest('hex');
    if(expected&&expected!==snapshot)throw fail(409,'Las notas cambiaron. Actualizá desde el principio.','FEEDBACK_NOTES_SNAPSHOT_CHANGED');
    return{version:1,limit,offset,total,has_more:offset+items.length<total,snapshot,context,items};
  });
}
export async function readFeedbackNotesPage(pool,auth,query={}){
  const observed=actorObservation(auth),selection=normalizeFeedbackNotesQuery(query);
  return page(pool,observed,selection);
}
// Private compatibility limit: canonical callers cannot select this cap or
// bypass snapshot preconditions through a public query flag.
export async function readLegacyFeedbackNotes(pool,auth,query={}){
  const observed=actorObservation(auth),selection=normalizeFeedbackNotesQuery(query,true);
  return page(pool,observed,selection);
}
export async function readFeedbackNoteDetail(pool,auth,rawId,query={}){
  const observed=actorObservation(auth),id=recordId(rawId);queryObject(query,['papelera']);const papelera=mode(query.papelera);
  return transaction(pool,observed,async db=>{
    const catalog=await clientCatalog(db,papelera);
    const row=(await db.query(`SELECT ${projection} FROM notas_compartidas WHERE ${modeSql} AND id=$2`,[papelera,id])).rows[0];
    if(!row)throw fail(404,'La nota no está disponible en esta colección.');
    const item=dto(row);if(item.id!==id||(item.eliminado_at!==null)!==papelera)throw fail(500,'No se pudo verificar la nota.');
    return{version:1,item:classified(item,catalog)};
  });
}
