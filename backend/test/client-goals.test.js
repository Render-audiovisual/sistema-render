import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goalPeriod, goalClients, goalTaskType, candidateTasks, prepareGoal, editGoalContent, inheritedGoalResponsibles, reconcileMonthlyGoals } from '../src/client-goals.js';

test('los objetivos sólo aceptan un mes explícito válido', () => {
  assert.equal(goalPeriod('2026-10'), '2026-10');
  for (const value of ['2026-00', '2026-13', 'octubre', '', undefined, '2026-10-01']) assert.throws(() => goalPeriod(value));
});
test('las cuentas de un feed comparten un único objetivo sin importes', () => {
  const result = goalClients([
    { id: 1, nombre: 'Turismo', grupo_feed_id: 4, grupo_feed_nombre: 'Ángel Azul', cuota_feed_reels: 4, cuota_feed_carruseles: 2, abono_mensual: 999 },
    { id: 2, nombre: 'Estudiantil', grupo_feed_id: 4, grupo_feed_nombre: 'Ángel Azul', cuota_feed_reels: 4, cuota_feed_carruseles: 2, abono_mensual: 999 },
  ]);
  assert.equal(result.length, 1); assert.equal(result[0].reels, 4); assert.equal(result[0].cuentas.length, 2);
  assert.ok(!JSON.stringify(result).includes('abono')); assert.ok(!JSON.stringify(result).includes('999'));
});
test('subtareas, historias y visitas no completan espacios adicionales de reels', () => {
  assert.equal(goalTaskType({ titulo: 'Reel 1', tipo_tarea: 'produccion' }), null);
  assert.equal(goalTaskType({ titulo: 'Editar reel', tarea_padre_id: 6 }), null);
  assert.equal(goalTaskType({ titulo: 'Carrusel', historia_id: 8 }), null);
  assert.equal(goalTaskType({ titulo: 'Diseñar', pieza_tipo: 'carrusel' }), 'carrusel');
  assert.equal(goalTaskType({ titulo: 'Reel de promoción' }), 'video');
});
test('una publicación con varias tareas se vincula una sola vez', () => {
  const tasks = [{ id: 1, pieza_tipo: 'video', publicacion_id: 8 }, { id: 2, pieza_tipo: 'video', publicacion_id: 8 }, { id: 3, titulo: 'Reel independiente' }];
  assert.deepEqual(candidateTasks(tasks, 'video').map(task => task.id), [1, 3]);
  assert.deepEqual(candidateTasks(tasks, 'video', new Set([8])).map(task => task.id), [3]);
});
test('preparar objetivos nunca modifica septiembre y requiere personas reales', async () => {
  const db = { connect() { throw new Error('No debe abrir una conexión'); } };
  await assert.rejects(prepareGoal(db, { period: '2026-09', responsibleIds: [1] }), /octubre/);
  await assert.rejects(prepareGoal(db, { period: '2026-10', responsibleIds: [] }), /responsable/);
  await assert.rejects(prepareGoal(db, { period: '2026-10', responsibleIds: ['1'] }), /responsable/);
});
test('la asignación por cuenta sólo acepta listas explícitas de usuarios seleccionados', async () => {
  const db = { connect() { throw new Error('No debe abrir una conexión'); } };
  for (const responsibleByAccount of [null,[],{'1':[]},{'1':['1']},{'1':[2]},{'grupo-1':[1]},{'1':{video:[1]}}]) {
    await assert.rejects(prepareGoal(db,{period:'2026-10',responsibleIds:[1],responsibleByAccount}), /cuenta/);
  }
});
test('el seguimiento es aditivo, durable y sincroniza los cambios de tarea dentro de la transacción', () => {
  const migration = readFileSync(new URL('../migrations/048_cliente_objetivos_mensuales.sql', import.meta.url), 'utf8');
  assert.match(migration, /REFERENCES tareas\(id\) ON DELETE SET NULL/);
  assert.match(migration, /UNIQUE\(objetivo_id, tipo, numero\)/);
  assert.match(migration, /AFTER UPDATE OF estado, titulo, asignado_a, propiedades_extra ON tareas/);
  assert.match(migration, /ELSE NULL END/);
  assert.match(migration, /INSERT INTO cliente_objetivo_eventos/);
  assert.doesNotMatch(migration, /DELETE FROM tareas|UPDATE clientes|abono_mensual/);
});
test('el editor compartido sólo acepta contenido, nunca responsables o estados', async () => {
  const db = { connect() { throw new Error('No debe abrir una conexión'); } };
  const body = {titulo:'Reel',copy:'Copy',expected_updated_at:'2026-10-03T12:00:00Z'};
  for (const extra of [{estado:'publicada'},{asignado_a:'Otro'},{propiedades_extra:{workspace:'privado'}}]) {
    await assert.rejects(editGoalContent(db, 1, {...body,...extra}), /Revisá/);
  }
  await assert.rejects(editGoalContent(db,1,{...body,copy:42}), /Revisá/);
  await assert.rejects(editGoalContent(db,-1,body), /inválida/);
});
test('las asignaciones se heredan de campos explícitos sin inventar editores', async () => {
  const responses = [[],[{cliente_id:1,tipo:'carrusel',responsable_diseño:'Mariano'}],[{cliente_id:1,disenador_responsable:'Mariano'}],[],
    [{id:1,nombre:'Mariano',usuario:'mariano'},{id:2,nombre:'Editor no asignado',usuario:'editor'}]];
  const db = {query:async () => ({rows:responses.shift()})};
  const result = await inheritedGoalResponsibles(db,{clave:'cliente-1',cuentas:[{id:1}]},'2026-10');
  assert.deepEqual(result.video,[]); assert.deepEqual(result.carrusel,[{id:1,nombre:'Mariano'}]);
});
test('la automatización no modifica períodos anteriores al inicio', async () => {
  const db = {query() { throw new Error('No consultar historial'); }};
  assert.equal((await reconcileMonthlyGoals(db,'2026-09')).creadas,0);
});
test('hereda la última asignación del cliente cuando el mes nuevo aún no tiene tareas', async () => {
  const responses = [[],[],[],[
    {cliente_id:1,titulo:'Reel 1',tipo_tarea:'edicion',tarea_padre_id:8,asignado_a:'Luciano',periodo_asignacion:'2026-09',propiedades_extra:{}},
    {cliente_id:1,titulo:'Reel 2',tipo_tarea:'edicion',asignado_a:'Editor anterior',periodo_asignacion:'2026-08',propiedades_extra:{}},
  ],[{id:1,nombre:'Luciano',usuario:'luciano'},{id:2,nombre:'Editor anterior',usuario:'anterior'}]];
  const result = await inheritedGoalResponsibles({query:async () => ({rows:responses.shift()})},{clave:'cliente-1',cuentas:[{id:1}]},'2026-10');
  assert.deepEqual(result.video,[{id:1,nombre:'Luciano'}]);
});
