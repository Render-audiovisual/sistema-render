import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import express from 'express';
import {createWilsonRouter,buildWilsonSignatureMessage} from '../src/wilson-integration.js';
import { runMiaSupervisor,acceptSupervisorDeadline,recordSupervisorReply,recordSupervisorBlockerReply,
  acknowledgeSupervisorDelivery,supervisorNotificationDeliverable } from '../src/mia-supervisor.js';

const connection = process.env.MIA_SUPERVISOR_TEST_DATABASE_URL;
const now = new Date('2026-10-02T13:00:00Z');
const env = { MIA_SUPERVISOR_ENABLED:'true' };
const hash=(value)=>crypto.createHash('sha256').update(value).digest('hex');

test('supervisor completo: PostgreSQL aislado, transacciones, permisos y entregas', { skip:!connection },async(t)=>{
  const parsed=new URL(connection);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname),'Solo una base local de QA.');
  const admin=new pg.Pool({ connectionString:connection });
  const schema=`mia_supervisor_qa_${crypto.randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({ connectionString:connection,options:`-c search_path=${schema}` });
  t.after(async()=>{ await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  await pool.query(`CREATE TABLE usuarios(id SERIAL PRIMARY KEY,usuario TEXT,nombre TEXT,rol TEXT,whatsapp_id_hash CHAR(64),whatsapp_habilitado BOOLEAN DEFAULT TRUE);
    CREATE TABLE clientes(id SERIAL PRIMARY KEY,nombre TEXT);
    CREATE TABLE publicaciones(id SERIAL PRIMARY KEY,fecha_programada DATE);
    CREATE TABLE tareas(id SERIAL PRIMARY KEY,titulo TEXT,asignado_a TEXT,estado TEXT DEFAULT 'pendiente',prioridad TEXT DEFAULT 'media',tipo_tarea TEXT DEFAULT 'diseno',subtipo TEXT,
      cliente_id INTEGER,tarea_padre_id INTEGER,publicacion_id INTEGER,propiedades_extra JSONB DEFAULT '{"workspace":"render_os"}',aclaraciones TEXT,fecha_vencimiento DATE,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());`);
  for (const name of ['011_tareas_comentarios.sql','017_integracion_auditoria.sql','031_mia_private_task_notifications.sql']) await pool.query(fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  await pool.query('ALTER TABLE mia_private_task_notifications ADD COLUMN feedback_id BIGINT');
  await pool.query(fs.readFileSync(new URL('../migrations/046_mia_supervisor.sql',import.meta.url),'utf8'));
  await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,whatsapp_id_hash) VALUES
    ('lider','Líder','admin',$1),('disenador','Diseñador','diseno',$2),('produccion','Productor','produccion',$3),('franco','Franco Romero','diseno',$4)`,
    [hash('leader-qa'),hash('designer-qa'),hash('producer-qa'),hash('chovy-qa')]);
  await pool.query(`INSERT INTO mia_whatsapp_identities(actor_hash,usuario_id,notification_key,display_name) VALUES($1,1,'lider_agustin','Agustín'),($2,1,'lider_franco','Franco socio')`,[hash('leader-qa'),hash('partner-qa')]);
  const actor={ privateChat:true,userId:2,actorId:'designer-qa',actorName:'Diseñador',actorRole:'diseno' };
  const chovy={ privateChat:true,userId:4,actorId:'chovy-qa',actorName:'Franco',actorRole:'admin',isLeader:true }; // Forged claims must not grant privileges.
  const producer={ privateChat:true,userId:3,actorId:'producer-qa',actorName:'Productor' };
  const createTask=async(title,fields={})=>{
    const result=await pool.query(`INSERT INTO tareas(titulo,asignado_a,fecha_vencimiento,propiedades_extra) VALUES($1,$2,$3,$4::jsonb) RETURNING id`,
      [title,fields.owner || 'Diseñador',fields.date || null,JSON.stringify({ workspace:'render_os',...(fields.extra || {}) })]);
    return result.rows[0].id;
  };
  const count=async(table)=>(await pool.query(`SELECT count(*)::int count FROM ${table}`)).rows[0].count;
  const deliver=async(at)=>{
    const notifications=(await pool.query(`SELECT * FROM mia_private_task_notifications WHERE cancelled_at IS NULL AND estado='pending' AND supervisor_followup_id IS NOT NULL ORDER BY id`)).rows;
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      for(const n of notifications) {
        await db.query(`UPDATE mia_private_task_notifications SET estado='delivered',delivered_at=$2 WHERE id=$1`,[n.id,at]);
        await acknowledgeSupervisorDelivery(db,n,at);
      }
      await db.query('COMMIT');
    } finally { db.release(); }
    return notifications;
  };

  await t.test('dry-run no escribe ni reserva avisos; analiza una tarea real sin fecha',async()=>{
    await createTask('Optimizar Instagram: actualizar íconos e historias destacadas');
    const result=await runMiaSupervisor(pool,{ now,env });
    assert.equal(result.proposals.length,1);
    assert.equal(await count('mia_supervisor_proposals'),0);
    assert.equal(await count('mia_private_task_notifications'),0);
    assert.equal(await count('tarea_comentarios'),0);
  });

  await t.test('dos controles concurrentes crean una sola propuesta y un solo aviso privado',async()=>{
    await Promise.all([runMiaSupervisor(pool,{ dryRun:false,now,env }),runMiaSupervisor(pool,{ dryRun:false,now,env })]);
    assert.equal(await count('mia_supervisor_proposals'),1);
    assert.equal(await count('tarea_comentarios'),1);
    assert.equal(await count('mia_private_task_notifications'),1);
    const content=(await pool.query('SELECT contenido FROM tarea_comentarios')).rows[0].contenido;
    assert.match(content,/@Diseñador/);
  });

  await t.test('Franco Romero no hereda autoridad aunque el request diga líder; confirmación sin caducidad',async()=>{
    const proposal=(await pool.query(`SELECT * FROM mia_supervisor_proposals WHERE estado='pending'`)).rows[0];
    await assert.rejects(acceptSupervisorDeadline(pool,{ actor:chovy,taskId:proposal.tarea_id,proposalId:proposal.id,messageId:'bad-role',now,env }),{ status:403 });
    const accepted=await acceptSupervisorDeadline(pool,{ actor,taskId:proposal.tarea_id,proposalId:proposal.id,messageId:'accept-1',now,env });
    assert.equal(accepted.accepted,true);
    const repeated=await acceptSupervisorDeadline(pool,{ actor,taskId:proposal.tarea_id,proposalId:proposal.id,messageId:'accept-1',now,env });
    assert.equal(repeated.idempotent,true);
    assert.equal(await count('mia_supervisor_replies'),1);
    const notification=(await pool.query('SELECT * FROM mia_private_task_notifications ORDER BY id LIMIT 1')).rows[0];
    assert.equal(await supervisorNotificationDeliverable(pool,notification,{ env,now }),false);
  });

  await t.test('vencimiento por responsable: exactamente tres entregas separadas por tres horas laborales',async()=>{
    await pool.query(`UPDATE tareas SET estado='publicada'`);
    const id=await createTask('Carrusel vencido',{ date:'2026-09-30',extra:{ colaboradores:['Productor'] } });
    await runMiaSupervisor(pool,{ dryRun:false,now,env });
    const notifications=await deliver(now);
    assert.equal(notifications.length,2);
    let records=(await pool.query(`SELECT * FROM mia_supervisor_followups WHERE tarea_id=$1 ORDER BY usuario_id`,[id])).rows;
    assert.deepEqual(records.map((r)=>r.attempts),[1,1]);
    assert.equal(records[0].next_attempt_at.toISOString(),'2026-10-02T20:00:00.000Z');
    await runMiaSupervisor(pool,{ dryRun:false,now:new Date('2026-10-02T19:59:00Z'),env });
    assert.equal((await pool.query(`SELECT count(*)::int c FROM mia_private_task_notifications WHERE tarea_id=$1 AND supervisor_attempt=2`,[id])).rows[0].c,0);
    const second=new Date('2026-10-02T20:00:00Z');
    await runMiaSupervisor(pool,{ dryRun:false,now:second,env });
    assert.equal((await deliver(second)).length,2);
    const third=new Date('2026-10-02T23:00:00Z');
    await runMiaSupervisor(pool,{ dryRun:false,now:third,env });
    assert.equal((await deliver(third)).length,2);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM mia_private_task_notifications WHERE tarea_id=$1 AND motivo='supervisor_escalacion'`,[id])).rows[0].c,0);
    await runMiaSupervisor(pool,{ dryRun:false,now:new Date('2026-10-03T12:30:00Z'),env });
    records=(await pool.query(`SELECT * FROM mia_supervisor_followups WHERE tarea_id=$1`,[id])).rows;
    assert.deepEqual(records.map((r)=>r.estado),['escalated','escalated']);
    const leaders=(await pool.query(`SELECT destinatario_clave,mensaje FROM mia_private_task_notifications WHERE tarea_id=$1 AND motivo='supervisor_escalacion'`,[id])).rows;
    assert.equal(leaders.length,4); // Ambos líderes reciben el caso de cada responsable.
    assert.ok(leaders.every((n)=>['lider_agustin','lider_franco'].includes(n.destinatario_clave)));
    assert.match(leaders[0].mensaje,/3 pedidos privados entregados/);
  });

  await t.test('rechaza respuesta vacía, registra texto real y cancela recordatorios obsoletos',async()=>{
    const id=await createTask('Otra tarea atrasada',{ date:'2026-09-30' });
    await runMiaSupervisor(pool,{ dryRun:false,now,env });
    await assert.rejects(recordSupervisorReply(pool,{ actor,taskId:id,messageId:'empty',input:{ texto:'👍' },now,env }),{ status:422 });
    const input={ texto:'Estoy editando; faltan las fotos del producto y lo entrego mañana.',estado:'en_progreso',motivo:'faltan las fotos del producto',nueva_fecha:'2026-10-03',fecha_texto:'mañana' };
    const result=await recordSupervisorReply(pool,{ actor,taskId:id,messageId:'report-1',input,now,env });
    assert.equal(result.recorded,true);
    const saved=(await pool.query(`SELECT estado,to_char(fecha_vencimiento,'YYYY-MM-DD') fecha FROM tareas WHERE id=$1`,[id])).rows[0];
    assert.deepEqual(saved,{ estado:'en_progreso',fecha:'2026-10-03' });
    const outbox=(await pool.query(`SELECT cancelled_at FROM mia_private_task_notifications WHERE tarea_id=$1 AND supervisor_followup_id IS NOT NULL`,[id])).rows;
    assert.ok(outbox.every((n)=>n.cancelled_at));
    assert.equal((await recordSupervisorReply(pool,{ actor,taskId:id,messageId:'report-1',input,now,env })).idempotent,true);
    await assert.rejects(recordSupervisorReply(pool,{ actor,taskId:id,messageId:'report-1',input:{ ...input,texto:'Otro contenido' },now,env }),{ status:409 });
  });

  await t.test('destraba con contacto privado y acepta ayuda sin cambiar el plazo del responsable',async()=>{
    const id=await createTask('Material para reel',{ date:'2026-09-30' });
    const input={ texto:'Estoy bloqueada porque faltan las fotos del producto; puedo entregar mañana.',estado:'bloqueada',motivo:'faltan las fotos del producto',nueva_fecha:'2026-10-03',fecha_texto:'mañana',bloqueo_usuario_id:3 };
    const result=await recordSupervisorReply(pool,{ actor,taskId:id,messageId:'block-1',input,now,env });
    assert.equal(result.contacted,1);
    const reply=await recordSupervisorBlockerReply(pool,{ actor:producer,taskId:id,messageId:'help-1',input:{ texto:'Las fotos del producto ya están en la carpeta; pueden continuar.',motivo:'Las fotos del producto ya están en la carpeta' },now,env });
    assert.equal(reply.contacted,1);
    const saved=(await pool.query(`SELECT to_char(fecha_vencimiento,'YYYY-MM-DD') fecha,estado FROM tareas WHERE id=$1`,[id])).rows[0];
    assert.deepEqual(saved,{ fecha:'2026-10-03',estado:'pendiente' });
    const messages=(await pool.query(`SELECT destinatario_clave FROM mia_private_task_notifications WHERE tarea_id=$1`,[id])).rows;
    assert.ok(messages.every((m)=>['produccion','disenador'].includes(m.destinatario_clave)));
  });

  await t.test('fuera de horario y feature desactivada no crean intentos ni mensajes',async()=>{
    const id=await createTask('No molestar fuera de horario',{ date:'2026-09-30' });
    await runMiaSupervisor(pool,{ dryRun:false,now:new Date('2026-10-04T13:00:00Z'),env });
    assert.equal((await pool.query(`SELECT count(*)::int c FROM mia_private_task_notifications WHERE tarea_id=$1`,[id])).rows[0].c,0);
    const disabled=await runMiaSupervisor(pool,{ dryRun:false,now,env:{} });
    assert.equal(disabled.writes,0);
    await assert.rejects(recordSupervisorReply(pool,{ actor,taskId:id,messageId:'disabled',input:{},env:{} }),{ status:503 });
  });

  await t.test('cuenta compartida: el primer ACK no invalida al segundo líder',async()=>{
    const id=await createTask('Seguimiento del líder compartido',{owner:'Líder',date:'2026-09-30'});
    await runMiaSupervisor(pool,{dryRun:false,now,env});
    const notices=(await pool.query(`SELECT * FROM mia_private_task_notifications WHERE tarea_id=$1 AND supervisor_followup_id IS NOT NULL ORDER BY id`,[id])).rows;
    assert.equal(notices.length,2);
    for (let i=0;i<2;i++) {
      assert.equal(await supervisorNotificationDeliverable(pool,notices[i],{env,now}),true);
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query(`UPDATE mia_private_task_notifications SET estado='delivered',delivered_at=$2 WHERE id=$1`,[notices[i].id,now]);
        await acknowledgeSupervisorDelivery(db,notices[i],now);
        await db.query('COMMIT');
      } finally {db.release();}
      assert.equal((await pool.query(`SELECT attempts FROM mia_supervisor_followups WHERE id=$1`,[notices[i].supervisor_followup_id])).rows[0].attempts,i===0?0:1);
    }
  });

  await t.test('autoriza al responsable de dependencia y cancela pedidos superados',async()=>{
    const parent=await createTask('Fotos de producto',{owner:'Productor',date:'2026-09-30'});
    const id=await createTask('Carrusel dependiente',{date:'2026-09-30'});
    await pool.query(`UPDATE tareas SET tarea_padre_id=$2 WHERE id=$1`,[id,parent]);
    const input={texto:'Estoy bloqueada porque faltan las fotos del producto; puedo entregar mañana.',estado:'bloqueada',motivo:'faltan las fotos del producto',nueva_fecha:'2026-10-03',fecha_texto:'mañana'};
    const result=await recordSupervisorReply(pool,{actor,taskId:id,messageId:'parent-block',input,now,env});
    assert.equal(result.contacted,1);
    const notice=(await pool.query(`SELECT * FROM mia_private_task_notifications WHERE tarea_id=$1 AND motivo='supervisor_destrabar'`,[id])).rows[0];
    assert.equal(await supervisorNotificationDeliverable(pool,notice,{env,now}),true);
    const help={texto:'Las fotos del producto ya están en la carpeta; pueden continuar.',motivo:'Las fotos del producto ya están en la carpeta'};
    await assert.rejects(recordSupervisorBlockerReply(pool,{actor:chovy,taskId:id,messageId:'unasked',input:help,now,env}),{status:403});
    assert.equal((await recordSupervisorBlockerReply(pool,{actor:producer,taskId:id,messageId:'parent-help',input:help,now,env})).recorded,true);
    await recordSupervisorReply(pool,{actor,taskId:id,messageId:'unblocked',input:{texto:'Estoy editando, recibí las fotos del producto y lo entrego mañana.',estado:'en_progreso',motivo:'recibí las fotos del producto',nueva_fecha:'2026-10-03',fecha_texto:'mañana'},now,env});
    assert.equal(await supervisorNotificationDeliverable(pool,notice,{env,now}),false);
  });

  await t.test('ACKs concurrentes de una cuenta compartida cuentan una sola entrega',async()=>{
    const id=await createTask('ACK concurrente de socios',{owner:'Líder',date:'2026-09-30'});
    await runMiaSupervisor(pool,{dryRun:false,now,env});
    const notices=(await pool.query(`SELECT * FROM mia_private_task_notifications WHERE tarea_id=$1 AND supervisor_followup_id IS NOT NULL ORDER BY id`,[id])).rows;
    assert.equal(notices.length,2);
    await Promise.all(notices.map(async(n)=>{
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query(`UPDATE mia_private_task_notifications SET estado='delivered',delivered_at=$2 WHERE id=$1`,[n.id,now]);
        await acknowledgeSupervisorDelivery(db,n,now);
        await db.query('COMMIT');
      } finally {db.release();}
    }));
    assert.equal((await pool.query(`SELECT attempts FROM mia_supervisor_followups WHERE id=$1`,[notices[0].supervisor_followup_id])).rows[0].attempts,1);
  });

  await t.test('propuesta de tarea vinculada a publicación conserva el snapshot al aceptar',async()=>{
    const publication=(await pool.query(`INSERT INTO publicaciones(fecha_programada) VALUES('2026-11-01') RETURNING id`)).rows[0].id;
    const id=await createTask('Reel vinculado a publicación');
    await pool.query(`UPDATE tareas SET publicacion_id=$2 WHERE id=$1`,[id,publication]);
    await runMiaSupervisor(pool,{dryRun:false,now,env});
    const proposal=(await pool.query(`SELECT * FROM mia_supervisor_proposals WHERE tarea_id=$1 AND estado='pending'`,[id])).rows[0];
    const notice=(await pool.query(`SELECT * FROM mia_private_task_notifications WHERE tarea_id=$1 AND supervisor_followup_id IS NOT NULL`,[id])).rows[0];
    assert.equal(await supervisorNotificationDeliverable(pool,notice,{env,now}),true);
    assert.equal((await acceptSupervisorDeadline(pool,{actor,taskId:id,proposalId:proposal.id,messageId:'publication-deadline',now,env})).accepted,true);
  });

  await t.test('no entrega señales resueltas ni escalaciones respondidas',async()=>{
    for(let i=0;i<4;i++) await createTask(`Carga vencida ${i}`,{date:'2026-09-30'});
    await runMiaSupervisor(pool,{dryRun:false,now,env});
    const signal=(await pool.query(`SELECT * FROM mia_private_task_notifications WHERE motivo='supervisor_senal' LIMIT 1`)).rows[0];
    assert.ok(signal);
    await pool.query(`UPDATE mia_supervisor_signals SET active=FALSE WHERE fingerprint=$1`,[signal.detalles.signal]);
    assert.equal(await supervisorNotificationDeliverable(pool,signal,{env,now}),false);
    const escalation=(await pool.query(`SELECT * FROM mia_private_task_notifications WHERE motivo='supervisor_escalacion' LIMIT 1`)).rows[0];
    assert.ok(escalation);
    await pool.query(`UPDATE mia_supervisor_followups SET estado='answered' WHERE id=$1`,[escalation.detalles.followup_id]);
    assert.equal(await supervisorNotificationDeliverable(pool,escalation,{env,now}),false);
  });

  await t.test('HTTP firmado: contexto privado, roles de DB, replay y dry-run sin escrituras',async()=>{
    const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
    const httpEnv={...env,NODE_ENV:'test',WILSON_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'}),WILSON_SYSTEM_ACTOR_ID:'mia-qa',WILSON_ALLOWED_WHATSAPP_GROUP_IDS:'grupo-qa'};
    const app=express();
    app.use(express.json());
    app.use('/api/integraciones/wilson',createWilsonRouter({pool,env:httpEnv}));
    app.use((error,_req,res,_next)=>res.status(500).json({error:error.message}));
    const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    try {
      const send=async(actorId,path,{method='GET',body,groupId='',headers:reuse}={})=>{
        const fullPath='/api/integraciones/wilson'+path;
        const timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID(),actorName='Franco Líder';
        const signature=crypto.sign('sha256',Buffer.from(buildWilsonSignatureMessage({timestamp,nonce,channel:'whatsapp',actorId,groupId,actorName,method,path:fullPath,body})),privateKey).toString('base64');
        const headers=reuse||{'Content-Type':'application/json','x-wilson-channel':'whatsapp','x-wilson-actor-id':actorId,'x-wilson-group-id':groupId,'x-wilson-actor-name':actorName,'x-wilson-signature-version':'2','x-wilson-timestamp':timestamp,'x-wilson-nonce':nonce,'x-wilson-signature':signature};
        const res=await fetch(`http://127.0.0.1:${server.address().port}${fullPath}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
        return {status:res.status,body:await res.json(),headers};
      };
      const own=await createTask('Privada al responsable',{owner:'Diseñador'});
      const other=await createTask('Solo para otro responsable',{owner:'Productor'});
      const designer=await send('designer-qa','/supervisor/contexto');
      assert.equal(designer.status,200);
      assert.ok(designer.body.tasks.some(t=>t.id===own));
      assert.ok(!designer.body.tasks.some(t=>t.id===other));
      const forged=await send('chovy-qa','/supervisor/contexto');
      assert.equal(forged.body.scope,'employee');
      assert.ok(!forged.body.tasks.some(t=>t.id===own));
      const partner=await send('partner-qa','/supervisor/contexto');
      assert.equal(partner.body.scope,'leader');
      assert.ok(partner.body.tasks.some(t=>t.id===other));
      assert.equal((await send('partner-qa','/supervisor/contexto',{headers:partner.headers})).status,409);
      assert.equal((await send('designer-qa','/supervisor/tick',{method:'POST',body:{dry_run:true}})).status,403);
      const before=await count('mia_supervisor_proposals');
      const dry=await send('mia-qa','/supervisor/tick',{method:'POST',body:{dry_run:true},groupId:'grupo-qa'});
      assert.equal(dry.status,200,JSON.stringify(dry.body));
      assert.equal(dry.body.dry_run,true);
      assert.equal(await count('mia_supervisor_proposals'),before);
      assert.equal((await send('designer-qa','/supervisor/comunicaciones')).status,403);
      const audit=await send('mia-qa','/supervisor/comunicaciones',{groupId:'grupo-qa'});
      assert.equal(audit.status,200);
      assert.equal(audit.body.readonly,true);
      assert.ok(audit.body.muestras.every(row=>!row.texto.includes('Carrusel vencido')&&!row.texto.includes('Diseñador')));
      assert.equal((await send('designer-qa',`/supervisor/tareas/${other}/respuesta`,{method:'POST',body:{message_id:'not-owner',texto:'Estoy editando, recibí las fotos y lo entrego mañana.',estado:'en_progreso',motivo:'recibí las fotos',nueva_fecha:'2026-10-03',fecha_texto:'mañana'}})).status,403);
    } finally {await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  });
});
