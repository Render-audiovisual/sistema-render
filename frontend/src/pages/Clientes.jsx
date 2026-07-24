import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { calcularPorcentajeCuota, getClaveFeed, getCuotaCarruselesMensual, getCuotaReelsMensual, getMesActualISO, getPublicacionesDelMismoFeed, getResumenClientesActivos } from "../utils.jsx";
import { EditarCuotaClienteModal, DetalleClienteModal } from "../components/ClienteModals.jsx";

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
  const [clientes, setClientes] = useState([]);
  const [historias, setHistorias] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [nuevoCliente, setNuevoCliente] = useState({
    nombre: "",
    cuota_reels: "",
    cuota_carruseles: "",
  });
  const [guardandoCliente, setGuardandoCliente] = useState(false);
  const [clienteDrafts, setClienteDrafts] = useState({});
  const [altaClienteAbierta, setAltaClienteAbierta] = useState(false);
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
      fetch("/api/clientes").then((response) => response.json()),
      fetch("/api/historias").then((response) => response.json()),
      fetch("/api/publicaciones").then((response) => response.json()),
    ])
      .then(([clientesApi, historiasApi, publicacionesApi]) => {
        setClientes(clientesApi);
        setHistorias(historiasApi);
        setPublicaciones(publicacionesApi);
      })
      .catch((err) => {
        console.error("No se pudo cargar el tablero de clientes", err);
        setError("No se pudo cargar el tablero de clientes.");
      })
      .finally(() => {
        if (!silencioso) setCargando(false);
      });
  };

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
  }, []);

  const validarCuota = (valor) => {
    const numero = Number(valor);
    return valor !== "" && Number.isInteger(numero) && numero >= 0;
  };

  const altaClienteValida =
    nuevoCliente.nombre.trim().length > 0 &&
    validarCuota(nuevoCliente.cuota_reels) &&
    validarCuota(nuevoCliente.cuota_carruseles);
  const totalPiezasNuevoCliente = altaClienteValida
    ? Number(nuevoCliente.cuota_reels) + Number(nuevoCliente.cuota_carruseles)
    : 0;

  const abrirAltaCliente = () => {
    setNuevoCliente({ nombre: "", cuota_reels: "", cuota_carruseles: "" });
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
      body: JSON.stringify({ nombre, cuota_reels, cuota_carruseles }),
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
        setNuevoCliente({ nombre: "", cuota_reels: "", cuota_carruseles: "" });
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

  const actualizarDraftCliente = (id, campo, valor) => {
    setClienteDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [campo]: valor,
      },
    }));
  };

  const limpiarDraftCliente = (id, campos) => {
    setClienteDrafts((prev) => {
      if (!prev[id]) return prev;
      const siguienteDraft = { ...prev[id] };
      campos.forEach((campo) => delete siguienteDraft[campo]);
      if (Object.keys(siguienteDraft).length === 0) {
        const { [id]: _omitido, ...resto } = prev;
        return resto;
      }
      return { ...prev, [id]: siguienteDraft };
    });
  };

  const valorClienteEditable = (cliente, campo) =>
    clienteDrafts[cliente.id]?.[campo] ?? cliente[campo] ?? "";

  const guardarCliente = (id, campos) => {
    const payload = { ...campos };
    if (Object.prototype.hasOwnProperty.call(payload, "nombre")) {
      payload.nombre = payload.nombre.trim();
      if (!payload.nombre) {
        setError("El nombre del cliente no puede quedar vacío.");
        cargarClientes({ silencioso: true });
        return;
      }
    }
    for (const key of ["cuota_reels", "cuota_carruseles"]) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        const numero = Number(payload[key]);
        if (!validarCuota(numero)) {
          setError("Las cuotas deben ser números enteros ≥ 0.");
          cargarClientes({ silencioso: true });
          return;
        }
        payload[key] = numero;
      }
    }

    setError(null);
    fetch(`/api/clientes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo guardar el cliente.");
        }
        return data;
      })
      .then((cliente) => {
        actualizarClienteLocal(id, cliente);
        limpiarDraftCliente(id, Object.keys(payload));
      })
      .catch((err) => {
        setError(err.message);
        cargarClientes({ silencioso: true });
        limpiarDraftCliente(id, Object.keys(payload));
      });
  };

  const filas = getResumenClientesActivos(clientes, historias, publicaciones);
  const totalHistorias = filas.reduce(
    (sum, cliente) => sum + cliente.historiasMes,
    0,
  );
  const totalHistoriasPublicadas = filas.reduce(
    (sum, cliente) => sum + cliente.historiasPublicadas,
    0,
  );
  const clavesFeedContadas = new Set();
  const filasFeedUnicas = filas.filter((cliente) => {
    const clave = getClaveFeed(cliente);
    if (clavesFeedContadas.has(clave)) return false;
    clavesFeedContadas.add(clave);
    return true;
  });
  const totalReelsPublicados = filasFeedUnicas.reduce((sum, cliente) => sum + cliente.reelsPublicados, 0);
  const totalCarruselesPublicados = filasFeedUnicas.reduce(
    (sum, cliente) => sum + cliente.carruselesPublicados,
    0,
  );
  const totalCuotaReels = filasFeedUnicas.reduce(
    (sum, cliente) => sum + getCuotaReelsMensual(cliente),
    0,
  );
  const totalCuotaCarruseles = filasFeedUnicas.reduce(
    (sum, cliente) => sum + getCuotaCarruselesMensual(cliente),
    0,
  );
  const totalPiezasPublicadas =
    totalHistoriasPublicadas + totalReelsPublicados + totalCarruselesPublicados;
  const totalPiezasComprometidas =
    totalHistorias + totalCuotaReels + totalCuotaCarruseles;
  const avanceHistorias = calcularPorcentajeCuota(
    totalHistoriasPublicadas,
    totalHistorias,
  );
  const avanceReels = calcularPorcentajeCuota(
    totalReelsPublicados,
    totalCuotaReels,
  );
  const avanceCarruseles = calcularPorcentajeCuota(
    totalCarruselesPublicados,
    totalCuotaCarruseles,
  );
  const avanceTotal = calcularPorcentajeCuota(
    totalPiezasPublicadas,
    totalPiezasComprometidas,
  );
  const getAlertaCliente = (cliente) => {
    if (cliente.estadoHistorias.color === "rojo") return "Necesita seguimiento";
    if (cliente.estadoHistorias.color === "amarillo") return "Revisar ritmo";
    if (cliente.historiasMes === 0) return "Sin planificación de historias";
    return "Al día";
  };

  return (
    <main aria-label="Administración de clientes">
      <div className="frame">
        <div className="content clientes-page">
          <div className="clientes-command-bar">
            <div className="clientes-heading">
              <div className="section-label">Clientes — {getMesActualISO()}</div>
              <h2>Control mensual de cartera</h2>
            </div>
            <div className="clientes-top-actions">
              <div className="clientes-heading-meta">
                <span>{filas.length} activos</span>
              </div>
              <button
                className="btn primary"
                type="button"
                onClick={abrirAltaCliente}
              >
                Agregar cliente
              </button>
            </div>
          </div>

          <div className="clientes-metrics">
            <div className="cliente-metric">
              <span>Historias</span>
              <strong>{avanceHistorias}%</strong>
              <small>{totalHistoriasPublicadas} / {totalHistorias} publicadas</small>
            </div>
            <div className="cliente-metric">
              <span>Reels</span>
              <strong>{avanceReels}%</strong>
              <small>{totalReelsPublicados} / {totalCuotaReels} publicados</small>
            </div>
            <div className="cliente-metric">
              <span>Carruseles</span>
              <strong>{avanceCarruseles}%</strong>
              <small>{totalCarruselesPublicados} / {totalCuotaCarruseles} publicados</small>
            </div>
            <div className="cliente-metric">
              <span>Total</span>
              <strong>{avanceTotal}%</strong>
              <small>{totalPiezasPublicadas} / {totalPiezasComprometidas} piezas del mes</small>
            </div>
          </div>

          <div className="box clientes-table-panel">
            <div className="clientes-table-toolbar">
              <div>
                <strong>Cartera activa</strong>
                <span>Producción publicada, acuerdo mensual y estado del mes</span>
              </div>
            </div>

            {error && <div className="caption login-error">{error}</div>}
            {cargando ? (
              <div style={{ padding: "24px", textAlign: "center", color: "#999" }}>
                Cargando clientes...
              </div>
            ) : (
              <>
              <div className="clientes-desktop-table-wrap">
                <table className="clientes-admin-table">
                  <thead>
                    <tr>
                      <th>Estado</th>
                      <th>Cliente</th>
                      <th>Reels / mes</th>
                      <th>Carruseles / mes</th>
                      <th>Historias</th>
                      <th>Próxima acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((cliente) => (
                      <tr
                        className="row-clickable"
                        key={cliente.id}
                        onClick={() => setClienteSeleccionado(cliente)}
                      >
                        <td>
                          <span className={`cliente-status-pill ${cliente.estadoHistorias.color}`}>
                            <span className={`semaforo ${cliente.estadoHistorias.color}`}></span>
                            {cliente.estadoHistorias.label}
                          </span>
                        </td>
                        <td>
                          <input
                            className="cliente-inline-input cliente-name-input"
                            onBlur={(e) => guardarCliente(cliente.id, { nombre: e.target.value })}
                            onChange={(e) =>
                              actualizarDraftCliente(cliente.id, "nombre", e.target.value)
                            }
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            value={valorClienteEditable(cliente, "nombre")}
                          />
                          <div className="caption">Activo</div>
                        </td>
                        {cliente.feedCompartido ? (
                          <>
                          <td>
                            <ClienteCuotaResumen
                              etiqueta={`Reels compartidos · ${cliente.grupo_feed_nombre}`}
                              publicados={cliente.reelsPublicados}
                              cuota={cliente.cuota_feed_reels}
                            />
                          </td>
                          <td>
                            <ClienteCuotaResumen
                              etiqueta={`Carruseles compartidos · ${cliente.grupo_feed_nombre}`}
                              publicados={cliente.carruselesPublicados}
                              cuota={cliente.cuota_feed_carruseles}
                            />
                          </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <ClienteCuotaResumen
                                etiqueta="Reels"
                                publicados={cliente.reelsPublicados}
                                cuota={cliente.cuota_reels}
                              />
                            </td>
                            <td>
                              <ClienteCuotaResumen
                                etiqueta="Carruseles"
                                publicados={cliente.carruselesPublicados}
                                cuota={cliente.cuota_carruseles}
                              />
                            </td>
                          </>
                        )}
                        <td>
                          <strong>{cliente.porcentajeHistorias}%</strong>
                          <div className="caption">
                            {cliente.historiasPublicadas} / {cliente.historiasMes} OK
                          </div>
                          <div className="caption">
                            Último: {cliente.ultimaHistoriaOk || "-"}
                          </div>
                        </td>
                        <td className="cliente-action-cell">
                          <strong>{getAlertaCliente(cliente)}</strong>
                          <span>
                            {cliente.historiasMes === 0
                              ? "No hay historias planificadas."
                              : `${cliente.historiasMes - cliente.historiasPublicadas} historia${
                                  cliente.historiasMes - cliente.historiasPublicadas === 1 ? "" : "s"
                                } pendiente${
                                  cliente.historiasMes - cliente.historiasPublicadas === 1 ? "" : "s"
                                }.`}
                          </span>
                          <button
                            className="btn cliente-edit-quota-btn"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setClienteCuotaEnEdicion(cliente);
                            }}
                          >
                            Editar cuota
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filas.length === 0 && (
                      <tr>
                        <td colSpan="6">No hay clientes con ese criterio.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="clientes-mobile-list">
                {filas.map((cliente) => (
                  <article className="cliente-mobile-card" key={cliente.id}>
                    <div className="cliente-mobile-card-head">
                      <div>
                        <strong>{cliente.nombre}</strong>
                        <small>Cliente activo</small>
                      </div>
                      <span className={`cliente-status-pill ${cliente.estadoHistorias.color}`}>
                        <span className={`semaforo ${cliente.estadoHistorias.color}`}></span>
                        {cliente.estadoHistorias.label}
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
                        <span>Historias</span>
                        <strong>{cliente.historiasPublicadas} de {cliente.historiasMes} OK</strong>
                        <small>{cliente.porcentajeHistorias}% publicado</small>
                      </div>
                      <div>
                        <span>Próxima acción</span>
                        <strong>{getAlertaCliente(cliente)}</strong>
                        <small>
                          {cliente.historiasMes === 0
                            ? "Sin historias planificadas."
                            : `${cliente.historiasMes - cliente.historiasPublicadas} pendientes.`}
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
        <div className="modal-overlay open" role="dialog" aria-modal="true">
          <div className="modal cliente-create-modal">
            <div className="modal-header">
              <span>Agregar cliente</span>
              <button
                className="modal-close"
                type="button"
                onClick={cerrarAltaCliente}
                aria-label="Cerrar"
              >
                X
              </button>
            </div>
            <form className="modal-body cliente-create-modal-body" onSubmit={crearCliente}>
              <div className="clientes-panel-copy">
                <strong>Nuevo acuerdo mensual</strong>
                <span>Registrá la identidad del cliente y el contenido contratado antes de confirmar.</span>
              </div>
              <label className="cliente-service-field">
                <span>Nombre del cliente</span>
                <input
                  autoFocus
                  type="text"
                  placeholder="Ej. RENDER Motors"
                  value={nuevoCliente.nombre}
                  onChange={(e) =>
                    setNuevoCliente((prev) => ({ ...prev, nombre: e.target.value }))
                  }
                />
                <small>Usá el nombre oficial con el que se identifica en la cartera.</small>
              </label>
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
              <div className="cliente-contract-summary">
                <span>Resumen del acuerdo</span>
                <strong>{totalPiezasNuevoCliente} piezas mensuales</strong>
                <small>
                  {nuevoCliente.cuota_reels || 0} reels · {nuevoCliente.cuota_carruseles || 0} carruseles
                </small>
              </div>
              {errorAltaCliente && <div className="caption login-error">{errorAltaCliente}</div>}
              <div className="modal-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoCliente}
                  onClick={cerrarAltaCliente}
                >
                  Cancelar
                </button>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={guardandoCliente || !altaClienteValida}
                >
                  {guardandoCliente ? "Creando..." : "Crear cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
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
          historias={historias.filter((h) => h.cliente_id === clienteSeleccionado.id)}
          publicaciones={getPublicacionesDelMismoFeed(
            clienteSeleccionado,
            clientes,
            publicaciones,
          )}
          onClose={() => setClienteSeleccionado(null)}
          onCuotaActualizada={cargarClientes}
          onClienteEliminado={(id) => {
            setClientes((prev) => prev.filter((cliente) => cliente.id !== id));
            setClienteSeleccionado(null);
          }}
        />
      )}
    </main>
  );
}
