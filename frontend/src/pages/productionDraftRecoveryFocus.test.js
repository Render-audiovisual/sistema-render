import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreProductionDraftRecoveryFocus} from './productionDraftRecoveryFocus.js';
function fixture(){
  const body={},document={body,activeElement:body,querySelector:()=>null};
  const control=()=>({isConnected:true,tabIndex:0,disabled:false,matches:()=>false,closest:()=>null,getClientRects:()=>[{}],focus(){document.activeElement=this;}});
  const input=control(),invoker=control(),form={isConnected:true,ownerDocument:document,querySelectorAll:()=>[input]};
  return{document,input,invoker,form};
}
test('successful read restores an available field when the discarded form action disappeared',()=>{
  const f=fixture();f.invoker.isConnected=false;
  assert.equal(restoreProductionDraftRecoveryFocus(true,f),true);assert.equal(f.document.activeElement,f.input);
});
test('failed read restores its recovery action and never treats cancellation as a completed read',()=>{
  const f=fixture();assert.equal(restoreProductionDraftRecoveryFocus(false,f),true);assert.equal(f.document.activeElement,f.invoker);
  for(const result of [undefined,null,'true',1]){const g=fixture();assert.equal(restoreProductionDraftRecoveryFocus(result,g),false);assert.equal(g.document.activeElement,g.document.body);}
});
test('retired form, new dialog or later user focus prevents an unsolicited focus transfer',()=>{
  for(const change of [f=>{f.form.isConnected=false;},f=>{f.document.querySelector=()=>({});},f=>{f.document.activeElement={};}]){
    const f=fixture();change(f);const before=f.document.activeElement;assert.equal(restoreProductionDraftRecoveryFocus(true,f),false);assert.equal(f.document.activeElement,before);
  }
});
test('hidden, disabled, inert and unfocusable controls are skipped and focus errors do not escape',()=>{
  for(const change of [f=>{f.input.disabled=true;},f=>{f.input.tabIndex=-1;},f=>{f.input.closest=()=>({});},f=>{f.input.getClientRects=()=>[];},f=>{f.input.matches=()=>true;}]){
    const f=fixture();change(f);f.invoker.isConnected=false;assert.equal(restoreProductionDraftRecoveryFocus(true,f),false);
  }
  const f=fixture();f.input.focus=()=>{throw new Error('unavailable');};assert.equal(restoreProductionDraftRecoveryFocus(true,f),false);
});
