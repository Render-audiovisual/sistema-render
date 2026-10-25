import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';

const script=fileURLToPath(new URL('../scripts/render2-shell-recovery-qa.js',import.meta.url));
function run(t,args,optIn){
  const cwd=mkdtempSync('/private/tmp/render2-shell-command-');
  t.after(()=>rmSync(cwd,{recursive:true}));
  // No inherited DB URL, PG options, credentials, .env path or opt-in flag.
  const env={PATH:'/usr/bin:/bin',NODE_ENV:'test',DOTENV_CONFIG_PATH:'/dev/null',
    ...(optIn?{RENDER2_RUN_LOCAL_INTEGRATION:'true'}:{})};
  const result=spawnSync(process.execPath,[script,...args],{cwd,env,encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,2);
  assert.equal(result.stdout,'','Rejected invocation must not print fixture readiness/startup');
  assert.deepEqual(readdirSync(cwd),[],'Rejected invocation creates no files in its working directory');
  assert.doesNotMatch(result.stderr,/Migration applied|ready|postgresql:\/\//);
  return result.stderr;
}
test('shell recovery command without explicit opt-in exits2 before provisioning, from an unrelated cwd',t=>{
  assert.equal(run(t,[],false),'Requires RENDER2_RUN_LOCAL_INTEGRATION=true; no fixture started.\n');
});
test('unknown arguments reject before provisioning even with opt-in enabled',t=>{
  assert.equal(run(t,['--unknown'],true),
    'Usage: RENDER2_RUN_LOCAL_INTEGRATION=true node backend/scripts/render2-shell-recovery-qa.js\n');
});
test('private HTTP child entry rejects a manual invocation without an IPC owner',t=>{
  assert.equal(run(t,['--http-child'],true),
    'Private fixture child requires an IPC owner; no fixture started.\n');
});
test('importing the command with opt-in set remains inert',t=>{
  const cwd=mkdtempSync('/private/tmp/render2-shell-import-');
  t.after(()=>rmSync(cwd,{recursive:true}));
  const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(script).href)});`],{
    cwd,env:{PATH:'/usr/bin:/bin',NODE_ENV:'test',DOTENV_CONFIG_PATH:'/dev/null',RENDER2_RUN_LOCAL_INTEGRATION:'true'},
    encoding:'utf8',timeout:5000,
  });
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0);
  assert.equal(result.stdout,'');assert.equal(result.stderr,'');assert.deepEqual(readdirSync(cwd),[]);
});
