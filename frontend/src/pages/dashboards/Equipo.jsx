import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { getMesActualISO, getResumenEquipo } from "../../utils.jsx";

export function EquipoDashboard() {
  const [resumenEquipo, setResumenEquipo] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/historias").then((r) => r.json()),
      fetch("/api/publicaciones").then((r) => r.json()),
      fetch("/api/tareas").then((r) => r.json()),
    ])
      .then(([historias, publicaciones, tareas]) => {
        setResumenEquipo(getResumenEquipo(historias, publicaciones, tareas));
      })
      .catch((err) => {
        console.error("No se pudo cargar el equipo", err);
        setError("No se pudo cargar la carga de trabajo del equipo.");
      });
  }, []);

  const equipoOrdenado = [...resumenEquipo].sort(
    (a, b) => b.cargaTotal - a.cargaTotal,
  );

  return (
    <main aria-label="Render platform Equipo">
      <div className="frame">

        <div className="content">
          <div className="section-label">
            Carga de trabajo y cumplimiento por persona — {getMesActualISO()}
          </div>
          <div className="box">
            {error && <div className="caption">{error}</div>}
            {!error && (
              <table>
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Asignadas (total)</th>
                    <th>Atrasadas</th>
                    <th>Bloqueadas</th>
                    <th>Cumplimiento del mes</th>
                  </tr>
                </thead>
                <tbody>
                  {equipoOrdenado.map((persona) => (
                    <tr key={persona.nombre}>
                      <td>{persona.nombre}</td>
                      <td>{persona.cargaTotal}</td>
                      <td>{persona.atrasadas}</td>
                      <td>{persona.bloqueadas}</td>
                      <td>{persona.cumplimiento}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="caption">
              → Ordenado por carga total, para detectar de un vistazo quién
              tiene más asignado, no solo quién está atrasado.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
