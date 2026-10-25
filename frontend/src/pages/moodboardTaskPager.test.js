import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createMoodboardTaskPager, mergeMoodboardTasks } from './moodboardTaskPager.js';

const initial=Array.from({length:150},(_,i)=>({id:i+1,titulo:`Task ${i+1}`}));
function fixture() {
  let active=true;const calls=[],states=[];
  const scope={current:()=>active,request:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))};
  const model=createMoodboardTaskPager({boardId:9,initial,capture:()=>scope,onChange:()=>states.push(model.snapshot)});
  return {model,calls,states,retire(){active=false;}};
}
const page=(items,next_offset=null)=>({version:1,items,limit:150,offset:150,next_offset});
test('explicit next page reaches task152, deduplicates click and never mutates linked selections',async()=>{
  const f=fixture(),first=f.model.loadMore();await f.model.loadMore();assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'/api/moodboards/boards/9/tasks?limit=150&offset=150');
  assert.equal(f.calls[0].options.method,undefined,'Read only');
  f.calls[0].resolve(page([{id:151,titulo:'Last shared'},{id:152,titulo:'Last private authorized'}]));await first;
  assert.equal(f.model.snapshot.items.length,152);assert.equal(f.model.snapshot.nextOffset,null);
  await f.model.loadMore();assert.equal(f.calls.length,1);
  assert.equal(initial.length,150);
});
test('error preserves pages and retry is manual; malformed cursor never advances',async()=>{
  const f=fixture(),read=f.model.loadMore();f.calls[0].resolve(page([{id:151,titulo:'Bad continuation'}],151));await read;
  assert.match(f.model.snapshot.error,/No se pudieron/);assert.equal(f.model.snapshot.items.length,150);
  assert.equal(f.calls.length,1);const retry=f.model.loadMore();assert.equal(f.calls.length,2);
  f.calls[1].resolve(page([{id:151,titulo:'Recovered'}]));await retry;assert.equal(f.model.snapshot.error,'');
});
for(const change of ['retire','cancel'])test(`late read cannot publish after ${change}`,async()=>{
  const f=fixture(),read=f.model.loadMore(),before=f.states.length;
  if(change==='retire')f.retire();else f.model.cancel();
  f.calls[0].resolve(page([{id:151,titulo:'Obsolete'}]));await read;
  assert.equal(f.model.snapshot.items.length,150);assert.equal(f.states.length,before);
});
test('already linked task outside page remains visible without creating a toggle/write',()=>{
  const linked=[{id:152,titulo:'Linked last'}];const rows=mergeMoodboardTasks(initial,linked,linked);
  assert.equal(rows.length,151);assert.equal(rows.at(-1).id,152);assert.equal(initial.length,150);
});
test('canonical reference panel uses pager and preserves the ID-based link writer',()=>{
  const source=readFileSync(new URL('./MoodboardPreview.jsx',import.meta.url),'utf8');
  assert.match(source,/<MoodboardTaskPicker boardId=\{boardId\} tasks=\{tasks\} linkedTasks=\{item.tareas\}/);
  assert.match(source,/model.change\(task.id,!isLinked\(task.id\)\)/);
});
test('actual picker renders an off-page linked task checked and retains write locks',()=>{
  const source=readFileSync(new URL('./MoodboardTaskPicker.jsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('picker.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='MoodboardTaskPicker');
  const code=ts.transpileModule(`const Component=(${fn.getText(ast).replace(/^export\s+/,'')});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  const Component=new Function('React','useEffect','useLayoutEffect','useRef','useState','createMoodboardTaskPager','mergeMoodboardTasks',`${code};return Component;`)
    (React,React.useEffect,React.useLayoutEffect,React.useRef,React.useState,createMoodboardTaskPager,mergeMoodboardTasks);
  const html=renderToStaticMarkup(React.createElement(Component,{boardId:9,tasks:initial,linkedTasks:[{id:152,titulo:'Off-page linked'}],
    capture:()=>assert.fail('No request during render'),disabled:true,isLinked:id=>id===152,toggle:()=>assert.fail('No writer during render')}));
  const inputs=[...html.matchAll(/<input[^>]*>/g)].map(match=>match[0]);
  assert.equal(inputs.length,151);assert.equal(inputs.filter(input=>input.includes('checked=')).length,1);
  assert.ok(inputs.every(input=>input.includes('disabled=')));assert.match(html,/Off-page linked/);
  assert.match(html,/Cargar más tareas/);
  assert.match(source,/holder.current.tasks !== tasks/);
  assert.doesNotMatch(source,/holder.current.capture !== capture/);
});
