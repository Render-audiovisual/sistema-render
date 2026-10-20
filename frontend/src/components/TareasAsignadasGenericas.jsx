import React, { useEffect, useState } from "react";
import { getHoyLocalISO, getSesion } from "../utils.jsx";
import { fetchAllTaskPages } from "../shared/tasks/fetch-all-task-pages.js";

export function TareasAsignadasGenericas({ nombre, nombres, tipoTarea, titulo }) {
  const [tareas, setTareas] = useState([]);
  const [error, setError] = useState(null);
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";
  const responsables = nombres?.length ? nombres : [nombre];

  const cargarTareas = () => {
    Promise.all(
      (esAdmin ? responsables : [null]).map((responsable) => {
        const params = new URLSearchParams({ workspace: "render_os" });
        if (esAdmin && responsable) params.set("asignado_a", responsable);
        else if (sesion?.usuario?.id) params.set("asignado_a_id", String(sesion.usuario.id));
        if (tipoTarea) params.set("tipo_tarea", tipoTarea);
        return fetchAllTaskPages(`/api/tareas?${params.toString()}`);
      }),
    )
      .then((listas) => {
        const propias = [
          ...new Map(listas.flat().map((tarea) => [tarea.id, tarea])).values(),
        ];
        setTareas(
          propias
            .slice()
            .sort((a, b) => (a.fecha_vencimiento || "").localeCompare(b.fecha_vencimiento || "")),
        );
      })
      .catch(() => setError("No se pudieron cargar las tareas asignadas."));
  };

  useEffect(() => {
    cargarTareas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nombre, tipoTarea, nombres?.join("|"), sesion?.usuario?.id]);

  const cambiarEstado = (tareaId, nuevoEstado) => {
    const tarea = tareas.find(item => item.id === tareaId);
    fetch(`/api/tareas/${tareaId}?workspace=render_os`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevoEstado, expected_revision: tarea?.revision, expected_updated_at: tarea?.updated_at }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo actualizar el estado.");
        }
        return response.json();
      })
      .then(() => cargarTareas())
      .catch(() => setError("No se pudo actualizar el estado."));
  };

  return (
    <>
      <div className="section-label">{titulo || "Tareas asignadas"}</div>
      <div className="box">
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: "10px" }}>
          <a className="btn" href="/workspace/tareas">Ver tablero completo</a>
        </div>
        {error && <div className="caption">{error}</div>}
        {!error &&
          tareas.map((tarea) => {
            const bloqueaCierre = tarea.requiere_aprobacion && !esAdmin;
            const material = tarea.propiedades_extra?.material || tarea.propiedades_extra?.Material;
            const feedback = tarea.propiedades_extra?.feedback || tarea.propiedades_extra?.motivo_bloqueo;

            return (
              <div className="card" key={`tarea-generica-${tarea.id}`}>
                <div className="cliente">
                  {tarea.cliente_nombre ?? "Sin cliente"}
                </div>
                <div>{tarea.titulo}</div>
                <div className="meta">
                  {tarea.fecha_vencimiento && (
                    <>
                      Vence: {tarea.fecha_vencimiento}
                      {tarea.fecha_vencimiento < getHoyLocalISO() &&
                        !["finalizada", "publicada"].includes(tarea.estado) && (
                          <span
                            className="tag atraso"
                            style={{ marginLeft: "6px" }}
                          >
                            Atrasada
                          </span>
                        )}
                    </>
                  )}
                  {tarea.prioridad && tarea.prioridad !== "media" && (
                    <span
                      className={`tag ${tarea.prioridad === "alta" ? "atraso" : "operativa"}`}
                      style={{ marginLeft: "6px" }}
                    >
                      Prioridad {tarea.prioridad}
                    </span>
                  )}
                </div>
                {material && (
                  <div className="meta">Material: {material}</div>
                )}
                {feedback && (
                  <div className="meta">Feedback: {feedback}</div>
                )}
                <div className="meta">
                  {tarea.requiere_aprobacion && (
                    <span className="tag creativa">Requiere aprobación</span>
                  )}
                </div>
                <div className="meta">
                  <select
                    value={tarea.estado === "publicada" ? "finalizada" : tarea.estado}
                    onChange={(e) => cambiarEstado(tarea.id, e.target.value)}
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="en_progreso">En proceso</option>
                    <option value="en_revision">En revisión</option>
                    <option value="aprobada" disabled={bloqueaCierre}>Aprobada</option>
                    <option value="finalizada" disabled={bloqueaCierre}>
                      {bloqueaCierre
                        ? "Finalizada (requiere aprobación de admin)"
                        : "Finalizada"}
                    </option>
                  </select>
                </div>
              </div>
            );
          })}
        {!error && tareas.length === 0 && (
          <div className="caption">No hay tareas asignadas por ahora.</div>
        )}
      </div>
    </>
  );
}

// ── TAREAS: tablero operativo real, sobre la tabla `tareas` ────────────

// Colores pensados para fondo oscuro (Tareas es la única sección de
// Sistema Render en modo oscuro, ver .tareas-viewport en styles.css) —
// estas constantes son exclusivas del módulo Tareas.
