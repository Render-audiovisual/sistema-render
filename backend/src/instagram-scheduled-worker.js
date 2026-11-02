import {resolveScheduledAutomationPolicy} from './scheduled-automation-policy.js';
import {runScheduledAutomations} from './scheduled-automation-runner.js';
import {runInstagramSync} from './instagram-sync.js';

// Narrow an already authorized job list, never enable a disabled integration.
// Preserve maintenance, database identity, TLS and the shared scheduler mutex.
export function instagramWorkerEnvironment(env) {
  const policy=resolveScheduledAutomationPolicy(env);
  if(policy.paused)return Object.freeze({RENDER_MAINTENANCE:'true'});
  if(!policy.jobs.includes('instagram'))throw new Error('Instagram automático no está habilitado.');
  return Object.freeze({...env,RENDER_AUTOMATION_JOBS:'instagram'});
}

async function createInstagramPool(env) {
  const [{AuthorityBoundPool},{buildDatabasePoolConfig}]=await Promise.all([
    import('./database-authority-context.js'),import('./database-transport.js'),
  ]);
  const config=buildDatabasePoolConfig(env);
  if(!config)throw new Error('Destino requerido');
  return new AuthorityBoundPool({...config,max:4,query_timeout:120000,statement_timeout:110000,
    lock_timeout:10000,idleTimeoutMillis:1000});
}

export async function runInstagramScheduled({env=process.env,now,createPool,sync=runInstagramSync}={}) {
  const selected=instagramWorkerEnvironment(env);
  return runScheduledAutomations({env:selected,...(now?{now}:{}),
    createPool:createPool??(()=>createInstagramPool(selected)),
    handlers:{instagram:async(pool,{now})=>{
      await sync(pool,{now,env:{META_SYSTEM_USER_TOKEN:selected.META_SYSTEM_USER_TOKEN,
        META_GRAPH_VERSION:selected.META_GRAPH_VERSION,META_BUSINESS_ID:selected.META_BUSINESS_ID}});
    }},
  });
}
