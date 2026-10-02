import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addSupervisorWorkMinutes, isSupervisorWorkTime, localClock, nextSupervisorWorkTime,
  userOwnsSupervisorTask, isSupervisorLeader, proposeSupervisorDeadline, validateSupervisorReport,
  detectSupervisorSignals, supervisorTaskActive,
} from '../src/mia-supervisor-policy.js';
import { supervisorReasoning } from '../src/mia-supervisor-reasoning.js';

const user = { id:1,usuario:'disenador',nombre:'Diseñador',rol:'diseno' };
const task = { id:1,titulo:'Optimizar Instagram: actualizar íconos e historias destacadas',asignado_a:'Diseñador',
  estado:'pendiente',tipo_tarea:'diseno',prioridad:'media',fecha_vencimiento:null,propiedades_extra:{ workspace:'render_os' } };
const now = new Date('2026-10-02T13:00:00Z'); // Viernes 10:00 Argentina.

test('supervisor respeta ambas franjas de lunes a sábado y excluye domingos', () => {
  for (const hour of ['08:00','12:59','17:00','21:29']) assert.equal(isSupervisorWorkTime(new Date(`2026-10-03T${hour}:00-03:00`)),true);
  for (const hour of ['07:59','13:00','16:59','21:30']) assert.equal(isSupervisorWorkTime(new Date(`2026-10-03T${hour}:00-03:00`)),false);
  assert.equal(isSupervisorWorkTime(new Date('2026-10-04T10:00:00-03:00')),false);
  assert.equal(localClock(new Date('2026-10-03T02:00:00Z')).date,'2026-10-02');
});

test('tres horas laborales atraviesan almuerzo, noche y domingo sin contarlos', () => {
  assert.equal(addSupervisorWorkMinutes(now,180).toISOString(),'2026-10-02T20:00:00.000Z');
  assert.equal(addSupervisorWorkMinutes(new Date('2026-10-03T20:30:00-03:00'),180).toISOString(),'2026-10-05T13:00:00.000Z');
  assert.equal(addSupervisorWorkMinutes(new Date('2026-10-02T12:59:30-03:00'),180).toISOString(),'2026-10-02T22:59:30.000Z');
  assert.equal(nextSupervisorWorkTime(new Date('2026-10-04T10:00:00-03:00')).toISOString(),'2026-10-05T11:00:00.000Z');
});

test('la autorización de líder depende del rol técnico y no del nombre Franco', () => {
  assert.equal(isSupervisorLeader({ usuario:'lider',nombre:'Franco',rol:'diseno' }),false);
  assert.equal(isSupervisorLeader({ nombre:'Franco Romero',rol:'produccion' }),false);
  assert.equal(isSupervisorLeader({ rol:'admin' }),true);
  assert.equal(isSupervisorLeader({ rol:'lider' }),true);
  assert.equal(userOwnsSupervisorTask({ usuario:'franco',nombre:'Franco Romero',rol:'diseno' },{ ...task,asignado_a:'Líder' }),false);
});

test('todos los responsables cuentan por igual en la carga y la propuesta de plazo', () => {
  const second = { id:2,usuario:'otro',nombre:'Otro',rol:'edicion' };
  const shared = { ...task,propiedades_extra:{ workspace:'render_os',colaboradores:['Otro'] } };
  const backlog = Array.from({ length:5 },(_,i)=>({ ...task,id:10+i,titulo:'Campaña completa',asignado_a:'Otro' }));
  const baseline = proposeSupervisorDeadline(shared,[shared],[user,second],now);
  const loaded = proposeSupervisorDeadline(shared,[shared,...backlog],[user,second],now);
  assert.ok(loaded.fecha>baseline.fecha);
  assert.deepEqual(loaded.responsible_ids,[1,2]);
  assert.equal(loaded.horas_carga,30);
});

test('el planner respeta dependencias y avisa si no llega a la publicación', () => {
  const parent = { ...task,id:10,fecha_vencimiento:'2026-10-09' };
  const child = { ...task,tarea_padre_id:10,publicacion_fecha_programada:'2026-10-05' };
  const plan=proposeSupervisorDeadline(child,[parent,child],[user],now);
  assert.ok(plan.fecha>parent.fecha_vencimiento);
  assert.equal(plan.conflicto_publicacion,true);
  const circle = proposeSupervisorDeadline({ ...task,tarea_padre_id:10 },[{ ...task,tarea_padre_id:10 },{ ...parent,fecha_vencimiento:null,tarea_padre_id:1 }],[user],now);
  assert.equal(circle.fecha,null);
});

test('la carga posterior no vuelve imposible un plazo anterior salvo prioridad alta', () => {
  const dated={ ...task,fecha_vencimiento:'2026-10-05' };
  const future=Array.from({length:5},(_,i)=>({ ...task,id:20+i,fecha_vencimiento:'2026-10-30' }));
  const baseline=proposeSupervisorDeadline(dated,[dated],[user],now);
  assert.equal(proposeSupervisorDeadline(dated,[dated,...future],[user],now).fecha,baseline.fecha);
  assert.ok(proposeSupervisorDeadline(dated,[dated,...future.map(t=>({...t,prioridad:'alta'}))],[user],now).fecha>baseline.fecha);
});

test('rechaza emojis, respuestas vagas, fechas inventadas y motivos ausentes del mensaje real', () => {
  const overdue={ ...task,fecha_vencimiento:'2026-09-01' };
  for (const texto of ['👍','ya veo','después','ok']) assert.equal(validateSupervisorReport({ texto,estado:'en_progreso',motivo:'esperando material',nueva_fecha:'2026-10-03',fecha_texto:'mañana' },overdue,now).valid,false);
  const valid={ texto:'Estoy editando, faltan las fotos del producto; lo entrego mañana.',estado:'en_progreso',motivo:'faltan las fotos del producto',nueva_fecha:'2026-10-03',fecha_texto:'mañana' };
  assert.equal(validateSupervisorReport(valid,overdue,now).valid,true);
  assert.equal(validateSupervisorReport({ ...valid,nueva_fecha:'2026-10-05' },overdue,now).valid,false);
  assert.equal(validateSupervisorReport({ ...valid,motivo:'se cortó internet' },overdue,now).valid,false);
  assert.equal(validateSupervisorReport({ ...valid,nueva_fecha:null },overdue,now).valid,false);
});

test('no genera informes vacíos y excluye finalizadas, históricas y papelera', () => {
  assert.deepEqual(detectSupervisorSignals([task],[user],[],now),[]);
  assert.equal(supervisorTaskActive({ ...task,estado:'publicada' }),false);
  assert.equal(supervisorTaskActive({ ...task,propiedades_extra:{} }),false);
  assert.equal(supervisorTaskActive({ ...task,propiedades_extra:{ workspace:'render_os',papelera_render_os:'true' } }),false);
  const overloaded=Array.from({ length:4 },(_,i)=>({ ...task,id:i+1,fecha_vencimiento:'2026-09-30' }));
  assert.equal(detectSupervisorSignals(overloaded,[user],[],now)[0].tipo,'saturacion');
});

test('razonamiento usa GPT-6.1 Sol, sin herramientas, finanzas ni secretos en el contexto', async () => {
  const signal={ tipo:'dependencia',problema:'Una dependencia bloquea tres tareas',causa:'material pendiente',task_ids:[1] };
  let body;
  const mock=async(_url,args)=>{ body=JSON.parse(args.body); return { ok:true,json:async()=>({ status:'completed',output:[{ content:[{ type:'output_text',text:JSON.stringify({ recomendacion:'Priorizar el material de origen.',tarea_ids:[1] }) }] }] }) }; };
  const result=await supervisorReasoning(signal,[{ ...task,costo:9000,aclaraciones:'secreto',password:'secret' }],{ env:{ OPENAI_API_KEY:'test',MIA_SUPERVISOR_REASONING_ENABLED:'true' },fetchImpl:mock });
  assert.equal(result.status,'advisory');
  assert.equal(body.model,'gpt-6.1-sol');
  assert.equal(body.store,false);
  assert.equal(body.tools,undefined);
  assert.doesNotMatch(body.input,/9000|secreto|password/);
});

test('una caída o respuesta inválida del modelo no cambia reglas ni inventa acciones', async () => {
  const env={ OPENAI_API_KEY:'test',MIA_SUPERVISOR_REASONING_ENABLED:'true' };
  const signal={ task_ids:[1] };
  assert.equal((await supervisorReasoning(signal,[task],{ env,fetchImpl:async()=>{ throw Error('timeout'); } })).status,'unavailable');
  assert.equal((await supervisorReasoning(signal,[task],{ env,fetchImpl:async()=>({ ok:true,json:async()=>({ status:'completed',output:[{content:[{type:'output_text',text:'{"recomendacion":"Cambiar todo", "tarea_ids":[900]}'}]}] }) }) })).status,'invalid_output');
});
