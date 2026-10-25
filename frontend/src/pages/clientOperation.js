import { productionResultStatus } from './productionResultStatus.js';
const invalidLocation = () => { throw new Error('El enlace de operación del cliente no es válido. Revisá el cliente y el período.'); };
const pgId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
export const validClientOperationPeriod = value => typeof value === 'string' && value.length === 7 && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function clientOperationHref(clientId, period) {
  if (!pgId(clientId) || !validClientOperationPeriod(period)) return null;
  return `/clientes/operacion?cliente=${clientId}&periodo=${period}`;
}

export function readClientOperationLocation(search, today) {
  const params = new URLSearchParams(search), ids = params.getAll('cliente'), periods = params.getAll('periodo');
  if ([...params.keys()].some(key=>/^(cliente|periodo)\[/.test(key))) invalidLocation();
  if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0]) || ids[0].trim() !== ids[0] || !pgId(Number(ids[0])) || periods.length > 1) invalidLocation();
  const period = periods.length ? periods[0] : typeof today === 'string' ? today.slice(0,7) : '';
  if (!validClientOperationPeriod(period)) invalidLocation();
  return Object.freeze({ clientId: Number(ids[0]), period, needsPeriod: periods.length === 0 });
}

export function clientOperationLocationUrl(currentUrl, selection) {
  const href = clientOperationHref(selection?.clientId, selection?.period);
  if (!href) invalidLocation();
  const url = new URL(currentUrl);
  if (url.pathname !== '/clientes/operacion' || !['http:','https:'].includes(url.protocol) || url.username || url.password) invalidLocation();
  url.searchParams.set('cliente',String(selection.clientId)); url.searchParams.set('periodo',selection.period);
  return `${url.pathname}${url.search}${url.hash}`;
}

const invalid = () => { throw new Error('No se pudo verificar el resumen operativo del cliente.'); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const count = value => { if (!Number.isSafeInteger(value) || value < 0) invalid(); return value; };
const id = value => { if (!pgId(value)) invalid(); return value; };
const str = (value, max = 250) => { if (typeof value !== 'string' || value.length > max) invalid(); return value; };
const bool = value => { if (typeof value !== 'boolean') invalid(); return value; };
const uuid = value => { if (typeof value !== 'string' || value.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid(); return value; };
const date = value => {
  if (typeof value !== 'string' || value.length !== 10 || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00Z`); if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== value) invalid(); return value;
};
const nullableDate = value => value === null ? null : date(value);
const instant = value => {
  if(typeof value!=='string'||value.length!==24||!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) invalid();
  return value;
};
const account = value => ({id:id(value?.id),nombre:str(value?.nombre)});
const numbers = (value, keys) => { if (!record(value)) invalid(); return Object.fromEntries(keys.map(key=>[key,count(value[key])])); };
const sum = value => Object.values(value).reduce((n,v)=>n+v,0);
const progress = value => { const result=numbers(value,['total','completed']); if(result.completed>result.total) invalid(); return result; };
function section(value, scope, keys, parseItem, identity) {
  if (!record(value) || value.scope !== scope || !Array.isArray(value.items) || value.items.length > 6) invalid();
  const total=count(value.total), counts=numbers(value.counts,keys), items=value.items.map(parseItem);
  if(items.length>total || bool(value.has_more)!==(total>items.length) || new Set(items.map(identity)).size!==items.length) invalid();
  return {scope,total,counts,items,has_more:value.has_more};
}

// Project only the closed operational DTO. Never retain raw bags or API URLs.
export function parseClientOperation(value, {clientId,period}) {
  if (!record(value) || value.version!==1 || !pgId(clientId) || value.cliente?.id!==clientId || value.periodo!==period || !validClientOperationPeriod(period)) invalid();
  instant(value.generated_at);
  const cliente={...account(value.cliente),activo:bool(value.cliente.activo),rubro:value.cliente.rubro===null?null:str(value.cliente.rubro)};
  const tareas=section(value.tareas,'render_os_cliente_sin_archivo_ni_papelera',['pendiente','en_progreso','en_revision','aprobada','finalizada','otros'], row=>({id:id(row?.id),titulo:str(row.titulo),estado:str(row.estado,80),revision:id(row.revision),fecha_vencimiento:nullableDate(row.fecha_vencimiento),href:`/workspace/tareas?task=${id(row.id)}`}),row=>row.id);
  const proyectos=section(value.proyectos,'compartidos_no_archivados_todos_los_periodos',['no_archivados'], row=>({id:uuid(row?.id),titulo:str(row.titulo),tipo:str(row.tipo,80),estado:str(row.estado,80),revision:id(row.revision),fecha_inicio:nullableDate(row.fecha_inicio),fecha_entrega:nullableDate(row.fecha_entrega),responsable:account(row.responsable),counts:numbers(row.counts,['tareas','finalizadas','hitos','entregables']),href:`/proyectos?proyecto=${uuid(row.id)}&cliente=${clientId}`}),row=>row.id);
  const producciones=section(value.producciones,'visitas_mes_y_banco_pendiente_global',['visitas','videos_registrados','videos_reutilizados','registros_fotos','pendientes_banco_todos_los_periodos','fotos_pendientes_banco_todos_los_periodos'],row=>{
    const fecha=date(row?.fecha); if(!fecha.startsWith(period)) invalid();
    return {id:uuid(row.id),titulo:str(row.titulo),revision:id(row.revision),fecha,videos_registrados:count(row.videos_registrados),registros_fotos:count(row.registros_fotos),resultado_estado:productionResultStatus(row.ultimo_resultado,row.revision),href:`/producciones?visita=${uuid(row.id)}&mes=${period}&cliente=${clientId}`};
  },row=>row.id);
  const classifications=['confirmada_manualmente','historica_sin_confirmacion','no_publicada'];
  const editorial=section(value.editorial,'cohorte_mes_programado_visible',classifications,row=>{
    if(!['historia','publicacion'].includes(row?.domain)) invalid();
    const fecha_programada=date(row.fecha_programada), classification=row.publicacion_evidencia?.classification;
    if(!fecha_programada.startsWith(period) || !classifications.includes(classification)) invalid();
    const revision=count(row.publicacion_evidencia.revision), proof=row.publicacion_evidencia.confirmation;
    if(row.domain==='historia'?row.tipo!=='historia':!['video','reel','carrusel','flyer'].includes(row.tipo)) invalid();
    if(classification==='confirmada_manualmente') {
      if(row.estado!=='publicada'||!record(proof)||revision<1||proof.source!=='manual') invalid();
      uuid(proof.id);id(proof.actor_id);instant(proof.occurred_at);instant(proof.recorded_at);
    } else if(proof!==null) invalid();
    if(classification==='no_publicada' && row.estado==='publicada') invalid();
    return {domain:row.domain,id:id(row.id),titulo:str(row.titulo,160),tipo:str(row.tipo,80),estado:str(row.estado,80),fecha_programada,publication_classification:classification,cliente:{id:clientId,nombre:cliente.nombre}};
  },row=>`${row.domain}:${row.id}`);
  const objetivos=section(value.objetivos,'objetivos_mes_por_grupo_sin_sumar_cuotas',['preparados','por_preparar'],row=>{
    if(!Array.isArray(row?.cuentas)||!row.cuentas.length) invalid();
    const cuentas=row.cuentas.map(account); if(new Set(cuentas.map(x=>x.id)).size!==cuentas.length||!cuentas.some(x=>x.id===clientId)) invalid();
    const quota=numbers(row.quota,['reels','carruseles']), avance={reels:progress(row.progress?.reels),carruseles:progress(row.progress?.carruseles)};
    if(avance.reels.total!==quota.reels||avance.carruseles.total!==quota.carruseles) invalid();
    return {id:row.id===null?null:id(row.id),clave:str(row.clave,200),nombre:str(row.nombre),cuentas,preparado:bool(row.preparado),quota,cuota_actual:row.cuota_actual===null?null:numbers(row.cuota_actual,['reels','carruseles']),cuota_desactualizada:bool(row.cuota_desactualizada),progress:avance,extras:progress(row.extras)};
  },row=>row.clave);
  if(sum(tareas.counts)!==tareas.total || proyectos.counts.no_archivados!==proyectos.total || producciones.counts.visitas!==producciones.total || sum(editorial.counts)!==editorial.total || sum(objetivos.counts)!==objetivos.total) invalid();
  return {version:1,generated_at:value.generated_at,periodo:period,cliente,tareas,proyectos,producciones,editorial,objetivos};
}

export function createClientOperationLoader({capture,onChange}) {
  let generation=0, controller, disposed=false, denied=false;
  async function load(selection) {
    if(disposed||denied) return null;
    const guard=capture(), current=++generation; controller?.abort(); controller=new AbortController();
    const signal=controller.signal, live=()=>!disposed&&!signal.aborted&&generation===current&&guard.current();
    if(!live()) return null;
    onChange({status:'loading',data:null,error:''});
    try {
      if(!clientOperationHref(selection?.clientId,selection?.period)) invalidLocation();
      const raw=await guard.request(`/api/clientes/${selection.clientId}/operacion?periodo=${selection.period}`,{method:'GET',signal});
      if(!live()) return null;
      const data=parseClientOperation(raw,selection); onChange({status:'ready',data,error:''}); return data;
    } catch(error) {
      if(!live()) return null;
      denied=[401,403].includes(error?.status);
      onChange({status:denied?'denied':'error',data:null,error:denied?'Ya no tenés acceso a esta operación.':error?.status===404?'No se encontró este cliente.':'No pudimos verificar el resumen operativo. Reintentá la consulta.'}); return null;
    }
  }
  return Object.freeze({load,cancel(){++generation;controller?.abort();},dispose(){disposed=true;++generation;controller?.abort();}});
}
