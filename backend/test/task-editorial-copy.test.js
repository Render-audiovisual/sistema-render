import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getUnifiedTaskContent,getCanonicalTaskContentMetadata,isLinkedProductionEditorialTask} from '../../frontend/src/features/render-os/utils/task-content.js';
import {canonicalTaskState} from '../../frontend/src/features/render-os/constants.js';
import {createCapturedRequest,isSessionFailure} from '../../frontend/src/shared/session/captured-request.js';
const session={token:'synthetic-editorial',usuario:{id:1,rol:'admin',activo:true}};

const source=readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const task={id:10,publicacion_id:101,titulo:'Linked editing',estado:'pendiente',aclaraciones:'Brief',
  propiedades_extra:{origen_produccion_video_id:'11111111-1111-4111-8111-111111111111',guiones:'Original script',copy_trabajo:'Editorial copy must survive'}};

test('only positive actual publication ID and UUID video lineage enable editorial-copy separation',()=>{
  assert.equal(isLinkedProductionEditorialTask(task),true);
  for(const publicacion_id of [undefined,null,'101',0,-1,1.5,Infinity,NaN]) assert.equal(isLinkedProductionEditorialTask({...task,publicacion_id}),false);
  for(const id of [undefined,null,'123','fake-video-id',1,{},'']) assert.equal(isLinkedProductionEditorialTask({...task,propiedades_extra:{...task.propiedades_extra,origen_produccion_video_id:id}}),false);
  assert.equal(isLinkedProductionEditorialTask({publicacion_id:101,propiedades_extra:{produccion_visita_id:task.propiedades_extra.origen_produccion_video_id}}),false);
});
test('linked content combines brief/script once and excludes copy; unrelated tasks retain old behavior',()=>{
  assert.equal(getUnifiedTaskContent(task),'Brief\n\nOriginal script');
  assert.equal(getUnifiedTaskContent({...task,aclaraciones:'Brief\n\nOriginal script'}),'Brief\n\nOriginal script');
  assert.equal(getUnifiedTaskContent({...task,publicacion_id:null}),'Brief\n\nOriginal script\n\nEditorial copy must survive');
  assert.equal(getUnifiedTaskContent({...task,propiedades_extra:{...task.propiedades_extra,origen_produccion_video_id:'invalid'}}),'Brief\n\nOriginal script\n\nEditorial copy must survive');
});
test('canonical metadata option omits copy key altogether, even when explicitly present in input',()=>{
  const metadata=Object.freeze({...task.propiedades_extra,resumen:'Summary'});
  const preserved=getCanonicalTaskContentMetadata(metadata,{preserveEditorialCopy:true});
  assert.equal(Object.hasOwn(preserved,'copy_trabajo'),false);
  assert.equal(preserved.guiones,'');assert.equal(preserved.resumen,'Summary');
  assert.equal(metadata.copy_trabajo,'Editorial copy must survive');
  assert.equal(getCanonicalTaskContentMetadata(metadata).copy_trabajo,'');
});

const saveBody=source.slice(source.indexOf('  const save = async'),source.indexOf('  const saveInlineField ='));
async function save(original,changes) {
  const writes=[];const draft={...original,aclaraciones:getUnifiedTaskContent(original),...changes};
  const context={task:original,draft,metadata:original.propiedades_extra || {},tags:[],collaborators:[],
    captureRequest:request=>createCapturedRequest({session,readSession:()=>session,request}),isSessionFailure,
    canEditTask:true,canEditVisitClient:false,canEditVisitDate:true,isProductionVisit:false,productionProgress:{},
    isLinkedProductionEditorialTask,getCanonicalTaskContentMetadata,canonicalTaskState,
    setSaving:()=>{},setEditing:()=>{},onUpdate:async(id,payload)=>writes.push(payload)};
  const run=new Function(...Object.keys(context),`${saveBody}\nreturn save;`)(...Object.values(context));
  await run();return writes;
}
test('real drawer save omits copy, clears old script, and preserves editorial copy under server merge',async()=>{
  const [payload]=await save(task,{aclaraciones:'Brief\n\nEdited script'});
  assert.equal(payload.aclaraciones,'Brief\n\nEdited script');
  assert.equal(payload.propiedades_extra.guiones,'');
  assert.equal(Object.hasOwn(payload.propiedades_extra,'copy_trabajo'),false);
  const merged={...task,...payload,propiedades_extra:{...task.propiedades_extra,...payload.propiedades_extra}};
  assert.equal(merged.propiedades_extra.copy_trabajo,task.propiedades_extra.copy_trabajo);
  assert.equal(getUnifiedTaskContent(merged),'Brief\n\nEdited script');
  assert.deepEqual(await save(merged,{}),[],'reopen/resave does not duplicate content or clear copy again');
  const [second]=await save(merged,{aclaraciones:'Second edit'});
  assert.equal(Object.hasOwn(second,'propiedades_extra'),false,'copy difference alone cannot cause metadata writes');
});
test('saving untouched unified script migrates guiones into aclaraciones exactly once',async()=>{
  const [payload]=await save(task,{});
  assert.equal(payload.aclaraciones,'Brief\n\nOriginal script');assert.equal(payload.propiedades_extra.guiones,'');
  const next={...task,...payload,propiedades_extra:{...task.propiedades_extra,...payload.propiedades_extra}};
  assert.equal(getUnifiedTaskContent(next),'Brief\n\nOriginal script');
  assert.equal(next.propiedades_extra.copy_trabajo,'Editorial copy must survive');
  assert.deepEqual(await save(next,{}),[]);
});
test('linked task with only copy has an empty script editor, never copies editorial text into script',()=>{
  assert.equal(getUnifiedTaskContent({...task,aclaraciones:null,propiedades_extra:{...task.propiedades_extra,guiones:''}}),'');
});
test('editorial copy is read-only actual metadata with an honest fallback, and copy templates are excluded only for linked tasks',()=>{
  const component=source.slice(source.indexOf('function TaskContentWorkspace'),source.indexOf('function taskProductionRegistryState'));
  assert.match(component,/typeof metadata.copy_trabajo === "string"/);
  assert.match(component,/preserveEditorialCopy && <aside aria-label="Copy editorial"/);
  assert.match(component,/editorialCopy.trim\(\) \?/);
  assert.match(component,/renderizarTextoTarea\(editorialCopy\)/);
  assert.match(component,/El copy editorial se gestiona en la pieza vinculada/);
  assert.match(component,/!preserveEditorialCopy \|\| type.id !== "copy"/);
  assert.doesNotMatch(component,/setDraft\([^\n]*copy_trabajo|value=\{editorialCopy\}/);
});
