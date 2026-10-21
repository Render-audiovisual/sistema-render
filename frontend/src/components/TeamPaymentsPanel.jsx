import React, { useEffect, useRef, useState } from 'react';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { blankTeamPaymentDraft, createTeamPaymentsController, formatTeamPaymentARS, parseTeamPayment, teamPaymentToday, validPaymentPeriod } from './teamPayments.js';
import './TeamPaymentsPanel.css';

export function TeamPaymentsPanel({sesion,disabled=false,onActivityChange}){
 const {view,capture,epoch}=useScopedRequest(sesion,'team-payments');
 if(view.role!=='admin'||!view.binding)return null;
 return <PaymentsSession key={`${view.key}:${epoch}`} actorId={view.id} capture={capture} disabled={disabled} onActivityChange={onActivityChange}/>;
}
function PaymentReadback({payment}){
 return <><strong>{payment.recipient_name} · #{payment.recipient_id}</strong><p>{formatTeamPaymentARS(payment.importe)} · {payment.status==='voided'?'Registro anulado':'Registrado manualmente'}</p><dl><div><dt>Fecha real del pago</dt><dd>{payment.fecha_pago}</dd></div><div><dt>Mes de trabajo</dt><dd>{payment.periodo_trabajo}</dd></div><div><dt>Registró</dt><dd>{payment.recorded_by_name} · #{payment.recorded_by_id}</dd></div><div><dt>Referencia</dt><dd>{payment.referencia}</dd></div></dl>{payment.drive_url&&<a href={payment.drive_url} target="_blank" rel="noopener noreferrer">Ver comprobante en Drive</a>}{payment.status==='voided'&&<p>Motivo: {payment.void_reason} · anuló #{payment.voided_by_id} · {payment.voided_at}</p>}</>;
}
function PaymentsSession({actorId,capture,disabled,onActivityChange}){
 const [period,setPeriod]=useState(()=>teamPaymentToday().slice(0,7));
 const [state,setState]=useState({status:'idle',recipients:[],list:null,result:null,error:'',busy:false,uncertain:false,locked:false,hasIntent:false});
 const [mode,setMode]=useState(null),[draft,setDraft]=useState(blankTeamPaymentDraft),[reason,setReason]=useState(''),[attestation,setAttestation]=useState(false),[confirmClose,setConfirmClose]=useState(false);
 const controller=useRef(null),claimed=useRef(false),activity=useRef(onActivityChange);activity.current=onActivityChange;
 const confirmationRef=useRef(null),focusedResult=useRef(null);
 const snapshot=()=>controller.current?.snapshot||state;
 const dirty=JSON.stringify(draft)!==JSON.stringify(blankTeamPaymentDraft())||reason!==''||attestation||snapshot().hasIntent;
 const paymentNavigationStatus=()=>!capture().current()||snapshot().status==='denied'?{dirty:false,busy:false}:{dirty:Boolean(dirty),busy:snapshot().status==='writing'};
 useNavigationGuard(paymentNavigationStatus);
 useEffect(()=>{const current=createTeamPaymentsController({actorId,capture,onChange:setState});controller.current=current;return()=>{current.dispose();if(controller.current===current)controller.current=null;if(claimed.current){claimed.current=false;activity.current?.(false);}};},[capture,actorId]);
 useEffect(()=>{void controller.current?.load(period);},[period,capture,actorId]);
 useEffect(()=>{if(state.status==='denied'){setDraft(blankTeamPaymentDraft());setReason('');setAttestation(false);setMode(null);setConfirmClose(false);if(claimed.current){claimed.current=false;activity.current?.(false);}}},[state.status]);
 useEffect(()=>{
  if(state.status!=='confirmed'||!state.result||focusedResult.current===state.result||!confirmationRef.current||!capture().current())return;
  focusedResult.current=state.result;confirmationRef.current.focus({preventScroll:true});confirmationRef.current.scrollIntoView({block:'start',behavior:'auto'});
 },[state.status,state.result,capture]);
 const claim=()=>{if(!capture().current()||disabled)return false;if(!claimed.current&&activity.current?.(true)===false)return false;claimed.current=true;return true;};
 const openCreate=()=>{if(snapshot().status!=='ready'||!claim())return;setDraft(blankTeamPaymentDraft());setReason('');setAttestation(false);setMode({kind:'create'});};
 const openVoid=row=>{if(snapshot().status!=='ready'||row.status!=='recorded'||!claim())return;setMode({kind:'void',payment:Object.freeze(parseTeamPayment(row))});setReason('');setAttestation(false);};
 const change=(key,value)=>{if(!capture().current()||disabled||snapshot().busy||snapshot().hasIntent||!claimed.current)return;setDraft(current=>({...current,[key]:value}));setAttestation(false);};
 const submit=async event=>{event.preventDefault();if(!mode||disabled||!claim())return;if(mode.kind==='create')await controller.current?.create(draft,attestation);else await controller.current?.voidPayment(mode.payment,reason,attestation);};
 const finish=()=>{if(!capture().current()||snapshot().busy||snapshot().uncertain)return;if(!controller.current?.reset())return;setMode(null);setDraft(blankTeamPaymentDraft());setReason('');setAttestation(false);setConfirmClose(false);if(claimed.current){claimed.current=false;activity.current?.(false);}void controller.current?.load(period);};
 const cancel=()=>{if(!capture().current()||snapshot().busy||snapshot().uncertain)return;if(dirty&&snapshot().status!=='confirmed'){setConfirmClose(true);return;}finish();};
 if(state.status==='denied')return <section className="team-payments finance-panel"><h2>Pagos registrados manualmente</h2><p role="alert">Se retiraron los datos. Sólo administración puede consultar y registrar pagos.</p></section>;
 const frozen=disabled||state.busy||state.hasIntent||confirmClose;
 const list=state.list?.periodo===period&&!state.hasIntent?state.list:null;
 return <section className="team-payments finance-panel" aria-label="Registro manual de pagos al equipo">
  <header><div><span className="section-label">REGISTRO MANUAL · ARS</span><h2>Pagos registrados manualmente</h2><p>No son sueldos calculados ni una confirmación bancaria automática. Registrar o anular no transfiere dinero.</p></div><label>Mes de pago real<input type="month" value={period} disabled={disabled||Boolean(mode)||state.busy||state.hasIntent} onChange={event=>{if(capture().current()&&!claimed.current&&!snapshot().busy&&validPaymentPeriod(event.target.value))setPeriod(event.target.value);}}/></label></header>
  {disabled&&<p role="status">Terminá o descartá la edición del contrato financiero antes de editar pagos.</p>}
  {state.error&&<p role="alert">{state.error}</p>}
  {state.status==='loading'&&<p role="status">Consultando registros del mes de pago {period}…</p>}
  {state.status==='error'&&<button type="button" disabled={disabled} onClick={()=>void controller.current?.load(period)}>Reintentar lectura</button>}
  {state.status==='confirmed'&&state.result&&<section className="tp-recovery tp-confirmation" role="status" ref={confirmationRef} tabIndex={-1}><h3>{state.result.replayed?'Envío encontrado · versión actual':'Registro confirmado'}</h3><PaymentReadback payment={state.result.payment}/><p>Es un registro manual, no una verificación del banco. La proyección de sueldos no cambió.</p><button type="button" onClick={finish}>Cerrar revisión y actualizar listado</button></section>}
  {state.uncertain&&<section className="tp-recovery"><p>Se conserva la clave en esta pestaña. Salir o cambiar de cuenta puede perder la recuperación. No inicies otro registro para sustituir un envío incierto.</p><button type="button" disabled={state.busy||disabled} onClick={()=>{if(capture().current()&&claim())void controller.current?.verify();}}>Verificar envío con la misma clave</button></section>}
  {state.status==='conflict'&&<button type="button" onClick={cancel}>Cerrar y recargar antes de otra acción</button>}
  {mode&&state.status!=='confirmed'&&<form onSubmit={submit} className="tp-editor">
   <h3>{mode.kind==='create'?'Registrar un pago ya realizado':'Anular registro observado'}</h3>
   {mode.kind==='create'?<div className="tp-fields">
    <label>Persona destinataria<select value={draft.recipient_id} required disabled={frozen} onChange={event=>change('recipient_id',event.target.value)}><option value="">Elegir persona por ID</option>{state.recipients.map(person=><option key={person.id} value={person.id}>{person.nombre} · {person.usuario} · #{person.id}</option>)}</select></label>
    <label>Fecha real del pago<input type="date" required value={draft.fecha_pago} max={teamPaymentToday()} disabled={frozen} onChange={event=>change('fecha_pago',event.target.value)}/></label>
    <label>Mes de trabajo al que corresponde<input type="month" required value={draft.periodo_trabajo} disabled={frozen} onChange={event=>change('periodo_trabajo',event.target.value)}/></label>
    <label>Importe pagado · ARS<input type="text" inputMode="decimal" required value={draft.importe} disabled={frozen} onChange={event=>change('importe',event.target.value)}/><small>Importe positivo explícito; usá punto decimal. No se toma del sueldo calculado.</small></label>
    <label>Referencia del pago<textarea required value={draft.referencia} maxLength={500} disabled={frozen} onChange={event=>change('referencia',event.target.value)}/></label>
    <label>Comprobante en Drive · opcional<input type="url" value={draft.drive_url} disabled={frozen} onChange={event=>change('drive_url',event.target.value)}/><small>HTTPS, drive.google.com, sin credenciales ni puerto.</small></label>
   </div>:<><PaymentReadback payment={mode.payment}/><p>Anular conserva el registro original y su auditoría. No revierte una transferencia bancaria. Una corrección posterior requiere otro registro manual explícito.</p><label>Motivo de anulación<textarea required value={reason} maxLength={500} disabled={frozen} onChange={event=>{if(!snapshot().hasIntent&&!snapshot().busy&&capture().current()){setReason(event.target.value);setAttestation(false);}}}/></label></>}
   <label className="tp-ack"><input type="checkbox" checked={attestation} disabled={frozen} onChange={event=>{if(capture().current()&&!snapshot().hasIntent&&!snapshot().busy)setAttestation(event.target.checked);}}/><span>{mode.kind==='create'?'Confirmo que este pago fue realizado y que sus datos son correctos. Es una declaración manual, no una confirmación del proveedor.':'Confirmo anular sólo este registro observado, sin revertir movimientos bancarios.'}</span></label>
   <div className="tp-actions">{!state.uncertain&&<button type="button" disabled={state.busy} onClick={cancel}>Cancelar revisión</button>}<button type="submit" disabled={frozen||!attestation}>{state.status==='writing'?'Enviando…':mode.kind==='create'?'Registrar pago manual':'Anular registro'}</button></div>
  </form>}
  {confirmClose&&<section className="tp-recovery"><p>Se descartará este borrador. Si el servidor rechazó la operación, se recargará el listado antes de cualquier nueva acción.</p><div className="tp-actions"><button type="button" onClick={()=>setConfirmClose(false)}>Conservar borrador</button><button type="button" onClick={finish}>Descartar y recargar</button></div></section>}
  {!mode&&state.status==='ready'&&<div className="tp-actions"><button type="button" disabled={disabled} onClick={openCreate}>Registrar pago manual</button><button type="button" disabled={disabled} onClick={()=>void controller.current?.load(period)}>Actualizar registros</button></div>}
  {list&&<><p className="tp-total">Total manual registrado vigente en {period}: <strong>{formatTeamPaymentARS(list.total_recorded_ars)}</strong></p><p>Se incluyen las anulaciones en el historial, pero no en el total.</p><ul className="tp-list">{list.items.map(payment=><li key={payment.id}><h3>Registro #{payment.id} · {payment.status==='voided'?'Anulado':'Registrado'}</h3><PaymentReadback payment={payment}/>{payment.status==='recorded'&&<button type="button" disabled={disabled||Boolean(mode)||state.busy} onClick={()=>openVoid(payment)}>Anular registro #{payment.id}</button>}</li>)}</ul>{!list.items.length&&<p>No hay pagos manuales registrados para este mes. Esto no indica que el sueldo calculado sea cero.</p>}</>}
  {state.hasIntent&&<p>El listado requiere una nueva lectura después de resolver este envío. No se ajustan importes ni estados de la proyección salarial.</p>}
 </section>;
}
