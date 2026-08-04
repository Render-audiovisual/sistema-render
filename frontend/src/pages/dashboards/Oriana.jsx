import React, { useEffect, useState } from "react";
import { getEstadoHistoriaLabel, getHoyLocalISO, getSesion } from "../../utils.jsx";
import { TareasAsignadasGenericas } from "../../components/TareasAsignadasGenericas.jsx";
import { Modal } from "../../components/Modal.jsx";

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

          <div className="box" style={{ backgroundColor: "#f0f4f8", padding: "16px", marginBottom: "20px", borderRadius: "4px", border: "1px solid #ddd" }}>
            <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
              <div>
                <div style={{ fontSize: "24px", fontWeight: "bold", color: "#0066cc" }}>{listasHoy}</div>
                <div style={{ fontSize: "12px", color: "#666" }}>Listas para subir</div>
              </div>
              <div>
                <div style={{ fontSize: "24px", fontWeight: "bold", color: "#d9534f" }}>{piezasHoy.length - listasHoy - publicadasHoy}</div>
                <div style={{ fontSize: "12px", color: "#666" }}>Esperando aprobación</div>
              </div>
              <div>
                <div style={{ fontSize: "24px", fontWeight: "bold", color: "#28a745" }}>{publicadasHoy}</div>
                <div style={{ fontSize: "12px", color: "#666" }}>Ya publicadas</div>
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

          <div className="section-label">Vencidas (no publicadas a tiempo)</div>
          <div className="box">
            {vencidas.map((pieza) => (
              <div
                className="priority-card blocked"
                key={`vencida-${pieza.origen}-${pieza.id}`}
              >
                <div className="cliente">{pieza.cliente_nombre}</div>
                <div>{pieza.idea || "Sin idea cargada"}</div>
                <div className="meta">
                  Debía publicarse el {pieza.fecha_programada}
                </div>
              </div>
            ))}
            {vencidas.length === 0 && (
              <div className="caption">No hay piezas vencidas.</div>
            )}
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

          <div className="section-label">Piezas bloqueadas por corrección</div>
          <div className="box">
            {bloqueadas.map((pieza) => (
              <div
                className="priority-card blocked"
                key={`bloqueada-${pieza.origen}-${pieza.id}`}
              >
                <div className="cliente">{pieza.cliente_nombre}</div>
                <div>{pieza.idea || "Sin idea cargada"}</div>
                <div className="meta">
                  {pieza.aclaraciones || "Sin aclaración cargada"}
                </div>
              </div>
            ))}
            {bloqueadas.length === 0 && (
              <div className="caption">No hay piezas bloqueadas.</div>
            )}
            <div className="caption">
              → Bloqueos de publicación separados del calendario para no perder
              piezas que requieren corrección.
            </div>
          </div>

          <div className="section-label">Avance del día</div>
          <div className="box">
            <div className="progress-card">
              <div className="progress-label">Avance del día</div>
              <div className="progress-value compact">
                {publicadasHoy} / {piezasHoy.length}
              </div>
            </div>
            <div className="caption">
              → Conteo real de piezas publicadas hoy sobre el total programado
              para hoy.
            </div>
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
