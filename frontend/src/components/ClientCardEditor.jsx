import React, {useEffect, useRef, useState} from 'react';
import {Modal} from './Modal.jsx';
import {EditarCuotaClienteModal} from './ClienteModals.jsx';
import {useScopedRequest} from '../shared/session/use-scoped-request.js';
import {useNavigationGuard} from '../shared/navigation/useNavigationGuard.js';
import {validMonthlyCount} from '../../../shared/client-monthly-adjustment.mjs';

export function ClientCardEditor({clients,period,session,onClose,onSaved}) {
  const [selected,setSelected]=useState(clients[0]?.id),[mode,setMode]=useState('choose');
  const client=clients.find(item=>item.id===selected);
  if (!client) return null;
  if (mode==='quota'||mode==='actual') return <ClientMonthlyEditor clients={clients} period={period} session={session} kind={mode} onClose={onClose} onBack={()=>setMode('choose')} onSaved={onSaved}/>;
  if (mode==='details') return <EditarCuotaClienteModal sesion={session} cliente={client} periodo={period} onClose={onClose} onBack={()=>setMode('choose')} onGuardado={onSaved}/>;
  if (mode==='logo') return <ClientLogoEditor key={client.id} client={client} session={session} onClose={onClose} onBack={()=>setMode('choose')} onSaved={onSaved}/>;
  return <Modal native className="client-card-dialog" title="Editar cliente" onClose={onClose} overlayAriaLabel="Editar cliente"><div className="modal-body client-card-editor">
    {clients.length>1 ? <label>Cliente<select value={selected} onChange={event=>setSelected(Number(event.target.value))}>{clients.map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label> : <p>{client.nombre}</p>}
    <div className="client-editor-options">
    <button type="button" onClick={()=>setMode('quota')}><span>Cuota mensual</span><small>Cuántos reels y carruseles hay que hacer</small><b aria-hidden="true">→</b></button>
    <button type="button" onClick={()=>setMode('actual')}><span>Contenido realizado</span><small>Corregir la cantidad del mes seleccionado</small><b aria-hidden="true">→</b></button>
    <button type="button" onClick={()=>setMode('details')}><span>Nombre y abono</span><small>Datos del cliente y acuerdo mensual</small><b aria-hidden="true">→</b></button>
    <button type="button" onClick={()=>setMode('logo')}><span>Logo del cliente</span><small>Cargar o reemplazar la imagen</small><b aria-hidden="true">→</b></button></div>
  </div></Modal>;
}
function ClientMonthlyEditor({clients,period,session,kind,onClose,onBack,onSaved}) {
  const first=clients[0],key=first.grupo_feed_id?`grupo-${first.grupo_feed_id}`:`cliente-${first.id}`;
  const {capture}=useScopedRequest(session,`client-monthly:${key}:${period}:${kind}`);
  const [snapshot,setSnapshot]=useState(null),[values,setValues]=useState({reels:'',carruseles:''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
  const pending=useRef(false);
  const validSnapshot=value=>value?.key===key&&value?.period===period&&/^cm1:[a-f0-9]{64}$/.test(value.revision)&&Array.isArray(value.memberIds)&&clients.every(c=>value.memberIds.includes(c.id));
  useEffect(()=>{let active=true;const guard=capture();guard.request(`/api/clientes/${key}/control-mensual?periodo=${period}`).then(value=>{
    guard.assertCurrent();if(!active)return;if(!validSnapshot(value))throw Error('Respuesta inválida');setSnapshot(value);const counts=kind==='quota'?value.quota:value.actual;setValues({reels:counts.reels==null?'':String(counts.reels),carruseles:counts.carruseles==null?'':String(counts.carruseles)});
  }).catch(()=>{if(active&&guard.current())setError('No se pudieron cargar las cantidades. Cerrá y volvé a abrir.');});return()=>{active=false;};},[key,period,kind,capture]);
  const original=snapshot&&(kind==='quota'?snapshot.quota:snapshot.actual);
  const dirty=Boolean(original&&['reels','carruseles'].some(k=>values[k]!==String(original[k]??'')));
  const valid=['reels','carruseles'].every(k=>/^\d+$/.test(values[k])&&validMonthlyCount(Number(values[k])));
  useNavigationGuard(()=>({dirty,busy:pending.current}));
  const close=(destination=onClose)=>{if(pending.current)return;if(dirty&&!window.confirm('¿Salir sin guardar las cantidades?'))return;(typeof destination==='function'?destination:onClose)();};
  const save=async(mode='manual')=>{
    if(pending.current||uncertain||!snapshot||mode!=='automatic'&&!valid)return;
    const guard=capture();if(!guard.current())return;pending.current=true;setBusy(true);setError('');
    const counts={reels:Number(values.reels),carruseles:Number(values.carruseles)};
    try{
      const saved=await guard.request(`/api/clientes/${key}/${kind==='quota'?'cuota-mensual':'contenido-realizado'}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({period,expected_revision:snapshot.revision,...(kind==='quota'?counts:{mode,...(mode==='manual'?counts:{})})})});
      guard.assertCurrent();const result=kind==='quota'?saved.quota:saved.actual;
      if(!validSnapshot(saved)||(mode!=='automatic'&&['reels','carruseles'].some(k=>result?.[k]!==counts[k]))||(kind==='actual'&&saved.mode!==mode))throw Error('Resultado no confirmado');
      await onSaved(saved,guard);
    }catch{if(guard.current()){setUncertain(true);setError('No se pudo confirmar el resultado. Cerrá y volvé a abrir para revisar lo guardado antes de reintentar.');}}
    finally{pending.current=false;if(guard.current())setBusy(false);}
  };
  return <Modal native className="client-card-dialog" title={kind==='quota'?'Cuota mensual':'Contenido realizado'} onClose={close} closeDisabled={busy} overlayAriaLabel="Editar cantidades"><form className="modal-body client-card-editor client-monthly-editor" onSubmit={event=>{event.preventDefault();save();}}>
    <button type="button" className="client-editor-back" disabled={busy} onClick={()=>close(onBack)}>← Volver</button>
    <p>{snapshot?.name||first.nombre} · {period}</p>
    <p>{kind==='quota'?'Cuota habitual, sin cambiar el abono. Si la cuenta pertenece a un grupo, la cuota es compartida.':'Corregí el total de este mes. Se conserva hasta que quites la corrección, sin borrar lo registrado por Instagram.'}</p>
    {kind==='actual'&&<small>Solo ajusta el total mensual; no crea publicaciones ni cambia los reportes semanales.</small>}
    {!snapshot&&!error&&<p role="status">Cargando cantidades…</p>}
    {['reels','carruseles'].map(field=><label key={field}>{field==='reels'?'Reels':'Carruseles'}<input type="number" inputMode="numeric" min="0" max="10000" step="1" required value={values[field]} disabled={!snapshot||busy||uncertain} onChange={event=>{if(!pending.current)setValues(previous=>({...previous,[field]:event.target.value}));}}/></label>)}
    {error&&<p role="alert">{error}</p>}
    <button className="cg-button cg-primary" disabled={!snapshot||busy||uncertain||!valid||(!dirty&&(kind==='quota'||snapshot.mode==='manual'))}>{busy?'Guardando…':'Guardar cantidades'}</button>
    {kind==='actual'&&snapshot?.mode==='manual'&&<button type="button" className="cg-button" disabled={busy||uncertain} onClick={()=>{if(window.confirm('¿Quitar la corrección y volver al conteo registrado automáticamente?'))save('automatic');}}>Quitar corrección manual</button>}
  </form></Modal>;
}
function ClientLogoEditor({client,session,onClose,onBack,onSaved}) {
  const {capture}=useScopedRequest(session,`client-logo:${client.id}`);
  const [logo,setLogo]=useState(client.logo||null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
  const pending=useRef(false),fileGeneration=useRef(0);
  const dirty=logo!==(client.logo||null);
  useNavigationGuard(()=>({dirty,busy:pending.current}));
  const close=(destination=onClose)=>{if(pending.current)return;if(dirty&&!window.confirm('¿Salir sin guardar el logo?'))return;fileGeneration.current++;(typeof destination==='function'?destination:onClose)();};
  const pick=async event=>{
    const file=event.target.files?.[0],generation=++fileGeneration.current,guard=capture(); if(!file||pending.current||uncertain)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>204800){setError('Elegí una imagen PNG, JPG o WebP de hasta 200 KB.');return;}
    setError('');
    const reader=new FileReader();reader.onload=()=>{if(guard.current()&&generation===fileGeneration.current&&!pending.current)setLogo(String(reader.result));};reader.onerror=()=>{if(guard.current())setError('No se pudo leer la imagen.');};reader.readAsDataURL(file);
  };
  const save=async event=>{
    event.preventDefault();if(pending.current||uncertain||!dirty)return;
    const guard=capture();if(!guard.current())return;pending.current=true;setBusy(true);setError('');
    try{
      const saved=await guard.request(`/api/clientes/${client.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({logo,expected_revision:client.agreement_revision})});
      guard.assertCurrent();if(saved.id!==client.id||saved.logo!==logo||saved.agreement_revision===client.agreement_revision)throw Error('No se pudo verificar el guardado.');
      await onSaved(saved,guard);
    }catch(reason){if(guard.current()){setUncertain(true);setError('No se pudo confirmar el resultado. Cerrá y volvé a abrir el cliente para revisar lo guardado antes de reintentar.');}}
    finally{pending.current=false;if(guard.current())setBusy(false);}
  };
  return <Modal native className="client-card-dialog" title={`Logo de ${client.nombre}`} onClose={close} closeDisabled={busy} overlayAriaLabel="Cambiar logo del cliente"><form className="modal-body client-card-editor" onSubmit={save}>
    <button type="button" className="client-editor-back" disabled={busy} onClick={()=>close(onBack)}>← Volver</button>
    <div className="client-logo-area">{logo?<img className="client-logo-preview" src={logo} alt={`Logo de ${client.nombre}`}/>:<span className="client-logo-placeholder" aria-hidden="true">{client.nombre.slice(0,1)}</span>}
    <label className="client-logo-upload"><span>{logo?'Elegir otro logo':'Elegir logo'}</span><input aria-label="Elegir imagen del logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||uncertain} onChange={pick}/></label></div>
    <small>PNG, JPG o WebP · hasta 200 KB</small>
    {logo&&<button type="button" className="cg-button" disabled={busy||uncertain} onClick={()=>{fileGeneration.current++;setLogo(null);}}>Quitar logo</button>}
    {error&&<p role="alert">{error}</p>}
    <button className="cg-button cg-primary" disabled={busy||uncertain||!dirty}>{busy?'Guardando…':'Guardar logo'}</button>
  </form></Modal>;
}
