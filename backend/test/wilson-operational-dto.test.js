import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createWilsonRouter, wilsonTaskForResponse, wilsonOperationalAuth, resolveReviewTaskReferences } from '../src/wilson-integration.js';
import { createWilsonChatRouter, wilsonChatTaskContext } from '../src/wilson-chat.js';

const secret='PRIVATE_FINANCE_SENTINEL';
function task() {
  return {id:100,revision:7,titulo:'Carrusel operativo',estado:'pendiente',asignado_a:'Editor',tipo_tarea:'diseno',cliente_id:1,
    cliente_nombre:'Cliente',prioridad:'media',fecha_vencimiento:'2026-10-19',updated_at:'2026-10-19T12:00:00Z',importe:secret,
    private_future:{value:secret},asignado_a_id:11,colaborador_ids:[],
    propiedades_extra:{workspace:'render_os',copy_trabajo:'Copy operativo',importe:secret,sueldo_base:secret,future:{secret},
      colaboradores:['Editor'],produccion_registros:[{cantidad:2,fecha:'2026-10-19',importe:secret,future:{secret}}],
      guiones:[{id:1,texto:'Guion operativo',importe:secret,escenas:[{texto:'Escena',importe:secret}]}],
      adjuntos:[{id:1,nombre:'Referencia',url:'https://example.test/reference',importe:secret}],
    }};
}
const roles=['community','diseno','produccion','edicion','lider','unknown',undefined];
function response(){return{statusCode:200,status(c){this.statusCode=c;return this;},json(body){this.body=body;return this;}};}
function handler(pool,method,path,options={}){
  return createWilsonRouter({pool,env:{NODE_ENV:'test'},...options}).stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]).route.stack[0].handle;
}
function req(rol,extra={}) {return {params:{id:'100'},query:{},body:{},headers:{},wilson:{userId:11,actorRole:rol,actorName:'Agustín Franco Líder',channel:'whatsapp',actorId:'external',groupId:'group',privateChat:false},...extra};}
function safe(value){assert.equal(JSON.stringify(value).includes(secret),false);}
function memoryDb(value=task()){
  const calls=[];
  const db={calls,release(){},async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('SELECT tarea_id, usuario_id, tipo')) return {rows:[{tarea_id:100,usuario_id:11,tipo:'responsable'}]};
    if(sql.includes('FROM tareas')) return {rows:[value]};
    if(sql.startsWith('UPDATE tareas')) return {rows:[value]};
    if(sql.includes('FROM clientes')) return {rows:[{id:1,nombre:'Cliente'}]};
    if(sql.includes('FROM usuarios')) return {rows:[{id:11,nombre:'Editor',activo:true}]};
    if(sql.includes('UPDATE integracion_confirmaciones')) return {rows:[{token:'token'}]};
    return {rows:[]};
  }};
  return {db,pool:{query:db.query.bind(db),connect:async()=>db}};
}

test('pure task serialization is safe by default, nested allowlisted content survives without mutation',()=>{
  const input=task(),before=structuredClone(input);
  for(const rol of roles){
    const result=wilsonTaskForResponse(input,{auth:{rol}});
    safe(result);
    assert.equal(result.revision,7);
    assert.equal(result.propiedades_extra.copy_trabajo,'Copy operativo');
    assert.equal(result.propiedades_extra.produccion_registros[0].cantidad,2);
    assert.equal(result.propiedades_extra.guiones[0].texto,'Guion operativo');
    assert.deepEqual(result.responsables,['Editor']);
  }
  safe(wilsonTaskForResponse(input));
  assert.deepEqual(input,before);
  assert.equal(wilsonTaskForResponse(input,{auth:{rol:'admin'}}).propiedades_extra.importe,secret);
});

test('transport names, leader booleans and system actors never grant financial bypass',()=>{
  for(const wilson of [{actorRole:'admin'},{actorRole:'admin',userId:11,systemActor:true},{userId:11,actorRole:'lider'},
    {userId:11,actorName:'Agustín',isLeader:true},{userId:11,actorRole:'unknown'}]){
    safe(wilsonTaskForResponse(task(),{auth:wilsonOperationalAuth(wilson)}));
  }
  assert.equal(wilsonTaskForResponse(task(),{auth:wilsonOperationalAuth({userId:11,actorRole:'admin'})}).importe,secret);
});

for(const rol of [...roles,'admin']){
  test(`list, detail and review resolver serialization for ${rol}`,async()=>{
    for(const [method,path] of [['get','/tareas'],['get','/tareas/:id'],['post','/tareas/resolver-revision']]){
      const {pool}=memoryDb(); const res=response();
      await handler(pool,method,path)(req(rol,{body:{referencias:['Carrusel operativo']}}),res,error=>{throw error;});
      assert.equal(res.statusCode,200);
      if(rol==='admin') assert.equal(JSON.stringify(res.body).includes(secret),true);
      else safe(res.body);
    }
  });
}

test('pure review matches are safe, with an explicit admin opt-in only',()=>{
  safe(resolveReviewTaskReferences(['Carrusel operativo'],[task()]));
  assert.equal(resolveReviewTaskReferences(['Carrusel operativo'],[task()],{rol:'admin'}).results[0].matches[0].importe,secret);
});

test('POST/PATCH idempotent responses and content mutation serialize only after business logic',async()=>{
  for(const [method,path] of [['post','/tareas'],['patch','/tareas/:id']]){
    const original=task();original.propiedades_extra.wilson_last_update_key='same';
    const {pool}=memoryDb(original),res=response();
    await handler(pool,method,path)(req('edicion',{headers:{'idempotency-key':'same'}}),res,error=>{throw error;});
    assert.equal(res.body.idempotent,true);safe(res.body);
    assert.equal(original.propiedades_extra.importe,secret);
  }
  const original=task(),{pool,db}=memoryDb(original),res=response();
  await handler(pool,'patch','/tareas/:id')(req('edicion',{headers:{'idempotency-key':'new'},body:{titulo:'Título actualizado',confirmacion_token:'token'}}),res,error=>{throw error;});
  assert.equal(res.body.updated,true);safe(res.body);
  const update=db.calls.find(call=>call.sql.startsWith('UPDATE tareas'));
  assert.equal(JSON.parse(update.params[10]).importe,secret); // Kept internally, not silently erased from storage.
});

test('production confirmation serializes both tasks; business callback and notifier retain originals',async()=>{
  const original=task(),{pool}=memoryDb(original),res=response();let notified;
  await handler(pool,'post','/tareas/:id/confirmar-grabacion',{
    confirmProduction:async()=>({created:true,task:original,editing_task:original}),
    notifyAssignment:async value=>{notified=value.tarea;},
  })(req('admin',{body:{expected_revision:7,confirmacion_token:'token'}}),res,error=>{throw error;});
  assert.equal(res.statusCode,200);
  assert.equal(res.body.task.importe,secret); // Current verified admin retains authorized data.
  assert.equal(notified,original);
});

test('task validation/duplicate previews and archive responses use safe DTOs',async()=>{
  const body={titulo:'Carrusel operativo',cliente_id:1,responsable:'Editor',sector:'diseno',confirmacion_token:'token'};
  const validation=memoryDb(),preview=response();
  await handler(validation.pool,'post','/tareas/validar')(req('edicion',{body}),preview,error=>{throw error;});
  assert.equal(preview.statusCode,200);safe(preview.body);
  assert.equal(preview.body.duplicates.length,1);
  const archive=memoryDb(),archived=response();
  await handler(archive.pool,'post','/tareas/:id/archivar')(req('edicion',{body,headers:{'idempotency-key':'archive'}}),archived,error=>{throw error;});
  assert.equal(archived.body.archived,true);safe(archived.body);
  assert.equal(JSON.parse(archive.db.calls.find(call=>call.sql.startsWith('UPDATE tareas')).params[1]).importe,secret);
});

test('new task response does not expose financial metadata returned by persistence',async()=>{
  const original=task(),memory=memoryDb(original),base=memory.db.query.bind(memory.db);
  memory.db.query=async(sql,params)=>{
    if(sql.includes("wilson_idempotency_key'=$1")) return {rows:[]};
    if(sql.startsWith('INSERT INTO tareas (')) return {rows:[original]};
    return base(sql,params);
  };
  const res=response();
  await handler(memory.pool,'post','/tareas')(req('edicion',{
    headers:{'idempotency-key':'new-task'},
    body:{titulo:'Carrusel operativo',cliente_id:1,responsable:'Editor',sector:'diseno',confirmacion_token:'token',permitir_duplicado:true},
  }),res,error=>{throw error;});
  assert.equal(res.statusCode,201);assert.equal(res.body.created,true);safe(res.body);
  assert.equal(original.propiedades_extra.importe,secret);
});

test('model/task context defaults safe; chat task and recommendation outputs are safe for non-admin',async()=>{
  const original=task();
  safe(wilsonChatTaskContext([original]));
  assert.equal(wilsonChatTaskContext([original],{rol:'admin'})[0],original);
  const pool={async query(sql,params){
    if(sql.includes('FROM tareas t')) return {rows:[original]};
    if(sql.includes('FROM usuarios')) return {rows:[{id:11,nombre:'Editor',usuario:'editor',rol:'edicion'}]};
    if(sql.includes('INSERT INTO wilson_conversaciones')) return {rows:[{id:1,usuario_id:11,periodo:'2026-10'}]};
    if(sql.includes('INSERT INTO wilson_mensajes')) return {rows:[{id:1,contenido:params[2],metadata:JSON.parse(params[4])}]};
    return {rows:[]};
  }};
  const router=createWilsonChatRouter({express,pool});
  for(const [method,path,body] of [['get','/conversacion',{}],['post','/mensajes',{contenido:'Qué hago primero'}]]){
    const run=router.stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]).route.stack[0].handle;
    const res=response();
    await run({auth:{id:11,nombre:'Editor',usuario:'editor',rol:'edicion'},body},res,error=>{throw error;});
    assert.equal(res.statusCode,method==='post'?201:200);safe(res.body);
    assert.equal(res.body.priorities.recommendations[0].propiedades_extra.copy_trabajo,'Copy operativo');
  }
  assert.equal(original.propiedades_extra.importe,secret);
});

test('all task-bearing write/preview return sites explicitly use response DTOs',()=>{
  const source=readFileSync(new URL('../src/wilson-integration.js',import.meta.url),'utf8');
  const taskRoutes=source.slice(source.indexOf('router.post("/tareas/validar"'));
  assert.doesNotMatch(taskRoutes,/\.map\(taskWithUrl\)|task: taskWithUrl\([^,)]*\)\s*\}|duplicates: result.duplicates\s*\}/);
  assert.match(taskRoutes,/tasks: snapshots.map\(task => taskWithUrl/);
  assert.match(taskRoutes,/editing_task: result.editing_task \? taskWithUrl/);
});
