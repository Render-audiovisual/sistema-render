import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  calcularPorcentajeCuota,
  getClaveFeed,
  getCuotaCarruselesMensual,
  getCuotaReelsMensual,
  getMesActualISO,
  getPublicacionesDelMismoFeed,
  getTipoPublicacionLabel,
} from "../utils.jsx";
import { Modal } from "./Modal.jsx";
import { ESTADOS_CLIENTE } from "../clientesStats.js";

export function EditarCuotaClienteModal({ cliente, onClose, onGuardado }) {
  const esFeedCompartido = Boolean(cliente.grupo_feed_id);
  const [cuotaReels, setCuotaReels] = useState(String(cliente.cuota_reels ?? 0));
  const [cuotaHistorias, setCuotaHistorias] = useState(String(cliente.cuota_historias ?? 0));
  const [estadoCliente, setEstadoCliente] = useState(cliente.estado_cliente || "activo");
  const [cuotaCarruseles, setCuotaCarruseles] = useState(
    String(cliente.cuota_carruseles ?? 0),
  );
  const [cuotaFeedReels, setCuotaFeedReels] = useState(
    String(cliente.cuota_feed_reels ?? 0),
  );
  const [cuotaFeedCarruseles, setCuotaFeedCarruseles] = useState(
    String(cliente.cuota_feed_carruseles ?? 0),
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const esCuotaValida = (valor) =>
    valor !== "" && Number.isInteger(Number(valor)) && Number(valor) >= 0;
  const formularioValido = esCuotaValida(cuotaHistorias) && (esFeedCompartido
    ? esCuotaValida(cuotaFeedReels) && esCuotaValida(cuotaFeedCarruseles)
    : esCuotaValida(cuotaReels) && esCuotaValida(cuotaCarruseles));
  const totalMensual = formularioValido
    ? esFeedCompartido
      ? Number(cuotaHistorias) + Number(cuotaFeedReels) + Number(cuotaFeedCarruseles)
      : Number(cuotaHistorias) + Number(cuotaReels) + Number(cuotaCarruseles)
    : 0;

  const guardar = (event) => {
    event.preventDefault();
    if (!formularioValido) {
      setError("Completá ambas cuotas con números enteros iguales o mayores a 0.");
      return;
    }
    setGuardando(true);
    setError(null);
    fetch(`/api/clientes/${cliente.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        esFeedCompartido
          ? {
              estado_cliente: estadoCliente,
              cuota_historias: Number(cuotaHistorias),
              cuota_feed_reels: Number(cuotaFeedReels),
              cuota_feed_carruseles: Number(cuotaFeedCarruseles),
            }
          : {
              estado_cliente: estadoCliente,
              cuota_historias: Number(cuotaHistorias),
              cuota_reels: Number(cuotaReels),
              cuota_carruseles: Number(cuotaCarruseles),
            },
      ),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo actualizar la cuota.");
        return data;
      })
      .then(onGuardado)
      .catch((err) => setError(err.message))
      .finally(() => setGuardando(false));
  };

  return (
    <Modal
      onClose={onClose}
      title={<span>Editar cuota mensual</span>}
      className="cliente-create-modal"
      overlayAriaLabel="Editar cuota mensual"
    >
        <form className="modal-body cliente-create-modal-body" onSubmit={guardar}>
          <div className="clientes-panel-copy">
            <strong>{cliente.nombre}</strong>
            <span>
              {esFeedCompartido
                ? `Esta cuenta comparte su cuota con el grupo ${cliente.grupo_feed_nombre}.`
                : "Definí la cantidad contratada de cada formato para un mes."}
            </span>
          </div>
          <div className="cliente-create-modal-grid">
            <label className="cliente-service-field">
              <span>Estado contractual</span>
              <select value={estadoCliente} onChange={(event) => setEstadoCliente(event.target.value)}>
                {ESTADOS_CLIENTE.map((estado) => (
                  <option key={estado.value} value={estado.value}>{estado.label}</option>
                ))}
              </select>
              <small>Solo los activos integran los totales de cartera.</small>
            </label>
            <label className="cliente-service-field">
              <span>Historias mensuales</span>
              <input min="0" step="1" type="number" value={cuotaHistorias} onChange={(event) => setCuotaHistorias(event.target.value)} />
              <small>Usá 0 si no forman parte del acuerdo.</small>
            </label>
          </div>
          {esFeedCompartido ? (
            <div className="cliente-create-modal-grid">
              <label className="cliente-service-field">
                <span>Reels compartidos por mes</span>
                <input
                  min="0"
                  step="1"
                  type="number"
                  value={cuotaFeedReels}
                  onChange={(e) => setCuotaFeedReels(e.target.value)}
                />
                <small>Se cuentan entre las dos cuentas del grupo.</small>
              </label>
              <label className="cliente-service-field">
                <span>Carruseles compartidos por mes</span>
                <input
                  min="0"
                  step="1"
                  type="number"
                  value={cuotaFeedCarruseles}
                  onChange={(e) => setCuotaFeedCarruseles(e.target.value)}
                />
                <small>Se cuentan entre las dos cuentas del grupo.</small>
              </label>
            </div>
          ) : (
          <div className="cliente-create-modal-grid">
            <label className="cliente-service-field">
              <span>Reels mensuales</span>
              <input
                min="0"
                step="1"
                type="number"
                value={cuotaReels}
                onChange={(e) => setCuotaReels(e.target.value)}
              />
              <small>Usá 0 si el acuerdo no incluye reels.</small>
            </label>
            <label className="cliente-service-field">
              <span>Carruseles mensuales</span>
              <input
                min="0"
                step="1"
                type="number"
                value={cuotaCarruseles}
                onChange={(e) => setCuotaCarruseles(e.target.value)}
              />
              <small>Usá 0 si el acuerdo no incluye carruseles.</small>
            </label>
          </div>
          )}
          <div className="cliente-contract-summary">
            <span>Resumen del acuerdo</span>
            <strong>{totalMensual} piezas mensuales</strong>
            <small>
              {esFeedCompartido
                ? `${cuotaHistorias || 0} historias · ${cuotaFeedReels || 0} reels · ${cuotaFeedCarruseles || 0} carruseles compartidos`
                : `${cuotaHistorias || 0} historias · ${cuotaReels || 0} reels · ${cuotaCarruseles || 0} carruseles`}
            </small>
          </div>
          {error && <div className="caption login-error">{error}</div>}
          <div className="modal-actions">
            <button className="btn" type="button" disabled={guardando} onClick={onClose}>
              Cancelar
            </button>
            <button className="btn primary" type="submit" disabled={guardando || !formularioValido}>
              {guardando ? "Guardando..." : "Guardar cuota"}
            </button>
          </div>
        </form>
    </Modal>
  );
}


export function DetalleClienteModal({
  cliente,
  historias,
  publicaciones,
  onClose,
  onCuotaActualizada,
  onClienteEliminado,
}) {
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const [editandoCuota, setEditandoCuota] = useState(false);
  const estado = cliente.estadoHistorias?.color || "gris";

  const handleAvisar = (destinatario) => {
    const mensaje = window.prompt(`Mensaje para ${destinatario}:`);
    if (!mensaje) return;

    setEnviando(destinatario);
    setError(null);

    fetch("/api/tareas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo: `${cliente.nombre}: ${mensaje}`,
        asignado_a: destinatario,
        cliente_id: cliente.id,
        estado: "pendiente",
        motivo: mensaje,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo enviar el aviso.");
        }
        return response.json();
      })
      .then(() => {
        onClose();
      })
      .catch(() => {
        setError("No se pudo enviar el aviso. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  const handleEliminarCliente = () => {
    const confirmado = window.confirm(
      `Eliminar ${cliente.nombre}? Solo se permite si no tiene piezas, tareas ni planificación asociada.`,
    );
    if (!confirmado) return;

    setEnviando("eliminar");
    setError(null);

    fetch(`/api/clientes/${cliente.id}`, { method: "DELETE" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo eliminar el cliente.");
        }
        return data;
      })
      .then(() => onClienteEliminado(cliente.id))
      .catch((err) => {
        setError(err.message);
        setEnviando(null);
      });
  };

  const piezas = [
    ...historias.map((h) => ({
      id: `historia-${h.id}`,
      pieza: h.metadata?.Idea || "Historia sin título",
      responsable: h.responsable,
      estado: h.estado,
    })),
    ...publicaciones.map((p) => ({
      id: `publicacion-${p.id}`,
      pieza:
        p.metadata?.Idea || `${getTipoPublicacionLabel(p.tipo)} sin título`,
      responsable: p.responsable,
      estado: p.estado,
    })),
  ];
  const reelsPublicados = publicaciones.filter(
    (publicacion) =>
      publicacion.estado === "publicada" &&
      (publicacion.tipo === "reel" || publicacion.tipo === "video"),
  ).length;
  const carruselesPublicados = publicaciones.filter(
    (publicacion) => publicacion.estado === "publicada" && publicacion.tipo === "carrusel",
  ).length;
  const esFeedCompartido = Boolean(cliente.grupo_feed_id);

  return (
    <>
    <Modal onClose={onClose} title={<span>{cliente.nombre}</span>}>
        <div className="modal-body">
          <div className="modal-client-summary">
            <div className="modal-client-status">
              <span className={`semaforo ${estado}`}></span>
              <strong>
                {cliente.estadoHistorias?.label || "Sin estado"} · {cliente.porcentajeHistorias || 0}% de historias contratadas
              </strong>
            </div>
            <div className="caption">
              {esFeedCompartido
                ? `Cuota compartida ${cliente.grupo_feed_nombre}: ${cliente.cuota_feed_reels ?? 0} reels · ${cliente.cuota_feed_carruseles ?? 0} carruseles entre ambas cuentas`
                : `Cuota mensual: ${cliente.cuota_reels ?? 0} reels · ${cliente.cuota_carruseles ?? 0} carruseles`}
            </div>
          </div>

          <div className="cliente-detail-metrics">
            <div>
              <span>Historias</span>
              <strong>{cliente.historiasPublicadas || 0}</strong>
              <small>{cliente.historiasMes || 0} planificadas · cuota {cliente.cuota_historias || 0}</small>
            </div>
            {esFeedCompartido ? (
              <>
                <div>
                  <span>Reels compartidos</span>
                  <strong>{reelsPublicados}</strong>
                  <small>de {cliente.cuota_feed_reels ?? 0} mensuales</small>
                </div>
                <div>
                  <span>Carruseles compartidos</span>
                  <strong>{carruselesPublicados}</strong>
                  <small>de {cliente.cuota_feed_carruseles ?? 0} mensuales</small>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Reels</span>
                  <strong>{reelsPublicados}</strong>
                  <small>de {cliente.cuota_reels ?? 0} mensuales</small>
                </div>
                <div>
                  <span>Carruseles</span>
                  <strong>{carruselesPublicados}</strong>
                  <small>de {cliente.cuota_carruseles ?? 0} mensuales</small>
                </div>
              </>
            )}
          </div>

          {error && <div className="caption login-error">{error}</div>}

          <table className="cliente-detail-table">
            <thead>
              <tr>
                <th>Pieza</th>
                <th>Responsable</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {piezas.map((pieza) => (
                <tr key={pieza.id}>
                  <td>{pieza.pieza}</td>
                  <td>{pieza.responsable}</td>
                  <td>{pieza.estado}</td>
                </tr>
              ))}
              {piezas.length === 0 && (
                <tr>
                  <td colSpan="3">
                    Sin historias ni publicaciones cargadas para este cliente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="modal-actions">
            <button
              className="btn primary"
              type="button"
              disabled={enviando !== null}
              onClick={() => handleAvisar("Augusto")}
            >
              {enviando === "Augusto" ? "Enviando..." : "Escribir a Augusto"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={enviando !== null}
              onClick={() => handleAvisar("Líder")}
            >
              {enviando === "Líder" ? "Enviando..." : "Escalar al Líder"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={enviando !== null}
              onClick={() => setEditandoCuota(true)}
            >
              Editar cuota
            </button>
            <button
              className="btn danger"
              type="button"
              disabled={enviando !== null}
              onClick={handleEliminarCliente}
            >
              {enviando === "eliminar" ? "Eliminando..." : "Eliminar cliente"}
            </button>
          </div>
        </div>
    </Modal>
    {editandoCuota && (
      <EditarCuotaClienteModal
        cliente={cliente}
        onClose={() => setEditandoCuota(false)}
        onGuardado={() => {
          onCuotaActualizada?.();
          setEditandoCuota(false);
          onClose();
        }}
      />
    )}
    </>
  );
}
