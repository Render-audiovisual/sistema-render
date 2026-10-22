import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const maximum=10*1024*1024;
const safeName=value=>typeof value==='string'&&/^[a-f0-9-]+\.(jpg|png)$/.test(value);
const conflict=()=>Object.assign(new Error('No se pudo verificar el archivo de este intento. No se sobrescribió ninguna imagen.'),{status:409,code:'MOODBOARD_IMAGE_CONFLICT'});

// Filesystem adapter only. The transaction service owns authority, receipt
// lookup, and the decision whether a confirmed rollback/delete permits cleanup.
export function createMoodboardImageStorage(uploadDir){
  if(typeof uploadDir!=='string'||!path.isAbsolute(uploadDir)||path.resolve(uploadDir)===path.parse(uploadDir).root)throw new TypeError('Invalid moodboard storage directory.');
  const root=path.resolve(uploadDir);
  async function verify(target,expected){
    let handle;
    try{
      handle=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();
      if(!stat.isFile()||stat.size!==expected.length||stat.size>maximum)throw conflict();
      const actual=await handle.readFile();
      if(!actual.equals(expected))throw conflict();
    }catch(error){if(error.code==='ELOOP')throw conflict();throw error;}
    finally{await handle?.close();}
  }
  return Object.freeze({
    async prepare({actorId,requestId,image}){
      if(!Number.isSafeInteger(actorId)||actorId<1||actorId>2147483647||typeof requestId!=='string'
        ||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)
        ||!image||!['jpg','png'].includes(image.extension)||!Buffer.isBuffer(image.buffer)
        ||!image.buffer.length||image.buffer.length>maximum)throw new TypeError('Invalid prepared moodboard image.');
      const bytes=Buffer.from(image.buffer);
      const filename=createHash('sha256').update(`moodboard-image-v1:${actorId}:${requestId.toLowerCase()}`).digest('hex')+`.${image.extension}`;
      const target=path.join(root,filename),temporary=path.join(root,`.stage-${randomUUID()}`);
      await fs.mkdir(root,{recursive:true});
      let handle,created=false;
      try{
        handle=await fs.open(temporary,'wx',0o600);
        await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
        try{await fs.link(temporary,target);created=true;}
        catch(error){if(error.code!=='EEXIST')throw error;await verify(target,bytes);}
        return Object.freeze({filename,created});
      }finally{
        await handle?.close();
        // Staging names can never be requested as assets. A cleanup fault must
        // not erase a linked final file or disguise its ownership from caller.
        await fs.unlink(temporary).catch(()=>{});
      }
    },
    async remove(filename){
      if(!safeName(filename))throw new TypeError('Invalid moodboard asset name.');
      try{await fs.unlink(path.join(root,filename));}catch(error){if(error.code!=='ENOENT')throw error;}
    },
  });
}
