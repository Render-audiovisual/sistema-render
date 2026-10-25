import test from 'node:test';
import assert from 'node:assert/strict';
import {apiJson,apiSubtasks} from './render-os-api.js';
import {BrowserSessionError} from '../../../shared/session/browser-api-fetch.js';

const readers=[
  {name:'apiJson',url:'/api/tareas/7/comentarios?workspace=render_os',read:options=>apiJson('/api/tareas/7/comentarios?workspace=render_os',options)},
  {name:'apiSubtasks',url:'/api/tareas/7/subtareas?workspace=render_os',read:options=>apiSubtasks(7,options)},
];
// Each case owns/restores its global stub; no browser, HTTP server or providers.
async function fixture(reader,response,run){
  const original=globalThis.fetch,calls=[],controller=new AbortController();
  const options={signal:controller.signal,cache:'no-store',headers:{'x-qa-collection':'synthetic'}};
  globalThis.fetch=async(url,passed)=>{calls.push({url,passed});if(response instanceof Error)throw response;return response;};
  try{await run(()=>reader.read(options));}
  finally{
    globalThis.fetch=original;
    assert.equal(calls.length,1,'A collection read makes one attempt, never a retry');
    assert.equal(calls[0].url,reader.url);assert.equal(calls[0].passed,options);
  }
}
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});

for(const reader of readers){
  test(`${reader.name} returns the exact successful array, including intentional empty collection`,async()=>{
    for(const rows of [[],[{id:8,revision:1,tarea_padre_id:7,titulo:'QA collection',estado:'pendiente',actor_usuario_id:null}]]){
      await fixture(reader,json(rows),async read=>{assert.equal(await read(),rows);});
    }
  });
  test(`${reader.name} rejects malformed successful JSON and every non-array shape rather than reporting empty`,async()=>{
    for(const body of [{}, {items:[]},null,'[]','',false,0,123,undefined]){
      await fixture(reader,json(body),async read=>{await assert.rejects(read(),error=>error instanceof Error&&Boolean(error.message));});
    }
    const response={ok:true,status:200,json:async()=>{throw new SyntaxError('Synthetic malformed JSON');}};
    await fixture(reader,response,async read=>{await assert.rejects(read(),error=>error instanceof Error&&Boolean(error.message));});
  });
  test(`${reader.name} preserves non-2xx status, safe domain code and server message`,async()=>{
    for(const status of [400,401,403,404,409,500,503]){
      await fixture(reader,json({error:'QA collection unavailable',code:'collection_changed'},status),async read=>{
        await assert.rejects(read(),error=>error.status===status&&error.message==='QA collection unavailable'&&error.code==='collection_changed');
      });
    }
    for(const status of [401,503]){
      await fixture(reader,{ok:false,status,json:async()=>{throw new SyntaxError('Synthetic invalid error JSON');}},async read=>{
        await assert.rejects(read(),error=>error.status===status&&error.message==='No se pudo completar la operación.');
      });
    }
  });
  test(`${reader.name} preserves typed session failures and network/abort identity without fallback or retries`,async()=>{
    const errors=[new BrowserSessionError('browser_intent_obsolete'),
      Object.assign(new Error('Synthetic retired binding'),{code:'session_binding_obsolete'}),
      Object.assign(new Error('Synthetic application retirement'),{name:'ApplicationSessionError'})];
    for(const error of errors){
      for(const status of [200,401])await fixture(reader,{ok:status===200,status,json:async()=>{throw error;}},async read=>{
        await assert.rejects(read(),reason=>reason===error);
      });
    }
    for(const error of [new TypeError('Synthetic offline'),new DOMException('Synthetic aborted','AbortError')]){
      await fixture(reader,error,async read=>{await assert.rejects(read(),reason=>reason===error);});
    }
  });
}
