import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approveProjectDeliverable, projectDeliverableContentHash, normalizeProjectDeliverableApprovalInput, projectDeliverableDto } from '../src/project-deliverable-approvals.js';
import { normalizeProjectChild, createProjectsRouter } from '../src/projects.js';

const id=n=>`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const user={id:7,rol:'admin',activo:true,session_version:2};
const clone=value=>structuredClone(value);
const denied=(status)=>Object.assign(Error('denied'),{status});

function fixture({ failure }={}){
  const calls=[];
  const state={project:{id:id(1),responsable_id:7,cliente_id:3,revision:4,archivado:false},
    child:{id:id(2),proyecto_id:id(1),titulo:'Sitio web',url:'https://example.test/entrega',observaciones:'Versión observada',
      estado:'en_revision',contenido_revision:2,entregable_revision:3,aprobacion_actual_id:null,aprobado_por_id:null,aprobado_at:null},
    receipts:[],events:[]};
  let baseline;
  const db={async query(sql,params=[]){
    calls.push({sql,params});
    if(sql==='BEGIN'){baseline=clone(state);return{rows:[]};}
    if(sql==='ROLLBACK'){Object.assign(state,baseline);return{rows:[]};}
    if(sql==='COMMIT')return{rows:[]};
    if(failure&&sql.includes(failure))throw Error('injected failure');
    if(sql.startsWith('SELECT pg_advisory'))return{rows:[]};
    if(sql.startsWith('SELECT * FROM proyecto_entregable_aprobaciones'))return{rows:clone(state.receipts.filter(r=>r.actor_id===params[0]&&r.request_id===params[1]))};
    if(sql.startsWith('SELECT id,proyecto_id,titulo'))return{rows:params[0]===state.project.id&&params[1]===state.child.id?[clone(state.child)]:[]};
    if(sql.startsWith('INSERT INTO proyecto_entregable_aprobaciones')){
      const [receiptId,project,child,actor,request,payloadHash,projectRevision,observedRevision,contentRevision,approvalRevision,contentHash,title,url,notes]=params;
      const receipt={id:receiptId,proyecto_id:project,entregable_id:child,actor_id:actor,request_id:request,payload_hash:payloadHash,
        observed_project_revision:projectRevision,observed_entregable_revision:observedRevision,contenido_revision:contentRevision,
        entregable_revision:approvalRevision,contenido_hash:contentHash,titulo:title,url,observaciones:notes,aprobado_at:'2026-10-21T12:00:00.123Z'};
      state.receipts.push(receipt);return{rows:[clone(receipt)]};
    }
    if(sql.startsWith('UPDATE proyecto_entregables SET estado=')){
      const receipt=state.receipts.find(r=>r.id===params[2]);
      Object.assign(state.child,{estado:'aprobado',aprobacion_actual_id:receipt.id,aprobado_por_id:params[3],aprobado_at:receipt.aprobado_at,entregable_revision:state.child.entregable_revision+1});
      return{rows:[]};
    }
    throw Error(`Unexpected query: ${sql}`);
  },release(error){calls.push({sql:'RELEASE',error});}};
  const deps={
    async lockProjectLinks(db){await db.query("SELECT pg_advisory_xact_lock(hashtext('proyecto-vinculos'))");},
    async lockProject(db,project,revision,actor){calls.push({sql:'LOCK PROJECT',params:[project,revision,actor.id]});
      if(state.project.archivado||actor.rol!=='admin'&&state.project.responsable_id!==actor.id)throw denied(403);
      return clone(state.project);},
    async bump(db,project,revision){if(failure==='bump')throw Error('injected failure');assert.equal(state.project.revision,revision);state.project.revision++;calls.push({sql:'BUMP'});},
    async activity(db,project,actor,action,resource,before,after){if(failure==='activity')throw Error('injected failure');state.events.push({project,actor:actor.id,action,resource,before,after});},
    async readProjectDetail(){const receipt=state.receipts.find(r=>r.id===state.child.aprobacion_actual_id);
      return{...clone(state.project),entregables:[projectDeliverableDto({...state.child,current_proof:Boolean(receipt&&receipt.contenido_revision===state.child.contenido_revision&&receipt.entregable_revision===state.child.entregable_revision),approval_hash:receipt?.contenido_hash})]};},
  };
  const body=()=>({request_id:id(99),expected_revision:state.project.revision,expected_entregable_revision:state.child.entregable_revision,
    expected_content_revision:state.child.contenido_revision,expected_content_hash:projectDeliverableContentHash(state.child)});
  async function run(input=body(),actor=user,project=id(1),child=id(2)){
    await db.query('BEGIN');
    try{const value=await approveProjectDeliverable(db,{projectId:project,deliverableId:child,input,user:actor},deps);await db.query('COMMIT');return value;}
    catch(error){await db.query('ROLLBACK');throw error;}
  }
  return{state,calls,db,deps,body,run};
}

test('content hash is exact observed title/URL/notes only, including Unicode and spaces',()=>{
  const base={titulo:'Web é',url:'https://example.test/archivo',observaciones:' nota '};
  assert.match(projectDeliverableContentHash(base),/^[a-f0-9]{64}$/);
  assert.equal(projectDeliverableContentHash({...base,estado:'aprobado',importe:999}),projectDeliverableContentHash(base));
  for(const value of [{...base,titulo:'Web e\u0301'},{...base,url:base.url+'/'},{...base,observaciones:'nota'}])assert.notEqual(projectDeliverableContentHash(value),projectDeliverableContentHash(base));
  assert.throws(()=>projectDeliverableContentHash({...base,url:null}),{status:409});
});

test('approval input is closed, exact lowercase hash and case-normalized UUID without final-newline acceptance',()=>{
  const f=fixture(),valid=f.body();assert.deepEqual(normalizeProjectDeliverableApprovalInput(valid),valid);
  const upper={...valid,request_id:'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'};
  assert.equal(normalizeProjectDeliverableApprovalInput(upper).request_id,upper.request_id.toLowerCase());
  for(const patch of [{request_id:valid.request_id+'\n'},{request_id:null},{expected_content_hash:'A'.repeat(64)},
    {expected_content_hash:valid.expected_content_hash+'\n'},{expected_revision:'4'},{expected_content_revision:0},{expected_entregable_revision:1.5},{titulo:'not allowed'}]){
    assert.throws(()=>normalizeProjectDeliverableApprovalInput({...valid,...patch}),{status:400});
  }
});

test('both generic creation and PATCH refuse aprobado but permit explicit departure from approval',()=>{
  for(const create of [false,true])assert.throws(()=>normalizeProjectChild('entregables',{...(create?{request_id:id(9)}:{}),expected_revision:1,titulo:'Web',estado:'aprobado'},{create}),{status:400});
  assert.equal(normalizeProjectChild('entregables',{expected_revision:1,estado:'en_revision'}).estado,'en_revision');
});

test('legacy approved DTO stays unversioned; current proof is small and exact',()=>{
  const f=fixture(),legacy={...f.state.child,estado:'aprobado',aprobado_por_id:8,aprobado_at:'2026-10-01'};
  const dto=projectDeliverableDto(legacy);assert.equal(dto.aprobacion_versionada,false);assert.equal(dto.aprobado_por_id,8);
  const current=projectDeliverableDto({...legacy,aprobacion_actual_id:id(8),current_proof:true,approval_hash:projectDeliverableContentHash(legacy)});
  assert.equal(current.aprobacion_versionada,true);assert.equal(Object.hasOwn(current,'approval_hash'),false);
  assert.equal(Object.hasOwn(current,'current_proof'),false);assert.equal(Object.hasOwn(current,'historial'),false);
  assert.equal(projectDeliverableDto({...legacy,aprobacion_actual_id:id(8),current_proof:true,approval_hash:'0'.repeat(64)}).aprobacion_versionada,false);
});

test('approval stores exact immutable content snapshot, bumps project once and returns bounded receipt',async()=>{
  const f=fixture(),observed=clone(f.state.child),result=await f.run();
  assert.equal(result.status,201);assert.equal(result.body.replayed,false);assert.equal(f.state.receipts.length,1);assert.equal(f.state.project.revision,5);
  assert.equal(f.state.child.entregable_revision,4);assert.equal(f.state.child.contenido_revision,2);assert.equal(result.body.proyecto.entregables[0].aprobacion_versionada,true);
  assert.equal(f.state.receipts[0].titulo,observed.titulo);assert.equal(f.state.receipts[0].observaciones,observed.observaciones);
  assert.deepEqual(Object.keys(result.body.aprobacion).sort(),['id','entregable_id','contenido_revision','entregable_revision','contenido_hash','actor_id','aprobado_at'].sort());
  assert.equal(f.state.events[0].before,'en_revision');assert.equal(f.state.events[0].after,'aprobado');
  assert.equal(f.calls.some(c=>/^(INSERT INTO|UPDATE|DELETE FROM) (tareas|publicaciones|historias|cliente_objetivo)/.test(c.sql)),false);
});

test('lock order is receipt mutex → structural project lock → project authority → child lock',async()=>{
  const f=fixture();await f.run();const sql=f.calls.map(c=>c.sql);
  const receipt=sql.findIndex(s=>s.includes('hashtextextended')),structure=sql.findIndex(s=>s.includes('proyecto-vinculos')),
    project=sql.indexOf('LOCK PROJECT'),child=sql.findIndex(s=>s.includes('FROM proyecto_entregables WHERE')&&s.includes('FOR UPDATE'));
  assert.ok(receipt<structure&&structure<project&&project<child);
  assert.equal(f.calls[project].params[1],null); // skip CAS only after current authorization, for replay
});

test('replay returns original proof plus CURRENT state and never resurrects approval after edit/revert',async()=>{
  const f=fixture(),body=f.body(),first=await f.run(body);
  // Simulate persisted trigger result after content change then exact text revert.
  f.state.child.contenido_revision+=2;f.state.child.entregable_revision+=2;f.state.child.estado='en_revision';
  f.state.child.aprobacion_actual_id=null;f.state.child.aprobado_por_id=null;f.state.child.aprobado_at=null;
  f.state.project.revision+=2;
  const before=clone(f.state),calls=f.calls.length,replay=await f.run(body);
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(replay.body.aprobacion,first.body.aprobacion);
  assert.equal(replay.body.proyecto.entregables[0].aprobacion_versionada,false);assert.deepEqual(f.state,before);
  assert.equal(f.calls.slice(calls).some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)),false);
});

test('state ABA is rejected by deliverable revision even when content hash/revision and project revision match',async()=>{
  const f=fixture(),body=f.body();f.state.child.entregable_revision+=2;
  await assert.rejects(f.run(body),{status:409});assert.equal(f.state.receipts.length,0);
});

test('project/content version/hash mismatch or foreign resource does not approve',async()=>{
  for(const patch of [{expected_revision:1},{expected_content_revision:1},{expected_entregable_revision:1},{expected_content_hash:'0'.repeat(64)}]){
    const f=fixture(),before=clone(f.state);await assert.rejects(f.run({...f.body(),...patch}),{status:409});assert.deepEqual(f.state,before);
  }
  const f=fixture();await assert.rejects(f.run(f.body(),user,id(1),id(777)),{status:404});
});

test('receipt mismatch and replay after ownership/archive loss deny with no reactivation',async()=>{
  const f=fixture(),body=f.body();await f.run(body);
  await assert.rejects(f.run({...body,expected_content_hash:'0'.repeat(64)}),{status:409});
  f.state.project.responsable_id=99;
  await assert.rejects(f.run(body,{...user,rol:'edicion'}),{status:403});
  f.state.project.archivado=true;await assert.rejects(f.run(body),{status:403});
});

test('each failure rolls back snapshot receipt, current pointer, project version and activity',async()=>{
  for(const failure of ['INSERT INTO proyecto_entregable_aprobaciones','UPDATE proyecto_entregables SET estado=','bump','activity']){
    const f=fixture({failure}),before=clone(f.state);await assert.rejects(f.run(),/injected failure/);assert.deepEqual(f.state,before);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
});

test('actual router registers approval route, revalidates actor SHARE before handler and disposes failed rollback',async()=>{
  const routes=[];const express={Router:()=>({use(){},get(){},post(path,handler){routes.push({path,handler});},patch(){},put(){},delete(){}})};
  let released;const failure=Error('rollback failed'),calls=[];
  const db={async query(sql){calls.push(sql);if(sql.startsWith('BEGIN'))return{rows:[]};
    if(sql==='ROLLBACK')throw failure;
    if(sql.startsWith('SELECT id,nombre,rol,activo,session_version'))return{rows:[{...user,activo:false}]};
    assert.fail('revoked actor must not reach approval handler');},release(error){released=error;}};
  createProjectsRouter({express,pool:{connect:async()=>db}});
  const route=routes.find(r=>r.path==='/:id/entregables/:child/aprobaciones');assert.ok(route);
  let status;const res={status(n){status=n;return this;},json(){}};
  await route.handler({auth:user,body:fixture().body(),params:{id:id(1),child:id(2)}},res,error=>{throw error;});
  assert.equal(status,401);assert.match(calls[1],/FOR SHARE/);assert.equal(released,failure);
});

test('079 preserves legacy rows, guards direct SQL edits/revision ABA and keeps receipts immutable',()=>{
  const sql=readFileSync(new URL('../migrations/079_project_deliverable_approvals.sql',import.meta.url),'utf8');
  assert.doesNotMatch(sql,/^\s*(?:UPDATE|DELETE FROM|TRUNCATE|DROP)\s/im);
  assert.match(sql,/BEFORE INSERT OR UPDATE ON proyecto_entregables/);
  assert.match(sql,/NEW.contenido_revision:=OLD.contenido_revision \+ CASE WHEN content_changed THEN 1 ELSE 0 END/);
  assert.match(sql,/NEW.entregable_revision:=OLD.entregable_revision \+ CASE WHEN content_changed OR approval_changed THEN 1 ELSE 0 END/);
  assert.match(sql,/IF OLD.estado='aprobado' OR NEW.estado='aprobado' THEN NEW.estado:='en_revision'/);
  assert.match(sql,/IF NEW.estado<>'aprobado' THEN\s+NEW.aprobacion_actual_id:=NULL/);
  assert.match(sql,/proof.entregable_revision<>NEW.entregable_revision/);
  assert.match(sql,/ROW\(proof.titulo,proof.url,proof.observaciones\) IS DISTINCT FROM ROW\(NEW.titulo,NEW.url,NEW.observaciones\)/);
  assert.match(sql,/BEFORE UPDATE OR DELETE ON proyecto_entregable_aprobaciones/);
  assert.match(sql,/FOREIGN KEY\(aprobacion_actual_id,proyecto_id,id\)/);
});

test('generic edit activity uses trigger-returned actual state rather than stale form state',()=>{
  const source=readFileSync(new URL('../src/projects.js',import.meta.url),'utf8');
  assert.match(source,/kind==='entregables'\?' RETURNING estado':''/);
  assert.match(source,/actualState=updated.rows\[0\]\.estado/);
  assert.match(source,/actualState \?\? input.estado \?\? old\?\.estado/);
});
