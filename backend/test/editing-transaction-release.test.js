import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditingDeliveriesRouter} from '../src/editing-deliveries.js';
import {createEditingReviewsRouter} from '../src/editing-reviews.js';
import {EDITING_PROGRESS_SCHEMA} from '../src/editing-progress-ledger.js';
const key='11111111-1111-4111-8111-111111111111';
for(const [name,create,path,body] of [
  ['delivery',createEditingDeliveriesRouter,'/:id/entregas',{request_id:key,expected_revision:1,url:'https://example.invalid/v1',notes:''}],
  ['review',createEditingReviewsRouter,'/:id/correcciones',{request_id:key,expected_revision:1,expected_entrega_id:key,notes:'Corregir cierre'}],
])for(const method of ['GET','POST'])for(const rollbackFails of [false,true])test(`${name} ${method}: ${rollbackFails?'failed rollback discards client':'successful rollback permits reuse'} and preserves primary failure`,async()=>{
  const routes=new Map(),calls=[],released=[];
  const primary=Object.assign(new Error('Primary domain failure'),method==='POST'?{status:409}:{}),rollback=new Error('Rollback connection failure');
  const db={async query(sql){calls.push(sql);if(sql.startsWith('BEGIN'))return{rows:[]};if(sql==='ROLLBACK'){if(rollbackFails)throw rollback;return{rows:[]};}throw primary;},release(reason){released.push(reason);}};
  const router={use(){},get(route,handler){routes.set(`GET ${route}`,handler);},post(route,handler){routes.set(`POST ${route}`,handler);}};
  create({express:{Router:()=>router},pool:{connect:async()=>db}});
  let forwarded,status,payload;const res={status(value){status=value;return this;},json(value){payload=value;}};
  // Reviews expose their GET at /revisiones, not the correction write path.
  const route=method==='GET'&&name==='review'?'/:id/revisiones':path;
  await routes.get(`${method} ${route}`)({params:{id:'8'},query:{},auth:{id:91001,rol:'admin',session_version:1,activo:true},body},res,error=>{forwarded=error;});
  assert.equal(calls.length,3);assert.match(calls[0],method==='POST'?/READ COMMITTED$/:/REPEATABLE READ READ ONLY$/);assert.equal(calls.at(-1),'ROLLBACK');
  assert.deepEqual(released,[rollbackFails?rollback:undefined]);
  if(method==='POST'){assert.equal(status,409);assert.deepEqual(payload,{error:primary.message});assert.equal(forwarded,undefined);}
  else{assert.equal(forwarded,primary);assert.equal(payload,undefined);}
});

for (const rollbackFails of [false, true]) test(`delivery failure AFTER ledger write: ${rollbackFails ? 'discard' : 'rollback'} retains primary failure`, async () => {
  const routes = new Map(), calls = [], released = [];
  const primary = new Error('DTO read after durable ledger INSERT failed'), rollback = new Error('Rollback failed');
  let state = {task: {id: 8, revision: 1, estado: 'en_progreso', tipo_tarea: 'edicion', workspace: 'render_os',
    archived: 'false', trashed: 'false', assigned: true, titulo: 'QA atomic progress', cliente_id: null,
    propiedades_extra: {workspace: 'render_os'}}, deliveries: [], progress: []}, before;
  const db = { release(reason) {released.push(reason);}, async query(sql, params = []) {
    calls.push(sql);
    if (sql.startsWith('BEGIN')) {before = structuredClone(state); return {rows: []};}
    if (sql === 'ROLLBACK') {if (rollbackFails) throw rollback; state = before; return {rows: []};}
    if (sql.startsWith('SELECT id,rol,activo,session_version')) return {rows: [{id: 91001, rol: 'admin', activo: true, session_version: 1}]};
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return {rows: []};
    if (sql.startsWith('SELECT id,publicacion_id FROM tareas')) return {rows: [{id: 8, publicacion_id: null}]};
    if (sql.startsWith('SELECT s.id,s.tarea_id') || sql.startsWith('SELECT v.id,v.tarea_origen_id')) return {rows: []};
    if (sql.startsWith('SELECT id FROM tareas WHERE id=ANY')) return {rows: [{id: 8}]};
    if (sql.startsWith('SELECT t.id,t.revision,t.estado') || sql.startsWith('SELECT id,revision,estado,tipo_tarea')) return {rows: [structuredClone(state.task)]};
    if (sql.startsWith('SELECT id,payload_hash')) return {rows: []};
    if (sql.startsWith('UPDATE tareas SET')) {
      assert.equal(state.task.revision, params[1]); state.task.revision++; state.task.estado = 'en_revision';
      state.task.propiedades_extra.revision_aprobada = false; return {rows: [structuredClone(state.task)]};
    }
    if (sql.startsWith('INSERT INTO task_editing_deliveries')) {
      const [id, task_id, actor_id, request_id, payload_hash, task_revision, url, notes] = params;
      state.deliveries.push({id, task_id, actor_id, request_id, payload_hash, task_revision, url, notes, recorded_at: '2026-10-27T12:00:00Z'}); return {rows: []};
    }
    if (sql.includes('AS columns') && sql.includes('FROM pg_constraint')) return {rows: [{
      columns: Object.entries(EDITING_PROGRESS_SCHEMA.columns).map(([name, [type, notNull]]) => ({name, type, notNull})),
      constraints: Object.entries(EDITING_PROGRESS_SCHEMA.constraints).map(([name, definition]) => ({name, definition, validated: true, deferred: false})),
    }]};
    if (sql.includes('FROM public.progreso_edicion_entregas LIMIT 0')) return {rows: []};
    if (sql.startsWith('SELECT id,task_id,task_revision,recorded_at')) return {rows: state.deliveries};
    if (sql.startsWith('SELECT tarea_id,editor_user_id')) return {rows: state.progress};
    if (sql.startsWith('SELECT a.usuario_id,a.tipo,u.activo')) return {rows: [{usuario_id: 91003, tipo: 'responsable', activo: true}]};
    if (sql.startsWith('INSERT INTO public.progreso_edicion_entregas')) {
      assert.equal(params[6], 91003, 'Credit is assigned owner, not admin actor');
      assert.equal(params[7], state.deliveries[0].id);
      state.progress.push({tarea_id: params[0], editor_user_id: params[6], origen_registro: 'canonical_delivery', delivery_id: params[7], task_revision: params[8]}); return {rows: []};
    }
    if (sql.startsWith('SELECT id,task_id,actor_id,task_revision')) {assert.equal(state.progress.length, 1); throw primary;}
    assert.fail(`Unrecognized SQL in transaction fixture: ${sql}`);
  }};
  const router = {use() {}, get(path, handler) {routes.set(`GET ${path}`, handler);}, post(path, handler) {routes.set(`POST ${path}`, handler);}};
  createEditingDeliveriesRouter({express: {Router: () => router}, pool: {connect: async () => db}, notifyAssignment() {assert.fail('No notification before commit');}});
  let forwarded;
  await routes.get('POST /:id/entregas')({params: {id: '8'}, query: {}, auth: {id: 91001, rol: 'admin', session_version: 1},
    body: {request_id: key, expected_revision: 1, url: 'https://example.invalid/v1', notes: ''}},
  {status() {assert.fail('No success response after failure');}, json() {assert.fail('No response after failure');}}, error => {forwarded = error;});
  assert.equal(forwarded, primary); assert.deepEqual(released, [rollbackFails ? rollback : undefined]);
  assert.equal(calls.at(-1), 'ROLLBACK'); assert.equal(calls.includes('COMMIT'), false);
  if (!rollbackFails) assert.deepEqual(state, before, 'Task, immutable artifact and ledger all roll back');
});
