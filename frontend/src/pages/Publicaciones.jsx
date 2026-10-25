import React, { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from "react";
import { EditorialPublicationControl } from '../components/EditorialPublicationControl.jsx';
import { editorialFields, mergeEditorialStatus } from '../components/EditorialPublicationControl.model.js';
import { isConfirmedPublication, isHistoricalPublication } from '../shared/editorial/publication-evidence.js';
import { publicationCalendarSummary } from '../shared/editorial/publication-calendar-summary.js';
import { getSesion } from '../utils.jsx';
import { etiquetaCortaPublicacion, fechaISODesde, getCheckPublicacionLabel, getEstadoHistoriaLabel, getGrillaMes, getHoyLocalISO, getTipoPublicacionLabel, payloadColumnaPublicacion } from "../utils.jsx";
import { COLUMNAS_PUBLICACION, DIAS_SEMANA, ESTADOS_PUBLICACION, MESES, TIPOS_PUBLICACION } from "../constants.js";
import { Modal } from "../components/Modal.jsx";
import { PageState } from "../components/PageState.jsx";
import { PublicationComposer, PublicationPreviewQueue } from "../components/PublicationComposer.jsx";
import { buildContextUrl, formatMonthContext, pushUrlContext as pushRawUrlContext, readMonthContext, readUrlContext, replaceUrlContext as replaceRawUrlContext } from "../shared/navigation/url-context.js";
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { requestAppNavigation } from '../shared/navigation/location.js';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { useSessionView } from '../shared/session/use-session-view.js';
import { editorialPatchBody, editorialPatchAck, mergeEditorialPatchEvidence, editorialPatchError } from '../shared/editorial/editorial-patch.js';
import { createEditorialCreateIntent } from '../shared/editorial/editorial-create-intent.js';
import { EditorialArchiveControl } from '../components/EditorialArchiveControl.jsx';
import { EditorialArchivePanel } from '../components/EditorialArchivePanel.jsx';
import { FilterSelect } from '../components/FilterSelect.jsx';
import { normalizePublicationCalendarContext, readPublicationCalendarContext, publicationCalendarUrlChanges } from './publicationCalendarContext.js';
import { normalizePublicationTrackingContext, readPublicationTrackingContext, publicationTrackingUrlChanges } from './publicationTrackingContext.js';

function pushUrlContext(changes) {
  const result = pushRawUrlContext(changes);
  notifyViewPreferenceChange(window);
  return result;
}
function replaceUrlContext(changes) {
  const result = replaceRawUrlContext(changes);
  notifyViewPreferenceChange(window);
  return result;
}

function usePublicationSession(sesion, context = null) {
  const view = useSessionView(sesion || getSesion());
  const live = useRef({ view, context });
  if (live.current.view !== view || live.current.context !== context) live.current = { view, context };
  const observation = live.current;
  const mounted = useRef(false);
  // Child passive callbacks may run before the parent's passive effects.
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const capture = useCallback(() => createCapturedRequest({ session: view.session, readSession: getSesion, request: apiRequest,
    isActive: () => mounted.current && live.current === observation }), [view, observation]);
  const captureLifetime = useCallback(() => createCapturedRequest({ session: view.session, readSession: getSesion, request: apiRequest,
    isActive: () => mounted.current && live.current.view === view }), [view]);
  return { view, capture, captureLifetime };
}

export function PublicacionesCalendarioTab({ onIrAPlanilla, contextYear, contextMonth, onMonthChange, calendarContext, onCalendarContextChange, sesion, onPublicationSaved, onCommittedChange }) {
  const hoy = new Date();
  const [localYear, setLocalYear] = useState(hoy.getFullYear());
  const [localMonth, setLocalMonth] = useState(hoy.getMonth());
  const year = contextYear ?? localYear;
  const month = contextMonth ?? localMonth;
  const { view, capture, captureLifetime } = usePublicationSession(sesion, `${year}:${month}`);
  const [piezas, setPiezas] = useState([]);
  const [error, setError] = useState(null);
  const { type: filtroTipo, view: vista } = normalizePublicationCalendarContext(calendarContext);
  const [actualizando, setActualizando] = useState(false);
  const [piezaSel, setPiezaSel] = useState(null);
  const [diaSel, setDiaSel] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);
  const [tareasLectura, setTareasLectura] = useState(null);
  const [tareasRetry, setTareasRetry] = useState(0);
  const selection = useRef({ piece: piezaSel, day: diaSel, year, month, generation: 0 });
  if (selection.current.piece !== piezaSel || selection.current.day !== diaSel || selection.current.year !== year || selection.current.month !== month) {
    selection.current = { piece: piezaSel, day: diaSel, year, month, generation: selection.current.generation + 1 };
  }
  const selectedPiece = useRef({ piece: piezaSel, generation: 0 });
  if (selectedPiece.current.piece !== piezaSel) selectedPiece.current = { piece: piezaSel, generation: selectedPiece.current.generation + 1 };
  const tareasActuales = tareasLectura?.observation === selectedPiece.current && tareasLectura.capture === capture && tareasLectura.attempt === tareasRetry
    ? tareasLectura : { status: 'loading', items: [] };
  const tareasContext = useRef(null);
  tareasContext.current = { capture, attempt: tareasRetry, read: tareasLectura };
  const reintentarTareas = () => {
    if (!capture().current() || tareasContext.current.capture !== capture || tareasContext.current.attempt !== tareasRetry
      || tareasContext.current.read !== tareasLectura || selectedPiece.current !== tareasLectura?.observation || tareasLectura.capture !== capture
      || tareasLectura.attempt !== tareasRetry || tareasLectura.status !== 'error') return;
    setTareasRetry(value => value + 1);
  };
  const listGeneration = useRef(0);
  const pendingWrites = useRef(new Set());
  const generating = useRef(false);

  const cargarPublicaciones = useCallback((scope = capture(), options = {}) => {
    const generation = ++listGeneration.current;
    const current = () => scope.current() && !options.signal?.aborted && generation === listGeneration.current;
    return scope.request("/api/publicaciones", options)
      .then((publicaciones) => {
        if (!current()) return;
        setPiezas(
          publicaciones.map((p) => ({
            ...p,
            tipoLabel: getTipoPublicacionLabel(p.tipo),
          }))
        );
      })
      .catch(() => {
        if (current()) setError("No se pudo cargar el calendario editorial.");
      });
  }, [capture]);

  useEffect(() => {
    const controller = new AbortController();
    void cargarPublicaciones(undefined, { signal: controller.signal });
    return () => controller.abort();
  }, [cargarPublicaciones]);

  useEffect(() => {
    if (!piezaSel?.id) {
      setTareasLectura(null);
      return;
    }
    let active = true;
    const scope = capture();
    const controller = new AbortController();
    const observation = selectedPiece.current;
    const current = () => active && scope.current() && !controller.signal.aborted && selectedPiece.current === observation
      && tareasContext.current.capture === capture && tareasContext.current.attempt === tareasRetry;
    const result = (status, items = []) => ({ observation, capture, attempt: tareasRetry, status, items });
    setTareasLectura(result('loading'));
    scope.request(`/api/publicaciones/${piezaSel.id}/tareas`, { cache: "no-store", signal: controller.signal })
      .then((items) => {
        if (!current()) return;
        if (!Array.isArray(items)) throw new Error('Respuesta de tareas no válida.');
        setTareasLectura(result('ready', items));
      })
      .catch(() => {
        if (current()) setTareasLectura(result('error'));
      });
    return () => { active = false; controller.abort(); };
  }, [piezaSel, capture, tareasRetry]);

  const piezasFiltradas = useMemo(() => piezas.filter((pz) => {
    if (filtroTipo !== "todos" && pz.tipo !== filtroTipo) return false;
    return true;
  }), [piezas, filtroTipo]);

  const porFecha = useMemo(() => {
    const tmp = {};
    piezasFiltradas.forEach((pz) => {
      if (!pz.fecha_programada) return;
      (tmp[pz.fecha_programada] = tmp[pz.fecha_programada] || []).push(pz);
    });
    Object.values(tmp).forEach((items) => {
      items.sort((a, b) => {
        if (a.estado === b.estado) return a.cliente_nombre.localeCompare(b.cliente_nombre);
        if (isConfirmedPublication(a)) return 1;
        if (isConfirmedPublication(b)) return -1;
        return a.estado.localeCompare(b.estado);
      });
    });
    return tmp;
  }, [piezasFiltradas]);

  const semanas = useMemo(() => getGrillaMes(year, month), [year, month]);
  const hoyISO = getHoyLocalISO();
  const mesISO = fechaISODesde(year, month, 1).slice(0, 7);
  const diasSemanaVisible = useMemo(() => {
    const base = mesISO === getHoyLocalISO().slice(0, 7) ? new Date(`${getHoyLocalISO()}T12:00:00`) : new Date(year, month, 1, 12);
    const mondayOffset = (base.getDay() + 6) % 7;
    base.setDate(base.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(base); date.setDate(base.getDate() + index);
      return fechaISODesde(date.getFullYear(), date.getMonth(), date.getDate());
    });
  }, [mesISO, year, month]);

  const estadisticas = useMemo(() => publicationCalendarSummary(piezasFiltradas, { month: mesISO, today: hoyISO }), [piezasFiltradas, mesISO, hoyISO]);

  const irMes = useCallback((delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    if (onMonthChange) onMonthChange(y, m);
    else {
      setLocalMonth(m);
      setLocalYear(y);
    }
  }, [month, year]);

  const FILTROS = useMemo(() => [
    { key: "todos", label: "Todo" },
    { key: "video", label: "Reels" },
    { key: "carrusel", label: "Carruseles" },
  ], []);

  const actualizarCalendario = useCallback(async () => {
    const scope = capture();
    const lifetime = captureLifetime();
    if (!scope.current() || generating.current) return;
    generating.current = true;
    setActualizando(true); setError(null);
    try {
      await scope.request("/api/calendario-editorial/generar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodo: mesISO }) });
      scope.assertCurrent();
      await cargarPublicaciones(scope);
    } catch (err) { if (scope.current()) setError(err.message); }
    finally { generating.current = false; if (lifetime.current()) setActualizando(false); }
  }, [mesISO, cargarPublicaciones, capture, captureLifetime]);

  const cambiarFecha = useCallback(async (publicacion, fecha) => {
    const scope = capture();
    const lifetime = captureLifetime();
    const observation = selection.current;
    if (!scope.current() || pendingWrites.current.has(publicacion.id)) return;
    pendingWrites.current.add(publicacion.id);
    setGuardandoId(publicacion.id); setError(null);
    try {
      const actualizada = editorialPatchAck(publicacion, await scope.request(`/api/publicaciones/${publicacion.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: editorialPatchBody(publicacion, { fecha_programada: fecha }) }));
      scope.assertCurrent();
      ++listGeneration.current;
      onCommittedChange?.({ row: actualizada });
      const completa = { ...publicacion, ...actualizada, tipoLabel: getTipoPublicacionLabel(actualizada.tipo) };
      setPiezas((prev) => prev.map((item) => item.id === completa.id ? completa : item));
      setPiezaSel(current => selection.current === observation && current === observation.piece && current?.id === publicacion.id ? completa : current);
      setDiaSel(current => selection.current === observation && current === observation.day ? null : current);
    } catch (err) { if (scope.current()) setError(editorialPatchError(err)); }
    finally { pendingWrites.current.delete(publicacion.id); if (lifetime.current()) setGuardandoId(current => current === publicacion.id ? null : current); }
  }, [capture, captureLifetime, onCommittedChange]);

  const cambiarEstadoPublicacion = useCallback(async (publicacion, nuevoEstado) => {
    const scope = capture();
    const lifetime = captureLifetime();
    const observation = selection.current;
    if (!scope.current() || pendingWrites.current.has(publicacion.id) || nuevoEstado === 'publicada' || isConfirmedPublication(publicacion) || view.role !== 'admin') return;
    pendingWrites.current.add(publicacion.id);
    setGuardandoId(publicacion.id);
    setError(null);
    try {
      const actualizada = editorialPatchAck(publicacion, await scope.request(`/api/publicaciones/${publicacion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: editorialPatchBody(publicacion, { estado: nuevoEstado }),
      }));
      scope.assertCurrent();
      ++listGeneration.current;
      onCommittedChange?.({ row: actualizada });
      const piezaActualizada = {
        ...publicacion,
        ...actualizada,
        tipoLabel: getTipoPublicacionLabel(actualizada.tipo),
      };
      setPiezas((prev) =>
        prev.map((pz) => (pz.id === publicacion.id ? piezaActualizada : pz)),
      );
      setPiezaSel(current => selection.current === observation && current === observation.piece && current?.id === publicacion.id ? piezaActualizada : current);
      setDiaSel((dia) =>
        selection.current === observation && dia === observation.day && dia?.fecha === piezaActualizada.fecha_programada
          ? {
              ...dia,
              items: dia.items.map((pz) =>
                pz.id === piezaActualizada.id ? piezaActualizada : pz,
              ),
            }
          : dia,
      );
    } catch (err) {
      if (scope.current()) setError(editorialPatchError(err));
    } finally {
      pendingWrites.current.delete(publicacion.id);
      if (lifetime.current()) setGuardandoId(current => current === publicacion.id ? null : current);
    }
  }, [capture, captureLifetime, view.role, onCommittedChange]);

  const publicationSaved = useCallback(dto => {
    const scope = capture();
    if (!scope.current()) return;
    const merge = row => row.id === dto.piece.id ? mergeEditorialStatus(row, dto) : row;
    setPiezas(prev => prev.map(merge));
    setPiezaSel(prev => prev ? merge(prev) : prev);
    setDiaSel(prev => prev ? { ...prev, items: prev.items.map(merge) } : prev);
    onPublicationSaved?.(dto);
  }, [capture, onPublicationSaved]);

  const abrirDia = useCallback((fecha, items) => {
    if (!items.length) return;
    setDiaSel({ fecha, items });
  }, []);

  return (
    <>
      <div className="cal-toolbar">
        <div className="cal-monthnav">
          <button
            aria-label="Mes anterior"
            className="btn cal-navbtn"
            type="button"
            onClick={() => irMes(-1)}
          >
            ‹
          </button>
          <span className="cal-title">
            {MESES[month]} {year}
          </span>
          <button
            aria-label="Mes siguiente"
            className="btn cal-navbtn"
            type="button"
            onClick={() => irMes(1)}
          >
            ›
          </button>
        </div>

        <div className="cal-filters" aria-label="Filtros de calendario">
          <div className="editorial-view-toggle" aria-label="Vista del calendario">
            <button type="button" className={vista === "mes" ? "active" : ""} onClick={() => onCalendarContextChange?.({ view: 'mes' })}>Mes</button>
            <button type="button" className={vista === "semana" ? "active" : ""} onClick={() => onCalendarContextChange?.({ view: 'semana' })}>Semana</button>
          </div>
          <button className="btn" type="button" onClick={() => { const now = new Date(); if (onMonthChange) onMonthChange(now.getFullYear(), now.getMonth()); else { setLocalYear(now.getFullYear()); setLocalMonth(now.getMonth()); } }}>Hoy</button>
          <FilterSelect label="Tipo" className="editorial-type-filter" aria-label="Tipo de publicación"
              value={filtroTipo}
              onChange={(event) => onCalendarContextChange?.({ type: event.target.value })}
            >
              {FILTROS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
          </FilterSelect>
          <button className="btn primary" type="button" disabled={actualizando} onClick={actualizarCalendario}>{actualizando ? "Actualizando…" : "Actualizar calendario"}</button>
        </div>
      </div>

      <div className="publication-check-summary" aria-label="Agenda por fecha programada; no acredita publicaciones realizadas">
        <div>
          <strong>{estadisticas.scheduledMonth.length}</strong>
          <span>Planificadas del mes</span>
        </div>
        <div>
          <strong>{estadisticas.today.length}</strong>
          <span>Agenda de hoy</span>
        </div>
        <div>
          <strong>{estadisticas.tomorrow.length}</strong>
          <span>Agenda de mañana</span>
        </div>
        <div>
          <strong>{estadisticas.nextSevenDays.length}</strong>
          <span>Próximos 7 días</span>
        </div>
      </div>

      {error && <div className="caption">{error}</div>}

      {vista === "semana" && <div className="editorial-week-view">
        {diasSemanaVisible.map((fecha) => <section key={fecha} className={fecha === hoyISO ? "today" : ""}>
          <header><strong>{new Date(`${fecha}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long" })}</strong><span>{new Date(`${fecha}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</span></header>
          <div>{(porFecha[fecha] || []).map((pz) => <button type="button" key={pz.id} onClick={() => setPiezaSel(pz)}><span>{pz.tipo === "carrusel" ? "Carrusel" : "Reel"}</span><strong>{pz.cliente_nombre}</strong></button>)}</div>
          {!(porFecha[fecha] || []).length && <small>Sin publicaciones</small>}
        </section>)}
      </div>}

      <div className={`cal-grid ${vista === "semana" ? "is-hidden" : ""}`}>
        {DIAS_SEMANA.map((dia) => (
          <div className="cal-dow" key={dia}>
            {dia}
          </div>
        ))}
        {semanas.map((semana, si) =>
          semana.map((dia, di) => {
            if (dia === null) {
              return (
                <div className="cal-cell empty" key={`${si}-${di}`}></div>
              );
            }
            const iso = fechaISODesde(year, month, dia);
            const items = porFecha[iso] || [];
            const visibles = items.slice(0, 4);
            const ocultos = Math.max(items.length - visibles.length, 0);
            return (
              <div
                className={`cal-cell ${iso === hoyISO ? "today" : ""} ${items.length ? "has-items" : ""}`}
                key={`${si}-${di}`}
                onClick={() => abrirDia(iso, items)}
              >
                <div className="cal-cell-head">
                  <span className="cal-daynum">{dia}</span>
                  {items.length > 0 && <span className="cal-count">{items.length}</span>}
                </div>
                <div className="cal-chip-stack">
                  {visibles.map((pz) => (
                    <div
                      className={`cal-chip ${pz.estado}`}
                      key={pz.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPiezaSel(pz);
                      }}
                      title={`${dia} de ${MESES[month].toLowerCase()} — ${pz.tipoLabel} — ${pz.cliente_nombre}`}
                    >
                      <span>{pz.tipo === "carrusel" ? "Carrusel" : "Reel"}</span><strong>{pz.cliente_nombre}</strong>{isConfirmedPublication(pz) && <i aria-label="Confirmada manualmente">✓</i>}
                    </div>
                  ))}
                  {ocultos > 0 && (
                    <button
                      className="cal-more"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        abrirDia(iso, items);
                      }}
                    >
                      +{ocultos} más
                    </button>
                  )}
                </div>
              </div>
            );
          }),
        )}
      </div>

      <div className="caption">
        Tocá una publicación para ver su detalle o cambiar la fecha. Las fechas que movés manualmente quedan protegidas de futuras actualizaciones automáticas.
      </div>

      {diaSel && (
        <Modal
          onClose={() => setDiaSel(null)}
          title={<span>Publicaciones del {diaSel.fecha}</span>}
          className="day-modal"
        >
            <div className="modal-body">
              <div className="day-publication-list">
                {diaSel.items.map((pz) => (
                  <button
                    className={`day-publication-row ${pz.estado}`}
                    key={pz.id}
                    type="button"
                    onClick={() => setPiezaSel(pz)}
                  >
                    <span className="day-publication-main">
                      <strong>{pz.cliente_nombre}</strong>
                      <span>{pz.tipoLabel} · {pz.fecha_programada}</span>
                    </span>
                    <span className="day-publication-badge">
                      {isConfirmedPublication(pz) ? "✓" : pz.tipo === "carrusel" ? "C" : "V"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
        </Modal>
      )}

      {piezaSel && (
        <Modal
          onClose={() => setPiezaSel(null)}
          title={
            <span>
              {piezaSel.cliente_nombre} · {piezaSel.idea || "Sin idea cargada"}
            </span>
          }
        >
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-field">
                  <div className="detail-label">Tipo</div>
                  <div>{piezaSel.tipoLabel}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Estado</div>
                  <div>{getEstadoHistoriaLabel(piezaSel.estado)}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Registro de publicación</div>
                  <div>
                    {isConfirmedPublication(piezaSel) ? 'Confirmada manualmente' : piezaSel.estado === 'publicada' ? 'Histórica sin confirmación' : 'Sin confirmación'}
                  </div>
                </div>
                {piezaSel.fecha_publicación_real && (
                  <div className="detail-field">
                    <div className="detail-label">Fecha registrada (histórica si no hay confirmación)</div>
                    <div>{piezaSel.fecha_publicación_real}</div>
                  </div>
                )}
                <div className="detail-field">
                  <label className="detail-label" htmlFor="publication-date">Fecha programada</label>
                  <input id="publication-date" type="date" value={piezaSel.fecha_programada || ""} disabled={guardandoId === piezaSel.id} onChange={(event) => cambiarFecha(piezaSel, event.target.value)} />
                </div>
                <div className="detail-field">
                  <div className="detail-label">Responsable</div>
                  <div>{piezaSel.responsable || "—"}</div>
                </div>
                {piezaSel.copy && (
                  <div className="detail-field">
                    <div className="detail-label">Copy</div>
                    <div>{piezaSel.copy}</div>
                  </div>
                )}
              </div>
              <section className="publication-linked-tasks" aria-label="Tareas para verificar">
                <header>
                  <div><strong>Tareas para verificar</strong><span>Abrí el detalle sin volver al tablero.</span></div>
                  {tareasActuales.status === 'ready' && tareasActuales.items.length > 0 && <b>{tareasActuales.items.length}</b>}
                </header>
                {tareasActuales.status === 'loading' ? <PageState compact type="loading" title="Cargando tareas…" />
                  : tareasActuales.status === 'error' ? <PageState compact type="error" title="No se pudieron consultar las tareas vinculadas."
                    description="No podemos confirmar si hay tareas disponibles. Reintentá la consulta." onRetry={reintentarTareas} />
                  : tareasActuales.items.length > 0 ? (
                  <div>{tareasActuales.items.map((tarea) => (
                    <a className="publication-linked-task" href={`/workspace/tareas?task=${tarea.id}`} key={tarea.id}>
                      <span><strong>{tarea.titulo}</strong><small>{tarea.asignado_a || "Sin responsable"} · {tarea.fecha_vencimiento || "Sin fecha"}</small></span>
                      <b>{getEstadoHistoriaLabel(tarea.estado)}</b><i>Ver tarea →</i>
                    </a>
                  ))}</div>
                ) : <p className="publication-linked-tasks-empty">No hay tareas vinculadas disponibles para tu usuario.</p>}
              </section>
              <div className="modal-actions">
                <EditorialPublicationControl dominio="publicacion" pieza={piezaSel} sesion={view.session} onSaved={publicationSaved} />
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoId === piezaSel.id || piezaSel.estado === "lista" || isConfirmedPublication(piezaSel) || view.role !== "admin"}
                  onClick={() => cambiarEstadoPublicacion(piezaSel, "lista")}
                >
                  Volver a pendiente
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoId === piezaSel.id || piezaSel.estado === "bloqueada" || isConfirmedPublication(piezaSel) || view.role !== "admin"}
                  onClick={() => cambiarEstadoPublicacion(piezaSel, "bloqueada")}
                >
                  No publicado / revisar
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    onIrAPlanilla(piezaSel.cliente_id);
                    setPiezaSel(null);
                  }}
                >
                  Editar en la planilla →
                </button>
              </div>
            </div>
        </Modal>
      )}
    </>
  );
}

export function PublicacionesGeneralTab({ clientes, onIrACliente, trackingContext, onTrackingContextChange, sesion, onPublicationSaved }) {
  const { view, capture } = usePublicationSession(sesion);
  const [publicaciones, setPublicaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const { client: filtroCliente, month: filtroMes, state: filtroEstado, responsible: filtroResponsable, type: filtroTipo } = normalizePublicationTrackingContext(trackingContext);

  useEffect(() => {
    const scope = capture();
    const controller = new AbortController();
    const current = () => scope.current() && !controller.signal.aborted;
    scope.request("/api/publicaciones", { signal: controller.signal })
      .then((data) => {
        if (!current()) return;
        if (!Array.isArray(data)) throw new Error('Respuesta de publicaciones no válida.');
        setPublicaciones(data);
        setError(null);
      })
      .catch(() => {
        if (current()) setError("No se pudieron cargar las publicaciones.");
      })
      .finally(() => { if (current()) setCargando(false); });
    return () => controller.abort();
  }, [capture]);

  const publicationSaved = useCallback(dto => {
    const scope = capture();
    if (!scope.current()) return;
    setPublicaciones(prev => prev.map(row => row.id === dto.piece.id ? mergeEditorialStatus(row, dto) : row));
    onPublicationSaved?.(dto);
  }, [capture, onPublicationSaved]);

  const mesesDisponibles = [
    ...new Set(publicaciones.map((p) => p.fecha_programada?.slice(0, 7)).filter(Boolean)),
  ].sort();

  const responsablesDisponibles = [
    ...new Set(publicaciones.map((p) => p.responsable).filter(Boolean)),
  ].sort();

  const filtradas = publicaciones.filter((p) => {
    if (filtroCliente !== "todos" && p.cliente_id !== Number(filtroCliente)) return false;
    if (filtroMes !== "todos" && !p.fecha_programada?.startsWith(filtroMes)) return false;
    if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
    if (filtroResponsable !== "todos" && p.responsable !== filtroResponsable) return false;
    if (filtroTipo !== "todos" && p.tipo !== filtroTipo) return false;
    return true;
  });

  const selectStyle = { fontSize: "12px", padding: "6px 8px" };

  return (
    <>
      <div className="section-label">Control de publicaciones</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        <select aria-label="Cliente de seguimiento" style={selectStyle} value={filtroCliente} onChange={(e) => onTrackingContextChange?.({ client: e.target.value })}>
          <option value="todos">Todos los clientes</option>
          {filtroCliente !== 'todos' && !clientes.some(c => String(c.id) === filtroCliente) && <option value={filtroCliente}>Cliente no disponible ({filtroCliente})</option>}
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <select aria-label="Mes de seguimiento" style={selectStyle} value={filtroMes} onChange={(e) => onTrackingContextChange?.({ month: e.target.value })}>
          <option value="todos">Todos los meses</option>
          {filtroMes !== 'todos' && !mesesDisponibles.includes(filtroMes) && <option value={filtroMes}>{filtroMes} · sin publicaciones disponibles</option>}
          {mesesDisponibles.map((m) => (
            <option key={m} value={m}>
              {MESES[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
            </option>
          ))}
        </select>
        <select aria-label="Estado de seguimiento" style={selectStyle} value={filtroEstado} onChange={(e) => onTrackingContextChange?.({ state: e.target.value })}>
          <option value="todos">Todos los estados</option>
          {ESTADOS_PUBLICACION.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
        <select aria-label="Responsable de seguimiento" style={selectStyle} value={filtroResponsable} onChange={(e) => onTrackingContextChange?.({ responsible: e.target.value })}>
          <option value="todos">Todos los responsables</option>
          {filtroResponsable !== 'todos' && !responsablesDisponibles.includes(filtroResponsable) && <option value={filtroResponsable}>{filtroResponsable} · sin publicaciones disponibles</option>}
          {responsablesDisponibles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select aria-label="Tipo de seguimiento" style={selectStyle} value={filtroTipo} onChange={(e) => onTrackingContextChange?.({ type: e.target.value })}>
          <option value="todos">Todos los tipos</option>
          {TIPOS_PUBLICACION.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <span style={{ fontSize: "12px", color: "#777", alignSelf: "center", marginLeft: "auto" }}>
          {!cargando && !error ? `${filtradas.length} publicaciones` : 'Sin resultado confirmado'}
        </span>
      </div>

      {cargando ? (
        <div className="state-empty">Cargando publicaciones…</div>
      ) : error ? <PageState compact type="error" title={error} description="No se pudo verificar el resultado de estos filtros." onRetry={() => window.location.reload()} /> : (
        <div className="box" style={{ padding: 0, overflow: "auto", maxHeight: "70vh" }}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{ width: "100px" }}>Fecha</th>
                <th style={{ width: "180px" }}>Cliente</th>
                <th style={{ width: "90px" }}>Tipo</th>
                <th>Idea</th>
                <th style={{ width: "120px" }}>Responsable</th>
                <th style={{ width: "120px" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "#999" }}>
                    Sin publicaciones para estos filtros.
                  </td>
                </tr>
              )}
              {filtradas.map((p) => {
                const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado) || ESTADOS_PUBLICACION[0];
                return (
                  <tr
                    key={p.id}
                    className="row-clickable"
                    onClick={() => onIrACliente(p.cliente_id)}
                    title="Ver la planilla de este cliente"
                  >
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{p.fecha_programada}</td>
                    <td style={{ padding: "6px 10px", fontSize: "13px", fontWeight: "600" }}>{p.cliente_nombre}</td>
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{getTipoPublicacionLabel(p.tipo)}</td>
                    <td style={{ padding: "6px 10px", fontSize: "13px", color: p.idea ? "#222" : "#bbb" }}>
                      {p.idea || "Sin idea cargada"}
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{p.responsable || "—"}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ background: est.bg, color: est.fg, fontWeight: "600", fontSize: "11px", padding: "3px 8px", borderRadius: "10px" }}>
                        {est.label}
                      </span>
                      <EditorialPublicationControl dominio="publicacion" pieza={p} sesion={view.session} onSaved={publicationSaved} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function PublicacionesPlanillaTab({ clienteId, clienteNombre, year, month, sesion, onPublicationSaved, onSnapshotLoaded, onCommittedChange }) {
  const { view, capture } = usePublicationSession(sesion, `${clienteId}:${year}:${month}`);
  const [publicaciones, setPublicaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const gridRef = useRef(null);
  const enfocarProximoId = useRef(null);
  const listGeneration = useRef(0);
  const loadingGeneration = useRef(0);
  const pendingWrites = useRef(new Set());
  const writeQueues = useRef(new Map());
  const latestWrites = useRef(new Map());
  const creating = useRef(false);
  const creation = useRef(null);
  const [, renderCreation] = useState(0);
  const [responsables, setResponsables] = useState([]);
  const [responsablesReady, setResponsablesReady] = useState(false);
  const [responsableNuevoId, setResponsableNuevoId] = useState('');
  if (!creation.current || creation.current.capture !== capture) creation.current = { capture, model: createEditorialCreateIntent({ capture }) };
  const creationState = creation.current.model.snapshot;
  useNavigationGuard(() => ({ dirty: creation.current.model.snapshot.locked, busy: creating.current || creation.current.model.snapshot.busy }));

  useEffect(() => {
    const scope = capture(), controller = new AbortController();
    setResponsablesReady(false);
    scope.request('/api/usuarios', { signal: controller.signal }).then(data => {
      if (!scope.current() || controller.signal.aborted) return;
      if (!Array.isArray(data)) throw new Error('Catálogo de responsables inválido.');
      setResponsables(data.filter(row => Number.isSafeInteger(row.id) && row.id > 0 && row.id <= 2147483647 && row.activo !== false));
      setResponsablesReady(true);
    }).catch(() => { if (scope.current() && !controller.signal.aborted) setError('No se pudo cargar el catálogo de responsables.'); });
    return () => controller.abort();
  }, [capture]);

  const cargar = useCallback((scope = capture(), options = {}) => {
    if (!scope.current()) return Promise.resolve();
    const generation = ++listGeneration.current;
    // Writes invalidate read data, but only a newer read takes loading ownership.
    const loadingToken = ++loadingGeneration.current;
    const current = () => scope.current() && !options.signal?.aborted && generation === listGeneration.current;
    setCargando(true);
    return scope.request("/api/publicaciones", options)
      .then((data) => {
        if (!current()) return;
        setPublicaciones(data.filter((p) => p.cliente_id === clienteId));
        onSnapshotLoaded?.(data);
        setError(null);
        return true;
      })
      .catch(() => {
        if (current()) setError("No se pudieron cargar las publicaciones.");
        return false;
      })
      .finally(() => {
        if (scope.current() && !options.signal?.aborted && loadingToken === loadingGeneration.current) setCargando(false);
      });
  }, [capture, clienteId, onSnapshotLoaded]);

  useEffect(() => {
    const controller = new AbortController();
    void cargar(undefined, { signal: controller.signal });
    return () => controller.abort();
  }, [cargar]);

  const publicationSaved = useCallback(dto => {
    const scope = capture();
    if (!scope.current()) return;
    ++listGeneration.current;
    setPublicaciones(prev => prev.map(row => row.id === dto.piece.id ? mergeEditorialStatus(row, dto) : row));
    onPublicationSaved?.(dto);
  }, [capture, onPublicationSaved]);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];

  const filasVisibles = publicaciones
    .filter((p) => p.fecha_programada && p.fecha_programada.startsWith(mesPrefix))
    .slice()
    .sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada));

  useEffect(() => {
    if (!enfocarProximoId.current) return;
    const idx = filasVisibles.findIndex((p) => p.id === enfocarProximoId.current);
    if (idx === -1) return;
    enfocarProximoId.current = null;
    const scope = capture();
    const frame = requestAnimationFrame(() => { if (scope.current()) enfocarCelda(idx, "fecha"); });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicaciones]);

  const actualizarLocal = (id, campos, scope = capture()) => {
    if (!scope.current()) return;
    campos = editorialFields(publicaciones.find(p => p.id === id), campos, view.role === 'admin');
    setPublicaciones((prev) => prev.map((p) => (p.id === id ? { ...p, ...campos } : p)));
  };

  const guardarEnServidor = async (id, campos, scope = capture()) => {
    if (!scope.current()) return;
    if (pendingWrites.current.has(`archive:${id}`)) return;
    campos = editorialFields(publicaciones.find(p => p.id === id), campos, view.role === 'admin');
    if (!Object.keys(campos).length) return;
    const observed = publicaciones.find(p => p.id === id);
    let body;
    try { body = editorialPatchBody(observed, campos); }
    catch (err) { if (scope.current()) setError(editorialPatchError(err)); return; }
    const previous = writeQueues.current.get(id) || Promise.resolve();
    // Deduplicate only the latest adjacent intent, never an older pending A
    // that must be sent again after an intervening B.
    if (writeQueues.current.has(id) && latestWrites.current.get(id) === body) return previous;
    latestWrites.current.set(id, body);
    const run = async () => {
      try {
        scope.assertCurrent();
        const saved = editorialPatchAck(observed, await scope.request(`/api/publicaciones/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
        }));
        scope.assertCurrent();
        ++listGeneration.current;
        onCommittedChange?.({ row: saved });
        setPublicaciones(prev => prev.map(row => row.id === id ? mergeEditorialPatchEvidence(row, saved) : row));
      } catch (err) {
        if (scope.current()) setError(editorialPatchError(err));
      }
    };
    const queued = previous.catch(() => {}).then(run);
    writeQueues.current.set(id, queued);
    void queued.finally(() => {
      if (writeQueues.current.get(id) === queued) { writeQueues.current.delete(id); latestWrites.current.delete(id); }
    }).catch(() => {});
    return queued;
  };

  const confirmarCampoTexto = (id, campos) => {
    const scope = capture();
    actualizarLocal(id, campos, scope);
    void guardarEnServidor(id, campos, scope);
  };

  const crearPublicacion = async (verify = false) => {
    const scope = capture();
    if (!scope.current() || creating.current || [...pendingWrites.current].some(key => String(key).startsWith('archive:'))) return;
    const model = creation.current.model;
    if (!verify && model.snapshot.locked) return;
    creating.current = true;
    const iso = mesPrefix === hoyISO.slice(0, 7) ? hoyISO : `${mesPrefix}-01`;
    try {
      const responsableId = Number(responsableNuevoId);
      if (!verify && (!responsablesReady || !responsables.some(row => row.id === responsableId && row.activo !== false))) throw new Error('Elegí un responsable válido del catálogo.');
      const pending = verify ? model.verify() : model.submit({
          tipo: "video",
          cliente_id: clienteId,
          responsable_id: responsableId,
          fecha_programada: iso,
          estado: "pendiente",
          idea: "",
      }, scope);
      renderCreation(value => value + 1);
      const creada = await pending;
      scope.assertCurrent();
      ++listGeneration.current;
      onCommittedChange?.({ row: creada });
      setPublicaciones(prev => prev.some(row => row.id === creada.id) ? prev : [...prev, creada]);
      enfocarProximoId.current = creada.id;
      // The accepted piece is already visible even if this follow-up read fails.
      const loaded = await cargar(scope);
      scope.assertCurrent();
      if (loaded === true) model.complete();
      if (creada.creation.replayed) setError(`Publicación #${creada.id} ya creada. Revisá sus datos actuales.`);
    } catch (reason) {
      if (scope.current()) setError(reason.message || 'No se pudo confirmar la creación. Verificá el mismo intento.');
    } finally { creating.current = false; if (scope.current()) renderCreation(value => value + 1); }
  };

  const canArchivePublication = row => view.role === 'admin' && capture().current() && Number.isSafeInteger(row?.id) && !writeQueues.current.has(row.id)
    && ![...pendingWrites.current].some(key => String(key).startsWith('archive:') && key !== `archive:${row.id}`);
  const archivePublicationLock = (id, locked) => { const key = `archive:${id}`; if (locked) pendingWrites.current.add(key); else pendingWrites.current.delete(key); };
  const archivePublicationSaved = async (dto, scope) => {
    if (view.role !== 'admin') throw new Error('Solo administración puede archivar o restaurar piezas.');
    scope.assertCurrent();
    if (dto.piece.dominio !== 'publicacion') throw new Error('La respuesta no corresponde a una publicación.');
    ++listGeneration.current;
    onCommittedChange?.(dto.piece.archived ? { deletedId: dto.piece.id } : { invalidate: true });
    if (dto.piece.archived) setPublicaciones(prev => prev.filter(row => row.id !== dto.piece.id));
    const loaded = await cargar(scope); scope.assertCurrent();
    if (loaded !== true) throw new Error('Cambio guardado. No se pudo actualizar la lista; verificá la lectura sin repetir la operación.');
  };

  const copiarFila = async (p) => {
    const scope = capture();
    if (!scope.current()) return;
    const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado);
    const linea = [
      p.fecha_programada || "",
      getTipoPublicacionLabel(p.tipo),
      p.idea || "",
      p.copy || "",
      p.material_referencia || "",
      p.aclaraciones || "",
      p.responsable || "",
      est?.label || p.estado || "",
    ].join("\t");
    try {
      await navigator.clipboard.writeText(linea);
    } catch { /* Copy failure has no session or server side effects. */ }
  };

  const enfocarCelda = (rowIndex, columna) => {
    const el = gridRef.current?.querySelector(`[data-cell="${rowIndex}:${columna}"]`);
    if (!el) return;
    el.focus();
    if (typeof el.select === "function") el.select();
  };

  const manejarEnterOTab = (e, rowIndex, columna) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      enfocarCelda(rowIndex + 1, columna);
    }
  };

  const manejarPaste = (e, rowIndex, columna) => {
    const scope = capture();
    if (!scope.current()) return;
    const texto = e.clipboardData.getData("text/plain");
    if (!texto.includes("\t") && !texto.includes("\n")) return;
    e.preventDefault();

    const filasTexto = texto.replace(/\r/g, "").split("\n");
    while (filasTexto.length > 1 && filasTexto[filasTexto.length - 1] === "") {
      filasTexto.pop();
    }

    const colInicio = COLUMNAS_PUBLICACION.indexOf(columna);

    filasTexto.forEach((filaTexto, dRow) => {
      const objetivo = filasVisibles[rowIndex + dRow];
      if (!objetivo) return;

      const valores = filaTexto.split("\t");
      let payload = {};
      valores.forEach((valorCelda, dCol) => {
        const colObjetivo = COLUMNAS_PUBLICACION[colInicio + dCol];
        if (!colObjetivo) return;
        const campo = payloadColumnaPublicacion(colObjetivo, valorCelda);
        if (!campo) return;
        payload = { ...payload, ...campo };
      });

      if (Object.keys(payload).length > 0) {
        actualizarLocal(objetivo.id, payload, scope);
        void guardarEnServidor(objetivo.id, payload, scope);
      }
    });
  };

  return (
    <>
      <label>Responsable de nuevas publicaciones
        <select aria-label="Responsable de nuevas publicaciones" value={responsableNuevoId} disabled={!responsablesReady || creationState.locked} onChange={event => setResponsableNuevoId(event.target.value)}>
          <option value="">Elegí una persona</option>
          {responsables.map(person => <option key={person.id} value={person.id}>{person.nombre} · #{person.id}</option>)}
        </select>
      </label>
      {creationState.locked && <div role="status"><p>Conservamos el intento original. No crees otra pieza sin verificarlo. Al salir de este contexto se pierde la clave de recuperación.</p>
        <button type="button" disabled={creationState.busy || creationState.phase === 'blocked'} onClick={() => void crearPublicacion(true)}>Verificar creación</button>
      </div>}
      {error && (
        <div className="alert is-error">{error}</div>
      )}

      {cargando ? (
        <div className="state-empty">Cargando planilla…</div>
      ) : (
        <div className="sheet-frame" ref={gridRef}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{ width: "56px" }}>Día</th>
                <th style={{ width: "120px" }}>Fecha</th>
                <th style={{ width: "100px" }}>Tipo</th>
                <th style={{ width: "20%" }}>Idea</th>
                <th style={{ width: "24%" }}>Copy</th>
                <th style={{ width: "14%" }}>Material</th>
                <th style={{ width: "16%" }}>Observaciones</th>
                <th style={{ width: "110px" }}>Responsable</th>
                <th style={{ width: "120px" }}>Estado</th>
                <th style={{ width: "56px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "24px", color: "#999" }}>
                    Sin publicaciones planificadas este mes todavía.
                  </td>
                </tr>
              )}
              {filasVisibles.map((p, rowIndex) => {
                const fecha = new Date(`${p.fecha_programada}T00:00:00`);
                const dow = fecha.getDay();
                const esFinde = dow === 0 || dow === 6;
                const esHoy = p.fecha_programada === hoyISO;
                const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado) || ESTADOS_PUBLICACION[0];
                const bgFila = esHoy ? "#e3f2fd" : esFinde ? "#fafafa" : undefined;

                return (
                  <tr key={p.id} style={{ background: bgFila }}>
                    <td style={{ padding: "6px 10px", fontWeight: esHoy ? "700" : "600", color: esFinde ? "#999" : "#333", fontSize: "12px" }}>
                      {LETRAS_DIA[dow]}
                    </td>
                    <td>
                      <input
                        type="date"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:fecha`}
                        aria-label={`Fecha programada · publicación #${p.id}`}
                        value={p.fecha_programada || ""}
                        onChange={(e) => actualizarLocal(p.id, { fecha_programada: e.target.value })}
                        onBlur={(e) => guardarEnServidor(p.id, { fecha_programada: e.target.value })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "fecha")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "fecha")}
                      />
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:tipo`}
                        aria-label={`Tipo de publicación · publicación #${p.id}`}
                        value={p.tipo}
                        onChange={(e) => {
                          actualizarLocal(p.id, { tipo: e.target.value });
                          guardarEnServidor(p.id, { tipo: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "tipo")}
                      >
                        {TIPOS_PUBLICACION.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:idea`}
                        aria-label={`Idea · publicación #${p.id}`}
                        placeholder="Escribir idea…"
                        value={p.idea || ""}
                        onChange={(e) => actualizarLocal(p.id, { idea: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { idea: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "idea")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "idea")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:copy`}
                        aria-label={`Texto / copy · publicación #${p.id}`}
                        placeholder="Escribir copy…"
                        value={p.copy || ""}
                        onChange={(e) => actualizarLocal(p.id, { copy: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { copy: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "copy")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "copy")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:material`}
                        aria-label={`Enlace de material · publicación #${p.id}`}
                        placeholder="Link…"
                        value={p.material_referencia || ""}
                        onChange={(e) => actualizarLocal(p.id, { material_referencia: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { material_referencia: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "material")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "material")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:aclaraciones`}
                        aria-label={`Notas · publicación #${p.id}`}
                        placeholder="—"
                        value={p.aclaraciones || ""}
                        onChange={(e) => actualizarLocal(p.id, { aclaraciones: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { aclaraciones: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "aclaraciones")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "aclaraciones")}
                      />
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:responsable`}
                        aria-label={`Responsable · publicación #${p.id}`}
                        value={p.responsable || ""}
                        title="Responsable de la pieza. Para reasignar el trabajo, abrí la tarea vinculada."
                        onChange={(e) => {
                          actualizarLocal(p.id, { responsable: e.target.value });
                          guardarEnServidor(p.id, { responsable: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "responsable")}
                      >
                        <option value="">Sin responsable</option>
                        {p.responsable && !responsables.some(person => person.nombre === p.responsable) &&
                          <option value={p.responsable}>{p.responsable}</option>}
                        {/* Existing-row PATCH still edits its legacy display name, not assignment IDs. */}
                        {responsables.map((person) => (
                          <option key={person.id} value={person.nombre}>{person.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:estado`}
                        aria-label={`Estado · publicación #${p.id}`}
                        value={p.estado}
                        disabled={view.role !== 'admin' || isConfirmedPublication(p)}
                        onChange={(e) => {
                          actualizarLocal(p.id, { estado: e.target.value });
                          guardarEnServidor(p.id, { estado: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "estado")}
                        style={{ background: est.bg, color: est.fg, fontWeight: "600", border: "1px solid transparent" }}
                      >
                        {ESTADOS_PUBLICACION.map((e) => (
                          <option key={e.id} value={e.id} disabled={e.id === 'publicada'}>{e.label}</option>
                        ))}
                      </select>
                      <EditorialPublicationControl dominio="publicacion" pieza={p} sesion={view.session} onSaved={publicationSaved} />
                    </td>
                    <td>
                      <div className="sheet-row-actions">
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => copiarFila(p)}
                          title="Copiar fila (para pegar en otra fila o en Sheets)"
                          aria-label={`Copiar publicación #${p.id}`}
                        >
                          <span aria-hidden="true">⧉</span>
                        </button>
                        {view.role === 'admin' && <EditorialArchiveControl dominio="publicacion" piece={p} isAdmin capture={capture}
                          canStart={() => canArchivePublication(p)} onSaved={archivePublicationSaved} onLockChange={locked => archivePublicationLock(p.id, locked)} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={10} style={{ padding: 0 }}>
                  <button type="button" className="sheet-add-row" disabled={creationState.locked || !responsablesReady || !responsableNuevoId} onClick={() => void crearPublicacion()}>
                    <span style={{ fontSize: "15px" }}>+</span> Agregar publicación
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="caption" style={{ marginTop: "10px" }}>
        Planilla de {clienteNombre} · Click en una celda para escribir · Tab / Enter para moverte · pegá bloques copiados de Sheets directamente sobre la grilla.
      </div>
    </>
  );
}

export function PublicacionesPage({ tabInicial = "calendario", sesion }) {
  const { view, capture } = usePublicationSession(sesion);
  const initialContext = readUrlContext(window.location.search, { tab: tabInicial, cliente: "", mes: "" });
  const initialDate = readMonthContext(initialContext.mes, new Date().getFullYear(), new Date().getMonth());
  const [tabPrincipal, setTabPrincipal] = useState(
    ["calendario", "preparar", "programadas", "historial", "lista", "planilla", "archivadas"].includes(initialContext.tab) ? initialContext.tab : tabInicial,
  );
  const [clienteSeleccionado, setClienteSeleccionado] = useState(Number(initialContext.cliente) || null);
  const [calendarContext, setCalendarContext] = useState(() => readPublicationCalendarContext(window.location.search));
  const [trackingContext, setTrackingContext] = useState(() => readPublicationTrackingContext(window.location.search));
  const [clientes, setClientes] = useState([]);
  const [errorClientes, setErrorClientes] = useState(null);
  const [publicaciones, setPublicaciones] = useState([]);
  const overviewGeneration = useRef(0);

  const hoyDate = new Date();
  const [year, setYear] = useState(initialDate.year);
  const [month, setMonth] = useState(initialDate.month);

  const approveContextChange = changes => requestAppNavigation(window, buildContextUrl(window.location.href, changes));

  useEffect(() => {
    replaceUrlContext({ tab: tabPrincipal, cliente: clienteSeleccionado, mes: formatMonthContext(year, month), ...publicationCalendarUrlChanges(calendarContext), ...publicationTrackingUrlChanges(trackingContext) });
  }, [tabPrincipal, clienteSeleccionado, year, month, calendarContext, trackingContext]);

  useEffect(() => {
    const restoreContext = () => {
      const context = readUrlContext(window.location.search, { tab: "calendario", cliente: "", mes: "" });
      const date = readMonthContext(context.mes, hoyDate.getFullYear(), hoyDate.getMonth());
      setTabPrincipal(["calendario", "preparar", "programadas", "historial", "lista", "planilla", "archivadas"].includes(context.tab) ? context.tab : "calendario");
      setClienteSeleccionado(Number(context.cliente) || null);
      setYear(date.year);
      setMonth(date.month);
      setCalendarContext(readPublicationCalendarContext(window.location.search));
      setTrackingContext(readPublicationTrackingContext(window.location.search));
    };
    window.addEventListener("popstate", restoreContext);
    return () => window.removeEventListener("popstate", restoreContext);
  }, []);

  useEffect(() => {
    const scope = capture();
    const controller = new AbortController();
    const current = () => scope.current() && !controller.signal.aborted;
    scope.request("/api/clientes", { signal: controller.signal })
      .then((data) => {
        if (!current()) return;
        setClientes(data);
        if (data.length > 0) setClienteSeleccionado((prev) => prev ?? data[0].id);
      })
      .catch(() => {
        if (current()) setErrorClientes("No se pudieron cargar los clientes.");
      });
    return () => controller.abort();
  }, [capture]);

  // Initial sidebar/overview read. A newer child snapshot or committed write
  // invalidates this generation before a delayed initial response can paint.
  useEffect(() => {
    const scope = capture();
    const controller = new AbortController();
    const generation = ++overviewGeneration.current;
    scope.request("/api/publicaciones", { signal: controller.signal })
      .then((data) => { if (scope.current() && !controller.signal.aborted && generation === overviewGeneration.current) setPublicaciones(Array.isArray(data) ? data : []); })
      .catch(() => { /* Complementary overview must not bypass session failure. */ });
    return () => controller.abort();
  }, [capture]);

  const overviewSnapshotLoaded = useCallback(data => {
    if (!capture().current() || !Array.isArray(data)) return;
    ++overviewGeneration.current;
    setPublicaciones(data);
  }, [capture]);

  const overviewCommittedChange = useCallback(change => {
    if (!capture().current()) return;
    ++overviewGeneration.current;
    if (change.invalidate) return;
    setPublicaciones(prev => change.deletedId != null
      ? prev.filter(row => row.id !== change.deletedId)
      : [...prev.filter(row => row.id !== change.row.id), change.row]);
  }, [capture]);

  const archiveOverviewSaved = async (dto, scope) => {
    if (view.role !== 'admin' || dto.piece.dominio !== 'publicacion') throw new Error('No se pudo verificar la pieza restaurada.');
    scope.assertCurrent(); const generation = ++overviewGeneration.current;
    const rows = await scope.request('/api/publicaciones', { cache: 'no-store' }); scope.assertCurrent();
    if (generation === overviewGeneration.current && Array.isArray(rows)) setPublicaciones(rows);
  };

  const publicationSaved = useCallback(dto => {
    const scope = capture();
    if (!scope.current()) return;
    ++overviewGeneration.current;
    setPublicaciones(prev => prev.map(row => row.id === dto.piece.id ? mergeEditorialStatus(row, dto) : row));
  }, [capture]);

  const irAPlanillaDeCliente = (clienteId) => {
    if (!approveContextChange({ tab: 'planilla', cliente: clienteId, mes: formatMonthContext(year, month) })) return;
    pushUrlContext({ tab: "planilla", cliente: clienteId, mes: formatMonthContext(year, month) });
    setClienteSeleccionado(clienteId);
    setTabPrincipal("planilla");
  };

  const clienteActual = clientes.find((c) => c.id === clienteSeleccionado);
  const clienteNombre = clienteActual?.nombre || "";

  const hoyISO = getHoyLocalISO();

  const irMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    if (!approveContextChange({ mes: formatMonthContext(y, m) })) return;
    pushUrlContext({ mes: formatMonthContext(y, m) });
    setMonth(m);
    setYear(y);
  };
  const irAHoy = () => {
    if (!approveContextChange({ mes: formatMonthContext(hoyDate.getFullYear(), hoyDate.getMonth()) })) return;
    pushUrlContext({ mes: formatMonthContext(hoyDate.getFullYear(), hoyDate.getMonth()) });
    setMonth(hoyDate.getMonth());
    setYear(hoyDate.getFullYear());
  };

  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const publicacionesClienteMes = publicaciones.filter(
    (p) => p.cliente_id === clienteSeleccionado && p.fecha_programada?.startsWith(mesPrefix),
  );
  const publicadasCliente = publicacionesClienteMes.filter(isConfirmedPublication).length;
  const pendientesCliente = publicacionesClienteMes.length - publicadasCliente;
  const atrasadasCliente = publicacionesClienteMes.filter(
    (p) => p.fecha_programada < hoyISO && !isConfirmedPublication(p),
  ).length;

  const TABS_PRINCIPALES = [
    { id: "calendario", label: "Calendario" },
    { id: "preparar", label: "Preparar" },
    { id: "programadas", label: "Programadas" },
    { id: "historial", label: "Historial" },
    { id: "lista", label: "Seguimiento" },
    ...(view.role === 'admin' ? [{ id: 'archivadas', label: 'Archivadas' }] : []),
  ];
  const canPublish = ["admin", "community"].includes(view.role);

  const cambiarVista = (tab) => {
    if (!approveContextChange({ tab })) return;
    pushUrlContext({ tab });
    setTabPrincipal(tab);
  };

  const cambiarCalendario = changes => {
    if (!capture().current()) return;
    const next = normalizePublicationCalendarContext({ ...calendarContext, ...changes });
    if (next.view === calendarContext.view && next.type === calendarContext.type) return;
    const urlChanges = publicationCalendarUrlChanges(next);
    if (!approveContextChange(urlChanges)) return;
    pushUrlContext(urlChanges);
    setCalendarContext(next);
  };

  const cambiarSeguimiento = changes => {
    if (!capture().current()) return;
    const next = normalizePublicationTrackingContext({ ...trackingContext, ...changes });
    const urlChanges = publicationTrackingUrlChanges(next);
    if (Object.keys(next).every(key => next[key] === trackingContext[key])) return;
    if (!approveContextChange(urlChanges)) return;
    pushUrlContext(urlChanges);
    setTrackingContext(next);
  };

  return (
    <main aria-label="Render platform publicaciones" className="publicaciones-viewport">
      <div className="frame">
        <div className="content">
          <header className="module-intro">
            <div><h2>Publicaciones</h2><p>Planificá, prepará y controlá los Reels y Carruseles de cada cliente.</p></div>
          </header>
          {errorClientes && <PageState compact type="error" title={errorClientes} description="La vista, el cliente y el mes siguen guardados." onRetry={() => window.location.reload()} />}

          <div className="h-workspace">
            <div className="h-main">
              <div className="h-toolbar publications-main-toolbar">
                <div className="stories-view-switch publications-view-switch" aria-label="Vistas de Publicaciones">
                  {TABS_PRINCIPALES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={tabPrincipal === t.id ? "active" : ""}
                      onClick={() => cambiarVista(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`stories-primary-action publications-plan-action ${tabPrincipal === "planilla" ? "active" : ""}`}
                  onClick={() => cambiarVista("planilla")}
                  aria-current={tabPrincipal === "planilla" ? "page" : undefined}
                >
                  Planificar por cliente
                </button>
              </div>

              {tabPrincipal === "planilla" && (
                <>
                  <div className="stories-context-bar publications-context-bar">
                    <label className="stories-context-field">
                      <span>Cliente</span>
                      <select
                        className="h-toolbar-client-select"
                        value={clienteSeleccionado || ""}
                        onChange={(event) => irAPlanillaDeCliente(Number(event.target.value))}
                        aria-label="Elegir cliente para planificar publicaciones"
                      >
                        {clienteSeleccionado && !clientes.some(cliente => cliente.id === clienteSeleccionado) && <option disabled value={clienteSeleccionado}>Cliente no disponible ({clienteSeleccionado})</option>}
                        {clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>)}
                      </select>
                    </label>
                    <div className="stories-month-control" aria-label="Período de planificación">
                      <button type="button" onClick={() => irMes(-1)} aria-label="Mes anterior">‹</button>
                      <strong>{MESES[month]} {year}</strong>
                      <button type="button" onClick={() => irMes(1)} aria-label="Mes siguiente">›</button>
                    </div>
                    <button className="h-today-btn" type="button" onClick={irAHoy}>Mes actual</button>
                  </div>
                  <div className="stories-overview publications-overview" aria-label="Resumen del cliente y período">
                    <div><span>Planificadas</span><strong>{publicacionesClienteMes.length}</strong></div>
                    <div><span>Pendientes</span><strong>{pendientesCliente}</strong></div>
                    <div className="is-success"><span>Confirmadas · cohorte programada</span><strong>{publicadasCliente}</strong></div>
                    <div><span>Históricas sin confirmación · cohorte programada</span><strong>{publicacionesClienteMes.filter(isHistoricalPublication).length}</strong></div>
                    <div className={atrasadasCliente > 0 ? "is-danger" : ""}><span>Atrasadas</span><strong>{atrasadasCliente}</strong></div>
                  </div>
                </>
              )}

              <div className="h-body">
                {tabPrincipal === 'archivadas' && view.role === 'admin' && <EditorialArchivePanel dominio="publicacion" isAdmin capture={capture} onSaved={archiveOverviewSaved} />}
                {tabPrincipal === "calendario" && (
                  <PublicacionesCalendarioTab
                    sesion={view.session}
                    onPublicationSaved={publicationSaved}
                    onCommittedChange={overviewCommittedChange}
                    onIrAPlanilla={irAPlanillaDeCliente}
                    contextYear={year}
                    contextMonth={month}
                    calendarContext={calendarContext}
                    onCalendarContextChange={cambiarCalendario}
                    onMonthChange={(nextYear, nextMonth) => { if (!approveContextChange({ mes: formatMonthContext(nextYear, nextMonth) })) return; pushUrlContext({ mes: formatMonthContext(nextYear, nextMonth) }); setYear(nextYear); setMonth(nextMonth); }}
                  />
                )}

                {tabPrincipal === "lista" && (
                  <PublicacionesGeneralTab sesion={view.session} onPublicationSaved={publicationSaved} clientes={clientes} onIrACliente={irAPlanillaDeCliente} trackingContext={trackingContext} onTrackingContextChange={cambiarSeguimiento} />
                )}

                {tabPrincipal === "preparar" && (
                  <PublicationComposer publications={publicaciones} clients={clientes} canPublish={canPublish}/>
                )}

                {tabPrincipal === "programadas" && <PublicationPreviewQueue mode="scheduled"/>}

                {tabPrincipal === "historial" && <PublicationPreviewQueue mode="history"/>}

                {tabPrincipal === "planilla" && clienteActual && (
                  <PublicacionesPlanillaTab
                    sesion={view.session}
                    onPublicationSaved={publicationSaved}
                    onSnapshotLoaded={overviewSnapshotLoaded}
                    onCommittedChange={overviewCommittedChange}
                    key={`pub-${clienteSeleccionado}`}
                    clienteId={clienteSeleccionado}
                    clienteNombre={clienteNombre}
                    year={year}
                    month={month}
                  />
                )}

                {tabPrincipal === "planilla" && !clienteActual && (
                  <div className="state-empty">
                    Elegí un cliente en el panel izquierdo.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
