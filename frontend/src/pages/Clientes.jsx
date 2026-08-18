import React, { useEffect, useMemo, useState } from "react";
import { getMesActualISO } from "../utils.jsx";
import {
  calcularCuotaHistoriasPorDias,
  calcularPorcentajeCuota,
  esDelMes,
  getAvanceMes,
  getCuotaCarruselesMensual,
  getCuotaReelsMensual,
  getMesISO,
  getPublicacionesDelMismoFeed,
  getResumenClientes,
  getTotalesCartera,
} from "../clientesStats.js";
import { EditarCuotaClienteModal, DetalleClienteModal } from "../components/ClienteModals.jsx";
import { Modal } from "../components/Modal.jsx";
import { PageState } from "../components/PageState.jsx";
import { readUrlContext, replaceUrlContext } from "../shared/navigation/url-context.js";

const CLIENT_COLORS = ["#547aa5", "#6f72a8", "#4f8a7a", "#a36d5d", "#8a6fa5", "#647c99"];
const RUBROS = ["Gastronomía", "Tecnología", "Turismo", "Educación", "Automotor", "Comercio", "Salud", "Servicios"];
const WEEKDAYS = [
  [1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"],
];
const MONEY = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function emptyClientForm() {
  return {
    nombre: "", rubro: "", cuota_reels: "", cuota_carruseles: "",
    dias_historias: [], dias_reels: [], dias_carruseles: [], disenador_responsable: "", abono_mensual: "",
    vigente_desde: getMesActualISO(),
  };
}

function getClienteColor(nombre = "") {
  const index = [...nombre].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return CLIENT_COLORS[index % CLIENT_COLORS.length];
}

function getClienteInicial(nombre = "") {
  return nombre.trim().charAt(0).toUpperCase() || "C";
}

export function ClienteCuotaResumen({ etiqueta, publicados, cuota }) {
  const cuotaNumero = Number(cuota) || 0;
  const porcentaje = calcularPorcentajeCuota(publicados, cuotaNumero);
  return (
    <div className="cliente-quota-summary">
      <div className="cliente-quota-summary-head">
        <span>{etiqueta}</span>
        {cuotaNumero === 0 ? (
          <strong className="cliente-quota-not-included">No incluido</strong>
        ) : (
          <strong>{publicados} de {cuotaNumero}</strong>
        )}
      </div>
      {cuotaNumero > 0 && (
        <>
          <div className="cliente-quota-progress" aria-label={`${porcentaje}% de la cuota de ${etiqueta}`}>
            <span style={{ width: `${Math.min(porcentaje, 100)}%` }} />
          </div>
          <small>{publicados} publicados · {cuotaNumero - Math.min(publicados, cuotaNumero)} pendientes</small>
        </>
      )}
      {cuotaNumero === 0 && <small>Este formato no forma parte del acuerdo mensual.</small>}
    </div>
  );
}

export function ClientesAdminPage() {
  const [initialClientId] = useState(
    () => Number(readUrlContext(window.location.search, { cliente: "" }).cliente) || null,
  );
  const [contextRestored, setContextRestored] = useState(false);
  const [clientes, setClientes] = useState([]);
  const [historias, setHistorias] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [tareasFinalizadas, setTareasFinalizadas] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [nuevoCliente, setNuevoCliente] = useState(emptyClientForm);
  const [mesSeleccionado, setMesSeleccionado] = useState(() => getMesISO());
  const [filtroEstado, setFiltroEstado] = useState("activos");
  const [guardandoCliente, setGuardandoCliente] = useState(false);
  const [altaClienteAbierta, setAltaClienteAbierta] = useState(false);
  const [pasoAltaCliente, setPasoAltaCliente] = useState(1);
  const [clienteCuotaEnEdicion, setClienteCuotaEnEdicion] = useState(null);
  const [errorAltaCliente, setErrorAltaCliente] = useState(null);

  // silencioso=true (polling / vuelta a la pestaña) no muestra el spinner de
  // carga para no interrumpir a quien está mirando la tabla — solo actualiza
  // los números por detrás. La primera carga y el guardado explícito de una
  // cuota sí lo muestran.
  const cargarClientes = ({ silencioso = false } = {}) => {
    if (!silencioso) setCargando(true);
    setError(null);
    Promise.all([
      fetch(`/api/clientes?periodo=${mesSeleccionado}`).then(validarRespuestaApi),
      fetch("/api/historias").then(validarRespuestaApi),
      fetch("/api/publicaciones").then(validarRespuestaApi),
      fetch("/api/tareas?workspace=render_os&estado=publicada").then(validarRespuestaApi),
    ])
      .then(([clientesApi, historiasApi, publicacionesApi, tareasApi]) => {
        setClientes(clientesApi);
        setHistorias(historiasApi);
        setPublicaciones(publicacionesApi);
        setTareasFinalizadas(tareasApi);
      })
      .catch((err) => {
        console.error("No se pudo cargar el tablero de clientes", err);
        setError("No se pudo cargar el tablero de clientes.");
      })
      .finally(() => {
        if (!silencioso) setCargando(false);
      });
  };

  async function validarRespuestaApi(response) {
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `No se pudo cargar la información (${response.status}).`);
    if (!Array.isArray(data)) throw new Error("El servidor devolvió información inválida.");
    return data;
  }

  useEffect(() => {
    if (contextRestored || clientes.length === 0) return;
    if (initialClientId) {
      const requestedClient = clientes.find((client) => client.id === initialClientId);
      if (requestedClient) setClienteSeleccionado(requestedClient);
    }
    setContextRestored(true);
  }, [clientes, contextRestored, initialClientId]);

  useEffect(() => {
    if (!contextRestored) return;
    replaceUrlContext({ cliente: clienteSeleccionado?.id || null });
  }, [clienteSeleccionado, contextRestored]);

  // % de historias/publicaciones en tiempo real: el equipo marca cosas como
  // publicadas desde Historias/Publicaciones mientras alguien tiene este
  // tablero abierto en otra pestaña, así que se refresca solo cada 30s y
  // también apenas la pestaña vuelve a estar visible (por si el intervalo
  // quedó pausado por el navegador mientras estaba en segundo plano).
  useEffect(() => {
    cargarClientes();
    const intervalo = setInterval(() => cargarClientes({ silencioso: true }), 30000);
    const alVolverVisible = () => {
      if (document.visibilityState === "visible") {
        cargarClientes({ silencioso: true });
      }
    };
    document.addEventListener("visibilitychange", alVolverVisible);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolverVisible);
    };
  }, [mesSeleccionado]);

  const validarCuota = (valor) => {
    const numero = Number(valor);
    return valor !== "" && Number.isInteger(numero) && numero >= 0;
  };

  const altaClienteValida =
    nuevoCliente.nombre.trim().length > 0 &&
    nuevoCliente.rubro.trim().length > 0 &&
    validarCuota(nuevoCliente.cuota_reels) &&
    validarCuota(nuevoCliente.cuota_carruseles) &&
    nuevoCliente.dias_historias.length > 0 &&
    nuevoCliente.disenador_responsable &&
    nuevoCliente.abono_mensual !== "" && Number(nuevoCliente.abono_mensual) >= 0 &&
    /^\d{4}-\d{2}$/.test(nuevoCliente.vigente_desde);
  const historiasMensualesNuevoCliente = nuevoCliente.dias_historias.length > 0 && /^\d{4}-\d{2}$/.test(nuevoCliente.vigente_desde)
    ? calcularCuotaHistoriasPorDias(nuevoCliente.dias_historias, nuevoCliente.vigente_desde)
    : 0;
  const totalPiezasNuevoCliente = historiasMensualesNuevoCliente +
    (validarCuota(nuevoCliente.cuota_reels) ? Number(nuevoCliente.cuota_reels) : 0) +
    (validarCuota(nuevoCliente.cuota_carruseles) ? Number(nuevoCliente.cuota_carruseles) : 0);
  const pasoIdentidadValido = nuevoCliente.nombre.trim().length > 0 &&
    nuevoCliente.rubro.trim().length > 0 && /^\d{4}-\d{2}$/.test(nuevoCliente.vigente_desde);
  const pasoAcuerdoValido = validarCuota(nuevoCliente.cuota_reels) &&
    validarCuota(nuevoCliente.cuota_carruseles) && nuevoCliente.dias_historias.length > 0;
  const pasoResponsableValido = Boolean(nuevoCliente.disenador_responsable) &&
    nuevoCliente.abono_mensual !== "" && Number(nuevoCliente.abono_mensual) >= 0;

  const abrirAltaCliente = () => {
    setNuevoCliente(emptyClientForm());
    setPasoAltaCliente(1);
    setErrorAltaCliente(null);
    setAltaClienteAbierta(true);
  };

  const cerrarAltaCliente = () => {
    if (guardandoCliente) return;
    setAltaClienteAbierta(false);
    setErrorAltaCliente(null);
  };

  const crearCliente = (event) => {
    event.preventDefault();
    const nombre = nuevoCliente.nombre.trim();

    if (!nombre) {
      setErrorAltaCliente("El nombre del cliente es obligatorio.");
      return;
    }
    if (
      !validarCuota(nuevoCliente.cuota_reels) ||
      !validarCuota(nuevoCliente.cuota_carruseles)
    ) {
      setErrorAltaCliente("Completá ambas cuotas con números enteros iguales o mayores a 0.");
      return;
    }
    const cuota_reels = Number(nuevoCliente.cuota_reels);
    const cuota_carruseles = Number(nuevoCliente.cuota_carruseles);

    setGuardandoCliente(true);
    setErrorAltaCliente(null);
    fetch("/api/clientes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...nuevoCliente, nombre, cuota_reels, cuota_carruseles }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo crear el cliente.");
        }
        return data;
      })
      .then((cliente) => {
        setClientes((prev) => [...prev, cliente]);
        setNuevoCliente(emptyClientForm());
        setAltaClienteAbierta(false);
      })
      .catch((err) => setErrorAltaCliente(err.message))
      .finally(() => setGuardandoCliente(false));
  };

  const actualizarClienteLocal = (id, campos) => {
    setClientes((prev) =>
      prev.map((cliente) => (cliente.id === id ? { ...cliente, ...campos } : cliente)),
    );
    setClienteSeleccionado((actual) =>
      actual?.id === id ? { ...actual, ...campos } : actual,
    );
  };

  const filasTodas = useMemo(
    () => getResumenClientes(clientes, historias, publicaciones, {
      mes: mesSeleccionado,
      avanceDelMes: getAvanceMes(mesSeleccionado),
      tareas: tareasFinalizadas,
    }),
    [clientes, historias, publicaciones, tareasFinalizadas, mesSeleccionado],
  );
  const filas = useMemo(
    () => filasTodas.filter((cliente) =>
      filtroEstado === "todos" || (filtroEstado === "activos" ? cliente.activo : !cliente.activo)),
    [filasTodas, filtroEstado],
  );
  const totales = useMemo(() => getTotalesCartera(filasTodas), [filasTodas]);
  const getAlertaCliente = (cliente) => cliente.estadoGeneral.label;

  return (
    <main aria-label="Administración de clientes">
      <div className="frame">
        <div className="content clientes-page">
          <div className="clientes-command-bar">
            <div className="clientes-heading">
              <h2>¿Cómo está cada cliente este mes?</h2>
              <p>Revisá el avance acordado y detectá rápidamente qué necesita atención.</p>
            </div>
            <div className="clientes-top-actions">
              <div className="clientes-heading-meta">
                <span>{totales.clientesActivos} activos</span>
              </div>
              <label className="clientes-compact-field">
                <span>Mes</span>
                <input type="month" value={mesSeleccionado} onChange={(event) => setMesSeleccionado(event.target.value)} />
              </label>
              <label className="clientes-compact-field">
                <span>Estado</span>
                <select value={filtroEstado} onChange={(event) => setFiltroEstado(event.target.value)}>
                  <option value="activos">Activos</option>
                  <option value="inactivos">Inactivos</option>
                  <option value="todos">Todos</option>
                </select>
              </label>
              <button
                className="btn primary"
                type="button"
                onClick={abrirAltaCliente}
              >
                Agregar cliente
              </button>
            </div>
          </div>

          <div className="box clientes-table-panel">
            <div className="clientes-table-toolbar">
              <div>
                <strong>
                  {filtroEstado === "activos"
                    ? "Cartera activa"
                    : filtroEstado === "inactivos"
                      ? "Cartera inactiva"
                      : "Todos los clientes"}
                </strong>
                <span>Producción publicada, acuerdo mensual y estado del mes</span>
              </div>
            </div>

            {error && <PageState compact type="error" title={error} description="Tus datos no fueron modificados." onRetry={() => cargarClientes()} />}
            {cargando ? (
              <PageState title="Cargando clientes…" description="Conservamos el cliente y período seleccionados." />
            ) : (
              <>
              <div className="clientes-portfolio-list">
                {filas.map((cliente) => {
                  const cuotaReels = getCuotaReelsMensual(cliente);
                  const cuotaCarruseles = getCuotaCarruselesMensual(cliente);
                  const comprometidas = cuotaReels + cuotaCarruseles + cliente.cuotaHistorias;
                  const publicadas = cliente.reelsPublicados + cliente.carruselesPublicados + cliente.historiasPublicadas;
                  const progreso = calcularPorcentajeCuota(publicadas, comprometidas);
                  const pendientes = Math.max(0, comprometidas - publicadas);
                  return (
                    <article className="clientes-portfolio-row" key={cliente.id}
                      style={{ "--cliente-accent": getClienteColor(cliente.nombre) }}
                      onClick={() => setClienteSeleccionado(cliente)}>
                      <div className="clientes-portfolio-identity">
                        <span className="cliente-initial">{getClienteInicial(cliente.nombre)}</span>
                        <div><strong>{cliente.nombre}</strong><small>{cliente.rubro || "Sin rubro cargado"} · {cliente.activo ? "Activo" : "Inactivo"}</small></div>
                      </div>
                      <div className="clientes-portfolio-contract">
                        <strong>{cuotaReels} reels · {cuotaCarruseles} carruseles</strong>
                        <small>{cliente.cuotaHistorias ? `${cliente.historiasMes} planificadas de ${cliente.cuotaHistorias} contratadas` : "Historias no incluidas"}</small>
                      </div>
                      <div className="clientes-portfolio-commercial">
                        <strong>{MONEY.format(Number(cliente.abono_mensual) || 0)}</strong>
                        <small>Abono mensual</small>
                      </div>
                      <div className="clientes-portfolio-progress">
                        <strong>{publicadas} de {comprometidas} publicados</strong>
                        <span><i style={{ width: `${Math.min(progreso, 100)}%` }} /></span>
                        <small>{progreso}% del acuerdo mensual</small>
                      </div>
                      <div className="clientes-portfolio-status">
                        <strong className={cliente.estadoGeneral.color === "rojo" ? "attention" : ""}>{getAlertaCliente(cliente)}</strong>
                        <small>{pendientes ? `${pendientes} pendientes` : "Sin pendientes"}</small>
                      </div>
                      <button className="btn clientes-portfolio-action" type="button"
                        onClick={(event) => { event.stopPropagation(); setClienteSeleccionado(cliente); }}>
                        Ver detalle
                      </button>
                    </article>
                  );
                })}
                {filas.length === 0 && <div className="cliente-mobile-empty">No hay clientes con ese criterio.</div>}
              </div>
              <div className="clientes-mobile-list">
                {filas.map((cliente) => (
                  <article className="cliente-mobile-card" key={cliente.id} style={{ "--cliente-accent": getClienteColor(cliente.nombre) }}>
                    <div className="cliente-mobile-card-head">
                      <div className="cliente-mobile-identity">
                        <span className="cliente-initial">{getClienteInicial(cliente.nombre)}</span>
                        <div>
                          <strong>{cliente.nombre}</strong>
                          <small>Cliente {cliente.activo ? "activo" : "inactivo"}</small>
                        </div>
                      </div>
                      <span className={`cliente-status-pill ${cliente.estadoGeneral.color}`}>
                        <span className={`semaforo ${cliente.estadoGeneral.color}`}></span>
                        {cliente.estadoGeneral.label}
                      </span>
                    </div>
                    <div className="cliente-mobile-quotas">
                      {cliente.feedCompartido ? (
                        <>
                          <ClienteCuotaResumen
                            etiqueta={`Reels compartidos · ${cliente.grupo_feed_nombre}`}
                            publicados={cliente.reelsPublicados}
                            cuota={cliente.cuota_feed_reels}
                          />
                          <ClienteCuotaResumen
                            etiqueta={`Carruseles compartidos · ${cliente.grupo_feed_nombre}`}
                            publicados={cliente.carruselesPublicados}
                            cuota={cliente.cuota_feed_carruseles}
                          />
                        </>
                      ) : (
                        <>
                          <ClienteCuotaResumen
                            etiqueta="Reels"
                            publicados={cliente.reelsPublicados}
                            cuota={cliente.cuota_reels}
                          />
                          <ClienteCuotaResumen
                            etiqueta="Carruseles"
                            publicados={cliente.carruselesPublicados}
                            cuota={cliente.cuota_carruseles}
                          />
                        </>
                      )}
                    </div>
                    <div className="cliente-mobile-status-grid">
                      <div>
                        <span>Abono mensual</span>
                        <strong>{MONEY.format(Number(cliente.abono_mensual) || 0)}</strong>
                        <small>Facturación del cliente</small>
                      </div>
                      <div>
                        <span>Historias</span>
                        <strong>{cliente.historiasPublicadas} de {cliente.cuotaHistorias} publicadas</strong>
                        <small>{cliente.historiasMes} planificadas · {cliente.porcentajeHistorias}% del acuerdo</small>
                      </div>
                      <div>
                        <span>Próxima acción</span>
                        <strong>{getAlertaCliente(cliente)}</strong>
                        <small>
                          {cliente.cuotaHistorias === 0
                            ? "Historias no incluidas."
                            : `${Math.max(cliente.cuotaHistorias - cliente.historiasPublicadas, 0)} contratadas pendientes.`}
                        </small>
                      </div>
                    </div>
                    <div className="cliente-mobile-actions">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setClienteCuotaEnEdicion(cliente)}
                      >
                        Editar cuota
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => setClienteSeleccionado(cliente)}
                      >
                        Ver detalle
                      </button>
                    </div>
                  </article>
                ))}
                {filas.length === 0 && (
                  <div className="cliente-mobile-empty">No hay clientes con ese criterio.</div>
                )}
              </div>
              </>
            )}

            <div className="caption">
              Historias sale de la checklist: las marcadas OK cuentan como
              publicadas. Si un cliente no tiene historias planificadas, queda
              gris y no se lo castiga como incumplido.
            </div>
          </div>
        </div>
      </div>

      {altaClienteAbierta && (
        <Modal
          onClose={cerrarAltaCliente}
          title={<span>Nuevo cliente</span>}
          className="cliente-create-modal"
        >
            <form className="modal-body cliente-create-modal-body" onSubmit={crearCliente}>
              <div className="cliente-create-progress" aria-label={`Paso ${pasoAltaCliente} de 3`}>
                {["Datos", "Acuerdo", "Responsable"].map((etiqueta, index) => {
                  const numero = index + 1;
                  return (
                    <div
                      key={etiqueta}
                      className={numero === pasoAltaCliente ? "active" : numero < pasoAltaCliente ? "complete" : ""}
                      aria-current={numero === pasoAltaCliente ? "step" : undefined}
                    >
                      <span>{numero < pasoAltaCliente ? "✓" : numero}</span>
                      <small>{etiqueta}</small>
                    </div>
                  );
                })}
              </div>

              {pasoAltaCliente === 1 && <section className="cliente-create-step">
                <div className="cliente-create-step-copy">
                  <strong>¿A quién vamos a gestionar?</strong>
                  <span>Ingresá los datos básicos del cliente y desde qué mes comienza el acuerdo.</span>
                </div>
                <div className="cliente-create-modal-grid">
                <label className="cliente-service-field">
                  <span>Nombre del cliente</span>
                  <input autoFocus type="text" placeholder="Ej. RENDER Motors" value={nuevoCliente.nombre}
                    onChange={(e) => setNuevoCliente((prev) => ({ ...prev, nombre: e.target.value }))} />
                </label>
                <label className="cliente-service-field">
                  <span>Rubro</span>
                  <input list="rubros-clientes" placeholder="Ej. Gastronomía" value={nuevoCliente.rubro}
                    onChange={(e) => setNuevoCliente((prev) => ({ ...prev, rubro: e.target.value }))} />
                  <datalist id="rubros-clientes">{RUBROS.map((rubro) => <option key={rubro} value={rubro} />)}</datalist>
                </label>
                <label className="cliente-service-field">
                  <span>Configuración desde</span>
                  <input type="month" value={nuevoCliente.vigente_desde}
                    onChange={(e) => setNuevoCliente((prev) => ({ ...prev, vigente_desde: e.target.value }))} />
                </label>
                </div>
              </section>}

              {pasoAltaCliente === 2 && <section className="cliente-create-step">
                <div className="cliente-create-step-copy">
                  <strong>¿Qué incluye el acuerdo mensual?</strong>
                  <span>Definí las piezas contratadas. Si un formato no está incluido, escribí 0.</span>
                </div>
                <div className="cliente-create-modal-grid">
                <label className="cliente-service-field">
                  <span>Reels mensuales</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    placeholder="Ej. 4"
                    value={nuevoCliente.cuota_reels}
                    onChange={(e) =>
                      setNuevoCliente((prev) => ({ ...prev, cuota_reels: e.target.value }))
                    }
                  />
                  <small>Usá 0 si el acuerdo no incluye reels.</small>
                </label>
                <label className="cliente-service-field">
                  <span>Carruseles mensuales</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    placeholder="Ej. 2"
                    value={nuevoCliente.cuota_carruseles}
                    onChange={(e) =>
                      setNuevoCliente((prev) => ({ ...prev, cuota_carruseles: e.target.value }))
                    }
                  />
                  <small>Usá 0 si el acuerdo no incluye carruseles.</small>
                </label>
                </div>
                <fieldset className="cliente-weekdays">
                <legend>Días de historias</legend>
                <small>Marcá los días en los que normalmente se publican historias.</small>
                <div>{WEEKDAYS.map(([value, label]) => (
                  <label key={value} className={nuevoCliente.dias_historias.includes(value) ? "selected" : ""}>
                    <input type="checkbox" checked={nuevoCliente.dias_historias.includes(value)}
                      onChange={() => setNuevoCliente((prev) => ({
                        ...prev,
                        dias_historias: prev.dias_historias.includes(value)
                          ? prev.dias_historias.filter((day) => day !== value)
                          : [...prev.dias_historias, value],
                      }))} />
                    {label}
                  </label>
                ))}</div>
                </fieldset>
                {[['dias_reels', 'Días preferidos para reels'], ['dias_carruseles', 'Días preferidos para carruseles']].map(([field, label]) => (
                  <fieldset className="cliente-weekdays" key={field}>
                    <legend>{label}</legend>
                    <small>Opcional. Podés elegir más de un día; si lo dejás vacío se distribuye automáticamente.</small>
                    <div>{WEEKDAYS.map(([value, dayLabel]) => (
                      <label key={value} className={nuevoCliente[field].includes(value) ? "selected" : ""}>
                        <input type="checkbox" checked={nuevoCliente[field].includes(value)} onChange={() => setNuevoCliente((prev) => ({
                          ...prev,
                          [field]: prev[field].includes(value) ? prev[field].filter((day) => day !== value) : [...prev[field], value],
                        }))} />
                        {dayLabel}
                      </label>
                    ))}</div>
                  </fieldset>
                ))}
              </section>}

              {pasoAltaCliente === 3 && <section className="cliente-create-step">
                <div className="cliente-create-step-copy">
                  <strong>¿Quién lo gestiona y cuál es el abono?</strong>
                  <span>Asigná al responsable y revisá el acuerdo antes de crear el cliente.</span>
                </div>
                <div className="cliente-create-modal-grid">
                <label className="cliente-service-field">
                  <span>Diseñador responsable</span>
                  <select value={nuevoCliente.disenador_responsable}
                    onChange={(e) => setNuevoCliente((prev) => ({ ...prev, disenador_responsable: e.target.value }))}>
                    <option value="">Elegir diseñador</option>
                    <option value="Augusto">Augusto</option>
                    <option value="Mariano Mesa">Mariano Mesa</option>
                  </select>
                </label>
                <label className="cliente-service-field">
                  <span>Abono mensual</span>
                  <input min="0" step="1" type="number" placeholder="$ 0" value={nuevoCliente.abono_mensual}
                    onChange={(e) => setNuevoCliente((prev) => ({ ...prev, abono_mensual: e.target.value }))} />
                  <small>Importe fijo en pesos argentinos.</small>
                </label>
                </div>
                <div className="cliente-contract-summary">
                <span>Resumen del acuerdo</span>
                <strong>{totalPiezasNuevoCliente} piezas mensuales</strong>
                <small>
                  {historiasMensualesNuevoCliente} historias · {nuevoCliente.cuota_reels || 0} reels · {nuevoCliente.cuota_carruseles || 0} carruseles
                </small>
                <small>{nuevoCliente.disenador_responsable || "Sin diseñador"} · {Number(nuevoCliente.abono_mensual || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })}</small>
                </div>
              </section>}
              {errorAltaCliente && <div className="caption login-error">{errorAltaCliente}</div>}
              <p className="cliente-create-guidance" aria-live="polite">
                {pasoAltaCliente === 1 && !pasoIdentidadValido && "Completá el nombre y el rubro para continuar."}
                {pasoAltaCliente === 2 && !pasoAcuerdoValido && "Indicá ambas cuotas y elegí al menos un día de historias."}
                {pasoAltaCliente === 3 && !pasoResponsableValido && "Elegí un responsable e ingresá el abono mensual."}
              </p>
              <div className="modal-actions cliente-create-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoCliente}
                  onClick={() => pasoAltaCliente === 1 ? cerrarAltaCliente() : setPasoAltaCliente((paso) => paso - 1)}
                >
                  {pasoAltaCliente === 1 ? "Cancelar" : "Volver"}
                </button>
                {pasoAltaCliente < 3 ? <button
                  className="btn primary"
                  type="button"
                  disabled={pasoAltaCliente === 1 ? !pasoIdentidadValido : !pasoAcuerdoValido}
                  onClick={() => setPasoAltaCliente((paso) => paso + 1)}
                >
                  Continuar
                </button> : <button
                  className="btn primary"
                  type="submit"
                  disabled={guardandoCliente || !pasoResponsableValido || !altaClienteValida}
                >
                  {guardandoCliente ? "Creando..." : "Crear cliente"}
                </button>}
              </div>
            </form>
        </Modal>
      )}

      {clienteCuotaEnEdicion && (
        <EditarCuotaClienteModal
          cliente={clienteCuotaEnEdicion}
          onClose={() => setClienteCuotaEnEdicion(null)}
          onGuardado={(clienteActualizado) => {
            actualizarClienteLocal(clienteActualizado.id, clienteActualizado);
            setClienteCuotaEnEdicion(null);
          }}
        />
      )}

      {clienteSeleccionado && (
        <DetalleClienteModal
          cliente={clienteSeleccionado}
          historias={historias.filter(
            (historia) => historia.cliente_id === clienteSeleccionado.id && esDelMes(historia.fecha_programada, mesSeleccionado),
          )}
          publicaciones={getPublicacionesDelMismoFeed(
            clienteSeleccionado,
            clientes,
            publicaciones,
          ).filter((publicacion) => esDelMes(publicacion.fecha_programada, mesSeleccionado))}
          onClose={() => setClienteSeleccionado(null)}
          onCuotaActualizada={cargarClientes}
          onClienteActualizado={(clienteActualizado) => actualizarClienteLocal(clienteActualizado.id, clienteActualizado)}
          onClienteEliminado={(id) => {
            setClientes((prev) => prev.filter((cliente) => cliente.id !== id));
            setClienteSeleccionado(null);
          }}
        />
      )}
    </main>
  );
}
