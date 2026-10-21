import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorialArchiveControl } from './EditorialArchiveControl.jsx';
import { archivePage, archivePageUrl } from './EditorialArchiveControl.model.js';

export function EditorialArchivePanel(props) {
  return props.isAdmin ? <AdminArchivePanel {...props} key={`${props.dominio}:${props.clientId ?? 'all'}`} /> : null;
}
function AdminArchivePanel({ dominio, clientId = null, isAdmin, capture, onSaved }) {
  const [offset, setOffset] = useState(0), [data, setData] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [, render] = useState(0);
  const generation = useRef(0), locks = useRef(new Set()), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async (scope = capture(), signal) => {
    const read = ++generation.current;
    const current = () => alive.current && scope.current() && !signal?.aborted && generation.current === read;
    if (!scope.current() || !isAdmin) return false;
    setLoading(true); setError('');
    try {
      const dto = archivePage(await scope.request(archivePageUrl(dominio, offset, clientId), { signal, cache: 'no-store' }), dominio, offset);
      if (!current()) return false;
      setData(dto); return true;
    } catch (reason) { if (current()) setError(reason.message || 'No se pudieron cargar las piezas archivadas.'); return false; }
    finally { if (current()) setLoading(false); }
  }, [capture, dominio, offset, clientId, isAdmin]);
  useEffect(() => { const controller = new AbortController(); void load(undefined, controller.signal); return () => controller.abort(); }, [load]);
  const saved = async (dto, scope) => {
    scope.assertCurrent();
    await onSaved?.(dto, scope);
    scope.assertCurrent();
    if (!await load(scope)) throw new Error('Cambio guardado. No se pudo actualizar el archivo; verificá la lectura sin repetir la operación.');
  };
  const locked = locks.current.size > 0;
  return <section className="prod-panel" aria-label={dominio === 'historia' ? 'Historias archivadas' : 'Publicaciones archivadas'}>
    <h3>Archivadas</h3><p>Se conservan el contenido, las tareas vinculadas y el historial. Todas las fechas; restaurar no registra una publicación ni cambia el trabajo realizado.</p>
    <button type="button" className="btn" disabled={loading || locked} onClick={() => void load()}>Actualizar archivo</button>
    {loading && <p role="status">Cargando archivo…</p>}{error && <p role="alert">{error}</p>}
    {data && <><p>{data.total} piezas archivadas · {clientId === null ? 'Todos los clientes' : `Cliente #${clientId}`}</p>
      {!data.items.length && <p>No hay piezas archivadas en esta página.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>{data.items.map(piece => <li key={piece.id} style={{ padding: '12px 0', borderBottom: '1px solid #ddd', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <div><strong>{piece.titulo || `Pieza #${piece.id}`}</strong><p>{piece.cliente.nombre} · {piece.tipo} · {piece.fecha_programada || 'Sin fecha'} · {piece.estado}</p></div>
        <EditorialArchiveControl dominio={dominio} piece={piece} action="restaurar" capture={capture} isAdmin={isAdmin} onSaved={saved}
          canStart={() => !loading && (locks.current.size === 0 || locks.current.has(piece.id))}
          onLockChange={value => { if (value) locks.current.add(piece.id); else locks.current.delete(piece.id); if (alive.current) render(count => count + 1); }} />
      </li>)}</ul>
      <nav aria-label="Páginas del archivo"><button type="button" className="btn" disabled={loading || locked || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Anterior</button>
        <span> Página {Math.floor(offset / 20) + 1} </span><button type="button" className="btn" disabled={loading || locked || !data.has_more} onClick={() => setOffset(offset + 20)}>Siguiente</button></nav>
    </>}
  </section>;
}
