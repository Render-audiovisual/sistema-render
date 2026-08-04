import React, { useEffect, useState } from "react";
import { getAprobacionesLider, getCumplimientoGeneral, getEdicionesEsperandoMaterial, getEstadoLabel, getEstadoPorObjetivo, getHoyLocalISO, getMesActualISO, getPanoramaClientes, getPiezasAtrasadas, getPiezasBloqueadas, getPorcentajesCliente, getPublicacionesDeHoy, getPublicacionesDelMismoFeed, getResumenEquipo, getTareasParaAsignar, getTipoPublicacionLabel } from "../../utils.jsx";
import { ESTADO_FINAL_TAREA } from "../../constants.js";
import { EditarCuotaClienteModal, DetalleClienteModal } from "../../components/ClienteModals.jsx";
import { TareasAsignadasGenericas } from "../../components/TareasAsignadasGenericas.jsx";
import { Modal } from "../../components/Modal.jsx";

export function LiderDashboard() {
  const [clientes, setClientes] = useState([]);
  const [resumenEquipo, setResumenEquipo] = useState([]);
  const [aprobacionesLider, setAprobacionesLider] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [panoramaError, setPanoramaError] = useState(null);
  const [resumenEquipoError, setResumenEquipoError] = useState(null);
  const [aprobacionesLiderError, setAprobacionesLiderError] =
    useState(null);
  const [historiasRaw, setHistoriasRaw] = useState([]);
  const [publicacionesRaw, setPublicacionesRaw] = useState([]);
  const [tareasRaw, setTareasRaw] = useState([]);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [vistaLider, setVistaLider] = useState("gestion");
  const [cargandoInicio, setCargandoInicio] = useState(true);

  const cargarPanorama = () => {
    Promise.all([
      fetch("/api/clientes").then((response) => response.json()),
      fetch("/api/historias").then((response) => response.json()),
      fetch("/api/publicaciones").then((response) => response.json()),
      fetch("/api/tareas").then((response) => response.json()),
    ])
      .then(([clientesApi, historiasApi, publicacionesApi, tareasApi]) => {
        setClientes(
          getPanoramaClientes(clientesApi, historiasApi, publicacionesApi),
        );
        setResumenEquipo(
          getResumenEquipo(historiasApi, publicacionesApi, tareasApi),
        );
        setAprobacionesLider(getAprobacionesLider(tareasApi));
        setHistoriasRaw(historiasApi);
        setPublicacionesRaw(publicacionesApi);
        setTareasRaw(tareasApi);
      })
      .catch((error) => {
        console.error("No se pudieron cargar los datos del Líder", error);
        setPanoramaError("No se pudo cargar el panorama de clientes.");
        setResumenEquipoError("No se pudo cargar el resumen de equipo.");
        setAprobacionesLiderError("No se pudieron cargar las aprobaciones.");
      })
      .finally(() => setCargandoInicio(false));
  };

  useEffect(cargarPanorama, []);

  const clientesFiltrados = clientes.filter((cliente) =>
    cliente.nombre.toLowerCase().includes(busquedaCliente.toLowerCase()),
  );

  const piezasAtrasadas = getPiezasAtrasadas(historiasRaw, publicacionesRaw);
  const piezasBloqueadas = getPiezasBloqueadas(historiasRaw, publicacionesRaw);
  const publicacionesDeHoy = getPublicacionesDeHoy(historiasRaw, publicacionesRaw);
  const tareasVencidas = tareasRaw.filter(
    (tarea) => tarea.fecha_vencimiento && tarea.fecha_vencimiento < getHoyLocalISO() && tarea.estado !== ESTADO_FINAL_TAREA,
  );
  const errorInicio = panoramaError || resumenEquipoError || aprobacionesLiderError;

  return (
    <main aria-label="Inicio operativo del Líder">
      <div className="frame">
        <div className="content lider-home">
          <header className="lider-home-header">
            <div className="section-label">Inicio</div>
            <h2>¿Qué requiere tu atención ahora?</h2>
            <p>Un resumen breve para decidir y continuar trabajando.</p>
          </header>

          {cargandoInicio ? (
            <div className="state-empty">Preparando tus pendientes…</div>
          ) : errorInicio ? (
            <div className="alert is-error">{errorInicio}</div>
          ) : (
            <>
              <section className="lider-home-section" aria-labelledby="atencion-title">
                <div className="lider-home-section-title">
                  <div><span>⚠</span><div><h3 id="atencion-title">Requieren atención</h3><p>Excepciones que necesitan una decisión.</p></div></div>
                </div>
                <div className="lider-home-list">
                  <a href="/workspace/tareas?archive=active"><strong>{tareasVencidas.length}</strong><span>Tareas vencidas</span><b>Ver tareas →</b></a>
                  <a href="/planificacion-historias?vista=checklist"><strong>{aprobacionesLider.length}</strong><span>Aprobaciones pendientes</span><b>Revisar →</b></a>
                  <a href="/planificacion-publicaciones?tab=lista"><strong>{piezasAtrasadas.length}</strong><span>Publicaciones atrasadas</span><b>Ver control →</b></a>
                  <a href="/planificacion-publicaciones?tab=lista"><strong>{piezasBloqueadas.length}</strong><span>Piezas bloqueadas</span><b>Resolver →</b></a>
                </div>
              </section>

              <section className="lider-home-section" aria-labelledby="hoy-title">
                <div className="lider-home-section-title">
                  <div><span>◫</span><div><h3 id="hoy-title">Hoy</h3><p>Contenido programado para la jornada.</p></div></div>
                  <a href="/planificacion-publicaciones?tab=calendario">Abrir calendario →</a>
                </div>
                {publicacionesDeHoy.length === 0 ? (
                  <div className="lider-home-empty">No hay publicaciones programadas para hoy.</div>
                ) : (
                  <div className="lider-home-today">
                    {publicacionesDeHoy.slice(0, 6).map((pieza) => (
                      <article key={`${pieza.origen}-${pieza.id}`}>
                        <time>{pieza.fecha_programada?.split(" ")[1] || "Hoy"}</time>
                        <div><strong>{pieza.idea || pieza.titulo || "Contenido sin título"}</strong><span>{pieza.cliente_nombre || "Sin cliente"} · {pieza.tipo}</span></div>
                        <b>{pieza.estado}</b>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="lider-home-section" aria-labelledby="equipo-title">
                <div className="lider-home-section-title">
                  <div><span>◉</span><div><h3 id="equipo-title">Equipo</h3><p>Carga activa, sin convertir Inicio en un reporte.</p></div></div>
                  <a href="/reportes-historias">Ver reportes →</a>
                </div>
                <div className="lider-home-team">
                  {resumenEquipo.map((persona) => (
                    <article key={persona.nombre}><strong>{persona.nombre}</strong><span>{persona.cargaTotal} pendientes</span><small className={persona.alerta ? "atraso" : ""}>{persona.estado}</small></article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );

  /* Panel anterior conservado temporalmente en código para comparar cálculos
     durante esta fase; ya no forma parte de la experiencia visible. */
  return (
    <main aria-label="Render platform">
      <div className="frame">
        <div className="content">
          <div className="lider-dashboard-header">
            <div>
              <div className="section-label">Líder</div>
              <h2>Administración general</h2>
            </div>
            <div
              aria-label="Secciones del panel del Líder"
              className="lider-dashboard-tabs"
              role="tablist"
            >
              <button
                aria-selected={vistaLider === "panorama"}
                className={vistaLider === "panorama" ? "active" : ""}
                onClick={() => setVistaLider("panorama")}
                role="tab"
                type="button"
              >
                Panorama
              </button>
              <button
                aria-selected={vistaLider === "gestion"}
                className={vistaLider === "gestion" ? "active" : ""}
                onClick={() => setVistaLider("gestion")}
                role="tab"
                type="button"
              >
                Hoy y pendientes
              </button>
            </div>
          </div>

          {vistaLider === "panorama" && (
            <div className="lider-dashboard-view" role="tabpanel">
              <div style={{ backgroundColor: "#ffe0e0", border: "2px solid #d32f2f", borderRadius: "4px", padding: "12px", marginBottom: "20px", fontSize: "13px" }}>
            {(() => {
              const atrasadas = getPiezasAtrasadas(historiasRaw, publicacionesRaw);
              const bloqueadas = getPiezasBloqueadas(historiasRaw, publicacionesRaw);
              const cumplimiento = getCumplimientoGeneral(clientes);
              const edicionesEsperando = getEdicionesEsperandoMaterial(tareasRaw);

              return (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
                  <div>
                    <span style={{ marginRight: "20px" }}>
                      🔴 {atrasadas.length} atrasados
                    </span>
                    <span style={{ marginRight: "20px" }}>
                      ⚠️ {bloqueadas.length} bloqueados
                    </span>
                    {edicionesEsperando.length > 0 && (
                      <span style={{ marginRight: "20px" }}>
                        ⏳ {edicionesEsperando.length} edicion{edicionesEsperando.length === 1 ? "" : "es"} esperando material de Germán
                      </span>
                    )}
                    <span>
                      📊 Cumplimiento: <strong>{cumplimiento}%</strong>
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="section-label">
            Panorama de clientes
          </div>
          <div className="box">
            <div className="box-header">
              <strong>Panorama de clientes — {getMesActualISO()}</strong>
              <span className="tag">
                Cumplimiento general: {getCumplimientoGeneral(clientes)}%
              </span>
            </div>

            <input
              type="text"
              placeholder="Buscar cliente por nombre…"
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
              style={{ marginBottom: "12px", width: "100%" }}
            />

            <table>
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Cliente</th>
                  <th>Historias</th>
                  <th>Feed (mes)</th>
                  <th>Feed (semana)</th>
                  <th>Objetivo mes</th>
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.map((cliente) => {
                  const porcentajes = getPorcentajesCliente(cliente);
                  const estado = cliente.semaforo;

                  return (
                    <tr
                      className="row-clickable"
                      key={cliente.id}
                      onClick={() => setClienteSeleccionado(cliente)}
                    >
                      <td>
                        <span className={`semaforo ${estado}`}></span>
                        {getEstadoLabel(estado)}
                      </td>
                      <td>{cliente.nombre}</td>
                      <td>{porcentajes.historias}%</td>
                      <td>{porcentajes.feed}%</td>
                      <td>{porcentajes.feedSemana}%</td>
                      <td>{porcentajes.objetivo}%</td>
                    </tr>
                  );
                })}
                {panoramaError && (
                  <tr>
                    <td colSpan="6">{panoramaError}</td>
                  </tr>
                )}
                {!panoramaError &&
                  clientes.length > 0 &&
                  clientesFiltrados.length === 0 && (
                    <tr>
                      <td colSpan="6">
                        Ningún cliente coincide con "{busquedaCliente}".
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>

            <div className="leyenda">
              <span className="semaforo rojo"></span>Rojo &lt;60% &nbsp;
              <span className="semaforo amarillo"></span>Amarillo 60–89%
              &nbsp;
              <span className="semaforo verde"></span>Verde ≥90%
            </div>
          </div>

          <div className="section-label">Resumen de equipo</div>
          <div className="box">
            {resumenEquipo.map((persona) => (
              <div className="persona-row" key={persona.nombre}>
                <span>{persona.nombre}</span>
                <span className="caption">
                  {persona.cargaTotal} asignadas · {persona.cumplimiento}%
                  cumplimiento
                </span>
                <span className={`tag ${persona.alerta ? "atraso" : ""}`}>
                  {persona.estado}
                </span>
              </div>
            ))}
            {resumenEquipoError && (
              <div className="caption">{resumenEquipoError}</div>
            )}
          </div>

          <div className="section-label">
            Aprobaciones escaladas
          </div>
          <div className="box">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Pieza</th>
                  <th>Motivo escalado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {aprobacionesLider.map((aprobacion) => (
                  <tr key={aprobacion.id}>
                    <td>{aprobacion.cliente_nombre ?? "Sin cliente"}</td>
                    <td>{aprobacion.titulo}</td>
                    <td>
                      {aprobacion.propiedades_extra?.motivo ??
                        "Sin motivo cargado"}
                    </td>
                    <td>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          fetch(`/api/tareas/${aprobacion.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ estado: ESTADO_FINAL_TAREA }),
                          }).then((response) => {
                            if (response.ok) cargarPanorama();
                          });
                        }}
                      >
                        Marcar resuelta
                      </button>
                    </td>
                  </tr>
                ))}
                {aprobacionesLiderError && (
                  <tr>
                    <td colSpan="4">{aprobacionesLiderError}</td>
                  </tr>
                )}
                {!aprobacionesLiderError &&
                  aprobacionesLider.length === 0 && (
                    <tr>
                      <td colSpan="4">
                        No hay tareas escaladas al Líder.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
            <div className="caption">
              → Reúne los casos escalados al equipo administrativo, incluidos
              los pendientes anteriores a la unificación.
            </div>
          </div>

          <div className="section-label">Piezas atrasadas</div>
          <div className="box">
            {(() => {
              const atrasadas = getPiezasAtrasadas(historiasRaw, publicacionesRaw);
              if (atrasadas.length === 0) {
                return (
                  <div className="caption">✅ No hay piezas atrasadas.</div>
                );
              }
              return (
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Tipo</th>
                      <th>Pieza</th>
                      <th>Vencía</th>
                      <th>Días atrasada</th>
                      <th>Estado actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {atrasadas.map((pieza) => {
                      const diasAtrasada = Math.floor(
                        (new Date(getHoyLocalISO()) -
                          new Date(pieza.fecha_programada)) /
                          (1000 * 60 * 60 * 24),
                      );
                      return (
                        <tr key={`${pieza.origen}-${pieza.id}`}>
                          <td>{pieza.cliente_nombre ?? pieza.cliente_id}</td>
                          <td>{pieza.tipo}</td>
                          <td>{pieza.idea || pieza.titulo || "Sin título"}</td>
                          <td>{pieza.fecha_programada}</td>
                          <td style={{ color: "#d9534f", fontWeight: "bold" }}>
                            {diasAtrasada} {diasAtrasada === 1 ? "día" : "días"}
                          </td>
                          <td>{pieza.estado}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>

          <div className="section-label">Bloqueos críticos</div>
          <div className="box">
            {(() => {
              const bloqueadas = getPiezasBloqueadas(historiasRaw, publicacionesRaw);
              if (bloqueadas.length === 0) {
                return <div className="caption">✅ No hay piezas bloqueadas.</div>;
              }
              return (
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Tipo</th>
                      <th>Pieza</th>
                      <th>Aclaraciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bloqueadas.map((pieza) => (
                      <tr key={`${pieza.origen}-${pieza.id}`}>
                        <td>{pieza.cliente_nombre ?? pieza.cliente_id}</td>
                        <td>{pieza.tipo}</td>
                        <td>{pieza.idea || pieza.titulo || "Sin título"}</td>
                        <td>{pieza.aclaraciones || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            <div className="caption">
              → Piezas con estado "bloqueada". Alguien las está esperando.
            </div>
          </div>

          <div className="section-label">Publicaciones de hoy</div>
          <div className="box">
            {(() => {
              const deHoy = getPublicacionesDeHoy(historiasRaw, publicacionesRaw);
              if (deHoy.length === 0) {
                return (
                  <div className="caption">
                    ℹ️ No hay piezas programadas para hoy.
                  </div>
                );
              }
              return (
                <table>
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Cliente</th>
                      <th>Tipo</th>
                      <th>Pieza</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deHoy.map((pieza) => (
                      <tr key={`${pieza.origen}-${pieza.id}`}>
                        <td>{pieza.fecha_programada.split(" ")[1] || "—"}</td>
                        <td>{pieza.cliente_nombre ?? pieza.cliente_id}</td>
                        <td>{pieza.tipo}</td>
                        <td>{pieza.idea || pieza.titulo || "Sin título"}</td>
                        <td>{pieza.estado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>

              </div>
          )}

          {vistaLider === "gestion" && (
            <div className="lider-dashboard-view" role="tabpanel">
              <div className="lider-dashboard-divider">
                <span>Hoy y pendientes</span>
                <strong>Decisiones y tareas que requieren tu intervención</strong>
              </div>
              <GestionLiderPanel />

              <TareasAsignadasGenericas
                nombre="Líder"
                nombres={["Líder", "Agustín", "Franco"]}
                titulo="Tareas asignadas al Líder"
              />
            </div>
          )}
        </div>
      </div>

      {clienteSeleccionado && (
        <DetalleClienteModal
          cliente={clienteSeleccionado}
          historias={historiasRaw.filter(
            (h) => h.cliente_id === clienteSeleccionado.id,
          )}
          publicaciones={getPublicacionesDelMismoFeed(
            clienteSeleccionado,
            clientes,
            publicacionesRaw,
          )}
          onClose={() => setClienteSeleccionado(null)}
          onCuotaActualizada={cargarPanorama}
        />
      )}
    </main>
  );
}

export function GestionLiderPanel() {
  const [piezaSeleccionada, setPiezaSeleccionada] = useState(null);
  const [piezasEnRevision, setPiezasEnRevision] = useState([]);
  const [piezasEnRevisionError, setPiezasEnRevisionError] = useState(null);
  const [filtroCola, setFiltroCola] = useState("todas");
  const [tareasGestion, setTareasGestion] = useState([]);
  const [tareasGestionError, setTareasGestionError] = useState(null);
  const [tareaAsignando, setTareaAsignando] = useState(null);
  const [responsableSeleccionado, setResponsableSeleccionado] = useState("");

  const tareasDestrabadas = tareasGestion.filter(
    (tarea) => tarea.propiedades_extra?.destrabada_por,
  );

  const cargarCola = () => {
    Promise.all([
      fetch("/api/historias").then((r) => r.json()),
      fetch("/api/publicaciones").then((r) => r.json()),
    ])
      .then(([historias, publicaciones]) => {
        const combinadas = [
          ...historias.map((h) => ({
            ...h,
            origen: "historia",
            tipoLabel: "Historia",
          })),
          ...publicaciones.map((p) => ({
            ...p,
            origen: "publicacion",
            tipoLabel: getTipoPublicacionLabel(p.tipo),
          })),
        ].filter(
          (pieza) => pieza.estado === "en_revision" || pieza.estado === "bloqueada",
        );
        setPiezasEnRevision(combinadas);
      })
      .catch((error) => {
        console.error("No se pudieron cargar las aprobaciones del Líder", error);
        setPiezasEnRevisionError("No se pudieron cargar las aprobaciones.");
      });
  };

  useEffect(() => {
    cargarCola();

    fetch("/api/tareas")
      .then((response) => response.json())
      .then((tareas) => {
        setTareasGestion(tareas);
      })
      .catch((error) => {
        console.error("No se pudieron cargar las tareas del Líder", error);
        setTareasGestionError("No se pudieron cargar las tareas.");
      });
  }, []);

  const piezasFiltradas = piezasEnRevision.filter((pieza) => {
    if (filtroCola === "creativa") return pieza.estado === "en_revision";
    if (filtroCola === "bloqueo") return pieza.estado === "bloqueada";
    return true;
  });

  return (
    <>
      <section className="lider-gestion-panel" aria-label="Gestión y aprobaciones del Líder">
          <div className="section-label">
            Mi cola de aprobaciones — lo que sí requiere mi decisión
          </div>
            <div className="box">
              <div className="box-header">
                <strong>Mi cola de aprobaciones</strong>
                <span className="tag">
                  Pendientes: {piezasEnRevision.length}
                </span>
              </div>

            <div className="tabs">
              <span
                className={filtroCola === "todas" ? "active" : ""}
                onClick={() => setFiltroCola("todas")}
              >
                Todas
              </span>
              <span
                className={filtroCola === "creativa" ? "active" : ""}
                onClick={() => setFiltroCola("creativa")}
              >
                Aprobación creativa
              </span>
              <span
                className={filtroCola === "bloqueo" ? "active" : ""}
                onClick={() => setFiltroCola("bloqueo")}
              >
                Bloqueo operativo
              </span>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Pieza</th>
                  <th>Tipo</th>
                  <th>Responsable</th>
                  <th>Vence</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {piezasFiltradas.map((pieza) => (
                  <tr key={`${pieza.origen}-${pieza.id}`}>
                    <td>{pieza.cliente_nombre}</td>
                    <td>{pieza.metadata?.Idea || "Sin idea cargada"}</td>
                    <td>
                      <span
                        className={`tag ${
                          pieza.estado === "bloqueada" ? "operativa" : "creativa"
                        }`}
                      >
                        {pieza.tipoLabel}
                      </span>
                    </td>
                    <td>{pieza.responsable}</td>
                    <td>{pieza.fecha_programada}</td>
                    <td>
                      {pieza.estado === "en_revision" ? (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setPiezaSeleccionada(pieza)}
                        >
                          Revisar
                        </button>
                      ) : (
                        <span className="caption">
                          Bloqueada:{" "}
                          {pieza.metadata?.Aclaración || "sin aclaración cargada"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {piezasEnRevisionError && (
                  <tr>
                    <td colSpan="6">{piezasEnRevisionError}</td>
                  </tr>
                )}
                {!piezasEnRevisionError && piezasFiltradas.length === 0 && (
                  <tr>
                    <td colSpan="6">No hay piezas en esta vista.</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="caption">
              → Esta cola reúne lo que necesita una decisión directa del Líder.
            </div>
          </div>

          <div className="section-label">Piezas destrabadas hoy</div>
          <div className="box">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Pieza</th>
                  <th>Duda resuelta</th>
                </tr>
              </thead>
              <tbody>
                {tareasDestrabadas.map((tarea) => (
                  <tr key={tarea.id}>
                    <td>{tarea.cliente_nombre ?? "Sin cliente"}</td>
                    <td>{tarea.titulo}</td>
                    <td>
                      Destrabada por {tarea.propiedades_extra.destrabada_por}
                      {tarea.propiedades_extra.fecha_destrabe
                        ? ` el ${tarea.propiedades_extra.fecha_destrabe}`
                        : ""}
                    </td>
                  </tr>
                ))}
                {tareasGestionError && (
                  <tr>
                    <td colSpan="3">{tareasGestionError}</td>
                  </tr>
                )}
                {!tareasGestionError && tareasDestrabadas.length === 0 && (
                  <tr>
                    <td colSpan="3">No hay piezas destrabadas registradas.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="caption">
              → Historial simple de lo que el Líder ya destrabó hoy.
            </div>
          </div>

          <div className="section-label">Tareas para asignar</div>
          <div className="box">
            {(() => {
              const porAsignar = getTareasParaAsignar(tareasGestion);
              if (porAsignar.length === 0) {
                return (
                  <div className="caption">
                    ✅ No hay tareas pendientes de asignación.
                  </div>
                );
              }
              return (
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Tarea</th>
                      <th>Asignado a</th>
                      <th>Vence</th>
                      <th>Acción rápida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porAsignar.map((tarea) => (
                      <tr key={tarea.id}>
                        <td>{tarea.cliente_nombre ?? "—"}</td>
                        <td>{tarea.titulo}</td>
                        <td>{tarea.asignado_a ?? "Sin asignar"}</td>
                        <td>{tarea.fecha_vencimiento ?? "—"}</td>
                        <td>
                          {tareaAsignando?.id === tarea.id ? (
                            <div style={{ display: "flex", gap: "4px" }}>
                              <select
                                value={responsableSeleccionado}
                                onChange={(e) => setResponsableSeleccionado(e.target.value)}
                                style={{ padding: "4px", fontSize: "12px", borderRadius: "2px" }}
                              >
                                <option value="">Seleccionar...</option>
                                <option value="Augusto">Augusto</option>
                                <option value="Luciano">Luciano</option>
                                <option value="Germán">Germán</option>
                              </select>
                              <button
                                className="btn"
                                type="button"
                                onClick={() => {
                                  if (responsableSeleccionado) {
                                    fetch(`/api/tareas/${tarea.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ asignado_a: responsableSeleccionado }),
                                    }).then((response) => {
                                      if (response.ok) {
                                        setTareaAsignando(null);
                                        setResponsableSeleccionado("");
                                        cargarCola();
                                      }
                                    });
                                  }
                                }}
                                style={{ padding: "4px 8px", fontSize: "11px" }}
                              >
                                ✓
                              </button>
                              <button
                                className="btn"
                                type="button"
                                onClick={() => {
                                  setTareaAsignando(null);
                                  setResponsableSeleccionado("");
                                }}
                                style={{ padding: "4px 8px", fontSize: "11px" }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn"
                              type="button"
                              onClick={() => setTareaAsignando(tarea)}
                              style={{ padding: "4px 8px", fontSize: "11px" }}
                            >
                              Asignar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            <div className="caption">
              → Tareas pendientes que el Líder puede asignar rápidamente.
            </div>
          </div>
      </section>

      {piezaSeleccionada && (
        <RevisionPiezaModal
          pieza={piezaSeleccionada}
          onClose={() => setPiezaSeleccionada(null)}
          onAprobar={cargarCola}
          onCorreccion={cargarCola}
        />
      )}
    </>
  );
}

export function RevisionPiezaModal({ pieza, onClose, onAprobar, onCorreccion }) {
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const endpointPieza =
    pieza.origen === "publicacion"
      ? `/api/publicaciones/${pieza.id}`
      : `/api/historias/${pieza.id}`;

  const handleAprobar = () => {
    setEnviando("aprobar");
    setError(null);

    fetch(endpointPieza, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "lista" }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo aprobar la pieza.");
        }
        return response.json();
      })
      .then(() => {
        onAprobar(pieza.id);
        onClose();
      })
      .catch(() => {
        setError("No se pudo aprobar la pieza. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  const handlePedirCorreccion = () => {
    const nota = window.prompt(
      "¿Qué hay que corregir? (se guarda en la pieza para que lo vea el responsable)",
    );
    if (!nota) {
      return;
    }

    setEnviando("correccion");
    setError(null);

    fetch(endpointPieza, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estado: "pendiente",
        metadata: { Aclaración: `CORRECCIÓN DE FRANCO: ${nota}` },
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo pedir la corrección.");
        }
        return response.json();
      })
      .then(() => {
        onCorreccion(pieza.id);
        onClose();
      })
      .catch(() => {
        setError("No se pudo pedir la corrección. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  const handleEscalar = () => {
    const motivo = window.prompt(
      "Cuál es el motivo para escalar esto al Líder?",
    );
    if (!motivo) {
      return;
    }

    setEnviando("escalar");
    setError(null);

    fetch("/api/tareas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo: `Escalado: ${
          pieza.metadata?.Idea || "Pieza sin idea"
        } (${pieza.cliente_nombre})`,
        asignado_a: "Líder",
        cliente_id: pieza.cliente_id,
        estado: "pendiente",
        requiere_aprobacion: true,
        escalada_a: "Líder",
        motivo,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo escalar la pieza.");
        }
        return response.json();
      })
      .then(() => {
        onClose();
      })
      .catch(() => {
        setError("No se pudo escalar la pieza. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  const handleDesbloquear = () => {
    const resolucion = window.prompt(
      "¿Cómo se resolvió el bloqueo? (se guarda para referencia)",
    );
    if (!resolucion === undefined) {
      return;
    }

    setEnviando("desbloquear");
    setError(null);

    fetch(endpointPieza, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estado: "en_revision",
        metadata: { Aclaración: `Desbloqueada por Líder: ${resolucion}` },
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo desbloquear la pieza.");
        }
        return response.json();
      })
      .then(() => {
        onAprobar(pieza.id);
        onClose();
      })
      .catch(() => {
        setError("No se pudo desbloquear la pieza. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  return (
    <Modal
      onClose={onClose}
      title={
        <span>
          {pieza.cliente_nombre} · {pieza.metadata?.Idea || "Sin idea cargada"}
        </span>
      }
    >
        <div className="modal-body">
          <span className="tag creativa">Aprobación creativa</span>

          <div className="preview-box">[ Preview del reel ]</div>

          <div className="meta-block">
            Material: {pieza.metadata?.Material || "Sin material cargado"}
          </div>

          {error && <div className="caption login-error">{error}</div>}

          <div className="modal-actions">
            {pieza.estado === "bloqueada" ? (
              <>
                <button
                  className="btn primary"
                  type="button"
                  onClick={handleDesbloquear}
                  disabled={enviando !== null}
                >
                  {enviando === "desbloquear" ? "Desbloqueando..." : "Desbloquear"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleEscalar}
                  disabled={enviando !== null}
                >
                  {enviando === "escalar" ? "Escalando..." : "Escalar al Líder"}
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn primary"
                  type="button"
                  onClick={handleAprobar}
                  disabled={enviando !== null}
                >
                  {enviando === "aprobar" ? "Aprobando..." : "Aprobar"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handlePedirCorreccion}
                  disabled={enviando !== null}
                >
                  {enviando === "correccion" ? "Enviando..." : "Pedir corrección"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleEscalar}
                  disabled={enviando !== null}
                >
                  {enviando === "escalar" ? "Escalando..." : "Escalar al Líder"}
                </button>
              </>
            )}
          </div>
        </div>
    </Modal>
  );
}
