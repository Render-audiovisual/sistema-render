import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness,assertFixtureIdentity,request,fixturePassword } from '../scripts/render2-local-test.js';
import { uniqueReportTasks,buildEmployeeReport,employeeTaskDetails,editorialRecords,summarizeEditorialRecords } from '../../frontend/src/shared/reports/production-registry-report.js';

test('principal report HTTP excludes RenderOS trash and retains canonical completion dates without inventing publication',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55882,f=await startLocalHarness({port});
  t.after(async()=>{
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own report live-task fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:'postgresql://render2_fixture@127.0.0.1:55882/render2_local_test',identity});
  const checked=(response,status=200)=>{
    assert.equal(response.status,status,'Unexpected principal HTTP status; do not print authentication payloads');return response.body;
  };
  const login=async usuario=>checked(await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}})).token;
  const admin=await login('qa_franco'),staff=await login('qa_luciano');
  const [clock]=await f.query(`SELECT
    to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today,
    to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period,
    to_char(date_trunc('month',clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba'),'YYYY-MM-DD') AS first_day,
    to_char(date_trunc('month',clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')+interval '1 month','YYYY-MM-DD') AS next_month`);
  const completion=`${clock.today}T12:34:56.789Z`;
  const canary='QA241_SYNTHETIC_PRIVATE_FINANCE',amount=817293.46;
  const variants=[
    ['live',{workspace:'render_os'}],
    ['trash boolean',{workspace:'render_os',papelera_render_os:true}],
    ['trash string',{workspace:'render_os',papelera_render_os:'true'}],
    ['archived boolean',{workspace:'render_os',archivada_render_os:true}],
    ['archived string',{workspace:'render_os',archivada_render_os:'true'}],
    ['historical',{workspace:'legacy'}],
  ];
  const ids={};
  for(const [kind,extra]of variants){
    const [row]=await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
      VALUES($1,'Luciano QA','finalizada','edicion','video',$2::date,$3::jsonb) RETURNING id`,[
      `QA241 ${kind} video`,clock.today,JSON.stringify({...extra,finalizada_at:completion,private_finance:{marker:canary,amount}}),
    ]);
    ids[kind]=row.id;
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[row.id]);
  }
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(){
    const hashes={};
    for(const table of tables){
      const [row]=await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`);
      hashes[table]=row.hash;
    }
    return hashes;
  }
  const same=(actual,expected)=>assert.deepEqual(tables.filter(name=>actual[name]!==expected[name]),[],
    'Read mutated public table contents; only table names are reported');
  // Baseline is after setup and both logins. Include auth/session tables too:
  // no login/logout or deliberate write is performed in the read phase.
  const before=await snapshot();
  const range={desde:clock.first_day,hasta:clock.next_month};
  const reportPath=`/api/reportes/datos?${new URLSearchParams({mes_configuracion:clock.period,...range})}`;
  const reports={};
  for(const [role,token]of [['admin',admin],['employee',staff]])await t.test(`${role}: only live RenderOS task remains; historical namespace is preserved`,async()=>{
    const dto=checked(await request(f.base,reportPath,{token}));reports[role]=dto;
    assert.deepEqual(dto.tareasRenderOs.map(row=>row.id),[ids.live]);
    assert.deepEqual(dto.tareas.map(row=>row.id),[ids.historical]);
    assert.equal(dto.tareasRenderOs[0].estado,'finalizada');
    assert.equal(dto.tareasRenderOs[0].propiedades_extra.finalizada_at,completion);
    assert.deepEqual(dto.resumenRenderOsPorDia[clock.today].ediciones,{total:1,publicadas:1},
      'Legacy publicadas aggregate describes completed work, never editorial publication');
    {
      const serialized=JSON.stringify(dto);
      assert.ok(!serialized.includes(canary));assert.ok(!serialized.includes(String(amount)));
      assert.ok(!serialized.includes('private_finance'));
      assert.deepEqual(dto.usuarios.map(row=>row.id),[91001,91002,91003,91004], 'Report identity catalog is team-wide, not the personal Home scope');
    }
    same(await snapshot(),before);
  });
  await t.test('actual frontend projections consume employee DTO date and count live/historical separately',async()=>{
    const dto=reports.employee;assert.ok(dto,'Employee HTTP observation is required');
    const live=buildEmployeeReport(dto.usuarios,dto.tareasRenderOs,range,clock.today);
    const editorLive=live.rows.find(row=>row.id===91003);
    assert.equal(live.uniqueTasks,1);assert.equal(editorLive.total,1);assert.equal(editorLive.finalizadas,1);
    const tasks=uniqueReportTasks(dto.tareas,dto.tareasRenderOs);
    const combined=buildEmployeeReport(dto.usuarios,tasks,range,clock.today);
    const editorCombined=combined.rows.find(row=>row.id===91003);
    assert.equal(combined.uniqueTasks,2);assert.equal(editorCombined.total,2);assert.equal(editorCombined.finalizadas,2);
    const details=employeeTaskDetails(tasks,91003,range);
    assert.deepEqual(details.map(row=>row.id).sort((a,b)=>a-b),[ids.live,ids.historical].sort((a,b)=>a-b));
    assert.ok(details.every(row=>row.finalizada===completion),'Real detail helper must not produce Sin fecha registrada');
    assert.equal(details.find(row=>row.id===ids.live).href,`/workspace/tareas?task=${ids.live}`);
    assert.equal(details.find(row=>row.id===ids.historical).href,null);
    assert.equal(summarizeEditorialRecords(editorialRecords(dto.historias,dto.publicaciones),range)
      .reduce((sum,row)=>sum+row.publicadas,0),0);
    same(await snapshot(),before);
  });
  await t.test('Home agrees on one monthly live completion and does not count trash, archive or legacy work',async()=>{
    const home=checked(await request(f.base,'/api/inicio',{token:staff}));
    assert.equal(home.user.id,91003);assert.equal(home.monthly_progress.period,clock.period);
    assert.equal(home.monthly_progress.total,1);assert.equal(home.monthly_progress.completed,1);
    assert.equal(home.summary.open,0);
    assert.ok(!JSON.stringify(home).includes(canary));assert.ok(!JSON.stringify(home).includes(String(amount)));
    assert.deepEqual(await f.query('SELECT id FROM publicaciones'),[]);
    assert.deepEqual(await f.query('SELECT id FROM historias'),[]);
    same(await snapshot(),before);
  });
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename),tables);
  same(await snapshot(),before);
  t.diagnostic(`Own fixture ${f.root}; all ${tables.length} public table row hashes unchanged after reads; HTTP+actual projection helpers, not native browser/provider proof`);
});
