import React, {useRef, useState} from 'react';
import {Modal} from './Modal.jsx';
import {EditarCuotaClienteModal} from './ClienteModals.jsx';
import {useScopedRequest} from '../shared/session/use-scoped-request.js';
import {useNavigationGuard} from '../shared/navigation/useNavigationGuard.js';

export function ClientCardEditor({clients,period,session,onClose,onSaved}) {
  const [selected,setSelected]=useState(clients[0]?.id),[mode,setMode]=useState('choose');
  const client=clients.find(item=>item.id===selected);
  if (!client) return null;
  if (mode==='details') return <EditarCuotaClienteModal sesion={session} cliente={client} periodo={period} onClose={onClose} onGuardado={onSaved}/>;
  if (mode==='logo') return <ClientLogoEditor key={client.id} client={client} session={session} onClose={onClose} onSaved={onSaved}/>;
  return <Modal native title="Editar cliente" onClose={onClose} overlayAriaLabel="Editar cliente"><div className="modal-body client-card-editor">
    {clients.length>1 ? <label>Cliente<select value={selected} onChange={event=>setSelected(Number(event.target.value))}>{clients.map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label> : <p>{client.nombre}</p>}
    <button type="button" className="cg-button" onClick={()=>setMode('details')}>Nombre y cuotas mensuales</button>
    <button type="button" className="cg-button" onClick={()=>setMode('logo')}>Cambiar logo</button>
  </div></Modal>;
}
function ClientLogoEditor({client,session,onClose,onSaved}) {
  const {capture}=useScopedRequest(session,`client-logo:${client.id}`);
  const [logo,setLogo]=useState(client.logo||null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
  const pending=useRef(false),fileGeneration=useRef(0);
  const dirty=logo!==(client.logo||null);
  useNavigationGuard(()=>({dirty,busy:pending.current}));
  const close=()=>{if(pending.current)return;if(dirty&&!window.confirm('¿Salir sin guardar el logo?'))return;fileGeneration.current++;onClose();};
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
  return <Modal native title={`Logo de ${client.nombre}`} onClose={close} closeDisabled={busy} overlayAriaLabel="Cambiar logo del cliente"><form className="modal-body client-card-editor" onSubmit={save}>
    {logo&&<img className="client-logo-preview" src={logo} alt={`Logo de ${client.nombre}`}/>}
    <label>Imagen<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||uncertain} onChange={pick}/></label>
    <small>PNG, JPG o WebP · hasta 200 KB</small>
    {logo&&<button type="button" className="cg-button" disabled={busy||uncertain} onClick={()=>{fileGeneration.current++;setLogo(null);}}>Quitar logo</button>}
    {error&&<p role="alert">{error}</p>}
    <button className="cg-button cg-primary" disabled={busy||uncertain||!dirty}>{busy?'Guardando…':'Guardar logo'}</button>
  </form></Modal>;
}
