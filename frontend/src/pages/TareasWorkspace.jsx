import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { esperandoMaterial, getEstadoTareaLabel, getHoyLocalISO } from "../utils.jsx";
import { ESTADO_FINAL_TAREA } from "../constants.js";

export function TareasWorkspacePage({ asignado_a, tipo_tarea, titulo, nombre_usuario, rol }) {
  const [tareas, setTareas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState("activas");
  const [filtroPrioridad, setFiltroPrioridad] = useState("todos");
  const [tareaSeleccionada, setTareaSeleccionada] = useState(null);
  const [actualizando, setActualizando] = useState(false);

  useEffect(() => {
    cargarTareas();
  }, []);

  const cargarTareas = () => {
    setCargando(true);
    fetch(`/api/tareas?asignado_a=${asignado_a}&tipo_tarea=${tipo_tarea}`)
      .then((r) => r.json())
      .then((data) => {
        setTareas(data);
        setCargando(false);
      })
      .catch((err) => {
        setError(err.message);
        setCargando(false);
      });
  };

  const tareasFiltradas = tareas.filter((t) => {
    if (filtroEstado === "activas" && t.estado === ESTADO_FINAL_TAREA) return false;
    if (filtroEstado !== "todos" && filtroEstado !== "activas" && t.estado !== filtroEstado) return false;
    if (filtroPrioridad !== "todos" && t.prioridad !== filtroPrioridad) return false;
    return true;
  });

  const estadosDisponibles = ["pendiente", "en_progreso", "en_revision", "publicada"];
  const hoyISO = getHoyLocalISO();
  const limiteSemana = new Date(`${hoyISO}T00:00:00`);
  limiteSemana.setDate(limiteSemana.getDate() + 7);
  const limiteSemanaISO = limiteSemana.toISOString().slice(0, 10);

  const ordenarTareas = (items) =>
    [...items].sort((a, b) => {
      const fechaA = a.fecha_vencimiento || "9999-12-31";
      const fechaB = b.fecha_vencimiento || "9999-12-31";
      return (
        fechaA.localeCompare(fechaB) ||
        (a.cliente_nombre || "").localeCompare(b.cliente_nombre || "") ||
        a.id - b.id
      );
    });

  const gruposOperativos = [
    {
      id: "vencidas",
      titulo: "Vencidas",
      tareas: tareasFiltradas.filter(
        (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
      ),
    },
    {
      id: "hoy",
      titulo: "Hoy",
      tareas: tareasFiltradas.filter(
        (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento === hoyISO,
      ),
    },
    {
      id: "semana",
      titulo: "Próximos 7 días",
      tareas: tareasFiltradas.filter(
        (t) =>
          t.estado !== ESTADO_FINAL_TAREA &&
          t.fecha_vencimiento &&
          t.fecha_vencimiento > hoyISO &&
          t.fecha_vencimiento <= limiteSemanaISO,
      ),
    },
    {
      id: "mas-adelante",
      titulo: "Más adelante",
      tareas: tareasFiltradas.filter(
        (t) =>
          t.estado !== ESTADO_FINAL_TAREA &&
          (!t.fecha_vencimiento || t.fecha_vencimiento > limiteSemanaISO),
      ),
    },
    {
      id: "publicadas",
      titulo: "Publicadas",
      tareas: tareasFiltradas.filter((t) => t.estado === ESTADO_FINAL_TAREA),
    },
  ]
    .map((grupo) => ({ ...grupo, tareas: ordenarTareas(grupo.tareas) }))
    .filter((grupo) => grupo.tareas.length > 0);

  const pendientesActivas = tareas.filter((t) => t.estado !== ESTADO_FINAL_TAREA).length;
  const vencidasActivas = tareas.filter(
    (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
  ).length;

  const actualizarEstado = (tareaId, nuevoEstado) => {
    setActualizando(true);
    fetch(`/api/tareas/${tareaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevoEstado }),
    })
      .then((r) => r.json())
      .then(() => {
        setTareas(tareas.map((t) => (t.id === tareaId ? { ...t, estado: nuevoEstado } : t)));
        setTareaSeleccionada(null);
        setActualizando(false);
      })
      .catch((err) => {
        setError(err.message);
        setActualizando(false);
      });
  };

  const getEstadoColor = (estado) => {
    const colores = {
      pendiente: "#ff9500",
      en_progreso: "#0066cc",
      en_revision: "#ff6b6b",
      programada: "#7e57c2",
      publicada: "#28a745",
    };
    return colores[estado] || "#ccc";
  };

  const getPrioridadBadge = (prioridad) => {
    const colores = {
      alta: "🔴",
      media: "🟡",
      baja: "🟢",
    };
    return colores[prioridad] || "◯";
  };

  return (
    <main aria-label={titulo}>
      <div className="frame">
        <div className="content">
          <div className="section-label">Filtros</div>
          <div className="box" style={{ display: "flex", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              style={{
                padding: "8px 12px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            >
              <option value="activas">Activas</option>
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_progreso">En proceso</option>
              <option value="en_revision">En revisión</option>
              <option value="publicada">Publicada</option>
            </select>

            <select
              value={filtroPrioridad}
              onChange={(e) => setFiltroPrioridad(e.target.value)}
              style={{
                padding: "8px 12px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            >
              <option value="todos">Todas las prioridades</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>

            <div style={{ marginLeft: "auto", fontSize: "14px", color: "#666", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <span>{tareasFiltradas.length} visible{tareasFiltradas.length !== 1 ? "s" : ""}</span>
              <span>{pendientesActivas} activa{pendientesActivas !== 1 ? "s" : ""}</span>
              {vencidasActivas > 0 && <span style={{ color: "#c62828", fontWeight: 700 }}>{vencidasActivas} vencida{vencidasActivas !== 1 ? "s" : ""}</span>}
            </div>
          </div>

          <div className="section-label">Lista operativa tipo ClickUp</div>
          <div className="box" style={{ padding: 0, overflow: "hidden" }}>
            {cargando && (
              <div style={{ padding: "24px", color: "#666" }}>Cargando tareas...</div>
            )}
            {error && (
              <div style={{ padding: "16px", color: "#c62828" }}>{error}</div>
            )}
            {!cargando && !error && gruposOperativos.length === 0 && (
              <div style={{ padding: "24px", color: "#999" }}>No hay tareas con ese filtro.</div>
            )}
            {!cargando && !error && gruposOperativos.map((grupo) => (
              <div key={grupo.id} style={{ borderTop: "1px solid #eee" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#fafafa", borderBottom: "1px solid #eee" }}>
                  <strong style={{ fontSize: "13px" }}>{grupo.titulo}</strong>
                  <span className="tag">{grupo.tareas.length}</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="sheet-table" style={{ minWidth: "820px" }}>
                    <tbody>
                      {grupo.tareas.map((tarea) => (
                        <tr key={tarea.id}>
                          <td style={{ width: "36%", fontWeight: 600 }}>
                            <button
                              type="button"
                              onClick={() => setTareaSeleccionada(tarea)}
                              style={{ border: 0, background: "transparent", padding: 0, textAlign: "left", font: "inherit", cursor: "pointer" }}
                            >
                              {tarea.titulo}
                            </button>
                            {esperandoMaterial(tarea) && (
                              <span style={{ marginLeft: "8px", fontSize: "11px", fontWeight: 700, color: "#e65100" }}>
                                ⏳ Esperando material
                              </span>
                            )}
                          </td>
                          <td style={{ width: "18%", color: "#555" }}>{tarea.cliente_nombre || "Sin cliente"}</td>
                          <td style={{ width: "12%", color: tarea.fecha_vencimiento && tarea.fecha_vencimiento < hoyISO && tarea.estado !== ESTADO_FINAL_TAREA ? "#c62828" : "#666", fontWeight: tarea.fecha_vencimiento && tarea.fecha_vencimiento < hoyISO && tarea.estado !== ESTADO_FINAL_TAREA ? 700 : 400 }}>
                            {tarea.fecha_vencimiento || "Sin fecha"}
                          </td>
                          <td style={{ width: "12%" }}>
                            <span style={{ color: getEstadoColor(tarea.estado), fontWeight: 700 }}>●</span>{" "}
                            {getEstadoTareaLabel(tarea.estado)}
                          </td>
                          <td style={{ width: "10%" }}>{getPrioridadBadge(tarea.prioridad)} {tarea.prioridad || "media"}</td>
                          <td style={{ width: "12%" }}>
                            <select
                              className="sheet-cell"
                              value={tarea.estado}
                              disabled={actualizando}
                              onChange={(e) => actualizarEstado(tarea.id, e.target.value)}
                            >
                              {estadosDisponibles.map((estado) => (
                                <option key={estado} value={estado}>{getEstadoTareaLabel(estado)}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {tareaSeleccionada && (
            <div className="modal-overlay" onClick={() => setTareaSeleccionada(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h2 style={{ margin: 0 }}>{tareaSeleccionada.titulo}</h2>
                  <button
                    onClick={() => setTareaSeleccionada(null)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "24px",
                      cursor: "pointer",
                      color: "#666",
                    }}
                  >
                    ✕
                  </button>
                </div>

                {esperandoMaterial(tareaSeleccionada) && (
                  <div style={{ padding: "10px 12px", background: "#fff3e0", color: "#e65100", borderRadius: "4px", fontWeight: 600, fontSize: "13px", marginBottom: "16px" }}>
                    ⏳ Esperando material — la tarea de filmación todavía no está marcada como publicada.
                  </div>
                )}

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Cliente:</strong> {tareaSeleccionada.cliente_nombre || "—"}
                  </div>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Estado actual:</strong> <span style={{ color: getEstadoColor(tareaSeleccionada.estado) }}>●</span> {getEstadoTareaLabel(tareaSeleccionada.estado)}
                  </div>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Prioridad:</strong> {getPrioridadBadge(tareaSeleccionada.prioridad)} {tareaSeleccionada.prioridad}
                  </div>
                  {tareaSeleccionada.fecha_vencimiento && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Vencimiento:</strong> {tareaSeleccionada.fecha_vencimiento}
                    </div>
                  )}
                  {tareaSeleccionada.subtipo && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Tipo:</strong> {tareaSeleccionada.subtipo}
                    </div>
                  )}
                  {tareaSeleccionada.material_referencia && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Material:</strong>{" "}
                      <a href={tareaSeleccionada.material_referencia} target="_blank" rel="noopener noreferrer">
                        {tareaSeleccionada.material_referencia}
                      </a>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <strong>Cambiar estado a:</strong>
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                    {estadosDisponibles
                      .filter((e) => e !== tareaSeleccionada.estado)
                      .map((estado) => (
                        <button
                          key={estado}
                          onClick={() => actualizarEstado(tareaSeleccionada.id, estado)}
                          disabled={actualizando}
                          style={{
                            padding: "8px 12px",
                            background: getEstadoColor(estado),
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 600,
                            textTransform: "capitalize",
                            opacity: actualizando ? 0.6 : 1,
                          }}
                        >
                          {actualizando ? "..." : getEstadoTareaLabel(estado)}
                        </button>
                      ))}
                  </div>
                </div>

                <button
                  onClick={() => setTareaSeleccionada(null)}
                  style={{
                    padding: "8px 16px",
                    background: "#ccc",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export function TareasDisenioPage() {
  return (
    <TareasWorkspacePage
      asignado_a="Augusto"
      tipo_tarea="diseno"
      titulo="Mis diseños"
      nombre_usuario="Augusto"
      rol="diseño"
    />
  );
}

export function TareasEdicionPage() {
  return (
    <TareasWorkspacePage
      asignado_a="Luciano"
      tipo_tarea="edicion"
      titulo="Mis ediciones"
      nombre_usuario="Luciano"
      rol="edición"
    />
  );
}

export function TareasProduccionPage() {
  return (
    <TareasWorkspacePage
      asignado_a="Germán"
      tipo_tarea="produccion"
      titulo="Mis tareas"
      nombre_usuario="Germán"
      rol="producción"
    />
  );
}

// ── MÓDULO HISTORIAS: planilla por cliente + tablero + estructura ─────────────
