import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { fork, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

// Module import is deliberately inert; production/require defaults still start.
const previous = process.env.RENDER_DISABLE_SERVER_START;
process.env.RENDER_DISABLE_SERVER_START = 'true';
const { startRuntimeEntrypoint, launchRuntimeEntrypoint } = await import('../src/runtime-entrypoint.js');
if (previous === undefined) delete process.env.RENDER_DISABLE_SERVER_START;
else process.env.RENDER_DISABLE_SERVER_START = previous;
const entry = fileURLToPath(new URL('../src/runtime-entrypoint.js', import.meta.url));
const source = readFileSync(entry, 'utf8');
function fakeServer({ fail, throwListen = false } = {}) {
  const server = new EventEmitter(); server.closed = 0;
  server.close = callback => { server.closed++; callback?.(); };
  server.closeAllConnections = () => {};
  server.listen = (...args) => {
    server.binding = args;
    if (throwListen) throw Error('PRIVATE_LISTEN_ERROR');
    queueMicrotask(() => server.emit(fail ? 'error' : 'listening', fail ? Error('PRIVATE_ASYNC_ERROR') : undefined));
  };
  server.address = () => ({ port: 12345 });
  return server;
}
const maintenance = { RENDER_MAINTENANCE: 'true', HOST: '127.0.0.1', PORT: '0' };
for (const mode of [undefined, '', 'false']) test(`normal mode ${JSON.stringify(mode)} imports application once, never binds maintenance`, async () => {
  let imports = 0;
  const module = {};
  const env = Object.freeze(mode === undefined ? {} : { RENDER_MAINTENANCE: mode });
  assert.deepEqual(await startRuntimeEntrypoint({ env, importServer: async () => { imports++; return module; },
    createServer: () => assert.fail('normal branch must not bind') }), { mode: 'application', module });
  assert.equal(imports, 1);
});
for (const mode of ['TRUE','False','1',' true','true\n','yes',true,false,0,null]) test(`invalid maintenance value ${JSON.stringify(mode)} fails before import/bind`, async () => {
  await assert.rejects(startRuntimeEntrypoint({ env: { RENDER_MAINTENANCE: mode },
    importServer: () => assert.fail('invalid config must not import'), createServer: () => assert.fail('invalid config must not bind') }),
  error => error.code === 'RENDER_RUNTIME_START_FAILED' && !error.message.includes(String(mode)));
});
for (const patch of [{PORT:''},{PORT:'-1'},{PORT:'01'},{PORT:' 3000'},{PORT:'3000\n'},{PORT:'1e3'},
  {PORT:'65536'},{PORT:3000},{HOST:''},{HOST:'0.0.0.0\n'},{HOST:'https://example.test'},{HOST:'external.example'},{HOST:null}])
test(`invalid binding ${JSON.stringify(patch)} fails closed before create/import`, async () => {
  await assert.rejects(startRuntimeEntrypoint({ env: {...maintenance,...patch},
    importServer: () => assert.fail('no import'), createServer: () => assert.fail('no bind') }), {code:'RENDER_RUNTIME_START_FAILED'});
});
test('exact maintenance opt-in uses native factory and defaults without reading business environment or changing env', async () => {
  const env = Object.freeze({ RENDER_MAINTENANCE: 'true', get DATABASE_URL() { assert.fail('must not read database environment'); } });
  const server = fakeServer(); let factoryCalls = 0;
  const result = await startRuntimeEntrypoint({ env, importServer: () => assert.fail('business import forbidden'),
    createServer: handler => { factoryCalls++; assert.equal(typeof handler,'function'); return server; } });
  assert.equal(result.mode,'maintenance'); assert.equal(factoryCalls,1); assert.deepEqual(server.binding,[3000,'0.0.0.0']);
});
for (const host of ['127.0.0.1','0.0.0.0','::1','::','localhost']) test(`explicit numeric/local host ${host} accepts fixture PORT0`, async () => {
  const server=fakeServer(); await startRuntimeEntrypoint({env:{...maintenance,HOST:host},createServer:()=>server,importServer:()=>assert.fail('no import')});
  assert.deepEqual(server.binding,[0,host]);
});
test('synchronous create error is sanitized', async () => {
  await assert.rejects(startRuntimeEntrypoint({env:maintenance,createServer(){throw Error('PRIVATE_CREATE_SECRET');}}),
    error=>error.code==='RENDER_RUNTIME_START_FAILED'&&!error.message.includes('PRIVATE'));
});
for(const config of [{fail:true},{throwListen:true}])test(`bind failure ${JSON.stringify(config)} closes factory result and rejects sanitized`,async()=>{
  const server=fakeServer(config);await assert.rejects(startRuntimeEntrypoint({env:maintenance,createServer:()=>server}),
    error=>error.code==='RENDER_RUNTIME_START_FAILED'&&!error.message.includes('PRIVATE'));assert.ok(server.closed>0);
});
test('post-listening error has a permanent handler, reports once and closes without uncaught rejection',async()=>{
  const server=fakeServer();let reports=0;
  await startRuntimeEntrypoint({env:maintenance,createServer:()=>server,onFatal:()=>reports++});
  server.emit('error',Error('PRIVATE_RUNTIME_SECRET'));server.emit('error',Error('PRIVATE_SECOND_ERROR'));
  assert.equal(reports,1);assert.ok(server.closed>0);
});
test('launch handles asynchronous import rejection with a sanitized terminal failure',async()=>{
  let reports=0;
  const result=await launchRuntimeEntrypoint({env:{},importServer:async()=>{throw Error('PRIVATE_DATABASE_CONNECTION');},onFatal:()=>reports++});
  assert.equal(result,null);assert.equal(reports,1);
});
function request(port,path='/',method='GET') {
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path,method,timeout:5000},res=>{
      let body='';res.setEncoding('utf8');res.on('data',part=>{body+=part;});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('local request timeout')));req.end();
  });
}
test('real maintenance HTTP without DATABASE_URL serves only root/health and never imports business',async t=>{
  let businessImports=0;
  const result=await startRuntimeEntrypoint({env:maintenance,importServer:()=>{businessImports++;assert.fail('business import forbidden');}});
  t.after(()=>new Promise(resolve=>{result.server.closeAllConnections();result.server.close(resolve);}));
  const port=result.server.address().port;
  for(const [path,method,status]of [['/','GET',200],['/','HEAD',200],['/health','GET',200],['/health','HEAD',200],
    ['/api/tareas','GET',503],['/health','POST',503],['/','POST',503],['/health','OPTIONS',503],['/missing','HEAD',503]]){
    const response=await request(port,path,method);assert.equal(response.status,status);
    assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['retry-after'],'60');
    assert.equal(response.headers['x-content-type-options'],'nosniff');
    if(method==='HEAD')assert.equal(response.body,'');
    else if(path==='/health'&&method==='GET')assert.deepEqual(JSON.parse(response.body),{status:'maintenance',databaseReady:false});
    else if(status===503)assert.deepEqual(JSON.parse(response.body),{status:'maintenance'});
    else assert.match(response.body,/Render está en mantenimiento/);
  }
  assert.equal(businessImports,0);
});
const childEnv={PATH:process.env.PATH,RENDER_MAINTENANCE:'true',HOST:'127.0.0.1',PORT:'0'};
async function smoke(t,{requireMode=false}={}){
  const args=requireMode?['-e',`require(${JSON.stringify(entry)})`]:[entry];
  const child=fork(args[0],args.slice(1),{execArgv:[],env:childEnv,stdio:['ignore','pipe','pipe','ipc']});
  let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});child.stdout.resume();
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}});
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Maintenance entrypoint did not announce readiness')),10000);
    child.once('message',message=>{clearTimeout(timer);resolve(message);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Maintenance entrypoint exited before readiness'));});
  });
  assert.equal(ready.type,'render-startup-ready');assert.ok(ready.port>0);
  assert.deepEqual(JSON.parse((await request(ready.port,'/health')).body),{status:'maintenance',databaseReady:false});
  assert.equal((await request(ready.port,'/api/tareas','POST')).status,503);
  assert.equal(stderr,'');
}
test('actual Node CLI starts maintenance with no DB/env bootstrap',t=>smoke(t));
test('actual Node24 require() starts despite argv[1] not identifying the module and has no TLA',t=>smoke(t,{requireMode:true}));
test('actual require() invalid flag terminates exitCode1 without raw configuration/error disclosure',()=>{
  const r=spawnSync(process.execPath,['-e',`require(${JSON.stringify(entry)})`],{env:{...childEnv,RENDER_MAINTENANCE:'PRIVATE_INVALID_CONFIG'},encoding:'utf8',timeout:5000});
  assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/Render no pudo iniciar/);assert.doesNotMatch(r.stderr,/PRIVATE_|DATABASE_URL|Error:|at /);
});
test('actual asynchronous application-import rejection sets exitCode1 with only the fixed diagnostic',()=>{
  const script=`process.env.RENDER_DISABLE_SERVER_START='true';const {launchRuntimeEntrypoint}=require(${JSON.stringify(entry)});launchRuntimeEntrypoint({env:{},importServer:async()=>{throw Error('PRIVATE_IMPORT_CONNECTION_SECRET')}});`;
  const r=spawnSync(process.execPath,['-e',script],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});
  assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'Render no pudo iniciar. Revisá la configuración del arranque.');
});
test('entrypoint has only Node-native static dependencies and one branch-local application import; no argv detection',()=>{
  assert.deepEqual([...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m=>m[1]),['node:http','node:net']);
  assert.doesNotMatch(source,/import\(['"](?:dotenv|.*db\.js)['"]\)|process\.argv|DATABASE_URL|setInterval/);
  assert.equal((source.match(/import\('\.\/server\.js'\)/g)||[]).length,1);
  assert.match(source,/RENDER_DISABLE_SERVER_START !== 'true'/);
});
