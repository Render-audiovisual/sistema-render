import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,renameSync,unlinkSync} from 'node:fs';
import {createHash,generateKeyPairSync} from 'node:crypto';
import path from 'node:path';import os from 'node:os';
import {buildHostingerOutput} from '../../scripts/build-hostinger-output.mjs';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
function fixture(){const root=mkdtempSync(path.join(os.tmpdir(),'render-package-test-')),source=path.join(root,'source');mkdirSync(source);
 for(const dir of ['backend/src','backend/scripts','backend/migrations','shared','frontend/dist/assets'])mkdirSync(path.join(source,dir),{recursive:true});
 for(const [name,text] of Object.entries({'package.json':JSON.stringify({version:'0.1.0',engines:{node:'>=24 <25'}}),'backend/package.json':'{"name":"fixture"}','backend/package-lock.json':'{}','backend/src/server.js':'// synthetic','backend/scripts/migrate.js':'// synthetic','backend/migrations/000.sql':'SELECT 1;','shared/x.js':'// synthetic','frontend/dist/index.html':'<script type="module" src="/assets/index-QA.js"></script>','frontend/dist/assets/index-QA.js':'// synthetic'}))writeFileSync(path.join(source,name),text);
 return{root,source,output:path.join(root,'release')};}
test('new package contains canonical inputs, root start contract and manifest without copying DB/env',()=>{
 const f=fixture();writeFileSync(path.join(f.source,'.env'),'secret');const result=buildHostingerOutput({sourceRoot:f.source,outputRoot:f.output,installDependencies:false});
 assert.equal(result.dependenciesInstalled,false);assert.match(result.manifestSha256,/^[0-9a-f]{64}$/);
 assert.equal(existsSync(path.join(f.output,'.env')),false);assert.equal(existsSync(path.join(f.output,'backend/src/server.js')),true);
 assert.equal(readFileSync(path.join(f.output,'shared/x.js'),'utf8'),'// synthetic');
 assert.equal(JSON.parse(readFileSync(path.join(f.output,'package.json'))).scripts.start,'node backend/src/server.js');
});
test('existing output and symlink never get removed or overwritten',()=>{
 const f=fixture();mkdirSync(f.output);writeFileSync(path.join(f.output,'keep'),'preserve');
 assert.throws(()=>buildHostingerOutput({sourceRoot:f.source,outputRoot:f.output,installDependencies:false}),e=>e.code==='EEXIST');assert.equal(readFileSync(path.join(f.output,'keep'),'utf8'),'preserve');
 const link=path.join(f.root,'link');symlinkSync(f.output,link);assert.throws(()=>buildHostingerOutput({sourceRoot:f.source,outputRoot:link,installDependencies:false}));assert.equal(readFileSync(path.join(f.output,'keep'),'utf8'),'preserve');
});
test('source roots, parents and protected subtrees cannot become output',()=>{
 const f=fixture();for(const target of [f.source,f.root,path.join(f.source,'backend','out'),path.join(f.source,'frontend','out')])assert.throws(()=>buildHostingerOutput({sourceRoot:f.source,outputRoot:target,installDependencies:false}),/Unsafe/);
});
test('private or symlinked input and missing frontend fail before creating output',()=>{
 for(const type of ['private','symlink','missing']){const f=fixture();
 if(type==='private')writeFileSync(path.join(f.source,'backend/src/runtime.private.json'),'secret');
 if(type==='symlink')symlinkSync(path.join(f.source,'package.json'),path.join(f.source,'shared/link'));
 if(type==='missing')writeFileSync(path.join(f.source,'frontend/dist/index.html'),'<html>no canonical build</html>');
 assert.throws(()=>buildHostingerOutput({sourceRoot:f.source,outputRoot:f.output,installDependencies:false}));assert.equal(existsSync(f.output),false);
 }
});
test('installation failure or copied-byte mutation cannot produce accepted manifest',()=>{
 for(const mutate of [false,true]){const f=fixture();assert.throws(()=>buildHostingerOutput({sourceRoot:f.source,outputRoot:f.output,install(directory){
 if(mutate)writeFileSync(path.join(directory,'src/server.js'),'changed');else throw Error('synthetic install failure');
 }}));assert.equal(existsSync(path.join(f.output,'release-manifest.json')),false);}
});
test('retired static publisher rejects without installation, deletion or copying',()=>{
 const script=new URL('../../scripts/build-hosting.sh',import.meta.url),source=readFileSync(script,'utf8');
 assert.doesNotMatch(source,/\brm\s|\bcp\s|\bnpm\s|\bnpx\s/);
 const result=spawnSync('/bin/bash',[fileURLToPath(script)],{env:{},encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/deshabilitada/);assert.equal(result.stdout,'');
});

const keyPair=generateKeyPairSync('rsa',{modulusLength:1024});
const publicPem=keyPair.publicKey.export({type:'spki',format:'pem'});
const privatePem=keyPair.privateKey.export({type:'pkcs8',format:'pem'});
const digest=value=>createHash('sha256').update(value).digest('hex');
function prepare(f,options={}){return buildHostingerOutput({sourceRoot:f.source,outputRoot:f.output,installDependencies:false,...options});}
function assertUnaccepted(f){assert.equal(existsSync(path.join(f.output,'release-manifest.json')),false);}
function requireDependency(f){writeFileSync(path.join(f.source,'backend/package.json'),JSON.stringify({name:'fixture',dependencies:{'fixture-dep':'1.0.0'}}));}
function installFixture(directory){const dependency=path.join(directory,'node_modules/fixture-dep');mkdirSync(dependency,{recursive:true});
 writeFileSync(path.join(dependency,'package.json'),JSON.stringify({name:'fixture-dep',version:'1.0.0',main:'index.js'}));writeFileSync(path.join(dependency,'index.js'),'module.exports = 1;');}

test('only the exact public PEM is accepted, parsed and SHA-inventoried',()=>{
 const f=fixture();writeFileSync(path.join(f.source,'backend/src/wilson-public-key.pem'),publicPem);prepare(f);
 const manifest=JSON.parse(readFileSync(path.join(f.output,'release-manifest.json')));
 assert.equal(manifest.files.find(file=>file.path==='backend/src/wilson-public-key.pem').sha256,digest(publicPem));
 for(const [relative,content] of [['backend/src/wilson-public-key.pem',privatePem],['backend/src/wilson-public-key.pem','invalid'],
 ['backend/src/wilson-public-key.pem',publicPem+privatePem],['shared/wilson-public-key.pem',publicPem],['backend/src/other.pem',publicPem]]){
  const bad=fixture();writeFileSync(path.join(bad.source,relative),content);assert.throws(()=>prepare(bad));assert.equal(existsSync(bad.output),false);
 }
});

test('input ancestors, root metadata and the source root cannot be symlinks',()=>{
 for(const relative of ['backend','frontend','package.json']){const f=fixture(),original=path.join(f.source,relative),external=path.join(f.root,'external');
  renameSync(original,external);symlinkSync(external,original);assert.throws(()=>prepare(f));assert.equal(existsSync(f.output),false);
 }
 const f=fixture(),alias=path.join(f.root,'alias');symlinkSync(f.source,alias);assert.throws(()=>prepare(f,{sourceRoot:alias}));assert.equal(existsSync(f.output),false);
});

test('normalized roots and output-parent aliases retain containment and prefix boundaries',()=>{
 const f=fixture();assert.throws(()=>prepare(f,{sourceRoot:f.source+'/',outputRoot:path.join(f.source,'backend','out')}),/Unsafe/);
 const alias=path.join(f.root,'alias');symlinkSync(path.join(f.source,'backend'),alias);
 assert.throws(()=>prepare(f,{outputRoot:path.join(alias,'out')}),/Unsafe/);
 prepare(f,{outputRoot:path.join(f.root,'source-other')});
 assert.equal(existsSync(path.join(f.root,'source-other/release-manifest.json')),true);
});

test('post-install extras, private files, empty directories and equal-byte symlinks are rejected',()=>{
 for(const mode of ['extra','private','root-extra','empty-dir','file-link','ancestor-link','dependency-root-link','root-dependencies']){
  const f=fixture();assert.throws(()=>prepare(f,{installDependencies:true,install(dir){
   if(mode==='extra')writeFileSync(path.join(dir,'src/extra.js'),'extra');
   if(mode==='private')writeFileSync(path.join(dir,'src/leaked.private.json'),'synthetic');
   if(mode==='root-extra')writeFileSync(path.join(path.dirname(dir),'unexpected.txt'),'extra');
   if(mode==='empty-dir')mkdirSync(path.join(dir,'src/extra'));
   if(mode==='file-link'){const file=path.join(dir,'src/server.js'),outside=path.join(f.root,'equal');writeFileSync(outside,readFileSync(file));unlinkSync(file);symlinkSync(outside,file);}
   if(mode==='ancestor-link'){const outside=path.join(f.root,'copied');renameSync(path.join(dir,'src'),outside);symlinkSync(outside,path.join(dir,'src'));}
   if(mode==='dependency-root-link'){mkdirSync(path.join(f.root,'deps'));symlinkSync(path.join(f.root,'deps'),path.join(dir,'node_modules'));}
   if(mode==='root-dependencies')mkdirSync(path.join(path.dirname(dir),'node_modules'));
  }}),undefined,mode);assertUnaccepted(f);
 }
});

test('all index asset references must exist inside dist with no traversal or URL escapes',()=>{
 for(const reference of ['/assets/index-MISSING.js','/assets/../index-QA.js','/assets/%2e%2e/index-QA.js','/assets/%2e%2e/%2e%2e/out.js','/assets/index-QA.js%00']){
  const f=fixture();writeFileSync(path.join(f.source,'frontend/dist/index.html'),`<script type="module" src="${reference}"></script>`);
  assert.throws(()=>prepare(f));assert.equal(existsSync(f.output),false);
 }
 const css=fixture();writeFileSync(path.join(css.source,'frontend/dist/index.html'),'<script src="/assets/index-QA.js"></script><link href="/assets/missing.css" rel="stylesheet">');
 assert.throws(()=>prepare(css));assert.equal(existsSync(css.output),false);
 const good=fixture();writeFileSync(path.join(good.source,'frontend/dist/index.html'),"<script type='module' src='/assets/index-QA.js?v=1'></script>");prepare(good);
});

test('source byte, membership and metadata changes during installation invalidate acceptance',()=>{
 for(const mode of ['bytes','added','deleted','metadata','link']){const f=fixture();assert.throws(()=>prepare(f,{installDependencies:true,install(){
  const file=path.join(f.source,'backend/src/server.js');
  if(mode==='bytes')writeFileSync(file,'changed');
  if(mode==='added')writeFileSync(path.join(f.source,'shared/added.js'),'added');
  if(mode==='deleted')unlinkSync(file);
  if(mode==='metadata')writeFileSync(path.join(f.source,'package.json'),'{"version":"changed"}');
  if(mode==='link'){const external=path.join(f.root,'external');renameSync(file,external);symlinkSync(external,file);}
 }}));assertUnaccepted(f);}
});

test('required dependency resolution is local and dependency bytes have a separate proof',()=>{
 const f=fixture();requireDependency(f);prepare(f,{installDependencies:true,install:installFixture});
 const manifest=JSON.parse(readFileSync(path.join(f.output,'release-manifest.json')));
 assert.equal(manifest.dependenciesInstalled,true);
 assert.equal(manifest.dependencyProof.method,'local-resolution-and-inventory');
 assert.deepEqual(manifest.dependencyProof.required.map(dep=>dep.name),['fixture-dep']);
 assert.match(manifest.dependencyProof.sha256,/^[a-f0-9]{64}$/);
 assert.ok(manifest.dependencyProof.files.some(file=>file.path==='fixture-dep/index.js'&&file.sha256===digest('module.exports = 1;')));
 assert.ok(!manifest.files.some(file=>file.path.includes('node_modules')));
 const no=fixture();requireDependency(no);assert.throws(()=>prepare(no,{installDependencies:true,install(){}}));assertUnaccepted(no);
 const fallback=fixture();requireDependency(fallback);installFixture(path.join(fallback.root,'backend'));
 // A package available from an ancestor must not satisfy output dependencies.
 renameSync(path.join(fallback.root,'backend/node_modules'),path.join(fallback.root,'node_modules'));
 assert.throws(()=>prepare(fallback,{installDependencies:true,install(){}}));assertUnaccepted(fallback);
});

test('dependency symlinks cannot escape the owned tree, but internal bin links are inventoried',()=>{
 const f=fixture();requireDependency(f);prepare(f,{installDependencies:true,install(dir){installFixture(dir);mkdirSync(path.join(dir,'node_modules/.bin'));
  symlinkSync('../fixture-dep/index.js',path.join(dir,'node_modules/.bin/fixture'));
 }});
 const manifest=JSON.parse(readFileSync(path.join(f.output,'release-manifest.json')));
 assert.equal(manifest.dependencyProof.files.find(file=>file.path==='.bin/fixture').type,'symlink');
 const bad=fixture();requireDependency(bad);assert.throws(()=>prepare(bad,{installDependencies:true,install(dir){installFixture(dir);
  symlinkSync(path.join(bad.source,'shared'),path.join(dir,'node_modules/escape'));
 }}));assertUnaccepted(bad);
});

test('failed install leaves only explicitly unaccepted output and never overwrites it on retry',()=>{
 const f=fixture();assert.throws(()=>prepare(f,{installDependencies:true,install(){throw Error('failed');}}),/failed/);
 assert.equal(existsSync(path.join(f.output,'backend/src/server.js')),true);assertUnaccepted(f);
 assert.throws(()=>prepare(f),error=>error.code==='EEXIST');assertUnaccepted(f);
});
