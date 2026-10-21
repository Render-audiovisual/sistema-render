import {verifiedDriveUpload} from './drive-api.js';

// Memory-only, original scope and exact selected File objects. No lookup by
// title/name establishes whether an ambiguous request committed.
export function createUploadRecovery({capture,upload,onConfirmed=()=>{}}){
  let scope=null,entries=null,options=null,busy=false,blocked=false;
  const snapshot=()=>Object.freeze({busy,blocked,confirmed:entries?.filter(entry=>entry.phase==='confirmed').map(entry=>entry.result)??[],entries:entries?.map(entry=>({key:entry.key,phase:entry.phase,result:entry.result??null}))??[]});
  async function run(selected,nextOptions,onProgress){
    if(busy||blocked)throw new Error('Revisá el intento anterior en Drive. No se volverá a enviar automáticamente.');
    if(!entries){scope=capture();scope.assertCurrent();entries=selected.map((item,index)=>({key:item.id??index,file:item.file,phase:'unsent',result:null}));options=Object.freeze({...nextOptions});}
    else if(selected.length!==entries.length||selected.some((item,index)=>item.file!==entries[index].file))throw new Error('Este intento conserva sus archivos originales. No se cambiará su destino ni contenido.');
    scope.assertCurrent();busy=true;
    try{
      for(const [index,entry]of entries.entries()){
        if(entry.phase==='confirmed')continue;
        scope.assertCurrent();entry.phase='sending';
        let result;
        try{result=await upload(entry.file,{...options,duplicateAction:nextOptions.duplicateAction??options.duplicateAction,isActive:scope.current,onProgress:value=>{scope.assertCurrent();onProgress?.(value,index,entries.length);scope.assertCurrent();}});scope.assertCurrent();verifiedDriveUpload(result);}
        catch(error){if(!scope.current())throw error;const rejected=error.uploadStage==='init'&&((error.status===409&&error.code==='DRIVE_DUPLICATE_REJECTED')||(error.retryable!==false&&[400,413,422].includes(error.status)));entry.phase=rejected?'rejected':'uncertain';blocked=!rejected;throw error;}
        entry.result=result;entry.phase='confirmed';
        try{onConfirmed(result,snapshot().confirmed,scope);}catch(error){blocked=true;throw error;}
      }
      return snapshot().confirmed;
    }finally{busy=false;}
  }
  return Object.freeze({get snapshot(){return snapshot();},get scope(){return scope;},run,
    async refresh(read){if(busy||!scope)throw new Error('No hay una lectura disponible para este intento.');scope.assertCurrent();busy=true;try{const result=await read(scope);scope.assertCurrent();return result;}finally{busy=false;}},
  });
}
