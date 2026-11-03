import React,{useEffect,useState} from 'react';
import {useScopedRequest} from '../shared/session/use-scoped-request.js';
import {isSessionFailure} from '../shared/session/captured-request.js';
import './MetaConnectionStatus.css';

export function MetaConnectionTables({data}){
 const scopes=new Set(data.scopes),tasks=['MESSAGING','MODERATE','ADVERTISE','ANALYZE','CREATE_CONTENT'];
 const status=(ok,yes='Presente',no='Falta')=><span className={ok?'meta-state-ok':'meta-state-missing'}>{ok?yes:no}</span>;
 return <>
  <dl className="meta-connection-summary"><div><dt>Token</dt><dd>{data.valido===null?'Sin comprobar':status(data.valido,'Válido','Inválido')}</dd></div>
   <div><dt>Vencimiento</dt><dd>{data.sin_vencimiento?'Sin vencimiento informado':data.vence_at?new Intl.DateTimeFormat('es-AR',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Argentina/Cordoba'}).format(new Date(data.vence_at)):'No disponible'}</dd></div></dl>
  {!data.configurado&&<p role="alert">Configurá META_SYSTEM_USER_TOKEN en Hostinger.</p>}
  {data.errores.length>0&&data.configurado&&<p role="alert">No se pudieron comprobar todas las secciones. Los resultados no disponibles no confirman permisos.</p>}
  <h3>Permisos del token</h3>
  <div className="meta-table-scroll"><table><thead><tr><th>Permiso esperado</th><th>Estado</th></tr></thead><tbody>{data.scopes_esperados.map(scope=><tr key={scope}><th scope="row">{scope}</th><td>{data.valido===null?'Sin comprobar':status(scopes.has(scope))}</td></tr>)}</tbody></table></div>
  <details><summary>Todos los permisos informados ({data.scopes.length})</summary><ul>{data.scopes.map(scope=><li key={scope}>{scope}</li>)}</ul></details>
  <h3>Páginas</h3>
  {data.paginas_estado!=='ok'?<p>No disponibles.</p>:!data.paginas.length?<p>No se encontraron páginas accesibles.</p>:
   <div className="meta-table-scroll"><table><thead><tr><th>Página</th><th>Instagram</th>{tasks.map(t=><th key={t}>{t}</th>)}</tr></thead>
    <tbody>{data.paginas.map(page=><tr key={page.id}><th scope="row">{page.nombre}</th><td>{page.tiene_instagram?'Sí':'No'}</td>{tasks.map(t=><td key={t}>{page.tasks_informadas===false?<span className="meta-state-missing">No informado</span>:status(page.tasks.includes(t))}</td>)}</tr>)}</tbody></table></div>}
  <h3>Cuentas publicitarias</h3>
  {data.cuentas_publicitarias_estado!=='ok'?<p>No disponibles.</p>:!data.cuentas_publicitarias.length?<p>No se encontraron cuentas accesibles.</p>:
   <div className="meta-table-scroll"><table><thead><tr><th>Cuenta</th><th>ID</th><th>Estado Meta</th></tr></thead><tbody>{data.cuentas_publicitarias.map(account=><tr key={account.id}><th scope="row">{account.nombre}</th><td>{account.id}</td><td>{account.account_status??'No informado'}</td></tr>)}</tbody></table></div>}
 </>;
}

function ConnectionContent({sesion}){
 const [data,setData]=useState(null),[error,setError]=useState(false);
 const {capture}=useScopedRequest(sesion,'instagram-connection-status');
 useEffect(()=>{
  const guard=capture(),controller=new AbortController();
  guard.request('/api/instagram/conexion/estado',{cache:'no-store',signal:controller.signal}).then(value=>{
   if(guard.current()&&!controller.signal.aborted)setData(value);
  }).catch(reason=>{if(guard.current()&&!controller.signal.aborted&&!isSessionFailure(reason))setError(true);});
  return()=>controller.abort();
 },[capture]);
 return <section className="meta-connection" aria-label="Estado de conexión Meta"><h2>Estado de conexión Meta</h2>
  {error?<p role="alert">No se pudo consultar la conexión. Cerrá y volvé a abrir el diagnóstico.</p>:!data?<p role="status">Consultando Meta…</p>:<MetaConnectionTables data={data}/>}</section>;
}

export function MetaConnectionStatus({sesion}){
 const [open,setOpen]=useState(false);
 if(sesion?.usuario?.rol!=='admin')return null;
 return <div className="meta-connection-access"><button type="button" className="meta-connection-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Estado de conexión Meta</button>
  {open&&<ConnectionContent sesion={sesion}/>}</div>;
}
