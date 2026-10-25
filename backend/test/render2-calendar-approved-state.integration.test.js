import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {startLocalHarness,assertFixtureIdentity,request,fixturePassword} from '../scripts/render2-local-test.js';
import {isTaskApproved} from '../src/workflow-contract.js';
import {effectiveTaskFilterState} from '../../frontend/src/features/render-os/utils/task-view-state.js';
import {calendarGrid,decodeCalendar,decodePagedCalendar,calendarTaskState} from '../../frontend/src/pages/calendarModel.js';
import {parsePersonalHome} from '../../frontend/src/pages/personalHome.js';
import {parseProject} from '../../frontend/src/pages/projectsModel.js';

test('historical boolean approval projects the same task state in principal Calendar, Home and Projects without migrating rows',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55888,f=await startLocalHarness({port});
  t.after(async()=>{
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own approved-state fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:'postgresql://render2_fixture@127.0.0.1:55888/render2_local_test',identity});
  const checked=(response,status=200)=>{assert.equal(response.status,status,'Unexpected principal HTTP status');return response.body;};
  const login=async usuario=>checked(await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}})).token;
  const admin=await login('qa_franco'),staff=await login('qa_luciano');
  const api=(path,token=staff,method='GET',body)=>request(f.base,`/api${path}`,{token,method,body});
  const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA252 effective approval',true) RETURNING id");
  const date='2026-10-28',mes='2026-10',grid=calendarGrid(mes);
  const variants=[
    {name:'historical boolean true',estado:'en_revision',approval:true,expected:'aprobada'},
    {name:'string true is not approval',estado:'en_revision',approval:'true',expected:'en_revision'},
    {name:'boolean false',estado:'en_revision',approval:false,expected:'en_revision'},
    {name:'canonical approved',estado:'aprobada',approval:true,expected:'aprobada'},
    {name:'finalized',estado:'finalizada',approval:true,expected:'finalizada'},
    {name:'legacy finalized alias',estado:'publicada',approval:true,expected:'publicada'},
  ];
  // Direct SQL intentionally preserves a supported historical representation.
  // This does NOT claim today's approval API creates raw en_revision + true.
  const tasks=[];
  for(const variant of variants){
    const props={workspace:'render_os',revision_aprobada:variant.approval};
    const [row]=await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
      VALUES($1,'Luciano QA',$2,'edicion',$3,$4::date,$5::jsonb)
      RETURNING id,estado,propiedades_extra,revision`,[`QA252 ${variant.name}`,client.id,variant.estado,date,JSON.stringify(props)]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[row.id]);
    tasks.push({...variant,...row});
    assert.equal(isTaskApproved(row),variant.expected==='aprobada');
    assert.equal(effectiveTaskFilterState(row),variant.expected==='publicada'?'finalizada':variant.expected);
  }
  const [outsider]=await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
    VALUES('QA252 other identity','Designer QA',$1,'diseno','pendiente',$2::date,'{"workspace":"render_os"}'::jsonb) RETURNING id`,[client.id,date]);
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91004,'responsable')",[outsider.id]);
  const project=checked(await api('/proyectos',admin,'POST',{
    request_id:randomUUID(),titulo:'QA252 linked task states',cliente_id:client.id,responsable_id:91003,miembro_ids:[],
    tipo:'web',descripcion:'Synthetic historical read projection',fecha_inicio:null,fecha_entrega:null,
  }),201).proyecto;
  await f.query('INSERT INTO proyecto_tareas(proyecto_id,tarea_id) SELECT $1,unnest($2::int[])',[project.id,tasks.map(row=>row.id)]);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(){const hashes={};for(const table of tables){
    hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`))[0].hash;
  }return hashes;}
  const before=await snapshot();
  const rawBefore=await f.query('SELECT id,estado,propiedades_extra,revision FROM tareas ORDER BY id');
  const selection=scope=>({mes,dia:date,scope,tipo:'all',cliente:String(client.id),pagina:0});
  const calendar=(scope,extra={})=>api(`/calendario?${new URLSearchParams({desde:grid.desde,hasta:grid.hasta,scope,kind:'all',cliente_id:String(client.id),...extra})}`);
  function checkEvents(events,scope){
    const ids=events.map(event=>event.source_id);
    assert.equal(new Set(ids).size,ids.length);
    assert.deepEqual([...ids].sort((a,b)=>a-b),[...tasks.map(row=>row.id),...(scope==='team'?[outsider.id]:[])].sort((a,b)=>a-b));
    for(const task of tasks){
      const event=events.find(item=>item.source_id===task.id);
      assert.equal(event.estado,task.expected,`Calendar effective state: ${task.name}`);
      assert.equal(event.date,date);assert.equal(event.href,`/workspace/tareas?task=${task.id}`);
      assert.equal(event.kind,'tarea');assert.equal(event.source,'tarea');assert.equal(event.evidence,null);
      assert.equal(calendarTaskState(event.estado),task.expected==='aprobada'?'Aprobada':task.expected==='en_revision'?'En revisión':'Finalizada');
    }
    assert.ok(events.every(event=>event.kind==='tarea'),'Finalized/approved tasks never invent publication events');
  }
  for(const scope of ['mine','team'])await t.test(`${scope}: legacy DTO and every limit2 page agree, plus actual UI parser at limit200`,async()=>{
    const legacy=checked(await calendar(scope));checkEvents(decodeCalendar(legacy,selection(scope)).events,scope);
    const events=[];let offset=0,snapshotToken,total;
    do{
      const page=checked(await calendar(scope,{limit:'2',offset:String(offset),dia:date,...(snapshotToken?{expected_snapshot:snapshotToken}:{})}));
      assert.equal(page.pagination.limit,2);assert.equal(page.pagination.offset,offset);
      assert.equal(page.pagination.day,date);
      if(snapshotToken)assert.equal(page.pagination.snapshot,snapshotToken);else snapshotToken=page.pagination.snapshot;
      total??=page.pagination.total;assert.equal(page.pagination.total,total);
      const parsed=decodeCalendar(page,selection(scope));events.push(...parsed.events);
      assert.equal(page.pagination.has_more,offset+page.events.length<total);
      if(!page.pagination.has_more)break;
      assert.equal(page.events.length,2);offset+=2;assert.ok(offset<20,'Bounded synthetic pagination');
    }while(true);
    assert.equal(events.length,total);checkEvents(events,scope);
    // Actual UI requires its fixed limit200. Do not forge limit2 DTO metadata
    // merely to satisfy decodePagedCalendar's deliberately strict contract.
    const ui=checked(await calendar(scope,{limit:'200',offset:'0',dia:date}));
    checkEvents(decodePagedCalendar(ui,selection(scope)).events,scope);
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('Home and linked Project DTOs match supported approval semantics by exact task ID/date',async()=>{
    const home=parsePersonalHome(checked(await api('/inicio')),91003,false);
    const open=tasks.filter(task=>!['finalizada','publicada'].includes(task.estado));
    assert.deepEqual(home.tasks.map(row=>row.id).sort((a,b)=>a-b),open.map(row=>row.id).sort((a,b)=>a-b));
    assert.equal(home.summary.awaiting_review,2);assert.equal(home.review.total,2);
    for(const task of open){const row=home.tasks.find(row=>row.id===task.id);assert.equal(row.estado,task.expected);assert.equal(row.fecha_vencimiento,date);}
    const detail=parseProject(checked(await api(`/proyectos/${project.id}`)).proyecto,true);
    assert.equal(detail.tareas_no_disponibles,0);assert.equal(detail.counts.finalizadas,2);
    assert.deepEqual(detail.tareas.map(row=>row.id).sort((a,b)=>a-b),tasks.map(row=>row.id).sort((a,b)=>a-b));
    for(const task of tasks){const row=detail.tareas.find(row=>row.id===task.id);assert.equal(row.estado,task.expected,`Project effective state: ${task.name}`);assert.equal(row.fecha_vencimiento,date);assert.equal(row.href,`/workspace/tareas?task=${task.id}`);}
    assert.deepEqual(await snapshot(),before);
  });
  assert.deepEqual(await f.query('SELECT id,estado,propiedades_extra,revision FROM tareas ORDER BY id'),rawBefore,'Readers must not migrate or rewrite historical approval rows');
  assert.deepEqual(await snapshot(),before);
  t.diagnostic(`All ${tables.length} public tables unchanged after principal bearer reads; historical SQL seed, not a new approval-API workflow, browser, cookie or publication proof`);
});
