import {readDatabaseTarget,isLoopbackAddress} from './startup-policy.js';

export const SCHEDULED_AUTOMATION_JOBS=Object.freeze(['editorial','wilson','supervisor','instagram','instagram_reporte']);
const fail=()=>Object.assign(new Error('La configuración de automatizaciones no está autorizada.'),{code:'AUTOMATION_CONFIGURATION_INVALID'});

// This contract enables only the explicit one-shot worker, never jobs at web
// startup. Trash/deletion is deliberately not an available service.
export function resolveScheduledAutomationPolicy(env={}){
 try{
  const maintenance=env.RENDER_MAINTENANCE;
  if(![undefined,'','false','true'].includes(maintenance))throw fail();
  if(maintenance==='true')return Object.freeze({paused:true,jobs:Object.freeze([])});
  if(env.RENDER_AUTOMATIONS_MODE!=='scheduled-v1')throw fail();
  if(!['direct','session'].includes(env.RENDER_AUTOMATION_CONNECTION_MODE))throw fail();
  if(typeof env.RENDER_AUTOMATION_JOBS!=='string'||!env.RENDER_AUTOMATION_JOBS||env.RENDER_AUTOMATION_JOBS.length>128)throw fail();
  const selected=env.RENDER_AUTOMATION_JOBS.split(',');
  if(new Set(selected).size!==selected.length||selected.some(job=>!SCHEDULED_AUTOMATION_JOBS.includes(job)))throw fail();
  if((env.RENDER_BACKGROUND_JOBS??'')!==''||(env.RENDER_ALLOW_BACKGROUND_WRITES??'false')!=='false'
    ||env.SETUP_DEMO_DATA==='true'||env.TASK_AUTOMATIC_DELETION_ENABLED==='true'||env.TASK_COMPLETED_CLEANUP_ENABLED==='true')throw fail();
  if(![undefined,'','false'].includes(env.MIA_SUPERVISOR_REASONING_ENABLED))throw fail();
  const target=Object.freeze(readDatabaseTarget(env));
  if(target.environment==='production'){
    if(isLoopbackAddress(target.hostname)||target.port!==5432||env.APP_URL!=='https://sistema.rendercorrientes.com')throw fail();
  }else if(!['test','sandbox'].includes(target.environment)||!isLoopbackAddress(target.hostname))throw fail();
  const jobs=Object.freeze(SCHEDULED_AUTOMATION_JOBS.filter(job=>selected.includes(job)));
  if(jobs.includes('supervisor')&&env.MIA_SUPERVISOR_ENABLED!=='true')throw fail();
  return Object.freeze({paused:false,jobs,target,connectionMode:env.RENDER_AUTOMATION_CONNECTION_MODE});
 }catch{throw fail();}
}
