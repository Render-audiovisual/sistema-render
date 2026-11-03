import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,rm} from 'node:fs/promises';
import {preservePublicAssets,publicAssetFilename} from '../src/public-asset-cache.js';
async function fixture(t){const root=await mkdtemp('/private/tmp/render-public-assets-');t.after(()=>rm(root,{recursive:true,force:true}));const sourceDir=path.join(root,'assets'),cacheRoot=path.join(root,'cache');await mkdir(sourceDir);await writeFile(path.join(sourceDir,'Clients-Ab123456.js'),'export const name="Clients";');await writeFile(path.join(sourceDir,'Clients-Ab123456.css'),'.client{color:black}');return {root,sourceDir,cacheRoot};}
test('public code archive is immutable, deterministic and does not remove source assets',async t=>{
 const f=await fixture(t),a=await preservePublicAssets(f),b=await preservePublicAssets(f);
 assert.deepEqual(a,b);assert.equal(a.files,2);assert.match(a.key,/^[a-f0-9]{64}$/);
 assert.equal(await readFile(path.join(f.cacheRoot,a.key,'Clients-Ab123456.js'),'utf8'),'export const name="Clients";');
 assert.equal(await readFile(path.join(f.sourceDir,'Clients-Ab123456.js'),'utf8'),'export const name="Clients";');
 assert.deepEqual((await readdir(f.cacheRoot)).sort(),[a.key,'assets'].sort());
 await writeFile(path.join(f.sourceDir,'Clients-ZZ123456.js'),'export const name="Updated";');const c=await preservePublicAssets(f);assert.notEqual(c.key,a.key);
 assert.equal(await readFile(path.join(f.cacheRoot,a.key,'Clients-Ab123456.js'),'utf8'),'export const name="Clients";');
});
test('environment files, maps, HTML, uploads and nested paths are never archived',async t=>{
 const f=await fixture(t);for(const name of ['.env','index.html','Clients-Ab123456.js.map','uploads.json','secret.key','token.txt'])await writeFile(path.join(f.sourceDir,name),'PRIVATE');
 await mkdir(path.join(f.sourceDir,'nested'));await writeFile(path.join(f.sourceDir,'nested','Other-Ab123456.js'),'PRIVATE');
 const saved=await preservePublicAssets(f);assert.equal(saved.files,2);const names=await readdir(path.join(f.cacheRoot,saved.key));assert.ok(names.every(publicAssetFilename));
 for(const name of names)assert.ok(!(await readFile(path.join(f.cacheRoot,saved.key,name),'utf8')).includes('PRIVATE'));
});
test('symlink source files or cache roots fail closed instead of exposing private bytes',async t=>{
 const f=await fixture(t),privateFile=path.join(f.root,'private.txt');await writeFile(privateFile,'PRIVATE');
 await symlink(privateFile,path.join(f.sourceDir,'Private-Ab123456.js'));await assert.rejects(preservePublicAssets(f),/Invalid public code asset/);
 const g=await fixture(t),outside=path.join(g.root,'outside');await mkdir(outside);await symlink(outside,g.cacheRoot);await assert.rejects(preservePublicAssets(g),/Invalid public asset directory/);
 assert.deepEqual(await readdir(outside),[]);
});
test('existing modified archives are rejected, never silently overwritten',async t=>{
 const f=await fixture(t),saved=await preservePublicAssets(f);await writeFile(path.join(f.cacheRoot,saved.key,'Clients-Ab123456.js'),'MODIFIED');
 await assert.rejects(preservePublicAssets(f),/Public asset archive changed/);assert.equal(await readFile(path.join(f.cacheRoot,saved.key,'Clients-Ab123456.js'),'utf8'),'MODIFIED');
});
