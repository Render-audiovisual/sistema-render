import React, { useEffect, useState } from "react";
import { getEstadoTareaLabel } from "../../utils.jsx";
import { ESTADO_FINAL_TAREA } from "../../constants.js";
import { TareasAsignadasGenericas } from "../../components/TareasAsignadasGenericas.jsx";

export function LucianoDashboard() {
  const [edicionesLuciano, setEdicionesLuciano] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/tareas?asignado_a=Luciano&tipo_tarea=edicion")
      .then((response) => response.json())
      .then((tareas) => {
        setEdicionesLuciano(
          tareas
            .slice()
            .sort((a, b) => (a.fecha_vencimiento || "").localeCompare(b.fecha_vencimiento || "")),
        );
      })
      .catch((error) => {
        console.error("No se pudieron cargar las ediciones de Luciano", error);
        setError("No se pudieron cargar las ediciones.");
      });
  }, []);

  const pendientes = edicionesLuciano.filter((t) => t.estado !== ESTADO_FINAL_TAREA);
  const publicadas = edicionesLuciano.filter((t) => t.estado === ESTADO_FINAL_TAREA).length;
  const proxima = pendientes[0];

  return (
    <main aria-label="Render platform Luciano">
      <div className="frame">
        <div className="content">
          <div className="section-label">Edición</div>
          <h2>Mis tareas</h2>

          {error && <div className="caption">{error}</div>}

          <div style={{ backgroundColor: "#d4edff", border: "2px solid #0066cc", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
            {!proxima ? (
              <div className="caption">✅ No hay ediciones pendientes.</div>
            ) : (
              <div>
                <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>🎬 Tu próxima edición</div>
                <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "4px" }}>{proxima.titulo}</div>
                <div style={{ fontSize: "13px", color: "#333", marginBottom: "8px" }}>
                  {proxima.cliente_nombre ?? "Sin cliente"} · Vence {proxima.fecha_vencimiento}
                </div>
                <div style={{ fontSize: "12px", color: "#555" }}>
                  {proxima.requiere_aprobacion ? "Esperando aprobación del Líder" : `Estado: ${getEstadoTareaLabel(proxima.estado)}`}
                </div>
              </div>
            )}
          </div>

          <div className="section-label">Avance del mes</div>
          <div className="box">
            <div className="progress-card">
              <div className="progress-label">Videos editados</div>
              <div className="progress-value">
                {publicadas} / {edicionesLuciano.length}
              </div>
            </div>
            <div className="caption">
              → Solo tus ediciones asignadas — no ves diseño, filmación ni
              publicaciones de otros.
            </div>
          </div>
        </div>
      </div>

      <TareasAsignadasGenericas nombre="Luciano" tipoTarea="edicion" titulo="Ediciones asignadas — fecha límite, prioridad y material" />
    </main>
  );
}
