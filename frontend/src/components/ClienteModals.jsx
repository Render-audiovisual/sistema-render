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
  const [abonoMensual, setAbonoMensual] = useState(String(cliente.abono_mensual ?? ""));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const esCuotaValida = (valor) =>
    valor !== "" && Number.isInteger(Number(valor)) && Number(valor) >= 0;
  const abonoValido = esFeedCompartido || (abonoMensual !== "" && Number.isFinite(Number(abonoMensual)) && Number(abonoMensual) >= 0);
  const formularioValido = nombre.trim().length > 0 && abonoValido && (esFeedCompartido
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
      nombre: nombre.trim(),
      rubro: cliente.rubro,
      cuota_reels: Number(cuotaReels),
      cuota_carruseles: Number(cuotaCarruseles),
      dias_historias: cliente.dias_historias,
      disenador_responsable: cliente.disenador_responsable,
      abono_mensual: Number(abonoMensual),
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
        if (usaConfiguracionMensual || abonoMensual === "" || Number(abonoMensual) === Number(cliente.abono_mensual)) return data;
        const response = await fetch(`/api/clientes/${cliente.id}/abono-proximo-mes`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ importe: Number(abonoMensual) }),
        });
        const fee = await response.json();
        if (!response.ok) throw new Error(fee.error || "No se pudo programar el abono.");
        return { ...data, abono_proximo_mes: fee.importe, abono_proximo_vigente_desde: fee.vigente_desde };
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
          <div className="cliente-edit-intro">
            <div>
              <span>ACUERDO MENSUAL</span>
              <strong>{cliente.nombre}</strong>
            </div>
            <small>{totalMensual} piezas por mes</small>
          </div>
          <label className="cliente-service-field cliente-edit-name">
            <span>Nombre del cliente</span>
            <input value={nombre} onChange={(event) => setNombre(event.target.value)} />
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
            </label>
          </div>
          )}
          {!esFeedCompartido && <section className="cliente-edit-finance">
            <div><span>Abono mensual</span><small>Visible únicamente para Líder.</small></div>
            <label className="cliente-money-input">
              <span>$</span>
              <input min="0" step="1" type="number" placeholder="0" value={abonoMensual} onChange={(event) => setAbonoMensual(event.target.value)} />
            </label>
          </section>}
          {error && <div className="caption login-error">{error}</div>}
          <div className="modal-actions cliente-edit-actions">
            <button className="btn ghost" type="button" disabled={guardando} onClick={onClose}>
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
  const estadoTexto = {
    rojo: "Necesita atención",
    amarillo: "En seguimiento",
    verde: "Buen ritmo",
  }[estado] || getEstadoLabel(estado);

  return (
    <>
    <Modal onClose={onClose} title={<span>{cliente.nombre}</span>}>
        <div className="modal-body">
          <div className="modal-client-summary">
            <div className="modal-client-status">
              <span className={`semaforo ${estado}`}></span>
              <strong>{estadoTexto}</strong>
              <span>{porcentajes.objetivo}% del objetivo mensual</span>
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
                  <strong>{reelsPublicados} <small>/ {cliente.cuota_feed_reels ?? 0}</small></strong>
                  <small>publicados este mes</small>
                </div>
                <div>
                  <span>Carruseles compartidos</span>
                  <strong>{carruselesPublicados} <small>/ {cliente.cuota_feed_carruseles ?? 0}</small></strong>
                  <small>publicados este mes</small>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Reels</span>
                  <strong>{reelsPublicados} <small>/ {cliente.cuota_reels ?? 0}</small></strong>
                  <small>publicados este mes</small>
                </div>
                <div>
                  <span>Carruseles</span>
                  <strong>{carruselesPublicados} <small>/ {cliente.cuota_carruseles ?? 0}</small></strong>
                  <small>publicados este mes</small>
                </div>
              </>
            )}
          </div>

          {error && <div className="caption login-error">{error}</div>}
          {mensajeExito && <div className="caption cliente-success">{mensajeExito}</div>}

          <details className="cliente-detail-pieces">
            <summary>
              <span><strong>Piezas del mes</strong><small>Historias, reels y carruseles</small></span>
              <span className="cliente-detail-count">{piezas.length}</span>
            </summary>
            <div className="cliente-detail-table-wrap">
              <table className="cliente-detail-table">
                <thead>
                  <tr><th>Pieza</th><th>Responsable</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {piezas.map((pieza) => (
                    <tr key={pieza.id}><td>{pieza.pieza}</td><td>{pieza.responsable}</td><td>{pieza.estado}</td></tr>
                  ))}
                  {piezas.length === 0 && (
                    <tr><td colSpan="3">Sin historias ni publicaciones cargadas para este cliente.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </details>

          <div className="modal-actions">
            <button
              className="btn primary"
              type="button"
              disabled={enviando !== null}
              onClick={() => setEditandoCuota(true)}
            >
              Editar cliente
            </button>
            <button
              className="btn"
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
