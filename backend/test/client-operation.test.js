import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClientOperationQuery, readClientOperation, createClientOperationRouter } from '../src/client-operation.js';
import { readProjectList } from '../src/projects.js';

const period='2026-10', auth={id:7,rol:'edicion',session_version:2};
const uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const secret='SYNTHETIC_PRIVATE_SENTINEL';
const stamp='2026-09-20T12:00:00.000Z';
const keys=(value,expected)=>assert.deepEqual(Object.keys(value).sort(),expected.sort());
function fixture({role='edicion',inactiveClient=false,missingClient=false,actor,rollbackFail=false,failAt,empty=false}={}) {
  const calls=[],release=[];
  const productionCounts={visitas:empty?0:8,videos_registrados:empty?0:21,videos_reutilizados:empty?0:2,registros_fotos:empty?0:3,
    pendientes_banco_todos_los_periodos:empty?0:10,fotos_pendientes_banco_todos_los_periodos:empty?0:4};
  const user=actor===undefined?{...auth,rol:role,activo:true}:actor;
  const client={id:1,nombre:'Synthetic client',activo:!inactiveClient,rubro:null,generated_at:'2026-10-22T12:00:00.000Z',abono_mensual:secret,metadata:{private:secret}};
  const taskCounts=empty?[]:[{estado:'pendiente',total:7},{estado:'en_progreso',total:1},{estado:'en_revision',total:2},
    {estado:'aprobada',total:3},{estado:'finalizada',total:2},{estado:'publicada',total:4},{estado:'programada',total:5}];
  const tasks=empty?[]:Array.from({length:6},(_,i)=>({id:i+1,titulo:`Task ${i}`,estado:i===0?'aprobada':'en_revision',revision:1,fecha_vencimiento:'2026-10-22',propiedades_extra:{abono:secret},password_hash:secret}));
  const projects=empty?[]:Array.from({length:6},(_,i)=>({id:uuid(i+1),titulo:`Project ${i}`,cliente_id:1,cliente_nombre:client.nombre,responsable_id:80,responsable_nombre:'Other person',tipo:'web',estado:'en_curso',revision:1,
    archivado:false,fecha_inicio:null,fecha_entrega:'2026-11-01',tareas:3,finalizadas:1,hitos:2,entregables:1,descripcion:secret,salario:secret}));
  const visits=empty?[]:Array.from({length:6},(_,i)=>({id:uuid(i+20),titulo:`Visit ${i}`,revision:1,fecha:`2026-10-${String(i+1).padStart(2,'0')}`,videos_registrados:3,registros_fotos:1,observaciones:secret,drive_url:secret}));
  const editorial=empty?[]:Array.from({length:9},(_,i)=>({domain:i===0?'historia':'publicacion',id:i===0?1:i,cliente_id:1,cliente_activo:!inactiveClient,
    titulo:`Piece ${i}`,tipo:i===0?'historia':'video',estado:[0,1,2,8].includes(i)?'publicada':'pendiente',fecha_programada:'2026-10-15',
    fecha_publicación_real:[0,1,2,8].includes(i)?stamp:null,metadata:{archivado_tablero:false},copy:secret,aclaraciones:secret}));
  const sourceClients=empty?[]:[1,2].map(id=>({id,nombre:`Account ${id}`,grupo_feed_id:9,grupo_feed_nombre:'Shared goal',cuota_reels:0,cuota_carruseles:0,
    cuota_feed_reels:2,cuota_feed_carruseles:1,agreement_version:3,feed_agreement_version:1,abono_mensual:secret}));
  const objectives=empty?[]:[{id:31,clave:'grupo-9',nombre:'Shared goal',cuentas:[{id:1,nombre:'Account 1'},{id:2,nombre:'Account 2'}],reels:2,carruseles:1,periodo:period},
    {id:32,clave:'cliente-1',nombre:'Historical individual goal',cuentas:[{id:1,nombre:'Account 1'}],reels:1,carruseles:0,periodo:period},
    {id:33,clave:'cliente-99',nombre:'Other client goal',cuentas:[{id:99,nombre:'Other'}],reels:20,carruseles:0,periodo:period}];
  const pieces=empty?[]:[{id:41,objetivo_id:31,tipo:'video',numero:1,estado:'finalizada'},
    {id:42,objetivo_id:31,tipo:'video',numero:2,estado:'en_revision',completada_at:stamp},
    {id:43,objetivo_id:31,tipo:'video',numero:3,estado:'publicada'},
    {id:44,objetivo_id:31,tipo:'carrusel',numero:1,estado:'publicada'},
    {id:45,objetivo_id:32,tipo:'video',numero:1,estado:'publicada'},
    {id:46,objetivo_id:33,tipo:'video',numero:1,estado:'finalizada'}].map(row=>({...row,updated_at:stamp,quota_piece_version:stamp,copy:secret,responsables:[secret]}));
  const db={release:error=>release.push(error),query:async(sql,params)=>{
    calls.push({sql,params});
    if (sql===failAt) throw Error(secret);
    if (sql==='ROLLBACK'&&rollbackFail) throw Error('synthetic rollback failed');
    if (sql.includes('FROM usuarios WHERE id=$1')) return {rows:user?[user]:[]};
    if (sql.includes('AS generated_at FROM clientes')) return {rows:missingClient?[]:[client]};
    if (sql.startsWith('SELECT CASE WHEN')) return {rows:taskCounts};
    if (sql.startsWith('SELECT t.id,t.titulo,')) return {rows:tasks};
    if (sql.startsWith('SELECT count(*)::int AS total FROM proyectos')) return {rows:[{total:empty?0:9}]};
    if (sql.startsWith('SELECT p.id,p.titulo,p.cliente_id')) return {rows:projects};
    if (sql.startsWith('WITH visits AS MATERIALIZED')) return {rows:[productionCounts]};
    if (sql.startsWith('SELECT v.id,v.titulo,v.revision')) return {rows:visits};
    if (sql.startsWith("SELECT 'historia'::text AS domain")) return {rows:inactiveClient?[]:editorial};
    if (sql.includes('p.id AS piece_id')) return {rows:params[0]==='publicacion'?editorial.filter(row=>[1,8].includes(row.id)&&row.domain==='publicacion').map(row=>({
      piece_id:row.id,piece_cliente_id:1,piece_estado:'publicada',piece_actual_at:stamp,piece_fecha_programada:row.fecha_programada,piece_archived:false,cliente_activo:true,
      revision:1,current_event_id:uuid(row.id+50),event_id:uuid(row.id+50),event_dominio:'publicacion',event_pieza_id:row.id,event_cliente_id:1,event_actor_id:7,
      event_action:'confirmar',event_source:'manual',event_occurred_at:stamp,event_recorded_at:stamp})):[]};
    if (sql.startsWith('SELECT c.id,c.nombre,c.grupo_feed_id')) return {rows:sourceClients};
    if (sql.startsWith('SELECT id,clave,nombre,cuentas,reels,carruseles')) return {rows:objectives};
    if (sql.startsWith('SELECT p.id,p.objetivo_id,p.tipo,p.numero')) return {rows:pieces};
    return {rows:[]};
  }};
  let connections=0;
  const pool={connect:async()=>{connections++;return db;}};
  return {db,pool,calls,release,client,user,tasks,taskCounts,productionCounts,projects,visits,editorial,sourceClients,objectives,pieces,
    read:()=>readClientOperation(pool,{...auth,rol:role},'1',{periodo:period}),get connections(){return connections;}};
}

test('period is required, scalar, exact and rejects year0000; malformed IDs never open a pool lease',async()=>{
  for (const query of [{},{periodo:undefined},{periodo:null},{periodo:['2026-10']},{periodo:{}},{periodo:'0000-10'},
    {periodo:'2026-10\n'},{periodo:'2026-1'},{periodo:'2026-13'},{periodo:'2026-10',actor_id:'7'}]) assert.throws(()=>parseClientOperationQuery(query),{status:400});
  assert.deepEqual(parseClientOperationQuery({periodo:'0001-01'}),{periodo:'0001-01'});
  assert.deepEqual(parseClientOperationQuery({periodo:period}),{periodo:period});
  const f=fixture();
  for (const id of ['0','01','-1','1e0','1\n','2147483648',null,{},[],1]) await assert.rejects(readClientOperation(f.pool,auth,id,{periodo:period}),{status:400});
  await assert.rejects(readClientOperation(f.pool,auth,'1',{}),{status:400}); assert.equal(f.connections,0);
});
test('one RR observation revalidates identity and composes all canonical readers on the SAME client',async()=>{
  const f=fixture(), result=await f.read();
  assert.equal(f.connections,1); assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); assert.equal(f.calls.at(-1).sql,'COMMIT');
  assert.equal(f.calls.filter(call=>call.sql.startsWith('BEGIN')).length,1); assert.deepEqual(f.release,[undefined]);
  keys(result,['version','generated_at','periodo','cliente','tareas','proyectos','producciones','editorial','objetivos']);
  keys(result.cliente,['id','nombre','activo','rubro']);
  for (const key of ['tareas','proyectos','producciones','editorial','objetivos']) {
    keys(result[key],['scope','total','counts','items','has_more','href']); assert.ok(result[key].items.length<=6);
    assert.equal(result[key].has_more,result[key].total>result[key].items.length);
  }
  assert.ok(f.calls.every(call=>!(/FOR UPDATE|FOR SHARE|^(INSERT|UPDATE|DELETE)/.test(call.sql))));
});
test('closed DTO is financial/private-bag free even for admin, without scrubbing legitimate user titles',async()=>{
  for (const role of ['admin','edicion']) {
    const f=fixture({role}); f.tasks[0].titulo='Presupuesto y abono son texto de una tarea';
    const result=await f.read(); assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));
    assert.equal(result.tareas.items[0].titulo,'Presupuesto y abono son texto de una tarea');
    const walk=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){
      assert.ok(!['abono_mensual','importe','salario','metadata','propiedades_extra','copy','observaciones','descripcion','agreement_revision','cuota_revision','password_hash'].includes(key),key);walk(child);
    }}; walk(result);
  }
});
test('task count is unbounded alltime, keeps approved independent, merges task-final aliases and preserves otros',async()=>{
  const f=fixture({inactiveClient:true}), result=await f.read();
  assert.equal(result.cliente.activo,false); assert.equal(result.tareas.total,24); assert.equal(result.tareas.items.length,6);
  assert.deepEqual(result.tareas.counts,{pendiente:7,en_progreso:1,en_revision:2,aprobada:3,finalizada:6,otros:5});
  const sql=f.calls.find(call=>call.sql.startsWith('SELECT CASE WHEN')).sql;
  assert.match(sql,/workspace'='render_os'/); assert.match(sql,/archivada_render_os/); assert.match(sql,/papelera_render_os/);
  assert.doesNotMatch(sql,/c\.activo|cliente.*activo|tarea_asignaciones|fecha.*date/);
  assert.equal(result.tareas.href,'/workspace/tareas?client=1&view=list');
});
test('project list extraction remains shared and nonarchived with exact canonical count/preview queries',async()=>{
  for (const role of ['admin','edicion']) {
    const f=fixture({role}), page=await readProjectList(f.db,{...auth,rol:role,activo:true},{cliente_id:'1',limit:'6',offset:'0'});
    assert.equal(page.total,9); assert.equal(page.proyectos.length,6); assert.equal(page.proyectos[0].responsable.id,80);
    assert.match(f.calls[0].sql,/NOT p.archivado AND p.cliente_id=\$1/);
    assert.deepEqual(f.calls[0].params,[1]); assert.deepEqual(f.calls[1].params,[1,6,0]);
    assert.doesNotMatch(f.calls[0].sql,/miembro|responsable_id.*\$|usuario_id/);
  }
  const f=fixture(), result=await f.read(); assert.equal(result.proyectos.href,'/proyectos?cliente=1');
});
test('production counts actual UUID records without visit/media join multiplication or legacy task aggregates',async()=>{
  const f=fixture(), result=await f.read(), sql=f.calls.find(call=>call.sql.startsWith('WITH visits AS MATERIALIZED')).sql;
  assert.deepEqual(result.producciones.counts,{visitas:8,videos_registrados:21,videos_reutilizados:2,registros_fotos:3,pendientes_banco_todos_los_periodos:10,fotos_pendientes_banco_todos_los_periodos:4});
  assert.equal(result.producciones.total,8); assert.equal(result.producciones.items.length,6);
  assert.match(sql,/video_origen_id IS NOT NULL/); assert.match(sql,/NOT EXISTS\(SELECT 1 FROM produccion_videos child WHERE child.video_origen_id=pv.id\)/);
  assert.match(sql,/pv.estado IN \('planificado','pendiente','repetir'\)/); assert.doesNotMatch(sql,/produccion_registros|FROM tareas|legacy/);
  assert.equal(result.producciones.href,'/producciones?cliente=1&mes=2026-10');
  assert.match(result.producciones.items[0].href,/\?visita=.*&cliente=1&mes=2026-10$/);
});
test('photo bank count shares the aggregate read but independently scopes current client across ALL periods',async()=>{
  const f=fixture({empty:true});
  f.productionCounts.fotos_pendientes_banco_todos_los_periodos=3;
  const result=await f.read();
  assert.equal(result.producciones.total,0);
  assert.deepEqual(result.producciones.items,[]);
  assert.equal(result.producciones.counts.registros_fotos,0);
  assert.equal(result.producciones.counts.pendientes_banco_todos_los_periodos,0);
  assert.equal(result.producciones.counts.fotos_pendientes_banco_todos_los_periodos,3);
  const reads=f.calls.filter(call=>call.sql.startsWith('WITH visits AS MATERIALIZED'));
  assert.equal(reads.length,1);
  assert.deepEqual(reads[0].params,[1,'2026-10-01']);
  const photoSql=reads[0].sql.match(/\(SELECT count\(\*\)::int FROM produccion_fotos pf[\s\S]*?\) AS fotos_pendientes_banco_todos_los_periodos/)[0];
  assert.match(photoSql,/JOIN produccion_visitas v ON v.id=pf.visita_id/);
  assert.match(photoSql,/WHERE v.cliente_id=\$1 AND pf.estado IN \('pendiente','repetir'\)/);
  assert.doesNotMatch(photoSql,/\$2|fecha|JOIN visits|LIMIT|planificado|video_origen_id|activo/);
  assert.equal(f.connections,1);
});
test('photo bank count is required and fails closed without a missing or malformed count fallback',async()=>{
  for (const value of [undefined,null,'3',-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    const f=fixture();
    if(value===undefined) delete f.productionCounts.fotos_pendientes_banco_todos_los_periodos;
    else f.productionCounts.fotos_pendientes_banco_todos_los_periodos=value;
    await assert.rejects(f.read(),/Invalid client operation count/);
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');
    assert.equal(f.calls.some(call=>call.sql==='COMMIT'),false);
    assert.deepEqual(f.release,[undefined]);
  }
  const result=await fixture({empty:true}).read();
  assert.equal(result.producciones.counts.fotos_pendientes_banco_todos_los_periodos,0);
});
test('editorial proof counts ALL planned-month rows through real domain-batched classifier, not six previews or task completion',async()=>{
  const f=fixture(), result=await f.read();
  assert.equal(result.editorial.total,9); assert.equal(result.editorial.items.length,6);
  assert.deepEqual(result.editorial.counts,{confirmada_manualmente:2,historica_sin_confirmacion:2,no_publicada:5});
  assert.equal(result.editorial.items.filter(row=>row.id===1).length,2,'Composite identity retains historia1 and publicacion1');
  const proofCalls=f.calls.filter(call=>call.sql.includes('p.id AS piece_id')); assert.equal(proofCalls.length,2);
  assert.ok(proofCalls.find(call=>call.params[0]==='publicacion').params[1].includes(8),'Nonpreview publication proof must be counted');
  assert.ok(result.editorial.items.some(row=>row.publicacion_evidencia.confirmation?.occurred_at===stamp),'Actual publication outside selected month still belongs to planned cohort');
  const base=f.calls.find(call=>call.sql.startsWith("SELECT 'historia'::text AS domain"));
  assert.deepEqual(base.params,[1,'2026-10-01']); assert.doesNotMatch(base.sql,/LIMIT|tareas|fecha_publicación_real\s*>/);
  for (const item of result.editorial.items) {
    assert.match(item.href,/planilla&cliente=1&mes=2026-10$/); assert.doesNotMatch(item.context_href,/cliente|piece|pieza/);
    assert.doesNotMatch(item.href,/piece|pieza/); assert.ok(['historia','publicacion'].includes(item.domain));
  }
});
test('inactive client retains task/project/production history while editorial respects its canonical active visibility',async()=>{
  const f=fixture({inactiveClient:true}), result=await f.read();
  assert.equal(result.cliente.activo,false); assert.ok(result.tareas.total>0);assert.ok(result.proyectos.total>0);assert.ok(result.producciones.total>0);
  assert.equal(result.editorial.total,0); assert.deepEqual(result.editorial.items,[]);
});
test('ALL matching historical/grouped goals remain separate; quota work completion excludes extras and does not imply publication',async()=>{
  const f=fixture(), result=await f.read(), goals=result.objetivos;
  assert.equal(goals.total,2); assert.deepEqual(goals.items.map(row=>row.clave).sort(),['cliente-1','grupo-9']);
  const group=goals.items.find(row=>row.clave==='grupo-9'), historical=goals.items.find(row=>row.clave==='cliente-1');
  assert.deepEqual(group.quota,{reels:2,carruseles:1}); assert.equal(group.cuentas.length,2);
  assert.deepEqual(group.progress,{reels:{total:2,completed:1},carruseles:{total:1,completed:1}});
  assert.deepEqual(group.extras,{total:1,completed:1}); assert.deepEqual(group.cuota_actual,{reels:2,carruseles:1});
  assert.equal(historical.cuota_actual,null); assert.deepEqual(historical.quota,{reels:1,carruseles:0});
  assert.deepEqual(historical.progress.reels,{total:1,completed:1}); assert.equal(Object.hasOwn(goals.counts,'quota'),false);
  assert.ok(goals.items.every(row=>row.href==='/clientes?periodo=2026-10'));
});
test('zero-content client has honest empty sections and unprepared zero quota, never fabricated agreement or tasks',async()=>{
  const f=fixture({empty:true}); f.sourceClients.push({id:1,nombre:'Basic client',grupo_feed_id:null,cuota_reels:0,cuota_carruseles:0,agreement_version:1});
  const result=await f.read();
  for (const key of ['tareas','proyectos','producciones','editorial']) assert.equal(result[key].total,0);
  assert.equal(result.objetivos.total,1); const goal=result.objetivos.items[0];
  assert.equal(goal.preparado,false); assert.equal(goal.id,null); assert.deepEqual(goal.quota,{reels:0,carruseles:0});
  assert.deepEqual(goal.cuota_actual,{reels:0,carruseles:0}); assert.equal(goal.cuota_desactualizada,false);
});
test('goal preview stays capped while ALL matching keys are counted; arbitrary account bags cannot escape',async()=>{
  const f=fixture();
  for(let i=0;i<8;i++)f.objectives.push({id:100+i,clave:`grupo-${100+i}`,nombre:'Historical group',cuentas:[{id:1,nombre:'Account 1'}],reels:0,carruseles:0,periodo:period});
  const result=await f.read(); assert.equal(result.objetivos.total,10);assert.equal(result.objetivos.items.length,6);assert.equal(result.objetivos.has_more,true);
  assert.deepEqual(result.objetivos.counts,{preparados:10,por_preparar:0});
  const malformed=fixture();malformed.objectives[1].cuentas.push({id:{importe:secret},nombre:'Invalid historical account'});
  await assert.rejects(malformed.read(),/accounts/);assert.equal(malformed.calls.at(-1).sql,'ROLLBACK');
});
test('missing/inactive/revoked/role-changed actor fails before client data; unknown current role forbidden',async()=>{
  for (const actor of [null,{...auth,activo:false},{...auth,activo:true,id:99},{...auth,activo:true,session_version:3},{...auth,activo:true,rol:'admin'}]) {
    const f=fixture({actor}); await assert.rejects(f.read(),{status:401}); assert.equal(f.calls.at(-1).sql,'ROLLBACK');
    assert.ok(!f.calls.some(call=>call.sql.includes('AS generated_at')));
  }
  const unknown=fixture({role:'unknown'}); await assert.rejects(unknown.read(),{status:403});
  const missing=fixture({missingClient:true}); await assert.rejects(missing.read(),{status:404});
});
test('query or commit failure rolls back; failed rollback discards the client and never emits partial hub',async()=>{
  const commit=fixture({failAt:'COMMIT'}); await assert.rejects(commit.read()); assert.equal(commit.calls.at(-1).sql,'ROLLBACK');
  const malformed=fixture(); malformed.taskCounts[0].total=-1; await assert.rejects(malformed.read(),/count/); assert.equal(malformed.calls.at(-1).sql,'ROLLBACK');
  const broken=fixture({actor:null,rollbackFail:true}); await assert.rejects(broken.read(),{status:401}); assert.equal(broken.release[0]?.message,'synthetic rollback failed');
});
test('factory mounts only GET/:id/operacion, no-store, typed errors, and forwards unexpected faults',async()=>{
  const f=fixture(),routes=[]; const express={Router:()=>({get:(path,handler)=>routes.push({path,handler})})};
  createClientOperationRouter({express,pool:f.pool}); assert.equal(routes.length,1); assert.equal(routes[0].path,'/:id/operacion');
  let body,status=200,forwarded; const headers={};
  const res={set:(key,value)=>{headers[key]=value;},status:value=>{status=value;return res;},json:value=>{body=value;return res;}};
  await routes[0].handler({auth,params:{id:'1'},query:{}},res,error=>{forwarded=error;});
  assert.equal(status,400); assert.equal(f.connections,0); assert.equal(headers['Cache-Control'],'no-store'); assert.equal(forwarded,undefined);
  status=200; body=undefined;
  await routes[0].handler({auth,params:{id:'1'},query:{periodo:period}},res,error=>{forwarded=error;});
  assert.equal(status,200); assert.equal(body.version,1); assert.equal(forwarded,undefined);
  const failing=fixture({failAt:'COMMIT'}),other=[];
  createClientOperationRouter({express:{Router:()=>({get:(_path,handler)=>other.push(handler)})},pool:failing.pool}); body=undefined;
  await other[0]({auth,params:{id:'1'},query:{periodo:period}},res,error=>{forwarded=error;});
  assert.ok(forwarded instanceof Error); assert.equal(body,undefined);
});
test('new aggregate never imports provider/network code or performs writes/initializers',()=>{
  const source=readFileSync(new URL('../src/client-operation.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/fetch\(|google-drive|INSERT INTO|UPDATE .* SET|prepareGoal\(|reconcileMonthlyGoals\(/);
});
