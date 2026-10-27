import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import pg from 'pg';
import {startLocalHarness} from '../scripts/render2-local-test.js';
import {assertCoreSchemaReady} from '../src/startup-schema.js';

test('editing progress startup refuses missing, disabled, changed or legacy projection without repair',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const f=await startLocalHarness({port:55994,clusterOnly:true});let db;
  t.after(async()=>{try{await db?.query('ROLLBACK').catch(()=>{});await db?.end();}finally{await f.cleanup();await assert.rejects(access(f.root),{code:'ENOENT'});}});
  db=new pg.Client({host:'127.0.0.1',port:55994,user:'render2_fixture',database:'render2_local_test'});await db.connect();
  await assertCoreSchemaReady(db);
  const mutations=[
    'ALTER TABLE tareas DISABLE TRIGGER editing_progress_v1_task_projection',
    'DROP TRIGGER editing_progress_v1_task_projection ON tareas',
    "CREATE OR REPLACE FUNCTION public.project_existing_editing_progress_task() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO pg_catalog AS $$ BEGIN RETURN NEW; END; $$",
    'CREATE TRIGGER progreso_edicion_tarea_cambio AFTER UPDATE ON tareas FOR EACH ROW EXECUTE FUNCTION project_existing_editing_progress_task()',
    'DROP TRIGGER editing_progress_v1_task_projection ON tareas; CREATE TRIGGER editing_progress_v1_task_projection AFTER UPDATE ON tareas FOR EACH ROW WHEN (false) EXECUTE FUNCTION project_existing_editing_progress_task()',
  ];
  for(const sql of mutations)await t.test(sql.split(' ').slice(0,4).join(' '),async()=>{
    await db.query('BEGIN');try{await db.query(sql);await assert.rejects(assertCoreSchemaReady(db),/editing progress projection is not compatible.*No repair/);}finally{await db.query('ROLLBACK');}
    await assertCoreSchemaReady(db);
  });
  t.diagnostic('Real catalog negative checks rolled back; fixture removed, no production/providers.');
});
