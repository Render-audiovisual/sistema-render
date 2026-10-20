import React, { useRef, useState } from "react";
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import {
  calcularPorcentajeCuota,
  getClaveFeed,
  getCuotaCarruselesMensual,
  getCuotaReelsMensual,
  getMesActualISO,
  getPublicacionesDelMismoFeed,
  getEstadoLabel,
  getTipoPublicacionLabel,
} from "../utils.jsx";
import { Modal } from "./Modal.jsx";

const WEEKDAYS = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"]];

function WeekdayPicker({ label, value, onChange, disabled }) {
  return <fieldset disabled={disabled} className="cliente-weekday-picker"><legend>{label}</legend><div>{WEEKDAYS.map(([day, text]) => (
    <label key={day} className={value.includes(day) ? "selected" : ""}>
      <input type="checkbox" checked={value.includes(day)} onChange={() => onChange(value.includes(day) ? value.filter((item) => item !== day) : [...value, day])} />
      <span>{text}</span>
    </label>
  ))}</div><small>Opcional: si no elegís días, el calendario los distribuye automáticamente.</small></fieldset>;
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameClient = (actual, expected) => (Number.isSafeInteger(actual) && actual > 0 || typeof actual === 'string' && /^[1-9]\d*$/.test(actual))
  && String(actual) === String(expected);
const monthStart = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value);
const validPeriod = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function assertClientAck(data, id, expected, configuration = false) {
  if (!object(data) || !sameClient(data.id, id) || Object.entries(expected).some(([key, value]) => Array.isArray(value)
    ? !Array.isArray(data[key]) || JSON.stringify(data[key]) !== JSON.stringify(value) : data[key] !== value)
    || configuration && (data.configuracion_completa !== true || !monthStart(data.configuracion_vigente_desde))) {
    throw new Error('La respuesta no confirmó los cambios del cliente. Verificá la versión guardada antes de reintentar.');
  }
  return data;
}
function assertFeeAck(data, id, amount) {
  if (!object(data) || !sameClient(data.cliente_id, id) || !monthStart(data.vigente_desde)
    || !['number', 'string'].includes(typeof data.importe) || String(data.importe).trim() === ''
    || !Number.isFinite(Number(data.importe)) || Number(data.importe) !== amount) {
    throw new Error('La respuesta no confirmó el abono programado. Verificá el importe guardado antes de reintentar.');
  }
  return data;
}

export function EditarCuotaClienteModal({ sesion, periodo = getMesActualISO(), ...props }) {
  const { view, capture, epoch } = useScopedRequest(sesion, `editar-cliente:${props.cliente.id}:${periodo}`);
  return <EditarCuotaSession key={`${view.key}:${epoch}`} {...props} periodo={periodo} capture={capture}/>;
}

function EditarCuotaSession({ cliente, periodo, onClose, onGuardado, capture }) {
  const pending = useRef(false);
  const esFeedCompartido = Boolean(cliente.grupo_feed_id);
  const [nombre, setNombre] = useState(cliente.nombre || "");
  const [activo, setActivo] = useState(cliente.activo !== false);
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
  const [diasReels, setDiasReels] = useState(cliente.dias_reels || []);
  const [diasCarruseles, setDiasCarruseles] = useState(cliente.dias_carruseles || []);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const snapshot = JSON.stringify({ nombre, activo, cuotaReels, cuotaCarruseles, cuotaFeedReels, cuotaFeedCarruseles, abonoMensual, diasReels, diasCarruseles });
  const baseline = useRef(snapshot);
  const closeEditor = () => {
    const guard = capture();
    if (pending.current || !guard.current()) return;
    if (snapshot !== baseline.current && !window.confirm('¿Descartar los cambios del cliente sin guardar?')) return;
    guard.assertCurrent(); onClose();
  };

  const esCuotaValida = (valor) =>
    valor !== "" && Number.isInteger(Number(valor)) && Number(valor) >= 0;
  const abonoValido = abonoMensual !== "" && Number.isFinite(Number(abonoMensual)) && Number(abonoMensual) >= 0;
  const formularioValido = nombre.trim().length > 0 && abonoValido && (esFeedCompartido
    ? esCuotaValida(cuotaFeedReels) && esCuotaValida(cuotaFeedCarruseles)
    : esCuotaValida(cuotaReels) && esCuotaValida(cuotaCarruseles));
  const totalMensual = formularioValido
    ? esFeedCompartido
      ? Number(cuotaFeedReels) + Number(cuotaFeedCarruseles)
      : Number(cuotaReels) + Number(cuotaCarruseles)
    : 0;

  const guardar = async (event) => {
    event.preventDefault();
    if (pending.current) return;
    const guard = capture();
    if (!guard.current()) return;
    if (!validPeriod(periodo)) { setError('Elegí un período válido antes de guardar el cliente.'); return; }
    if (!formularioValido) {
      setError("Completá ambas cuotas con números enteros iguales o mayores a 0.");
      return;
    }
    pending.current = true; setGuardando(true);
    setError(null);
    const usaConfiguracionMensual = cliente.configuracion_completa && !esFeedCompartido;
    const configuracionMensual = {
      vigente_desde: periodo,
      nombre: nombre.trim(),
      rubro: cliente.rubro,
      cuota_reels: Number(cuotaReels),
      cuota_carruseles: Number(cuotaCarruseles),
      dias_historias: cliente.dias_historias,
      dias_reels: diasReels,
      dias_carruseles: diasCarruseles,
      disenador_responsable: cliente.disenador_responsable,
      abono_mensual: Number(abonoMensual),
    };
    let committed = '', stage = usaConfiguracionMensual ? 'la configuración mensual' : 'los datos del cliente';
    const payload = usaConfiguracionMensual ? configuracionMensual : esFeedCompartido
      ? { nombre: nombre.trim(), activo, cuota_feed_reels: Number(cuotaFeedReels), cuota_feed_carruseles: Number(cuotaFeedCarruseles) }
      : { nombre: nombre.trim(), activo, cuota_reels: Number(cuotaReels), cuota_carruseles: Number(cuotaCarruseles) };
    try {
      let data = await guard.request(usaConfiguracionMensual ? `/api/clientes/${cliente.id}/configuraciones` : `/api/clientes/${cliente.id}`, {
        method: usaConfiguracionMensual ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      guard.assertCurrent();
      const expected = usaConfiguracionMensual
        ? { nombre: payload.nombre, cuota_reels: payload.cuota_reels, cuota_carruseles: payload.cuota_carruseles, abono_mensual: payload.abono_mensual,
          dias_historias: [...new Set(payload.dias_historias || [])].sort(), dias_reels: [...new Set(payload.dias_reels)].sort(),
          dias_carruseles: [...new Set(payload.dias_carruseles)].sort(), disenador_responsable: payload.disenador_responsable,
          configuracion_vigente_desde: `${periodo}-01`, abono_vigente_desde: `${periodo}-01` }
        : payload;
      assertClientAck(data, cliente.id, expected, usaConfiguracionMensual);
      committed = usaConfiguracionMensual ? 'La configuración mensual se guardó.' : 'Los datos del cliente se guardaron.';
      if (usaConfiguracionMensual && activo !== cliente.activo) {
        stage = 'el estado del cliente';
        const estado = await guard.request(`/api/clientes/${cliente.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo }) });
        guard.assertCurrent(); assertClientAck(estado, cliente.id, { activo }); data = { ...data, ...estado };
        committed = 'La configuración mensual y el estado del cliente se guardaron.';
      }
      if (!usaConfiguracionMensual && abonoMensual !== '') {
        stage = 'el abono del próximo mes';
        const fee = await guard.request(`/api/clientes/${cliente.id}/abono-proximo-mes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importe: Number(abonoMensual) }) });
        guard.assertCurrent(); assertFeeAck(fee, cliente.id, Number(abonoMensual));
        data = { ...data, abono_proximo_mes: fee.importe, abono_proximo_vigente_desde: fee.vigente_desde };
        committed = 'Los datos del cliente y el abono del próximo mes se guardaron.';
      }
      guard.assertCurrent(); baseline.current = snapshot; stage = 'la actualización de la vista';
      await onGuardado({ ...cliente, ...data }, guard);
      guard.assertCurrent();
    } catch (reason) {
      if (guard.current()) setError(`${committed ? `${committed} ` : ''}No se confirmó ${stage}. ${reason.message || 'Verificá los datos guardados antes de reintentar.'}`);
    } finally { if (guard.current()) { pending.current = false; setGuardando(false); } }
  };

  return (
    <Modal
      onClose={closeEditor}
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
            <small>{totalMensual} piezas por mes · Período seleccionado: {periodo}</small>
          </div>
          <label className="cliente-service-field cliente-edit-name">
            <span>Nombre del cliente</span>
            <input disabled={guardando} value={nombre} onChange={(event) => { if (!pending.current) setNombre(event.target.value); }} />
          </label>
          <label className="cliente-active-toggle">
            <input disabled={guardando} type="checkbox" checked={activo} onChange={(event) => { if (!pending.current) setActivo(event.target.checked); }} />
            <span>
              <strong>Cliente activo</strong>
              <small>Si lo desactivás, deja de contar en las estadísticas generales sin perder su historial.</small>
            </span>
          </label>
          {esFeedCompartido ? (
            <div className="cliente-create-modal-grid">
              <label className="cliente-service-field">
                <span>Reels compartidos por mes</span>
                <input
                  disabled={guardando}
                  min="0"
                  step="1"
                  type="number"
                  value={cuotaFeedReels}
                  onChange={(e) => { if (!pending.current) setCuotaFeedReels(e.target.value); }}
                />
              </label>
              <label className="cliente-service-field">
                <span>Carruseles compartidos por mes</span>
                <input
                  disabled={guardando}
                  min="0"
                  step="1"
                  type="number"
                  value={cuotaFeedCarruseles}
                  onChange={(e) => { if (!pending.current) setCuotaFeedCarruseles(e.target.value); }}
                />
              </label>
            </div>
          ) : (
          <div className="cliente-create-modal-grid">
            <label className="cliente-service-field">
              <span>Reels mensuales</span>
              <input
                disabled={guardando}
                min="0"
                step="1"
                type="number"
                value={cuotaReels}
                onChange={(e) => { if (!pending.current) setCuotaReels(e.target.value); }}
              />
            </label>
            <label className="cliente-service-field">
              <span>Carruseles mensuales</span>
              <input
                disabled={guardando}
                min="0"
                step="1"
                type="number"
                value={cuotaCarruseles}
                onChange={(e) => { if (!pending.current) setCuotaCarruseles(e.target.value); }}
              />
            </label>
          </div>
          )}
          {!esFeedCompartido && <div className="cliente-publishing-days">
            <WeekdayPicker disabled={guardando} label="Días preferidos para reels" value={diasReels} onChange={value => { if (!pending.current) setDiasReels(value); }} />
            <WeekdayPicker disabled={guardando} label="Días preferidos para carruseles" value={diasCarruseles} onChange={value => { if (!pending.current) setDiasCarruseles(value); }} />
          </div>}
          <section className="cliente-edit-finance">
            <div><span>Abono mensual</span><small>Visible únicamente para Líder. {cliente.configuracion_completa && !esFeedCompartido
              ? `Configuración y abono vigentes desde ${periodo}-01.`
              : 'El abono se programa para el próximo mes del servidor, no para el período seleccionado.'}</small></div>
            <label className="cliente-money-input">
              <span>$</span>
              <input disabled={guardando} min="0" step="1" type="number" placeholder="0" value={abonoMensual} onChange={(event) => { if (!pending.current) setAbonoMensual(event.target.value); }} />
            </label>
          </section>
          {error && <div className="caption login-error">{error}</div>}
          <div className="modal-actions cliente-edit-actions">
            <button className="btn ghost" type="button" disabled={guardando} onClick={closeEditor}>
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


export function DetalleClienteModal({ sesion, periodo = getMesActualISO(), ...props }) {
  const { view, capture, epoch } = useScopedRequest(sesion, `detalle-cliente:${props.cliente.id}:${periodo}`);
  return <DetalleClienteSession key={`${view.key}:${epoch}`} {...props} periodo={periodo} sesion={view.session} capture={capture}/>;
}

function DetalleClienteSession({
  sesion, periodo, capture,
  cliente,
  historias,
  publicaciones,
  onClose,
  onCuotaActualizada,
  onClienteActualizado,
  onClienteEliminado,
}) {
  const pending = useRef(false), nestedEditing = useRef(false);
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const [editandoCuota, setEditandoCuota] = useState(false);
  const estado = cliente.estadoGeneral?.color || cliente.estadoHistorias?.color || "gris";

  const closeDetail = () => {
    const guard = capture();
    if (pending.current || nestedEditing.current || !guard.current()) return;
    onClose();
  };
  const handleEliminarCliente = async () => {
    if (pending.current || nestedEditing.current) return;
    const guard = capture();
    if (!guard.current()) return;
    if (!validPeriod(periodo)) { setError('Elegí un período válido antes de eliminar el cliente.'); return; }
    const confirmado = window.confirm(
      `Eliminar ${cliente.nombre}? Solo se permite si no tiene piezas, tareas ni planificación asociada.`,
    );
    if (!confirmado) return;
    if (!guard.current()) return;
    pending.current = true;

    setEnviando("eliminar");
    setError(null);

    let deleted = false;
    try {
      const data = await guard.request(`/api/clientes/${cliente.id}`, { method: 'DELETE' });
      guard.assertCurrent();
      if (!object(data) || data.ok !== true || !sameClient(data.cliente?.id, cliente.id)) throw new Error('La respuesta no confirmó la eliminación. Verificá el cliente antes de reintentar.');
      deleted = true;
      await onClienteEliminado(cliente.id, guard); guard.assertCurrent();
    } catch (reason) {
      if (guard.current()) setError(`${deleted ? 'El cliente se eliminó, pero no se pudo actualizar la vista. ' : ''}${reason.message}`);
    } finally { if (guard.current()) { pending.current = false; setEnviando(null); } }
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
  const abono = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
    .format(Number(cliente.abono_mensual) || 0);

  return (
    <>
    <Modal onClose={closeDetail} title={<span>{cliente.nombre}</span>}>
        <div className="modal-body">
          <div className="modal-client-summary">
            <div className="modal-client-status">
              <span className={`semaforo ${estado}`}></span>
              <strong>{estadoTexto}</strong>
              <span>{cliente.porcentajeGeneral || 0}% del acuerdo mensual</span>
            </div>
            <div className="caption">
              {esFeedCompartido
                ? `Cuota compartida ${cliente.grupo_feed_nombre}: ${cliente.cuota_feed_reels ?? 0} reels · ${cliente.cuota_feed_carruseles ?? 0} carruseles entre ambas cuentas`
                : `Cuota mensual: ${cliente.cuota_reels ?? 0} reels · ${cliente.cuota_carruseles ?? 0} carruseles`}
            </div>
            <div className="cliente-detail-agreement">
              <div><span>Abono mensual</span><strong>{abono}</strong></div>
              <div><span>Servicios</span><strong>Reels · Carruseles · Historias</strong></div>
            </div>
          </div>

          <div className="cliente-detail-metrics">
            <div>
              <span>Historias</span>
              <strong>{cliente.historiasPublicadas || 0} <small>/ {cliente.cuotaHistorias || 0}</small></strong>
              <small>{cliente.historiasMes || 0} planificadas este mes</small>
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

          <div className="modal-actions cliente-detail-actions">
            <button
              className="btn"
              type="button"
              disabled={enviando !== null || editandoCuota}
              onClick={() => {
                const guard = capture(); if (pending.current || nestedEditing.current || !guard.current()) return;
                window.history.pushState({}, "", `/moodboards?cliente=${cliente.id}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >
              ✦ Abrir moodboard
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={enviando !== null}
              onClick={() => { const guard = capture(); if (!pending.current && guard.current()) { nestedEditing.current = true; setEditandoCuota(true); } }}
            >
              Editar cliente
            </button>
            <button
              className="btn danger cliente-detail-delete"
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
        sesion={sesion}
        periodo={periodo}
        cliente={cliente}
        onClose={() => { const guard = capture(); if (!guard.current()) return; nestedEditing.current = false; setEditandoCuota(false); }}
        onGuardado={async (clienteActualizado, guard) => {
          guard.assertCurrent(); await onClienteActualizado?.(clienteActualizado, guard);
          guard.assertCurrent(); await onCuotaActualizada?.(guard);
          guard.assertCurrent(); nestedEditing.current = false; setEditandoCuota(false);
        }}
      />
    )}
    </>
  );
}
