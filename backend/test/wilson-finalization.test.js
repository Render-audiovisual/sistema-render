import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerWilsonFinalizationRoutes } from '../src/wilson-finalization.js';
import { requireWilsonService, resolveWilsonUser, buildWilsonSignatureMessage } from '../src/wilson-integration.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const external = 'finalization-synthetic-private-actor';
const scope = `private:${sha(external).slice(0,16)}`;
const visitId = '11111111-1111-4111-8111-111111111111';
const task = (id, overrides = {}) => ({id,revision:1,titulo:`Exact task ${id}`,cliente_id:1,cliente_nombre:'Client QA',
  fecha_vencimiento:'2026-11-01',estado:'aprobada',tipo_tarea:'edicion',subtipo:'video',
  propiedades_extra:{workspace:'render_os',private_note:'NOT FOR DTO'},...overrides});
const paths = {resolve:'/tareas/resolver-finalizacion',preview:'/lotes/finalizacion/previsualizar',confirm:'/lotes/finalizacion/confirmar'};

// Strict registered-callback fixtures. Real actor lock, transitions, assignments,
// readiness and SQL are exercised; this does not simulate PostgreSQL MVCC.
function fixture({tasks = [task(101),task(102)], role = 'admin', notifyAssignment} = {}) {
  const actor = {id:7,usuario:'qa_private',nombre:'Current actor',rol:role,activo:true,
    whatsapp_id_hash:sha(external),whatsapp_habilitado:true};
  const live = {tasks:structuredClone(tasks),assignments:tasks.map(t => ({tarea_id:t.id,usuario_id:7,tipo:'responsable'})),
    tokens:[],audits:[],visits:[],videos:[]};
  const calls = [], routes = new Map(), notifications = [], notificationStates = [];
  const leaders = [{id:7,nombre:'Current actor',rol:'admin',activo:true},
    {id:22,nombre:'Current actor',rol:'admin',activo:true},
    {id:33,nombre:'Inactive admin',rol:'admin',activo:false},
    {id:44,nombre:'Old leader label',rol:'edicion',activo:true}];
  let now = Date.now(), failure, rollbackFails = false, atConnect, onQuery, onCommit, released, leased = 0;
  const pool = {async query(sql) {
    if(sql === "SELECT id FROM usuarios WHERE activo IS TRUE AND rol='admin' ORDER BY id") {
      calls.push({sql,poolQuery:true});
      if(failure==='leader-query')throw Error('injected current leader query failure');
      return {rows:leaders.filter(row => row.activo===true && row.rol==='admin').sort((a,b) => a.id-b.id).map(row => ({id:row.id}))};
    }
    assert.match(sql,/SELECT u.id,u.usuario,u.nombre,u.rol,u.activo/);
    return {rows:[structuredClone(actor)]};
  },async connect() {
    leased++;
    if (atConnect) atConnect();
    if (failure === 'connect') throw Error('injected connect failure');
    let pending;
    return {release(value) {released=value;calls.push({sql:'RELEASE'});},async query(raw,params = []) {
      const sql = raw.replace(/\s+/g,' ').trim();
      calls.push({sql,params:structuredClone(params)});
      if (onQuery) await onQuery(sql,params);
      if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') {pending=structuredClone(live);return {rows:[]};}
      if (sql === 'ROLLBACK') {pending=null;if(rollbackFails)throw Error('injected rollback failure');return {rows:[]};}
      if (sql === 'COMMIT') {if(failure==='commit')throw Error('injected commit failure');Object.assign(live,pending);onCommit?.();return {rows:[]};}
      if (sql.startsWith('SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash')) return {rows:[structuredClone(actor)]};
      if (sql.startsWith('SELECT actor_hash,usuario_id,enabled')) return {rows:[]};
      if (sql.startsWith('SELECT u.id FROM usuarios u')) return {rows:[{id:actor.id}]};
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return {rows:[]};
      if (sql.includes('FROM tareas t LEFT JOIN clientes')) {
        if (sql.includes('WHERE t.id=ANY')) return {rows:structuredClone(pending.tasks.filter(t => params[0].includes(t.id)).sort((a,b) => a.id-b.id))};
        assert.match(sql,/a.tarea_id=t.id AND a.usuario_id=\$2/);
        return {rows:structuredClone(pending.tasks.filter(t => t.propiedades_extra.workspace === 'render_os'
          && !t.propiedades_extra.papelera_render_os && !t.propiedades_extra.archivada_render_os
          && ['pendiente','en_progreso','en_revision','aprobada'].includes(t.estado)
          && (params[0] || pending.assignments.some(a => a.tarea_id===t.id && a.usuario_id===params[1]))))};
      }
      if (sql.startsWith('SELECT tarea_id, usuario_id, tipo')) return {rows:structuredClone(pending.assignments.filter(a => params[0].includes(a.tarea_id)))};
      if (sql.startsWith('SELECT id,revision FROM produccion_visitas')) return {rows:structuredClone(pending.visits.filter(v => v.tarea_origen_id===params[0]))};
      if (sql.startsWith('SELECT estado FROM produccion_videos')) return {rows:structuredClone(pending.videos.filter(v => v.visita_id===params[0]))};
      if (sql.startsWith('UPDATE integracion_confirmaciones SET used_at=clock_timestamp() WHERE integracion=')) {
        for(const row of pending.tokens)if(row.actor_id===params[0] && row.grupo_id===params[1] && !row.used_at)row.used_at=new Date(now).toISOString();
        return {rows:[]};
      }
      if (sql.startsWith('INSERT INTO integracion_confirmaciones')) {
        if(failure==='token')throw Error('injected token failure');
        const row={token:params[0],actor_id:params[1],grupo_id:params[2],payload_hash:params[3],
          payload:JSON.parse(params[4]),expires_at:new Date(now+900000).toISOString(),used_at:null};
        pending.tokens.push(row);return {rows:[{expires_at:row.expires_at}]};
      }
      if (sql.startsWith('SELECT token,payload,payload_hash,used_at')) {
        const row=pending.tokens.find(t => t.token===params[0] && t.actor_id===params[1] && t.grupo_id===params[2]);
        return {rows:row?[structuredClone(row)]:[]};
      }
      if (sql.startsWith('UPDATE integracion_confirmaciones SET used_at=clock_timestamp() WHERE token=')) {
        const row=pending.tokens.find(t => t.token===params[0] && t.actor_id===params[1] && t.grupo_id===params[2]
          && t.payload_hash===params[3] && !t.used_at && Date.parse(t.expires_at)>now);
        if(!row)return {rows:[]};row.used_at=new Date(now).toISOString();return {rows:[{used_at:row.used_at}]};
      }
      if (sql.startsWith('UPDATE tareas SET estado=')) {
        if(failure==='second-task' && params[0]===102)throw Error('injected second task failure');
        if(failure==='cas')return {rows:[]};
        const row=pending.tasks.find(t => t.id===params[0] && t.revision===params[1]);if(!row)return {rows:[]};
        row.estado='finalizada';row.revision++;Object.assign(row.propiedades_extra,JSON.parse(params[2]));return {rows:[structuredClone(row)]};
      }
      if (sql.startsWith('INSERT INTO integracion_auditoria')) {
        if(failure==='audit')throw Error('injected audit failure');pending.audits.push(structuredClone(params));return {rows:[]};
      }
      if (sql.startsWith('UPDATE integracion_confirmaciones SET payload=jsonb_set')) {
        if(failure==='receipt')throw Error('injected receipt failure');
        const row=pending.tokens.find(t => t.token===params[0] && t.actor_id===params[1] && t.grupo_id===params[2]);
        row.payload.receipt=JSON.parse(params[3]);return {rows:[{token:row.token}]};
      }
      assert.fail(`Unexpected SQL: ${sql}`);
    }};
  }};
  const notify = notice => {
    calls.push({sql:'NOTIFY',taskId:notice.tarea.id});
    notifications.push(notice);notificationStates.push(structuredClone(live));
    return notifyAssignment?.(notice);
  };
  registerWilsonFinalizationRoutes({post(route,handler) {routes.set(route,handler);}}, {pool,
    notifyAssignment:notifyAssignment===null?undefined:notify});
  const subject = {channel:'whatsapp',actorId:external,groupId:scope,privateChat:true,userId:7,
    actorRole:'admin',actorName:'Stale transport label',isLeader:true,systemActor:false};
  function request(body) {return {method:'POST',headers:{'x-wilson-signature-version':'2'},wilson:{...subject},body};}
  async function run(operation,body,modify) {
    const req=request(body);modify?.(req);
    const res={statusCode:200,status(value) {this.statusCode=value;return this;},json(value) {this.body=value;return this;}};
    await routes.get(paths[operation])(req,res,error => {res.error=error;res.statusCode=error.status || 500;});
    return res;
  }
  return {actor,live,calls,routes,pool,subject,request,run,notifications,notificationStates,leaders,get leased() {return leased;},get released() {return released;},
    set failure(value) {failure=value;},set rollbackFails(value) {rollbackFails=value;},set atConnect(value) {atConnect=value;},
    set onQuery(value) {onQuery=value;},set onCommit(value) {onCommit=value;},advance(ms) {now+=ms;},async preview(ids = [101,102]) {const res=await run('preview',{task_ids:ids});assert.equal(res.statusCode,201,res.error?.message);return res.body;}};
}

test('registers only three exact endpoints; preview names selection, client, date, revision and no publication',async () => {
  const f=fixture(),before=structuredClone(f.live.tasks),preview=await f.preview(['102','101']);
  assert.deepEqual([...f.routes.keys()],Object.values(paths));
  assert.deepEqual(preview.task_ids,[101,102]);assert.match(preview.text,/1\. #101 Exact task 101 — Client QA — Fecha: 2026-11-01/);
  assert.match(preview.text,/2\. #102 Exact task 102/);assert.match(preview.text,/No aprobaré trabajos ni publicaré piezas ni confirmaré visitas/);
  assert.deepEqual(f.live.tasks,before);assert.deepEqual(f.live.audits,[]);
  assert.equal(preview.tasks[0].revision,1);assert.equal(JSON.stringify(preview).includes('NOT FOR DTO'),false);
});

test('confirm records atomic task CAS, audit and receipt; lost-response replay does not mutate anything',async () => {
  const f=fixture(),preview=await f.preview();
  const confirm=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.equal(confirm.statusCode,200,confirm.error?.message);assert.equal(confirm.body.updated,true);
  assert.ok(f.live.tasks.every(t => t.estado==='finalizada' && t.revision===2));assert.equal(f.live.audits.length,2);
  const after=structuredClone(f.live);f.advance(3600000);
  const replay=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.equal(replay.statusCode,200,replay.error?.message);assert.equal(replay.body.idempotent,true);assert.equal(replay.body.updated,false);
  assert.deepEqual(replay.body.receipt,confirm.body.receipt);assert.deepEqual(f.live,after);
  assert.ok(!f.calls.some(c => /\b(publicaciones|cliente_objetivo_piezas|produccion_registros)\b/.test(c.sql)));
});

test('new preview invalidates unconsumed old selection, not committed receipts',async () => {
  const f=fixture(),old=await f.preview([101]),replacement=await f.preview([102]);
  assert.equal((await f.run('confirm',{confirmacion_token:old.confirmacion_token})).statusCode,409);
  assert.equal((await f.run('confirm',{confirmacion_token:replacement.confirmacion_token})).statusCode,200);
  await f.preview([101]);
  const replay=await f.run('confirm',{confirmacion_token:replacement.confirmacion_token});assert.equal(replay.statusCode,200);assert.equal(replay.body.idempotent,true);
});

for(const mutate of [
  req => {req.wilson.privateChat=false;req.wilson.groupId='group';},
  req => {req.wilson.channel='telegram';},req => {req.wilson.systemActor=true;},
  req => {req.wilson.userId=null;},req => {req.wilson.groupParticipantOnly=true;},
  req => {req.wilson.groupId='private:forged';},req => {req.headers['x-wilson-signature-version']='1';},
])test(`private signed human boundary rejects before leasing ${mutate.toString()}`,async () => {
  const f=fixture(),res=await f.run('preview',{task_ids:[101]},mutate);assert.ok([401,403].includes(res.statusCode));assert.equal(f.leased,0);assert.deepEqual(f.live.tokens,[]);
});

for(const ids of [[],[101,101],[0],[true],[null],['1e2'],[' 101'],[2147483648],Array.from({length:21},(_,i) => i+1)])
  test(`invalid or oversized selections fail closed: ${JSON.stringify(ids)}`,async () => {
    const f=fixture();assert.equal((await f.run('preview',{task_ids:ids})).statusCode,400);assert.equal(f.leased,0);
  });

test('closed body rejects state/approval/visit injection and confirm task substitution',async () => {
  const f=fixture();for(const body of [{task_ids:[101],estado:'finalizada'},{task_ids:[101],expected_production_visit:{id:visitId,revision:1}},
    {task_ids:[101],revision_aprobada:true}])assert.equal((await f.run('preview',body)).statusCode,400);
  const preview=await f.preview();assert.equal((await f.run('confirm',{confirmacion_token:preview.confirmacion_token,task_ids:[999]})).statusCode,400);
});

for(const state of ['pendiente','en_progreso','en_revision','finalizada','publicada'])test(`no approval bypass or timestamp rewrite for ${state}`,async () => {
  const f=fixture({tasks:[task(101,{estado:state,propiedades_extra:{workspace:'render_os',revision_aprobada:true}})]});
  const before=structuredClone(f.live);assert.equal((await f.run('preview',{task_ids:[101]})).statusCode,409);assert.deepEqual(f.live,before);
});

for(const role of ['edicion','diseno','desarrollo','administracion'])test(`cached leader label never grants finalization to ${role}`,async () => {
  const f=fixture({role});assert.equal((await f.run('preview',{task_ids:[101]})).statusCode,403);assert.deepEqual(f.live.tokens,[]);
});

for(const revoke of ['role','inactive','whatsapp','mapping','membership','revision','trash','workspace'])test(`preview does not retain authority after ${revoke} changes`,async () => {
  const f=fixture({role:'community'}),preview=await f.preview();
  if(revoke==='role')f.actor.rol='edicion';if(revoke==='inactive')f.actor.activo=false;
  if(revoke==='whatsapp')f.actor.whatsapp_habilitado=false;if(revoke==='mapping')f.actor.whatsapp_id_hash=sha('other');
  if(revoke==='membership')f.live.assignments=[];if(revoke==='revision')f.live.tasks[1].revision++;
  if(revoke==='trash')f.live.tasks[0].propiedades_extra.papelera_render_os=true;
  if(revoke==='workspace')f.live.tasks[0].propiedades_extra.workspace='other';
  const before=structuredClone(f.live),res=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.ok([403,404,409].includes(res.statusCode));assert.deepEqual(f.live,before);assert.equal(f.live.tokens[0].used_at,null);
});

for(const revoke of ['role','inactive','mapping','workspace','membership'])test(`receipt recovery rechecks ${revoke} after a committed finalization`,async () => {
  const f=fixture({role:'community'}),preview=await f.preview();assert.equal((await f.run('confirm',{confirmacion_token:preview.confirmacion_token})).statusCode,200);
  if(revoke==='role')f.actor.rol='edicion';if(revoke==='inactive')f.actor.activo=false;
  if(revoke==='mapping')f.actor.whatsapp_id_hash=sha('other');if(revoke==='workspace')f.live.tasks[0].propiedades_extra.workspace='other';
  if(revoke==='membership')f.live.assignments=[];const before=structuredClone(f.live);
  assert.ok([403,404].includes((await f.run('confirm',{confirmacion_token:preview.confirmacion_token})).statusCode));assert.deepEqual(f.live,before);
});

for(const wait of ['scope','token','tasks','visit'])test(`TTL evaluated after ${wait} wait, not at BEGIN`,async () => {
  const production=wait==='visit';
  const f=fixture({tasks:[task(101,production?{titulo:'Visita QA',tipo_tarea:'produccion',estado:'en_progreso',
    propiedades_extra:{workspace:'render_os',produccion_videos_previstos:1}}:{})]});
  if(production){f.live.visits=[{id:visitId,revision:1,tarea_origen_id:101}];f.live.videos=[{visita_id:visitId,estado:'grabado'}];}
  const preview=await f.preview([101]),before=structuredClone(f.live);let advanced=false;
  f.onQuery=sql => {
    const matches=wait==='scope'?sql.includes('pg_advisory_xact_lock'):wait==='token'?sql.startsWith('SELECT token,payload'):
      wait==='tasks'?sql.includes('FOR UPDATE OF t'):sql.includes('FROM produccion_visitas');
    if(matches && !advanced){f.advance(900001);advanced=true;}
  };
  const result=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});assert.equal(result.statusCode,409,result.error?.message);
  assert.equal(advanced,true);assert.deepEqual(f.live,before);
  const lock=f.calls.findLastIndex(c => c.sql.includes('FOR UPDATE OF t'));
  const claim=f.calls.findLastIndex(c => c.sql.startsWith('UPDATE integracion_confirmaciones SET used_at=clock_timestamp() WHERE token='));
  assert.ok(claim>lock);assert.match(f.calls[claim].sql,/expires_at>clock_timestamp\(\)/);
});

for(const failure of ['token','second-task','audit','receipt','cas','commit'])test(`fault ${failure} rolls back token, tasks and audits together`,async () => {
  const f=fixture();let token;
  if(failure!=='token')token=(await f.preview()).confirmacion_token;
  const before=structuredClone(f.live);f.failure=failure;
  const result=await f.run(failure==='token'?'preview':'confirm',failure==='token'?{task_ids:[101,102]}:{confirmacion_token:token});
  assert.ok(result.statusCode>=400);assert.deepEqual(f.live,before);
  assert.deepEqual(f.calls.slice(-2).map(c => c.sql),['ROLLBACK','RELEASE']);
});

test('failed replacement insert restores prior outstanding preview; failed rollback discards lease',async () => {
  const f=fixture();await f.preview([101]);const before=structuredClone(f.live);f.failure='token';f.rollbackFails=true;
  assert.equal((await f.run('preview',{task_ids:[102]})).statusCode,500);assert.deepEqual(f.live,before);assert.match(f.released.message,/rollback failure/);
});

test('queued request mutation cannot replace original subject, IDs or confirmation token',async () => {
  const f=fixture();let request;
  f.atConnect=() => {request.body.task_ids.splice(0,1,999);request.wilson.actorId='other';request.wilson.userId=99;};
  const preview=await f.run('preview',{task_ids:[101]},req => {request=req;});assert.equal(preview.statusCode,201,preview.error?.message);assert.deepEqual(preview.body.task_ids,[101]);
  f.atConnect=() => {request.body.confirmacion_token=randomUUID();request.wilson.groupId='group';};
  const confirm=await f.run('confirm',{confirmacion_token:preview.body.confirmacion_token},req => {request=req;});assert.equal(confirm.statusCode,200,confirm.error?.message);
});

test('production preview snapshots visit revision and includes exact video evidence; changes reject without consuming',async () => {
  const f=fixture({role:'produccion',tasks:[task(101,{titulo:'Visita QA',tipo_tarea:'produccion',estado:'en_progreso',
    propiedades_extra:{workspace:'render_os',produccion_videos_previstos:2}})]});
  f.live.visits=[{id:visitId,revision:3,tarea_origen_id:101}];f.live.videos=[{visita_id:visitId,estado:'grabado'},{visita_id:visitId,estado:'grabado'}];
  const preview=await f.preview([101]);assert.deepEqual(preview.tasks[0].expected_production_visit,{id:visitId,revision:3});
  assert.match(preview.text,/Visita QA/);assert.match(preview.text,/revisión 3: 2\/2 videos grabados; previstos 2/);
  f.live.visits[0].revision++;const before=structuredClone(f.live);assert.equal((await f.run('confirm',{confirmacion_token:preview.confirmacion_token})).statusCode,409);assert.deepEqual(f.live,before);
});

test('incomplete canonical production fails preview, even if legacy aggregate claims completion',async () => {
  const f=fixture({tasks:[task(101,{titulo:'Visita QA',tipo_tarea:'produccion',estado:'en_progreso',propiedades_extra:{workspace:'render_os',
    produccion_videos_previstos:1,produccion_registros:[{cantidad:99}],produccion_finalizada_at:'2026-10-26'}})]});
  f.live.visits=[{id:visitId,revision:1,tarea_origen_id:101}];f.live.videos=[{visita_id:visitId,estado:'repetir'}];
  assert.equal((await f.run('preview',{task_ids:[101]})).statusCode,400);assert.deepEqual(f.live.tokens,[]);
});

test('resolve reports ambiguity only in current ID scope with a closed DTO and no writes',async () => {
  const f=fixture({role:'community',tasks:[task(101),task(102),task(103,{titulo:'Foreign secret task'})]});
  f.live.assignments=f.live.assignments.filter(a => a.tarea_id!==103);
  const res=await f.run('resolve',{referencias:['Exact task','Foreign secret task','#101']});assert.equal(res.statusCode,200,res.error?.message);
  assert.deepEqual(res.body.results.map(r => r.status),['ambiguous','not_found','resolved']);assert.equal(res.body.results[1].matches.length,0);
  assert.ok(!JSON.stringify(res.body).includes('NOT FOR DTO'));assert.ok(!f.calls.some(c => /^(UPDATE|INSERT|DELETE)\b/.test(c.sql)));
});

test('unknown/foreign/tampered or legacy incompatible tokens fail without mutation',async () => {
  const f=fixture(),preview=await f.preview();const token=f.live.tokens[0];
  assert.equal((await f.run('confirm',{confirmacion_token:randomUUID()})).statusCode,409);
  token.actor_id='another-actor';assert.equal((await f.run('confirm',{confirmacion_token:preview.confirmacion_token})).statusCode,409);token.actor_id=external;
  token.payload.tasks[0].revision++;assert.equal((await f.run('confirm',{confirmacion_token:preview.confirmacion_token})).statusCode,409);
  assert.ok(f.live.tasks.every(t => t.estado==='aprobada'));assert.equal(token.used_at,null);
});

test('signed-v2 exact-target middleware rejects unsigned/changed-target calls before the registrar',async () => {
  const f=fixture(),keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const env={NODE_ENV:'test',WILSON_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'})};
  const middleware=requireWilsonService(env,() => Date.now(),{allowSignedUnknownWhatsappPrivate:true});
  for(const mode of ['valid','v1','target','signature','group']) {
    const req=f.request({task_ids:[101]});req.originalUrl='/api/integraciones/wilson/lotes/finalizacion/previsualizar';
    const timestamp=String(Math.floor(Date.now()/1000)),nonce=randomUUID(),group=mode==='group'?'not-allowed':'';
    const message=buildWilsonSignatureMessage({timestamp,nonce,channel:'whatsapp',actorId:external,groupId:group,
      actorName:'Untrusted',method:'POST',path:req.originalUrl,body:req.body});
    Object.assign(req.headers,{'x-wilson-timestamp':timestamp,'x-wilson-nonce':nonce,'x-wilson-channel':'whatsapp',
      'x-wilson-actor-id':external,'x-wilson-actor-name':'Untrusted','x-wilson-group-id':group,
      'x-wilson-signature':sign('sha256',Buffer.from(message),keys.privateKey).toString('base64')});
    if(mode==='v1')req.headers['x-wilson-signature-version']='1';if(mode==='target')req.originalUrl+='?changed=1';
    if(mode==='signature')req.headers['x-wilson-signature']='invalid';
    const res={statusCode:200,status(value) {this.statusCode=value;return this;},json(value) {this.body=value;return this;}};
    let verified=false;middleware(req,res,() => {verified=true;});
    if(mode!=='valid'){assert.equal(verified,false);assert.ok(res.statusCode>=400);continue;}
    await resolveWilsonUser(f.pool,env)(req,res,error => {assert.equal(error,undefined);});
    await f.routes.get(paths.preview)(req,res,error => {throw error;});assert.equal(res.statusCode,201);
  }
});

test('source owns no publication, assignment/production mutation, direct provider or schema path',() => {
  const source=readFileSync(new URL('../src/wilson-finalization.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/publishPiece|fetch\(|CREATE TABLE|ALTER TABLE|DELETE FROM|UPDATE publicaciones|INSERT INTO publicaciones|UPDATE produccion_|INSERT INTO produccion_/);
  assert.match(source,/ORDER BY t.id FOR UPDATE OF t/);assert.match(source,/expires_at>clock_timestamp\(\)/);
});

test('leader notices happen once per first-confirmed task, strictly after receipt COMMIT and lease release',async () => {
  const f=fixture();
  await f.run('resolve',{referencias:['#101']});const preview=await f.preview();
  assert.deepEqual(f.notifications,[]);assert.equal(f.calls.some(call => call.poolQuery),false);
  const start=f.calls.length,confirmed=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.equal(confirmed.statusCode,200,confirmed.error?.message);
  assert.deepEqual(f.notifications.map(notice => notice.tarea.id),[101,102]);
  const calls=f.calls.slice(start),commit=calls.findIndex(call => call.sql==='COMMIT'),release=calls.findIndex(call => call.sql==='RELEASE');
  const query=calls.findIndex(call => call.poolQuery),firstNotice=calls.findIndex(call => call.sql==='NOTIFY');
  assert.ok(commit>=0 && release>commit && query>release && firstNotice>query);
  for(const [index,notice] of f.notifications.entries()) {
    assert.equal(notice.pool,f.pool);assert.equal(notice.motivo,'finalizada');
    assert.equal(notice.actorId,7);assert.equal(notice.actor,'Current actor');assert.deepEqual(notice.destinatarioIds,[7,22]);
    assert.equal(Object.hasOwn(notice,'nombresDestinatarios'),false);
    assert.equal(notice.tarea.estado,'finalizada');assert.equal(notice.tarea.revision,2);
    assert.equal(notice.tarea.titulo,`Exact task ${101+index}`);
    const state=f.notificationStates[index];assert.ok(state.tasks.every(row => row.estado==='finalizada' && row.revision===2));
    assert.equal(state.audits.length,2);assert.deepEqual(state.tokens[0].payload.receipt,confirmed.body.receipt);assert.ok(state.tokens[0].used_at);
  }
  const committed=structuredClone(f.live),notifications=f.notifications.length,queries=f.calls.filter(call => call.poolQuery).length;
  const replay=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.equal(replay.statusCode,200);assert.equal(replay.body.idempotent,true);assert.deepEqual(replay.body.receipt,confirmed.body.receipt);
  assert.equal(f.notifications.length,notifications);assert.equal(f.calls.filter(call => call.poolQuery).length,queries);assert.deepEqual(f.live,committed);
});

test('notices use current active admin IDs queried after commit, never cached names or request actor claims',async () => {
  const f=fixture(),preview=await f.preview();
  f.actor.nombre='Verified renamed actor';
  f.onCommit=() => {
    f.leaders.find(row => row.id===22).rol='edicion';
    f.leaders.push({id:55,nombre:'Verified renamed actor',rol:'admin',activo:true});
  };
  const result=await f.run('confirm',{confirmacion_token:preview.confirmacion_token},req => {
    req.wilson.actorName='Forged name';req.wilson.confirmedBy='Forged name';req.wilson.actorRole='admin';
  });
  assert.equal(result.statusCode,200,result.error?.message);assert.equal(f.notifications.length,2);
  for(const notice of f.notifications) {
    assert.deepEqual(notice.destinatarioIds,[7,55]);assert.equal(notice.actorId,7);assert.equal(notice.actor,'Verified renamed actor');
    assert.equal(Object.hasOwn(notice,'nombresDestinatarios'),false);
  }
  const queries=f.calls.filter(call => call.poolQuery);assert.equal(queries.length,1);
  assert.equal(queries[0].sql,"SELECT id FROM usuarios WHERE activo IS TRUE AND rol='admin' ORDER BY id");
});

for(const fault of ['connect','token','second-task','audit','receipt','cas','commit'])test(`no post-commit notice or recipient query after ${fault} fault`,async () => {
  const f=fixture();let token;
  if(!['connect','token'].includes(fault))token=(await f.preview()).confirmacion_token;
  const before=structuredClone(f.live);f.failure=fault;
  const result=await f.run(['connect','token'].includes(fault)?'preview':'confirm',
    ['connect','token'].includes(fault)?{task_ids:[101,102]}:{confirmacion_token:token});
  assert.ok(result.statusCode>=400);assert.deepEqual(f.live,before);assert.deepEqual(f.notifications,[]);
  assert.equal(f.calls.some(call => call.poolQuery),false);
});

test('expired or unauthorized confirmations never notify or look up recipients',async () => {
  for(const mode of ['expired','revoked']) {
    const f=fixture(),preview=await f.preview();if(mode==='expired')f.advance(900001);else f.actor.activo=false;
    const result=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
    assert.ok([403,409].includes(result.statusCode));assert.deepEqual(f.notifications,[]);assert.equal(f.calls.some(call => call.poolQuery),false);
  }
});

test('recipient query failure preserves committed HTTP200 and receipt; replay never retries notices',async () => {
  const f=fixture(),preview=await f.preview();f.failure='leader-query';
  const confirmed=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.equal(confirmed.statusCode,200);assert.equal(confirmed.error,undefined);assert.equal(confirmed.body.updated,true);
  assert.ok(f.live.tasks.every(row => row.estado==='finalizada'));assert.deepEqual(f.live.tokens[0].payload.receipt,confirmed.body.receipt);
  assert.deepEqual(f.notifications,[]);assert.equal(f.calls.filter(call => call.poolQuery).length,1);
  f.failure=undefined;const before=structuredClone(f.live),replay=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.equal(replay.statusCode,200);assert.equal(replay.body.idempotent,true);assert.deepEqual(replay.body.receipt,confirmed.body.receipt);
  assert.deepEqual(f.notifications,[]);assert.equal(f.calls.filter(call => call.poolQuery).length,1);assert.deepEqual(f.live,before);
});

for(const mode of ['sync','async'])test(`${mode} notifier failure preserves HTTP200 and still attempts each task once`,async () => {
  const attempts=[];
  const f=fixture({notifyAssignment:mode==='sync'?notice => {attempts.push(notice.tarea.id);throw Error('injected sync notification failure');}
    :async notice => {attempts.push(notice.tarea.id);throw Error('injected async notification failure');}});
  const preview=await f.preview(),confirmed=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.equal(confirmed.statusCode,200);assert.equal(confirmed.error,undefined);assert.equal(confirmed.body.updated,true);
  assert.deepEqual(attempts,[101,102]);assert.deepEqual(f.live.tokens[0].payload.receipt,confirmed.body.receipt);
  const before=structuredClone(f.live),replay=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});
  assert.equal(replay.statusCode,200);assert.equal(replay.body.idempotent,true);assert.deepEqual(attempts,[101,102]);assert.deepEqual(f.live,before);
});

test('optional notifier absence causes no recipient lookup and does not alter confirmation semantics',async () => {
  const f=fixture({notifyAssignment:null}),preview=await f.preview();
  const confirmed=await f.run('confirm',{confirmacion_token:preview.confirmacion_token});assert.equal(confirmed.statusCode,200);
  assert.equal(confirmed.body.updated,true);assert.deepEqual(f.notifications,[]);assert.equal(f.calls.some(call => call.poolQuery),false);
});
