import React, { useEffect, useRef, useState } from 'react';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { getSesion } from '../utils.jsx';
import { verifyProductionResultPage } from './productionResultIntent.js';

const labels = {grabado: 'Grabado', pendiente: 'Pendiente', repetir: 'Repetir', realizada: 'Realizada'};
function Material({url}) {
  // The page parser already validates protocol and credentials.
  return url ? <a href={url} target="_blank" rel="noopener noreferrer">Ver material</a> : null;
}

export function ProductionResultHistory({visit, sesion, onObservation}) {
  const [page, setPage] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const owner = useRef(0), flight = useRef(false), session = useRef(sesion);
  const observer = useRef(onObservation); observer.current = onObservation;
  session.current = sesion;
  const load = async (generation, cursor = null, previous = null) => {
    if (owner.current !== generation || flight.current) return;
    flight.current = true; setBusy(true); setError('');
    try {
      const scope = createCapturedRequest({session: session.current, readSession: getSesion,
        request: apiRequest, isActive: () => owner.current === generation});
      const raw = await scope.request(`/api/producciones/${visit.id}/resultados${cursor === null ? '' : `?antes_revision=${cursor}`}`);
      scope.assertCurrent();
      const next = verifyProductionResultPage(raw, visit.id);
      if (next.revision !== visit.revision || (previous && next.revision !== previous.revision)) {
        throw new Error('changed');
      }
      if (previous && next.resultados.some(row => row.visita_revision >= cursor
        || previous.resultados.some(old => old.id === row.id))) throw new Error('overlap');
      setPage({...next, generation, resultados: [...(previous?.resultados || []), ...next.resultados]});
      if (!previous) observer.current?.({visitId:visit.id, revision:next.revision,
        registered:next.resultados.some(row => row.revision_resultante === next.revision)});
    } catch {
      if (owner.current === generation) { observer.current?.(null); setError('No se pudo verificar el historial de esta versión. Actualizá la visita y volvé a consultar.'); }
    } finally {
      if (owner.current === generation) { flight.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    const generation = ++owner.current;
    flight.current = false; setPage(null); observer.current?.(null);
    void load(generation);
    return () => { ++owner.current; };
  }, [visit.id, visit.revision, sesion, refresh]);
  return <details className="prod-result-history"><summary>Resultados registrados{page ? ` · ${page.resultados.length}` : ''}</summary>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Consultando resultados…</p>}
    {!busy && !error && page?.resultados.length === 0 && <p>No hay resultados registrados para esta visita.</p>}
    {page?.resultados.map(row => <article key={row.id}>
      <details><summary>{new Intl.DateTimeFormat('es-AR', {dateStyle:'medium', timeStyle:'short'}).format(new Date(row.registrado_at))} · {row.resumen.parcial ? 'Resultado parcial' : 'Material registrado'}{row.revision_resultante === visit.revision ? ' · Vigente' : ' · Versión anterior'}</summary>
        <p>{row.resumen.conteos.videos_grabados} videos grabados · {row.resumen.conteos.videos_pendientes} pendientes · {row.resumen.conteos.videos_repetir} para repetir</p>
        {row.resumen.videos.map(video => <details key={video.id}><summary>{video.titulo} · {labels[video.estado]}</summary><p className="prod-script">{video.guion}</p>{video.observaciones && <p>{video.observaciones}</p>}<Material url={video.material_url}/></details>)}
        {row.resumen.fotos.length > 0 && <h4>Tipos de fotos</h4>}
        {row.resumen.fotos.map(photo => <div key={photo.id}><p>{photo.tipo} · {labels[photo.estado]}</p>{photo.observaciones && <p>{photo.observaciones}</p>}<Material url={photo.drive_url}/></div>)}
        {row.resumen.visita.observaciones && <p>{row.resumen.visita.observaciones}</p>}
        <Material url={row.resumen.visita.drive_url}/>
      </details>
    </article>)}
    {page?.next_before_revision && !error && <button type="button" disabled={busy} onClick={() => load(page.generation, page.next_before_revision, page)}>Ver resultados anteriores</button>}
    <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Consultar historial</button>
  </details>;
}
