import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';

const source=readFileSync(new URL('../components/Modal.jsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source.replace(/^import .*;\s*$/gm,'').replace('export function Modal','function Modal'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(disabled=false){
  const effects=[],calls=[],previous={focus:()=>calls.push('return'),isConnected:true};
  const dialog={open:false,showModal(){this.open=true;calls.push('show');},close(){this.open=false;calls.push('close');}};
  const close={focus:()=>calls.push('focus')};
  const refs=[{current:close},{current:null},{current:dialog},{current:null}];let i=0;
  const Modal=Function('React','useEffect','useRef','document','window',compiled+';return Modal;')(React,fn=>effects.push(fn),()=>refs[i++],{activeElement:previous},{});
  const node=Modal({native:true,onClose:()=>calls.push('request'),closeDisabled:disabled,overlayClassName:'rf-panel-backdrop',headerClassName:'rf-panel-header'});
  return {node,calls,effects,dialog};
}
test('shared native modal opens top layer, focuses inside and restores invoker',()=>{
  const f=fixture();assert.equal(f.node.type,'dialog');assert.match(f.node.props.className,/rf-panel-backdrop/);
  const dispose=f.effects[0]();assert.deepEqual(f.calls,['show','focus']);dispose();assert.deepEqual(f.calls,['show','focus','close','return']);
});
test('native Escape delegates to existing guarded close, never closes browser dialog itself',()=>{
  for(const disabled of [false,true]){
    const f=fixture(disabled),events=[];
    f.node.props.onCancel({preventDefault:()=>events.push('prevent'),stopPropagation:()=>events.push('stop')});
    assert.deepEqual(events,['prevent','stop']);assert.deepEqual(f.calls,disabled?[]:['request']);
  }
});
test('Feedback mounts shared native dialog retaining business close and initial focus',()=>{
  const page=readFileSync(new URL('./Feedback.jsx',import.meta.url),'utf8');
  assert.match(page,/<Modal native onClose=\{closePanel\} closeDisabled=\{busy\}/);
  assert.match(page,/initialFocusRef=\{titleRef\}/);assert.match(page,/if \(!canLeave\(\)\) return;/);
  assert.doesNotMatch(page,/<section[^>]*role="dialog"/);
});
