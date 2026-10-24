import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {restoreProjectFormFocus} from './projectFormReturnFocus.js';
function fixture(extra={}) {
 const queries=[],doc={activeElement:null,querySelector(selector){queries.push(selector);return node;}};
 const node={isConnected:true,disabled:false,closest:()=>null,getClientRects:()=>[{}],focus(){doc.activeElement=node;},...extra};
 return {doc,node,queries};
}
test('each editor returns to an existing related section action without new tab stops',()=>{
 for(const [kind,text] of [['create','.pr-page-heading'],['project','.pr-detail-header'],['archive','.pr-detail-header'],['order','pr-stages-title'],['stage-create','pr-stages-title'],['stage-edit','pr-stages-title'],['milestone-create','pr-milestones-title'],['deliverable-approve','pr-deliverables-title'],['deliverable-edit','pr-deliverables-title'],['task-link','pr-tasks-title'],['task-unlink','pr-tasks-title']]){
  const h=fixture();assert.equal(restoreProjectFormFocus({kind,scope:{current:()=>true}},h.doc),true);assert.ok(h.queries[0].includes(text));assert.equal(h.doc.activeElement,h.node);
 }
});
test('obsolete session/selection and unsupported kind never inspect another view',()=>{
 for(const pending of [null,{kind:'stage-edit',scope:{current:()=>false}},{kind:'unknown',scope:{current:()=>true}},{kind:'create',scope:{current(){throw Error('ended');}}}]){
  const h=fixture();assert.equal(restoreProjectFormFocus(pending,h.doc),false);assert.deepEqual(h.queries,[]);
 }
});
test('disconnected, hidden, inert, disabled or removed controls are not focused',()=>{
 for(const extra of [{isConnected:false},{disabled:true},{closest:()=>({})},{getClientRects:()=>[]}]){
  const h=fixture(extra);assert.equal(restoreProjectFormFocus({kind:'create',scope:{current:()=>true}},h.doc),false);assert.equal(h.doc.activeElement,null);
 }
 assert.equal(restoreProjectFormFocus({kind:'create',scope:{current:()=>true}},{querySelector:()=>null}),false);
});
test('scope withdrawn during DOM lookup cannot focus a replacement control',()=>{
 const h=fixture();let calls=0;
 assert.equal(restoreProjectFormFocus({kind:'stage-edit',scope:{current:()=>++calls===1}},h.doc),false);assert.equal(h.doc.activeElement,null);
});
test('actual passive callback consumes cancellation only after editor removal and clears obsolete requests',()=>{
 const source=readFileSync(new URL('./Projects.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('Projects.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);let callback;
 function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(file)==='useEffect'&&n.arguments[0]?.getText(file).includes('restoreProjectFormFocus(pending, document)'))callback=n.arguments[0];ts.forEachChild(n,walk);}walk(file);assert.ok(callback);
 for(const form of [null,{kind:'stage-create'}]){
  const h=fixture(),pending={kind:'create',scope:{current:()=>true}},ref={current:pending};
  Function('form','formReturnFocus','restoreProjectFormFocus','document',`return (${callback.getText(file)})();`)(form,ref,restoreProjectFormFocus,h.doc);
  assert.equal(ref.current,null);assert.equal(h.doc.activeElement,form?null:h.node);
 }
});
