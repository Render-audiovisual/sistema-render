import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { getEstadoTareaLabel, getHoyLocalISO } from "../../utils.jsx";
import { ESTADO_FINAL_TAREA } from "../../constants.js";
import { TareasAsignadasGenericas } from "../../components/TareasAsignadasGenericas.jsx";

export function AugustoDashboard() {
  const [disenosAugusto, setDisenosAugusto] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/tareas?asignado_a=Augusto&tipo_tarea=diseno")
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
  const atrasadasOHoy = disenosAugusto.filter(
    (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento && t.fecha_vencimiento <= hoy,
  );
  const publicadas = disenosAugusto.filter((t) => t.estado === ESTADO_FINAL_TAREA).length;
  const proxima = disenosAugusto.find((t) => t.estado !== ESTADO_FINAL_TAREA);

  return (
    <main aria-label="Render platform Augusto">
      <div className="frame">
        <div className="content">
          <div className="section-label">Diseño</div>
          <h2>Mis tareas</h2>

          {error && <div className="caption">{error}</div>}

          <div className="highlight-card">
            {!proxima ? (
              <div className="caption">No hay diseños pendientes.</div>
            ) : (
              <div>
                <div className="highlight-eyebrow">Tu próxima tarea</div>
                <div className="highlight-title">{proxima.titulo}</div>
                <div className="highlight-meta">
                  {proxima.cliente_nombre ?? "Sin cliente"} · Vence {proxima.fecha_vencimiento}
                </div>
                <div className="highlight-status">Estado: {getEstadoTareaLabel(proxima.estado)}</div>
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
                {publicadas} / {disenosAugusto.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TareasAsignadasGenericas nombre="Augusto" tipoTarea="diseno" titulo="Diseños asignados — historias y carruseles" />
    </main>
  );
}
