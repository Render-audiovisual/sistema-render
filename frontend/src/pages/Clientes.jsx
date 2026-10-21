import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMesActualISO, getSesion } from "../utils.jsx";
import { useScopedRequest } from "../shared/session/use-scoped-request.js";
import { isSessionFailure } from "../shared/session/captured-request.js";
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
import { createClientOverviewLoader } from "./clientOverview.js";
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { CLIENT_CREATE_MODES, createClientCreation, hasNoConfiguredMonthlyAgreement } from './clientCreate.js';
import './ClientesCreate.css';

const CLIENT_COLORS = ["#547aa5", "#6f72a8", "#4f8a7a", "#a36d5d", "#8a6fa5", "#647c99"];
const RUBROS = ["Gastronomía", "Tecnología", "Turismo", "Educación", "Automotor", "Comercio", "Salud", "Servicios"];
const WEEKDAYS = [
  [1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"],
];
const MONEY = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function emptyClientForm() {
  return {
    creation_mode: 'editorial',
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
          <small>{publicados} confirmados · {cuotaNumero - Math.min(publicados, cuotaNumero)} sin confirmar</small>
        </>
      )}
      {cuotaNumero === 0 && <small>Este formato no forma parte del acuerdo mensual.</small>}
    </div>
  );
}

function clientPeriod(search) {
  const values = new URLSearchParams(search).getAll('periodo');
  if (!values.length) return getMesISO();
  if (values.length !== 1 || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(values[0])) throw new Error('Elegí un mes válido para consultar clientes.');
  return values[0];
}
export function ClientesAdminPage({ sesion }) {
  const { view } = useScopedRequest(sesion || getSesion(), 'client-admin');
  const identity = useRef({ view, epoch: 0 });
  if (identity.current.view !== view) identity.current = { view, epoch: identity.current.epoch + 1 };
  if (view.role !== 'admin') return <PageState type="error" title="Acceso reservado a administración" />;
  return <ClientesAdminContent key={identity.current.epoch} sesion={view.session} />;
}

function ClientesAdminContent({ sesion }) {
  const initialPeriod = useRef(null);
  if (!initialPeriod.current) { try { initialPeriod.current = { period: clientPeriod(window.location.search), error: null }; } catch (reason) { initialPeriod.current = { period: getMesISO(), error: reason.message }; } }
  const [initialClientId] = useState(
    () => Number(readUrlContext(window.location.search, { cliente: "" }).cliente) || null,
  );
  const [contextRestored, setContextRestored] = useState(false);
  const [clientes, setClientes] = useState([]);
  const [historias, setHistorias] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [loadedPeriod, setLoadedPeriod] = useState(null);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [nuevoCliente, setNuevoCliente] = useState(emptyClientForm);
  const [mesSeleccionado, setMesSeleccionado] = useState(initialPeriod.current.period);
  const [periodError, setPeriodError] = useState(initialPeriod.current.error);
  const { view, capture, captureLifetime, epoch } = useScopedRequest(sesion, mesSeleccionado);
  const overviewLoader = useMemo(() => createClientOverviewLoader(capture), [capture]);
  const [filtroEstado, setFiltroEstado] = useState("activos");
  const [guardandoCliente, setGuardandoCliente] = useState(false);
  const [altaClienteAbierta, setAltaClienteAbierta] = useState(false);
  const [pasoAltaCliente, setPasoAltaCliente] = useState(1);
  const [clienteCuotaEnEdicion, setClienteCuotaEnEdicion] = useState(null);
  const [errorAltaCliente, setErrorAltaCliente] = useState(null);
  const createRecovery = useRef(null);
  const [createStatus, setCreateStatus] = useState({ busy: false, blocked: false });
  const [creationDenied, setCreationDenied] = useState(false);
  const basicCreation = nuevoCliente.creation_mode === 'basic';
  const modalOpen = useRef(false), deferredLoad = useRef(false), pendingPeriod = useRef(null), loadGeneration = useRef(0), loaded = useRef(false), creating = useRef(false), denied = useRef(false);
  const createBaseline = useRef(JSON.stringify(nuevoCliente));
  const clientCreateNavigationStatus = () => {
    if (!capture().current() || denied.current) return { dirty: false, busy: false };
    return { dirty: altaClienteAbierta && (JSON.stringify(nuevoCliente) !== createBaseline.current || Boolean(createRecovery.current?.snapshot.blocked)), busy: creating.current };
  };
  useNavigationGuard(clientCreateNavigationStatus);
  modalOpen.current = Boolean(altaClienteAbierta || clienteSeleccionado || clienteCuotaEnEdicion);
  const closeModal = () => {
    modalOpen.current = false;
    if (pendingPeriod.current) {
      const next = pendingPeriod.current; pendingPeriod.current = null;
      if (next.period !== mesSeleccionado || next.error !== periodError) deferredLoad.current = false;
      setMesSeleccionado(next.period); setPeriodError(next.error);
    }
  };
  const selectClient = client => { if (!capture().current() || modalOpen.current || loadedPeriod !== mesSeleccionado) return; modalOpen.current = true; setClienteSeleccionado(client); };

  // silencioso=true (polling / vuelta a la pestaña) no muestra el spinner de
  // carga para no interrumpir a quien está mirando la tabla — solo actualiza
  // los números por detrás. La primera carga y el guardado explícito de una
  // cuota sí lo muestran.
  const cargarClientes = useCallback(async ({ silencioso = false } = {}) => {
    if (modalOpen.current) { deferredLoad.current = true; return; }
    const scope = capture(); if (!scope.current() || denied.current) return;
    if (periodError) { setError(periodError); setCargando(false); return; }
    const generation = ++loadGeneration.current;
    if (!silencioso) setCargando(true);
    setError(null);
    try {
        const data = await overviewLoader.load(mesSeleccionado);
        if (!data || !scope.current() || generation !== loadGeneration.current) return;
        if (modalOpen.current) { deferredLoad.current = true; return; }
        loaded.current = true;
        setLoadedPeriod(mesSeleccionado);
        setClientes(data.clientes);
        setHistorias(data.historias);
        setPublicaciones(data.publicaciones);
    } catch (err) {
        if (!scope.current() || generation !== loadGeneration.current) return;
        if (isSessionFailure(err) || [401,403].includes(err?.status)) denied.current = true;
        if (scope.current() && generation === loadGeneration.current && !modalOpen.current && !isSessionFailure(err)) setError("No se pudo cargar el tablero de clientes.");
    } finally { if (scope.current() && generation === loadGeneration.current) setCargando(false); }
  }, [capture, overviewLoader, mesSeleccionado, periodError]);

  useEffect(() => {
    const pop = () => {
      let next; try { next = { period: clientPeriod(window.location.search), error: null }; } catch (reason) { next = { period: mesSeleccionado, error: reason.message }; }
      if (modalOpen.current) {
        pendingPeriod.current = next;
        const params = new URLSearchParams(window.location.search); params.set('periodo', mesSeleccionado);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}${window.location.hash}`);
        return;
      }
      setMesSeleccionado(next.period); setPeriodError(next.error);
    };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [mesSeleccionado]);

  useEffect(() => {
    if (periodError) return;
    const params = new URLSearchParams(window.location.search); params.set('periodo', mesSeleccionado);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}${window.location.hash}`);
  }, [mesSeleccionado, periodError]);

  useEffect(() => {
    if (modalOpen.current || !deferredLoad.current) return;
    deferredLoad.current = false; cargarClientes();
  }, [altaClienteAbierta, clienteSeleccionado, clienteCuotaEnEdicion, cargarClientes]);

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
    loaded.current = false;
    cargarClientes();
    const update = () => { if (loaded.current) cargarClientes({ silencioso: true }); };
    const intervalo = setInterval(update, 30000);
    const alVolverVisible = () => {
      if (document.visibilityState === "visible") {
        update();
      }
    };
    document.addEventListener("visibilitychange", alVolverVisible);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolverVisible);
      loadGeneration.current += 1; overviewLoader.cancel();
    };
  }, [cargarClientes, overviewLoader]);

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
    if (!capture().current() || modalOpen.current || denied.current) return;
    modalOpen.current = true;
    const blank = emptyClientForm();
    createRecovery.current = null; setCreateStatus({ busy: false, blocked: false });
    createBaseline.current = JSON.stringify(blank);
    setNuevoCliente(blank);
    setPasoAltaCliente(1);
    setErrorAltaCliente(null);
    setAltaClienteAbierta(true);
  };

  const cerrarAltaCliente = () => {
    if (creating.current || !capture().current()) return;
    const blocked = createRecovery.current?.snapshot.blocked;
    if ((JSON.stringify(nuevoCliente) !== createBaseline.current || blocked) && !window.confirm(blocked
      ? 'El alta no está confirmada. Al salir se pierde la revisión de este intento; revisá la cartera antes de crear otro cliente. ¿Salir de todos modos?'
      : '¿Descartar los datos del nuevo cliente sin guardar?')) return;
    setAltaClienteAbierta(false);
    setErrorAltaCliente(null);
    closeModal();
  };

  const denyCreationAccess = () => {
    denied.current = true; loaded.current = false;
    loadGeneration.current += 1; overviewLoader.cancel(); modalOpen.current = false;
    createRecovery.current = null;
    const blank = emptyClientForm(); createBaseline.current = JSON.stringify(blank);
    setNuevoCliente(blank); setClientes([]); setHistorias([]); setPublicaciones([]);
    setClienteSeleccionado(null); setClienteCuotaEnEdicion(null);
    setAltaClienteAbierta(false); setErrorAltaCliente(null);
    setCreateStatus({ busy: false, blocked: false }); setCreationDenied(true);
  };
  const denyClientAccess = guard => {
    if (!guard?.current() || !capture().current()) return;
    guard.assertCurrent(); denyCreationAccess();
  };

  const crearCliente = async (event) => {
    event.preventDefault();
    if (denied.current || creating.current || createRecovery.current?.snapshot.submitted) return;
    const scope = capture(), lifetime = captureLifetime();
    if (!scope.current() || view.role !== 'admin') return;
    const nombre = nuevoCliente.nombre.trim();

    if (!nombre) {
      setErrorAltaCliente("El nombre del cliente es obligatorio.");
      return;
    }
    if (!basicCreation && (
      !validarCuota(nuevoCliente.cuota_reels) ||
      !validarCuota(nuevoCliente.cuota_carruseles)
    )) {
      setErrorAltaCliente("Completá ambas cuotas con números enteros iguales o mayores a 0.");
      return;
    }
    if (!basicCreation && !altaClienteValida) { setErrorAltaCliente('Revisá todos los datos del acuerdo antes de crear el cliente.'); return; }
    if (!createRecovery.current) createRecovery.current = createClientCreation({ capture: () => scope });
    creating.current = true;
    setGuardandoCliente(true);
    setErrorAltaCliente(null);
    try {
      const cliente = await createRecovery.current.submit(nuevoCliente, basicCreation ? 'basic' : 'editorial');
        scope.assertCurrent();
        setClientes((prev) => [...prev.filter(item => item.id !== cliente.id), cliente]);
        setNuevoCliente(emptyClientForm());
        setAltaClienteAbierta(false);
        closeModal(); deferredLoad.current = true;
    } catch (err) {
      if (scope.current() && [401,403].includes(err?.status)) denyCreationAccess();
      else if (scope.current() && !isSessionFailure(err)) {
        const status = createRecovery.current.snapshot; setCreateStatus(status);
        setErrorAltaCliente(status.rejection || 'No se pudo confirmar el alta. Conservamos los datos; revisá la cartera antes de volver a crear el cliente.');
      }
    }
    finally { creating.current = false; if (lifetime.current()) setGuardandoCliente(false); }
  };

  const refreshCreationPortfolio = async () => {
    if (denied.current || creating.current || !createRecovery.current?.snapshot.blocked) return;
    const scope = capture(), lifetime = captureLifetime(); if (!scope.current()) return;
    creating.current = true; setGuardandoCliente(true);
    try {
      const rows = await createRecovery.current.refresh(mesSeleccionado); scope.assertCurrent();
      setClientes(rows);
      setErrorAltaCliente('Cartera actualizada. Encontrar un nombre no confirma este intento. No repetiremos el alta; revisá los clientes guardados antes de salir.');
    } catch (err) {
      if (scope.current() && [401,403].includes(err?.status)) denyCreationAccess();
      else if (scope.current() && !isSessionFailure(err)) setErrorAltaCliente('No pudimos actualizar la cartera. El alta sigue sin confirmar y no se volvió a enviar.');
    }
    finally { creating.current = false; if (lifetime.current()) setGuardandoCliente(false); }
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
    () => loadedPeriod !== mesSeleccionado ? [] : getResumenClientes(clientes, historias, publicaciones, {
      mes: mesSeleccionado,
      avanceDelMes: getAvanceMes(mesSeleccionado),
    }),
    [clientes, historias, publicaciones, mesSeleccionado, loadedPeriod],
  );
  useEffect(() => {
    if (contextRestored || loadedPeriod !== mesSeleccionado || filasTodas.length === 0 || modalOpen.current) return;
    if (initialClientId) {
      const requestedClient = filasTodas.find((client) => client.id === initialClientId);
      if (requestedClient) selectClient(requestedClient);
    }
    setContextRestored(true);
  }, [filasTodas, contextRestored, initialClientId, loadedPeriod, mesSeleccionado]);

  const filas = useMemo(
    () => filasTodas.filter((cliente) =>
      filtroEstado === "todos" || (filtroEstado === "activos" ? cliente.activo : !cliente.activo)),
    [filasTodas, filtroEstado],
  );
  const totales = useMemo(() => getTotalesCartera(filasTodas), [filasTodas]);
  const getAlertaCliente = (cliente) => hasNoConfiguredMonthlyAgreement(cliente) ? 'Sin acuerdo mensual configurado' : cliente.totalSinConfirmacion > 0
    ? "Revisar registros sin confirmar" : cliente.estadoGeneral.label;

  if (creationDenied) return <main aria-label="Administración de clientes"><PageState type="error" title="Ya no tenés acceso a la administración de clientes" description="Se retiraron los datos de esta vista. Revisá tu acceso antes de continuar." /></main>;

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
              <a className="btn" href={`/clientes?periodo=${mesSeleccionado}`}>Ver objetivos mensuales</a>
              <div className="clientes-heading-meta">
                <span>{totales.clientesActivos} activos</span>
              </div>
              <label className="clientes-compact-field">
                <span>Mes</span>
                <input type="month" value={mesSeleccionado} disabled={Boolean(altaClienteAbierta || clienteSeleccionado || clienteCuotaEnEdicion)} onChange={(event) => { if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) { setMesSeleccionado(event.target.value); setPeriodError(null); } }} />
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
                <span>Publicaciones confirmadas del mes planificado y acuerdo mensual</span>
              </div>
            </div>

            {error && <PageState compact type="error" title={error} description="Tus datos no fueron modificados." onRetry={() => cargarClientes()} />}
            {!cargando && !error && <p className="caption" role="note" aria-label="Cobertura de publicaciones">
              {totales.piezasPublicadas} confirmadas manualmente del mes planificado · {totales.piezasPublicadasEnMesReal ?? 0} con publicación real en este mes · {totales.totalSinConfirmacion ?? 0} registros históricos sin confirmación.
            </p>}
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
                      onClick={() => selectClient(cliente)}>
                      <div className="clientes-portfolio-identity">
                        <span className="cliente-initial">{getClienteInicial(cliente.nombre)}</span>
                        <div><strong>{cliente.nombre}</strong><small>{cliente.rubro || "Sin rubro cargado"} · {cliente.activo ? "Activo" : "Inactivo"}</small></div>
                      </div>
                      <div className="clientes-portfolio-contract">
                        <strong>{hasNoConfiguredMonthlyAgreement(cliente) ? 'Sin acuerdo mensual configurado' : `${cuotaReels} reels · ${cuotaCarruseles} carruseles`}</strong>
                        <small>{hasNoConfiguredMonthlyAgreement(cliente) ? 'Cliente disponible para el equipo' : cliente.cuotaHistorias ? `${cliente.historiasMes} planificadas de ${cliente.cuotaHistorias} contratadas` : "Historias no incluidas"}</small>
                      </div>
                      <div className="clientes-portfolio-commercial">
                        <strong>{cliente.abono_mensual == null ? 'Sin abono configurado' : MONEY.format(Number(cliente.abono_mensual))}</strong>
                        <small>Abono mensual</small>
                      </div>
                      <div className="clientes-portfolio-progress">
                        {hasNoConfiguredMonthlyAgreement(cliente) ? <strong>Sin cuota mensual</strong> : <>
                        <strong>{publicadas} de {comprometidas} confirmados</strong>
                        {cliente.totalSinConfirmacion > 0 && <small>{cliente.totalSinConfirmacion} registros históricos sin confirmar</small>}
                        <span><i style={{ width: `${Math.min(progreso, 100)}%` }} /></span>
                        <small>{progreso}% del acuerdo mensual</small>
                        </>}
                      </div>
                      <div className="clientes-portfolio-status">
                        <strong className={cliente.estadoGeneral.color === "rojo" ? "attention" : ""}>{getAlertaCliente(cliente)}</strong>
                        <small>{hasNoConfiguredMonthlyAgreement(cliente) ? 'Sin seguimiento de cuota editorial' : pendientes ? `${pendientes} sin confirmación` : "Acuerdo con confirmación completa"}</small>
                      </div>
                      <button className="btn clientes-portfolio-action" type="button"
                        onClick={(event) => { event.stopPropagation(); selectClient(cliente); }}>
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
                        {hasNoConfiguredMonthlyAgreement(cliente) ? 'Sin acuerdo mensual configurado' : cliente.estadoGeneral.label}
                      </span>
                    </div>
                    {!hasNoConfiguredMonthlyAgreement(cliente) && <div className="cliente-mobile-quotas">
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
                    </div>}
                    <div className="cliente-mobile-status-grid">
                      <div>
                        <span>Abono mensual</span>
                        <strong>{cliente.abono_mensual == null ? 'Sin abono configurado' : MONEY.format(Number(cliente.abono_mensual))}</strong>
                        <small>Facturación del cliente</small>
                      </div>
                      <div>
                        <span>Historias</span>
                        <strong>{hasNoConfiguredMonthlyAgreement(cliente) ? 'Sin cuota mensual' : `${cliente.historiasPublicadas} de ${cliente.cuotaHistorias} confirmadas`}</strong>
                        {!hasNoConfiguredMonthlyAgreement(cliente) && <small>{cliente.historiasMes} planificadas · {cliente.porcentajeHistorias}% del acuerdo</small>}
                      </div>
                      <div>
                        <span>Próxima acción</span>
                        <strong>{getAlertaCliente(cliente)}</strong>
                        <small>
                          {hasNoConfiguredMonthlyAgreement(cliente) ? 'Sin seguimiento mensual configurado.' : cliente.cuotaHistorias === 0
                            ? "Historias no incluidas."
                            : `${Math.max(cliente.cuotaHistorias - cliente.historiasPublicadas, 0)} contratadas sin confirmar.`}
                        </small>
                      </div>
                    </div>
                    <div className="cliente-mobile-actions">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setClienteCuotaEnEdicion(cliente)}
                      >
                        {hasNoConfiguredMonthlyAgreement(cliente) ? 'Editar nombre y estado' : 'Editar cuota'}
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => selectClient(cliente)}
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
              El acuerdo usa confirmaciones manuales de piezas planificadas para este mes.
              La fecha real se cuenta aparte, en horario de Córdoba. Los registros históricos
              sin confirmación no prueban que el contenido siga pendiente: requieren revisión.
              Finalizar una tarea o marcar una checklist no confirma una publicación.
            </div>
          </div>
        </div>
      </div>

      {altaClienteAbierta && (
        <Modal
          key={`${epoch}:${mesSeleccionado}:create`}
          onClose={cerrarAltaCliente}
          title={<span>Nuevo cliente</span>}
          className="cliente-create-modal"
        >
            <form className="modal-body cliente-create-modal-body" onSubmit={crearCliente}>
              <fieldset disabled={guardandoCliente || createStatus.blocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <label className="cliente-service-field cliente-create-mode">
                <span>Cómo querés crear el cliente</span>
                <select value={nuevoCliente.creation_mode || 'editorial'} onChange={event => {
                  if (creating.current || createRecovery.current?.snapshot.submitted) return;
                  setNuevoCliente(prev => ({ ...prev, creation_mode: event.target.value })); setPasoAltaCliente(1);
                }}>
                  {CLIENT_CREATE_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                </select>
              </label>
              {!basicCreation && <div className="cliente-create-progress" aria-label={`Paso ${pasoAltaCliente} de 3`}>
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
              </div>}

              {basicCreation && <section className="cliente-create-step">
                <div className="cliente-create-step-copy">
                  <strong>Creá el cliente sin un acuerdo mensual</strong>
                  <span>Para trabajar sin configurar cuotas ni abono. No se crean proyectos ni tareas automáticamente.</span>
                </div>
                <label className="cliente-service-field"><span>Nombre del cliente</span>
                  <input autoFocus type="text" value={nuevoCliente.nombre} placeholder="Nombre del cliente"
                    onChange={event => setNuevoCliente(prev => ({ ...prev, nombre: event.target.value }))} />
                </label>
              </section>}

              {!basicCreation && pasoAltaCliente === 1 && <section className="cliente-create-step">
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

              {!basicCreation && pasoAltaCliente === 2 && <section className="cliente-create-step">
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

              {!basicCreation && pasoAltaCliente === 3 && <section className="cliente-create-step">
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
                    <option value="Mariano Meza">Mariano Meza</option>
                  </select>
                </label>
                <label className="cliente-service-field">
                  <span>Abono mensual</span>
                  <input min="0" step="0.01" type="number" placeholder="$ 0" value={nuevoCliente.abono_mensual}
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
                <small>{nuevoCliente.disenador_responsable || "Sin diseñador"} · {Number(nuevoCliente.abono_mensual || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small>
                </div>
              </section>}
              {!basicCreation && <p className="cliente-create-guidance" aria-live="polite">
                {pasoAltaCliente === 1 && !pasoIdentidadValido && "Completá el nombre y el rubro para continuar."}
                {pasoAltaCliente === 2 && !pasoAcuerdoValido && "Indicá ambas cuotas y elegí al menos un día de historias."}
                {pasoAltaCliente === 3 && !pasoResponsableValido && "Elegí un responsable e ingresá el abono mensual."}
              </p>}
              <div className="modal-actions cliente-create-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoCliente}
                  onClick={() => pasoAltaCliente === 1 ? cerrarAltaCliente() : setPasoAltaCliente((paso) => paso - 1)}
                >
                  {pasoAltaCliente === 1 ? "Cancelar" : "Volver"}
                </button>
                {!basicCreation && pasoAltaCliente < 3 ? <button
                  className="btn primary"
                  type="button"
                  disabled={pasoAltaCliente === 1 ? !pasoIdentidadValido : !pasoAcuerdoValido}
                  onClick={() => setPasoAltaCliente((paso) => paso + 1)}
                >
                  Continuar
                </button> : <button
                  className="btn primary"
                  type="submit"
                  disabled={guardandoCliente || (basicCreation ? !nuevoCliente.nombre.trim() : !pasoResponsableValido || !altaClienteValida)}
                >
                  {guardandoCliente ? "Creando..." : "Crear cliente"}
                </button>}
              </div>
              </fieldset>
              {errorAltaCliente && <div className="caption login-error" role="alert">{errorAltaCliente}</div>}
              {createStatus.blocked && <section className="cliente-create-recovery" aria-label="Revisión del alta sin confirmar">
                <p>No volveremos a enviar este intento. Al salir se pierde esta revisión; comprobá la cartera antes de crear otro cliente.</p>
                <div>
                  <button type="button" className="btn" disabled={guardandoCliente} onClick={refreshCreationPortfolio}>Actualizar cartera sin crear</button>
                  <button type="button" className="btn" disabled={guardandoCliente} onClick={cerrarAltaCliente}>Salir y revisar cartera</button>
                </div>
              </section>}
            </form>
        </Modal>
      )}

      {clienteCuotaEnEdicion && (
        <EditarCuotaClienteModal
          key={`${epoch}:${mesSeleccionado}:${clienteCuotaEnEdicion.id}`}
          sesion={view.session}
          periodo={mesSeleccionado}
          cliente={clienteCuotaEnEdicion}
          onAccessDenied={denyClientAccess}
          onClose={() => { setClienteCuotaEnEdicion(null); closeModal(); }}
          onGuardado={(clienteActualizado) => {
            actualizarClienteLocal(clienteActualizado.id, clienteActualizado);
            setClienteCuotaEnEdicion(null); closeModal();
          }}
        />
      )}

      {clienteSeleccionado && (
        <DetalleClienteModal
          key={`${epoch}:${mesSeleccionado}:${clienteSeleccionado.id}`}
          sesion={view.session}
          periodo={mesSeleccionado}
          cliente={clienteSeleccionado}
          onAccessDenied={denyClientAccess}
          historias={historias.filter(
            (historia) => historia.cliente_id === clienteSeleccionado.id && esDelMes(historia.fecha_programada, mesSeleccionado),
          )}
          publicaciones={getPublicacionesDelMismoFeed(
            clienteSeleccionado,
            clientes,
            publicaciones,
          ).filter((publicacion) => esDelMes(publicacion.fecha_programada, mesSeleccionado))}
          onClose={() => { setClienteSeleccionado(null); closeModal(); }}
          onCuotaActualizada={cargarClientes}
          onClienteActualizado={(clienteActualizado) => actualizarClienteLocal(clienteActualizado.id, clienteActualizado)}
          onClienteEliminado={(id) => {
            setClientes((prev) => prev.filter((cliente) => cliente.id !== id));
            setClienteSeleccionado(null); closeModal();
          }}
        />
      )}
    </main>
  );
}
