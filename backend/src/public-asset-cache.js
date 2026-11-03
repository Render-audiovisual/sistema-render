import path from 'node:path';
import {createHash} from 'node:crypto';
import {lstat,realpath,readdir,readFile,mkdir,mkdtemp,writeFile,rename,rm,link} from 'node:fs/promises';

// Code assets only. Never HTML, maps, environment files, uploads or API data.
export const publicAssetFilename=name=>typeof name==='string'&&/^[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(name);
export async function resolvePublicAssetCacheRoot(distDir){
 const resolved=await realpath(distDir);
 const match=/^(.*\/hbuilds)\/versions\/[a-f0-9-]{36}\/nodejs\/frontend\/dist$/.exec(resolved);
 return match?path.join(match[1],'public-assets'):null;
}
async function directory(target){const s=await lstat(target);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Invalid public asset directory.');}
export async function preservePublicAssets({sourceDir,cacheRoot}){
 await directory(sourceDir);const root=await realpath(sourceDir);
 const records=[];let total=0;
 for(const name of (await readdir(root)).filter(publicAssetFilename).sort()){
  const file=path.join(root,name),s=await lstat(file);
  if(!s.isFile()||s.isSymbolicLink()||s.size>5*1024*1024)throw Error('Invalid public code asset.');
  const bytes=await readFile(file);total+=bytes.length;
  if(total>32*1024*1024||records.length>=128)throw Error('Public asset archive exceeds limits.');
  records.push({name,bytes,hash:createHash('sha256').update(bytes).digest('hex')});
 }
 if(!records.length)return {files:0};
 try{await mkdir(cacheRoot,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 await directory(cacheRoot);
 const key=createHash('sha256').update(JSON.stringify(records.map(({name,hash})=>[name,hash]))).digest('hex');
 const destination=path.join(cacheRoot,key);
 async function publishFiles(){
  const flat=path.join(cacheRoot,'assets');try{await mkdir(flat,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await directory(flat);
  for(const record of records){
   const file=path.join(flat,record.name);
   try{await link(path.join(destination,record.name),file);}
   catch(e){if(e.code!=='EEXIST')throw e;const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>5*1024*1024||createHash('sha256').update(await readFile(file)).digest('hex')!==record.hash)throw Error('Public asset name collision.');}
  }
 }
 async function verify(){await directory(destination);for(const record of records){const file=path.join(destination,record.name),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>5*1024*1024||createHash('sha256').update(await readFile(file)).digest('hex')!==record.hash)throw Error('Public asset archive changed.');}}
 try{await verify();await publishFiles();return {files:records.length,key};}catch(e){if(e.code!=='ENOENT')throw e;}
 const temporary=await mkdtemp(path.join(cacheRoot,'.prepare-'));
 try{
  for(const record of records)await writeFile(path.join(temporary,record.name),record.bytes,{flag:'wx',mode:0o600});
  try{await rename(temporary,destination);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;await verify();}
  await publishFiles();return {files:records.length,key};
 }finally{await rm(temporary,{recursive:true,force:true});}
}
