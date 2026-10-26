import test from 'node:test';
import assert from 'node:assert/strict';
import {notificarAsignacionTarea} from '../src/email-notifications.js';

// Real email orchestration, only SQL and SMTP transport are doubled. No DNS,
// network, listener, database, credentials or actual email delivery.
const reasons=['comentario','bloqueada','correcciones'];
function fixture({ids=[2],taskId=87,actorId=9,change=()=>{},lookupFailure=false,legacy=false,sharedInitialEmail=false}={}){
  const calls=[],sends=[];
  const primary=new Error('Synthetic current-membership lookup failure');
  const users=new Map(ids.map(id=>[id,{id,usuario:`qa_${id}`,nombre:`QA ${id}`,email_notificaciones:sharedInitialEmail?'old-shared@example.invalid':`old${id}@example.invalid`,
    active:true,member:true,role:'arbitrary',whatsapp:false}]));
  const task={id:taskId,titulo:'Synthetic private task',propiedades_extra:{workspace:'render_os'}};
  const currentTask={workspace:'render_os',archived:false,trashed:false};
  const candidateSql='SELECT id,usuario,nombre,email_notificaciones FROM usuarios WHERE id=ANY($1::integer[]) AND activo IS TRUE ORDER BY id';
  const pool={async query(raw,params=[]){
    const sql=raw.replace(/\s+/g,' ').trim();calls.push({sql,params:structuredClone(params)});
    assert.doesNotMatch(sql,/\b(BEGIN|COMMIT|ROLLBACK|LOCK)\b|FOR (?:UPDATE|SHARE|KEY SHARE|NO KEY UPDATE)|pg_advisory/i,
      'SMTP must not run under database transactions or locks');
    if(sql===candidateSql){
      assert.deepEqual(params,[[...new Set(ids)]]);
      const rows=[...users.values()].map(({id,usuario,nombre,email_notificaciones})=>({id,usuario,nombre,email_notificaciones}));
      change({users,currentTask,task});return {rows};
    }
    assert.equal(legacy,false,'Historical motives must not acquire new membership policy');
    assert.match(sql,/FROM usuarios recipient/);assert.match(sql,/recipient.activo IS TRUE/);
    assert.match(sql,/recipient.id<>\$3/);assert.match(sql,/JOIN tarea_asignaciones assignment/);
    assert.match(sql,/assignment.usuario_id=recipient.id/);assert.match(sql,/task.id=\$1/);
    assert.match(sql,/propiedades_extra->>'workspace'='render_os'/);
    assert.match(sql,/propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'/);
    assert.match(sql,/propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'/);
    assert.doesNotMatch(sql,/whatsapp|\brol\b|LOWER\(|notification_key|actor_hash/i,
      'Email authorization is ID/membership based, not names, roles or WhatsApp');
    assert.equal(params[0],'87');assert.equal(params[2],actorId);
    if(lookupFailure)throw primary;
    const user=users.get(params[1]);
    const available=user?.active&&user.member&&user.id!==actorId&&currentTask.workspace==='render_os'
      &&![true,'true'].includes(currentTask.archived)&&![true,'true'].includes(currentTask.trashed);
    if(!available)return {rows:[]};
    const {id,usuario,nombre,email_notificaciones}=user;return {rows:[{id,usuario,nombre,email_notificaciones}]};
  }};
  return {calls,sends,users,task,primary,async run(reason='correcciones'){
    return notificarAsignacionTarea({pool,tarea:task,motivo:reason,detalle:'Synthetic correction detail',
      destinatarioIds:ids,actorId,actor:'QA actor',
      env:{SMTP_HOST:'smtp.example.invalid',SMTP_USER:'fixture@example.invalid',SMTP_PASS:'synthetic-not-a-secret'},
      transporter:{async sendMail(message){
        calls.push({sql:'MOCK_SEND',to:message.to});sends.push(message);return {messageId:`synthetic-${sends.length}`};
      }}});
  }};
}
for(const reason of reasons){
  test(`${reason}: membership revoked after candidate selection produces no SMTP send`,async()=>{
    const f=fixture({change:({users})=>{users.get(2).member=false;}}),result=await f.run(reason);
    assert.equal(result.enviado,false);assert.deepEqual(f.sends,[]);assert.equal(f.calls.length,2);
  });
  test(`${reason}: active current ID uses refreshed email/name without role or WhatsApp requirements`,async()=>{
    const f=fixture({change:({users})=>{Object.assign(users.get(2),{
      email_notificaciones:'current@example.invalid',nombre:'Current homonym',role:'not-a-reviewer',whatsapp:false,
    });}}),result=await f.run(reason);
    assert.equal(result.enviado,true);assert.equal(f.sends.length,1);assert.equal(f.sends[0].to,'current@example.invalid');
    assert.ok(f.sends[0].text.includes('Hola Current homonym'));assert.equal(f.calls.length,3);
    assert.match(f.calls[1].sql,/tarea_asignaciones/);assert.equal(f.calls[2].sql,'MOCK_SEND');
  });
}
for(const [label,change] of [
  ['inactive recipient',({users})=>{users.get(2).active=false;}],
  ['removed recipient',({users})=>{users.delete(2);}],
  ['removed email',({users})=>{users.get(2).email_notificaciones=null;}],
  ['other workspace',({currentTask})=>{currentTask.workspace='other';}],
  ['missing workspace',({currentTask})=>{delete currentTask.workspace;}],
  ...[true,'true'].flatMap(flag=>[
    [`archived ${JSON.stringify(flag)}`,({currentTask})=>{currentTask.archived=flag;}],
    [`trashed ${JSON.stringify(flag)}`,({currentTask})=>{currentTask.trashed=flag;}],
  ]),
])test(`current membership query fails closed: ${label}`,async()=>{
  const f=fixture({change}),result=await f.run();assert.equal(result.enviado,false);assert.deepEqual(f.sends,[]);
});
test('actor exclusion uses ID, never display names',async()=>{
  const f=fixture({ids:[9,2],change:({users})=>{users.get(2).nombre='QA actor';}}),result=await f.run();
  assert.equal(result.enviado,true);assert.deepEqual(f.sends.map(m=>m.to),['old2@example.invalid']);
  const checks=f.calls.filter(c=>c.sql.includes('FROM usuarios recipient'));
  assert.equal(checks.length,1);assert.equal(checks[0].params[1],2);
});
for(const taskId of [undefined,null,0,-1,1.2,'01','87x','2147483648',2147483648,Number.MAX_SAFE_INTEGER+1])
  test(`invalid bound task ${String(taskId)} never sends or substitutes a name lookup`,async()=>{
    const f=fixture({taskId});if(taskId===undefined)f.task.id=undefined;
    const result=await f.run();assert.equal(result.enviado,false);assert.deepEqual(f.sends,[]);
    assert.equal(f.calls.some(c=>c.sql.includes('FROM usuarios recipient')),false);
  });
test('captured task ID cannot be rebound by caller mutation while resolving candidates',async()=>{
  const f=fixture({change:({task})=>{task.id=999;}}),result=await f.run();
  assert.equal(result.enviado,true);assert.equal(f.calls.find(c=>c.sql.includes('FROM usuarios recipient')).params[0],'87');
});
test('membership lookup error preserves failure and sends nothing',async()=>{
  const f=fixture({lookupFailure:true});await assert.rejects(f.run(),error=>error===f.primary);assert.deepEqual(f.sends,[]);
});
test('multiple candidates with no remaining eligible IDs return false without empty-result crash',async()=>{
  const f=fixture({ids:[2,3],change:({users})=>{for(const u of users.values())u.member=false;}}),result=await f.run();
  assert.equal(result.enviado,false);assert.deepEqual(f.sends,[]);
});
test('one revoked candidate does not suppress another currently assigned recipient',async()=>{
  const f=fixture({ids:[2,3],change:({users})=>{users.get(2).member=false;users.get(3).email_notificaciones='live3@example.invalid';}});
  const result=await f.run();assert.equal(result.enviado,true);assert.deepEqual(result.destinatarios,['live3@example.invalid']);
});
test('fresh address deduplication happens after independent ID revalidation',async()=>{
  const f=fixture({ids:[2,3],change:({users})=>{for(const u of users.values())u.email_notificaciones='shared@example.invalid';}});
  const result=await f.run();assert.equal(result.enviado,true);assert.equal(f.sends.length,1);
  assert.equal(f.calls.filter(c=>c.sql.includes('FROM usuarios recipient')).length,2);
});
test('shared cached address cannot drop a current ID whose refreshed address is now distinct',async()=>{
  const f=fixture({ids:[2,3],sharedInitialEmail:true,change:({users})=>{
    for(const u of users.values())u.email_notificaciones=`fresh${u.id}@example.invalid`;
  }}),result=await f.run();
  assert.equal(result.enviado,true);assert.deepEqual([...result.destinatarios].sort(),['fresh2@example.invalid','fresh3@example.invalid']);
  assert.equal(f.calls.filter(c=>c.sql.includes('FROM usuarios recipient')).length,2);
});
for(const reason of ['creada','reasignada','revision','aprobada','finalizada'])
  test(`historical motive ${reason} retains existing email routing behavior`,async()=>{
    const f=fixture({legacy:true,taskId:null,change:({users})=>{users.get(2).member=false;}}),result=await f.run(reason);
    assert.equal(result.enviado,true);assert.equal(f.sends[0].to,'old2@example.invalid');
    assert.deepEqual(f.calls.map(c=>c.sql==='MOCK_SEND'?'SEND':'CANDIDATES'),['CANDIDATES','SEND']);
  });
