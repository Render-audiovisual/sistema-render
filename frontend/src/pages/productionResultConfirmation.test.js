import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Actual component JSX and callbacks with hook/model doubles. Not a mounted
// browser, HTTP write, ACK validator or replacement for the real intent tests.
const source=readFileSync(new URL('./ProductionResultRegister.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('ProductionResultRegister.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ProductionResultRegister');
assert.ok(owner);assert.equal(ast.parseDiagnostics.length,0);
const compiled=ts.transpileModule(owner.getText(ast),{
  compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function fixture({acceptedRevision=6,visitRevision=6,registered=false}={}){
  const starts=[],effects=[],observations=[],refs=[];
  const state={status:'confirmed',busy:false,locked:false,error:'',accepted:{revision_resultante:acceptedRevision}};
  const scope={current:()=>true,assertCurrent(){}};
  const model={snapshot:state,start(input){starts.push(input);return Promise.resolve(false);},verify(){assert.fail('No implicit verify');}};
  let cursor=0,stateCursor=0,props={visit:{id:'qa400-visit',revision:visitRevision},registered,
    capture:()=>scope,onState:v=>observations.push(v),onSaved(){assert.fail('No implicit readback');}};
  const exports={};
  new Function('exports','React','useRef','useState','useEffect','createProductionResultIntent',compiled)(
    exports,React,value=>refs[cursor++]??=( {current:value} ),
    initial=>{const slot=stateCursor++;return [slot===0?state:slot===1?'':false,()=>{}];},
    effect=>effects.push(effect),()=>model,
  );
  let tree;
  const render=patch=>{props={...props,...patch};cursor=0;stateCursor=0;tree=exports.ProductionResultRegister(props);return renderToStaticMarkup(tree);};
  const buttons=()=>{
    const found=[];
    function walk(value){if(Array.isArray(value)){value.forEach(walk);return;}if(!React.isValidElement(value))return;
      if(value.type==='button')found.push(value);walk(value.props.children);}
    walk(tree);return found;
  };
  const register=()=>buttons().find(button=>button.props.children==='Registrar resultado');
  return {starts,effects,state,observations,render,register};
}
const currentMessage='Resultado registrado. Los guiones pendientes se conservan para próximas visitas.';
test('confirmed ACK at current revision keeps success and disables duplicate registration',()=>{
  const f=fixture(),html=f.render();assert.ok(html.includes(currentMessage));assert.equal(f.register().props.disabled,true);
  assert.deepEqual(f.starts,[]);
});
test('older confirmed ACK shows prior-result notice, enables explicit new registration and rerender never sends',()=>{
  const f=fixture(),initial=f.render();assert.ok(initial.includes(currentMessage));
  const updated=f.render({visit:{id:'qa400-visit',revision:7}});
  assert.equal(updated.includes(currentMessage),false,'A confirmed old intent must not imply current-version success');
  assert.match(updated,/anterior|cambi[oó]|desactualiz/i);
  assert.equal(f.register().props.disabled,false);assert.deepEqual(f.starts,[]);
  f.render();assert.deepEqual(f.starts,[],'Read-only rerenders cannot start another human intent');
});
test('ACK ahead of visible visit requests refresh, not current success or an older-result claim',()=>{
  const f=fixture({acceptedRevision:8,visitRevision:7}),html=f.render();
  assert.equal(html.includes(currentMessage),false);assert.match(html,/actualiz/i);
  assert.equal(f.register().props.disabled,true,'Existing alreadyCurrent >= guard remains unchanged');
  assert.deepEqual(f.starts,[]);
});
test('registered current evidence remains visible and disables register despite older local confirmed ACK',()=>{
  const f=fixture({visitRevision:7,registered:true}),html=f.render();
  assert.ok(html.includes('Esta versión ya tiene un resultado registrado.'));
  assert.equal(html.includes(currentMessage),false);assert.equal(f.register().props.disabled,true);
  assert.deepEqual(f.starts,[]);
});
test('explicit enabled click passes the current visible revision once; refresh alone never writes',async()=>{
  const f=fixture();f.render();f.render({visit:{id:'qa400-visit',revision:7}});
  assert.deepEqual(f.starts,[]);const button=f.register();assert.equal(button.props.disabled,false);
  button.props.onClick();assert.deepEqual(f.starts,[{id:'qa400-visit',revision:7}]);
  // Existing synchronous orchestration latch also ignores a retained duplicate.
  button.props.onClick();assert.equal(f.starts.length,1);
  await Promise.resolve();await Promise.resolve();
  assert.equal(f.starts.length,1);assert.equal(f.state.accepted.revision_resultante,6,'Presentation never rewrites the accepted receipt');
});
