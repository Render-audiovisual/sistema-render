import test from 'node:test';
import assert from 'node:assert/strict';
import {followupMessage,batchMessage,taskLabel,supervisorWindow,nextSupervisorWindow} from '../src/mia-supervisor-messages.js';

test('avisos cortos con contexto, una sola pregunta y sin códigos técnicos',()=>{
  const task={titulo:'Carrusel de promoción',cliente_nombre:'Cliente ejemplo',fecha_vencimiento:'2026-09-30'};
  for(const message of [followupMessage(task,'overdue'),followupMessage(task,'missing_date',{fecha:'2026-10-07',id:'secret-uuid',razon:'diagnóstico interno'})]) {
    assert.match(message,/Carrusel de promoción/);
    assert.equal((message.match(/\?/g)||[]).length,1);
    assert.ok(message.length<230);
    assert.doesNotMatch(message,/#\d|UUID|Propuesta:|interno|secret/);
    assert.doesNotMatch(message,/y para cuándo|qué demoró.*quién/);
  }
});
test('títulos arbitrarios no inyectan preguntas múltiples ni códigos',()=>{
  const label=taskLabel({titulo:'¿Qué hacer? Tarea #1421 11111111-1111-1111-1111-111111111111\n'+ 'muy largo '.repeat(30)});
  assert.doesNotMatch(label,/[?¿\n]|#1421|11111111/);
  assert.ok(label.length<80);
});
test('fechas compatibles se agrupan sin pedir varias cosas ni contar tareas ocultas',()=>{
  const rows=['Reel','Carrusel'].map(title=>({motivo:'supervisor_seguimiento',detalles:{type:'missing_date',proposed_date:'2026-10-07',label:`«${title}»`}}));
  const text=batchMessage(rows);
  assert.match(text,/07\/10/);
  assert.match(text,/Reel.*Carrusel/);
  assert.equal((text.match(/\?/g)||[]).length,1);
});
test('un intento proactivo por franja, con cambio al día siguiente y descanso dominical',()=>{
  assert.equal(supervisorWindow(new Date('2026-10-03T09:00:00-03:00')),'2026-10-03:am');
  assert.equal(supervisorWindow(new Date('2026-10-03T21:00:00-03:00')),'2026-10-03:pm');
  assert.equal(supervisorWindow(new Date('2026-10-03T14:00:00-03:00')),null);
  assert.equal(nextSupervisorWindow(new Date('2026-10-03T21:00:00-03:00')).toISOString(),'2026-10-05T11:00:00.000Z');
});
