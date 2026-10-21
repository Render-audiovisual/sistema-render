import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { blankMonthlyAgreementDraft, canStartMonthlyAgreement, createMonthlyAgreementOperation, MONTHLY_AGREEMENT_DESIGNERS } from './monthlyAgreement.js';
import './StartMonthlyAgreementModal.css';

const WEEKDAYS=[[1,'Lun'],[2,'Mar'],[3,'Mié'],[4,'Jue'],[5,'Vie'],[6,'Sáb'],[0,'Dom']];
function AgreementDays({label,value,disabled,onChange}){
 return <fieldset className="sma-days" disabled={disabled}><legend>{label}</legend><div>{WEEKDAYS.map(([day,name])=><label key={day}><input type="checkbox" checked={value.includes(day)} onChange={()=>onChange(value.includes(day)?value.filter(item=>item!==day):[...value,day])}/><span>{name}</span></label>)}</div></fieldset>;
}
export function StartMonthlyAgreementModal({sesion,clientId,...props}){
 const {view,capture,epoch}=useScopedRequest(sesion,`primer-acuerdo:${clientId}`);
 return <StartMonthlyAgreementSession key={`${view.key}:${epoch}`} {...props} clientId={clientId} allowed={canStartMonthlyAgreement(view.session)} capture={capture}/>;
}
function StartMonthlyAgreementSession({clientId,allowed,capture,onClose,onSaved,onAccessDenied}){
 const [state,setState]=useState({status:'idle',context:null,result:null,error:'',busy:false,attempted:false});
 const [draft,setDraft]=useState(blankMonthlyAgreementDraft),[acknowledged,setAcknowledged]=useState(false),[confirmClose,setConfirmClose]=useState(false),[callbackError,setCallbackError]=useState('');
 const operationRef=useRef(null),closing=useRef(false),publishing=useRef(false),denialNotified=useRef(false);
 const operation={get snapshot(){return operationRef.current?.snapshot||{status:'idle',busy:false,attempted:false};},load:()=>operationRef.current?.load(),submit:(...args)=>operationRef.current?.submit(...args)};
 const dirty=JSON.stringify(draft)!==JSON.stringify(blankMonthlyAgreementDraft())||acknowledged;
 const monthlyAgreementNavigationStatus=()=>{
  if(!capture().current()||operation.snapshot.status==='denied')return{dirty:false,busy:false};
  return{dirty:dirty||operation.snapshot.attempted,busy:operation.snapshot.busy||publishing.current||closing.current};
 };
 useNavigationGuard(monthlyAgreementNavigationStatus);
 useEffect(()=>{
  const current=createMonthlyAgreementOperation({clientId,capture,onChange:setState});operationRef.current=current;
  if(allowed)void current.load();
  return()=>{current.dispose();if(operationRef.current===current)operationRef.current=null;};
 },[allowed,capture,clientId]);
 useEffect(()=>{
  if(state.status!=='denied')return;
  setDraft(blankMonthlyAgreementDraft());setAcknowledged(false);setConfirmClose(false);setCallbackError('');
  const guard=capture();if(!denialNotified.current&&guard.current()){denialNotified.current=true;onAccessDenied?.(guard);}
 },[state.status,capture,onAccessDenied]);
 const canChange=()=>capture().current()&&operation.snapshot.status==='ready'&&!publishing.current&&!closing.current&&!confirmClose;
 const change=(field,value)=>{if(!canChange())return;setDraft(current=>({...current,[field]:value}));setAcknowledged(false);};
 const closeNow=async()=>{
  const guard=capture();if(!guard.current()||operation.snapshot.busy||publishing.current||closing.current)return;
  closing.current=true;setCallbackError('');
  try{await onClose?.(guard,{refresh:operation.snapshot.attempted||operation.snapshot.status==='ineligible'});}
  catch{if(guard.current()){closing.current=false;setCallbackError('No se pudo actualizar la cartera. El acuerdo no se volverá a enviar. Cerrá y revisá la versión guardada.');}}
 };
 const closeSafely=()=>{
  if(!capture().current()||operation.snapshot.busy||publishing.current||closing.current)return;
  if(operation.snapshot.status!=='denied'&&operation.snapshot.status!=='saved'&&(dirty||operation.snapshot.attempted)){setConfirmClose(true);return;}
  void closeNow();
 };
 const submit=async event=>{
  event.preventDefault();if(!allowed||!capture().current()||publishing.current||closing.current)return;
  const result=await operation.submit(draft,acknowledged);if(!result)return;
  const {cliente,guard}=result;if(!guard.current())return;
  publishing.current=true;
  try{await onSaved?.(cliente,guard);guard.assertCurrent();setDraft(blankMonthlyAgreementDraft());setAcknowledged(false);}
  catch{if(guard.current())setCallbackError('El acuerdo se guardó, pero no se pudo actualizar la vista. Cerrá y revisá la cartera; no vuelvas a enviarlo.');}
  finally{publishing.current=false;}
 };
 if(!allowed||state.status==='denied')return <Modal title="Acceso no disponible" onClose={closeSafely} className="start-monthly-agreement"><div className="sma-body"><p>Se retiraron los datos de esta configuración. Sólo administración puede iniciar acuerdos mensuales.</p></div></Modal>;
 const locked=state.status!=='ready'||state.busy||confirmClose;
 return <Modal title="Configurar acuerdo mensual" overlayAriaLabel="Configurar primer acuerdo mensual" onClose={closeSafely} className="start-monthly-agreement">
  <div className="sma-body">
   {state.context&&<header><h2>{state.context.cliente.nombre}</h2><p>Cliente #{clientId} · primer acuerdo mensual</p></header>}
   {(state.status==='idle'||state.status==='loading')&&<p role="status">Verificando que el cliente pueda iniciar un acuerdo…</p>}
   {state.status==='error'&&<button type="button" onClick={()=>void operation.load()}>Reintentar consulta</button>}
   {state.error&&<p role="alert" className="sma-error">{state.error}</p>}
   {callbackError&&<p role="alert" className="sma-error">{callbackError}</p>}
   {state.status==='saved'?<section role="status"><h2>Acuerdo mensual guardado</h2><p>Inicio: {state.result.fecha_inicio}.</p><dl className="sma-saved-details"><div><dt>Cuota mensual acordada</dt><dd>{state.result.cuota_reels} reels · {state.result.cuota_carruseles} carruseles</dd></div><div><dt>Abono mensual acordado · ARS</dt><dd>{new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(state.result.abono_mensual))}</dd></div></dl><p>Abono acordado; no es un pago registrado. Esta operación no crea tareas, publicaciones ni pagos.</p><button type="button" onClick={closeSafely}>Cerrar y revisar cartera</button></section>:state.context&&<form onSubmit={submit}>
    <p>Elegí todos los valores, incluso los importes y cuotas que sean 0. El mes elegido inicia el acuerdo mensual; no cambia el nombre ni el estado del cliente.</p>
    <div className="sma-fields">
     <label>Mes de inicio<input type="month" required disabled={locked} value={draft.vigente_desde} onChange={event=>change('vigente_desde',event.target.value)}/></label>
     <label>Rubro<input required maxLength={200} disabled={locked} value={draft.rubro} onChange={event=>change('rubro',event.target.value)}/></label>
     <label>Reels por mes<input type="text" inputMode="numeric" required disabled={locked} value={draft.cuota_reels} onChange={event=>change('cuota_reels',event.target.value)}/></label>
     <label>Carruseles por mes<input type="text" inputMode="numeric" required disabled={locked} value={draft.cuota_carruseles} onChange={event=>change('cuota_carruseles',event.target.value)}/></label>
     <label>Abono mensual en ARS<input type="text" inputMode="decimal" required disabled={locked} value={draft.abono_mensual} onChange={event=>change('abono_mensual',event.target.value)}/><small>Usá punto decimal. Ingresá 0 si no hay importe.</small></label>
     <label>Referencia de diseño<select required disabled={locked} value={draft.disenador_responsable} onChange={event=>change('disenador_responsable',event.target.value)}><option value="">Elegir referencia</option>{MONTHLY_AGREEMENT_DESIGNERS.map(name=><option key={name} value={name}>{name}</option>)}</select><small>Referencia de configuración; no asigna permisos ni responsables de tareas.</small></label>
    </div>
    <AgreementDays label="Días de historias · elegí al menos uno" value={draft.dias_historias} disabled={locked} onChange={value=>change('dias_historias',value)}/>
    <AgreementDays label="Días de reels · pueden quedar vacíos" value={draft.dias_reels} disabled={locked} onChange={value=>change('dias_reels',value)}/>
    <AgreementDays label="Días de carruseles · pueden quedar vacíos" value={draft.dias_carruseles} disabled={locked} onChange={value=>change('dias_carruseles',value)}/>
    <label className="sma-ack"><input type="checkbox" checked={acknowledged} disabled={locked} onChange={event=>{if(canChange())setAcknowledged(event.target.checked);}}/><span>Revisé el mes de inicio, las cuotas, el abono y los días. Confirmo iniciar este acuerdo mensual sin crear tareas ni pagos.</span></label>
    <footer><button type="button" disabled={state.busy} onClick={closeSafely}>Cancelar</button><button type="submit" disabled={locked||!acknowledged}>{state.busy?'Guardando…':'Iniciar acuerdo mensual'}</button></footer>
   </form>}
   {state.status==='ineligible'&&<button type="button" onClick={closeSafely}>Cerrar y revisar cartera</button>}
   {confirmClose&&<section className="sma-recovery" aria-label="Confirmar cierre"><p>{state.attempted?'El envío puede haberse guardado aunque no recibimos confirmación. Se cerrará esta revisión y se actualizará la cartera, sin repetir el POST.':'Se descartará este borrador sin enviar.'}</p><div><button type="button" onClick={()=>{if(!operation.snapshot.busy&&!closing.current)setConfirmClose(false);}}>Conservar borrador</button><button type="button" onClick={()=>void closeNow()}>Cerrar y revisar cartera</button></div></section>}
  </div>
 </Modal>;
}
