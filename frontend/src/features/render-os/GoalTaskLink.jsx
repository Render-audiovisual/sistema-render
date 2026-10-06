import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from './services/render-os-api.js';
import './GoalTaskLink.css';

function LinkDialog({ task, onClose }) {
  const initialPeriod = task.propiedades_extra?.objetivo_periodo || String(task.fecha_vencimiento || '').slice(0, 7) ||
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit' }).format(new Date());
  const [period, setPeriod] = useState(initialPeriod);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const dialog = useRef(null);
  const submitLock = useRef(false);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const outer = document.querySelector('.ros-task-workspace');
    const wasInert = outer?.inert;
    if (outer) outer.inert = true;
    dialog.current?.querySelector('button')?.focus();
    return () => { if (outer) outer.inert = wasInert; previousFocus?.focus?.({ preventScroll:true }); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null); setSelected('');
    apiRequest(`/api/cliente-objetivos/tareas/${task.id}/vinculo?periodo=${encodeURIComponent(period)}`, {signal:controller.signal})
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [task.id, period]);

  const slot = data?.casilleros.find(item => item.id === Number(selected));
  const handleKeys = event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); if (!submitLock.current) onClose(); }
    if (event.key === 'Tab') {
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  const submit = async event => {
    event.preventDefault();
    if (!slot || submitLock.current) return;
    submitLock.current = true; setSaving(true); setError('');
    try {
      const value = await apiRequest(`/api/cliente-objetivos/piezas/${slot.id}/vincular`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ tarea_id:task.id,
          expected_tarea_updated_at:data.tarea.updated_at, expected_pieza_updated_at:slot.updated_at }) });
      setResult(value);
    } catch (reason) { setError(reason.message); }
    finally { submitLock.current = false; setSaving(false); }
  };

  return createPortal(<div className="ros-goal-overlay" onClick={event => event.stopPropagation()} onKeyDown={handleKeys}>
    <section ref={dialog} className="ros-goal-dialog" role="dialog" aria-modal="true" aria-labelledby="ros-goal-dialog-title">
      <header><div><small>Objetivo mensual</small><h2 id="ros-goal-dialog-title">Vincular esta tarea</h2></div>
        <button type="button" aria-label="Cerrar vinculación" disabled={saving} onClick={onClose}>×</button></header>
      <p className="ros-goal-source">{task.titulo}<small>Tarea #{task.id} · {task.cliente_nombre}</small></p>
      {result ? <div role="status" className="ros-goal-success"><strong>✓ Tarea vinculada a {result.tipo === 'video' ? 'Reel' : 'Carrusel'} {result.numero}</strong>
        <p>{result.completadas} de {result.total} {result.tipo === 'video' ? 'reels' : 'carruseles'} completados en {result.periodo}.</p>
        <p>Las cantidades del objetivo no cambiaron. La tarea inicial{result.tarea_anterior_id ? ` #${result.tarea_anterior_id}` : ''} se conserva fuera de este casillero.</p>
        <a href={`/clientes?periodo=${result.periodo}`}>Ver avance del cliente →</a><button type="button" onClick={onClose}>Listo</button></div>
        : <form onSubmit={submit}>
          <label>Mes de trabajo<input aria-label="Mes del objetivo" type="month" min="2026-10" required value={period} disabled={saving} onChange={event => setPeriod(event.target.value)}/></label>
          {loading && <p role="status">Cargando casilleros disponibles…</p>}
          {error && <p role="alert" className="ros-goal-error">{error}</p>}
          {data?.vinculo_actual ? <p role="status">Esta pieza ya cuenta como {data.vinculo_actual.tipo === 'video' ? 'Reel' : 'Carrusel'} {data.vinculo_actual.numero} en {data.vinculo_actual.periodo}. No se contabilizará dos veces.</p>
            : data && <>
              <label>Casillero pendiente<select aria-label="Casillero del objetivo" required value={selected} disabled={saving || !data.casilleros.length} onChange={event => setSelected(event.target.value)}>
                <option value="">Elegí dónde debe contar</option>{data.casilleros.map(item => <option key={item.id} value={item.id}>
                  {item.tipo === 'video' ? 'Reel' : 'Carrusel'} {item.numero}{item.tarea_id ? ` · tarea actual #${item.tarea_id}` : ''}</option>)}</select></label>
              {!data.objetivo && <p>Este cliente todavía no tiene preparado un objetivo para ese mes.</p>}
              {data.objetivo && !data.casilleros.length && <p>No hay casilleros pendientes disponibles para este formato.</p>}
              {slot && <div className="ros-goal-summary"><strong>{data.objetivo.nombre} · {period}</strong>
                <p>Esta tarea ocupará {slot.tipo === 'video' ? 'Reel' : 'Carrusel'} {slot.numero}.{data.tarea.estado === 'publicada' ? ' Contará como completada inmediatamente.' : ' Contará cuando se finalice.'}</p>
                {slot.tarea_id && <p>Se reemplaza el enlace de la tarea #{slot.tarea_id}, no la tarea. Su información e historial no se eliminan.</p>}</div>}
            </>}
          <footer><button type="button" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="ros-goal-primary" disabled={loading || saving || !slot || Boolean(data?.vinculo_actual)}>
              {saving ? 'Vinculando…' : data?.tarea.estado === 'publicada' ? 'Vincular y contar' : 'Vincular tarea'}</button></footer>
        </form>}
    </section>
  </div>, document.body);
}

export function GoalTaskLink({ task, canManage }) {
  const [open, setOpen] = useState(false);
  if (!canManage || !task.cliente_id || task.historia_id || task.tipo_tarea === 'produccion') return null;
  return <section className="ros-goal-link"><div><strong>Objetivo del mes</strong><span>Hacé que esta pieza cuente en el avance del cliente.</span></div>
    <button type="button" onClick={() => setOpen(true)}>Vincular al objetivo mensual</button>
    {open && <LinkDialog task={task} onClose={() => setOpen(false)}/>}</section>;
}
