import path from 'node:path';
import {lstat,readdir,realpath,readFile} from 'node:fs/promises';
import {publicAssetFilename,resolvePublicAssetCacheRoot} from './public-asset-cache.js';

export function createRetainedAssetMiddleware({distDir,cacheRoot,readLimit=4}){
 if(!Number.isSafeInteger(readLimit)||readLimit<1||readLimit>4)throw Error('Invalid asset read limit.');
 return async(req,res,next)=>{
  const pathname=(req.path||req.url||'').split('?')[0];
  if(!['GET','HEAD'].includes(req.method)||!pathname.startsWith('/assets/'))return next();
  const name=pathname.slice('/assets/'.length);if(!publicAssetFilename(name))return next();
  try{
   const root=cacheRoot??await resolvePublicAssetCacheRoot(distDir);if(!root)return next();
   const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())return next();
   async function readAsset(directory){
    try{
     const ds=await lstat(directory);if(!ds.isDirectory()||ds.isSymbolicLink())return null;
     const file=path.join(directory,name),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>5*1024*1024)return null;
     if(await realpath(file)!==path.join(await realpath(directory),name))return null;
     return await readFile(file);
    }catch(e){if(['ENOENT','ENOTDIR','EACCES'].includes(e.code))return null;throw e;}
   }
   const respond=bytes=>{res.status(200);res.set('Cache-Control','public, max-age=31536000, immutable');res.set('X-Content-Type-Options','nosniff');res.type(name.endsWith('.css')?'text/css':'application/javascript');res.set('Content-Length',String(bytes.length));return req.method==='HEAD'?res.end():res.send(bytes);};
   // Direct immutable lookup keeps old open tabs working even across many
   // deployments, with no unbounded directory search on the request path.
   const retained=await readAsset(path.join(root,'assets'));if(retained!==null)return respond(retained);
   const entries=[];
   for(const entry of await readdir(root,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-f0-9]{64}$/.test(entry.name))continue;
    const directory=path.join(root,entry.name),s=await lstat(directory);
    if(s.isDirectory()&&!s.isSymbolicLink())entries.push({directory,time:s.mtimeMs});
   }
   for(const {directory} of entries.sort((a,b)=>b.time-a.time||a.directory.localeCompare(b.directory)).slice(0,readLimit)){
    const bytes=await readAsset(directory);if(bytes!==null)return respond(bytes);
   }
   return next();
  }catch(e){if(['ENOENT','ENOTDIR','EACCES'].includes(e.code))return next();return next(e);}
 };
}
