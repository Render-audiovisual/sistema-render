import {canonicalTaskState} from '../constants.js';
import {isSessionFailure} from '../../../shared/session/captured-request.js';
const id=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
export const validTaskOrderRevision=value=>typeof value==='string'&&value.length<=19&&/^[1-9]\d*$/.test(value)&&value.trim()===value&&(value.length<19||value<='9223372036854775807');
export const validTaskOrderSnapshot=value=>typeof value==='string'&&value.length===64&&/^[0-9a-f]{64}$/.test(value);
export function taskOrderInput({task,before=null,orderRevision},requestId){
  if(!id(task?.id)||!id(task?.revision)||!['pendiente','en_progreso','en_revision','aprobada','finalizada'].includes(canonicalTaskState(task?.estado))||!validTaskOrderRevision(orderRevision)
    ||typeof requestId!=='string'||requestId.length!==36||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)
    ||before!==null&&(!id(before?.id)||!id(before?.revision)||before.id===task.id||canonicalTaskState(before.estado)!==canonicalTaskState(task.estado)))throw new Error('Recargá el orden antes de mover esta tarea.');
  return Object.freeze({request_id:requestId,task_id:task.id,expected_revision:task.revision,before_id:before?.id??null,expected_before_revision:before?.revision??null,expected_order_revision:orderRevision});
}
export function verifiedTaskOrderAck(value,input){
  if(!value||value.task_id!==input.task_id||value.before_id!==input.before_id||!validTaskOrderRevision(value.order_revision)||!validTaskOrderRevision(input.expected_order_revision)||typeof value.replayed!=='boolean'||typeof value.changed!=='boolean'
    ||BigInt(value.order_revision)!==BigInt(input.expected_order_revision)+(value.changed?1n:0n))throw new Error('No se pudo confirmar el orden guardado. Verificá el mismo movimiento antes de repetirlo.');
  return {task_id:value.task_id,before_id:value.before_id,order_revision:value.order_revision,replayed:value.replayed,changed:value.changed};
}
// Only explicit verification repeats an uncertain immutable request; never rebase.
export function createTaskManualOrder({capture,randomUUID=()=>globalThis.crypto.randomUUID()}){
  let intent=null,busy=false,status='idle';
  async function send(){
    if(busy||!intent||status==='conflict'||status==='blocked')throw new Error('Revisá y recargá el orden antes de continuar.');
    const own=intent;busy=true;
    try{own.guard.assertCurrent();const result=await own.guard.request('/api/tareas/orden',{method:'POST',headers:{'Content-Type':'application/json'},body:own.body});own.guard.assertCurrent();const ack=verifiedTaskOrderAck(result,own.input);intent=null;status='idle';return ack;}
    catch(error){status=!own.guard.current()||isSessionFailure(error)||[401,403,404,413].includes(error?.status)?'blocked':error?.status===409||error?.status===400?'conflict':'uncertain';throw error;}
    finally{busy=false;}
  }
  return Object.freeze({
    get snapshot(){return Object.freeze({busy,status,locked:Boolean(intent)});},
    async move(selection){if(busy||intent)throw new Error('Hay un movimiento pendiente de revisión.');const guard=capture();guard.assertCurrent();const input=taskOrderInput(selection,randomUUID());intent=Object.freeze({guard,input,body:JSON.stringify(input)});return send();},
    async verify(){if(status!=='uncertain')throw new Error('No hay un movimiento incierto para verificar.');return send();},
    reset(){if(busy)throw new Error('Esperá a que termine el movimiento.');intent=null;status='idle';},
  });
}
// Down is before the next loaded card AFTER the immediate neighbour. At the
// loaded boundary there is no inferred global end; use the explicit end action.
export function taskOrderArrowAnchor(items,index,direction){
  if(!Array.isArray(items)||!Number.isInteger(index)||index<0||index>=items.length)return undefined;
  if(direction==='up')return index>0?items[index-1]:undefined;
  if(direction==='down')return index+2<items.length?items[index+2]:undefined;
  return undefined;
}
