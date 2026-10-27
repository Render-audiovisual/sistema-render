import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,chmod,rm,access} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';
import {parseReleasePreparationArgs,runReleasePreparationCli} from '../scripts/prepare-hostinger-release.js';
const h='a'.repeat(64),commit='b'.repeat(40);
function input(){return{version:1,action:'prepare',artifact:{manifestHash:h,sourceCommit:commit},sql:[],
  observation:{identity:{database:'qa',username:'qa',address:'127.0.0.1',port:55995},snapshotHash:h,currentSourceCommit:commit},
  assignmentPlanHash:h,configReport:{status:'unknown',sha256:null},backup:{status:'missing',sha256:null,snapshotHash:null},
  authority:{status:'missing',evidenceHash:null,scopeHash:null},maintenance:[]};}
test('help and invalid commands never accept deployment or target/env overrides',async()=>{
  const lines=[];assert.equal(await runReleasePreparationCli({argv:[],write:v=>lines.push(v)}),0);assert.match(lines[0],/No existe apply/);
  for(const args of [['apply'],['deploy'],['prepare','--input','relative','--output','/tmp/out'],
    ['prepare','--input','/tmp/in','--output','/tmp/out','--force','true'],['config','--database','production']])assert.throws(()=>parseReleasePreparationArgs(args));
});
test('offline CLI prepares and checks private metadata, rejects stale or forged plans and never overwrites',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'render-preparation-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'input.json'),plan=path.join(root,'plan.json'),checked=path.join(root,'checked.json');
  await writeFile(file,JSON.stringify(input()),{mode:0o600});
  const lines=[],errors=[];const run=argv=>runReleasePreparationCli({argv,write:x=>lines.push(x),writeError:x=>errors.push(x)});
  assert.equal(await run(['prepare','--input',file,'--output',plan]),0);
  const prepared=JSON.parse(await readFile(plan,'utf8'));assert.equal(prepared.authorized,false);assert.equal(prepared.executable,false);
  assert.equal((await stat(plan)).mode&0o077,0);
  assert.equal(await run(['check','--input',file,'--plan',plan,'--output',checked]),0);
  assert.equal(JSON.parse(await readFile(checked,'utf8')).state,'NOT_EXECUTABLE');
  const before=await readFile(plan,'utf8');assert.equal(await run(['prepare','--input',file,'--output',plan]),1);assert.equal(await readFile(plan,'utf8'),before);
  const changed=input();changed.observation.snapshotHash='c'.repeat(64);await writeFile(file,JSON.stringify(changed));
  const stale=path.join(root,'stale.json');assert.equal(await run(['check','--input',file,'--plan',plan,'--output',stale]),1);await assert.rejects(access(stale));
  const forged={...prepared,authorized:true};await writeFile(plan,JSON.stringify(forged));
  assert.equal(await run(['check','--input',file,'--plan',plan,'--output',stale]),1);await assert.rejects(access(stale));
  assert.ok(lines.every(x=>!x.includes('postgresql://')));
});
test('unsafe file permissions and secret parse errors are redacted; invalid config report is private and blocked',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'render-preparation-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'input.json'),out=path.join(root,'report.json'),lines=[];
  const run=argv=>runReleasePreparationCli({argv,write:x=>lines.push(x),writeError:x=>lines.push(x)});
  await writeFile(file,'{"SECRET_PASSWORD malformed}',{mode:0o600});
  assert.equal(await run(['prepare','--input',file,'--output',out]),1);assert.doesNotMatch(lines.join(''),/SECRET_PASSWORD/);await assert.rejects(access(out));
  await writeFile(file,JSON.stringify(input()));await chmod(file,0o644);
  assert.equal(await run(['prepare','--input',file,'--output',out]),1);await assert.rejects(access(out));
  await chmod(file,0o600);await writeFile(file,JSON.stringify({env:{JWT_SECRET:'SECRET_PASSWORD'},nodeVersion:'24.1.0'}));
  assert.equal(await run(['config','--input',file,'--output',out]),2);
  const report=await readFile(out,'utf8');assert.doesNotMatch(report,/SECRET_PASSWORD/);assert.doesNotMatch(lines.join(''),/SECRET_PASSWORD/);
  assert.equal(JSON.parse(report).releaseApproved,false);
});
