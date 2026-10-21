import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goalPeriod, goalClients, goalTaskType, candidateTasks, prepareGoal, editGoalContent, inheritedGoalResponsibles, reconcileMonthlyGoals, linkGoalTask } from '../src/client-goals.js';

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
  const body = {titulo:'Reel',copy:'Copy',expected_updated_at:'2026-10-03T12:00:00Z',expected_revision:1};
  for (const extra of [{estado:'publicada'},{asignado_a:'Otro'},{propiedades_extra:{workspace:'privado'}}]) {
    await assert.rejects(editGoalContent(db, 1, {...body,...extra}), /Revisá/);
  }
  await assert.rejects(editGoalContent(db,1,{...body,copy:42}), /Revisá/);
  for (const expected_revision of [undefined,null,0,-1,1.5,'1',{},Number.MAX_SAFE_INTEGER+1]) {
    await assert.rejects(editGoalContent(db,1,{...body,expected_revision}), /Revisá/);
  }
  for (const invalid of [null,[],42,'copy']) await assert.rejects(editGoalContent(db,1,invalid), /Revisá/);
  await assert.rejects(editGoalContent(db,-1,body), /inválida/);
});
test('las asignaciones se heredan de IDs persistidos sin resolver nombres', async () => {
  const responses = [[],[{cliente_id:1,titulo:'Carrusel',usuario_id:1,nombre:'Mariano renombrado',periodo_asignacion:'2026-10'}]];
  const db = {query:async () => ({rows:responses.shift()})};
  const result = await inheritedGoalResponsibles(db,{clave:'cliente-1',cuentas:[{id:1}]},'2026-10');
  assert.deepEqual(result.video,[]); assert.deepEqual(result.carrusel,[{id:1,nombre:'Mariano renombrado'}]);
});
test('la automatización no modifica períodos anteriores al inicio', async () => {
  const db = {query() { throw new Error('No consultar historial'); }};
  assert.equal((await reconcileMonthlyGoals(db,'2026-09')).creadas,0);
});
test('hereda la última asignación del cliente cuando el mes nuevo aún no tiene tareas', async () => {
  const responses = [[],[
    {cliente_id:1,titulo:'Reel 1',tipo_tarea:'edicion',tarea_padre_id:8,usuario_id:1,nombre:'Luciano',periodo_asignacion:'2026-09'},
    {cliente_id:1,titulo:'Reel 2',tipo_tarea:'edicion',usuario_id:2,nombre:'Editor anterior',periodo_asignacion:'2026-08'},
  ]];
  const result = await inheritedGoalResponsibles({query:async () => ({rows:responses.shift()})},{clave:'cliente-1',cuentas:[{id:1}]},'2026-10');
  assert.deepEqual(result.video,[{id:1,nombre:'Luciano'}]);
});

// In-memory query double only: no PostgreSQL connection or integration harness.
function preparationDouble({ reused = false, inactive = false, assignmentFailure = false, shared = false, archivedCandidate = false, used = false } = {}) {
  const calls = [];
  const clientRows = shared ? [
    {id:1,nombre:'Cuenta A',grupo_feed_id:8,grupo_feed_nombre:'Feed',cuota_feed_carruseles:1},
    {id:2,nombre:'Cuenta B',grupo_feed_id:8,grupo_feed_nombre:'Feed',cuota_feed_carruseles:1},
  ] : [{id:1,nombre:'Cliente',cuota_carruseles:1}];
  const users = [{id:11,nombre:'Mismo nombre'}, {id:22,nombre:'Mismo nombre'}, {id:33,nombre:'Persona renombrada'}];
  const objective = {id:90,nombre:'Objetivo',cuentas:clientRows.map(({id,nombre}) => ({id,nombre})),reels:0,carruseles:1};
  const db = {
    async query(sql, params = []) {
      calls.push({sql,params});
      if (sql.includes('FROM clientes c')) return {rows:clientRows};
      if (sql.includes('FROM cliente_objetivo_responsables')) return {rows:[]};
      if (sql.startsWith('SELECT id,nombre,usuario FROM usuarios')) {
        assert.match(sql, /activo IS TRUE/);
        assert.match(sql, /FOR SHARE/);
        return {rows:users.filter(user => params[0].includes(user.id) && !(inactive && user.id === 22))};
      }
      if (sql.includes('SELECT * FROM cliente_objetivos_mensuales')) return {rows:[objective]};
      if (sql.startsWith('SELECT tipo,numero')) return {rows:used ? [{tipo:'carrusel',numero:1}] : []};
      if (sql.includes('SELECT t.*,p.tipo pieza_tipo')) return {rows:reused ? [
        {id:100,titulo:'Carrusel existente',asignado_a:'Etiqueta histórica',estado:'pendiente',...(archivedCandidate?{publicacion_id:8}:{}),propiedades_extra:{colaboradores:['Histórico']}}
      ] : []};
      if (sql.includes('FROM publicaciones p WHERE')) return {rows:shared || archivedCandidate ? [{id:8,cliente_id:2,tipo:'carrusel',estado:'pendiente',preparation_candidate:true,metadata:archivedCandidate?{archivado_tablero:true}:{}}] : []};
      if (sql.startsWith('INSERT INTO tareas(')) return {rows:[{id:100,titulo:params[0],estado:params[1],asignado_a:params[2],publicacion_id:params[4],propiedades_extra:JSON.parse(params[7])}]};
      if (sql.startsWith('INSERT INTO tarea_asignaciones') && assignmentFailure) throw new Error('assignment failure');
      if (/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory|DELETE FROM tarea_asignaciones|INSERT INTO tarea_asignaciones|INSERT INTO cliente_objetivo_piezas|DELETE FROM cliente_objetivo_responsables|INSERT INTO cliente_objetivo_responsables)/.test(sql)) return {rows:[]};
      throw new Error(`Unexpected unit query: ${sql}`);
    },
    release() { calls.push({sql:'RELEASE'}); },
  };
  return {calls,pool:{connect:async () => db}};
}

test('preparation rechecks locked piece metadata and never replaces an already-used archived slot', async () => {
  const pending = preparationDouble({reused:true,archivedCandidate:true});
  const result = await prepareGoal(pending.pool,{period:'2026-10',key:'cliente-1',responsibleIds:[11]});
  assert.equal(result.vinculadas,0);assert.equal(result.creadas,1);
  const created=pending.calls.find(call=>call.sql.startsWith('INSERT INTO tareas('));
  assert.equal(created.params[4],null,'new quota work must not adopt the archived piece');
  const taskLock=pending.calls.findIndex(call=>call.sql.includes('ORDER BY t.id FOR UPDATE'));
  const pieceLock=pending.calls.findIndex(call=>call.sql.includes('ORDER BY p.id FOR UPDATE'));
  assert.ok(taskLock>=0&&pieceLock>taskLock);
  assert.deepEqual(pending.calls[pieceLock].params[2],[8]);
  const held=preparationDouble({reused:true,archivedCandidate:true,used:true});
  const unchanged=await prepareGoal(held.pool,{period:'2026-10',key:'cliente-1',responsibleIds:[11]});
  assert.equal(unchanged.creadas,0);assert.equal(unchanged.vinculadas,0);
  assert.equal(held.calls.some(call=>/^INSERT INTO (tareas\(|cliente_objetivo_piezas)/.test(call.sql)),false);
});

test('manual goal link rejects archived task-backed piece only after task and piece locks, without writes',async()=>{
  const calls=[],db={release(){},async query(sql,params){calls.push({sql,params});
    if(sql.includes('SELECT p.tarea_id,p.publicacion_id,o.clave'))return{rows:[{tarea_id:3,publicacion_id:null,clave:'cliente-1',periodo:'2026-10'}]};
    if(sql.startsWith('SELECT t.*,p.tipo pieza_tipo'))return{rows:[{id:2,tipo_tarea:'edicion',subtipo:'reel',estado:'pendiente',publicacion_id:8,pieza_metadata:{archivado_tablero:'true'},propiedades_extra:{workspace:'render_os'}}]};
    if(/^(BEGIN|ROLLBACK|SELECT pg_advisory|SELECT id FROM tareas|SELECT p.id FROM publicaciones|SELECT h.id FROM historias)/.test(sql))return{rows:[]};
    throw Error('Unexpected SQL '+sql);
  }};
  await assert.rejects(linkGoalTask({connect:async()=>db},1,{tarea_id:2,expected_tarea_updated_at:'2026-10-01T00:00:00Z',expected_pieza_updated_at:'2026-10-01T00:00:00Z'},'QA'),error=>error.status===409);
  assert.ok(calls.findIndex(call=>call.sql.startsWith('SELECT id FROM tareas'))<calls.findIndex(call=>call.sql.startsWith('SELECT p.id FROM publicaciones')));
  assert.ok(calls.findIndex(call=>call.sql.startsWith('SELECT p.id FROM publicaciones'))<calls.findIndex(call=>call.sql.startsWith('SELECT t.*,p.tipo pieza_tipo')));
  assert.equal(calls.some(call=>/^(INSERT|UPDATE|DELETE|COMMIT)/.test(call.sql)),false);
});

test('crear una tarea guarda IDs distintos aunque los nombres coincidan, antes del COMMIT', async () => {
  const {pool,calls} = preparationDouble();
  const result = await prepareGoal(pool,{period:'2026-10',key:'cliente-1',responsibleIds:[22,11,22],actor:'Etiqueta no autorizante'});
  assert.equal(result.creadas,1);
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO tarea_asignaciones'));
  assert.deepEqual(insert.params,[100,[11,22],['responsable','colaborador']]);
  const taskIndex = calls.findIndex(call => call.sql.startsWith('INSERT INTO tareas('));
  const assignmentIndex = calls.indexOf(insert);
  const pieceIndex = calls.findIndex(call => call.sql.startsWith('INSERT INTO cliente_objetivo_piezas'));
  assert.ok(taskIndex < assignmentIndex && assignmentIndex < pieceIndex && pieceIndex < calls.findIndex(call => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql,'RELEASE');
});

test('asignaciones por cuenta usan IDs seleccionados sin modificar tareas reutilizadas', async () => {
  const {pool,calls} = preparationDouble({shared:true});
  await prepareGoal(pool,{period:'2026-10',key:'grupo-8',responsibleIds:[11,22,33],responsibleByAccount:{1:[11],2:[22,33]}});
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO tarea_asignaciones')).params,
    [100,[22,33],['responsable','colaborador']]);
  const reused = preparationDouble({reused:true});
  assert.equal((await prepareGoal(reused.pool,{period:'2026-10',key:'cliente-1',responsibleIds:[33],persistResponsibles:true})).vinculadas,1);
  assert.equal(reused.calls.some(call => /(?:INSERT INTO|DELETE FROM) tarea_asignaciones|UPDATE tareas/.test(call.sql)),false);
});

test('responsables por formato determinan los IDs de las tareas nuevas', async () => {
  const {pool,calls} = preparationDouble();
  await prepareGoal(pool,{period:'2026-10',key:'cliente-1',responsibleIds:[11,22,33],responsibleByType:{video:[11],carrusel:[33,22]}});
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO tarea_asignaciones')).params,
    [100,[22,33],['responsable','colaborador']]);
});

test('usuarios inactivos o inexistentes abortan antes de crear tareas', async () => {
  for (const responsibleIds of [[11,22],[11,999]]) {
    const {pool,calls} = preparationDouble({inactive:true});
    await assert.rejects(prepareGoal(pool,{period:'2026-10',key:'cliente-1',responsibleIds}),/no está disponible/);
    assert.equal(calls.some(call => call.sql.startsWith('INSERT INTO tareas(')),false);
    assert.equal(calls.at(-2).sql,'ROLLBACK');
    assert.equal(calls.at(-1).sql,'RELEASE');
  }
});

test('si falla persistir IDs se revierte toda la preparación y no se confirma el objetivo', async () => {
  const {pool,calls} = preparationDouble({assignmentFailure:true});
  await assert.rejects(prepareGoal(pool,{period:'2026-10',key:'cliente-1',responsibleIds:[11]}),/assignment failure/);
  assert.equal(calls.some(call => call.sql === 'COMMIT'),false);
  assert.equal(calls.some(call => call.sql.startsWith('INSERT INTO cliente_objetivo_piezas')),false);
  assert.equal(calls.at(-2).sql,'ROLLBACK');
});

test('herencia consulta usuarios activos por IDs, nunca nombres de etiquetas antiguas', async () => {
  const sql = [];
  const responses = [[],[]];
  const result = await inheritedGoalResponsibles({query:async query => {sql.push(query);return {rows:responses.shift()};}},
    {clave:'cliente-1',cuentas:[{id:1}]},'2026-10');
  assert.deepEqual(result,{video:[],carrusel:[]});
  assert.match(sql[1],/JOIN tarea_asignaciones a ON a.tarea_id=t.id/);
  assert.match(sql[1],/u.id=a.usuario_id AND u.activo IS TRUE/);
  assert.doesNotMatch(sql.join('\n'),/lower\(|nombre\s*=|asignado_a/);
});

test('la herencia conserva IDs de homónimos y deduplica una persona en varias tareas', async () => {
  const row = {cliente_id:1,titulo:'Reel',tipo_tarea:'edicion',periodo_asignacion:'2026-10',nombre:'Nombre compartido',asignado_a:'Nombre antiguo'};
  const responses = [[],[{...row,usuario_id:11},{...row,usuario_id:22},{...row,usuario_id:11}]];
  const result = await inheritedGoalResponsibles({query:async () => ({rows:responses.shift()})},
    {clave:'cliente-1',cuentas:[{id:1}]},'2026-10');
  assert.deepEqual(result.video,[{id:11,nombre:'Nombre compartido'},{id:22,nombre:'Nombre compartido'}]);
});
