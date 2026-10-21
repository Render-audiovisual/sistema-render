import { createCapturedRequest } from '../shared/session/captured-request.js';

const count = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => count(value) && value > 0 && value <= 2147483647;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw new Error('No se pudo verificar la página de notas.'); };
const obsolete = () => Object.assign(new Error('El contexto cambió. Volvé a abrir la nota.'), {code:'session_binding_obsolete'});
export function normalizeFeedbackNotesSelection({section='clients',papelera=false,categoria=null,q='',limit=50,offset=0,expected_snapshot=null}={}) {
  if (!['clients','team','all'].includes(section) || typeof papelera !== 'boolean' || !(categoria === null || ['general','diseno','web','reunion','contenido'].includes(categoria))
    || typeof q !== 'string' || Array.from(q).length > 200 || /[\u0000-\u001f\u007f]/.test(q) || !count(limit) || limit < 1 || limit > 100 || !count(offset) || offset > 1000000
    || !(expected_snapshot === null || hash(expected_snapshot)) || offset > 0 && !hash(expected_snapshot)) invalid();
  return {section,papelera,categoria,q:q.trim(),limit,offset,expected_snapshot:offset > 0 ? expected_snapshot : null};
}
export function readFeedbackNotesLocation(search) {
  const params = new URLSearchParams(search);
  for (const key of ['section','mode','categoria','q','limit','offset','expected_snapshot','note']) if (params.getAll(key).length > 1) invalid();
  const decimal = (key, fallback) => { const value = params.get(key); if (value === null) return fallback; if (!/^(0|[1-9]\d*)$/.test(value)) invalid(); return Number(value); };
  if (params.has('mode') && params.get('mode') !== 'trash') invalid();
  const note = decimal('note', null); if (note !== null && !positive(note)) invalid();
  return {...normalizeFeedbackNotesSelection({section:params.get('section')??'clients',papelera:params.get('mode')==='trash',categoria:params.get('categoria'),q:params.get('q')??'',limit:decimal('limit',50),offset:decimal('offset',0),expected_snapshot:params.get('expected_snapshot')}),note};
}
export function feedbackNotesLocationUrl(current, selection, note = null) {
  const url = new URL(current), s = normalizeFeedbackNotesSelection(selection);
  if (!['http:','https:'].includes(url.protocol) || !['/feedback','/bloc-notas'].includes(url.pathname) || url.username || url.password || !(note === null || positive(note))) invalid();
  url.searchParams.set('section',s.section);url.searchParams.set('limit',String(s.limit));url.searchParams.set('offset',String(s.offset));
  for (const [key,value] of [['mode',s.papelera?'trash':null],['categoria',s.categoria],['q',s.q||null],['expected_snapshot',s.expected_snapshot],['note',note===null?null:String(note)]]) {
    if (value === null) url.searchParams.delete(key); else url.searchParams.set(key,value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
export function feedbackNotesPageUrl(selection) {
  const s = normalizeFeedbackNotesSelection(selection),params = new URLSearchParams({limit:String(s.limit),offset:String(s.offset),section:s.section,papelera:String(s.papelera)});
  if (s.categoria) params.set('categoria',s.categoria); if (s.q) params.set('q',s.q); if (s.expected_snapshot) params.set('expected_snapshot',s.expected_snapshot);
  return `/api/notas/pagina?${params}`;
}
const noteKeys = ['id','titulo','contenido','categoria','feedback','creado_por','modificado_por','eliminado_at','created_at','updated_at','resolved_client','section'];
export function parseFeedbackNote(item, papelera) {
  if (!closed(item,noteKeys) || !positive(item.id) || ['titulo','contenido','categoria','creado_por','modificado_por','resolved_client'].some(key=>typeof item[key] !== 'string')
    || !['clients','team'].includes(item.section) || (item.section === 'clients') !== Boolean(item.resolved_client.trim())
    || !item.feedback || typeof item.feedback !== 'object' || Array.isArray(item.feedback)
    || !['created_at','updated_at'].every(key=>typeof item[key]==='string'&&Number.isFinite(Date.parse(item[key])))
    || !(item.eliminado_at === null || typeof item.eliminado_at==='string'&&Number.isFinite(Date.parse(item.eliminado_at))) || (item.eliminado_at!==null) !== papelera) invalid();
  const stringFields=['cliente','responsable','referencia','estado','vigencia','flujo','origen','confirmado_por','confirmado_at'];
  const numericFields=['confirmado_por_id','provenance_version'];
  if(Object.keys(item.feedback).some(key=>![...stringFields,...numericFields,'responsables'].includes(key))
    || stringFields.some(key=>Object.hasOwn(item.feedback,key)&&item.feedback[key]!==null&&typeof item.feedback[key]!=='string')
    || numericFields.some(key=>Object.hasOwn(item.feedback,key)&&item.feedback[key]!==null&&!positive(item.feedback[key]))
    || Object.hasOwn(item.feedback,'responsables')&&(!Array.isArray(item.feedback.responsables)||item.feedback.responsables.some(value=>typeof value!=='string')))invalid();
  return {...item,feedback:{...item.feedback,...(item.feedback.responsables?{responsables:[...item.feedback.responsables]}:{})}};
}
export function parseFeedbackNotesPage(value, selection) {
  const s=normalizeFeedbackNotesSelection(selection);
  if (!closed(value,['version','limit','offset','total','has_more','snapshot','context','items']) || value.version!==1 || value.limit!==s.limit || value.offset!==s.offset || !count(value.total)
    || typeof value.has_more!=='boolean' || value.has_more !== (s.offset+s.limit < value.total) || !hash(value.snapshot)
    || s.expected_snapshot !== null && value.snapshot!==s.expected_snapshot || !closed(value.context,['section','papelera','categoria','q'])
    || ['section','papelera','categoria','q'].some(key=>value.context[key]!==s[key]) || !Array.isArray(value.items) || value.items.length!==Math.min(s.limit,Math.max(0,value.total-s.offset))) invalid();
  const items=value.items.map(item=>parseFeedbackNote(item,s.papelera));
  if (new Set(items.map(item=>item.id)).size!==items.length || items.some(item=>s.section!=='all'&&item.section!==s.section || s.categoria!==null&&item.categoria!==s.categoria)) invalid();
  return {...value,context:{...value.context},items};
}
// Callable requests capture account + route once per action, including chained writes.
export function createFeedbackScopedRequest({session,readSession,request,isActive,readContext}) {
  const capture = () => { const context=readContext(); const scope=createCapturedRequest({session,readSession,request,isActive:()=>isActive()&&readContext()===context}); return (url,options)=>scope.request(url,options); };
  const scoped=(url,options)=>capture()(url,options); scoped.capture=capture; return scoped;
}
export function createFeedbackNotesReader({request,onChange}) {
  let generation=0,detailGeneration=0,disposed=false,controller,detailController;
  const invalidate=()=>{generation++;detailGeneration++;controller?.abort();detailController?.abort();};
  return {
    invalidate,
    dispose(){disposed=true;invalidate();},
    async load(selection) {
      const s=normalizeFeedbackNotesSelection(selection);invalidate();const observed=generation;controller=new AbortController();
      const current=()=>!disposed&&observed===generation;
      if (!current()) return;
      onChange({status:'loading',data:null,error:''});
      try { const value=await request(feedbackNotesPageUrl(s),{cache:'no-store',signal:controller.signal}); const data=parseFeedbackNotesPage(value,s);if(current())onChange({status:'ready',data,error:''}); }
      catch(reason){if(current()&&reason?.code!=='session_binding_obsolete')onChange({status:reason?.status===409?'stale':'error',data:null,error:reason.message||'No pudimos cargar las notas.'});}
    },
    async detail(id,papelera) {
      if (!positive(id) || typeof papelera!=='boolean' || disposed) throw obsolete();
      const observed=++detailGeneration;detailController?.abort();detailController=new AbortController();
      const value=await request(`/api/notas/${id}/detalle?papelera=${papelera}`,{cache:'no-store',signal:detailController.signal});
      if(disposed||observed!==detailGeneration)throw obsolete();
      if(!closed(value,['version','item'])||value.version!==1)invalid();const item=parseFeedbackNote(value.item,papelera);if(item.id!==id)invalid();return item;
    },
  };
}
