import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { esperandoMaterial, extraerUrlsTarea, fechaISODesde, formatearFechaTarea, getEstadoTarea, getGrillaMes, getHoyLocalISO, getPrioridadTarea, getSectorTarea, getSesion, getTipoPublicacionLabel, getUsuarioKey, obtenerInfoLinkTarea, ordenarTareasPorPrioridad, renderizarTextoTarea } from "../utils.jsx";
import { DIAS_SEMANA, ESTADO_FINAL_TAREA, ESTADOS_TAREA, MESES, PRIORIDADES_TAREA, RESPONSABLES_EQUIPO, SECTORES_TAREA, SUBTIPOS_SUGERIDOS } from "../constants.js";
import { PiezasTableroPage } from "../pages/PiezasTablero.jsx";

export function TareasTableroPage() {
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";

  const [tareas, setTareas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [tareaSeleccionadaId, setTareaSeleccionadaId] = useState(null);
  const [vista, setVista] = useState("kanban");
  const [mostrarWizard, setMostrarWizard] = useState(false);
  const [filtroSector, setFiltroSector] = useState("todos");
  const [filtroResponsable, setFiltroResponsable] = useState("todos");

  const cargarTareas = () => {
    setCargando(true);
    fetch("/api/tareas")
      .then((r) => r.json())
      .then((data) => {
        setTareas(Array.isArray(data) ? data : []);
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando tareas", err);
        setError("No se pudieron cargar las tareas.");
      })
      .finally(() => setCargando(false));
  };

  useEffect(cargarTareas, []);
  useEffect(() => {
    fetch("/api/clientes")
      .then((r) => r.json())
      .then((data) => setClientes(Array.isArray(data) ? data : []))
      .catch((err) => console.error("No se pudieron cargar clientes", err));
  }, []);

  const hoyISO = getHoyLocalISO();

  const responsablesDisponibles = [
    ...new Set([
      ...RESPONSABLES_EQUIPO,
      ...tareas.map((t) => t.asignado_a).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const tareasDelResponsable = tareas.filter(
    (t) =>
      filtroResponsable === "todos" ||
      t.asignado_a === filtroResponsable,
  );

  const tareasFiltradas = ordenarTareasPorPrioridad(tareasDelResponsable.filter((t) => {
    if (filtroSector !== "todos" && t.tipo_tarea !== filtroSector) return false;
    return true;
  }));

  const fechaLimiteSemana = new Date();
  fechaLimiteSemana.setDate(fechaLimiteSemana.getDate() + 7);
  const fechaLimiteSemanaISO = [
    fechaLimiteSemana.getFullYear(),
    String(fechaLimiteSemana.getMonth() + 1).padStart(2, "0"),
    String(fechaLimiteSemana.getDate()).padStart(2, "0"),
  ].join("-");
  const tareasVencenSemana = tareasFiltradas.filter(
    (t) =>
      t.fecha_vencimiento &&
      t.fecha_vencimiento >= hoyISO &&
      t.fecha_vencimiento <= fechaLimiteSemanaISO &&
      t.estado !== ESTADO_FINAL_TAREA,
  ).length;
  const tareasAtrasadas = tareasFiltradas.filter(
    (t) =>
      t.fecha_vencimiento &&
      t.fecha_vencimiento < hoyISO &&
      t.estado !== ESTADO_FINAL_TAREA,
  ).length;
  const tareasEnRevision = tareasFiltradas.filter(
    (t) => t.estado === "en_revision",
  ).length;
  const grupos = ESTADOS_TAREA.map((e) => ({
    id: e.id,
    titulo: e.label,
    tareas: tareasFiltradas.filter((t) => t.estado === e.id),
  })).filter((grupo) => grupo.tareas.length > 0);

  const actualizarLocal = (id, campos) => {
    setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, ...campos } : t)));
  };

  const guardarEnServidor = async (id, campos) => {
    try {
      const res = await fetch(`/api/tareas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
      const actualizada = await res.json();
      setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, ...actualizada } : t)));
    } catch (err) {
      console.error("Error guardando tarea", err);
      setError("No se pudo guardar un cambio — reintentá.");
    }
  };

  const actualizarCampo = (id, campos) => {
    actualizarLocal(id, campos);
    guardarEnServidor(id, campos);
  };

  const eliminarTarea = async (id) => {
    if (!window.confirm("¿Eliminar esta tarea? No se puede deshacer.")) return;
    try {
      const res = await fetch(`/api/tareas/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setTareas((prev) => prev.filter((t) => t.id !== id));
      setTareaSeleccionadaId((actual) => (actual === id ? null : actual));
    } catch (err) {
      console.error("Error eliminando tarea", err);
      setError("No se pudo eliminar la tarea.");
    }
  };

  const tareaSeleccionada = tareas.find((t) => t.id === tareaSeleccionadaId) || null;

  return (
    <main aria-label="Render platform tareas" className="tareas-viewport">
      <div className="frame">
        <div className="content">
          <div className="h-workspace">
            <div className="h-main">
              <div className="task-page-heading">
                <div>
                  <h1>Tareas</h1>
                  <p>Organizá, asigná y revisá el trabajo del equipo.</p>
                </div>
                {esAdmin && (
                  <button className="btn task-new-button" type="button" onClick={() => setMostrarWizard(true)}>
                    + Nueva tarea
                  </button>
                )}
              </div>

              <div className="h-toolbar task-toolbar-simplified">
                <div className="sheet-view-tabs task-view-tabs">
                  <button type="button" className={vista === "tabla" ? "active" : ""} onClick={() => setVista("tabla")}>Lista</button>
                  <button type="button" className={vista === "kanban" ? "active" : ""} onClick={() => setVista("kanban")}>Columnas</button>
                  <button type="button" className={vista === "calendario" ? "active" : ""} onClick={() => setVista("calendario")}>Calendario</button>
                  <button type="button" className={vista === "proyecto" ? "active" : ""} onClick={() => setVista("proyecto")}>Por cliente</button>
                </div>

                <label className="task-compact-filter">
                  <span>Responsable</span>
                  <select
                    value={filtroResponsable}
                    onChange={(e) => setFiltroResponsable(e.target.value)}
                  >
                    <option value="todos">Todos los usuarios</option>
                    {responsablesDisponibles.map((nombre) => (
                      <option key={nombre} value={nombre}>
                        {nombre}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="task-compact-filter">
                  <span>Sector</span>
                  <select
                    value={filtroSector}
                    onChange={(e) => setFiltroSector(e.target.value)}
                  >
                    <option value="todos">Todos los sectores</option>
                    {SECTORES_TAREA.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.label}
                      </option>
                    ))}
                  </select>
                </label>

              </div>

              <div className="task-compact-summary" aria-label="Resumen de tareas filtradas">
                <span><strong>{tareasFiltradas.length}</strong> tareas</span>
                <i aria-hidden="true" />
                <span><strong>{tareasVencenSemana}</strong> vencen esta semana</span>
                <i aria-hidden="true" />
                <span className={tareasAtrasadas > 0 ? "is-alert" : ""}><strong>{tareasAtrasadas}</strong> atrasadas</span>
                <i aria-hidden="true" />
                <span><strong>{tareasEnRevision}</strong> en revisión</span>
              </div>

              <div className="h-body">
                {error && (
                  <div style={{ padding: "10px", background: "#331616", color: "#ef5350", borderRadius: "4px", marginBottom: "12px" }}>
                    {error}
                  </div>
                )}

                {cargando ? (
                  <div style={{ textAlign: "center", padding: "40px", color: "#6b6f76" }}>Cargando tareas…</div>
                ) : vista === "kanban" ? (
                  <TareaKanbanBoard
                    tareas={tareasFiltradas}
                    columnas={ESTADOS_TAREA}
                    campo="estado"
                    onMover={(id, nuevoEstado) => actualizarCampo(id, { estado: nuevoEstado })}
                    onAbrir={setTareaSeleccionadaId}
                  />
                ) : vista === "calendario" ? (
                  <TareaCalendario tareas={tareasFiltradas} onAbrir={setTareaSeleccionadaId} />
                ) : vista === "proyecto" ? (
                  <TareasPorCliente tareas={tareasFiltradas} onAbrir={setTareaSeleccionadaId} />
                ) : grupos.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px", color: "#6b6f76" }}>
                    {tareas.length === 0
                      ? "No hay tareas todavía."
                      : "Ninguna tarea coincide con estos filtros."}
                  </div>
                ) : (
                  <div className="sheet-frame task-list-frame">
                    <table className="sheet-table task-list-table">
                      <thead>
                        <tr>
                          <th>Tarea</th>
                          <th>Responsable</th>
                          <th>Estado</th>
                          <th>Vencimiento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupos.map((grupo) => (
                          <React.Fragment key={grupo.id}>
                            <tr>
                              <td colSpan={4} className="task-list-group">
                                {grupo.titulo} <span style={{ color: "#6b6f76", fontWeight: 400 }}>({grupo.tareas.length})</span>
                              </td>
                            </tr>
                            {grupo.tareas.map((t) => {
                              const est = getEstadoTarea(t.estado);
                              const prio = getPrioridadTarea(t.prioridad);
                              const sector = getSectorTarea(t.tipo_tarea);
                              const vencida = t.fecha_vencimiento && t.fecha_vencimiento < hoyISO && t.estado !== ESTADO_FINAL_TAREA;

                              return (
                                <tr key={t.id} className="task-list-row" onClick={() => setTareaSeleccionadaId(t.id)}>
                                  <td className="task-list-main">
                                    <strong>{t.titulo}</strong>
                                    <div>
                                      <span>{t.cliente_nombre || "Sin cliente"}</span>
                                      {sector && <span>{sector.label}</span>}
                                      {t.prioridad === "alta" && (
                                        <span style={{ color: prio.fg }}>Prioridad alta</span>
                                      )}
                                    </div>
                                    {esperandoMaterial(t) && (
                                      <small className="task-list-material">Esperando material</small>
                                    )}
                                  </td>
                                  <td><span className="task-list-person">{t.asignado_a}</span></td>
                                  <td><span className="task-list-status" style={{ color: est.fg, background: est.bg }}>{est.label}</span></td>
                                  <td className={vencida ? "task-list-due is-overdue" : "task-list-due"}>
                                    {formatearFechaTarea(t.fecha_vencimiento)}
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {tareaSeleccionada && (
              <TareaDetallePanel
                tarea={tareaSeleccionada}
                clientes={clientes}
                tareas={tareas}
                onCerrar={() => setTareaSeleccionadaId(null)}
                onAbrir={setTareaSeleccionadaId}
                onActualizarCampo={actualizarCampo}
                onEliminar={eliminarTarea}
                onSubtareaCreada={(creada) => {
                  const clienteNombre = clientes.find((c) => c.id === creada.cliente_id)?.nombre || null;
                  setTareas((prev) => [{ ...creada, cliente_nombre: clienteNombre }, ...prev]);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {mostrarWizard && (
        <NuevaTareaWizard
          clientes={clientes}
          onCerrar={() => setMostrarWizard(false)}
          onCreada={(creada) => {
            const clienteNombre = clientes.find((c) => c.id === creada.cliente_id)?.nombre || null;
            const tareaCompleta = { ...creada, cliente_nombre: clienteNombre };
            setTareas((prev) => [tareaCompleta, ...prev]);
            setMostrarWizard(false);
            setTareaSeleccionadaId(creada.id);
          }}
        />
      )}
    </main>
  );
}

const URL_EN_TAREA_REGEX = /(https?:\/\/[^\s<>"')\]]+)/gi;

export function TareaDetallePanel({
  tarea,
  clientes,
  tareas,
  onCerrar,
  onAbrir,
  onActualizarCampo,
  onEliminar,
  onSubtareaCreada,
}) {
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";
  const esResponsable =
    getUsuarioKey(tarea.asignado_a) === getUsuarioKey(sesion?.usuario?.usuario);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [comentarios, setComentarios] = useState([]);
  const [comentarioNuevo, setComentarioNuevo] = useState("");
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const [tituloSubtarea, setTituloSubtarea] = useState("");
  const [creandoSubtarea, setCreandoSubtarea] = useState(false);
  const est = getEstadoTarea(tarea.estado);
  const prio = getPrioridadTarea(tarea.prioridad);
  const sector = getSectorTarea(tarea.tipo_tarea);
  const urlsAclaraciones = [...new Set(extraerUrlsTarea(tarea.aclaraciones || ""))];
  const materialUrl = tarea.material_referencia || "";
  const materialInfo = materialUrl ? obtenerInfoLinkTarea(materialUrl) : null;
  const referencias = urlsAclaraciones.filter((url) => url !== materialUrl);
  const resumen = tarea.propiedades_extra?.resumen || "";
  const etiquetas = Array.isArray(tarea.propiedades_extra?.etiquetas)
    ? tarea.propiedades_extra.etiquetas
    : [];
  const colaboradores = Array.isArray(tarea.propiedades_extra?.colaboradores)
    ? tarea.propiedades_extra.colaboradores
    : [];
  const subtareas = ordenarTareasPorPrioridad(
    tareas.filter((item) => Number(item.tarea_padre_id) === Number(tarea.id)),
  );
  if (materialUrl && materialInfo?.tipo !== "material" && !referencias.includes(materialUrl)) {
    referencias.unshift(materialUrl);
  }

  useEffect(() => {
    setModoEdicion(false);
    setComentarioNuevo("");
    setTituloSubtarea("");
    fetch(`/api/tareas/${tarea.id}/comentarios`)
      .then((respuesta) => respuesta.json())
      .then((data) => setComentarios(Array.isArray(data) ? data : []))
      .catch((error) => console.error("No se pudieron cargar comentarios", error));
  }, [tarea.id]);

  useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    const overscrollAnterior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = overflowAnterior;
      document.body.style.overscrollBehavior = overscrollAnterior;
    };
  }, []);

  const actualizarMetadatos = (campos) => {
    onActualizarCampo(tarea.id, {
      propiedades_extra: { ...tarea.propiedades_extra, ...campos },
    });
  };

  const enviarComentario = async () => {
    const contenido = comentarioNuevo.trim();
    if (!contenido || enviandoComentario) return;
    setEnviandoComentario(true);
    try {
      const respuesta = await fetch(`/api/tareas/${tarea.id}/comentarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autor: sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER",
          contenido,
        }),
      });
      const data = await respuesta.json();
      if (!respuesta.ok) throw new Error(data.error || "No se pudo comentar.");
      setComentarios((actuales) => [...actuales, data]);
      setComentarioNuevo("");
    } catch (error) {
      console.error("No se pudo guardar el comentario", error);
    } finally {
      setEnviandoComentario(false);
    }
  };

  const crearSubtarea = async () => {
    const titulo = tituloSubtarea.trim();
    if (!titulo || creandoSubtarea) return;
    setCreandoSubtarea(true);
    try {
      const respuesta = await fetch("/api/tareas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          asignado_a: tarea.asignado_a,
          cliente_id: tarea.cliente_id,
          tipo_tarea: tarea.tipo_tarea,
          prioridad: tarea.prioridad,
          tarea_padre_id: tarea.id,
        }),
      });
      const creada = await respuesta.json();
      if (!respuesta.ok) throw new Error(creada.error || "No se pudo crear la subtarea.");
      onSubtareaCreada(creada);
      setTituloSubtarea("");
    } catch (error) {
      console.error("No se pudo crear la subtarea", error);
    } finally {
      setCreandoSubtarea(false);
    }
  };

  const origen = tarea.historia_id
    ? {
        tipo: "Historia",
        fecha: tarea.historia_fecha_programada,
        estado: tarea.historia_estado,
        href: "/planificacion-historias",
      }
    : tarea.publicacion_id
      ? {
          tipo: getTipoPublicacionLabel(tarea.publicacion_tipo),
          fecha: tarea.publicacion_fecha_programada,
          estado: tarea.publicacion_estado,
          href: "/planificacion-publicaciones",
        }
      : null;

  return (
    <>
      <div className="td-panel-backdrop" onMouseDown={onCerrar} aria-hidden="true" />
      <aside className={`td-panel td-panel-readable ${modoEdicion ? "is-editing" : "is-reading"}`}>
        <header className="td-readable-header">
          <div className="td-readable-header-top">
            <div className="td-readable-kicker">
              {sector && (
                <span className={`td-readable-sector sector-${sector.id}`}>
                  {sector.label}
                </span>
              )}
              <span>{tarea.cliente_nombre || "Sin cliente"}</span>
            </div>
            <div className="td-readable-header-actions">
              {esAdmin && (
                <button
                  className="btn td-edit-toggle"
                  type="button"
                  onClick={() => setModoEdicion((actual) => !actual)}
                >
                  {modoEdicion ? "Ver tarea" : "Editar tarea"}
                </button>
              )}
              <button
                type="button"
                className="td-readable-close"
                onClick={onCerrar}
                title="Cerrar"
                aria-label="Cerrar tarea"
              >
                ✕
              </button>
            </div>
          </div>

          {modoEdicion ? (
            <input
              type="text"
              className="sheet-cell td-panel-title"
              value={tarea.titulo}
              onChange={(e) => onActualizarCampo(tarea.id, { titulo: e.target.value })}
              onBlur={(e) => onActualizarCampo(tarea.id, { titulo: e.target.value.trim() })}
            />
          ) : (
            <>
              <h2>{tarea.titulo}</h2>
              {resumen && <p className="td-readable-description">{resumen}</p>}
              {etiquetas.length > 0 && (
                <div className="td-task-tags">
                  {etiquetas.map((etiqueta) => <span key={etiqueta}>{etiqueta}</span>)}
                </div>
              )}
            </>
          )}

          {!modoEdicion && (
            <div className="td-readable-summary">
              <div>
                <span>Responsable</span>
                <strong>{tarea.asignado_a}</strong>
              </div>
              <div>
                <span>Vencimiento</span>
                <strong>{formatearFechaTarea(tarea.fecha_vencimiento)}</strong>
              </div>
              <div>
                <span>Prioridad</span>
                <strong style={{ color: prio.fg }}>{prio.label}</strong>
              </div>
              <div>
                <span>Estado</span>
                <strong style={{ color: est.fg }}>{est.label}</strong>
              </div>
              {colaboradores.length > 0 && (
                <div className="td-summary-wide">
                  <span>Colaboran</span>
                  <strong>{colaboradores.join(", ")}</strong>
                </div>
              )}
            </div>
          )}
        </header>

        {esperandoMaterial(tarea) && (
          <div className="td-panel-banner">
            Esperando material — la tarea de filmación todavía no está marcada como publicada.
          </div>
        )}

        {modoEdicion ? (
          <>
            <div className="td-panel-body td-edit-form">
              <label className="td-panel-field">
                <span>Responsable principal</span>
                <select
                  className="sheet-cell"
                  value={tarea.asignado_a}
                  onChange={(e) => onActualizarCampo(tarea.id, { asignado_a: e.target.value })}
                >
                  {RESPONSABLES_EQUIPO.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field td-edit-wide">
                <span>Resumen corto</span>
                <input
                  type="text"
                  className="sheet-cell"
                  placeholder="Una línea para entender la tarea rápidamente"
                  value={resumen}
                  onChange={(e) => actualizarMetadatos({ resumen: e.target.value })}
                />
              </label>

              <label className="td-panel-field td-edit-wide">
                <span>Etiquetas (separadas por coma)</span>
                <input
                  type="text"
                  className="sheet-cell"
                  placeholder="Mejora, Sitio web, Urgente"
                  value={etiquetas.join(", ")}
                  onChange={(e) => actualizarMetadatos({
                    etiquetas: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                  })}
                />
              </label>

              <fieldset className="td-panel-field td-edit-wide td-collaborators">
                <legend>Colaboradores</legend>
                <div>
                  {RESPONSABLES_EQUIPO.filter((nombre) => nombre !== tarea.asignado_a).map((nombre) => (
                    <label key={nombre}>
                      <input
                        type="checkbox"
                        checked={colaboradores.includes(nombre)}
                        onChange={(e) => actualizarMetadatos({
                          colaboradores: e.target.checked
                            ? [...colaboradores, nombre]
                            : colaboradores.filter((item) => item !== nombre),
                        })}
                      />
                      <span>{nombre}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="td-panel-field">
                <span>Cliente</span>
                <select
                  className="sheet-cell"
                  value={tarea.cliente_id ?? ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { cliente_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Sin cliente</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field">
                <span>Sector</span>
                <select
                  className="sheet-cell"
                  value={tarea.tipo_tarea ?? ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { tipo_tarea: e.target.value || null })}
                  style={sector ? { background: sector.bg, color: sector.fg, fontWeight: "600" } : undefined}
                >
                  <option value="">Sin sector</option>
                  {SECTORES_TAREA.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field">
                <span>Subtipo</span>
                <input
                  type="text"
                  className="sheet-cell"
                  placeholder="reel, historia, carrusel, visita…"
                  value={tarea.subtipo || ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { subtipo: e.target.value || null })}
                />
              </label>

              <label className="td-panel-field">
                <span>Estado</span>
                <select
                  className="sheet-cell"
                  value={tarea.estado}
                  onChange={(e) => onActualizarCampo(tarea.id, { estado: e.target.value })}
                  style={{ background: est.bg, color: est.fg, fontWeight: "600" }}
                >
                  {ESTADOS_TAREA.map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field">
                <span>Prioridad</span>
                <select
                  className="sheet-cell"
                  value={tarea.prioridad}
                  onChange={(e) => onActualizarCampo(tarea.id, { prioridad: e.target.value })}
                  style={{ background: prio.bg, color: prio.fg, fontWeight: "600" }}
                >
                  {PRIORIDADES_TAREA.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field">
                <span>Vencimiento</span>
                <input
                  type="date"
                  className="sheet-cell"
                  value={tarea.fecha_vencimiento || ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { fecha_vencimiento: e.target.value || null })}
                />
              </label>

              <label className="td-panel-field td-edit-brief">
                <span>Guion / indicaciones</span>
                <textarea
                  className="sheet-cell sheet-cell-textarea"
                  rows={12}
                  value={tarea.aclaraciones || ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { aclaraciones: e.target.value })}
                  onBlur={(e) => onActualizarCampo(tarea.id, { aclaraciones: e.target.value.trim() || null })}
                />
              </label>

              <label className="td-panel-field td-edit-material">
                <span>Material / link principal</span>
                <input
                  type="text"
                  className="sheet-cell"
                  placeholder="https://…"
                  value={tarea.material_referencia || ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { material_referencia: e.target.value })}
                  onBlur={(e) => onActualizarCampo(tarea.id, { material_referencia: e.target.value.trim() || null })}
                />
                {tarea.material_referencia && (
                  <a href={tarea.material_referencia} target="_blank" rel="noopener noreferrer" className="td-panel-link">
                    Abrir enlace ↗
                  </a>
                )}
              </label>

              {origen && (
                <div className="td-panel-origen td-edit-wide">
                  <span>Origen</span>
                  <div>
                    {origen.tipo} · {origen.fecha || "sin fecha"} · {origen.estado}
                  </div>
                  <a href={origen.href}>Ir a la planificación →</a>
                </div>
              )}

              {tarea.tarea_padre_id && (
                <div className="td-panel-origen td-edit-wide">
                  <span>Depende de</span>
                  <div>Tarea #{tarea.tarea_padre_id} — estado: {tarea.tarea_padre_estado || "—"}</div>
                </div>
              )}
            </div>

            <div className="td-panel-footer td-edit-footer">
              <button
                type="button"
                className="btn td-danger-action"
                onClick={() => onEliminar(tarea.id)}
              >
                Eliminar tarea
              </button>
              <button className="btn primary" type="button" onClick={() => setModoEdicion(false)}>
                Terminar edición
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="td-readable-body">
              <section className="td-readable-section td-readable-brief">
                <div className="td-readable-section-heading">
                  <span>Brief operativo</span>
                  <h3>Guion e indicaciones</h3>
                </div>
                {tarea.aclaraciones ? (
                  <div className="td-readable-copy">
                    {renderizarTextoTarea(tarea.aclaraciones)}
                  </div>
                ) : (
                  <div className="td-readable-empty">
                    Esta tarea todavía no tiene indicaciones cargadas.
                  </div>
                )}
              </section>

              {referencias.length > 0 && (
                <section className="td-readable-section">
                  <div className="td-readable-section-heading">
                    <span>Enlaces externos</span>
                    <h3>Referencias</h3>
                  </div>
                  <div className="td-readable-links">
                    {referencias.map((url) => {
                      const info = obtenerInfoLinkTarea(url);
                      return (
                        <a href={url} target="_blank" rel="noopener noreferrer" key={url}>
                          <div>
                            <strong>{info.etiqueta}</strong>
                            <span>{info.dominio}</span>
                          </div>
                          <b>↗</b>
                        </a>
                      );
                    })}
                  </div>
                </section>
              )}

              {materialUrl && materialInfo?.tipo === "material" && (
                <section className="td-readable-section">
                  <div className="td-readable-section-heading">
                    <span>Archivos de trabajo</span>
                    <h3>Material / Drive</h3>
                  </div>
                  <a
                    className="td-readable-material"
                    href={materialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div>
                      <strong>{materialInfo.etiqueta}</strong>
                      <span>{materialInfo.dominio}</span>
                    </div>
                    <b>↗</b>
                  </a>
                </section>
              )}

              {(origen || tarea.tarea_padre_id) && (
                <section className="td-readable-section td-readable-context">
                  <div className="td-readable-section-heading">
                    <span>Contexto interno</span>
                    <h3>Origen y dependencia</h3>
                  </div>
                  {origen && (
                    <div className="td-readable-context-row">
                      <div>
                        <strong>{origen.tipo}</strong>
                        <span>{origen.fecha || "Sin fecha"} · {origen.estado}</span>
                      </div>
                      <a href={origen.href}>Ver planificación →</a>
                    </div>
                  )}
                  {tarea.tarea_padre_id && (
                    <div className="td-readable-context-row">
                      <div>
                        <strong>Depende de la tarea #{tarea.tarea_padre_id}</strong>
                        <span>Estado: {tarea.tarea_padre_estado || "—"}</span>
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="td-readable-section">
                <div className="td-readable-section-heading">
                  <span>Jerarquía</span>
                  <h3>Subtareas</h3>
                </div>
                <div className="td-subtasks">
                  {subtareas.map((subtarea) => {
                    const estadoSubtarea = getEstadoTarea(subtarea.estado);
                    return (
                      <button key={subtarea.id} type="button" onClick={() => onAbrir(subtarea.id)}>
                        <span className={subtarea.estado === ESTADO_FINAL_TAREA ? "is-done" : ""}>
                          {subtarea.titulo}
                        </span>
                        <b style={{ color: estadoSubtarea.fg }}>{estadoSubtarea.label}</b>
                      </button>
                    );
                  })}
                  {subtareas.length === 0 && (
                    <div className="td-readable-empty">No hay subtareas cargadas.</div>
                  )}
                </div>
                {esAdmin && (
                  <div className="td-subtask-create">
                    <input
                      type="text"
                      value={tituloSubtarea}
                      placeholder="Nombre de la subtarea"
                      onChange={(e) => setTituloSubtarea(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") crearSubtarea();
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={!tituloSubtarea.trim() || creandoSubtarea}
                      onClick={crearSubtarea}
                    >
                      {creandoSubtarea ? "Creando…" : "+ Agregar"}
                    </button>
                  </div>
                )}
              </section>

              <section className="td-readable-section">
                <div className="td-readable-section-heading">
                  <span>Conversación</span>
                  <h3>Comentarios</h3>
                </div>
                <div className="td-comments">
                  {comentarios.map((comentario) => (
                    <article key={comentario.id}>
                      <div>
                        <strong>{comentario.autor}</strong>
                        <time>{new Date(comentario.created_at).toLocaleString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}</time>
                      </div>
                      <p>{comentario.contenido}</p>
                    </article>
                  ))}
                  {comentarios.length === 0 && (
                    <div className="td-readable-empty">Todavía no hay comentarios.</div>
                  )}
                </div>
                <div className="td-comment-create">
                  <textarea
                    rows={3}
                    value={comentarioNuevo}
                    placeholder="Escribí una actualización, consulta o bloqueo…"
                    onChange={(e) => setComentarioNuevo(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={!comentarioNuevo.trim() || enviandoComentario}
                    onClick={enviarComentario}
                  >
                    {enviandoComentario ? "Enviando…" : "Comentar"}
                  </button>
                </div>
              </section>
            </div>

            <footer className="td-readable-footer">
              {esAdmin ? (
                <button className="btn primary" type="button" onClick={() => setModoEdicion(true)}>
                  Editar tarea
                </button>
              ) : esResponsable && tarea.estado === "pendiente" ? (
                <>
                  <div>
                    <span>Estado actual</span>
                    <strong>{est.label}</strong>
                  </div>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => onActualizarCampo(tarea.id, { estado: "en_progreso" })}
                  >
                    Empezar tarea
                  </button>
                </>
              ) : esResponsable && tarea.estado === "en_progreso" ? (
                <>
                  <div>
                    <span>Estado actual</span>
                    <strong>{est.label}</strong>
                  </div>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => onActualizarCampo(tarea.id, { estado: "en_revision" })}
                  >
                    Enviar a revisión
                  </button>
                </>
              ) : (
                <div className="td-readable-status-note">
                  <span>Estado actual</span>
                  <strong style={{ color: est.fg }}>{est.label}</strong>
                </div>
              )}
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

// Tablero drag-and-drop genérico: columnas + un campo de la tarea que se
// actualiza al soltar. Sirve tanto para "Columnas" (columnas = estado) como
// para "Por persona" (columnas = responsable) sin duplicar la lógica de
// arrastre — mismo patrón HTML5 nativo que ya usaba PiezasTableroPage.

export function TareasPorCliente({ tareas, onAbrir }) {
  const grupos = [...tareas.reduce((mapa, tarea) => {
    const cliente = tarea.cliente_nombre || "Sin cliente";
    if (!mapa.has(cliente)) mapa.set(cliente, []);
    mapa.get(cliente).push(tarea);
    return mapa;
  }, new Map()).entries()].sort(([clienteA], [clienteB]) =>
    clienteA.localeCompare(clienteB),
  );

  if (grupos.length === 0) {
    return <div className="task-project-empty">No hay tareas para mostrar.</div>;
  }

  return (
    <div className="task-project-view">
      {grupos.map(([cliente, items]) => (
        <section key={cliente} className="task-project-group">
          <header>
            <h2>{cliente}</h2>
            <span>{items.length} {items.length === 1 ? "tarea" : "tareas"}</span>
          </header>
          <div>
            {items.map((tarea) => {
              const estado = getEstadoTarea(tarea.estado);
              return (
                <button key={tarea.id} type="button" onClick={() => onAbrir(tarea.id)}>
                  <span>
                    <strong>{tarea.titulo}</strong>
                    <small>{tarea.asignado_a} · {formatearFechaTarea(tarea.fecha_vencimiento)}</small>
                  </span>
                  <b style={{ color: estado.fg, background: estado.bg }}>{estado.label}</b>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// Formulario guiado de creación tipo Notion: en vez de una página aparte,
// abre en el momento sobre la tabla y la tarea aparece ahí apenas se crea.
// Reemplaza el link a /nueva-tarea en /piezas (esa página queda intacta
// para quien todavía la tenga en un enlace directo).

export function NuevaTareaWizard({ clientes, onCreada, onCerrar }) {
  const [paso, setPaso] = useState(1);
  const [tipoTarea, setTipoTarea] = useState("");
  const [subtipo, setSubtipo] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [asignadoA, setAsignadoA] = useState("");
  const [titulo, setTitulo] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [prioridad, setPrioridad] = useState("media");
  const [materialReferencia, setMaterialReferencia] = useState("");
  const [aclaraciones, setAclaraciones] = useState("");
  const [resumen, setResumen] = useState("");
  const [etiquetas, setEtiquetas] = useState("");
  const [colaboradores, setColaboradores] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const TOTAL_PASOS = 5;

  const puedeAvanzar =
    (paso === 1 && Boolean(tipoTarea)) ||
    paso === 2 ||
    paso === 3 ||
    (paso === 4 && Boolean(asignadoA));

  const crearTarea = async () => {
    if (!titulo.trim()) {
      setError("Falta el título de la tarea.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/tareas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: titulo.trim(),
          asignado_a: asignadoA,
          cliente_id: clienteId ? Number(clienteId) : null,
          tipo_tarea: tipoTarea || null,
          subtipo: subtipo || null,
          prioridad,
          fecha_vencimiento: fechaVencimiento || null,
          material_referencia: materialReferencia.trim() || null,
          aclaraciones: aclaraciones.trim() || null,
          resumen: resumen.trim() || null,
          etiquetas: etiquetas.split(",").map((item) => item.trim()).filter(Boolean),
          colaboradores,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear la tarea.");
      onCreada(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true" onClick={onCerrar}>
      <div className="modal" style={{ maxWidth: "600px", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nueva tarea</h2>
          <button onClick={onCerrar} style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#9aa0a6" }}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ padding: "10px", background: "#331616", color: "#ef5350", borderRadius: "4px", marginBottom: "14px" }}>
              {error}
            </div>
          )}

          <div className="form-section-title">Sector *</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
            {SECTORES_TAREA.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setTipoTarea(s.id)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: tipoTarea === s.id ? `2px solid ${s.fg}` : "1px solid #34363a",
                  background: tipoTarea === s.id ? s.bg : "#1f2023",
                  color: tipoTarea === s.id ? s.fg : "#e8eaed",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="form-section-title">Tipo de tarea (opcional)</div>
          <input
            type="text"
            value={subtipo}
            placeholder="reel, historia, carrusel, visita…"
            onChange={(e) => setSubtipo(e.target.value)}
            style={{ width: "100%", marginBottom: "10px" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "20px" }}>
            {SUBTIPOS_SUGERIDOS.map((s) => (
              <button
                key={s}
                type="button"
                className="tag"
                style={{ cursor: "pointer" }}
                onClick={() => setSubtipo(s)}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="form-section-title">Cliente (opcional)</div>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ width: "100%", marginBottom: "20px" }}>
            <option value="">Sin cliente asociado</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>

          <div className="form-section-title">Responsable *</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
            {RESPONSABLES_EQUIPO.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setAsignadoA(r)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: asignadoA === r ? "2px solid #188038" : "1px solid #34363a",
                  background: asignadoA === r ? "#123320" : "#1f2023",
                  color: asignadoA === r ? "#66bb6a" : "#e8eaed",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="form-section-title">Detalles</div>
              <div className="form-grid">
                <label className="form-field">
                  <span>Título *</span>
                  <input
                    type="text"
                    value={titulo}
                    placeholder="Ej: Reel testimonio cliente"
                    onChange={(e) => setTitulo(e.target.value)}
                    autoFocus
                  />
                </label>
                <label className="form-field">
                  <span>Vence el</span>
                  <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Prioridad</span>
                  <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
                    {PRIORIDADES_TAREA.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Resumen corto</span>
                  <input
                    type="text"
                    value={resumen}
                    placeholder="Qué hay que resolver"
                    onChange={(e) => setResumen(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Material / link</span>
                  <input
                    type="text"
                    value={materialReferencia}
                    placeholder="Link al material…"
                    onChange={(e) => setMaterialReferencia(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Etiquetas</span>
                  <input
                    type="text"
                    value={etiquetas}
                    placeholder="Mejora, Sitio web"
                    onChange={(e) => setEtiquetas(e.target.value)}
                  />
                </label>
              </div>
              <fieldset className="td-collaborators" style={{ marginTop: "10px" }}>
                <legend>Colaboradores opcionales</legend>
                <div>
                  {RESPONSABLES_EQUIPO.filter((nombre) => nombre !== asignadoA).map((nombre) => (
                    <label key={nombre}>
                      <input
                        type="checkbox"
                        checked={colaboradores.includes(nombre)}
                        onChange={(e) => setColaboradores((actuales) =>
                          e.target.checked
                            ? [...actuales, nombre]
                            : actuales.filter((item) => item !== nombre),
                        )}
                      />
                      <span>{nombre}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="form-field" style={{ marginTop: "10px" }}>
                <span>Aclaraciones</span>
                <textarea
                  value={aclaraciones}
                  onChange={(e) => setAclaraciones(e.target.value)}
                  rows={3}
                  style={{ width: "100%", font: "inherit", padding: "8px 10px", border: "1px solid #34363a", borderRadius: "4px", background: "#1f2023", color: "#e8eaed" }}
                />
              </label>
        </div>

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={crearTarea}
            disabled={enviando || !titulo.trim() || !asignadoA}
            style={{
              marginLeft: "auto",
              background: enviando || !titulo.trim() || !asignadoA ? "#34363a" : "#188038",
              color: enviando || !titulo.trim() || !asignadoA ? "#9aa0a6" : "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: enviando || !titulo.trim() || !asignadoA ? "not-allowed" : "pointer",
            }}
          >
            {enviando ? "Creando…" : "Crear tarea"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TareaKanbanBoard({ tareas, columnas, campo, onMover, onAbrir }) {
  const [arrastrandoId, setArrastrandoId] = useState(null);
  const [columnaSobre, setColumnaSobre] = useState(null);

  const iniciarArrastre = (evento, tarea) => {
    setArrastrandoId(tarea.id);
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData("text/plain", String(tarea.id));
  };

  const terminarArrastre = () => {
    setArrastrandoId(null);
    setColumnaSobre(null);
  };

  const permitirSoltar = (evento, columnaId) => {
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    setColumnaSobre(columnaId);
  };

  const soltar = (evento, columnaId) => {
    evento.preventDefault();
    const id = arrastrandoId || Number(evento.dataTransfer.getData("text/plain"));
    terminarArrastre();
    const tarea = tareas.find((t) => t.id === id);
    if (!tarea || (tarea[campo] || null) === columnaId) return;
    onMover(id, columnaId);
  };

  return (
    <div className="kanban task-kanban-board" aria-label="Vista por columnas de tareas">
      {columnas.map((col) => {
        const items = tareas.filter((t) => (t[campo] || null) === col.id);
        return (
          <div
            key={col.id}
            className={`kanban-column task-kanban-column ${columnaSobre === col.id ? "kanban-column-over" : ""}`}
            onDragOver={(evento) => permitirSoltar(evento, col.id)}
            onDrop={(evento) => soltar(evento, col.id)}
          >
            <div className="kanban-header task-kanban-header">
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {col.fg && (
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: col.fg, display: "inline-block", flexShrink: 0 }}></span>
                )}
                {col.label}
              </span>
              <strong className="task-kanban-count">{items.length}</strong>
            </div>
            <div className="task-kanban-list">
              {items.map((t) => {
                const prio = getPrioridadTarea(t.prioridad);
                return (
                  <div
                    key={t.id}
                    className={`task-card task-kanban-card ${arrastrandoId === t.id ? "task-card-dragging" : ""}`}
                    draggable
                    onDragStart={(evento) => iniciarArrastre(evento, t)}
                    onDragEnd={terminarArrastre}
                    onClick={() => onAbrir(t.id)}
                  >
                    <div className="task-card-title">{t.titulo}</div>
                    {t.propiedades_extra?.resumen && (
                      <div className="task-kanban-summary">{t.propiedades_extra.resumen}</div>
                    )}
                    {t.cliente_nombre && (
                      <div className="task-kanban-client">{t.cliente_nombre}</div>
                    )}
                    <div className="task-card-meta task-kanban-meta">
                      <span>{t.asignado_a}</span>
                      {t.fecha_vencimiento && <span>{formatearFechaTarea(t.fecha_vencimiento)}</span>}
                      {t.prioridad === "alta" && <span style={{ color: prio.fg }}>Alta</span>}
                    </div>
                    {Array.isArray(t.propiedades_extra?.etiquetas) && t.propiedades_extra.etiquetas.length > 0 && (
                      <div className="task-kanban-tags">
                        {t.propiedades_extra.etiquetas.slice(0, 3).map((etiqueta) => (
                          <span key={etiqueta}>{etiqueta}</span>
                        ))}
                      </div>
                    )}
                    {esperandoMaterial(t) && (
                      <div className="task-kanban-material" style={{ color: "#e65100" }}>
                        Esperando material
                      </div>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && <div className="kanban-empty">Sin tareas</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Vista calendario de tareas por fecha de vencimiento. Mantiene la lectura
// mensual en escritorio y cambia a agenda vertical en pantallas angostas para
// no comprimir siete columnas hasta volverlas ilegibles.

export function TareaCalendario({ tareas, onAbrir }) {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());

  const irMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  const volverAHoy = () => {
    setYear(hoy.getFullYear());
    setMonth(hoy.getMonth());
  };

  const hoyISO = getHoyLocalISO();
  const semanas = getGrillaMes(year, month);
  const claveMes = `${year}-${String(month + 1).padStart(2, "0")}`;
  const esMesActual = year === hoy.getFullYear() && month === hoy.getMonth();

  const porFecha = {};
  tareas.forEach((t) => {
    if (!t.fecha_vencimiento) return;
    (porFecha[t.fecha_vencimiento] = porFecha[t.fecha_vencimiento] || []).push(t);
  });
  Object.values(porFecha).forEach((items) => {
    items.sort((a, b) => {
      const estadoA = ESTADOS_TAREA.findIndex((estado) => estado.id === a.estado);
      const estadoB = ESTADOS_TAREA.findIndex((estado) => estado.id === b.estado);
      return estadoA - estadoB || a.titulo.localeCompare(b.titulo);
    });
  });

  const diasConTareas = Object.entries(porFecha)
    .filter(([fecha]) => fecha.startsWith(claveMes))
    .sort(([fechaA], [fechaB]) => fechaA.localeCompare(fechaB));
  const cantidadMes = diasConTareas.reduce((total, [, items]) => total + items.length, 0);

  const renderTarea = (t, variante = "") => {
    const estado = getEstadoTarea(t.estado);
    const contexto = [t.cliente_nombre || getSectorTarea(t.tipo_tarea)?.label, t.asignado_a]
      .filter(Boolean)
      .join(" · ");
    return (
      <button
        aria-label={`Abrir tarea ${t.titulo}`}
        className={`task-calendar-card ${variante}`}
        key={t.id}
        onClick={() => onAbrir(t.id)}
        style={{ borderLeftColor: estado.fg }}
        title={`${t.titulo} · ${contexto} · ${estado.label}`}
        type="button"
      >
        <span className="task-calendar-card-title">{t.titulo}</span>
        <span className="task-calendar-card-bottom">
          <span className="task-calendar-card-meta">{contexto || "Sin asignar"}</span>
          <span className="task-calendar-card-status" style={{ color: estado.fg }}>
            <i style={{ background: estado.fg }} />
            {estado.label}
          </span>
        </span>
      </button>
    );
  };

  return (
    <section className="task-calendar" aria-label={`Calendario de tareas de ${MESES[month]} ${year}`}>
      <header className="task-calendar-toolbar">
        <div className="task-calendar-heading">
          <span className="task-calendar-eyebrow">Calendario de tareas</span>
          <div className="task-calendar-heading-line">
            <h2>{MESES[month]} {year}</h2>
            <span>{cantidadMes} tareas en {diasConTareas.length} días</span>
          </div>
        </div>

        <div className="task-calendar-actions">
          <button className="btn task-calendar-today" disabled={esMesActual} onClick={volverAHoy} type="button">
            Hoy
          </button>
          <div className="task-calendar-monthnav" aria-label="Cambiar mes">
            <button aria-label="Mes anterior" className="btn task-calendar-navbtn" type="button" onClick={() => irMes(-1)}>‹</button>
            <button aria-label="Mes siguiente" className="btn task-calendar-navbtn" type="button" onClick={() => irMes(1)}>›</button>
          </div>
        </div>
      </header>

      <div className="task-calendar-grid">
        {DIAS_SEMANA.map((dia) => (
          <div className="task-calendar-dow" key={dia}>{dia}</div>
        ))}
        {semanas.map((semana, si) =>
          semana.map((dia, di) => {
            if (dia === null) {
              return <div className="task-calendar-cell empty" key={`${si}-${di}`}></div>;
            }
            const iso = fechaISODesde(year, month, dia);
            const items = porFecha[iso] || [];
            const visibles = items.slice(0, 3);
            const ocultos = Math.max(items.length - visibles.length, 0);
            return (
              <div
                className={`task-calendar-cell ${iso === hoyISO ? "today" : ""} ${di >= 5 ? "weekend" : ""}`}
                key={`${si}-${di}`}
              >
                <div className="task-calendar-dayhead">
                  <span className="task-calendar-daynum">{dia}</span>
                  {items.length > 0 && <span className="task-calendar-count">{items.length}</span>}
                </div>
                <div className="task-calendar-card-stack">
                  {visibles.map((t) => renderTarea(t))}
                  {ocultos > 0 && (
                    <div className="task-calendar-more">+{ocultos} tareas más</div>
                  )}
                </div>
              </div>
            );
          }),
        )}
      </div>

      <div className="task-calendar-agenda">
        {diasConTareas.length === 0 ? (
          <div className="task-calendar-agenda-empty">No hay tareas con fecha en este mes.</div>
        ) : (
          diasConTareas.map(([fecha, items]) => {
            const fechaLocal = new Date(`${fecha}T12:00:00`);
            const visibles = items.slice(0, 4);
            const ocultos = Math.max(items.length - visibles.length, 0);
            return (
              <article className={`task-calendar-agenda-day ${fecha === hoyISO ? "today" : ""}`} key={fecha}>
                <div className="task-calendar-agenda-date">
                  <strong>{fechaLocal.getDate()}</strong>
                  <span>{fechaLocal.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "")}</span>
                </div>
                <div className="task-calendar-agenda-content">
                  <div className="task-calendar-agenda-head">
                    <span>{items.length === 1 ? "1 tarea" : `${items.length} tareas`}</span>
                  </div>
                  <div className="task-calendar-agenda-list">
                    {visibles.map((t) => renderTarea(t, "agenda"))}
                  </div>
                  {ocultos > 0 && <div className="task-calendar-more">+{ocultos} tareas más</div>}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
