import test from 'node:test';
import assert from 'node:assert/strict';
import {notificarAsignacionTarea} from '../src/email-notifications.js';
import {encolarNotificacionPrivadaTarea} from '../src/private-task-notifications.js';

const task={id:254,revision:3,titulo:'QA254 state notice',estado:'en_revision',
  updated_at:'2026-10-24T12:00:00Z',propiedades_extra:{workspace:'render_os'}};
const smtp={SMTP_HOST:'smtp.example.invalid',SMTP_USER:'qa@example.invalid',SMTP_PASS:'synthetic-only'};
function fixture(channel,candidate){
  const queries=[],deliveries=[];
  const pool={async query(sql,params=[]){
    queries.push({sql,params});
    if(/\bFROM usuarios\b/.test(sql)){
      assert.doesNotMatch(sql,/id\s*=\s*ANY/i,'Legacy recipient selection must remain label-based');
      return{rows:[{...candidate}]};
    }
    if(sql.includes('INSERT INTO mia_private_task_notifications')){
      deliveries.push({recipient:params[2],params});return{rows:[{id:1,fingerprint:params[0]}]};
    }
    assert.fail('Unexpected notifier query');
  }};
  const notifier=channel==='email'?notificarAsignacionTarea:encolarNotificacionPrivadaTarea;
  const invoke=(options={})=>notifier({pool,tarea:task,motivo:'revision',nombresDestinatarios:[candidate.nombre],
    actor:'Franco',env:smtp,...(channel==='email'?{transporter:{async sendMail(mail){
      deliveries.push({recipient:mail.to});return{messageId:'synthetic-mail'};
    }}}:{}),...options});
  return{invoke,queries,deliveries};
}
for(const channel of ['email','private']){
  test(`${channel}: legacy recipient homonym is notified when its ID differs from the supplied actor ID`,async()=>{
    const f=fixture(channel,{id:12,usuario:'qa_other_franco',nombre:'Franco',email_notificaciones:'other@example.invalid'});
    const result=await f.invoke({actorId:11});
    assert.equal(result[channel==='email'?'enviado':'encolado'],true);
    assert.deepEqual(f.deliveries.map(row=>row.recipient),[channel==='email'?'other@example.invalid':'qa_other_franco']);
    assert.ok(f.queries.some(({sql})=>/SELECT\s+id\s*,\s*usuario\s*,\s*nombre/.test(sql)), 'Legacy lookup projects the DB identity');
    if(channel==='private'){
      const details=JSON.parse(f.deliveries[0].params[7]);
      assert.equal(details.destinatario_usuario_id,12,'Unique label lookup now retains its resolved identity for delivery validation');
      assert.equal(details.actor_usuario_id,11);
      assert.equal(details.actor,'Franco');
    }
  });
  test(`${channel}: same actor ID is excluded despite a different current name and username`,async()=>{
    const f=fixture(channel,{id:11,usuario:'renamed_account',nombre:'Renamed person',email_notificaciones:'renamed@example.invalid'});
    const result=await f.invoke({actorId:11});
    assert.equal(result[channel==='email'?'enviado':'encolado'],false);assert.deepEqual(f.deliveries,[]);
  });
  for(const actorId of [0,'11',null])test(`${channel}: provided invalid actor ID ${JSON.stringify(actorId)} rejects400 before lookup or dispatch`,async()=>{
    const f=fixture(channel,{id:12,usuario:'qa_other',nombre:'Other',email_notificaciones:'other@example.invalid'});
    await assert.rejects(f.invoke({actorId}),{status:400});
    assert.deepEqual(f.queries,[]);assert.deepEqual(f.deliveries,[]);
  });
  test(`${channel}: supplied actor ID never falls back to names when the selected legacy row has no valid numeric ID`,async()=>{
    for(const id of [undefined,null,0,'12']){
      const f=fixture(channel,{id,usuario:'qa_other',nombre:'Other',email_notificaciones:'other@example.invalid'});
      const result=await f.invoke({actorId:11});
      assert.equal(result[channel==='email'?'enviado':'encolado'],false);assert.deepEqual(f.deliveries,[]);
    }
  });
  test(`${channel}: omitted actor ID preserves legacy name-based author exclusion`,async()=>{
    const f=fixture(channel,{id:12,usuario:'qa_other_franco',nombre:'Franco',email_notificaciones:'other@example.invalid'});
    const result=await f.invoke();
    assert.equal(result[channel==='email'?'enviado':'encolado'],false);assert.deepEqual(f.deliveries,[]);
  });
}
