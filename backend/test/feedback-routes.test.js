import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { feedbackBrowserAliasInput, feedbackBrowserAliasBody } from '../src/feedback-browser-compat.js';
import { normalizeFeedbackBrowserOperation } from '../src/feedback-browser-write.js';

// Exercise the actual legacy adapter and canonical validation; physical suites
// own SQL/CAS/history/authority verification, not a fake implementation of DML.
const source=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const version='2026-09-18T00:00:00.000Z';
const input=(action,body={},query={})=>feedbackBrowserAliasInput(action,{body,query,params:{id:'8'}});
const validate=(action,body,query)=>normalizeFeedbackBrowserOperation(input(action,body,query));
const metadata={cliente:'Cristal',responsables:['empleado'],flujo:'feedback'};
test('employee shared note create binds only business fields to the canonical service',()=>{
  const request_id=randomUUID(),actual=validate('create',{request_id,titulo:'Feedback',contenido:'Texto',feedback:metadata});
  assert.equal(actual.action,'create');assert.equal(actual.request_id,request_id);assert.equal(actual.fields.feedback.cliente,'Cristal');
  assert.equal(actual.fields.contenido,'Texto');assert.ok(!Object.hasOwn(actual,'note_id'));
  const region=source.slice(source.indexOf('router.post("/notas"'),source.indexOf('router.get("/usuarios"'));
  assert.match(source,/applyFeedbackBrowserOperation/);assert.match(region,/handleFeedbackBrowserWrite/);
  assert.doesNotMatch(region,/INSERT INTO notas_compartidas|UPDATE notas_compartidas|DELETE FROM notas_compartidas|INSERT INTO tareas/);
});
test('actual registered aliases delegate actor/pool/validated input through one shared factory',async()=>{
  const start=source.indexOf('function handleFeedbackBrowserWrite('),end=source.indexOf('router.get("/usuarios"',start);
  assert.ok(start>0&&end>start);const routes=new Map(),pool={},calls=[],notifications=[];
  const router=Object.fromEntries(['post','patch','delete'].map(method=>[method,(path,fn)=>routes.set(`${method} ${path}`,fn)]));
  const service=async(actualPool,auth,body,query)=>{
    assert.equal(actualPool,pool);const normalized=normalizeFeedbackBrowserOperation(body);calls.push({auth,body:normalized,query});
    const note={id:8,titulo:'Feedback',updated_at:version,feedback:{flujo:'feedback'}},operation={request_id:body.request_id,action:body.action,note_id:8,replayed:false};
    return{status:body.action==='create'?201:200,body:{version:1,note,operation}};
  };
  Function('router','pool','feedbackBrowserAliasInput','feedbackBrowserAliasBody','applyFeedbackBrowserOperation','notificarFeedbackSinInterrumpir',source.slice(start,end))(
    router,pool,feedbackBrowserAliasInput,feedbackBrowserAliasBody,service,value=>notifications.push(value));
  for(const [route,action,query] of [['post /notas','create',{}],['patch /notas/:id','edit',{}],['delete /notas/:id','trash',{}],['delete /notas/:id','purge',{permanente:'true'}],['post /notas/:id/restaurar','restore',{}]]){
    const auth={id:91004,rol:'diseno',session_version:1},request_id=randomUUID(),body={request_id,...(action==='create'?{}:{expected_updated_at:version}),...(['create','edit'].includes(action)?{contenido:'Texto'}:{})};
    const res={status(code){this.code=code;return this;},set(){return this;},json(value){this.body=value;return this;}};
    await routes.get(route)({auth,params:{id:'8'},query,body},res,error=>{throw error;});
    assert.equal(res.code,action==='create'?201:200);assert.equal(res.body.operation.action,action);
    assert.equal(calls.at(-1).auth,auth);assert.equal(calls.at(-1).body.request_id,request_id);assert.deepEqual(calls.at(-1).query,{});
  }
  assert.equal(notifications.length,0,'The service owns atomic enqueue; routes must never schedule a second post-response notification');
});
test('editing another author carries exact version and has no author restriction in alias',()=>{
  const actual=validate('edit',{request_id:randomUUID(),contenido:'Actualizado',expected_updated_at:version});
  assert.equal(actual.note_id,8);assert.equal(actual.expected_updated_at,version);assert.deepEqual(actual.fields,{contenido:'Actualizado'});
  assert.throws(()=>validate('edit',{request_id:randomUUID(),contenido:'blind'}),{status:428});
});
test('legacy content-only PATCH leaves metadata untouched and requires a UUID',()=>{
  const actual=validate('edit',{request_id:randomUUID(),expected_updated_at:version,titulo:'Título anterior'});
  assert.deepEqual(actual.fields,{titulo:'Título anterior'});
  assert.throws(()=>validate('edit',{expected_updated_at:version,titulo:'No receipt'}),{status:428});
});
test('intentionally stale observed version passes through unchanged for canonical service conflict checks',()=>{
  const stale='2000-01-01T00:00:00.000Z';
  assert.equal(validate('edit',{request_id:randomUUID(),expected_updated_at:stale,contenido:'Texto'}).expected_updated_at,stale);
});
test('invalid metadata rejected by actual service validator before a pool lease',()=>{
  assert.throws(()=>validate('create',{request_id:randomUUID(),feedback:[]}),{status:400});
});
test('all browser create/edit aliases reject provenance at root and nested before SQL',()=>{
  for(const action of ['create','edit'])for(const key of ['origen','confirmado_por','confirmado_por_id','confirmado_at','provenance_version','wilson_idempotency_key']){
    const common={request_id:randomUUID(),...(action==='edit'?{expected_updated_at:version}:{})};
    for(const forged of [{[key]:'forged'},{feedback:{[key]:null}}])assert.throws(()=>validate(action,{...common,...forged}),{status:400});
  }
});
test('metadata adapter sends only supplied business patch; shared service owns provenance-preserving merge',()=>{
  const actual=validate('edit',{request_id:randomUUID(),expected_updated_at:version,feedback:{cliente:'QA client',estado:'resuelto'}});
  assert.deepEqual(actual.fields.feedback,{cliente:'QA client',estado:'resuelto'});
  const service=fs.readFileSync(new URL('../src/feedback-browser-write.js',import.meta.url),'utf8');
  assert.match(service,/feedback=COALESCE\(feedback,'\{\}'::jsonb\)\|\|/);
});
test('trash/restore/purge bind same mandatory observation and alias ACK keeps operation',()=>{
  for(const [action,query,expected] of [['trash',{},'trash'],['trash',{permanente:'true'},'purge'],['restore',{},'restore']]){
    const actual=validate(action,{request_id:randomUUID(),expected_updated_at:version},query);
    assert.equal(actual.action,expected);assert.equal(actual.note_id,8);assert.equal(actual.expected_updated_at,version);
    assert.throws(()=>validate(action,{request_id:randomUUID()},query),{status:428});
    const operation={...actual,note_updated_at:version,replayed:false},note=expected==='purge'?null:{id:8,updated_at:version};
    const ack=feedbackBrowserAliasBody({status:200,body:{version:1,note,operation}});
    assert.equal(ack.operation,operation);if(expected==='restore')assert.equal(ack.id,8);else assert.equal(ack.ok,true);
  }
});
test('new feedback count retains last-seen timestamp and excludes deleted notes',async()=>{
  const start=source.indexOf('router.get("/notas/nuevas"'),end=source.indexOf('\n});',start)+4;
  assert.ok(start>=0&&end>start);let handler;const calls=[];
  Function('router','pool',source.slice(start,end))({get:(_path,fn)=>{handler=fn;}},{query:async(sql,params)=>{calls.push({sql,params});return{rows:[{cantidad:2}]};}});
  const res={status(){return this;},json(value){this.body=value;return this;}};
  await handler({query:{desde:'2026-09-20T12:00:00.000Z'}},res,error=>{throw error;});
  assert.equal(res.body.cantidad,2);assert.match(calls[0].sql,/created_at > \$1/);assert.match(calls[0].sql,/eliminado_at IS NULL/);
});
