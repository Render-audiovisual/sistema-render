import {createGraphClient,resolveGraphConfig} from './instagram-graph.js';

export const EXPECTED_META_SCOPES=Object.freeze(['instagram_basic','instagram_manage_insights','instagram_manage_messages',
  'instagram_manage_comments','instagram_content_publish','pages_show_list','pages_read_engagement','pages_manage_posts',
  'pages_messaging','pages_manage_metadata','read_insights','ads_read','ads_management','business_management']);

// Closed DTOs only: never return raw Graph data, URLs, error messages or token hints.
export async function inspectMetaConnection(env=process.env,{fetchImpl=globalThis.fetch}={}){
  const state={configurado:false,valido:null,vence_at:null,sin_vencimiento:false,scopes:[],
    scopes_esperados:[...EXPECTED_META_SCOPES],scopes_faltantes:[...EXPECTED_META_SCOPES],
    paginas:[],paginas_estado:'no_consultado',cuentas_publicitarias:[],cuentas_publicitarias_estado:'no_consultado',errores:[]};
  let config;
  try{config=resolveGraphConfig(env);}catch{state.errores.push('configuracion_no_disponible');return state;}
  state.configurado=true;
  const budget=AbortSignal.timeout(15000);
  const client=createGraphClient(config,{timeoutMs:5000,fetchImpl:(url,options)=>fetchImpl(url,
    {...options,signal:AbortSignal.any([options.signal,budget])})});
  const safeText=(value,fallback)=>{
    if(typeof value!=='string'||[config.token,config.token.slice(0,12),config.token.slice(-12)].some(secret=>value.includes(secret)))return fallback;
    return value.replace(/[\x00-\x1f\x7f]/g,'').slice(0,200);
  };
  try{
    const info=await client.debugToken();
    if(typeof info?.is_valid!=='boolean')throw new Error('Invalid diagnostic');
    state.valido=info.is_valid;
    if(Array.isArray(info.scopes))state.scopes=[...new Set(info.scopes.filter(s=>typeof s==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(s)&&safeText(s,null)===s))].sort();
    state.scopes_faltantes=EXPECTED_META_SCOPES.filter(scope=>!state.scopes.includes(scope));
    if(info.expires_at===0)state.sin_vencimiento=true;
    else if(Number.isSafeInteger(info.expires_at)&&info.expires_at>0&&info.expires_at<253402300800)
      state.vence_at=new Date(info.expires_at*1000).toISOString();
  }catch(error){state.valido=error?.kind==='auth'?false:null;state.errores.push(state.valido===false?'token_invalido':'validacion_no_disponible');return state;}
  if(!state.valido)return state;
  try{
    state.paginas=(await client.listConnectionPages()).filter(p=>/^[1-9]\d{0,39}$/.test(String(p.id))).map(p=>({
      id:String(p.id),nombre:safeText(p.name,'Página'),tiene_instagram:/^[1-9]\d{0,39}$/.test(String(p.instagram_business_account?.id)),tasks_informadas:p.tasks_known===true,
      tasks:[...new Set((Array.isArray(p.tasks)?p.tasks:[]).filter(t=>typeof t==='string'&&/^[A-Z_]{1,50}$/.test(t)&&safeText(t,null)===t))].sort(),
    }));state.paginas_estado='ok';
  }catch{state.paginas_estado='error';state.errores.push('paginas_no_disponibles');}
  try{
    state.cuentas_publicitarias=(await client.listAdAccounts()).filter(a=>/^(?:act_)?[1-9]\d{0,39}$/.test(String(a.id))).map(a=>({
      id:String(a.id),nombre:safeText(a.name,'Cuenta publicitaria'),account_status:Number.isSafeInteger(a.account_status)?a.account_status:null,
    }));state.cuentas_publicitarias_estado='ok';
  }catch{state.cuentas_publicitarias_estado='error';state.errores.push('cuentas_publicitarias_no_disponibles');}
  return state;
}
