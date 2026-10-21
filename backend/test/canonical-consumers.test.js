import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareGoal, goalLinkOptions, readGoals } from '../src/client-goals.js';
import { getStateNotification } from '../src/task-workflow.js';
import { buildMiaFastContext } from '../src/wilson-integration.js';
import { supervisorTaskActive, proposeSupervisorDeadline } from '../src/mia-supervisor-policy.js';

test('task completion notifications recognize both finals, not approval or publication transitions twice', () => {
  assert.equal(getStateNotification({estado:'finalizada'},'aprobada').motivo,'finalizada');
  assert.equal(getStateNotification({estado:'publicada'},'en_revision').motivo,'publicada');
  assert.equal(getStateNotification({estado:'finalizada'},'publicada'),null);
  assert.equal(getStateNotification({estado:'publicada'},'finalizada'),null);
  assert.equal(getStateNotification({estado:'aprobada'},'en_revision'),null);
});

test('Wilson counts both task finals once and keeps approval distinct from completion', () => {
  const tasks=['pendiente','en_revision','aprobada','finalizada','publicada'].map((estado,i)=>({
    id:i+1,titulo:'Editar reel',tipo_tarea:'edicion',estado,updated_at:'2026-10-19',propiedades_extra:{},
  }));
  const result=buildMiaFastContext(tasks,{name:'Editor',role:'edicion'},{today:'2026-10-19'});
  assert.equal(result.resumen.finalizadas_mes,2);
  assert.equal(result.resumen.ediciones_pendientes,1);
  assert.equal(result.hacer_ahora.some(task=>[4,5].includes(task.id)),false);
  assert.equal(result.resumen.en_revision,1);
});

test('supervisor treats both final states as completed dependencies, approval stays active', () => {
  const base={id:1,titulo:'Reel',tipo_tarea:'edicion',prioridad:'media',asignado_a_id:11,colaborador_ids:[],propiedades_extra:{workspace:'render_os'}};
  assert.equal(supervisorTaskActive({...base,estado:'aprobada'}),true);
  for(const estado of ['finalizada','publicada']) assert.equal(supervisorTaskActive({...base,estado}),false);
  const now=new Date('2026-10-19T13:00:00Z');
  const child={...base,id:2,estado:'pendiente',tarea_padre_id:1};
  const users=[{id:11,nombre:'Editor',rol:'edicion'}];
  const baseline=proposeSupervisorDeadline(child,[child],users,now);
  for(const estado of ['finalizada','publicada']) {
    assert.equal(proposeSupervisorDeadline(child,[child,{...base,estado,fecha_vencimiento:'2026-10-29'}],users,now).fecha,baseline.fecha);
  }
  assert.ok(proposeSupervisorDeadline(child,[child,{...base,estado:'aprobada',fecha_vencimiento:'2026-10-29'}],users,now).fecha>baseline.fecha);
});

function goalDatabase(reusedState) {
  const calls=[]; let linked=false;
  const objective={id:90,nombre:'Cliente',cuentas:[{id:1,nombre:'Cliente'}],reels:0,carruseles:1};
  const db={release(){},async query(sql,params=[]){
    calls.push({sql,params});
    if(sql.includes('FROM clientes c')) return {rows:[{id:1,nombre:'Cliente',cuota_carruseles:1}]};
    if(sql.includes('FROM cliente_objetivo_responsables')) return {rows:[]};
    if(sql.startsWith('SELECT id,nombre,usuario FROM usuarios')) return {rows:[{id:11,nombre:'Diseñador'}]};
    if(sql.startsWith('SELECT * FROM cliente_objetivos_mensuales')) return {rows:[objective]};
    if(sql.startsWith('SELECT tipo,numero')) return {rows:linked?[{tipo:'carrusel',numero:1}]:[]};
    if(sql.includes('SELECT t.*,p.tipo pieza_tipo')) return {rows:reusedState?[{id:100,titulo:'Carrusel',estado:reusedState,asignado_a:'Diseñador',propiedades_extra:{}}]:[]};
    if(sql.includes('FROM publicaciones p WHERE')) return {rows:[{id:8,cliente_id:1,tipo:'carrusel',estado:'publicada'}]};
    if(sql.startsWith('INSERT INTO tareas(')) return {rows:[{id:100,titulo:params[0],estado:params[1],asignado_a:params[2],publicacion_id:params[4],propiedades_extra:JSON.parse(params[7])}]};
    if(sql.startsWith('INSERT INTO cliente_objetivo_piezas')) {linked=true;return {rows:[]};}
    if(/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory|DELETE FROM tarea_asignaciones|INSERT INTO tarea_asignaciones)/.test(sql)) return {rows:[]};
    throw new Error(`Unexpected unit query: ${sql}`);
  }};
  return {calls,pool:{connect:async()=>db}};
}

test('published editorial piece generates a pending task and retry consumes no extra quota',async()=>{
  const {calls,pool}=goalDatabase();
  const input={period:'2026-10',key:'cliente-1',responsibleIds:[11]};
  assert.equal((await prepareGoal(pool,input)).creadas,1);
  assert.equal((await prepareGoal(pool,input)).creadas,0);
  const taskWrites=calls.filter(call=>call.sql.startsWith('INSERT INTO tareas('));
  assert.equal(taskWrites.length,1);
  assert.equal(taskWrites[0].params[1],'pendiente');
  const slots=calls.filter(call=>call.sql.startsWith('INSERT INTO cliente_objetivo_piezas'));
  assert.equal(slots.length,1);
  assert.equal(slots[0].params[8],'pendiente');
  assert.equal(calls.some(call=>/UPDATE publicaciones|UPDATE historias/.test(call.sql)),false);
});

test('goal reuse preserves legacy/final/approved task state without writing task or assignments',async()=>{
  for(const estado of ['publicada','finalizada','aprobada']) {
    const {calls,pool}=goalDatabase(estado);
    assert.equal((await prepareGoal(pool,{period:'2026-10',key:'cliente-1',responsibleIds:[11]})).vinculadas,1);
    assert.equal(calls.some(call=>/^(INSERT INTO tareas\(|UPDATE tareas|DELETE FROM tarea_asignaciones|INSERT INTO tarea_asignaciones)/.test(call.sql)),false);
    const slot=calls.find(call=>call.sql.startsWith('INSERT INTO cliente_objetivo_piezas'));
    assert.equal(slot.params[8],estado);
    assert.match(slot.sql,/CASE WHEN \$9 IN \('finalizada','publicada'\)/);
  }
});

test('completed editing child can link under either final alias but not approval alone',async()=>{
  for(const estado of ['publicada','finalizada','aprobada']) {
    const db={async query(sql){
      if(sql.includes('WHERE t.id=$1')) return {rows:[{id:100,titulo:'Reel',tipo_tarea:'edicion',tarea_padre_id:99,estado,cliente_id:1,propiedades_extra:{workspace:'render_os'}}]};
      return {rows:[]};
    }};
    if(estado==='aprobada') await assert.rejects(goalLinkOptions(db,100,'2026-10'),/completada/);
    else assert.equal((await goalLinkOptions(db,100,'2026-10')).tarea.estado,estado);
  }
});

test('SQL completion reads cover both task finals while editorial predicates remain published only',()=>{
  const goals=readFileSync(new URL('../src/client-goals.js',import.meta.url),'utf8');
  assert.match(goals,/count\(\*\) FILTER\(WHERE estado IN \('finalizada','publicada'\)\)/);
  assert.match(goals,/ORDER BY p.id FOR UPDATE OF p/);
  assert.match(goals,/publications.rows.sort\(\(a, b\) => Number\(b.estado === 'publicada'\) - Number\(a.estado === 'publicada'\) \|\| a.id - b.id\)/);
  const wilson=readFileSync(new URL('../src/wilson-integration.js',import.meta.url),'utf8');
  assert.match(wilson,/t.estado NOT IN \('finalizada','publicada'\)/);
  const supervisor=readFileSync(new URL('../src/mia-supervisor.js',import.meta.url),'utf8');
  assert.match(supervisor,/allowCompleted && isTaskFinalized\(row\)/);
});

test('goals DTO exposes task concurrency tokens separately from goal piece version',async()=>{
  const taskVersion='2026-10-19T13:00:00Z',pieceVersion='2026-10-19T12:00:00Z';
  const db={async query(sql){
    if(sql.includes('FROM clientes c')) return {rows:[{id:1,nombre:'Cliente',cuota_carruseles:1}]};
    if(sql.includes('FROM cliente_objetivos_mensuales WHERE')) return {rows:[{id:90,clave:'cliente-1',cuentas:[{id:1}],reels:0,carruseles:1}]};
    if(sql.includes('FROM cliente_objetivo_piezas p JOIN')) {
      assert.match(sql,/LEFT JOIN tareas t ON t.id=p.tarea_id/);
      assert.match(sql,/t.revision tarea_revision,t.updated_at tarea_updated_at/);
      return {rows:[{id:8,objetivo_id:90,tipo:'carrusel',numero:1,tarea_id:100,estado:'aprobada',updated_at:pieceVersion,tarea_revision:7,tarea_updated_at:taskVersion}]};
    }
    return {rows:[]};
  }};
  const piece=(await readGoals(db,'2026-10')).clientes[0].piezas[0];
  assert.equal(piece.tarea_revision,7);
  assert.equal(piece.tarea_updated_at,taskVersion);
  assert.equal(piece.updated_at,pieceVersion);
});
