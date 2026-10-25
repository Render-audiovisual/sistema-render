import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createProductionDraft,verifiedProductionDraftVisit,productionVisitDraft} from './productionDraft.js';
const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const hook=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='useProductionDraft');
const visit=revision=>({id:'qa-visit',revision,cliente_id:1,cliente_nombre:'QA',fecha:'2026-10-25',titulo:'Guardado',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]});
function fixture({read=async()=>visit(2)}={}){
  const states=[],refs=[],effects=[];let si=0,ri=0,ei=0,args,calls=0;
  const deps={createProductionDraft,verifiedProductionDraftVisit,
    useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(initial){return refs[ri++]||=( {current:initial});},
    useLayoutEffect(effect,dependencies){const i=ei++,old=effects[i];const changed=!old||!dependencies||dependencies.some((value,index)=>!Object.is(value,old.dependencies?.[index]));effects[i]={...old,effect,dependencies,changed};}};
  const useDraft=Function(...Object.keys(deps),`return (${hook.getText(ast)});`)(...Object.values(deps));
  const render=(next=visit(1))=>{si=ri=ei=0;args={visit:next,source:productionVisitDraft,key:'qa',onDirty:report,onReload:async id=>{assert.equal(id,'qa-visit');calls++;return read();}};return useDraft(args);};
  const report=()=>{};
  const commit=()=>{for(const effect of effects){if(effect.changed){effect.cleanup?.();effect.cleanup=effect.effect();effect.changed=false;}}};
  let form=render();commit();form.edit(draft=>({...draft,titulo:'Borrador'}));form=render();commit();
  return{render,commit,get calls(){return calls;},model:states[0],unmount(){for(const effect of effects)effect.cleanup?.();}};
}
test('opening or canceling shared confirmation performs no read and preserves fields',()=>{
  const f=fixture(),before=f.model.snapshot;let form=f.render();form.reload();form=f.render();
  assert.ok(form.reloadPrompt);assert.equal(f.calls,0);assert.deepEqual(f.model.snapshot,before);
  form.cancelReload();form=f.render();assert.equal(form.reloadPrompt,null);assert.deepEqual(f.model.snapshot,before);
});
test('explicit matching consent performs exactly one read, never an automatic write or duplicate reload',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});const f=fixture({read:()=>wait});let form=f.render();
  form.reload();form=f.render();const intent=form.reloadPrompt,pending=form.confirmReload(intent);
  form.confirmReload(intent);assert.equal(f.calls,1);assert.equal(f.model.snapshot.pending,true);assert.equal(f.model.snapshot.draft.titulo,'Borrador');
  release(visit(2));await pending;assert.equal(f.model.snapshot.visit.revision,2);assert.equal(f.model.snapshot.dirty,false);
});
test('edit, newer visit, unmount and an obsolete prompt cannot reuse discard consent',async()=>{
  for(const change of ['edit','ABA','visit','unmount','prompt']){
    const f=fixture();let form=f.render();form.reload();form=f.render();const intent=form.reloadPrompt;
    if(change==='edit')form.edit(draft=>({...draft,titulo:'Más nuevo'}));
    if(change==='ABA'){form.edit(draft=>({...draft,titulo:'Temporal'}));form.edit(draft=>({...draft,titulo:'Borrador'}));}
    if(change==='visit'){form=f.render(visit(2));f.commit();}
    if(change==='unmount')f.unmount();
    if(change==='prompt'){form.cancelReload();form.reload();}
    await form.confirmReload(intent);assert.equal(f.calls,0,change);assert.equal(f.model.snapshot.dirty,true);
  }
});
test('failed read preserves the draft and an unmounted consumer cannot adopt a late result',async()=>{
  const f=fixture({read:async()=>{throw new Error('offline');}});let form=f.render();form.reload();form=f.render();await form.confirmReload(form.reloadPrompt);
  assert.equal(f.calls,1);assert.equal(f.model.snapshot.draft.titulo,'Borrador');assert.equal(f.model.snapshot.blocked,true);
  let release;const wait=new Promise(resolve=>{release=resolve;}),g=fixture({read:()=>wait});form=g.render();form.reload();form=g.render();const pending=form.confirmReload(form.reloadPrompt);g.unmount();release(visit(2));assert.equal(await pending,undefined);
  assert.equal(g.model.snapshot.visit.revision,1);assert.equal(g.model.snapshot.draft.titulo,'Borrador');
});
test('recovery uses shared native dialog with safe focus defaults instead of browser confirm',()=>{
  assert.doesNotMatch(hook.getText(ast),/window\.confirm/);
  const recovery=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='DraftRecovery').getText(ast);
  assert.match(recovery,/<Modal native /);assert.match(recovery,/initialFocusRef=\{keepRef\}/);assert.match(recovery,/returnFocusRef=\{invokerRef\}/);
  assert.match(recovery,/form.confirmReload\(form.reloadPrompt\)/);assert.match(recovery,/Esta consulta no repite el envío/);
});
