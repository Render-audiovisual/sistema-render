import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { canReadEditorialControl } from './homeEditorialControl.js';
import { createEditorialPieceDetailLoader } from './editorialPieceDetail.js';

const fields = [['idea', 'Idea'], ['copy', 'Copy'], ['material_referencia', 'Material de referencia'], ['aclaraciones', 'Aclaraciones']];
export function EditorialPieceDetails({ piece, sesion, request = apiRequest }) {
  const id = piece.id, domain = piece.domain, clientId = piece.cliente.id;
  const userId = sesion?.usuario?.id, role = sesion?.usuario?.rol, active = sesion?.usuario?.activo, token = sesion?.token;
  const identity = useMemo(() => ({ id, domain, clientId, userId, role, active, token }), [id, domain, clientId, userId, role, active, token]);
  const identityRef = useRef(identity); identityRef.current = identity;
  const loaderRef = useRef(null);
  const [open, setOpen] = useState(false), [result, setResult] = useState(null);
  const allowed = canReadEditorialControl(sesion);
  const current = result?.identity === identity ? result : null;
  useEffect(() => {
    if (!open || !allowed) return undefined;
    const loader = createEditorialPieceDetailLoader({ piece: { domain, id, cliente: { id: clientId }, estado: piece.estado, fecha_programada: piece.fecha_programada },
      sesion: { token, usuario: { id: userId, rol: role, activo: active } }, request, readSession: getSesion,
      onChange: state => { if (identityRef.current === identity) setResult({ ...state, identity }); } });
    loaderRef.current = loader; void loader.refresh();
    return () => { loader.dispose(); if (loaderRef.current === loader) loaderRef.current = null; };
  }, [open, allowed, identity, request, domain, id, clientId, userId, role, active, token, piece.estado, piece.fecha_programada]);
  if (!allowed) return null;
  return <details className="qh-piece-detail" onToggle={event => {
    const next = event.currentTarget.open;
    if (next) setResult(null);
    setOpen(next);
  }}>
    <summary>Ver contenido y aclaraciones</summary>
    {open && <div>
      {(!current || current.status === 'loading') && <p role="status">Consultando pieza…</p>}
      {current?.error && <div role="alert"><p>{current.error}</p><button type="button" onClick={() => { void loaderRef.current?.refresh(); }}>Reintentar detalle</button></div>}
      {current?.data && <><p>{domain === 'historia' ? 'Historia' : 'Publicación'} #{id} · {current.data.piece.cliente.nombre}</p>
        <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{current.data.content[key] || 'Sin contenido registrado.'}</dd></div>)}</dl>
      </>}
    </div>}
  </details>;
}
