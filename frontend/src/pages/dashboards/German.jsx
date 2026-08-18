import React, { useEffect, useState } from "react";
import { getEstadoTareaLabel, getHoyLocalISO } from "../../utils.jsx";
import { ESTADO_FINAL_TAREA } from "../../constants.js";
import { TareasAsignadasGenericas } from "../../components/TareasAsignadasGenericas.jsx";
import { Modal } from "../../components/Modal.jsx";

export function GermanDashboard() {
  const [produccionSeleccionada, setProduccionSeleccionada] = useState(null);
  const [tareasGerman, setTareasGerman] = useState([]);
  const [tareasGermanError, setTareasGermanError] = useState(null);

  const cargarTareasGerman = () => {
    fetch("/api/tareas?workspace=render_os&asignado_a=Germ%C3%A1n&tipo_tarea=produccion")
      .then((response) => response.json())
      .then((tareas) => {
        setTareasGerman(tareas);
      })
      .catch((error) => {
        console.error("No se pudieron cargar las tareas de Germán", error);
        setTareasGermanError("No se pudieron cargar las tareas.");
      });
  };

  useEffect(cargarTareasGerman, []);

  const pendientes = tareasGerman.filter((tarea) => tarea.estado !== ESTADO_FINAL_TAREA);

  // Compromiso mensual pactado por cliente (confirmado al definir
  // responsabilidades del equipo). El mes de cada tarea se aproxima por
  // fecha_vencimiento (no hay fecha_programada directa en tareas) — el
  // desvío es de a lo sumo unos días, aceptable para el MVP.
  const mesActual = getHoyLocalISO().slice(0, 7);
  const tareasDelMes = tareasGerman.filter((tarea) =>
    String(tarea.fecha_vencimiento || tarea.updated_at || "").startsWith(mesActual),
  );
  const cumplimientoPorCliente = Object.values(tareasDelMes.reduce((resumen, tarea) => {
    const cliente = tarea.cliente_nombre || "Sin cliente";
    if (!resumen[cliente]) resumen[cliente] = { cliente, cuota: 0, hechas: 0 };
    resumen[cliente].cuota += 1;
    if (tarea.estado === ESTADO_FINAL_TAREA) resumen[cliente].hechas += 1;
    return resumen;
  }, {})).map((item) => ({
    ...item,
    porcentaje: item.cuota > 0 ? Math.round((item.hechas / item.cuota) * 100) : 0,
  }));
  const cuotaTotal = tareasDelMes.length;
  const hechasTotal = cumplimientoPorCliente.reduce((acc, c) => acc + c.hechas, 0);

  return (
    <main aria-label="Render platform German">
      <div className="frame">
        <div className="content">
          <div className="section-label">Producción</div>
          <h2>Mis tareas</h2>

          <div style={{ backgroundColor: "#fff3cd", border: "2px solid #ff9800", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
            {(() => {
              const proximaTarea = pendientes
                .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0];

              if (!proximaTarea) {
                return <div className="caption">✅ No hay tareas pendientes.</div>;
              }

              return (
                <div onClick={() => setProduccionSeleccionada(proximaTarea)} style={{ cursor: "pointer" }}>
                  <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>🎯 Tu próxima tarea</div>
                  <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "4px" }}>{proximaTarea.titulo}</div>
                  <div style={{ fontSize: "13px", color: "#333", marginBottom: "8px" }}>{proximaTarea.cliente_nombre ?? "Sin cliente"} · Vence {proximaTarea.fecha_vencimiento}</div>
                  <div style={{ fontSize: "12px", color: "#555" }}>Estado: {getEstadoTareaLabel(proximaTarea.estado)}</div>
                </div>
              );
            })()}
          </div>

          <div className="section-label">Producciones pendientes</div>
          <div className="box">
            {tareasGermanError && (
              <div className="caption">{tareasGermanError}</div>
            )}
            {!tareasGermanError &&
              pendientes.map((tarea) => {
                return (
                  <div
                    className="priority-card"
                    key={tarea.id}
                    onClick={() => setProduccionSeleccionada(tarea)}
                  >
                    <div className="cliente">
                      {tarea.cliente_nombre ?? "Sin cliente"}
                    </div>
                    <div>{tarea.titulo}</div>
                    <div className="meta">
                      {tarea.propiedades_extra?.coordinada ? (
                        `Coordinado para ${
                          tarea.propiedades_extra.horario ??
                          "fecha sin especificar"
                        }`
                      ) : (
                        getEstadoTareaLabel(tarea.estado)
                      )}
                    </div>
                  </div>
                );
              })}
            {!tareasGermanError && pendientes.length === 0 && (
              <div className="caption">
                No hay producciones pendientes asignadas a Germán.
              </div>
            )}
            <div className="caption">
              → Germán ve solo producciones y material pendiente, sin mezclarse
              con edición o diseño.
            </div>
          </div>

          <div className="section-label">Agenda de visitas</div>
          <div className="box">
            <div className="placeholder-box">
              [ Módulo de Agenda — Fase 2, no incluido en el MVP ]
            </div>
            <div className="caption">
              Por ahora, coordinación de horarios y rutas se sigue manejando
              fuera de la plataforma.
            </div>
          </div>

          <div className="section-label">Cumplimiento mensual por cliente</div>
          <div className="box">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Videos entregados</th>
                  <th>Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {cumplimientoPorCliente.map((c) => (
                  <tr key={c.cliente}>
                    <td>{c.cliente}</td>
                    <td>{c.hechas} / {c.cuota}</td>
                    <td>{c.porcentaje}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="progress-card" style={{ marginTop: "12px" }}>
              <div className="progress-label">Total del mes</div>
              <div className="progress-value">
                {hechasTotal} / {cuotaTotal} ({cuotaTotal > 0 ? Math.round((hechasTotal / cuotaTotal) * 100) : 0}%)
              </div>
            </div>
            <div className="caption">
              → Un video cuenta como cumplido recién cuando queda marcado
              "Publicada" — no alcanza con haber ido a filmar.
            </div>
          </div>

          <div className="section-label">En revisión</div>
          <div className="box">
            {tareasGerman.filter((t) => t.estado === "en_revision").length === 0 && (
              <div className="caption">No hay producciones en revisión.</div>
            )}
            {tareasGerman
              .filter((t) => t.estado === "en_revision")
              .map((t) => (
                <div className="priority-card" key={`revision-${t.id}`}>
                  <div className="cliente">{t.cliente_nombre ?? "Sin cliente"}</div>
                  <div>{t.titulo}</div>
                  <div className="meta">Pendiente de revisión.</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {produccionSeleccionada && (
        <DetalleProduccionGermanModal
          produccion={produccionSeleccionada}
          onClose={() => setProduccionSeleccionada(null)}
          onActualizado={cargarTareasGerman}
        />
      )}
      <TareasAsignadasGenericas nombre="Germán" tipoTarea="produccion" titulo="Producciones asignadas" />
    </main>
  );
}

export function DetalleProduccionGermanModal({ produccion, onClose, onActualizado }) {
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);

  const handleCoordinarFecha = () => {
    const horario = window.prompt(
      "¿Para cuándo se coordina? (ej: 2026-07-25 10:00)",
      produccion.propiedades_extra?.horario || "",
    );
    if (!horario) return;

    setEnviando("coordinar");
    setError(null);

    fetch(`/api/tareas/${produccion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propiedades_extra: { horario, coordinada: true },
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo coordinar la fecha.");
        }
        return response.json();
      })
      .then(() => {
        onActualizado();
        onClose();
      })
      .catch(() => {
        setError("No se pudo coordinar la fecha. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  const handleMarcarEntregado = () => {
    setEnviando("entregar");
    setError(null);

    fetch(`/api/tareas/${produccion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: ESTADO_FINAL_TAREA }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo marcar el material como entregado.");
        }
        return response.json();
      })
      .then(() => {
        onActualizado();
        onClose();
      })
      .catch(() => {
        setError("No se pudo marcar como entregado. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  return (
    <Modal
      onClose={onClose}
      title={
        <span>
          {produccion.cliente_nombre ?? "Sin cliente"} · {produccion.titulo}
        </span>
      }
    >
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-field">
              <div className="detail-label">Qué se necesita</div>
              <div>{produccion.titulo}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Estado actual</div>
              <div>{getEstadoTareaLabel(produccion.estado)}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Detalle</div>
              <div>
                {produccion.propiedades_extra?.motivo_bloqueo ??
                  produccion.propiedades_extra?.horario ??
                  "Sin detalle adicional cargado"}
              </div>
            </div>
          </div>

          {error && <div className="caption login-error">{error}</div>}

          <div className="modal-actions">
            <button
              className="btn primary"
              type="button"
              disabled={enviando !== null}
              onClick={handleCoordinarFecha}
            >
              {enviando === "coordinar" ? "Guardando..." : "Coordinar fecha"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={enviando !== null || produccion.estado === ESTADO_FINAL_TAREA}
              onClick={handleMarcarEntregado}
            >
              {enviando === "entregar"
                ? "Guardando..."
                : "Marcar material entregado"}
            </button>
          </div>
        </div>
    </Modal>
  );
}
