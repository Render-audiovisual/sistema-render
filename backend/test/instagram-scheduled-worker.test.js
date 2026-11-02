import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {instagramWorkerEnvironment,runInstagramScheduled} from '../src/instagram-scheduled-worker.js';
const environment=()=>({RENDER_AUTOMATIONS_MODE:'scheduled-v1',RENDER_AUTOMATION_CONNECTION_MODE:'direct',
  RENDER_AUTOMATION_JOBS:'editorial,wilson,supervisor,instagram,instagram_reporte',MIA_SUPERVISOR_ENABLED:'true',
  RENDER_DB_ENVIRONMENT:'test',DATABASE_URL:'postgresql://fixture@127.0.0.1:5432/example'});
test('dedicated worker narrows enabled jobs without changing its input or security controls',()=>{
  const env=environment(),selected=instagramWorkerEnvironment(env);
  assert.equal(selected.RENDER_AUTOMATION_JOBS,'instagram,instagram_reporte');assert.ok(Object.isFrozen(selected));
  assert.equal(instagramWorkerEnvironment({...env,RENDER_AUTOMATION_JOBS:'editorial,instagram'}).RENDER_AUTOMATION_JOBS,'instagram');
  assert.equal(env.RENDER_AUTOMATION_JOBS,'editorial,wilson,supervisor,instagram,instagram_reporte');
  assert.equal(selected.DATABASE_URL,env.DATABASE_URL);
  for(const extra of [{RENDER_AUTOMATION_JOBS:'editorial'},{RENDER_AUTOMATION_CONNECTION_MODE:'transaction'},
    {RENDER_ALLOW_BACKGROUND_WRITES:'true'},{TASK_AUTOMATIC_DELETION_ENABLED:'true'},{SETUP_DEMO_DATA:'true'}])
    assert.throws(()=>instagramWorkerEnvironment({...env,...extra}));
});
test('maintenance is inert and does not access private configuration, factory or sync',async()=>{
  const env={RENDER_MAINTENANCE:'true',get DATABASE_URL(){throw Error('private');}};
  assert.deepEqual(await runInstagramScheduled({env,createPool(){assert.fail('database');},sync(){assert.fail('sync');}}),{state:'PAUSED',jobs:[]});
});
test('CLI help, invalid arguments and maintenance never connect or reveal private configuration',()=>{
  const script=fileURLToPath(new URL('../scripts/run-instagram-automation.js',import.meta.url));
  const invoke=(args,extra={})=>spawnSync(process.execPath,[script,...args],{env:{PATH:process.env.PATH,...extra},encoding:'utf8',timeout:10000});
  assert.equal(invoke(['--help']).status,0);
  for(const args of [[],['run','--force'],['run','editorial']]){
    const r=invoke(args);assert.equal(r.status,1);assert.equal(r.stdout,'');
    assert.equal(r.stderr,'No se pudo actualizar Instagram automáticamente.\n');
  }
  const r=invoke(['run'],{RENDER_MAINTENANCE:'true',DATABASE_URL:'private-invalid'});
  assert.equal(r.status,0);const value=JSON.parse(r.stdout);assert.equal(value.worker,'instagram');assert.equal(value.state,'PAUSED');
  assert.doesNotMatch(r.stdout+r.stderr,/private-invalid/);
});
