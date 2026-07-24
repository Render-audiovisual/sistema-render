import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { getSesion } from "../utils.jsx";

export function PiezasTableroPage() {
  const sesion = getSesion();
  const API_BASE = "/api";
  const token = sesion?.token;

  const [piezas, setPiezas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState("kanban"); // "kanban" o "tabla"
  const [modalAbierto, setModalAbierto] = useState(false);
  const [piezaSeleccionada, setPiezaSeleccionada] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [piezaArrastrada, setPiezaArrastrada] = useState(null);
  const [estadoSobre, setEstadoSobre] = useState(null);
  const [bloquearClickTarjeta, setBloquearClickTarjeta] = useState(false);

  // Filtros
  const [busquedaSinDebounce, setBusquedaSinDebounce] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtroArea, setFiltroArea] = useState("");
  const [filtroSubtipo, setFiltroSubtipo] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroResponsable, setFiltroResponsable] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroPrioridad, setFiltroPrioridad] = useState("");

  // Debounce para búsqueda (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setBusqueda(busquedaSinDebounce), 300);
    return () => clearTimeout(timer);
  }, [busquedaSinDebounce]);

  // Estados posibles
  const ESTADOS = [
    "pendiente",
    "en_diseño",
    "en_edición",
    "en_revisión",
    "lista",
    "bloqueada",
    "publicada",
  ];

  const ESTADO_LABELS = {
    pendiente: "Pendiente",
    en_diseño: "En diseño",
    en_edición: "En edición",
    en_revisión: "En revisión",
    lista: "Lista",
    publicada: "Publicada",
    bloqueada: "Bloqueada",
  };

  const TIPO_ICONOS = {
    historia: "📖",
    reel: "🎬",
    carrusel: "📸",
    flyer: "📋",
    video: "📹",
  };

  const AREAS_TAREAS = [
    { id: "", label: "Todas" },
    { id: "diseno", label: "Diseño" },
    { id: "videos", label: "Videos" },
    { id: "community", label: "Community manager" },
  ];

  const SUBTIPOS_TAREAS = [
    { id: "historias_flyers", area: "diseno", label: "Historias / flyers" },
    { id: "carruseles", area: "diseno", label: "Carruseles" },
    {
      id: "carteleria_impresiones",
      area: "diseno",
      label: "Cartelería / impresiones",
    },
    { id: "reels", area: "videos", label: "Reels" },
    { id: "visitas", area: "videos", label: "Visitas" },
    { id: "edicion", area: "videos", label: "Edición" },
    { id: "community_pendiente", area: "community", label: "A definir" },
  ];

  const AREA_LABELS = {
    diseno: "Diseño",
    videos: "Videos",
    community: "Community manager",
  };

  const SUBTIPO_LABELS = useMemo(() =>
    SUBTIPOS_TAREAS.reduce((acc, subtipo) => {
      acc[subtipo.id] = subtipo.label;
      return acc;
    }, {}),
    []
  );

  const clasificacionCache = useRef(new Map());

  const obtenerTextoClasificacion = useCallback((pieza) => {
    return [
      pieza.tipo,
      pieza.idea,
      pieza.copy,
      pieza.aclaraciones,
      pieza.material_referencia,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }, []);

  const clasificarPieza = useCallback((pieza) => {
    const key = `${pieza.id}`;
    if (clasificacionCache.current.has(key)) {
      return clasificacionCache.current.get(key);
    }

    const tipo = (pieza.tipo || "").toLowerCase();
    const responsable = (pieza.responsable || "").toLowerCase();
    const texto = obtenerTextoClasificacion(pieza);

    let resultado;
    if (
      tipo.includes("carteleria") ||
      tipo.includes("cartelería") ||
      tipo.includes("impresion") ||
      tipo.includes("impresión") ||
      texto.includes("carteleria") ||
      texto.includes("cartelería") ||
      texto.includes("impresion") ||
      texto.includes("impresión")
    ) {
      resultado = { area: "diseno", subtipo: "carteleria_impresiones" };
    } else if (tipo === "carrusel" || tipo.includes("carrusel")) {
      resultado = { area: "diseno", subtipo: "carruseles" };
    } else if (tipo === "historia" || tipo === "flyer" || tipo.includes("flyer")) {
      resultado = { area: "diseno", subtipo: "historias_flyers" };
    } else if (
      tipo.includes("visita") ||
      texto.includes("visita") ||
      texto.includes("grabacion") ||
      texto.includes("grabación") ||
      texto.includes("filmacion") ||
      texto.includes("filmación")
    ) {
      resultado = { area: "videos", subtipo: "visitas" };
    } else if (
      tipo.includes("edicion") ||
      tipo.includes("edición") ||
      responsable.includes("luciano") ||
      texto.includes("editar") ||
      texto.includes("edicion") ||
      texto.includes("edición")
    ) {
      resultado = { area: "videos", subtipo: "edicion" };
    } else if (tipo === "video" || tipo === "reel" || tipo.includes("reel")) {
      resultado = { area: "videos", subtipo: "reels" };
    } else {
      resultado = { area: "community", subtipo: "community_pendiente" };
    }

    clasificacionCache.current.set(key, resultado);
    return resultado;
  }, [obtenerTextoClasificacion]);

  // Cargar piezas al montar
  useEffect(() => {
    cargarPiezas();
  }, []);

  // Limpiar cache cuando cambian las piezas
  useEffect(() => {
    clasificacionCache.current.clear();
  }, [piezas]);

  async function cargarPiezas() {
    try {
      setCargando(true);
      setError(null);
      const respuesta = await fetch(`${API_BASE}/piezas`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!respuesta.ok) {
        throw new Error(`Error ${respuesta.status}: ${respuesta.statusText}`);
      }

      const datos = await respuesta.json();
      setPiezas(datos);
    } catch (err) {
      setError(err.message);
      console.error("Error cargando piezas:", err);
    } finally {
      setCargando(false);
    }
  }

  // Filtrar piezas según los filtros activos (memoizado)
  const busquedaNormalizada = busqueda.trim().toLowerCase();
  const piezasFiltradas = useMemo(() => {
    return piezas.filter((pieza) => {
      const clasificacion = clasificarPieza(pieza);

      if (busquedaNormalizada) {
        const textoPieza = [
          pieza.tipo,
          AREA_LABELS[clasificacion.area],
          SUBTIPO_LABELS[clasificacion.subtipo],
          pieza.cliente_nombre,
          pieza.responsable,
          pieza.idea,
          pieza.copy,
          pieza.material_referencia,
          pieza.aclaraciones,
          ESTADO_LABELS[pieza.estado],
          pieza.prioridad,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!textoPieza.includes(busquedaNormalizada)) return false;
      }
      if (filtroArea && clasificacion.area !== filtroArea) return false;
      if (filtroSubtipo && clasificacion.subtipo !== filtroSubtipo) return false;
      if (filtroEstado && (pieza.estado || "pendiente") !== filtroEstado)
        return false;
      if (filtroResponsable && pieza.responsable !== filtroResponsable)
        return false;
      if (filtroCliente && pieza.cliente_id !== parseInt(filtroCliente))
        return false;
      if (filtroPrioridad && pieza.prioridad !== filtroPrioridad) return false;
      return true;
    });
  }, [piezas, busquedaNormalizada, filtroArea, filtroSubtipo, filtroEstado, filtroResponsable, filtroCliente, filtroPrioridad, clasificarPieza, SUBTIPO_LABELS]);

  // Obtener responsables únicos (memoizado)
  const responsables = useMemo(() =>
    [...new Set(piezas.map((p) => p.responsable).filter(Boolean))].sort(),
    [piezas]
  );

  // Obtener clientes únicos (memoizado)
  const clientes = useMemo(() => {
    const clientesPorId = new Map();
    piezas.forEach((p) => {
      if (p.cliente_id && !clientesPorId.has(p.cliente_id)) {
        clientesPorId.set(p.cliente_id, p.cliente_nombre);
      }
    });
    return [...clientesPorId.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [piezas]);

  // Prioridades
  const prioridades = ["baja", "media", "alta"];

  // Subtipos disponibles (memoizado)
  const subtiposDisponibles = useMemo(() =>
    SUBTIPOS_TAREAS.filter((subtipo) => !filtroArea || subtipo.area === filtroArea),
    [filtroArea]
  );

  // Conteos (memoizado)
  const { conteoAreas, conteoSubtipos } = useMemo(() => {
    const areas = { todas: 0 };
    const subtipos = {};
    piezas.forEach((pieza) => {
      const clasificacion = clasificarPieza(pieza);
      areas[clasificacion.area] = (areas[clasificacion.area] || 0) + 1;
      areas.todas += 1;
      subtipos[clasificacion.subtipo] = (subtipos[clasificacion.subtipo] || 0) + 1;
    });
    return { conteoAreas: areas, conteoSubtipos: subtipos };
  }, [piezas, clasificarPieza]);
  const hayFiltrosActivos = useMemo(() =>
    busqueda.trim() ||
    filtroArea ||
    filtroSubtipo ||
    filtroEstado ||
    filtroResponsable ||
    filtroCliente ||
    filtroPrioridad,
    [busqueda, filtroArea, filtroSubtipo, filtroEstado, filtroResponsable, filtroCliente, filtroPrioridad]
  );

  // Agrupar por estado (memoizado)
  const piezasPorEstado = useMemo(() => {
    const grupos = {};
    ESTADOS.forEach((estado) => {
      grupos[estado] = [];
    });
    piezasFiltradas.forEach((pieza) => {
      const estado = pieza.estado || "pendiente";
      if (!grupos[estado]) {
        grupos[estado] = [];
      }
      grupos[estado].push(pieza);
    });
    return grupos;
  }, [piezasFiltradas, ESTADOS]);

  const obtenerTituloPieza = useCallback((pieza) => {
    const texto = pieza.idea || pieza.copy || pieza.tipo || "Tarea sin detalle";
    return texto.length > 86 ? `${texto.substring(0, 86)}...` : texto;
  }, []);

  const formatearFechaCorta = useCallback((fechaISO) => {
    if (!fechaISO) return null;
    return new Date(fechaISO).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
    });
  }, []);

  async function cambiarEstado(piezaId, nuevoEstado, opciones = {}) {
    const { actualizarLocal = true } = opciones;
    try {
      setEnviando(true);
      const respuesta = await fetch(`${API_BASE}/piezas/${piezaId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      if (!respuesta.ok) {
        throw new Error(`Error ${respuesta.status}`);
      }

      if (actualizarLocal) {
        setPiezas((actuales) =>
          actuales.map((p) =>
            p.id === piezaId ? { ...p, estado: nuevoEstado } : p
          )
        );
      }

      // Actualizar modal si está abierto
      if (piezaSeleccionada?.id === piezaId) {
        setPiezaSeleccionada({ ...piezaSeleccionada, estado: nuevoEstado });
      }
      return true;
    } catch (err) {
      alert("Error al cambiar estado: " + err.message);
      return false;
    } finally {
      setEnviando(false);
    }
  }

  function iniciarArrastre(evento, pieza) {
    const estadoActual = pieza.estado || "pendiente";
    setPiezaArrastrada({ id: pieza.id, estado: estadoActual });
    setBloquearClickTarjeta(true);
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData("text/plain", String(pieza.id));
  }

  function terminarArrastre() {
    setPiezaArrastrada(null);
    setEstadoSobre(null);
    setTimeout(() => setBloquearClickTarjeta(false), 0);
  }

  function permitirSoltar(evento, estado) {
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    setEstadoSobre(estado);
  }

  async function soltarEnEstado(evento, nuevoEstado) {
    evento.preventDefault();
    const piezaId =
      piezaArrastrada?.id || Number(evento.dataTransfer.getData("text/plain"));
    const piezaAnterior = piezas.find((p) => p.id === piezaId);
    const estadoAnterior =
      piezaArrastrada?.estado || piezaAnterior?.estado || "pendiente";

    terminarArrastre();

    if (!piezaId || estadoAnterior === nuevoEstado || !piezaAnterior) {
      return;
    }

    const piezaActualizada = { ...piezaAnterior, estado: nuevoEstado };
    setPiezas((actuales) =>
      actuales.map((p) => (p.id === piezaId ? piezaActualizada : p))
    );
    if (piezaSeleccionada?.id === piezaId) {
      setPiezaSeleccionada(piezaActualizada);
    }

    const guardado = await cambiarEstado(piezaId, nuevoEstado, {
      actualizarLocal: false,
    });

    if (!guardado) {
      setPiezas((actuales) =>
        actuales.map((p) => (p.id === piezaId ? piezaAnterior : p))
      );
      if (piezaSeleccionada?.id === piezaId) {
        setPiezaSeleccionada(piezaAnterior);
      }
    }
  }

  function abrirModal(pieza) {
    setPiezaSeleccionada(pieza);
    setModalAbierto(true);
  }

  function cerrarModal() {
    setModalAbierto(false);
    setPiezaSeleccionada(null);
  }

  const COLORES_PRIORIDAD = useMemo(() => ({
    alta: "#333",
    media: "#777",
    baja: "#ccc",
    default: "#aaa",
  }), []);

  const obtenerColorPrioridad = useCallback((prioridad) =>
    COLORES_PRIORIDAD[prioridad] || COLORES_PRIORIDAD.default,
    [COLORES_PRIORIDAD]
  );

  const obtenerColorTextoPrioridad = useCallback((prioridad) =>
    prioridad === "baja" ? "#333" : "#fff",
    []
  );

  if (cargando) {
    return (
      <main aria-label="Render platform piezas">
        <div className="section-label">Tareas</div>
        <div className="box">
          <div style={{ textAlign: "center", padding: "40px" }}>
            Cargando tareas...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main aria-label="Render platform piezas">
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <div className="section-label" style={{ margin: 0 }}>
          Tareas ({piezasFiltradas.length})
        </div>
        {sesion?.usuario?.rol === "admin" && (
          <a className="btn primary" href="/nueva-tarea">
            Nueva tarea
          </a>
        )}
      </div>

      <div className="box" style={{ marginBottom: "20px" }}>
        <div className="task-sector-panel">
          <div className="task-sector-tabs" aria-label="Sector de tarea">
            {AREAS_TAREAS.map((area) => (
              <button
                key={area.id || "todas"}
                type="button"
                className={`task-sector-tab ${
                  filtroArea === area.id ? "active" : ""
                }`}
                onClick={() => {
                  setFiltroArea(area.id);
                  setFiltroSubtipo("");
                }}
              >
                <span>{area.label}</span>
                <strong>
                  {area.id ? conteoAreas[area.id] || 0 : conteoAreas.todas}
                </strong>
              </button>
            ))}
          </div>

          <div className="task-subtype-tabs" aria-label="Tipo de tarea">
            <button
              type="button"
              className={`task-subtype-chip ${
                filtroSubtipo === "" ? "active" : ""
              }`}
              onClick={() => setFiltroSubtipo("")}
            >
              Todos los subtipos
            </button>
            {subtiposDisponibles.map((subtipo) => (
              <button
                key={subtipo.id}
                type="button"
                className={`task-subtype-chip ${
                  filtroSubtipo === subtipo.id ? "active" : ""
                }`}
                onClick={() => setFiltroSubtipo(subtipo.id)}
              >
                <span>{subtipo.label}</span>
                <strong>{conteoSubtipos[subtipo.id] || 0}</strong>
              </button>
            ))}
          </div>
        </div>

        {/* Controles */}
        <div className="task-toolbar">
          <div className="task-view-toggle">
            <button
              className={`btn ${vista === "kanban" ? "btn-active" : ""}`}
              onClick={() => setVista("kanban")}
            >
              Kanban
            </button>
            <button
              className={`btn ${vista === "tabla" ? "btn-active" : ""}`}
              onClick={() => setVista("tabla")}
            >
              Tabla
            </button>
          </div>

          <label className="task-search">
            <span>Buscar</span>
            <input
              type="search"
              value={busquedaSinDebounce}
              onChange={(e) => setBusquedaSinDebounce(e.target.value)}
              placeholder="Tarea, cliente o idea..."
            />
          </label>

          <select
            className="task-filter-select"
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {ESTADOS.map((estado) => (
              <option key={estado} value={estado}>
                {ESTADO_LABELS[estado]}
              </option>
            ))}
          </select>

          <select
            className="task-filter-select"
            value={filtroResponsable}
            onChange={(e) => setFiltroResponsable(e.target.value)}
          >
            <option value="">Todos los responsables</option>
            {responsables.map((resp) => (
              <option key={resp} value={resp}>
                {resp}
              </option>
            ))}
          </select>

          <select
            className="task-filter-select"
            value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)}
          >
            <option value="">Todos los clientes</option>
            {clientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nombre}
              </option>
            ))}
          </select>

          <select
            className="task-filter-select"
            value={filtroPrioridad}
            onChange={(e) => setFiltroPrioridad(e.target.value)}
          >
            <option value="">Todas las prioridades</option>
            {prioridades.map((prio) => (
              <option key={prio} value={prio}>
                {prio.charAt(0).toUpperCase() + prio.slice(1)}
              </option>
            ))}
          </select>

          <button
            className="btn"
            onClick={() => {
              setBusqueda("");
              setFiltroArea("");
              setFiltroSubtipo("");
              setFiltroEstado("");
              setFiltroResponsable("");
              setFiltroCliente("");
              setFiltroPrioridad("");
            }}
            disabled={!hayFiltrosActivos}
          >
            Limpiar filtros
          </button>

          <span className="task-results-count">
            {piezasFiltradas.length} de {piezas.length} tareas
          </span>
        </div>

        {error && (
          <div
            style={{
              color: "#333",
              fontWeight: 600,
              background: "#f7f7f7",
              border: "1px solid #ddd",
              borderRadius: "6px",
              padding: "10px 12px",
              marginBottom: "12px",
            }}
          >
            Error: {error}
          </div>
        )}

        {/* VISTA KANBAN */}
        {vista === "kanban" && (
          <div className="kanban">
            {ESTADOS.map((estado) => {
              const piezasDelEstado = piezasPorEstado[estado];
              return (
                <div
                  key={estado}
                  className={`kanban-column ${
                    estadoSobre === estado ? "kanban-column-over" : ""
                  }`}
                  onDragOver={(evento) => permitirSoltar(evento, estado)}
                  onDragLeave={() => setEstadoSobre(null)}
                  onDrop={(evento) => soltarEnEstado(evento, estado)}
                >
                  <div className="kanban-header">
                    <span className="font-weight-bold">
                      {ESTADO_LABELS[estado]}
                    </span>
                    <span style={{ fontSize: "12px", color: "#999" }}>
                      ({piezasDelEstado.length})
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {piezasDelEstado.map((pieza) => {
                      const clasificacion = clasificarPieza(pieza);
                      const chipsClasificacion = [
                        !filtroArea && AREA_LABELS[clasificacion.area],
                        !filtroSubtipo && SUBTIPO_LABELS[clasificacion.subtipo],
                      ].filter(Boolean);
                      return (
                        <div
                          key={`${pieza.origen}-${pieza.id}`}
                          className={`task-card ${
                            piezaArrastrada?.id === pieza.id
                              ? "task-card-dragging"
                              : ""
                          }`}
                          data-pieza-id={pieza.id}
                          data-estado={pieza.estado || "pendiente"}
                          draggable
                          onDragStart={(evento) =>
                            iniciarArrastre(evento, pieza)
                          }
                          onDragEnd={terminarArrastre}
                          onClick={() => {
                            if (!bloquearClickTarjeta) abrirModal(pieza);
                          }}
                        >
                          <div className="task-card-topline">
                            <span className="task-card-type">
                              {TIPO_ICONOS[pieza.tipo] || "📄"}{" "}
                              {pieza.tipo.charAt(0).toUpperCase() +
                                pieza.tipo.slice(1)}
                            </span>
                            <div
                              className="task-priority-dot"
                              title={pieza.prioridad}
                              style={{
                                backgroundColor: obtenerColorPrioridad(
                                  pieza.prioridad
                                ),
                              }}
                            ></div>
                          </div>

                          {chipsClasificacion.length > 0 && (
                            <div className="task-card-split">
                              {chipsClasificacion.map((chip) => (
                                <span key={chip}>{chip}</span>
                              ))}
                            </div>
                          )}

                          <div className="task-card-client">
                            {pieza.cliente_nombre || "Sin cliente"}
                          </div>

                          <div className="task-card-title">
                            {obtenerTituloPieza(pieza)}
                          </div>

                          <div className="task-card-meta">
                            <span>{pieza.responsable || "Sin responsable"}</span>
                            {pieza.fecha_programada && (
                              <span>{formatearFechaCorta(pieza.fecha_programada)}</span>
                            )}
                            {pieza.prioridad && (
                              <span>{pieza.prioridad}</span>
                            )}
                          </div>

                          {pieza.material_referencia && (
                            <div className="task-card-footer">
                              Material cargado
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {piezasDelEstado.length === 0 && (
                      <div className="kanban-empty">
                        Vacío
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* VISTA TABLA */}
        {vista === "tabla" && (
          <div className="task-table-scroll">
            <table style={{ width: "100%", fontSize: "13px" }}>
              <thead>
                <tr>
                  <th>Área</th>
                  <th>Tipo</th>
                  <th>Cliente</th>
                  <th>Responsable</th>
                  <th>Idea</th>
                  <th>Estado</th>
                  <th>Prioridad</th>
                  <th>Fecha programada</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {piezasFiltradas.map((pieza) => {
                  const clasificacion = clasificarPieza(pieza);
                  return (
                    <tr key={`${pieza.origen}-${pieza.id}`}>
                      <td>
                        <div className="task-table-area">
                          <strong>{AREA_LABELS[clasificacion.area]}</strong>
                          <span>{SUBTIPO_LABELS[clasificacion.subtipo]}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{ marginRight: "4px" }}>
                          {TIPO_ICONOS[pieza.tipo] || "📄"}
                        </span>
                        {pieza.tipo}
                      </td>
                      <td>{pieza.cliente_nombre || "Sin cliente"}</td>
                      <td>{pieza.responsable || "—"}</td>
                      <td>{pieza.idea?.substring(0, 40) || "—"}</td>
                      <td>{ESTADO_LABELS[pieza.estado]}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 8px",
                            borderRadius: "4px",
                            backgroundColor: obtenerColorPrioridad(
                              pieza.prioridad
                            ),
                            color: obtenerColorTextoPrioridad(pieza.prioridad),
                            fontSize: "11px",
                            fontWeight: 500,
                          }}
                        >
                          {pieza.prioridad || "—"}
                        </span>
                      </td>
                      <td>
                        {pieza.fecha_programada
                          ? new Date(pieza.fecha_programada).toLocaleDateString()
                          : "—"}
                      </td>
                      <td>
                        <button
                          className="btn"
                          onClick={() => abrirModal(pieza)}
                          style={{ fontSize: "11px", padding: "4px 8px" }}
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {piezasFiltradas.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>
                No hay piezas que coincidan con los filtros.
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL */}
      {modalAbierto && piezaSeleccionada && (
        <div className="modal-overlay open">
          <div className="modal">
            <div className="modal-header">
              <h2>
                {TIPO_ICONOS[piezaSeleccionada.tipo] || "📄"}{" "}
                {piezaSeleccionada.tipo}
              </h2>
              <button
                className="modal-close"
                onClick={cerrarModal}
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div
                className="form-grid cols-2"
                style={{ marginBottom: "15px" }}
              >
                <div>
                  <label className="caption">Cliente</label>
                  <div style={{ fontWeight: "bold" }}>
                    {piezaSeleccionada.cliente_nombre || "Sin cliente"}
                  </div>
                </div>

                <div>
                  <label className="caption">Responsable</label>
                  <div style={{ fontWeight: "bold" }}>
                    {piezaSeleccionada.responsable || "—"}
                  </div>
                </div>

                <div>
                  <label className="caption">Prioridad</label>
                  <div
                    style={{
                      display: "inline-block",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      backgroundColor: obtenerColorPrioridad(
                        piezaSeleccionada.prioridad
                      ),
                      color: obtenerColorTextoPrioridad(
                        piezaSeleccionada.prioridad
                      ),
                      fontWeight: 600,
                    }}
                  >
                    {piezaSeleccionada.prioridad || "—"}
                  </div>
                </div>

                <div>
                  <label className="caption">Fecha programada</label>
                  <div style={{ fontWeight: "bold" }}>
                    {piezaSeleccionada.fecha_programada
                      ? new Date(
                          piezaSeleccionada.fecha_programada
                        ).toLocaleDateString()
                      : "—"}
                  </div>
                </div>
              </div>

              {piezaSeleccionada.idea && (
                <div style={{ marginBottom: "15px" }}>
                  <label className="caption">Idea</label>
                  <div>{piezaSeleccionada.idea}</div>
                </div>
              )}

              {piezaSeleccionada.copy && (
                <div style={{ marginBottom: "15px" }}>
                  <label className="caption">Copy</label>
                  <div>{piezaSeleccionada.copy}</div>
                </div>
              )}

              {piezaSeleccionada.material_referencia && (
                <div style={{ marginBottom: "15px" }}>
                  <label className="caption">Material de referencia</label>
                  <div>
                    <a
                      href={piezaSeleccionada.material_referencia}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#333", textDecoration: "underline" }}
                    >
                      {piezaSeleccionada.material_referencia}
                    </a>
                  </div>
                </div>
              )}

              {piezaSeleccionada.aclaraciones && (
                <div style={{ marginBottom: "15px" }}>
                  <label className="caption">Aclaraciones</label>
                  <div>{piezaSeleccionada.aclaraciones}</div>
                </div>
              )}

              <div style={{ marginBottom: "15px" }}>
                <label className="caption">Estado actual</label>
                <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {ESTADOS.map((estado) => (
                    <button
                      key={estado}
                      className="btn"
                      onClick={() => cambiarEstado(piezaSeleccionada.id, estado)}
                      disabled={enviando}
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        backgroundColor:
                          piezaSeleccionada.estado === estado
                            ? "#333"
                            : "#fff",
                        color:
                          piezaSeleccionada.estado === estado ? "#fff" : "#333",
                      }}
                    >
                      {ESTADO_LABELS[estado]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="btn"
                onClick={cerrarModal}
                style={{ flex: 1, marginRight: "10px" }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
