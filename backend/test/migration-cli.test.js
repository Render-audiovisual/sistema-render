import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMigrationCommand, validateMigrationCliEnvironment, runMigrationCli } from '../scripts/migrate.js';

const planHash='a'.repeat(64);
const apply=['apply','--plan',planHash,'--database','fictional_local','--user','fictional_user'];
const env={DATABASE_URL:'postgresql://fictional_user:FAKE_PASSWORD@127.0.0.1:5432/fictional_local',RENDER_DB_ENVIRONMENT:'test'};
const identity={database:'fictional_local',username:'fictional_user',address:'127.0.0.1',port:5432};
class MigrationPolicyError extends Error {}
function fake(options={}) {
  const calls=[],output=[],errors=[];
  const client={async query(sql){calls.push(sql);return{rows:[]};},release(){calls.push('release');}};
  const pool={async connect(){calls.push('connect');return client;},async end(){calls.push('end');}};
  const status={ledgerExists:true,applied:['001.sql'],pending:[{name:'002.sql',sha256:'b'.repeat(64)}],unknownApplied:[]};
  const engine={
    MigrationPolicyError,
    async readMigrationIdentity(db){assert.equal(db,client);await db.query('SELECT current_database(),current_user');return options.identity??identity;},
    async readMigrationStatus(db){assert.equal(db,client);await db.query('SELECT nombre FROM public._migrations');return status;},
    buildMigrationPlan(input){calls.push({planInput:input});return options.planHash??planHash;},
    async runMigrations(receivedPool,logger,approval){calls.push({runner:approval});assert.equal(receivedPool,pool);assert.ok(calls.includes('release'));if(options.runnerError)throw options.runnerError;},
  };
  return{calls,output,errors,status,
    async run(argv=apply,config=env){return runMigrationCli({argv,env:config,loadPool:async()=>{calls.push('import-pool');return{pool};},loadEngine:async()=>{calls.push('import-engine');return engine;},write:line=>output.push(line),writeError:line=>errors.push(line)});}};
}

test('default/help do not inspect environment or import DB/engine',async()=>{
  for(const argv of [[],['help'],['--help'],['-h']]) {
    const f=fake();const poison=new Proxy({}, {get(){throw Error('Environment must remain unread');}});
    assert.equal(await f.run(argv,poison),0);assert.equal(f.calls.length,0);assert.match(f.output[0],/status/);assert.match(f.output[0],/apply/);
  }
});

test('unknown commands, missing/duplicate/extra flags and malformed plan fail before imports',async()=>{
  for(const argv of [['up'],['status','--force'],['apply'],['apply','--plan',planHash],
    [...apply,'--force'],[...apply,'--plan',planHash],apply.map(value=>value===planHash?'invalid':value),
    ['apply','--plan',planHash,'--database','fictional_local','--user']]) {
    const f=fake();assert.equal(await f.run(argv),1);assert.equal(f.calls.length,0);assert.equal(f.errors.length,1);
  }
});

test('apply rejects production, unknown config, remote/ambiguous destinations and flag mismatches before imports',async()=>{
  for(const config of [{},{...env,DATABASE_URL:''},{...env,RENDER_DB_ENVIRONMENT:'production'},
    {...env,RENDER_DB_ENVIRONMENT:'unknown'},{...env,DATABASE_URL:'http://fictional_user@localhost/fictional_local'},
    {...env,DATABASE_URL:'postgresql://fictional_user:FAKE_PASSWORD@example.invalid/fictional_local'},
    {...env,DATABASE_URL:env.DATABASE_URL+'?host=example.invalid'},
    {...env,DATABASE_URL:env.DATABASE_URL+'?options=-csearch_path=other'},
    {...env,DATABASE_URL:env.DATABASE_URL.replace('fictional_user:','different_user:')},
    {...env,DATABASE_URL:env.DATABASE_URL.replace('/fictional_local','/different_db')},
    {...env,DATABASE_URL:'postgresql://localhost/fictional_local'},
    {PGDATABASE:'fictional_local',PGUSER:'fictional_user',RENDER_DB_ENVIRONMENT:'test'}]) {
    const f=fake();assert.equal(await f.run(apply,config),1);assert.equal(f.calls.length,0);
    assert.doesNotMatch(f.errors.join(' '),/FAKE_PASSWORD|postgresql:\/\//);
  }
});

test('status reads identity/ledger and emits the plan without running migrations',async()=>{
  const f=fake();assert.equal(await f.run(['status']),0);
  assert.ok(f.calls.includes('connect'));assert.ok(f.calls.includes('release'));assert.ok(f.calls.includes('end'));
  assert.ok(!f.calls.some(call=>call?.runner));assert.ok(f.calls.filter(call=>typeof call==='string'&&call.startsWith('SELECT')).length===2);
  const result=JSON.parse(f.output[0]);assert.deepEqual(result.identity,identity);assert.deepEqual(result.status,f.status);assert.equal(result.planHash,planHash);
  assert.doesNotMatch(f.output.join(' '),/FAKE_PASSWORD|postgresql:\/\//);
});

test('status also rejects query connection overrides before importing or connecting',async()=>{
  for(const options of ['?host=example.invalid','?user=other_user','?database=other_db','?options=-csearch_path=other']) {
    const f=fake();assert.equal(await f.run(['status'],{...env,DATABASE_URL:env.DATABASE_URL+options}),1);
    assert.equal(f.calls.length,0);
  }
});

test('status verifies configured identity before ledger/plan, including actual loopback for local targets',async()=>{
  for(const actual of [{...identity,database:'other_db'},{...identity,username:'other_user'},
    {...identity,port:5433},{...identity,address:'192.0.2.1'}]) {
    const f=fake({identity:actual});assert.equal(await f.run(['status']),1);
    assert.equal(f.output.length,0);assert.ok(!f.calls.includes('SELECT nombre FROM public._migrations'));
    assert.ok(f.calls.includes('release'));assert.equal(f.calls.at(-1),'end');
  }
  const local=fake({identity:{...identity,address:'::1'}});
  assert.equal(await local.run(['status'],{...env,DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1','localhost')}),0);
});

test('remote status checks database/user/port without comparing a DNS name to the server IP',async()=>{
  const config={...env,DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1','example.invalid')};
  assert.equal(await fake({identity:{...identity,address:'192.0.2.1'}}).run(['status'],config),0);
  for(const actual of [{...identity,database:'other_db'},{...identity,username:'other_user'},{...identity,port:5433}]) {
    const f=fake({identity:actual});assert.equal(await f.run(['status'],config),1);assert.equal(f.output.length,0);
  }
});

test('apply forwards explicit approval with the freshly read identity, leaving locked recheck to engine',async()=>{
  const f=fake();assert.equal(await f.run(),0);
  assert.deepEqual(f.calls.find(call=>call?.runner).runner,{approval:{environment:'test',expectedIdentity:identity,planHash,purpose:'local-explicit'}});
  assert.equal(f.calls.at(-1),'end');
});

test('changed plan or actual DB/user stops before runner; engine recheck failure is sanitized and closes pool',async()=>{
  for(const options of [{planHash:'c'.repeat(64)},{identity:{...identity,database:'different_db'}},{identity:{...identity,username:'different_user'}},{identity:{...identity,address:'192.0.2.1'}},{identity:{...identity,port:5433}}]) {
    const f=fake(options);assert.equal(await f.run(),1);assert.ok(!f.calls.some(call=>call?.runner));assert.equal(f.calls.at(-1),'end');
  }
  const f=fake({runnerError:Error('SQL SECRET postgresql://fictional_user:FAKE_PASSWORD@example.invalid/db')});
  assert.equal(await f.run(),1);assert.doesNotMatch(f.errors.join(' '),/SECRET|FAKE_PASSWORD|postgresql/);assert.equal(f.calls.at(-1),'end');
});

test('only engine policy errors expose the controlled migration filename, never raw SQL/driver secrets',async()=>{
  const bounded='Migration failed: 999_qa_startup_failure.sql';
  const allowed=fake({runnerError:new MigrationPolicyError(bounded)});
  assert.equal(await allowed.run(),1);assert.deepEqual(allowed.errors,[bounded]);assert.equal(allowed.calls.at(-1),'end');
  for(const error of [Error('SELECT secret FROM credentials; postgresql://user:FAKE_PASSWORD@example.invalid/db'),
    Object.assign(Error(bounded+' postgresql://user:FAKE_PASSWORD@example.invalid/db'),{name:'MigrationPolicyError',code:'P0001'})]) {
    const raw=fake({runnerError:error});assert.equal(await raw.run(),1);
    assert.doesNotMatch(raw.errors.join(' '),/FAKE_PASSWORD|postgresql|SELECT|credentials|999_qa_startup_failure/);
    assert.equal(raw.calls.at(-1),'end');
  }
});

test('command parsing is closed and validation does not inherit PG defaults',()=>{
  assert.deepEqual(parseMigrationCommand(['status']),{command:'status'});
  assert.equal(validateMigrationCliEnvironment(env,parseMigrationCommand(apply)).environment,'test');
  assert.throws(()=>validateMigrationCliEnvironment({PGHOST:'localhost',PGDATABASE:'fictional_local',RENDER_DB_ENVIRONMENT:'test'},parseMigrationCommand(['status'])));
});

test('actual default CLI prints help inertly; preview legacy gate precedes every dynamic DB import',()=>{
  const cli=fileURLToPath(new URL('../scripts/migrate.js',import.meta.url));
  const help=spawnSync(process.execPath,[cli],{env:{},encoding:'utf8',timeout:3000});
  assert.equal(help.status,0);assert.match(help.stdout,/Migraciones explícitas/);assert.equal(help.stderr,'');
  const preview=fileURLToPath(new URL('../scripts/preview-client-goals.js',import.meta.url));
  const source=fs.readFileSync(preview,'utf8');
  assert.ok(source.indexOf('throw new Error(')<source.indexOf("await import('pg')"));
  assert.doesNotMatch(source,/^import\s/m);
  const blocked=spawnSync(process.execPath,[preview],{env:{},encoding:'utf8',timeout:3000});
  assert.equal(blocked.status,1);assert.match(blocked.stderr,/Preview legacy de objetivos deshabilitado/);
  assert.doesNotMatch(blocked.stderr,/ECONNREFUSED|password authentication|DATABASE_URL=/);
});
