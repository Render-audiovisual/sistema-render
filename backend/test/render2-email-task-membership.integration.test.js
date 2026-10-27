import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {notificarAsignacionTarea} from '../src/email-notifications.js';

test('email revalidates current task membership and address against disposable PostgreSQL before mocked transport', {
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55984,f=await startLocalHarness({port,clusterOnly:true});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');
    t.diagnostic(`Email membership fixture cleanup ENOENT: ${f.root}`);});
  assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,
    identity:(await f.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
      inet_server_port() port,current_setting('data_directory') directory`))[0]});
  const [task]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,prioridad,fecha_vencimiento,propiedades_extra)
    VALUES('QA399 private correction','Luciano QA','edicion','en_progreso','media','2026-10-30',
      '{"workspace":"render_os"}') RETURNING id,titulo`);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.equal(tables.length,110,'All current public tables, including the editing-progress ledger, are hashed');
  const snapshot=async()=>{
    const hashes={};for(const table of tables){assert.match(table,/^[a-z_][a-z0-9_]*$/);
      hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`))[0].hash;
    }return hashes;
  };
  const env={SMTP_HOST:'smtp.invalid',SMTP_USER:'fixture@example.invalid',SMTP_PASS:'not-a-provider-secret'};
  for(const reason of ['comentario','bloqueada','correcciones'])await t.test(`${reason}: withdrawn recipient excluded and current collaborator uses refreshed email`,async()=>{
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1',[task.id]);
    await f.query(`UPDATE usuarios SET activo=true,whatsapp_habilitado=false,email_notificaciones='old-'||id||'@example.invalid'
      WHERE id IN(91003,91004)`);
    await f.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable'),($1,91004,'colaborador')`,[task.id]);
    let before,selected=false;const sent=[];
    const pool={async query(sql,params){
      const rows=await f.query(sql,params);
      if(sql.includes('id=ANY')){
        assert.equal(selected,false);selected=true;
        // Deliberate fixture mutations after the sender captured old candidates.
        await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003',[task.id]);
        await f.query("UPDATE usuarios SET email_notificaciones='current@example.invalid' WHERE id=91004");
        before=await snapshot();
      }return {rows};
    }};
    const result=await notificarAsignacionTarea({pool,tarea:task,motivo:reason,detalle:'Private correction notes',
      destinatarioIds:[91003,91004],actorId:91001,env,
      transporter:{async sendMail(mail){sent.push(mail);return {messageId:'mock-only'};}}});
    assert.equal(selected,true);assert.equal(result.enviado,true);
    assert.deepEqual(sent.map(m=>m.to),['current@example.invalid']);
    assert.ok(sent[0].text.includes('Private correction notes'));
    assert.deepEqual(await snapshot(),before,'Sender and transport perform no database writes');
  });
  for(const properties of [{workspace:'render_os',archivada_render_os:true},
    {workspace:'render_os',papelera_render_os:true},{workspace:'legacy'}])await t.test(`hidden scope ${JSON.stringify(properties)} never sends`,async()=>{
    await f.query('UPDATE tareas SET propiedades_extra=$2::jsonb WHERE id=$1',[task.id,JSON.stringify(properties)]);
    const before=await snapshot();let sends=0;
    const result=await notificarAsignacionTarea({pool:{async query(sql,params){return {rows:await f.query(sql,params)};}},
      tarea:task,motivo:'correcciones',destinatarioIds:[91004],actorId:91001,env,
      transporter:{async sendMail(){sends++;throw Error('Unauthorized transport reached');}}});
    assert.equal(result.enviado,false);assert.equal(sends,0);assert.deepEqual(await snapshot(),before);
  });
});
