import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('cross-user workflow: assignment, correction, delivery, approval and completion agree in Home/Reports without publication',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const fixture=await startLocalHarness({port:55669});
  t.after(async()=>{await fixture.cleanup();await assert.rejects(access(fixture.root),e=>e.code==='ENOENT');t.diagnostic(`Own cross-sector fixture stopped and removed: ${fixture.root}`);});
  const api=(path,token,method='GET',body)=>request(fixture.base,`/api${path}`,{token,method,body});
  const ok=(result,status=200)=>{assert.equal(result.status,status,JSON.stringify(result.body));return result.body;};
  const login=async usuario=>ok(await api('/login',null,'POST',{usuario,password:fixturePassword})).token;
  const owner=await login('qa_franco'),reviewer=await login('qa_agustin');let editor=await login('qa_luciano');
  const unrelated=await login('qa_designer');
  const [clock]=await fixture.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today");
  const period=`${clock.today.slice(0,7)}-01`,secret='QA_CROSS_SECTOR_PRIVATE_FINANCE_55669';
  const [client]=await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Cross-sector client',true) RETURNING id");
  const [piece]=await fixture.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy) VALUES($1,'video','lista',$2,'QA retained editorial copy') RETURNING id",[client.id,clock.today]);
  const created=ok(await api('/tareas',owner,'POST',{titulo:'QA Cross-sector one video editing',workspace:'render_os',
    cliente_id:client.id,tipo_tarea:'edicion',subtipo:'video',asignado_a_id:91003,colaborador_ids:[],
    fecha_vencimiento:clock.today,material_referencia:'https://example.invalid/cross-sector-raw',aclaraciones:'QA exact original script',publicacion_id:piece.id}),201);
  await fixture.query('UPDATE tareas SET propiedades_extra=propiedades_extra || $2::jsonb WHERE id=$1',
    [created.id,JSON.stringify({private_finance:{amount:817293.46,secret}})]);
  const [goal]=await fixture.query('INSERT INTO cliente_objetivos_mensuales(clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por,cuentas) VALUES($1,$2,$3,$4,1,0,$5,$6::jsonb) RETURNING id',
    [`cliente-${client.id}`,period,client.id,'QA explicit goal','QA fixture',JSON.stringify([{id:client.id,nombre:'QA Cross-sector client'}])]);
  await fixture.query('INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,copy) VALUES($1,\'video\',1,$2,$3,\'QA exact one piece\',\'QA retained editorial copy\')',[goal.id,created.id,piece.id]);
  const task=async(token=owner)=>ok(await api(`/tareas/${created.id}?workspace=render_os`,token));
  const home=async token=>ok(await api('/inicio',token));
  const reports=async token=>ok(await api('/reportes/datos',token));
  const safe=value=>{assert.ok(!JSON.stringify(value).includes(secret));assert.ok(!JSON.stringify(value).includes('817293.46'));return value;};
  const publicationIsNotInvented=async()=>{
    const [row]=await fixture.query('SELECT estado,"fecha_publicación_real" AS actual_date,copy FROM publicaciones WHERE id=$1',[piece.id]);
    assert.equal(row.estado,'lista');assert.equal(row.actual_date,null);assert.equal(row.copy,'QA retained editorial copy');
    assert.deepEqual(await fixture.query("SELECT id FROM editorial_publicacion_eventos WHERE dominio='publicacion' AND pieza_id=$1",[piece.id]),[]);
    assert.equal((await fixture.query('SELECT id FROM cliente_objetivo_piezas WHERE objetivo_id=$1',[goal.id])).length,1,'One valid piece remains one quota slot');
  };
  const verifyViews=async(state,{open=1,review=0,completed=0}={})=>{
    const [current,personal,team,report,foreign]=await Promise.all([task(editor),home(editor),home(reviewer),reports(editor),home(unrelated)]);
    for(const data of [current,personal,team,report,foreign])safe(data);
    assert.equal(current.estado,state);assert.equal(current.asignado_a_id,91003);
    assert.equal(personal.user.id,91003);assert.equal(personal.summary.open,open);
    assert.equal(personal.summary.awaiting_review,review);
    assert.equal(personal.monthly_progress.total,1);assert.equal(personal.monthly_progress.completed,completed);
    assert.equal(personal.tasks.some(row=>row.id===created.id),Boolean(open));
    assert.equal(team.review.items.some(row=>row.id===created.id),Boolean(review));
    assert.equal(foreign.summary.open,0);assert.equal(foreign.monthly_progress.total,0);
    const rows=report.tareasRenderOs.filter(row=>row.id===created.id);assert.equal(rows.length,1);assert.equal(rows[0].estado,state);
    const category=report.resumenRenderOsPorDia[clock.today]?.ediciones;
    assert.equal(category?.total,1);assert.equal(category?.publicadas,completed,'Legacy report key counts completed work, not actual publication');
    const objectives=safe(ok(await api(`/cliente-objetivos?periodo=${clock.today.slice(0,7)}`,editor)));
    const objective=objectives.clientes.find(row=>row.id===goal.id&&row.clave===`cliente-${client.id}`);
    assert.ok(objective);assert.equal(objective.preparado,true);assert.equal(objective.reels,1);
    assert.equal(objective.piezas.length,1);const slot=objective.piezas[0];
    assert.equal(slot.tarea_id,created.id);assert.equal(slot.publicacion_id,piece.id);assert.equal(slot.estado,state);
    assert.equal(Boolean(slot.completada_at),Boolean(completed));
    await publicationIsNotInvented();
  };
  let first,second,correction;
  await t.test('independent users receive the same ID-bound task and correct personal/report counts',async()=>{
    await verifyViews('pendiente');
    const current=await task();
    assert.equal((await api(`/tareas/${created.id}?workspace=render_os`,unrelated,'PATCH',{estado:'en_progreso',expected_revision:current.revision})).status,404,'Nonmember mutation hides unavailable task scope');
    assert.equal((await task()).revision,current.revision);
    assert.equal((await api('/sueldos',editor)).status,403);
  });
  await t.test('employee works and delivers exact version; cannot self-approve',async()=>{
    ok(await api(`/tareas/${created.id}?workspace=render_os`,editor,'PATCH',{estado:'en_progreso',expected_revision:(await task()).revision}));
    await verifyViews('en_progreso');
    first=ok(await api(`/tareas-edicion/${created.id}/entregas`,editor,'POST',{request_id:randomUUID(),expected_revision:(await task()).revision,
      url:'https://example.invalid/cross-sector-v1',notes:'QA first version'}),201).delivery_id;
    await verifyViews('en_revision',{review:1});
    assert.equal((await api(`/tareas/${created.id}?workspace=render_os`,editor,'PATCH',{estado:'aprobada',expected_revision:(await task()).revision,expected_entrega_id:first})).status,403);
  });
  await t.test('another owner requests corrections; all connected views follow without changing assignment or publication',async()=>{
    correction=ok(await api(`/tareas-edicion/${created.id}/correcciones`,reviewer,'POST',{request_id:randomUUID(),expected_revision:(await task()).revision,
      expected_entrega_id:first,notes:'QA correct the ending of this version'}),201).decision_id;
    await verifyViews('en_progreso');
    const history=ok(await api(`/tareas-edicion/${created.id}/revisiones`,editor));
    assert.equal(history.decisions[0].id,correction);assert.equal(history.decisions[0].actor_id,91002);
    assert.equal(history.decisions[0].delivery_id,first);
  });
  await t.test('new login receives durable correction; second delivery rejects approval of an old version and owner approves exact version',async()=>{
    const previous=editor;ok(await api('/logout',editor,'POST',{}));
    assert.equal((await api('/inicio',previous)).status,401);
    editor=await login('qa_luciano');await verifyViews('en_progreso');
    second=ok(await api(`/tareas-edicion/${created.id}/entregas`,editor,'POST',{request_id:randomUUID(),expected_revision:(await task()).revision,
      url:'https://example.invalid/cross-sector-v2',notes:'QA corrected second version'}),201).delivery_id;
    await verifyViews('en_revision',{review:1});
    const revision=(await task()).revision;
    assert.equal((await api(`/tareas/${created.id}?workspace=render_os`,owner,'PATCH',{estado:'aprobada',expected_revision:revision,expected_entrega_id:first})).status,409);
    ok(await api(`/tareas/${created.id}?workspace=render_os`,owner,'PATCH',{estado:'aprobada',expected_revision:revision,expected_entrega_id:second}));
    await verifyViews('aprobada');
  });
  await t.test('completion is visible in fresh sessions and reports but still not an editorial publication',async()=>{
    ok(await api(`/tareas/${created.id}?workspace=render_os`,reviewer,'PATCH',{estado:'finalizada',expected_revision:(await task()).revision}));
    editor=await login('qa_luciano');await verifyViews('finalizada',{open:0,completed:1});
    const history=safe(ok(await api(`/tareas-edicion/${created.id}/revisiones`,editor)));
    assert.equal(history.latest_delivery.id,second);
    assert.deepEqual(history.decisions.map(row=>[row.action,row.delivery_id,row.actor_id]),[['correcciones',first,91002],['aprobada',second,91001]]);
    assert.equal((await fixture.query('SELECT id FROM tareas WHERE publicacion_id=$1',[piece.id])).length,1,'No duplicate work was generated by correction or completion');
    const assignments=await fixture.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id',[created.id]);
    assert.deepEqual(assignments,[{usuario_id:91003,tipo:'responsable'}]);
  });
});
