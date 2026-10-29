import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/run-scheduled-automations.js',import.meta.url));
const invoke=(args,extra={})=>spawnSync(process.execPath,[script,...args],{
  env:{PATH:process.env.PATH,...extra},encoding:'utf8',timeout:10000,
});
test('help is inert with no database configuration',()=>{
  const result=invoke(['--help']);assert.equal(result.status,0);assert.match(result.stdout,/Uso:/);assert.equal(result.stderr,'');
});
test('maintenance invocation is inert even with malformed private target',()=>{
  const result=invoke(['run'],{RENDER_MAINTENANCE:'true',DATABASE_URL:'private-invalid-target'});
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{state:'PAUSED',jobs:[]});
  assert.equal(result.stderr,'');
});
for(const args of [[],['--force'],['run','--force'],['run','--database-url=private']]){
  test(`CLI refuses unsupported argument shape ${args.length}`,()=>{
    const result=invoke(args);assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.equal(result.stderr,'No se pudo completar la automatización programada.\n');
  });
}
test('unconfigured invocation cannot select a default database',()=>{
  const result=invoke(['run']);assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.equal(result.stderr,'No se pudo completar la automatización programada.\n');
});
