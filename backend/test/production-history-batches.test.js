import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProductionHistoryBatch, readProductionHistoryBatchContext, reconcileProductionHistoryBatch } from '../src/production-history-batches.js';
import { productionBatchVideoEvidence, productionBatchCandidateProvenance, batchLiveVideoCompatible } from '../src/production-batch-evidence.js';
import { productionHistoryHash, productionValueHash } from '../src/production-history-hash.js';
import { isReconciledProductionVideo } from '../src/production-history.js';
import { registerProductionReconciliationRoutes } from '../src/production-reconciliation.js';

const ID = n => `10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const auth = {id:7,session_version:2,rol:'admin'};
const copy = value => structuredClone(value);

function fixture({ existing = true, failure, onQuery } = {}) {
  const calls=[];
  const state={
    actor:{id:7,session_version:2,rol:'admin',activo:true},
    source:{id:1,revision:5,titulo:'Visita histórica',tipo_tarea:'produccion',subtipo:'visita',cliente_id:2,
      source_date:'2026-10-21',cliente_nombre:'Cliente QA',cliente_activo:true,
      propiedades_extra:{workspace:'render_os',produccion_registros:[{cantidad:2}],guiones:'Guion histórico',importe_secreto:987654}},
    visit:existing ? {id:ID(1),revision:3,tarea_origen_id:1,cliente_id:2,fecha:'2026-10-21',titulo:'Conservar visita',observaciones:'Notas',drive_url:'',participante_ids:[7]} : null,
    children:[10,11].map(id=>({id,revision:2,titulo:`Edición ${id}`,estado:'pendiente',cliente_id:2,tipo_tarea:'edicion',historia_id:null,publicacion_id:null,
      propiedades_extra:{workspace:'render_os',origen_visita_id:'1'},fecha_entrega:'2026-10-22',project_bound:false,goal_bound:false,bound_video_ids:[],owners:[{id:7,rol:'admin',activo:true}]})),
    videos:existing ? [2,3].map(n=>({id:ID(n),visita_id:ID(1),video_origen_id:null,titulo:`Video ${n}`,guion:'Texto',estado:'grabado',material_url:'https://example.test/material',observaciones:'Conservar',
      tarea_edicion_id:null,tarea_entrega_id:null,publicacion_id:null,cliente_editorial_id:null,editor_id:null,fecha_entrega:null,observed_version:'2026-10-21 12:00:00.000001+00'})) : [],
    maps:[],batches:[],proofs:[],dispositions:[],liveCompatible:true,
  };
  let baseline;
  const db={
    async query(sql,params=[]){
      calls.push({sql,params});
      if(onQuery)onQuery(sql,params,state);
      if(sql.startsWith('BEGIN')){baseline=copy(state);return{rows:[]};}
      if(sql==='ROLLBACK'){Object.assign(state,baseline);return{rows:[]};}
      if(sql==='COMMIT')return{rows:[]};
      if(failure&&sql.includes(failure))throw Error('injected SQL failure');
      if(sql.startsWith('SELECT pg_advisory'))return{rows:[]};
      if(sql.startsWith('SELECT id,rol,activo,session_version'))return{rows:[copy(state.actor)]};
      if(sql.startsWith('SELECT t.id,t.revision,t.titulo,t.tipo_tarea'))return{rows:[copy(state.source)]};
      if(sql.startsWith('SELECT id,revision,tarea_origen_id'))return{rows:state.visit?[copy(state.visit)]:[]};
      if(sql.startsWith('SELECT t.id,t.revision,t.titulo,t.estado'))return{rows:copy(state.children)};
      if(sql.startsWith('SELECT id,visita_id,video_origen_id'))return{rows:copy(state.videos)};
      if(sql.startsWith('SELECT m.video_id,m.visita_id'))return{rows:copy(state.maps)};
      if(sql.startsWith('SELECT id,revision FROM tareas'))return{rows:state.children.filter(t=>params[0].includes(t.id)).map(t=>({id:t.id,revision:t.revision}))};
      if(sql.startsWith('SELECT DISTINCT o.clave'))return{rows:[]};
      if(/SELECT id FROM (tareas|produccion_visitas|produccion_videos|clientes)/.test(sql))return{rows:[]};
      if(sql.startsWith('SELECT id FROM usuarios'))return{rows:params[0].map(id=>({id}))};
      if(sql.startsWith('SELECT id,visita_id,payload_hash FROM produccion_revision_lotes'))return{rows:copy(state.batches.filter(b=>b.actor_user_id===params[0]&&b.request_id===params[1]))};
      if(sql.startsWith('SELECT video_id FROM produccion_revision_lote_videos'))return{rows:state.proofs.filter(p=>p.lote_id===params[0]).sort((a,b)=>a.ordinal-b.ordinal).map(p=>({video_id:p.video_id}))};
      if(sql.startsWith('INSERT INTO produccion_visitas(')){
        state.visit={id:params[0],tarea_origen_id:params[1],cliente_id:params[2],fecha:params[3],titulo:params[4],observaciones:params[5],drive_url:params[6],revision:1,participante_ids:[]};return{rows:[]};
      }
      if(sql.startsWith('INSERT INTO produccion_visita_participantes')){state.visit.participante_ids=copy(params[1]);return{rows:[]};}
      if(sql.startsWith('INSERT INTO produccion_revision_lotes(')){
        state.batches.push({id:params[0],actor_user_id:params[1],request_id:params[2],payload_hash:params[3],tarea_origen_id:params[4],source_history_hash:params[6],visita_id:params[8],secuencia:state.batches.length+1});return{rows:[]};
      }
      if(sql.startsWith('INSERT INTO produccion_videos(')){
        state.videos.push({id:params[0],visita_id:params[1],titulo:params[2],guion:params[3],estado:params[4],material_url:params[5],observaciones:params[6],tarea_edicion_id:null,tarea_entrega_id:null,publicacion_id:null});return{rows:[]};
      }
      if(sql.startsWith('UPDATE produccion_videos SET tarea_edicion_id')){
        Object.assign(state.videos.find(v=>v.id===params[0]),{tarea_edicion_id:params[1],editor_id:params[2],fecha_entrega:params[3]});
        state.children.find(t=>t.id===params[1]).bound_video_ids=[params[0]];return{rows:[]};
      }
      if(sql.startsWith('INSERT INTO produccion_lote_edicion_mapeos(')){
        state.maps.push({video_id:params[0],visita_id:params[1],tarea_edicion_id:params[2],task_revision:params[3],editor_id:params[4],fecha_entrega:params[5],lote_id:params[6]});return{rows:[]};
      }
      if(sql.startsWith('INSERT INTO produccion_revision_lote_videos(')){
        state.proofs.push({lote_id:params[0],video_id:params[1],ordinal:params[2],disposition:params[3],tarea_edicion_id:params[4]});return{rows:[]};
      }
      if(sql.startsWith('INSERT INTO produccion_revision_lote_hijos(')){state.dispositions.push(copy(params));return{rows:[]};}
      if(sql.startsWith('UPDATE produccion_visitas SET revision')){state.visit.revision++;return{rows:[]};}
      if(sql.startsWith('SELECT l.id,l.visita_id')){
        const proof=[...state.proofs].reverse().find(p=>p.video_id===params[0]);
        return{rows:proof?[{...state.batches.find(b=>b.id===proof.lote_id),...proof}]:[]};
      }
      if(sql.startsWith('SELECT pv.id FROM produccion_videos'))return{rows:state.liveCompatible?[{id:params[0]}]:[]};
      throw Error(`Unexpected unit query: ${sql}`);
    },release(error){calls.push({sql:'RELEASE',error});},
  };
  const pool={connect:async()=>db};
  const context=()=>readProductionHistoryBatchContext(pool,auth,'1');
  async function body({adopt=true,selectBoth=false}={}){
    const c=await context(),videos=selectBoth?[0,1]:[0];
    return{version:2,request_id:ID(900+state.batches.length),source_task_id:1,expected_source_revision:c.source.revision,
      visit_id:c.visit?.id??null,expected_visit_revision:c.visit?.revision??null,expected_context_hash:c.context_hash,
      ...(!c.visit?{visit_fields:{titulo:'Revisión manual',participante_ids:[],drive_url:'',observaciones:''}}:{}),
      videos:videos.map((index)=>({...c.visit?{existing_video_id:c.visit.videos[index].id}:{local_key:ID(100+index),new_video:{titulo:`Manual ${index}`,estado:'grabado',guion:'',material_url:'',observaciones:''}},disposition:adopt?'adopt_original':'manual_independent',task_id:adopt?10+index:null})),
      child_dispositions:c.legacy_tasks.map((task,index)=>({task_id:task.id,expected_revision:task.revision,
        disposition:adopt&&videos.includes(index)?'mapped':'preserve_unmapped',video_key:adopt&&videos.includes(index)?c.visit?.videos[index].id??ID(100+index):null,reason:'Revisado explícitamente'})),
      acknowledgement:'correspondencias_revisadas_manualmente'};
  }
  return{state,calls,pool,db,context,body,write:input=>reconcileProductionHistoryBatch(pool,auth,input)};
}

test('v2 context safe DTO includes actual visit/video/task IDs but no raw metadata or money',async()=>{
  const f=fixture();const c=await f.context();
  assert.equal(c.version,2);assert.equal(c.context_hash.length,64);assert.equal(c.visit.videos.length,2);
  assert.equal(c.source.content.script,'Guion histórico');assert.equal(c.legacy_tasks[0].eligibility,'adoptable');
  assert.equal(JSON.stringify(c).includes('importe_secreto'),false);assert.equal(JSON.stringify(c).includes('987654'),false);
  assert.equal(JSON.stringify(c).includes('observed_version'),false);
  assert.match(f.calls[0].sql,/REPEATABLE READ/);
});

test('context rejects noncanonical IDs/query selectors and current nonadmin/revoked actors',async()=>{
  for(const id of ['1\n','01','0','2147483648',1,null]){
    let connected=false;await assert.rejects(readProductionHistoryBatchContext({connect(){connected=true;}},auth,id),{status:400});assert.equal(connected,false);
  }
  const f=fixture();await assert.rejects(readProductionHistoryBatchContext(f.pool,auth,'1',{actor_id:7}),{status:400});
  for(const change of [s=>s.actor.rol='edicion',s=>s.actor.activo=false,s=>s.actor.session_version++]){
    const g=fixture();change(g.state);await assert.rejects(g.context(),{status:g.state.actor.rol==='edicion'?403:401});
  }
});

test('history/video inventory bounds fail explicitly and never create a next unreadable aggregate',async()=>{
  const f=fixture();f.state.children=Array.from({length:51},(_,index)=>({...copy(f.state.children[0]),id:100+index}));
  await assert.rejects(f.context(),{status:413});
  const g=fixture();g.state.videos=Array.from({length:50},(_,index)=>({...copy(g.state.videos[0]),id:ID(index+200)}));
  const input=await g.body({adopt:false});input.videos=[{local_key:ID(600),new_video:{titulo:'Nuevo',estado:'planificado'},disposition:'manual_independent',task_id:null}];
  await assert.rejects(g.write(input),{status:413});assert.equal(g.state.batches.length,0);
});

test('strict UUIDs/closed payload/one-to-one/manual acknowledgements reject before connect',async()=>{
  const f=fixture();const valid=await f.body();
  const mutations=[b=>b.request_id+='\n',b=>b.version=1,b=>b.extra=true,b=>b.visit_id=undefined,
    b=>b.videos[0].existing_video_id+='\n',b=>b.child_dispositions[0].reason='',b=>b.videos.push(copy(b.videos[0])),
    b=>b.videos[0].disposition='manual_independent',b=>b.child_dispositions[0].video_key=ID(999),
    b=>b.expected_context_hash+='\n',b=>b.visit_fields={titulo:'Overwrite'}];
  for(const mutate of mutations){const input=copy(valid);mutate(input);let connected=false;
    await assert.rejects(reconcileProductionHistoryBatch({connect(){connected=true;}},auth,input),{status:400});assert.equal(connected,false);}
  const uppercase=copy(valid);uppercase.request_id=uppercase.request_id.toUpperCase();
  assert.equal(validateProductionHistoryBatch(uppercase).request_id,valid.request_id.toLowerCase());
});

test('existing mixed visit two mappings preserve all source/task/video content and create no task evidence',async()=>{
  const f=fixture(),before=copy(f.state);const result=await f.write(await f.body({selectBoth:true}));
  assert.equal(result.created,true);assert.equal(f.state.maps.length,2);assert.equal(f.state.batches.length,1);
  assert.deepEqual(f.state.source,before.source);
  assert.deepEqual(f.state.children.map(t=>({...t,bound_video_ids:[]})),before.children);
  assert.deepEqual(f.state.videos.map(({tarea_edicion_id,editor_id,fecha_entrega,...v})=>v),before.videos.map(({tarea_edicion_id,editor_id,fecha_entrega,...v})=>v));
  assert.equal(f.state.visit.titulo,before.visit.titulo);assert.equal(f.state.visit.revision,before.visit.revision+1);
  assert.equal(f.calls.some(c=>/^(?:INSERT INTO|UPDATE|DELETE FROM) (?:tareas|tarea_asignaciones|publicaciones|tarea_edicion|cliente_objetivo)/.test(c.sql)),false);
  const sql=f.calls.map(c=>c.sql);const tasks=sql.findIndex(s=>s.startsWith('SELECT id FROM tareas WHERE id=ANY'));
  const visit=sql.findIndex(s=>s.startsWith('SELECT id FROM produccion_visitas WHERE id='));
  const videos=sql.findIndex(s=>s.startsWith('SELECT id FROM produccion_videos WHERE visita_id='));
  assert.ok(tasks<visit&&visit<videos);assert.deepEqual(f.calls[tasks].params[0],[1,10,11]);
});

test('new unlinked source creates only manually listed videos, preserves unmatched child',async()=>{
  const f=fixture({existing:false});const result=await f.write(await f.body());
  assert.equal(result.video_ids.length,1);assert.equal(f.state.videos.length,1);assert.equal(f.state.maps.length,1);
  assert.equal(f.state.dispositions.length,2);assert.equal(f.state.dispositions[1][3],'preserve_unmapped');
  assert.equal(f.state.dispositions[1][4],null);assert.equal(f.state.source.propiedades_extra.produccion_registros[0].cantidad,2);
});

test('historical numeric JSON source marker matches canonical PostgreSQL text semantics',async()=>{
  const f=fixture();f.state.children[0].propiedades_extra.origen_visita_id=1;
  assert.equal((await f.context()).legacy_tasks[0].eligibility,'adoptable');
  await f.write(await f.body());assert.equal(f.state.maps[0].tarea_edicion_id,10);
});

test('manual independent selected videos get proof, unselected videos get no inherited waiver',async()=>{
  const f=fixture();await f.write(await f.body({adopt:false}));
  assert.equal(f.state.maps.length,0);assert.equal(f.state.proofs[0].disposition,'manual_independent');
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),true);
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(3)),null);
});

test('actor-scoped replay returns original UUIDs, performs no writes, checks current authority first',async()=>{
  const f=fixture();const body=await f.body(),first=await f.write(body);const count=f.calls.length;
  const replay=await f.write(body);assert.deepEqual({...replay,created:true},first);
  assert.equal(f.calls.slice(count).some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)),false);
  const mismatch=copy(body);mismatch.child_dispositions[0].reason='Otra intención';await assert.rejects(f.write(mismatch),{status:409});
  f.state.actor.session_version++;await assert.rejects(f.write(body),{status:401});
});

test('stale source/visit/hash or omitted child refuses before any domain write',async()=>{
  for(const mutate of [b=>b.expected_source_revision++,b=>b.expected_visit_revision++,b=>b.expected_context_hash='0'.repeat(64),b=>b.child_dispositions.pop()]){
    const f=fixture(),body=await f.body();mutate(body);const before=copy(f.state);
    await assert.rejects(f.write(body),{status:409});assert.deepEqual(f.state,before);
  }
});

test('post-lock reread catches task changes and child-set phantoms',async()=>{
  for(const phantom of [false,true]){
    let changed=false;
    const f=fixture({onQuery(sql,params,state){if(!changed&&sql.startsWith('SELECT id FROM tareas WHERE id=ANY')){changed=true;
      if(phantom)state.children.push({...copy(state.children[0]),id:12});else state.children[0].revision++;}}});
    const input=await f.body();await assert.rejects(f.write(input),{status:409});
    assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT INTO produccion_revision_lotes')),false);
  }
});

test('foreign/multiple mappings and incompatible owners/date/workspace/client reject',async()=>{
  for(const change of [f=>f.state.children[0].owners=[],f=>f.state.children[0].fecha_entrega=null,
    f=>f.state.children[0].propiedades_extra.workspace='private',f=>f.state.children[0].cliente_id=9,
    f=>f.state.children[0].project_bound=true,f=>f.state.children[0].goal_bound=true,
    f=>f.state.children[0].bound_video_ids=[ID(9)],
    f=>f.state.maps.push({video_id:ID(8),visita_id:ID(8),tarea_edicion_id:10})]){
    const f=fixture();change(f);const body=await f.body();await assert.rejects(f.write(body),{status:409});
  }
});

test('new batch re-reviews same mapping without replacing it and never falls back from newest invalid proof',async()=>{
  const f=fixture();await f.write(await f.body());const mapping=copy(f.state.maps[0]);
  f.state.source.propiedades_extra.produccion_registros.push({cantidad:1});f.state.source.revision++;
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),false);
  const before=f.calls.length;assert.equal(await isReconciledProductionVideo(f.db,f.state.visit,f.state.source,ID(2)),false);
  assert.equal(f.calls.slice(before).some(c=>c.sql.includes('FROM produccion_reconciliacion_videos rv')),false);
  await f.write(await f.body());assert.deepEqual(f.state.maps,[mapping]);assert.equal(f.state.proofs.length,2);
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),true);
  f.state.children.push({...copy(f.state.children[1]),id:12});
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),true);
});

test('adopted originals cannot be reclassified independent or silently remapped',async()=>{
  const f=fixture();await f.write(await f.body());const body=await f.body({adopt:false});
  await assert.rejects(f.write(body),{status:409});assert.equal(f.state.maps.length,1);
});

test('every injected write failure rolls back all canonical/audit changes',async()=>{
  for(const failure of ['INSERT INTO produccion_revision_lotes','UPDATE produccion_videos SET tarea_edicion_id','INSERT INTO produccion_lote_edicion_mapeos','INSERT INTO produccion_revision_lote_videos','INSERT INTO produccion_revision_lote_hijos','UPDATE produccion_visitas SET revision']){
    const f=fixture({failure}),body=await f.body(),before=copy(f.state);
    await assert.rejects(f.write(body),/injected SQL failure/);assert.deepEqual(f.state,before);
    assert.equal(f.calls.at(-2).sql,'ROLLBACK');assert.equal(f.calls.at(-1).sql,'RELEASE');
  }
});

test('read rollback failure discards its client and write revocation never reaches domain locks',async()=>{
  const primary=Error('read failure'),rollback=Error('rollback failure');let released;
  const db={async query(sql){if(sql.startsWith('BEGIN'))return{rows:[]};if(sql==='ROLLBACK')throw rollback;throw primary;},release(error){released=error;}};
  await assert.rejects(readProductionHistoryBatchContext({connect:async()=>db},auth,'1'),error=>error===primary);assert.equal(released,rollback);
  const f=fixture(),input=await f.body();f.state.actor.rol='edicion';const before=f.calls.length;
  await assert.rejects(f.write(input),{status:403});assert.equal(f.calls.slice(before).some(c=>c.sql.includes('pg_advisory')),false);
});

test('live proof checks exact canonical editorial tuple, permits lifecycle revisions, rejects broken binding',async()=>{
  const f=fixture();await f.write(await f.body());
  f.state.videos[0].publicacion_id=91;f.state.videos[0].tarea_entrega_id=10;f.state.children[0].publicacion_id=91;
  f.state.children[0].revision+=4;f.state.children[0].estado='finalizada';
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),true);
  const query=f.calls.at(-1).sql;
  assert.match(query,/t.publicacion_id=pv.publicacion_id AND pv.tarea_entrega_id=t.id/);
  assert.match(query,/pv.cliente_editorial_id=v.cliente_id/);assert.match(query,/s.tarea_id IS DISTINCT FROM t.id/);
  assert.doesNotMatch(query,/task_revision\s*=/);assert.doesNotMatch(query,/children|LIMIT 2/);
  f.state.liveCompatible=false;assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),false);
  assert.equal(await batchLiveVideoCompatible(f.db,f.state.visit,{...f.state.source,id:99},ID(2),10,true),false);
});

test('manual live task query rejects cross-domain history/project/archive but permits canonical pre-handoff tuple',async()=>{
  const f=fixture();await f.write(await f.body({adopt:false}));
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),true);
  const query=f.calls.at(-1).sql;
  for(const expression of [/workspace.*render_os/,/tipo_tarea IN \('edicion','diseno'\)/,/historia_id IS NULL/,/proyecto_tareas/,/archivada_render_os/,/papelera_render_os/,/pv.publicacion_id IS NOT NULL AND pv.tarea_entrega_id=t.id/])assert.match(query,expression);
});

test('administration type is allowed only for manual-independent exact editorial tuple before handoff',async()=>{
  const f=fixture();await f.write(await f.body({adopt:false}));
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),true);
  const independent=f.calls.at(-1).sql;
  assert.match(independent,/t.tipo_tarea='administracion'\s+AND pv.tarea_edicion_id IS NULL AND pv.publicacion_id IS NOT NULL\s+AND t.publicacion_id=pv.publicacion_id AND pv.tarea_entrega_id=t.id\s+AND pv.cliente_editorial_id=v.cliente_id/);
  assert.match(independent,/EXISTS\(SELECT 1 FROM publicaciones pub WHERE pub.id=pv.publicacion_id/);
  const g=fixture();await g.write(await g.body());
  assert.equal(await productionBatchVideoEvidence(g.db,g.state.visit,g.state.source,ID(2)),true);
  const original=g.calls.at(-1).sql;
  assert.match(original,/t.tipo_tarea='edicion'/);assert.doesNotMatch(original,/administracion/);
  await productionBatchCandidateProvenance(f.db,f.state.visit,f.state.source,ID(2));
  assert.doesNotMatch(f.calls.at(-1).sql,/administracion/);
});

test('candidate provenance can discover a staged original publication without authorizing operational dispatch',async()=>{
  const f=fixture();await f.write(await f.body());
  f.state.children[0].publicacion_id=91; // publication staged on original task only
  const query=f.db.query.bind(f.db);
  f.db.query=async(sql,params)=>{
    if(sql.startsWith('SELECT pv.id FROM produccion_videos')){
      const discovery=sql.includes('LEFT JOIN tareas t ON t.id=pv.tarea_edicion_id');
      if(discovery){assert.match(sql,/t.id=\$5/);assert.match(sql,/pv.publicacion_id IS NULL AND pv.tarea_entrega_id IS NULL/);
        assert.match(sql,/produccion_lote_edicion_mapeos/);assert.match(sql,/origen_visita_id/);return{rows:[{id:ID(2)}]};}
      return{rows:[]}; // strict live tuple is not yet written
    }
    return query(sql,params);
  };
  assert.deepEqual(await productionBatchCandidateProvenance(f.db,f.state.visit,f.state.source,ID(2)),{disposition:'adopt_original',taskId:10});
  assert.equal(await productionBatchVideoEvidence(f.db,f.state.visit,f.state.source,ID(2)),false);
  const after=f.calls.length;
  assert.equal(await isReconciledProductionVideo(f.db,f.state.visit,f.state.source,ID(2)),false);
  assert.equal(f.calls.slice(after).some(c=>c.sql.includes('FROM produccion_reconciliacion_videos rv')),false);
});

test('candidate provenance preserves null/false distinction and newest-invalid never revives older history',async()=>{
  const f=fixture();assert.equal(await productionBatchCandidateProvenance(f.db,f.state.visit,f.state.source,ID(2)),null);
  await f.write(await f.body());
  assert.equal(await productionBatchCandidateProvenance(f.db,f.state.visit,{...f.state.source,id:99},ID(2)),false);
  f.state.source.propiedades_extra.produccion_registros.push({cantidad:1});
  const start=f.calls.length;assert.equal(await productionBatchCandidateProvenance(f.db,f.state.visit,f.state.source,ID(2)),false);
  assert.equal(f.calls.length-start,1);assert.match(f.calls.at(-1).sql,/ORDER BY l.secuencia DESC LIMIT 1/);
});

test('candidate discovery rechecks live mapping/domain and manual-independent never gains an original task',async()=>{
  const f=fixture();await f.write(await f.body({adopt:false}));
  assert.deepEqual(await productionBatchCandidateProvenance(f.db,f.state.visit,f.state.source,ID(2)),{disposition:'manual_independent',taskId:null});
  const sql=f.calls.at(-1).sql;
  for(const pattern of [/NOT EXISTS\(SELECT 1 FROM produccion_lote_edicion_mapeos/,/NOT EXISTS\(SELECT 1 FROM produccion_edicion_adopciones/,/proyecto_tareas/,/workspace.*render_os/,/historia_id IS NULL/,/origen_produccion_video_id/,/produccion_visita_id/])assert.match(sql,pattern);
  assert.match(sql,/pv.publicacion_id IS NULL AND pv.tarea_entrega_id IS NULL/);
  f.state.liveCompatible=false;
  assert.equal(await productionBatchCandidateProvenance(f.db,f.state.visit,f.state.source,ID(2)),false);
});

test('GET/post bridge mounts v2 through existing registrar and returns first201/replay200',async()=>{
  const f=fixture(),routes=[];
  registerProductionReconciliationRoutes({get(path,fn){routes.push({path,fn,method:'GET'});},post(path,fn){routes.push({path,fn,method:'POST'});}}, {pool:f.pool,handle:fn=>fn});
  const get=routes.find(r=>r.path==='/reconciliaciones/lotes/origen/:sourceId');assert.ok(get);
  let response,status;const res={set(){},status(n){status=n;return this;},json(value){response=value;return value;}};
  await get.fn({auth,params:{sourceId:'1'},query:{}},res);assert.equal(response.version,2);
  const body=await f.body(),post=routes.find(r=>r.method==='POST'&&r.path==='/reconciliaciones');
  await post.fn({auth,query:{},body},res);assert.equal(status,201);assert.equal(response.created,true);
  await post.fn({auth,query:{},body},res);assert.equal(status,200);assert.equal(response.created,false);
});

test('schema extends only additive batch provenance and enforces immutable canonical mapping tuple',()=>{
  const sql=readFileSync(new URL('../migrations/078_production_history_batches.sql',import.meta.url),'utf8');
  for(const name of ['produccion_revision_lotes','produccion_revision_lote_videos','produccion_lote_edicion_mapeos','produccion_revision_lote_hijos'])assert.match(sql,new RegExp(`CREATE TABLE ${name}`));
  assert.match(sql,/FOREIGN KEY\(video_id,visita_id,tarea_edicion_id\)/);assert.match(sql,/ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.doesNotMatch(sql,/ALTER TABLE produccion_reconciliaciones|ALTER TABLE produccion_edicion_adopciones|\bUPDATE\s+(?:tareas|produccion)|DELETE FROM|TRUNCATE|DROP TABLE/);
  assert.deepEqual(sql.match(/DROP INDEX[^;]+;/g),['DROP INDEX public.tareas_render_os_origen_visita_unico;']);
  assert.match(sql,/CREATE INDEX tareas_origen_visita_history_lookup/);
  assert.equal(productionHistoryHash({propiedades_extra:{produccion_b:{y:2,x:1},secreto:999}}),productionValueHash({produccion_b:{x:1,y:2}}));
});
