import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { getEstadoHistoriaLabel, getHoyLocalISO, getSesion } from "../../utils.jsx";
import { TareasAsignadasGenericas } from "../../components/TareasAsignadasGenericas.jsx";
import { Modal } from "../../components/Modal.jsx";
import { IconUpload, IconClock, IconCheckCircle } from "../../components/Icons.jsx";

export function OrianaDashboard() {
  const [publicacionChecklist, setPublicacionChecklist] = useState(null);
  const [piezasOriana, setPiezasOriana] = useState([]);
  const [orianaError, setOrianaError] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/historias").then((r) => r.json()),
      fetch("/api/publicaciones").then((r) => r.json()),
    ])
      .then(([historias, publicaciones]) => {
        const combinadas = [
          ...historias.map((h) => ({ ...h, origen: "historia" })),
          ...publicaciones.map((p) => ({ ...p, origen: "publicacion" })),
        ].sort((a, b) =>
          a.fecha_programada < b.fecha_programada ? -1 : 1,
        );
        setPiezasOriana(combinadas);
      })
      .catch((error) => {
        console.error("No se pudieron cargar las piezas de Oriana", error);
        setOrianaError("No se pudieron cargar las piezas.");
      });
  }, []);

  const hoy = getHoyLocalISO();

  // Oriana solo publica — no le corresponde ver piezas todavía en diseño,
  // edición o revisión. Su universo son: listas para subir, ya publicadas
  // y bloqueadas (necesita saber que existen, aunque no las resuelva ella).
  const piezasRelevantes = piezasOriana.filter((pieza) =>
    ["lista", "publicada", "bloqueada"].includes(pieza.estado),
  );

  const piezasHoy = piezasRelevantes.filter(
    (pieza) => pieza.fecha_programada && pieza.fecha_programada.startsWith(hoy),
  );
  const proximas = piezasRelevantes.filter(
    (pieza) => pieza.estado === "lista" && pieza.fecha_programada > hoy,
  );
  const vencidas = piezasRelevantes.filter(
    (pieza) =>
      pieza.estado !== "publicada" &&
      pieza.fecha_programada &&
      pieza.fecha_programada < hoy,
  );
  const bloqueadas = piezasRelevantes.filter(
    (pieza) => pieza.estado === "bloqueada",
  );
  const publicadasHoy = piezasHoy.filter(
    (pieza) => pieza.estado === "publicada",
  ).length;
  const listasHoy = piezasHoy.filter(
    (pieza) => pieza.estado === "lista",
  ).length;

  return (
    <main aria-label="Render platform Oriana">
      <div className="frame">
        <div className="content">
          <div className="section-label">Community</div>
          <h2>Mi calendario</h2>

          <div className="stat-row">
            <div className="stat-card is-neutral">
              <div className="stat-icon"><IconUpload /></div>
              <div>
                <div className="stat-num">{listasHoy}</div>
                <div className="stat-label">Listas para subir</div>
              </div>
            </div>
            <div className={`stat-card ${piezasHoy.length - listasHoy - publicadasHoy > 0 ? "is-warning" : "is-neutral"}`}>
              <div className="stat-icon"><IconClock /></div>
              <div>
                <div className="stat-num">{piezasHoy.length - listasHoy - publicadasHoy}</div>
                <div className="stat-label">Esperando aprobación</div>
              </div>
            </div>
            <div className="stat-card is-neutral">
              <div className="stat-icon"><IconCheckCircle /></div>
              <div>
                <div className="stat-num">{publicadasHoy}</div>
                <div className="stat-label">Ya publicadas</div>
              </div>
            </div>
          </div>

          <div className="section-label">Calendario del día</div>
          <div className="box">
            {orianaError && <div className="caption">{orianaError}</div>}
            {!orianaError &&
              piezasHoy.map((pieza) => {
                const estaLista = pieza.estado === "lista";
                const estaBloqueada = pieza.estado === "bloqueada";

                return (
                  <div
                    className={`priority-card ${estaBloqueada ? "blocked" : ""}`}
                    key={`${pieza.origen}-${pieza.id}`}
                    onClick={() => {
                      if (estaLista) {
                        setPublicacionChecklist(pieza);
                      }
                    }}
                  >
                    <div className="cliente">{pieza.cliente_nombre}</div>
                    <div>{pieza.idea || "Sin idea cargada"}</div>
                    <div className="meta">
                      <span
                        className={`tag ${
                          estaBloqueada ? "creativa" : "operativa"
                        }`}
                      >
                        {estaBloqueada
                          ? "Bloqueada"
                          : estaLista
                            ? "Lista para subir"
                            : pieza.estado === "publicada"
                              ? "Ya publicada"
                              : getEstadoHistoriaLabel(pieza.estado)}
                      </span>
                    </div>
                  </div>
                );
              })}
            {!orianaError && piezasHoy.length === 0 && (
              <div className="caption">
                No hay piezas programadas para hoy.
              </div>
            )}
            <div className="caption">
              → Solo contenido ya aprobado y listo para publicar — nada que
              todavía esté en diseño, edición o revisión.
            </div>
          </div>

          <div className="section-label">Piezas que requieren atención</div>
          <div className="box">
            {(() => {
              const piezasPorClave = new Map();
              vencidas.forEach((pieza) => {
                piezasPorClave.set(`${pieza.origen}-${pieza.id}`, {
                  ...pieza,
                  urgencia: "atrasada",
                });
              });
              bloqueadas.forEach((pieza) => {
                const clave = `${pieza.origen}-${pieza.id}`;
                piezasPorClave.set(clave, {
                  ...(piezasPorClave.get(clave) ?? pieza),
                  ...pieza,
                  urgencia: "bloqueada",
                });
              });
              const piezasAtencion = Array.from(piezasPorClave.values()).sort(
                (a, b) => (a.urgencia === b.urgencia ? 0 : a.urgencia === "bloqueada" ? -1 : 1),
              );

              if (piezasAtencion.length === 0) {
                return <div className="caption">✅ No hay piezas vencidas ni bloqueadas.</div>;
              }

              return (
                <div className="urgent-list">
                  {piezasAtencion.map((pieza) => {
                    const esBloqueada = pieza.urgencia === "bloqueada";
                    return (
                      <div className="urgent-row" key={`${pieza.origen}-${pieza.id}`}>
                        <span className={`tag ${esBloqueada ? "bloqueada" : "atraso"}`}>
                          {esBloqueada ? "Bloqueada" : "Vencida"}
                        </span>
                        <div className="urgent-info">
                          <div className="urgent-title">
                            {pieza.cliente_nombre} · {pieza.idea || "Sin idea cargada"}
                          </div>
                          <div className="urgent-meta">
                            {esBloqueada
                              ? pieza.aclaraciones || "Sin aclaración cargada"
                              : `Debía publicarse el ${pieza.fecha_programada}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div className="section-label">Próximas programadas</div>
          <div className="box">
            {proximas.slice(0, 10).map((pieza) => (
              <div className="card" key={`proxima-${pieza.origen}-${pieza.id}`}>
                <div className="cliente">{pieza.cliente_nombre}</div>
                <div>{pieza.idea || "Sin idea cargada"}</div>
                <div className="meta">{pieza.fecha_programada}</div>
              </div>
            ))}
            {proximas.length === 0 && (
              <div className="caption">No hay piezas listas programadas a futuro todavía.</div>
            )}
          </div>
        </div>
      </div>

      {publicacionChecklist && (
        <ChecklistPublicacionOrianaModal
          publicacion={publicacionChecklist}
          onClose={() => setPublicacionChecklist(null)}
          onPublicar={(id) => {
            setPiezasOriana((actuales) =>
              actuales.map((pieza) =>
                pieza.id === id && pieza.origen === publicacionChecklist.origen
                  ? { ...pieza, estado: "publicada" }
                  : pieza,
              ),
            );
          }}
        />
      )}
      <TareasAsignadasGenericas nombre="Oriana" />
    </main>
  );
}

export function ChecklistPublicacionOrianaModal({ publicacion, onClose, onPublicar }) {
  const checklist = [
    "Precios / signos $ correctos",
    "Sin errores de ortografía",
    "CTA / links del cliente correcto",
  ];
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const handleMarcarPublicada = () => {
    setEnviando(true);
    setError(null);

    const endpoint =
      publicacion.origen === "publicacion"
        ? `/api/publicaciones/${publicacion.id}`
        : `/api/historias/${publicacion.id}`;

    fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "publicada" }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo marcar como publicada.");
        }
        return response.json();
      })
      .then(() => {
        onPublicar(publicacion.id);
        onClose();
      })
      .catch(() => {
        setError("No se pudo marcar como publicada. Intentá de nuevo.");
        setEnviando(false);
      });
  };

  return (
    <Modal
      onClose={onClose}
      title={
        <span>
          {publicacion.cliente_nombre} ·{" "}
          {publicacion.idea || "Sin idea cargada"}
        </span>
      }
    >
        <div className="modal-body">
          <div className="meta-block">Paso 0: Augusto ya confirmó la entrega ✓</div>

          <div className="checklist">
            {checklist.map((item) => (
              <div className="checklist-item" key={item}>
                <span className="checkbox-visual">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          {error && <div className="caption login-error">{error}</div>}

          {esAdmin ? (
            <div className="modal-actions">
              <button
                className="btn primary"
                disabled={enviando}
                type="button"
                onClick={handleMarcarPublicada}
              >
                {enviando ? "Marcando..." : "Marcar publicada"}
              </button>
            </div>
          ) : (
            <div className="caption">
              Solo el Líder puede marcar una pieza como publicada.
            </div>
          )}
        </div>
    </Modal>
  );
}
