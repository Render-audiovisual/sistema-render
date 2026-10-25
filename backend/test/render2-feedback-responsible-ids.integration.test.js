import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {startLocalHarness,assertFixtureIdentity,request,fixturePassword} from '../scripts/render2-local-test.js';

test('explicit Feedback responsible IDs survive browser writes, historical edits and closed DTOs without name inference',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55893,f=await startLocalHarness({port});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own Feedback responsible-IDs cleanup ENOENT: ${f.root}; port${port}`);});
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
  await f.query("UPDATE usuarios SET nombre='QA257 Shared',whatsapp_habilitado=true WHERE id=ANY($1::int[])",[[91003,91004]]);
  const checked=(response,status=200)=>{assert.equal(response.status,status,'Unexpected principal HTTP status');return response.body;};
  const login=checked(await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}}));
  assert.equal(login.usuario.id,91001);
  const api=(path,method='GET',body)=>request(f.base,`/api${path}`,{token:login.token,method,body});
  const [legacy]=await f.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback)
    VALUES ('QA257 legacy note','Original historical text','general','QA history','QA history',
      '{"flujo":"feedback","responsables":["Unmapped historical label"],"responsable":"Unmapped historical label","cliente":"","estado":"pendiente","vigencia":"puntual"}'::jsonb) RETURNING id`);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  const mutable=new Set(['usuarios','notas_compartidas','feedback_browser_operations','mia_private_task_notifications']);
  async function hashes(all=false){const result={};for(const table of tables.filter(name=>all||!mutable.has(name))){
    result[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`))[0].hash;
  }return result;}
  const rows=table=>{assert.ok(mutable.has(table));return f.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`);};
  const stable=await hashes();let users=await rows('usuarios'),notes=await rows('notas_compartidas'),receipts=await rows('feedback_browser_operations'),queue=await rows('mia_private_task_notifications');
  const invariant=async()=>{assert.deepEqual(await hashes(),stable);for(const [table,expected]of [['usuarios',users],['notas_compartidas',notes],['feedback_browser_operations',receipts],['mia_private_task_notifications',queue]])assert.deepEqual(await rows(table),expected);};
  const create=ids=>({request_id:randomUUID(),action:'create',fields:{titulo:'QA257 selected homonym',contenido:'QA257 original',categoria:'general',
    feedback:{cliente:'',responsable:'Forged client label',responsables:['Forged client label'],responsable_ids:ids,estado:'pendiente',vigencia:'puntual',flujo:'feedback'}}});
  const read=async id=>checked(await api(`/notas/${id}/detalle?papelera=false`)).item;
  let selected,creation;
  async function acceptEdit(id,fields,expectedIds){
    await invariant();const held=await read(id),input={request_id:randomUUID(),action:'edit',note_id:Number(id),expected_updated_at:held.updated_at,fields};
    const body=checked(await api('/notas/operaciones','POST',input));
    assert.equal(body.operation.replayed,false);assert.equal(body.note.id,Number(id));
    if(expectedIds===undefined)assert.equal(Object.hasOwn(body.note.feedback,'responsable_ids'),false);
    else assert.deepEqual(body.note.feedback.responsable_ids,expectedIds);
    const nextNotes=await rows('notas_compartidas'),nextReceipts=await rows('feedback_browser_operations');
    assert.deepEqual(nextNotes.filter(({row})=>Number(row.id)!==Number(id)),notes.filter(({row})=>Number(row.id)!==Number(id)));
    const before=notes.find(({row})=>Number(row.id)===Number(id)).row,after=nextNotes.find(({row})=>Number(row.id)===Number(id)).row;
    assert.equal(after.contenido,fields.contenido);assert.deepEqual(after.feedback,before.feedback,'Unrelated edit cannot rewrite labels or IDs');
    const omit=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['contenido','updated_at','modificado_por'].includes(key)));
    assert.deepEqual(omit(after),omit(before));
    assert.equal(nextReceipts.length,receipts.length+1);assert.deepEqual(nextReceipts.filter(({row})=>row.request_id!==input.request_id),receipts);
    const receipt=nextReceipts.find(({row})=>row.request_id===input.request_id).row;
    assert.equal(receipt.actor_user_id,91001);assert.equal(Number(receipt.note_id),Number(id));assert.equal(receipt.action,'edit');
    assert.equal(Date.parse(receipt.note_updated_at),Date.parse(body.note.updated_at));assert.match(receipt.payload_hash,/^[a-f0-9]{64}$/);
    notes=nextNotes;receipts=nextReceipts;await invariant();return body.note;
  }
  async function deactivate(id){
    const before=users.find(({row})=>row.id===id).row;
    await f.query('UPDATE usuarios SET activo=false WHERE id=$1',[id]);
    const next=await rows('usuarios'),after=next.find(({row})=>row.id===id).row;
    assert.deepEqual(after,{...before,activo:false,user_admin_version:before.user_admin_version+1});
    assert.deepEqual(next.filter(({row})=>row.id!==id),users.filter(({row})=>row.id!==id));users=next;await invariant();
  }
  await t.test('explicit ID selects only the chosen homonym and persists canonical labels, not forged text',async()=>{
    creation=create([91003]);const body=checked(await api('/notas/operaciones','POST',creation),201);
    assert.equal(body.operation.replayed,false);selected=body.note;
    assert.deepEqual(selected.feedback.responsable_ids,[91003]);assert.deepEqual(selected.feedback.responsables,['QA257 Shared']);assert.equal(selected.feedback.responsable,'QA257 Shared');
    const nextNotes=await rows('notas_compartidas'),nextReceipts=await rows('feedback_browser_operations'),nextQueue=await rows('mia_private_task_notifications');
    assert.equal(nextNotes.length,notes.length+1);assert.deepEqual(nextNotes.filter(({row})=>Number(row.id)!==selected.id),notes);
    const stored=nextNotes.find(({row})=>Number(row.id)===selected.id).row;assert.deepEqual(stored.feedback,selected.feedback);assert.equal(stored.titulo,creation.fields.titulo);assert.equal(stored.contenido,creation.fields.contenido);
    assert.equal(nextReceipts.length,1);assert.equal(nextReceipts[0].row.actor_user_id,91001);assert.equal(nextReceipts[0].row.request_id,creation.request_id);assert.equal(Number(nextReceipts[0].row.note_id),selected.id);
    assert.equal(nextQueue.length,1);const notice=nextQueue[0].row;
    assert.equal(Number(notice.feedback_id),selected.id);assert.equal(notice.detalles.destinatario_usuario_id,91003);assert.equal(notice.detalles.actor_usuario_id,91001);
    assert.equal(notice.destinatario_clave,'qa_luciano');assert.equal(notice.estado,'pending');assert.equal(notice.motivo,'feedback');
    notes=nextNotes;receipts=nextReceipts;queue=nextQueue;await invariant();
    const reloaded=await read(selected.id);assert.deepEqual(reloaded.feedback,selected.feedback);
    selected=await acceptEdit(selected.id,{contenido:'QA257 text-only changed'},[91003]);
  });
  await t.test('historical note without IDs stays without IDs through reload and text-only edit',async()=>{
    assert.equal(Object.hasOwn((await read(legacy.id)).feedback,'responsable_ids'),false);
    await acceptEdit(legacy.id,{contenido:'QA257 historical text-only changed'},undefined);
  });
  await t.test('invalid ID shapes and explicit empty selection fail before any row mutation or receipt',async()=>{
    for(const ids of [null,'91003',['91003'],[91003,91003],[0],[-1],[2147483648],Array.from({length:21},(_,n)=>n+1),[]]){
      const before=await hashes(true),response=await api('/notas/operaciones','POST',create(ids));
      assert.equal(response.status,Array.isArray(ids)&&ids.length===0?422:400);assert.deepEqual(await hashes(true),before);await invariant();
    }
  });
  await t.test('changed selection to inactive ID rejects; original selection and exact creation replay remain bound',async()=>{
    await deactivate(91004);const held=await read(selected.id),before=await hashes(true);
    const rejected=await api('/notas/operaciones','POST',{request_id:randomUUID(),action:'edit',note_id:selected.id,expected_updated_at:held.updated_at,
      fields:{contenido:'Must not be stored',feedback:{responsable_ids:[91004]}}});
    assert.equal(rejected.status,422);assert.deepEqual(await hashes(true),before);await invariant();
    const replay=checked(await api('/notas/operaciones','POST',creation));assert.equal(replay.operation.replayed,true);assert.deepEqual(replay.note.feedback.responsable_ids,[91003]);
    const mismatch=await api('/notas/operaciones','POST',{...creation,fields:{...creation.fields,feedback:{...creation.fields.feedback,responsable_ids:[91004]}}});
    assert.equal(mismatch.status,409);assert.deepEqual(await hashes(true),before);await invariant();
  });
  await t.test('unchanged IDs on a now-inactive historical selection permit unrelated edits with or without ID echo',async()=>{
    await deactivate(91003);
    selected=await acceptEdit(selected.id,{contenido:'QA257 inactive text-only edit'},[91003]);
    selected=await acceptEdit(selected.id,{contenido:'QA257 unchanged ID echo',feedback:{responsable_ids:[91003],responsables:['Forged replacement'],responsable:'Forged replacement'}},[91003]);
    assert.deepEqual(selected.feedback.responsables,['QA257 Shared']);assert.equal(queue.length,1);
  });
  await invariant();assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename),tables);
  t.diagnostic(`${tables.length} public tables observed with exact allowed note/receipt/user changes; one selected-ID notice; real principal bearer HTTP, no native/cookie/provider or physical Wilson claim`);
});
