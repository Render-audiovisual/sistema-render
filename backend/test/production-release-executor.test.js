import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { executeProductionRelease, productionReleaseScopeHash, productionAssignmentIntentHash } from '../src/production-release-executor.js';
import { securityPolicyFingerprint } from '../src/application-object-security.js';
import { DEPLOYED_MIGRATION_HISTORY } from '../src/deployed-migration-history.js';

const hash = x => createHash('sha256').update(x).digest('hex');
const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']'
  : v && typeof v === 'object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
const H = 'a'.repeat(64), directory = new URL('../migrations/', import.meta.url);
const all = readdirSync(directory).filter(n=>n.endsWith('.sql')).sort();
const migrationNames = all.filter(n=>n>='054_' && !n.startsWith('053_'));
const oldNames = [...all.filter(n=>n<'054_'), ...Object.keys(DEPLOYED_MIGRATION_HISTORY)].sort();
const identity = { database:'render2_local_test',username:'render2_fixture',address:'127.0.0.1',port:55989 };
const date = '2026-10-27T00:00:00.000000Z';
const tables = ['_migrations','tareas','usuarios'].map((name,i)=>({name,oid:String(i+1),filtered:false}));
const column = [{name:'id',type:'integer',notNull:true}];
function input() {
  const assignmentIntent = { choices:[{task_id:1,owner_id:2,collaborator_ids:[3]}], exceptions:[{task_id:4,reason:'Explicit preserve'}] };
  const snapshotBody = {version:1,identity,tables:tables.map(t=>({name:t.name,columns:column,
    rows:t.name==='_migrations'?'58':'1',dataSha256:H,securitySha256:H}))};
  const manifest = {version:2,nodeMajor:24,dependenciesInstalled:true,files:[{path:'backend/src/server.js',sha256:H}],
    directories:['backend'],dependencyProof:{sha256:H},rootPackageSha256:H,sourceRootPackageSha256:H};
  const artifactBytes = Buffer.from(JSON.stringify(manifest));
  const migrations = migrationNames.map(name=>({name,bytes:readFileSync(new URL(name,directory))}));
  const prestate = {...snapshotBody,sha256:hash(JSON.stringify(snapshotBody))};
  const approval = {version:1,purpose:'isolated-rehearsal',environment:'test',identity,
    artifactSha256:hash(artifactBytes),securityPolicyFingerprint,prestate,
    ledger:oldNames.map((nombre,i)=>({id:i+1,nombre,aplicada_at:date})),
    sql:migrations.map(m=>({name:m.name,sha256:hash(m.bytes)})),
    assignmentPlanSha256:productionAssignmentIntentHash(assignmentIntent),expiresAt:'2099-01-01T00:00:00.000Z',
    backup:{sha256:H,snapshotSha256:prestate.sha256,restorationEvidenceSha256:H},
    maintenance:{evidenceSha256:H,writesPaused:true,jobsPaused:true,exclusiveWindow:true},
    config:{sha256:H,verified:true},connectionMode:{mode:'direct',verified:true,evidenceSha256:H},
    artifact:{sourceCommit:'a'.repeat(40),inventorySha256:hash(canonical({files:manifest.files,directories:manifest.directories,
      dependencyProof:manifest.dependencyProof,rootPackageSha256:H,sourceRootPackageSha256:H}))}};
  return {approval:{...approval,scopeSha256:productionReleaseScopeHash(approval)},artifactBytes,migrations,assignmentIntent};
}
const resign = v => {const {scopeSha256,...body}=v.approval;v.approval.scopeSha256=productionReleaseScopeHash(body);return v;};
function harness(options={}) {
  const value = input(), calls=[], ledgerAdds=[]; let connected=0, consumed=0, released, mutated=false, clock=0;
  const db = { async query(sql,params=[]) {
    calls.push({sql,params});
    if(sql==='COMMIT' && options.commitFault)throw Error('PRIVATE_DRIVER_SENTINEL');
    if(sql==='ROLLBACK' && options.rollbackFault)throw Error('PRIVATE_DRIVER_SENTINEL');
    if(sql.includes('current_database() AS database'))return {rows:[options.identity??identity]};
    if(sql.includes('c.relname AS name,c.oid::text AS oid,row_security_active')) {
      if(options.expireAfterLock && calls.some(c=>c.sql.startsWith('LOCK TABLE')))clock=Date.parse('2100-01-01');
      return {rows:options.filtered?tables.map(t=>({...t,filtered:true})):tables};
    }
    if(sql.includes('AS "notNull" FROM pg_attribute'))return {rows:column};
    if(sql.includes('FROM (SELECT encode(sha256')) {
      const n=sql.includes('public."_migrations"')?'58':'1';
      return {rows:[{rows:n,hash:options.changedRows&&mutated&&sql.includes('public."tareas"')?'b'.repeat(64):H}]};
    }
    if(sql.includes("'owner',pg_get_userbyid"))return {rows:[{hash:options.changedPrestate?'b'.repeat(64):H}]};
    if(sql.includes(') AS value FROM pg_class'))return {rows:[{value:{acl:options.changedAcl&&mutated?'changed':'same'}}]};
    if(sql.includes('to_char(aplicada_at'))return {rows:[...value.approval.ledger.map(r=>options.changedLedger?{...r,id:r.id+100}:r),
      ...ledgerAdds.map((nombre,i)=>({id:59+i,nombre,aplicada_at:date}))].sort((a,b)=>a.nombre<b.nombre?-1:1)};
    if(sql.startsWith("SELECT to_regclass('public._migrations')"))return {rows:[{ledger:'_migrations'}]};
    if(sql.startsWith('SELECT id,nombre,aplicada_at FROM public._migrations'))return {rows:options.unknownApplied
      ?[...value.approval.ledger,{id:500,nombre:'999_unknown.sql',aplicada_at:date}]:value.approval.ledger};
    if(sql==='SELECT id FROM public.tareas ORDER BY id')return {rows:(options.newTask?[1,4,5]:[1,4]).map(id=>({id}))};
    if(sql.includes('UNION ALL'))return {rows:[]}; // Catalog inventory is independently unit-tested.
    if(sql.includes('SELECT rolname'))return {rows:[]};
    if(sql.startsWith('-- Prospective only:')&&options.migrationFault)throw Error('PRIVATE_SQL_SENTINEL');
    if(value.migrations.some(m=>m.bytes.toString()===sql)){mutated=true;return {rows:[]};}
    if(sql.startsWith('INSERT INTO public._migrations')){ledgerAdds.push(params[0]);return {rowCount:1,rows:[]};}
    if(sql.includes('SELECT id FROM public.usuarios'))return {rows:(options.inactiveUser?[2]:[2,3]).map(id=>({id}))};
    if(sql.startsWith('SELECT tarea_id FROM public.tarea_asignaciones'))return {rows:options.existingAssignment?[{tarea_id:1}]:[]};
    if(sql.startsWith('INSERT INTO public.tarea_asignaciones'))return {rowCount:options.shortInsert?1:2,rows:[]};
    if(sql.startsWith('SELECT tarea_id,usuario_id,tipo'))return {rows:[{tarea_id:1,usuario_id:2,tipo:'responsable'},
      {tarea_id:1,usuario_id:3,tipo:'colaborador'}]};
    if(sql.startsWith('SELECT count(*)::int AS n'))return {rows:[{n:2}]};
    if(sql.startsWith('SELECT to_regclass($1)'))return {rows:[{oid:tables.find(t=>params[0]===`public."${t.name}"`)?.oid}]};
    if(/^(?:BEGIN|SET LOCAL|LOCK TABLE|SELECT pg_advisory_xact_lock|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
    throw Error('UNEXPECTED_QUERY: '+sql.slice(0,80));
  }, release(e){released=e;if(options.releaseFault)throw Error('PRIVATE_POOL_SENTINEL');} };
  return {value,calls,get connected(){return connected;},get consumed(){return consumed;},get released(){return released;},
    pool:{async connect(){connected++;return db;}}, dependencies:{environment:'test',now:()=>clock,
      async consumeApproval(scope){consumed++;assert.equal(scope.scopeSha256,value.approval.scopeSha256);
        if(options.expireAfterConsume)clock=Date.parse('2100-01-01');return !options.rejectApproval;}}};
}

test('atomic orchestration locks all old tables before hashing; runs exact41, assignments and COMMIT once',async()=>{
  const h=harness();assert.equal(h.value.approval.ledger.length,58);assert.equal(h.value.migrations.length,41);
  const result=await executeProductionRelease(h.pool,h.value,h.dependencies);
  assert.deepEqual(result,{state:'COMMITTED',scopeSha256:h.value.approval.scopeSha256,migrations:41,assignments:2});
  assert.equal(h.connected,1);assert.equal(h.consumed,1);assert.equal(h.released,undefined);
  const sql=h.calls.map(c=>c.sql);
  assert.ok(sql.findIndex(s=>s.startsWith('LOCK TABLE'))<sql.findIndex(s=>s.includes('FROM (SELECT encode(sha256')));
  assert.equal(sql.filter(s=>s.startsWith('BEGIN')).length,1);assert.equal(sql.filter(s=>s==='COMMIT').length,1);
  assert.equal(sql.includes('ROLLBACK'),false);
  assert.ok(sql.findIndex(s=>s.startsWith('INSERT INTO public.tarea_asignaciones'))<sql.indexOf('COMMIT'));
  assert.ok(sql.some(s=>s.includes('__release_xmin'))); // Physical old tuple preservation, not only values.
});

for(const [option,code] of [['changedPrestate','PRESTATE_CHANGED'],['newTask','TASK_UNIVERSE_CHANGED'],
  ['inactiveUser','ASSIGNMENT_USER_UNAVAILABLE'],['existingAssignment','ASSIGNMENTS_EXIST'],
  ['shortInsert','ASSIGNMENT_POSTCONDITION'],['changedRows','OLD_ROWS_CHANGED'],['changedAcl','OLD_SECURITY_CHANGED'],
  ['rejectApproval','APPROVAL_REJECTED'],['migrationFault','RELEASE_ABORTED'],['expireAfterLock','APPROVAL_EXPIRED']]) {
  test(`${option}: fail closed, rollback, no commit or retry`,async()=>{
    const h=harness({[option]:true});
    await assert.rejects(executeProductionRelease(h.pool,h.value,h.dependencies),{code});
    assert.equal(h.connected,1);assert.equal(h.calls.filter(c=>c.sql==='ROLLBACK').length,1);
    assert.equal(h.calls.some(c=>c.sql==='COMMIT'),false);
    if(['changedPrestate','newTask','expireAfterLock'].includes(option))assert.equal(h.consumed,0);
  });
}

for(const [option,code] of [['changedLedger','LEDGER_CHANGED'],['unknownApplied','LEDGER_CHANGED'],
  ['filtered','PRESTATE_CHANGED'],['expireAfterConsume','APPROVAL_EXPIRED']]) {
  test(`${option}: exact ledger, unfiltered snapshot and late expiry are mandatory`,async()=>{
    const h=harness({[option]:true});
    await assert.rejects(executeProductionRelease(h.pool,h.value,h.dependencies),{code});
    assert.equal(h.calls.some(c=>c.sql==='COMMIT'),false);
    assert.equal(h.calls.filter(c=>c.sql==='ROLLBACK').length,1);
  });
}
test('pool release failure cannot leak raw errors or falsify confirmed COMMIT',async()=>{
  const h=harness({releaseFault:true});
  assert.equal((await executeProductionRelease(h.pool,h.value,h.dependencies)).state,'COMMITTED');
});

test('COMMIT uncertainty destroys client, never issues ROLLBACK or retries, strips private errors',async()=>{
  const h=harness({commitFault:true});
  await assert.rejects(executeProductionRelease(h.pool,h.value,h.dependencies),e=>e.code==='OUTCOME_UNKNOWN'&&!JSON.stringify(e).includes('PRIVATE'));
  assert.equal(h.released.code,'DISCARD_RELEASE_CONNECTION');assert.equal(h.calls.some(c=>c.sql==='ROLLBACK'),false);
  assert.equal(h.connected,1);assert.equal(h.consumed,1);
});
test('rollback failure discards client without claiming confirmed rollback',async()=>{
  const h=harness({changedPrestate:true,rollbackFault:true});
  await assert.rejects(executeProductionRelease(h.pool,h.value,h.dependencies));
  assert.equal(h.released.code,'DISCARD_RELEASE_CONNECTION');
});

for(const mutate of [v=>{v.approval.maintenance.jobsPaused=false;},v=>{delete v.approval.backup;},
  v=>{v.approval.backup.snapshotSha256='b'.repeat(64);},v=>{v.approval.connectionMode.mode='transaction';},
  v=>{v.approval.config.verified=false;},v=>{v.approval.securityPolicyFingerprint='b'.repeat(64);},
  v=>{v.approval.environment='production';},v=>{v.approval.artifact.inventorySha256='b'.repeat(64);},
  v=>{v.migrations[0]={name:'051_progreso_edicion_auditable.sql',bytes:Buffer.from('SELECT 1')};},
  v=>{v.migrations[0].bytes=Buffer.from('COMMIT;');},v=>{v.artifactBytes=Buffer.from('{}');}]) {
  test('malformed/missing gate, source/hash drift or historical SQL rejects before connecting',async()=>{
    const h=harness();mutate(h.value);resign(h.value);
    await assert.rejects(executeProductionRelease(h.pool,h.value,h.dependencies));assert.equal(h.connected,0);
  });
}
test('authority consumer and actual environment are mandatory; no boolean JSON authority or relabeling',async()=>{
  const h=harness();
  await assert.rejects(executeProductionRelease(h.pool,h.value,{environment:'test'}),{code:'APPROVAL_CONSUMER_REQUIRED'});
  await assert.rejects(executeProductionRelease(h.pool,h.value,{...h.dependencies,environment:'production'}),{code:'ENVIRONMENT_CHANGED'});
  assert.equal(h.connected,0);
});
test('identity mismatch fails before SQL and intent rejects overlap/name inference',async()=>{
  const h=harness({identity:{...identity,database:'other'}});
  await assert.rejects(executeProductionRelease(h.pool,h.value,h.dependencies),{code:'IDENTITY_CHANGED'});
  assert.equal(h.consumed,0);
  assert.throws(()=>productionAssignmentIntentHash({choices:[{task_id:1,owner_id:'Luciano',collaborator_ids:[]}],exceptions:[]}));
  assert.throws(()=>productionAssignmentIntentHash({choices:[{task_id:1,owner_id:2,collaborator_ids:[]}],exceptions:[{task_id:1,reason:'overlap'}]}));
});
