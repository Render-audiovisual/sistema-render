import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {assertCoreSchemaReady} from '../src/startup-schema.js';

test('pre092 populated comment history upgrades without inferring authors or rewriting rows',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:240000,
},async t=>{
  const port=55953,f=await startLocalHarness({port,clusterOnly:true,deferTaskCommentActorMigration:true});let db;
  t.after(async()=>{try{await db?.query('ROLLBACK').catch(()=>{});await db?.end();}finally{
    await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');t.diagnostic('Own pre092 fixture removed by ENOENT.');
  }});
  db=new pg.Client({host:'127.0.0.1',port,user:'render2_fixture',password:'',database:'render2_local_test',ssl:false,statement_timeout:20000,connectionTimeoutMillis:5000});await db.connect();
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,
    identity:(await db.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0]});
  const [task]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
    VALUES('QA345 pre092','Franco QA','desarrollo','pendiente','{"workspace":"render_os"}') RETURNING id`);
  await f.query(`INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES
    ($1,'Franco QA','Historical exact current name is not identity proof'),
    ($1,'Mía · Supervisor','Historical system message')`,[task.id]);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  const snapshot=async()=>{const values={};for(const table of tables.filter(name=>name!=='_migrations')){
    assert.match(table,/^[a-z_][a-z0-9_]*$/);const row=table==='tarea_comentarios'?"to_jsonb(t)-'actor_usuario_id'":'to_jsonb(t)';
    values[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array((${row}),t.xmin::text,t.ctid::text)
      ORDER BY (${row})::text,t.ctid::text)::text,'[]')) hash FROM "${table}" t`))[0].hash;
  }return values;};
  const before=await snapshot(),ledger=await f.query('SELECT to_jsonb(t) row FROM _migrations t ORDER BY id');
  const finish=async handle=>{const result=await handle.done;
    assert.equal(`${result.stdout}${result.stderr}`.includes(f.secret),false);
    assert.equal(/postgres(?:ql)?:\/\//i.test(`${result.stdout}${result.stderr}`),false);return result;};
  const cli=async args=>finish(await f.launchActual({entry:'migrate',args}));
  const status=await cli(['status']);assert.equal(status.code,0);const approved=JSON.parse(status.stdout);
  assert.deepEqual(approved.status.pending.map(file=>file.name),['092_task_comment_actor.sql']);
  await assert.rejects(assertCoreSchemaReady(db),/schema is not compatible/);
  const server=await f.launchActual({entry:'server'});
  try{await assert.rejects(server.ready);assert.notEqual((await finish(server)).code,0);}finally{await server.stop();}
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await f.query('SELECT to_jsonb(t) row FROM _migrations t ORDER BY id'),ledger);
  const result=await cli(['apply','--plan',approved.planHash,'--database','render2_local_test','--user','render2_fixture']);assert.equal(result.code,0);
  assert.deepEqual(await snapshot(),before,'Every old row, xmin and ctid survives the additive upgrade');
  const rows=await f.query('SELECT autor,contenido,actor_usuario_id FROM tarea_comentarios ORDER BY id');
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.actor_usuario_id===null));
  await assertCoreSchemaReady(db);
  for(const replacement of ['', 'ON DELETE CASCADE', 'ON DELETE RESTRICT DEFERRABLE']){
    await db.query('BEGIN');
    try{
      await db.query('ALTER TABLE tarea_comentarios DROP CONSTRAINT tarea_comentarios_actor_fk');
      if(replacement)await db.query(`ALTER TABLE tarea_comentarios ADD CONSTRAINT qa_wrong_actor_fk
        FOREIGN KEY(actor_usuario_id) REFERENCES usuarios(id) ${replacement}`);
      await assert.rejects(assertCoreSchemaReady(db),/comment actor is not compatible/);
    }finally{await db.query('ROLLBACK');}
  }
  await assertCoreSchemaReady(db);assert.deepEqual(await snapshot(),before);
  await db.query('BEGIN');
  try{
    await db.query('ALTER TABLE tarea_comentarios ALTER COLUMN actor_usuario_id SET DEFAULT 91001');
    await assert.rejects(assertCoreSchemaReady(db),/comment actor is not compatible/);
  }finally{await db.query('ROLLBACK');}
  await assertCoreSchemaReady(db);assert.deepEqual(await snapshot(),before);
  const after=JSON.parse((await cli(['status'])).stdout);assert.deepEqual(after.status.pending,[]);
  assert.deepEqual(after.status.applied,[...approved.status.applied,'092_task_comment_actor.sql']);
});
