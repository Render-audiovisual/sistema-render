import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {preservePublicAssets,resolvePublicAssetCacheRoot} from '../backend/src/public-asset-cache.js';

const project=await realpath(fileURLToPath(new URL('../',import.meta.url)));
const cacheRoot=await resolvePublicAssetCacheRoot(path.join(project,'frontend/dist'));
if(cacheRoot){
 const current=path.join(path.dirname(cacheRoot),'current/nodejs/frontend/dist/assets');
 let existing;try{existing=await realpath(current);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(existing)await preservePublicAssets({sourceDir:existing,cacheRoot});
 const archived=await preservePublicAssets({sourceDir:path.join(project,'frontend/dist/assets'),cacheRoot});
 console.log(JSON.stringify({event:'PUBLIC_CODE_ASSETS_RETAINED',files:archived.files}));
}
