import React, { useState } from "react";
import {
  calcularPorcentajeCuota,
  getClaveFeed,
  getCuotaCarruselesMensual,
  getCuotaReelsMensual,
  getMesActualISO,
  getPublicacionesDelMismoFeed,
  getPorcentajesCliente,
  getEstadoPorObjetivo,
  getEstadoLabel,
  getTipoPublicacionLabel,
} from "../utils.jsx";
import { Modal } from "./Modal.jsx";

export function EditarCuotaClienteModal({ cliente, onClose, onGuardado }) {
  const esFeedCompartido = Boolean(cliente.grupo_feed_id);
  const [nombre, setNombre] = useState(cliente.nombre || "");
  const [cuotaReels, setCuotaReels] = useState(String(cliente.cuota_reels ?? 0));
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
  const formularioValido = nombre.trim().length > 0 && (esFeedCompartido
    ? esCuotaValida(cuotaFeedReels) && esCuotaValida(cuotaFeedCarruseles)
    : esCuotaValida(cuotaReels) && esCuotaValida(cuotaCarruseles));
  const totalMensual = formularioValido
    ? esFeedCompartido
      ? Number(cuotaFeedReels) + Number(cuotaFeedCarruseles)
      : Number(cuotaReels) + Number(cuotaCarruseles)
    : 0;

  const guardar = (event) => {
    event.preventDefault();
    if (!formularioValido) {
      setError("Completá ambas cuotas con números enteros iguales o mayores a 0.");
      return;
    }
    setGuardando(true);
    setError(null);
    const usaConfiguracionMensual = cliente.configuracion_completa && !esFeedCompartido;
    const configuracionMensual = {
      vigente_desde: getMesActualISO(),
      cuota_reels: Number(cuotaReels),
      cuota_carruseles: Number(cuotaCarruseles),
      dias_historias: cliente.dias_historias,
      disenador_responsable: cliente.disenador_responsable,
      abono_mensual: Number(cliente.abono_mensual),
    };
    fetch(
      usaConfiguracionMensual
        ? `/api/clientes/${cliente.id}/configuraciones`
        : `/api/clientes/${cliente.id}`,
      {
      method: usaConfiguracionMensual ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        usaConfiguracionMensual
          ? configuracionMensual
          : esFeedCompartido
          ? {
              nombre: nombre.trim(),
              cuota_feed_reels: Number(cuotaFeedReels),
              cuota_feed_carruseles: Number(cuotaFeedCarruseles),
            }
          : {
              nombre: nombre.trim(),
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
      .then(async (data) => {
        if (!usaConfiguracionMensual || nombre.trim() === cliente.nombre) return data;
        const response = await fetch(`/api/clientes/${cliente.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: nombre.trim() }),
        });
        const renamed = await response.json();
        if (!response.ok) throw new Error(renamed.error || "La cuota se guardó, pero no se pudo cambiar el nombre.");
        return { ...renamed, ...data, nombre: renamed.nombre };
      })
      .then((data) => onGuardado({ ...cliente, ...data }))
      .catch((err) => setError(err.message))
      .finally(() => setGuardando(false));
  };

  return (
    <Modal
      onClose={onClose}
      title={<span>Editar cliente</span>}
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
          <label className="cliente-service-field">
            <span>Nombre del cliente</span>
            <input value={nombre} onChange={(event) => setNombre(event.target.value)} />
            <small>Se guarda únicamente al confirmar los cambios.</small>
          </label>
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
                ? `${cuotaFeedReels || 0} reels · ${cuotaFeedCarruseles || 0} carruseles compartidos`
                : `${cuotaReels || 0} reels · ${cuotaCarruseles || 0} carruseles`}
            </small>
          </div>
          {error && <div className="caption login-error">{error}</div>}
          <div className="modal-actions">
            <button className="btn" type="button" disabled={guardando} onClick={onClose}>
              Cancelar
            </button>
            <button className="btn primary" type="submit" disabled={guardando || !formularioValido}>
              {guardando ? "Guardando..." : "Guardar cambios"}
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
  onClienteActualizado,
  onClienteEliminado,
}) {
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const [editandoCuota, setEditandoCuota] = useState(false);
  const [mensajeExito, setMensajeExito] = useState("");
  const porcentajes = getPorcentajesCliente(cliente);
  const estado = getEstadoPorObjetivo(porcentajes.objetivo);

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
        workspace: "render_os",
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo enviar el aviso.");
        }
        return response.json();
      })
      .then(() => {
        setMensajeExito(`Tarea creada para ${destinatario} sin cerrar el cliente.`);
        setEnviando(null);
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
                {getEstadoLabel(estado)} · {porcentajes.objetivo}% objetivo mes
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
              <strong>{porcentajes.historias}%</strong>
              <small>{porcentajes.historiasPublicadas} / {porcentajes.historiasTotal} OK</small>
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
          {mensajeExito && <div className="caption cliente-success">{mensajeExito}</div>}

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
              Editar cliente
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
        onGuardado={(clienteActualizado) => {
          onClienteActualizado?.(clienteActualizado);
          onCuotaActualizada?.();
          setEditandoCuota(false);
        }}
      />
    )}
    </>
  );
}
