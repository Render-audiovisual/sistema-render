import React, { useEffect, useState } from "react";
import { getEstadoTareaLabel, getHoyLocalISO } from "../../utils.jsx";
import { ESTADO_FINAL_TAREA } from "../../constants.js";
import { TareasAsignadasGenericas } from "../../components/TareasAsignadasGenericas.jsx";

export function AugustoDashboard() {
  const [disenosAugusto, setDisenosAugusto] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/tareas?workspace=render_os&asignado_a=Augusto&tipo_tarea=diseno")
      .then((response) => response.json())
      .then((tareas) => {
        setDisenosAugusto(
          tareas
            .slice()
            .sort((a, b) => (a.fecha_vencimiento || "").localeCompare(b.fecha_vencimiento || "")),
        );
      })
      .catch((error) => {
        console.error("No se pudieron cargar los diseños de Augusto", error);
        setError("No se pudieron cargar los diseños.");
      });
  }, []);

  const hoy = getHoyLocalISO();
  const mesActual = hoy.slice(0, 7);
  const disenosDelMes = disenosAugusto.filter((tarea) =>
    String(tarea.fecha_vencimiento || tarea.updated_at || "").startsWith(mesActual),
  );
  const atrasadasOHoy = disenosAugusto.filter(
    (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento && t.fecha_vencimiento <= hoy,
  );
  const publicadas = disenosDelMes.filter((t) => t.estado === ESTADO_FINAL_TAREA).length;
  const proxima = disenosAugusto.find((t) => t.estado !== ESTADO_FINAL_TAREA);

  return (
    <main aria-label="Render platform Augusto">
      <div className="frame">
        <div className="content">
          <div className="section-label">Diseño</div>
          <h2>Mis tareas</h2>

          {error && <div className="caption">{error}</div>}

          <div style={{ backgroundColor: "#fff3cd", border: "2px solid #ffc107", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
            {!proxima ? (
              <div className="caption">✅ No hay diseños pendientes.</div>
            ) : (
              <div>
                <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>📌 Tu próxima tarea</div>
                <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "4px" }}>{proxima.titulo}</div>
                <div style={{ fontSize: "13px", color: "#555", marginBottom: "8px" }}>
                  {proxima.cliente_nombre ?? "Sin cliente"} · Vence {proxima.fecha_vencimiento}
                </div>
                <div style={{ fontSize: "12px", color: "#666" }}>Estado: {getEstadoTareaLabel(proxima.estado)}</div>
              </div>
            )}
          </div>

          <div className="section-label">Atrasados / vencen hoy</div>
          <div className="box">
            {atrasadasOHoy.length === 0 && (
              <div className="caption">No hay diseños atrasados ni que venzan hoy.</div>
            )}
            {atrasadasOHoy.map((t) => (
              <div className="priority-card blocked" key={t.id}>
                <div className="cliente">{t.cliente_nombre ?? "Sin cliente"}</div>
                <div>{t.titulo}</div>
                <div className="meta">
                  {t.fecha_vencimiento} · {getEstadoTareaLabel(t.estado)}
                </div>
              </div>
            ))}
            <div className="caption">
              → Historias y carruseles juntos — todo lo que Augusto diseña, en
              una sola lista.
            </div>
          </div>

          <div className="section-label">Avance del mes</div>
          <div className="box">
            <div className="progress-card">
              <div className="progress-label">Diseños entregados</div>
              <div className="progress-value">
                {publicadas} / {disenosDelMes.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TareasAsignadasGenericas nombre="Augusto" tipoTarea="diseno" titulo="Diseños asignados — historias y carruseles" />
    </main>
  );
}
