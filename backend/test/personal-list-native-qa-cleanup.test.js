import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from '../../frontend/node_modules/typescript/lib/typescript.js';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Only parse/evaluate the existing finish callback. Never import the executable
// runner, fork a child, allocate a directory, start HTTP or touch PostgreSQL.
const filename=fileURLToPath(new URL('../scripts/render2-personal-list-native-qa.js',import.meta.url));
const source=readFileSync(filename,'utf8');
const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length,0);
const callbacks=[];
function walk(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='finish')callbacks.push(node.initializer);
  ts.forEachChild(node,walk);
}
walk(ast);assert.equal(callbacks.length,1,'Extract exactly the real runner finish callback');
const callbackText=callbacks[0].getText(ast);

test('manual native QA refuses missing opt-in and target arguments before starting any fixture',()=>{
  for(const args of [[],['--database=production']]) {
    const result=spawnSync(process.execPath,[filename,...args],{encoding:'utf8',timeout:5000,
      env:{PATH:process.env.PATH,NODE_ENV:'test',DOTENV_CONFIG_PATH:'/dev/null'}});
    assert.equal(result.status,2);assert.match(result.stderr,/Explicit integration opt-in required/);
    assert.equal(result.stdout,'');
  }
});

function fixture({connected=true,sendThrows=false,exitCode=0,alreadyExited=false}={}){
  const events=[],output=[],timers=new Set();
  const fakeProcess={exitCode:undefined,stdin:{pause(){events.push('stdin.pause');}}};
  const f={root:'/synthetic/no-files-used',async cleanup(){events.push('fixture.cleanup');}};
  const access=async()=>{events.push('access');throw Object.assign(new Error('Synthetic cleanup absence'),{code:'ENOENT'});};
  const input={close(){events.push('input.close');}};
  const console={log(...args){output.push(['log',...args]);},error(...args){output.push(['error',...args]);}};
  const setTimeout=()=>{const handle={};timers.add(handle);return handle;};
  const clearTimeout=handle=>timers.delete(handle);
  const instantiate=new Function('assert','f','access','input','process','console','setTimeout','clearTimeout','events','options',`
    let closed=false,timer=null,blockChecked=true;
    let exitInfo=options.alreadyExited?{code:options.exitCode,signal:null}:undefined;
    let resolveExit;
    const exited=options.alreadyExited?Promise.resolve():new Promise(resolve=>{resolveExit=resolve;});
    function completeExit(){exitInfo={code:options.exitCode,signal:null};resolveExit?.();}
    const child={connected:options.connected,
      send(message){events.push(['child.send',message.type]);
        if(options.sendThrows)throw new Error('Synthetic IPC send failure');completeExit();},
      kill(signal){events.push(['child.kill',signal]);completeExit();return true;}};
    const checkBlock=async()=>{events.push('checkBlock');};
    const finish=(${callbackText});
    return {finish,getClosed:()=>closed};
  `);
  const instance=instantiate(assert,f,access,input,fakeProcess,console,setTimeout,clearTimeout,events,
    {connected,sendThrows,exitCode,alreadyExited});
  return {...instance,events,output,process:fakeProcess,timers};
}
async function settle(f,abort){
  try{await f.finish(abort);return null;}catch(error){return error;}
}
function assertCleanup(f){
  assert.equal(f.events.filter(event=>event==='fixture.cleanup').length,1,'Owned fixture cleanup must run exactly once despite child-stop failures');
  assert.equal(f.events.filter(event=>event==='access').length,1,'ENOENT absence must be checked after cleanup');
}
const accepted=f=>f.output.some(row=>row[0]==='log'&&row[1]==='QA402_FINAL_OK');
const failed=f=>f.output.some(row=>row[0]==='error'&&row[1]==='QA402_FINAL_FAILED');

test('closed IPC uses SIGTERM instead of send and still cleans owned fixture on abort',async()=>{
  const f=fixture({connected:false,sendThrows:true});
  await settle(f,true);
  assertCleanup(f);
  assert.equal(f.events.some(event=>Array.isArray(event)&&event[0]==='child.send'),false);
  assert.ok(f.events.some(event=>Array.isArray(event)&&event[0]==='child.kill'&&event[1]==='SIGTERM'));
  assert.equal(accepted(f),false);
});

test('connected send throws: nested finally still cleans own fixture and checks ENOENT',async()=>{
  const f=fixture({sendThrows:true});
  await settle(f,true);
  assertCleanup(f);assert.equal(accepted(f),false);
  assert.ok(f.events.some(event=>Array.isArray(event)&&event[0]==='child.send'));
});

for(const alreadyExited of [false,true])test(`nonzero child exit cannot pass normal acceptance; alreadyExited=${alreadyExited}`,async()=>{
  const f=fixture({exitCode:7,alreadyExited});
  const error=await settle(f,false);
  assertCleanup(f);
  assert.equal(accepted(f),false,'Never print FINAL_OK for a failed/forced child exit');
  assert.ok(error||f.process.exitCode===1||failed(f),'Nonzero exit must be surfaced as failure');
});

test('normal connected child exit0 accepts only after clean stop and cleans exactly once',async()=>{
  const f=fixture();const error=await settle(f,false);
  assert.equal(error,null);assertCleanup(f);assert.equal(accepted(f),true);
  assert.ok(f.events.some(event=>Array.isArray(event)&&event[0]==='child.send'));
  assert.equal(f.process.exitCode,undefined);
  await f.finish(false);assertCleanup(f);
});
