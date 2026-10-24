import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTaskNotificationEligibilityPredicate, taskNotificationEligible } from '../src/task-notification-eligibility.js';
import { supervisorNotificationDeliverable } from '../src/mia-supervisor.js';

const notice = patch => ({ id:31,tarea_id:'9',destinatario_clave:'qa_recipient',motivo:'comentario',
  detalles:{destinatario_usuario_id:12,actor_usuario_id:7},...patch });
const never = { query:async()=>assert.fail('Legacy/invalid input must not query DB') };
const sql = buildTaskNotificationEligibilityPredicate('n');

// SQL contracts plus real JS/route behavior; database results alone are mocked.
// These unit tests do not claim PostgreSQL predicate execution or actual sends.
test('shared SQL binds active WhatsApp-enabled ID, allows own username/alias, rejects both foreign key collisions',()=>{
  assert.match(sql,/jsonb_typeof\(n.detalles\) = 'object'/);
  assert.match(sql,/n.detalles \? 'destinatario_usuario_id'/);
  assert.match(sql,/jsonb_typeof\(n.detalles->'destinatario_usuario_id'\) = 'number'/);
  assert.match(sql,/recipient.id > 0 AND to_jsonb\(recipient.id\) = n.detalles->'destinatario_usuario_id'/);
  assert.match(sql,/recipient.activo IS TRUE AND recipient.whatsapp_habilitado IS TRUE/);
  assert.match(sql,/LOWER\(recipient.usuario\) = n.destinatario_clave OR EXISTS/);
  assert.match(sql,/own_alias.usuario_id = recipient.id AND own_alias.notification_key = n.destinatario_clave\s+AND own_alias.enabled IS TRUE/);
  assert.match(sql,/NOT EXISTS \(\s+SELECT 1 FROM usuarios other_user\s+WHERE other_user.id <> recipient.id AND LOWER\(other_user.usuario\) = n.destinatario_clave\)/);
  assert.match(sql,/NOT EXISTS \(\s+SELECT 1 FROM mia_whatsapp_identities other_alias\s+WHERE other_alias.usuario_id <> recipient.id AND other_alias.notification_key = n.destinatario_clave\s+AND other_alias.enabled IS TRUE\)/);
  assert.doesNotMatch(sql,/recipient.whatsapp_id_hash|recipient.nombre|other_user.activo/,'Own alias needs no personal hash; even inactive foreign username collision denies');
  assert.doesNotMatch(sql,/::(?:integer|int|bigint|numeric)|CAST\(/i,'No cast of persisted, potentially malformed JSON');
  assert.match(sql,/ELSE TRUE END\)$/,'No explicit recipient ID preserves legacy branch');
});

test('comment/block SQL requires current assignment and visible RenderOS task, independent of role/read ACL',()=>{
  assert.match(sql,/n.motivo IS DISTINCT FROM 'comentario' AND n.motivo IS DISTINCT FROM 'bloqueada'/);
  assert.match(sql,/JOIN tarea_asignaciones assignment\s+ON assignment.tarea_id = task.id AND assignment.usuario_id = recipient.id/);
  assert.match(sql,/WHERE task.id = n.tarea_id AND task.id > 0/);
  assert.match(sql,/task.propiedades_extra->>'workspace' = 'render_os'/);
  for(const key of ['archivada_render_os','papelera_render_os']) assert.ok(sql.includes(`task.propiedades_extra->>'${key}' IS DISTINCT FROM 'true'`));
  assert.doesNotMatch(sql,/rol|admin|nombre|FOR UPDATE|FOR SHARE|UPDATE |INSERT |DELETE /);
});

test('SQL aliases accept only fixed internal names, with no injectable identifier interpolation',()=>{
  assert.equal(buildTaskNotificationEligibilityPredicate(),sql);
  assert.ok(buildTaskNotificationEligibilityPredicate('notification').includes('notification.detalles'));
  for(const alias of ['u','n.x','n\n',' n','n; DROP TABLE usuarios','n--','',null,{},['n']]) assert.throws(()=>buildTaskNotificationEligibilityPredicate(alias),TypeError);
});

test('missing own recipient field preserves legacy without new queries; inherited field does not opt in',async()=>{
  for(const detalles of [undefined,null,{},[],{supervisor:true},Object.create({destinatario_usuario_id:12})]) {
    assert.equal(await taskNotificationEligible(never,notice({detalles})),true);
  }
  assert.equal(await taskNotificationEligible(never,null),false);
});

for(const id of [undefined,null,false,true,'12','1.0',0,-1,1.5,2147483648,Number.MAX_SAFE_INTEGER,Infinity,NaN,[],{},12n]) {
  test(`explicit invalid recipient ${String(id)} denies before query and never falls back to username`,async()=>{
    assert.equal(await taskNotificationEligible(never,notice({detalles:{destinatario_usuario_id:id}})),false);
  });
}

for(const tarea_id of [undefined,null,'','09',' 9','9 ','+9','9.0','9e0','0','-9','2147483648',0,-1,9.5,2147483648,{},[],9n]) {
  test(`comment invalid task ${String(tarea_id)} fails closed without BIGINT/JSON casts`,async()=>{
    assert.equal(await taskNotificationEligible(never,notice({tarea_id})),false);
  });
}

test('read guard uses identical SQL and captured numeric-ID/key/reason/task primitives',async()=>{
  const input=notice(),calls=[];let resolve;
  const db={query:async(query,values)=>{calls.push({query,values});return new Promise(done=>{resolve=done;});}};
  const pending=taskNotificationEligible(db,input);
  input.detalles.destinatario_usuario_id=99;input.destinatario_clave='reused';input.tarea_id='99';input.motivo='other';
  assert.equal(calls.length,1);assert.ok(calls[0].query.includes(sql));
  assert.deepEqual(calls[0].values,['{"destinatario_usuario_id":12}','qa_recipient','comentario','9']);
  assert.match(calls[0].query,/^SELECT /);assert.match(calls[0].query,/\$4::bigint AS tarea_id/);
  resolve({rows:[{eligible:true}]});assert.equal(await pending,true);
});

test('valid int32 boundaries and canonical pg BIGINT strings reach read-only query unchanged',async()=>{
  for(const id of [1,2147483647]) for(const tarea_id of [1,'1',2147483647,'2147483647']) {
    const db={query:async(query,values)=>{
      assert.ok(query.includes(sql));assert.equal(JSON.parse(values[0]).destinatario_usuario_id,id);
      assert.equal(values[3],String(tarea_id));return {rows:[{eligible:true}]};
    }};
    assert.equal(await taskNotificationEligible(db,notice({tarea_id,detalles:{destinatario_usuario_id:id}})),true);
  }
});

test('other ID-bound notice types still use active/key policy without inventing task membership requirements',async()=>{
  let calls=0;
  assert.equal(await taskNotificationEligible({query:async(query,values)=>{
    calls++;assert.ok(query.includes(sql));assert.equal(values[2],'supervisor_seguimiento');assert.equal(values[3],null);
    return {rows:[{eligible:true}]};
  }},notice({motivo:'supervisor_seguimiento',tarea_id:null})),true);
  assert.equal(calls,1);
});

test('guard accepts only DB boolean true; missing rows, false and string truthy all deny; DB errors propagate',async()=>{
  for(const rows of [[],[{eligible:false}],[{eligible:null}],[{eligible:'true'}]]) assert.equal(await taskNotificationEligible({query:async()=>({rows})},notice()),false);
  const error=new Error('SQL unavailable');await assert.rejects(taskNotificationEligible({query:async()=>{throw error;}},notice()),e=>e===error);
  for(const destinatario_clave of [null,undefined,{},'']) assert.equal(await taskNotificationEligible(never,notice({destinatario_clave})),false);
});

test('actual supervisor delivery denies ID-bound notices BEFORE contact and even with ignoreContact',async()=>{
  for(const ignoreContact of [false,true]){
    const calls=[];const db={query:async(query)=>{calls.push(query);assert.ok(query.includes(sql));return {rows:[{eligible:false}]};}};
    assert.equal(await supervisorNotificationDeliverable(db,notice(),{ignoreContact}),false);assert.equal(calls.length,1);
  }
});

test('eligibility true does not bypass cooldown or supervisor enablement; legacy path remains unchanged',async()=>{
  const now=new Date('2026-10-24T12:00:00Z'),queries=[];
  const db={query:async(query)=>{queries.push(query);return query.includes(' AS eligible')?{rows:[{eligible:true}]}:{rows:[{last_delivered_at:now}]};}};
  assert.equal(await supervisorNotificationDeliverable(db,notice(),{now}),false);assert.equal(queries.length,2);
  assert.equal(await supervisorNotificationDeliverable(db,notice({detalles:{destinatario_usuario_id:12,supervisor:true}}),{ignoreContact:true,env:{MIA_SUPERVISOR_ENABLED:'false'},now}),false);
  const legacy=[];
  assert.equal(await supervisorNotificationDeliverable({query:async query=>{legacy.push(query);return {rows:[]};}},notice({detalles:{}}),{now}),true);
  assert.equal(legacy.length,1);assert.ok(!legacy[0].includes(' AS eligible'));
});

function queueHandler(pool,env={},onEnqueue=()=>{}) {
  const source=readFileSync(new URL('../src/wilson-integration.js',import.meta.url),'utf8');
  const start=source.indexOf('router.get("/notificaciones-privadas",');
  const end=source.indexOf('router.get("/notificaciones-privadas/:id/verificar",',start);
  assert.ok(start>0&&end>start);let handler;
  Function('router','pool','env','isWilsonSystemActor','enqueueDuePersonalListReminders','buildTaskNotificationEligibilityPredicate',source.slice(start,end))(
    {get:(path,fn)=>{assert.equal(path,'/notificaciones-privadas');handler=fn;}},pool,env,req=>req.system===true,onEnqueue,buildTaskNotificationEligibilityPredicate);
  return handler;
}

for(const preview of [false,true]){
  test(`actual ${preview?'preview':'claim'} applies exact shared SQL BEFORE limit/claim, preserving system gate`,async()=>{
    const queries=[];let enqueued=0,result;
    const handler=queueHandler({query:async(query,params)=>{queries.push({query,params});return {rows:[]};}}, {},()=>{enqueued++;});
    const response={json:value=>{result=value;return value;},status(code){assert.equal(code,403);return this;}};
    await handler({system:false,query:{}},response,error=>{throw error;});assert.equal(queries.length,0);
    await handler({system:true,query:{limit:'7',...(preview?{dry_run:'true'}:{})}},response,error=>{throw error;});
    assert.equal(queries.length,1);assert.equal(enqueued,preview?0:1);
    const query=queries[0].query;assert.ok(query.includes(sql));assert.ok(query.indexOf(sql)<query.indexOf('LIMIT $1'));
    assert.match(query,/FROM mia_private_task_notifications n/);
    if(!preview){assert.ok(query.indexOf(sql)<query.indexOf('FOR UPDATE SKIP LOCKED'));assert.ok(query.indexOf(sql)<query.indexOf("SET estado='sending'"));}
    else assert.doesNotMatch(query,/UPDATE |SKIP LOCKED/);
    assert.equal(queries[0].params[0],7);assert.deepEqual(result.notifications,[]);
  });
}
