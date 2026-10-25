import crypto from 'node:crypto';
import { assertFeedbackBusinessInput } from './feedback-fields.js';
import { SYSTEM_USER_ROLES } from './user-roles.js';
import { normalizeFeedbackResponsibleIds } from '../../shared/feedback-responsibles.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0;
const own = (value,key) => Object.hasOwn(value,key);
const operations = ['crear_feedback','editar_feedback'];
const businessKeys = ['seccion','tipo','cliente','cliente_id','titulo','contenido','detalle','responsable','responsables','responsable_ids','referencia','vigencia','estado','flujo'];
const transportKeys = ['confirmacion_token','confirmado','confirmado_en','idempotency_key','telegram_user_id'];
const stableJson = value => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')}}` : JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(stableJson(value)).digest('hex');
const cleanText = (value,max=20000) => {
  if(typeof value!=='string' || value.length>max || value.includes('\u0000')) throw fail('El texto del feedback es inválido o demasiado largo.');
  return value.trim();
};

export function feedbackVersionIso(value) {
  if(typeof value!=='string')throw fail('Falta expected_updated_at válido.');
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if(!match)throw fail('expected_updated_at debe ser ISO con zona horaria.');
  const [,year,month,day,hour,minute,second,,zone,offsetHour,offsetMinute]=match;
  const calendar=new Date(`${year}-${month}-${day}T00:00:00Z`);
  if(!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10)!==`${year}-${month}-${day}`
    || +hour>23 || +minute>59 || +second>59 || (zone!=='Z' && (+offsetHour>23 || +offsetMinute>59)) || !Number.isFinite(Date.parse(value)))throw fail('expected_updated_at inválido.');
  return new Date(value).toISOString();
}

export function feedbackIdempotencyKey(headers = {}, body = {}) {
  const header=headers['idempotency-key'], payload=body.idempotency_key;
  for(const value of [header,payload]) if(value!==undefined && (typeof value!=='string' || /[\u0000-\u001f\u007f-\u009f]/.test(value) || !value.trim() || [...value.trim()].length>200)) throw fail('idempotency_key debe contener entre 1 y 200 caracteres sin controles.');
  if(header!==undefined && payload!==undefined && header.trim()!==payload.trim()) throw fail('Las claves de idempotencia no coinciden.');
  const key=(header??payload)?.trim();
  if(!key) throw fail('Falta idempotency_key.');
  return key;
}

/** Pure request intent: never merge a live note or consult mutable catalogues. */
export function canonicalFeedbackIntent(input, { operation, targetId = null } = {}) {
  assertFeedbackBusinessInput(input);
  if(!operations.includes(operation) || (operation==='editar_feedback' ? !positive(targetId) : targetId!==null)) throw fail('Operación o feedback inválido.');
  const patch=operation==='editar_feedback';
  const allowed=[...businessKeys,...transportKeys,'permitir_duplicado','feedback',...(patch?['expected_updated_at']:[])];
  if(Object.keys(input).some(key=>!allowed.includes(key))) throw fail('Campos de feedback no permitidos.');
  const source={...input};delete source.feedback;
  if(own(input,'feedback')) {
    if(Object.keys(input.feedback).some(key=>!['cliente','responsable','responsables','responsable_ids','referencia','estado','vigencia','flujo'].includes(key))) throw fail('Campos de feedback no permitidos.');
    for(const [key,value] of Object.entries(input.feedback)) {
      const comparable = candidate => {
        if(key==='responsable_ids')return normalizeFeedbackResponsibleIds(candidate);
        if(key==='responsables') {
          if(!Array.isArray(candidate))throw fail('Responsables inválidos.');
          return [...new Set(candidate.map(item=>cleanText(item,200)))];
        }
        const cleaned=cleanText(candidate);
        return ['estado','vigencia','flujo'].includes(key)?cleaned.toLowerCase():cleaned;
      };
      if(own(source,key) && stableJson(comparable(source[key]))!==stableJson(comparable(value))) throw fail('Campos de feedback contradictorios.');
      source[key]=value;
    }
  }
  const business={};
  for(const key of ['cliente','titulo','contenido','detalle','referencia','vigencia','estado','flujo','seccion','tipo']) if(own(source,key)) business[key]=cleanText(source[key],key==='referencia'?2000:key==='cliente'?200:20000);
  if(own(source,'cliente_id')) {if(!positive(source.cliente_id)) throw fail('Cliente inválido.');business.cliente_id=source.cliente_id;}
  if(own(business,'cliente_id') && own(business,'cliente')) {
    if(business.cliente)throw fail('Elegí cliente_id o cliente, no ambos.');
    delete business.cliente;
  }
  const alias = (canonical,alternate,convert=value=>value) => {
    if(own(business,canonical)) business[canonical]=convert(business[canonical]);
    if(own(business,alternate)) {
      const value=convert(business[alternate]);
      if(own(business,canonical) && stableJson(business[canonical])!==stableJson(value)) throw fail('Aliases de feedback contradictorios.');
      business[canonical]=value;delete business[alternate];
    }
  };
  alias('contenido','detalle');
  alias('seccion','tipo',value=>{
    const clean=value.toLowerCase();
    if(['equipo','interno','reunion','reunión'].includes(clean))return'equipo';
    if(clean==='cliente')return'cliente';
    throw fail('Sección de feedback inválida.');
  });
  if(own(source,'responsables')) {
    if(!Array.isArray(source.responsables)||source.responsables.length>20)throw fail('Responsables inválidos.');
    business.responsables=[...new Set(source.responsables.map(value=>cleanText(value,200)))];
    if(business.responsables.some(value=>!value))throw fail('Responsables inválidos.');
  }
  if(own(source,'responsable')) {
    const value=cleanText(source.responsable,200);
    if(own(business,'responsables') && (business.responsables[0]??'')!==value)throw fail('Aliases de responsables contradictorios.');
    if(!own(business,'responsables'))business.responsables=value?[value]:[];
  }
  // Omission is historical intent, not an empty explicit ID selection. Never
  // consult a mutable catalogue while hashing the client's confirmed intent.
  if(own(source,'responsable_ids'))business.responsable_ids=normalizeFeedbackResponsibleIds(source.responsable_ids);
  for(const [key,values] of [['estado',['pendiente','resuelto']],['vigencia',['puntual','permanente']],['flujo',['feedback']]]) if(own(business,key)) {
    business[key]=business[key].toLowerCase();if(!values.includes(business[key]))throw fail(`El campo ${key} es inválido.`);
  }
  // Flow is fixed by this API, not an independently editable dimension.
  delete business.flujo;
  if(!patch) {
    Object.assign(business,{seccion:'cliente',titulo:'',contenido:'',responsables:[],referencia:'',vigencia:'puntual',estado:'pendiente',...business});
  }
  if(business.seccion==='equipo' && ((business.cliente??'')!=='' || own(business,'cliente_id')))throw fail('Feedback de equipo no puede seleccionar un cliente.');
  if(own(source,'permitir_duplicado') && typeof source.permitir_duplicado!=='boolean')throw fail('permitir_duplicado debe ser booleano.');
  const intent={version:1,operation,target_id:targetId,business,permitir_duplicado:source.permitir_duplicado===true};
  if(patch) {
    intent.expected_updated_at=feedbackVersionIso(source.expected_updated_at);
    if(!Object.keys(business).length)throw fail('No se enviaron cambios de feedback.');
  }
  return intent;
}

export const feedbackIntentHash = intent => hash({contract:'feedback-intent-v1',intent});
export function feedbackConfirmationHash({intent,userId,key}) {
  if(!positive(userId))throw fail('Identidad de feedback inválida.',403);
  return hash({contract:'feedback-confirmation-v1',actor_user_id:userId,idempotency_key:key,intent});
}

/** Lock the exact current human identity, not the transport's display claims. */
export async function lockFeedbackActor(db,wilson,{telegramUserId=null}={}) {
  if(!wilson || !positive(wilson.userId) || wilson.systemActor || !['whatsapp','telegram'].includes(wilson.channel) || typeof wilson.actorId!=='string' || !wilson.actorId)throw fail('Necesitás una identidad humana vinculada.',403);
  if(wilson.channel==='telegram' && telegramUserId!==wilson.userId)throw fail('Telegram sin vínculo explícito actual.',403);
  const user=(await db.query('SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash,whatsapp_habilitado FROM usuarios WHERE id=$1 FOR SHARE',[wilson.userId])).rows[0];
  if(!user || user.activo!==true || !SYSTEM_USER_ROLES.includes(user.rol))throw fail('Usuario inactivo o rol no autorizado para feedback.',403);
  if(wilson.channel==='whatsapp') {
    const actorHash=crypto.createHash('sha256').update(wilson.actorId.replace(/^\+/, '')).digest('hex');
    const mapping=(await db.query('SELECT actor_hash,usuario_id,enabled FROM mia_whatsapp_identities WHERE actor_hash=$1 FOR SHARE',[actorHash])).rows[0];
    if(user.whatsapp_habilitado!==true || !(user.whatsapp_id_hash===actorHash || (mapping?.enabled===true && mapping.usuario_id===user.id)))throw fail('El vínculo de WhatsApp cambió.',403);
    const matches=(await db.query(`SELECT u.id FROM usuarios u WHERE u.whatsapp_habilitado IS TRUE
      AND (u.whatsapp_id_hash=$1 OR EXISTS(SELECT 1 FROM mia_whatsapp_identities i WHERE i.usuario_id=u.id AND i.actor_hash=$1 AND i.enabled IS TRUE))
      ORDER BY u.id FOR SHARE OF u`,[actorHash])).rows;
    if(matches.length!==1 || matches[0].id!==user.id)throw fail('La identidad de WhatsApp es ambigua o cambió.',403);
  }
  return user;
}

export async function findFeedbackReceipt(db,{userId,operation,key,payloadHash}) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['feedback-receipt-v1',userId,operation,key])]);
  const receipt=(await db.query(`SELECT operation,note_id,note_updated_at,committed_at,payload_hash
    FROM feedback_operation_receipts WHERE actor_user_id=$1 AND operation=$2 AND idempotency_key=$3`,[userId,operation,key])).rows[0];
  if(receipt && receipt.payload_hash!==payloadHash)throw fail('Esta clave ya confirmó otra intención de feedback.',409);
  return receipt??null;
}

const noteFields='id,titulo,contenido,categoria,feedback,creado_por,modificado_por,created_at,updated_at';
export async function feedbackReplayResponse(db,receipt) {
  const row=(await db.query(`SELECT ${noteFields},eliminado_at FROM notas_compartidas WHERE id=$1`,[receipt.note_id])).rows[0];
  const minimal={operation:receipt.operation,note_id:receipt.note_id,note_updated_at:receipt.note_updated_at,committed_at:receipt.committed_at};
  return {idempotent:true,...(receipt.operation==='crear_feedback'?{created:false}:{updated:false}),feedback_id:receipt.note_id,receipt:minimal,
    feedback:row&&!row.eliminado_at?feedbackNoteDto(row):null,
    ...(row ? row.eliminado_at?{archived:true}:{result_current:true} : {deleted:true})};
}

export function feedbackNoteDto(row) {
  const result={};
  for(const key of noteFields.split(','))if(key!=='feedback' && (row[key]===null || ['string','number'].includes(typeof row[key]) || row[key] instanceof Date))result[key]=row[key];
  result.feedback={};
  const metadata=row.feedback??{};
  for(const key of ['cliente','responsable','referencia','estado','vigencia','flujo','origen','confirmado_por','confirmado_por_id','confirmado_at','provenance_version'])if(metadata[key]===null || ['string','number'].includes(typeof metadata[key]))result.feedback[key]=metadata[key];
  if(Array.isArray(metadata.responsables))result.feedback.responsables=metadata.responsables.filter(value=>typeof value==='string');
  if(own(metadata,'responsable_ids')){
    try{result.feedback.responsable_ids=normalizeFeedbackResponsibleIds(metadata.responsable_ids);}
    catch{throw fail('No se pudieron verificar los responsables almacenados del feedback.',500);}
  }
  return result;
}

export async function insertFeedbackReceipt(db,{userId,operation,key,payloadHash,note}) {
  return (await db.query(`INSERT INTO feedback_operation_receipts(actor_user_id,operation,idempotency_key,payload_hash,note_id,note_updated_at)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING operation,note_id,note_updated_at,committed_at`,[userId,operation,key,payloadHash,note.id,note.updated_at])).rows[0];
}
