import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskReviewRead, parseTaskStateRead, buildTaskReviewClause, effectiveTaskStateSql,
  taskLiveVisibilitySql, taskReviewStateSql, taskReviewMembershipSql, readTaskReviewPage } from '../src/task-review-query.js';
import { PERSONAL_HOME_SQL } from '../src/personal-home.js';

const auth = {id:17,session_version:3,rol:'edicion'};
const normalized = sql => sql.replace(/\s+/g,' ');
const deferred = () => { let resolve; const promise = new Promise(done=> {resolve=done;}); return {promise,resolve}; };

test('review parser is opt-in, scalar, RenderOS-only and binds its independent snapshot', () => {
  assert.equal(parseTaskReviewRead(),null);
  assert.equal(parseTaskReviewRead({workspace:'legacy',estado:'pendiente'}),null);
  for (const scope of ['personal','team']) {
    assert.deepEqual(parseTaskReviewRead({workspace:'render_os',review_scope:scope}),{scope,snapshot:undefined});
    assert.deepEqual(parseTaskReviewRead({workspace:'render_os',review_scope:scope,expected_review_snapshot:'a'.repeat(64)}),{scope,snapshot:'a'.repeat(64)});
  }
  for (const query of [null,[],{expected_review_snapshot:'a'.repeat(64)},
    ...['',null,{},[],['personal','team'],'Personal','personal\n','team '].map(review_scope=>({workspace:'render_os',review_scope})),
    ...[undefined,'legacy',['render_os'],null].map(workspace=>({workspace,review_scope:'personal'})),
    ...[null,{},[],['a'.repeat(64)],'A'.repeat(64),'a'.repeat(63),'a'.repeat(64)+'\n'].map(expected_review_snapshot=>({workspace:'render_os',review_scope:'personal',expected_review_snapshot}))]) {
    assert.throws(()=>parseTaskReviewRead(query),{status:400});
  }
});
test('additional canonical filters remain intersections; archive, incompatible state and manual order reject', () => {
  const base = {workspace:'render_os',review_scope:'personal'};
  assert.deepEqual(parseTaskReviewRead({...base,estado:'en_revision',sort:'date',cliente_id:'8',asignado_a_id:'19',
    sector:'web',prioridad:'alta',q:'brief',area:'desarrollo',limit:'10',offset:'0',papelera:'false',incluir_archivadas:'false',solo_archivadas:'false'}),{scope:'personal',snapshot:undefined});
  for (const key of ['papelera','incluir_archivadas','solo_archivadas']) for (const value of ['true',true,['false'],{},'invalid'])
    assert.throws(()=>parseTaskReviewRead({...base,[key]:value}),{status:400});
  for (const query of [{estado:'aprobada'},{estado:['en_revision']},{estado:'publicada'},{sort:'manual'},{sort:[]},{sort:'date\n'},{expected_snapshot:'a'.repeat(64)}])
    assert.throws(()=>parseTaskReviewRead({...base,...query}),{status:400});
});
test('review-only intersections reject non-scalar SQL filters and malformed IDs before a query', () => {
  const base={workspace:'render_os',review_scope:'personal'};
  for (const key of ['asignado_a','asignado_a_id','cliente_id','tipo_tarea','prioridad','q','area','sector','historia_id','publicacion_id']) {
    for (const value of [[],['1'],{},null,true,1,undefined]) assert.throws(()=>parseTaskReviewRead({...base,[key]:value}),{status:400});
  }
  for (const key of ['asignado_a_id','cliente_id','historia_id','publicacion_id']) {
    for (const value of ['', '0','01','-1','1.0','1e0','1\n',' 1','2147483648','999999999999999999999'])
      assert.throws(()=>parseTaskReviewRead({...base,[key]:value}),{status:400});
    assert.equal(parseTaskReviewRead({...base,[key]:'2147483647'}).scope,'personal');
  }
  assert.equal(parseTaskReviewRead({...base,cliente_id:'none'}).scope,'personal');
  // Preserve the existing unscoped route's compatibility, not new global rules.
  assert.equal(parseTaskReviewRead({cliente_id:['legacy-invalid']}),null);
});
test('general task state parser is closed, scalar and preserves both persisted finalized aliases', () => {
  assert.equal(parseTaskStateRead(undefined),null);
  for (const state of ['pendiente','en_progreso','en_revision','aprobada']) assert.deepEqual(parseTaskStateRead(state),[state]);
  for (const state of ['finalizada','publicada']) assert.deepEqual(parseTaskStateRead(state),['finalizada','publicada']);
  for (const state of ['',null,{},[],['en_revision','aprobada'],'en_revision\n','programada','APROBADA',true,1])
    assert.throws(()=>parseTaskStateRead(state),{status:400});
});
test('effective state only projects legacy boolean approval; it never rewrites persisted final/publication states', () => {
  assert.equal(effectiveTaskStateSql('t'),"CASE WHEN t.estado='en_revision' AND t.propiedades_extra->'revision_aprobada'='true'::jsonb THEN 'aprobada' ELSE t.estado END");
  assert.doesNotMatch(effectiveTaskStateSql('t'),/->>|finalizada|publicada|COALESCE/);
  assert.equal(taskReviewStateSql(),`(${effectiveTaskStateSql('t')})='en_revision'`);
  assert.equal(taskReviewStateSql({taskAlias:null,projected:true}),"estado='en_revision'");
});
test('all SQL fragments validate internal aliases and positional parameter syntax', () => {
  for (const value of ['',null,1,'t;DELETE','t.id','t\n',' t']) {
    assert.throws(()=>effectiveTaskStateSql(value),TypeError);
    assert.throws(()=>taskLiveVisibilitySql('t',value),TypeError);
    assert.throws(()=>taskReviewMembershipSql(value,'$1'),TypeError);
  }
  for (const value of ['$0','$01','$1\n','?','1','$1 OR TRUE',null]) assert.throws(()=>taskReviewMembershipSql('t',value),TypeError);
});
test('personal clause uses stable membership for owner or collaborator, not names or raw shared-board ACL', () => {
  const result = buildTaskReviewClause({scope:'personal',auth:{...auth,nombre:'Other name'},placeholder:'$4'});
  assert.equal(result.value,17);
  assert.ok(result.sql.startsWith(' AND ')); assert.ok(result.sql.includes(taskLiveVisibilitySql()));
  assert.ok(result.sql.includes(taskReviewStateSql())); assert.ok(result.sql.includes(taskReviewMembershipSql('t','$4')));
  assert.doesNotMatch(result.sql,/asignado_a|colaboradores|a\.tipo\s*=|FOR UPDATE|FOR SHARE/);
  for (const invalid of [undefined,{}, {...auth,id:'17'}, {...auth,id:0}, {...auth,id:2147483648}, {...auth,activo:false}])
    assert.throws(()=>buildTaskReviewClause({scope:'personal',auth:invalid}),{status:401});
});
test('team clause is current admin only with valid ID, while admin may still request personal scope', () => {
  assert.throws(()=>buildTaskReviewClause({scope:'team',auth}),{status:403});
  assert.throws(()=>buildTaskReviewClause({scope:'team',auth:{rol:'admin'}}),{status:401});
  const admin = {...auth,rol:'admin'}, result = buildTaskReviewClause({scope:'team',auth:admin});
  assert.equal(result.value,null); assert.doesNotMatch(result.sql,/tarea_asignaciones/);
  assert.equal(buildTaskReviewClause({scope:'personal',auth:admin}).value,17);
});
test('Home and canonical review GET use the same live/effective/membership definitions without changing bounded DTOs', () => {
  const sql = normalized(PERSONAL_HOME_SQL);
  assert.ok(sql.includes(normalized(taskLiveVisibilitySql())));
  assert.ok(sql.includes(effectiveTaskStateSql()));
  assert.ok(sql.includes(`mine AS MATERIALIZED (SELECT v.* FROM visible v WHERE ${taskReviewMembershipSql('v','$1')})`));
  assert.ok(sql.includes(`reviews AS MATERIALIZED (SELECT * FROM visible v WHERE ${taskReviewStateSql({taskAlias:null,projected:true})}`));
  assert.ok(sql.includes(`($2::boolean OR ${taskReviewMembershipSql('v','$1')})`));
  assert.match(sql,/'total',\(SELECT count\(\*\)::int FROM reviews\)/);
  assert.match(sql,/FROM reviews r ORDER BY rank LIMIT 8/);
  assert.match(sql,/ORDER BY fecha_vencimiento ASC NULLS LAST,id/);
  assert.doesNotMatch(sql,/abono|importe|password|session_version|FOR UPDATE|FOR SHARE/);
});

function fixture({actor,signature='[[4,1,"[[17,\"responsable\"]]"],[9,2,"[[17,\"colaborador\"]]"]]',total=2,rows,
  failAt,rollbackFail=false}={}) {
  const calls=[],releases=[];
  const db = {release:error=>releases.push(error),query:async(sql,params)=>{
    calls.push({sql,params:structuredClone(params)});
    if (sql===failAt) throw new Error('synthetic query failure');
    if (sql==='ROLLBACK' && rollbackFail) throw new Error('synthetic rollback failure');
    if (sql.includes('FROM usuarios')) return {rows:actor===null?[]:[actor||{...auth,activo:true}]};
    if (sql.startsWith('SELECT COUNT(*)')) return {rows:[{total,signature}]};
    if (sql.startsWith('SELECT candidates.*')) return {rows:rows??[{id:4,revision:1,total_count:total},{id:9,revision:2,total_count:total}]};
    return {rows:[]};
  }};
  const clause=buildTaskReviewClause({scope:'personal',auth,placeholder:'$2'});
  const options={pool:{connect:async()=>db},query:`SELECT t.id,t.revision,t.fecha_vencimiento FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id WHERE t.cliente_id=$1${clause.sql}`,
    params:[8,clause.value],limit:2,offset:0,auth:{...auth},scope:'personal',serialize:async(client,items)=>{
      assert.equal(client,db); await client.query('SELECT annotation_fixture'); return items;
    }};
  return {db,calls,releases,options};
}
test('RR count, ordered page and assignment annotation share the same filtered query, params and client', async () => {
  const f=fixture(), result=await readTaskReviewPage(f.options);
  assert.equal(result.total,2); assert.match(result.snapshot,/^[a-f0-9]{64}$/); assert.deepEqual(result.items,[{id:4,revision:1},{id:9,revision:2}]);
  assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); assert.equal(f.calls.at(-1).sql,'COMMIT');
  const count=f.calls.find(row=>row.sql.startsWith('SELECT COUNT(*)')), page=f.calls.find(row=>row.sql.startsWith('SELECT candidates.*'));
  for (const call of [count,page]) assert.ok(call.sql.includes(`(${f.options.query})`));
  assert.deepEqual(count.params,[8,17]); assert.deepEqual(page.params,[8,17,2,0]);
  assert.match(count.sql,/a\.usuario_id,a\.tipo/); assert.match(count.sql,/ORDER BY id/);
  assert.match(page.sql,/ORDER BY candidates.fecha_vencimiento ASC NULLS LAST,candidates.id ASC LIMIT \$3 OFFSET \$4/);
  assert.ok(f.calls.some(row=>row.sql==='SELECT annotation_fixture'));
  assert.ok(f.calls.every(row=>!(/FOR SHARE|FOR UPDATE|^(INSERT|UPDATE|DELETE)/.test(row.sql))));
  assert.deepEqual(f.releases,[undefined]);
});
test('an empty later page preserves the exact collection count and snapshot', async () => {
  const first=await readTaskReviewPage(fixture().options), f=fixture({rows:[]});
  const result=await readTaskReviewPage({...f.options,offset:20,expectedSnapshot:first.snapshot});
  assert.equal(result.total,2); assert.deepEqual(result.items,[]); assert.equal(result.snapshot,first.snapshot);
});
test('later pages require their independent valid snapshot before any pool/SQL access', async () => {
  const f=fixture(); let connections=0;
  f.options.pool.connect=async()=>{connections++;return f.db;};
  for (const expectedSnapshot of [undefined,null,[],{},'A'.repeat(64),'a'.repeat(64)+'\n'])
    await assert.rejects(readTaskReviewPage({...f.options,offset:2,expectedSnapshot}),{status:400});
  assert.equal(connections,0); assert.deepEqual(f.calls,[]);
});
test('collection revision/membership changes invalidate next page before page query or serialization', async () => {
  const first=await readTaskReviewPage(fixture().options);
  for (const signature of ['[]','[[4,9]]','[[4,1,"[[19,\"responsable\"]]"]]']) {
    const f=fixture({signature});
    await assert.rejects(readTaskReviewPage({...f.options,offset:2,expectedSnapshot:first.snapshot}),error=>error.status===409 && /primera página/.test(error.message));
    assert.equal(f.calls.at(-1).sql,'ROLLBACK'); assert.ok(!f.calls.some(call=>call.sql.startsWith('SELECT candidates.*')||call.sql==='SELECT annotation_fixture'));
  }
});
test('snapshot binds the exact query, params, scope and actor context, including initial supplied observation', async () => {
  const first=await readTaskReviewPage(fixture().options);
  for (const alter of [f=>{f.options.params[0]=9;},f=>{f.options.query+=' AND t.prioridad=$3';f.options.params.push('alta');},
    f=>{f.options.scope='team';f.options.auth.rol='admin';},f=>{f.options.auth.id=19;},f=>{f.options.auth.session_version=4;}]) {
    const f=fixture(); alter(f);
    // Match the current identity inside the simulated RR observation.
    const query=f.db.query; f.db.query=async(sql,params)=>sql.includes('FROM usuarios')?{rows:[{...f.options.auth,activo:true}]}:query(sql,params);
    await assert.rejects(readTaskReviewPage({...f.options,expectedSnapshot:first.snapshot}),{status:409});
  }
  const f=fixture(); assert.equal((await readTaskReviewPage({...f.options,expectedSnapshot:first.snapshot})).snapshot,first.snapshot);
});
test('missing/inactive/revoked/role-changed actor is rejected before collection reads; team role is rechecked', async () => {
  for (const actor of [null,{...auth,activo:false},{...auth,activo:'true'},{...auth,activo:true,id:19},
    {...auth,activo:true,session_version:4},{...auth,activo:true,rol:'admin'}]) {
    const f=fixture({actor}); await assert.rejects(readTaskReviewPage(f.options),{status:401});
    assert.ok(!f.calls.some(call=>call.sql.startsWith('SELECT COUNT(*)'))); assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
  const f=fixture(); await assert.rejects(readTaskReviewPage({...f.options,scope:'team'}),{status:403});
  const admin=fixture({actor:{...auth,rol:'admin',activo:true}});
  assert.equal((await readTaskReviewPage({...admin.options,auth:{...auth,rol:'admin'},scope:'team'})).total,2);
});
test('identity and bound filter values are captured before the pool wait', async () => {
  const f=fixture(), gate=deferred(); f.options.pool.connect=()=>gate.promise;
  const pending=readTaskReviewPage(f.options);
  f.options.auth.id=19; f.options.auth.session_version=99; f.options.params[0]=99;
  gate.resolve(f.db); assert.equal((await pending).total,2);
  assert.deepEqual(f.calls.find(row=>row.sql.includes('FROM usuarios')).params,[17]);
  assert.deepEqual(f.calls.find(row=>row.sql.startsWith('SELECT COUNT(*)')).params,[8,17]);
});
test('serialization/invalid count/page/commit failure rolls back and rollback failure discards the pooled client', async () => {
  for (const total of [-1,'2',null,NaN]) {
    const f=fixture({total}); await assert.rejects(readTaskReviewPage(f.options),/summary/); assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
  for (const serialize of [async()=>{throw Error('synthetic annotation failure');},async()=>null,async()=>[]]) {
    const f=fixture(); await assert.rejects(readTaskReviewPage({...f.options,serialize})); assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
  const commit=fixture({failAt:'COMMIT'}); await assert.rejects(readTaskReviewPage(commit.options)); assert.equal(commit.calls.at(-1).sql,'ROLLBACK');
  const broken=fixture({actor:null,rollbackFail:true}); await assert.rejects(readTaskReviewPage(broken.options),{status:401});
  assert.equal(broken.releases[0]?.message,'synthetic rollback failure');
});
