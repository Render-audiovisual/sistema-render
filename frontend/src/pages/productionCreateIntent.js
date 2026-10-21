import {verifiedProductionDraftVisit} from './productionDraft.js';
import {isSessionFailure} from '../shared/session/captured-request.js';

// Memory-only recovery. Leaving this form/session loses the request receipt;
// inspect existing visits before creating again after such a boundary.
export function createProductionCreateIntent({capture,request,randomUUID=()=>globalThis.crypto.randomUUID()}) {
  let intent=null,busy=false,uncertain=false,blocked=false;
  async function send() {
    if(busy)throw new Error('Hay otra creación en curso.');
    if(!intent||blocked)throw new Error('Revisá las visitas guardadas antes de volver a crear.');
    const own=intent;
    busy=true;
    try {
      own.scope.assertCurrent();
      const response=await request(own.body,own.scope);
      own.scope.assertCurrent();
      const visit=verifiedProductionDraftVisit(response);
      intent=null;uncertain=false;return visit;
    } catch(error) {
      if(!own.scope.current()||isSessionFailure(error)||[401,403,409].includes(error?.status)) {blocked=true;uncertain=false;}
      else if(error?.status===400){intent=null;uncertain=false;}
      else uncertain=true;
      throw error;
    } finally {busy=false;}
  }
  return Object.freeze({
    get snapshot(){return Object.freeze({locked:Boolean(intent),busy,uncertain,blocked});},
    async submit(data){
      if(intent||busy)throw new Error('El intento anterior requiere verificación; no crees otra visita.');
      const scope=capture();scope.assertCurrent();
      const requestId=randomUUID();
      if(typeof requestId!=='string'||requestId.length!==36||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId))throw new Error('No se pudo generar un identificador seguro para la creación.');
      const body=JSON.stringify({...data,request_id:requestId});
      intent=Object.freeze({scope,body});blocked=false;uncertain=false;
      return send();
    },
    async verify(){
      if(!uncertain||blocked)throw new Error('No hay una creación pendiente que se pueda verificar.');
      return send();
    },
  });
}
