import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalTaskOperationIntent,taskOperationKey,taskOperationIntentHash,taskOperationConfirmationHash,
  taskOperationReceiptDto,findTaskOperationReceipt,insertTaskOperationReceipt,consumeTaskOperationConfirmation,
  lockTaskOperationResources } from '../src/task-operation-receipts.js';
import { prepareWilsonTaskOperation } from '../src/wilson-integration.js';

const token='11111111-1111-4111-8111-111111111111';
const visit='22222222-2222-4222-8222-222222222222',video='33333333-3333-4333-8333-333333333333';
const create={titulo:'Video',cliente_id:1,asignado_a_id:9,colaborador_ids:[],sector:'edicion',prioridad:'media'};
const intent=(body=create,operation='crear',targetId=operation==='crear'?null:8)=>canonicalTaskOperationIntent(body,{operation,targetId});

test('task intention canonicalizes supported aliases while preserving explicit business choices',()=>{
  const a=intent({...create,descripcion:' Detail ',material:'https://example.invalid/material',fecha_vencimiento:'2026-10-20'});
  const b=intent({titulo:' Video ',cliente_id:1,asignado_a_id:9,colaborador_ids:[],tipo_tarea:'Edición',prioridad:'MEDIA',
    aclaraciones:'Detail',material_referencia:'https://example.invalid/material',vencimiento:'2026-10-20',confirmado:true,confirmacion_token:token,idempotency_key:'transport'});
  assert.deepEqual(a,b);assert.equal(taskOperationIntentHash(a),taskOperationIntentHash(b));
  const names=intent({titulo:'Video',cliente:'Client',responsables:['Owner','Second'],sector:'diseno'});
  assert.deepEqual(names.business,{titulo:'Video',cliente:'Client',sector:'diseno',asignado_a:'Owner',colaboradores:['Second']});
});

test('four operation intentions bind target and exact revision; PATCH never hashes a live merge',()=>{
  for(const operation of ['editar','archivar','eliminar']) {
    assert.throws(()=>intent({},operation),e=>e.status===400);
    const body={expected_revision:4,...(operation==='editar'?{append_descripcion:'Append once'}:{})};
    const a=intent(body,operation);assert.equal(a.expected_revision,4);
    assert.notEqual(taskOperationIntentHash(a),taskOperationIntentHash(intent({...body,expected_revision:5},operation)));
    assert.notEqual(taskOperationIntentHash(a),taskOperationIntentHash(intent(body,operation,9)));
  }
  const omitted=intent({titulo:'X',expected_revision:4},'editar');
  const cleared=intent({titulo:'X',expected_revision:4,fecha_vencimiento:null,material:null,produccion_videos_previstos:null,colaborador_ids:[]},'editar');
  assert.notEqual(taskOperationIntentHash(omitted),taskOperationIntentHash(cleared));
  assert.deepEqual(intent({append_descripcion:' Append ',expected_revision:4},'editar').business,{append_descripcion:'Append'});
});

test('closed task schema rejects provenance/state changes, malformed types and contradictory aliases',()=>{
  for(const patch of [{estado:'finalizada'},{revision_aprobada:true},{propiedades_extra:{copy_trabajo:'X'}},{wilson_idempotency_key:'forged'},
    {origen_integracion:'wilson'},{expected_updated_at:'2026-10-20T00:00:00Z'},{asignado_a_id:'9'},{colaborador_ids:[{}]},
    {fecha_vencimiento:'2026-02-30'},{produccion_videos_previstos:'4'},{permitir_duplicado:'true'},
    {descripcion:'A',aclaraciones:'B'},{cliente:'Other client'},{asignado_a:'Wrong label'}])assert.throws(()=>intent({...create,...patch}),e=>e.status===400);
  assert.throws(()=>intent({descripcion:'Replace',append_descripcion:'Append',expected_revision:4},'editar'),e=>e.status===400);
  assert.throws(()=>intent({expected_revision:4,titulo:'Not an archive field'},'archivar'),e=>e.status===400);
});

test('keys reject controls/type coercion/oversize/header-body disagreement without truncating',()=>{
  assert.equal(taskOperationKey({'idempotency-key':' key '},{idempotency_key:'key'}),'key');
  for(const key of [{},[],true,7,'','x'.repeat(201),'a\u0000b','a\nb','a\u007fb'])assert.throws(()=>taskOperationKey({}, {idempotency_key:key}),e=>e.status===400);
  assert.throws(()=>taskOperationKey({'idempotency-key':'a'},{idempotency_key:'b'}),e=>e.status===400);
});

test('confirmation binds stable actor, key and resolved business identities separately from pure receipt hash',()=>{
  const i=intent(),base={intent:i,userId:7,key:'key',selections:{cliente_id:1,asignado_a_id:9,colaborador_ids:[]}};
  const h=taskOperationConfirmationHash(base);
  for(const patch of [{userId:8},{key:'other'},{selections:{cliente_id:2,asignado_a_id:9,colaborador_ids:[]}},
    {selections:{cliente_id:1,asignado_a_id:10,colaborador_ids:[]}}])assert.notEqual(h,taskOperationConfirmationHash({...base,...patch}));
  assert.equal(taskOperationIntentHash(i),taskOperationIntentHash(intent()));
});

test('receipt scope separates actor/operation/key and minimal DTO has no content, names, key or token',async()=>{
  const calls=[];let stored;
  const db={async query(sql,params) {
    calls.push({sql,params});
    if(sql.startsWith('INSERT')){stored={operation:params[1],task_id:params[4],task_revision:params[5],outcome:params[6],changed_fields:params[7],committed_at:'2026-10-20T00:00:00Z',payload_hash:params[3]};return{rows:[stored]};}
    if(sql.includes('FROM task_operation_receipts'))return{rows:stored&&params[0]===7&&params[1]==='editar'&&params[2]==='key'?[stored]:[]};
    return{rows:[]};
  }};
  const options={userId:7,operation:'editar',key:'key',payloadHash:'a'.repeat(64)};
  assert.equal(await findTaskOperationReceipt(db,options),null);
  assert.deepEqual(calls[0].params,[JSON.stringify(['task-operation-receipt-v1',7,'editar','key'])]);
  const row=await insertTaskOperationReceipt(db,{...options,task:{id:8,revision:4},outcome:'unchanged'});
  assert.deepEqual(Object.keys(taskOperationReceiptDto(row)).sort(),['operation','task_id','task_revision','outcome','changed_fields','committed_at'].sort());
  assert.deepEqual(row.changed_fields,[]);assert.equal((await findTaskOperationReceipt(db,options)).task_id,8);
  await assert.rejects(findTaskOperationReceipt(db,{...options,payloadHash:'b'.repeat(64)}),e=>e.status===409);
  assert.equal(await findTaskOperationReceipt(db,{...options,userId:9}),null);
  assert.equal(await findTaskOperationReceipt(db,{...options,operation:'eliminar'}),null);
});

test('exact token locks full channel/actor/group/operation/target/hash scope before checking real-time expiry',async()=>{
  const calls=[],i=intent({expected_revision:4,titulo:'X'},'editar');
  const db={async query(sql,params){calls.push({sql,params});return{rows:calls.length===1?[{token}]:[]};}};
  const req={body:{confirmacion_token:token},wilson:{channel:'telegram',actorId:'external',groupId:'conversation',userId:7}};
  await assert.rejects(consumeTaskOperationConfirmation(db,req,i,'key',{asignado_a_id:9}),e=>e.status===409);
  assert.match(calls[0].sql,/FOR UPDATE/);assert.doesNotMatch(calls[0].sql,/expires_at|used_at|clock_timestamp/);
  assert.match(calls[1].sql,/used_at=clock_timestamp\(\)/);assert.match(calls[1].sql,/expires_at>clock_timestamp\(\)/);
  assert.deepEqual(calls[0].params,calls[1].params);assert.deepEqual(calls[0].params.slice(0,6),[token,'telegram','external','conversation','editar',8]);
});

function resourceDb({changed=false}={}) {
  const calls=[];let discovered=0;
  return{calls,async query(sql,params){
    calls.push({sql,params});
    if(sql.startsWith('SELECT id,publicacion_id FROM tareas')){discovered++;return{rows:[{id:8,publicacion_id:30}]};}
    if(sql.startsWith('SELECT s.id,s.tarea_id'))return{rows:[{id:40,tarea_id:8,publicacion_id:30,clave:'cliente-1',periodo:'2026-10'}]};
    if(sql.startsWith('SELECT v.id,v.tarea_origen_id'))return{rows:[{id:visit,tarea_origen_id:changed&&discovered>1?5:4}]};
    if(sql.startsWith('SELECT id,visita_id FROM produccion_videos'))return{rows:[{id:video,visita_id:visit}]};
    return{rows:[]};
  }};
}
test('work resources lock goal key, ascending tasks, publication, slot, visit and videos before token phase',async()=>{
  const db=resourceDb();await lockTaskOperationResources(db,8);
  const locks=db.calls.filter(call=>call.sql.includes('FOR UPDATE')||call.sql.includes('pg_advisory_xact_lock'));
  assert.match(locks[0].sql,/pg_advisory/);assert.deepEqual(locks[0].params,['objetivo:2026-10:cliente-1']);
  assert.match(locks[1].sql,/FROM tareas/);assert.deepEqual(locks[1].params,[[4,8]]);
  assert.match(locks[2].sql,/FROM publicaciones/);assert.match(locks[3].sql,/FROM cliente_objetivo_piezas/);
  assert.match(locks[4].sql,/FROM produccion_visitas/);assert.match(locks[5].sql,/FROM produccion_videos/);
  assert.equal(db.calls.filter(call=>call.sql.startsWith('SELECT id,publicacion_id FROM tareas')).length,2);
});
test('changed references reject after recheck instead of taking a new existing-task lock after visit/video',async()=>{
  const db=resourceDb({changed:true});await assert.rejects(lockTaskOperationResources(db,8),e=>e.status===409);
  const tasks=db.calls.filter(call=>call.sql.includes('FROM tareas')&&call.sql.includes('FOR UPDATE'));
  assert.equal(tasks.length,1);assert.deepEqual(tasks[0].params,[[4,8]]);
});

const current={id:8,revision:4,titulo:'Video',cliente_id:1,cliente_nombre:'Client',asignado_a:'Old owner label',asignado_a_id:7,colaborador_ids:[10],
  estado:'pendiente',fecha_vencimiento:'2026-10-20',tipo_tarea:'edicion',subtipo:'video',prioridad:'media',aclaraciones:null,material_referencia:null,
  propiedades_extra:{workspace:'render_os',colaboradores:['Old collaborator label','Removed label with no ID'],copy_trabajo:'KEEP'}};
function selectionDb({race=false,homonyms=false}={}) {
  const calls=[];let locked=false;
  const users=[{id:7,nombre:'Current owner',usuario:'owner',activo:false},{id:9,nombre:'Recipient',usuario:'recipient',activo:true},
    {id:10,nombre:homonyms?'Recipient':'Inactive colleague',usuario:'colleague',activo:homonyms}];
  return{calls,async query(sql,params){
    calls.push({sql,params});
    if(sql.startsWith('SELECT id,nombre FROM clientes WHERE activo'))return{rows:[{id:1,nombre:'Client'}]};
    if(sql.startsWith('SELECT id,usuario,nombre,rol FROM usuarios WHERE activo'))return{rows:users.filter(user=>user.activo).map(user=>({...user}))};
    if(sql.startsWith('SELECT id,nombre FROM clientes WHERE id='))return{rows:[{id:1,nombre:'Client'}]};
    if(sql.startsWith('SELECT id, nombre, activo FROM usuarios')) {
      locked=true;if(race){users[1].nombre='Renamed during lock wait';users[2].nombre='Recipient';users[2].activo=true;}
      return{rows:users.filter(user=>params[0].includes(user.id)).map(user=>({...user}))};
    }
    if(sql.startsWith('SELECT id,nombre FROM usuarios WHERE id=ANY'))return{rows:users.filter(user=>params[0].includes(user.id))};
    throw Error('Unexpected pure selection query: '+sql);
  },get locked(){return locked;}};
}

test('omitted labels never resolve membership; explicit IDs work with homonyms and preserve inactive untouched IDs',async()=>{
  const plain=selectionDb();const unchanged=await prepareWilsonTaskOperation(plain,intent({titulo:'New title',expected_revision:4},'editar'),current);
  assert.equal(unchanged.assignment,null);assert.deepEqual(unchanged.selections,{});assert.equal(plain.locked,false);
  const db=selectionDb({homonyms:true});const selected=await prepareWilsonTaskOperation(db,intent({asignado_a_id:9,expected_revision:4},'editar'),current);
  assert.deepEqual(selected.assignment,{ownerId:9,collaboratorIds:[10]});assert.deepEqual(selected.selections,{asignado_a_id:9});
  assert.equal(selected.task.asignado_a,'Recipient');assert.deepEqual(selected.task.colaboradores,['Recipient']);
  const partial=selectionDb();const collaborator=await prepareWilsonTaskOperation(partial,intent({colaborador_ids:[9],expected_revision:4},'editar'),current);
  assert.deepEqual(collaborator.assignment,{ownerId:7,collaboratorIds:[9]});assert.deepEqual(collaborator.selections,{colaborador_ids:[9]});
  assert.deepEqual(partial.calls.find(call=>call.sql.startsWith('SELECT id, nombre, activo')).params,[[9],[]]);
});
test('label binding is rechecked against fresh users AFTER selected IDs are locked',async()=>{
  const db=selectionDb({race:true});await assert.rejects(prepareWilsonTaskOperation(db,intent({asignado_a:'Recipient',expected_revision:4},'editar'),current),e=>e.status===409);
  const lock=db.calls.findIndex(call=>call.sql.startsWith('SELECT id, nombre, activo'));
  assert.ok(db.calls.slice(lock+1).some(call=>call.sql.startsWith('SELECT id,usuario,nombre,rol FROM usuarios WHERE activo')));
});

test('four receipt handlers contain no JSON replay lookup, preserve no-op and registry/outbox ordering',()=>{
  const source=readFileSync(new URL('../src/wilson-integration.js',import.meta.url),'utf8');
  const handlers=source.slice(source.indexOf('  async function executeTaskReceiptOperation'),source.indexOf('\n  return router;',source.indexOf('  async function executeTaskReceiptOperation')));
  assert.doesNotMatch(handlers,/wilson_idempotency_key|wilson_last_update_key|wilson_archive_key/);
  assert.match(handlers,/outcome=changedFields.length\?'updated':'unchanged'/);
  assert.match(handlers,/if\(changedFields.length\)/);
  const creation=handlers.slice(handlers.indexOf("if(operation==='crear')"),handlers.indexOf("} else if(operation==='editar')"));
  assert.ok(creation.indexOf('replaceTaskAssignments')<creation.indexOf('syncProductionVisitFromTask'));
  assert.ok(handlers.indexOf('await encolarNotificacionPrivadaTarea')<handlers.indexOf('await insertTaskOperationReceipt'));
  assert.ok(handlers.indexOf('await insertTaskOperationReceipt')<handlers.lastIndexOf("await client.query('COMMIT')"));
  assert.ok(handlers.indexOf('notifyTaskReceiptEmail')>handlers.lastIndexOf("await client.query('COMMIT')"));
  assert.match(source,/task_archived:true/);assert.match(source,/task_deleted:true/);
});
