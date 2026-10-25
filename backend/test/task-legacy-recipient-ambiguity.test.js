import test from 'node:test';
import assert from 'node:assert/strict';
import {buscarDestinatario,notificarAsignacionTarea} from '../src/email-notifications.js';
import {encolarNotificacionPrivadaTarea} from '../src/private-task-notifications.js';

const person=(id,usuario,nombre,email=`qa${id}@example.invalid`)=>({id,usuario,nombre,activo:true,email_notificaciones:email});
const task={id:261,titulo:'QA261 legacy identity',revision:2,updated_at:'2026-10-24T12:00:00Z',propiedades_extra:{workspace:'render_os'}};
const env={SMTP_HOST:'smtp.example.invalid',SMTP_USER:'qa@example.invalid',SMTP_PASS:'synthetic-only'};
function fixture(rows){
  const queries=[],mail=[],queue=[];
  const pool={async query(sql,params=[]){
    queries.push({sql,params});
    if(/\bFROM usuarios\b/.test(sql)){
      assert.match(sql,/activo IS TRUE/,'Legacy lookup must retain active-user restriction');
      assert.doesNotMatch(sql,/id\s*=\s*ANY/i,'These cases exercise legacy labels, not the explicit-ID path');
      return{rows:rows.filter(row=>row.activo===true&&(!/email_notificaciones IS NOT NULL/.test(sql)||row.email_notificaciones!==null)).map(row=>({...row}))};
    }
    if(sql.includes('INSERT INTO mia_private_task_notifications')){
      queue.push(params);return{rows:[{id:queue.length,fingerprint:params[0]}]};
    }
    assert.fail('Unexpected query in legacy notifier test');
  }};
  const send=(channel,labels,options={})=>(channel==='email'?notificarAsignacionTarea:encolarNotificacionPrivadaTarea)({
    pool,tarea:task,nombresDestinatarios:labels,motivo:'revision',env,actor:'Unrelated actor',actorId:99,
    ...(channel==='email'?{transporter:{async sendMail(value){mail.push(value);return{messageId:'synthetic'};}}}:{}),...options});
  return{pool,queries,mail,queue,send};
}
const ambiguous=[
  ['homonym','Shared',[person(12,'first','Shared'),person(13,'second','Shared')]],
  ['username/name collision','shared',[person(12,'shared','Different'),person(13,'second','Shared')]],
];
for(const [kind,label,rows]of ambiguous)for(const reversed of [false,true]){
  test(`email resolver skips ${kind}, independent of database row order (${reversed})`,async()=>{
    const f=fixture(reversed?[...rows].reverse():rows);
    assert.equal(await buscarDestinatario(f.pool,label),null);
  });
  for(const channel of ['email','private'])test(`${channel} skips ambiguous ${kind} without first-match or fanout (${reversed})`,async()=>{
    const f=fixture(reversed?[...rows].reverse():rows),result=await f.send(channel,[label]);
    assert.equal(result[channel==='email'?'enviado':'encolado'],false);
    assert.deepEqual(f.mail,[]);assert.deepEqual(f.queue,[]);
    assert.equal(f.queries.filter(({sql})=>sql.includes('INSERT')).length,0);
  });
}
test('email ambiguity is identity ambiguity even if only one homonym has an email address',async()=>{
  const f=fixture([person(12,'first','Shared'),person(13,'second','Shared',null)]);
  assert.equal(await buscarDestinatario(f.pool,'Shared'),null);
});
for(const channel of ['email','private']){
  test(`${channel}: only unique active candidate is notified; inactive homonym does not introduce ambiguity`,async()=>{
    const f=fixture([person(12,'first','Shared'),{...person(13,'second','Shared'),activo:false}]);
    assert.equal((await f.send(channel,['Shared']))[channel==='email'?'enviado':'encolado'],true);
    if(channel==='email')assert.deepEqual(f.mail.map(row=>row.to),['qa12@example.invalid']);
    else assert.deepEqual(f.queue.map(params=>params[2]),['first']);
  });
  test(`${channel}: lider aliases match only the unique username, never another person's display name`,async()=>{
    const leader=person(12,'lider','Actual leader'),f=fixture([person(13,'other','Agustín'),person(14,'third','Lider'),leader]);
    assert.equal((await f.send(channel,['Agus','Agustín','lider']))[channel==='email'?'enviado':'encolado'],true);
    assert.equal(channel==='email'?f.mail.length:f.queue.length,1);
    if(channel==='email')assert.equal(f.mail[0].to,leader.email_notificaciones);else assert.equal(f.queue[0][2],'lider');
  });
  test(`${channel}: duplicate candidate rows for the same ID are not ambiguous and repeated labels dispatch once`,async()=>{
    const row=person(12,'first','Shared'),f=fixture([row,{...row}]);
    assert.equal((await f.send(channel,['Shared','first','SHARED']))[channel==='email'?'enviado':'encolado'],true);
    assert.equal(channel==='email'?f.mail.length:f.queue.length,1);
  });
  test(`${channel}: two distinct IDs using lider username fail closed rather than selecting first`,async()=>{
    const f=fixture([person(12,'lider','One'),person(13,'LIDER','Two')]);
    assert.equal((await f.send(channel,['Agus']))[channel==='email'?'enviado':'encolado'],false);
    assert.deepEqual(f.mail,[]);assert.deepEqual(f.queue,[]);
  });
  test(`${channel}: empty labels never resolve a user whose display name is empty`,async()=>{
    const f=fixture([person(12,'first','')]);
    assert.equal((await f.send(channel,['','   ',null]))[channel==='email'?'enviado':'encolado'],false);
    assert.deepEqual(f.mail,[]);assert.deepEqual(f.queue,[]);
  });
  test(`${channel}: actor ID exclusion is unchanged and does not resolve an ambiguous recipient using the actor`,async()=>{
    const same=fixture([person(12,'renamed','New label')]);
    assert.equal((await same.send(channel,['New label'],{actorId:12,actor:'Old name'}))[channel==='email'?'enviado':'encolado'],false);
    const other=fixture([person(12,'first','Shared')]);
    assert.equal((await other.send(channel,['Shared'],{actorId:13,actor:'Shared'}))[channel==='email'?'enviado':'encolado'],true);
    const legacy=fixture([person(12,'first','Shared')]);
    assert.equal((await legacy.send(channel,['Shared'],{actorId:undefined,actor:'Shared'}))[channel==='email'?'enviado':'encolado'],false);
    const ambiguousActor=fixture([person(13,'second','Shared'),person(12,'first','Shared')]);
    assert.equal((await ambiguousActor.send(channel,['Shared'],{actorId:12}))[channel==='email'?'enviado':'encolado'],false);
    assert.deepEqual(ambiguousActor.mail,[]);assert.deepEqual(ambiguousActor.queue,[]);
  });
}
test('email direct resolver does not resolve empty normalized labels',async()=>{
  for(const label of ['', '   ',null,undefined])assert.equal(await buscarDestinatario(fixture([person(12,'first','')]).pool,label),null);
});
