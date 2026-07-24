import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function calcularPorcentajePublicadas(items) {
  if (items.length === 0) return 0;

  const publicadas = items.filter((item) => item.estado === "publicada").length;
  return Math.round((publicadas / items.length) * 100);
}

function calcularPorcentajeCuota(publicadas, cuota) {
  if (cuota <= 0) return 0;
  return Math.min(100, Math.round((publicadas / cuota) * 100));
}

function getMesActualISO() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

function esDelMesActual(fechaISO) {
  return typeof fechaISO === "string" && fechaISO.startsWith(getMesActualISO());
}

function getInicioSemanaISO() {
  const hoy = new Date();
  const dia = hoy.getDay();
  const diffLunes = dia === 0 ? -6 : 1 - dia;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diffLunes);
  const year = lunes.getFullYear();
  const month = String(lunes.getMonth() + 1).padStart(2, "0");
  const day = String(lunes.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function esDeEstaSemana(fechaISO) {
  return (
    typeof fechaISO === "string" &&
    fechaISO >= getInicioSemanaISO() &&
    fechaISO <= getHoyLocalISO()
  );
}

function getClaveFeed(cliente) {
  return cliente.grupo_feed_id
    ? `grupo-${cliente.grupo_feed_id}`
    : `cliente-${cliente.id}`;
}

function getClienteIdsDelMismoFeed(cliente, clientes) {
  if (!cliente.grupo_feed_id) return [cliente.id];
  return clientes
    .filter((item) => item.grupo_feed_id === cliente.grupo_feed_id)
    .map((item) => item.id);
}

function getPublicacionesDelMismoFeed(cliente, clientes, publicaciones) {
  const clienteIds = new Set(getClienteIdsDelMismoFeed(cliente, clientes));
  return publicaciones.filter((publicacion) => clienteIds.has(publicacion.cliente_id));
}

function getCuotaFeedMensual(cliente) {
  return getCuotaReelsMensual(cliente) + getCuotaCarruselesMensual(cliente);
}

function getCuotaReelsMensual(cliente) {
  if (cliente.grupo_feed_id) return Number(cliente.cuota_feed_reels) || 0;
  return Number(cliente.cuota_reels) || 0;
}

function getCuotaCarruselesMensual(cliente) {
  if (cliente.grupo_feed_id) return Number(cliente.cuota_feed_carruseles) || 0;
  return Number(cliente.cuota_carruseles) || 0;
}

function getPanoramaClientes(clientes, historias, publicaciones) {
  return clientes
    .map((cliente) => {
      const historiasCliente = historias.filter(
        (historia) =>
          historia.cliente_id === cliente.id &&
          esDelMesActual(historia.fecha_programada),
      );
      const feedDelMes = getPublicacionesDelMismoFeed(
        cliente,
        clientes,
        publicaciones,
      ).filter(
        (publicacion) =>
          esDelMesActual(publicacion.fecha_programada),
      );
      const feedDeEstaSemana = feedDelMes.filter((publicacion) =>
        esDeEstaSemana(publicacion.fecha_programada),
      );

      const cuotaFeedMes = getCuotaFeedMensual(cliente);
      const cuotaFeedSemana = cuotaFeedMes / 4;

      const feedPublicadoMes = feedDelMes.filter(
        (publicacion) => publicacion.estado === "publicada",
      ).length;
      const feedPublicadoSemana = feedDeEstaSemana.filter(
        (publicacion) => publicacion.estado === "publicada",
      ).length;

      const porcentajeHistorias = calcularPorcentajePublicadas(historiasCliente);
      const porcentajeFeed = calcularPorcentajeCuota(
        feedPublicadoMes,
        cuotaFeedMes,
      );
      const porcentajeFeedSemana = calcularPorcentajeCuota(
        feedPublicadoSemana,
        cuotaFeedSemana,
      );
      const porcentajeObjetivo = Math.round(
        (porcentajeHistorias + porcentajeFeed) / 2,
      );
      const porcentajes = {
        historias: porcentajeHistorias,
        feed: porcentajeFeed,
        feedSemana: porcentajeFeedSemana,
        objetivo: porcentajeObjetivo,
        historiasPublicadas: historiasCliente.filter(
          (historia) => historia.estado === "publicada",
        ).length,
        historiasTotal: historiasCliente.length,
        feedPublicado: feedPublicadoMes,
        feedTotal: cuotaFeedMes,
      };

      return {
        ...cliente,
        porcentajes,
        semaforo: getEstadoPorObjetivo(porcentajeObjetivo),
      };
    })
    .sort((a, b) => {
      const ordenSemaforo = { rojo: 0, amarillo: 1, verde: 2 };
      return (
        ordenSemaforo[a.semaforo] - ordenSemaforo[b.semaforo] ||
        a.id - b.id
      );
    });
}

function getCumplimientoGeneral(clientes) {
  const conDatos = clientes.filter((cliente) => cliente.porcentajes);
  if (conDatos.length === 0) return 0;
  const suma = conDatos.reduce(
    (acc, cliente) => acc + cliente.porcentajes.objetivo,
    0,
  );
  return Math.round(suma / conDatos.length);
}

function getPorcentajesCliente(cliente) {
  return (
    cliente.porcentajes ?? {
      historias: 0,
      feed: 0,
      feedSemana: 0,
      objetivo: 0,
    }
  );
}

function getResumenEquipo(historias, publicaciones, tareas) {
  const hoy = getHoyLocalISO();
  const personas = ["Augusto", "Oriana", "Luciano", "Germán"];

  return personas.map((nombre) => {
    const piezas = [
      ...historias.filter((historia) => historia.responsable === nombre),
      ...publicaciones.filter(
        (publicacion) => publicacion.responsable === nombre,
      ),
    ];
    const items = [...piezas, ...tareas.filter((tarea) => tarea.asignado_a === nombre)];
    const bloqueadas = items.filter((item) => item.estado === "bloqueada");
    const atrasadas = items.filter(
      (item) =>
        item.fecha_programada &&
        item.fecha_programada < hoy &&
        item.estado !== "publicada" &&
        item.estado !== "hecha",
    );
    const piezasDelMes = piezas.filter((pieza) =>
      esDelMesActual(pieza.fecha_programada),
    );
    const cargaTotal = items.length;

    let estado = "Al día";
    if (bloqueadas.length > 0) {
      estado = `${bloqueadas.length} bloqueada${
        bloqueadas.length === 1 ? "" : "s"
      }`;
    } else if (atrasadas.length > 0) {
      estado = `${atrasadas.length} atrasada${
        atrasadas.length === 1 ? "" : "s"
      }`;
    }

    return {
      nombre,
      estado,
      alerta: bloqueadas.length > 0 || atrasadas.length > 0,
      bloqueadas: bloqueadas.length,
      atrasadas: atrasadas.length,
      cargaTotal,
      cumplimiento: calcularPorcentajePublicadas(piezasDelMes),
    };
  });
}

function getAprobacionesLider(tareas) {
  return tareas.filter(
    (tarea) =>
      ["Líder", "Agustín", "Franco"].includes(
        tarea.propiedades_extra?.escalada_a,
      ) &&
      tarea.estado !== ESTADO_FINAL_TAREA,
  );
}

function getEstadoPorObjetivo(objetivo) {
  if (objetivo < 60) return "rojo";
  if (objetivo < 90) return "amarillo";
  return "verde";
}

// Fracción del mes ya transcurrida (0 a 1). Sirve para no tratar igual a un
// cliente sin historias cargadas el día 2 del mes (normal, recién arranca)
// que a uno sin cargar nada el día 20 (alerta real).
function getAvanceDelMes() {
  const hoy = new Date();
  const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  return hoy.getDate() / diasEnMes;
}

function getEstadoHistoriasCliente(total, porcentaje, avanceDelMes = getAvanceDelMes()) {
  if (total === 0) {
    if (avanceDelMes >= 0.6) {
      return { color: "rojo", label: "Sin cargar" };
    }
    if (avanceDelMes >= 0.25) {
      return { color: "amarillo", label: "Sin cargar todavía" };
    }
    return { color: "gris", label: "Recién arranca" };
  }
  if (porcentaje >= 80) {
    return { color: "verde", label: "Al día" };
  }
  if (porcentaje >= 50) {
    return { color: "amarillo", label: "Revisar" };
  }
  return { color: "rojo", label: "Bajo" };
}

const PRIORIDAD_CLIENTES_ADMIN = [
  "rpm",
  "iphone shop",
  "luzin",
  "moketa",
];

function normalizarNombreCliente(nombre = "") {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPrioridadCliente(nombre) {
  const normalizado = normalizarNombreCliente(nombre);
  const index = PRIORIDAD_CLIENTES_ADMIN.findIndex(
    (prioridad) =>
      normalizado === prioridad || normalizado.includes(prioridad),
  );
  return index === -1 ? PRIORIDAD_CLIENTES_ADMIN.length : index;
}

function getResumenClientesActivos(clientes, historias, publicaciones) {
  return clientes
    .map((cliente) => {
      const historiasMes = historias.filter(
        (historia) =>
          historia.cliente_id === cliente.id &&
          esDelMesActual(historia.fecha_programada),
      );
      const publicacionesMes = getPublicacionesDelMismoFeed(
        cliente,
        clientes,
        publicaciones,
      ).filter(
        (publicacion) =>
          esDelMesActual(publicacion.fecha_programada),
      );
      const historiasPublicadas = historiasMes.filter(
        (historia) => historia.estado === "publicada",
      );
      const publicacionesPublicadas = publicacionesMes.filter(
        (publicacion) => publicacion.estado === "publicada",
      );
      const reelsPublicados = publicacionesPublicadas.filter(
        (publicacion) => publicacion.tipo === "reel" || publicacion.tipo === "video",
      ).length;
      const carruselesPublicados = publicacionesPublicadas.filter(
        (publicacion) => publicacion.tipo === "carrusel",
      ).length;
      const porcentajeHistorias = calcularPorcentajePublicadas(historiasMes);
      const estadoHistorias = getEstadoHistoriasCliente(
        historiasMes.length,
        porcentajeHistorias,
      );
      const ultimaHistoriaOk = historiasPublicadas
        .map((historia) => historia.fecha_programada)
        .filter(Boolean)
        .sort()
        .at(-1);

      return {
        ...cliente,
        activo: true,
        porcentajes: {
          historias: porcentajeHistorias,
          feed: calcularPorcentajeCuota(
            reelsPublicados + carruselesPublicados,
            getCuotaFeedMensual(cliente),
          ),
          feedSemana: 0,
          objetivo: porcentajeHistorias,
          historiasPublicadas: historiasPublicadas.length,
          historiasTotal: historiasMes.length,
          feedPublicado: reelsPublicados + carruselesPublicados,
          feedTotal: getCuotaFeedMensual(cliente),
        },
        historiasMes: historiasMes.length,
        historiasPublicadas: historiasPublicadas.length,
        porcentajeHistorias,
        estadoHistorias,
        ultimaHistoriaOk,
        reelsPublicados,
        carruselesPublicados,
        feedCompartido: Boolean(cliente.grupo_feed_id),
      };
    })
    .sort((a, b) => {
      return (
        getPrioridadCliente(a.nombre) - getPrioridadCliente(b.nombre) ||
        a.nombre.localeCompare(b.nombre)
      );
    });
}

function getPiezasAtrasadas(historias, publicaciones) {
  const hoy = getHoyLocalISO();
  const atrasadas = [
    ...historias
      .filter(
        (h) =>
          h.fecha_programada < hoy &&
          h.estado !== "publicada" &&
          h.estado !== "rechazada",
      )
      .map((h) => ({ ...h, tipo: "Historia", origen: "historia" })),
    ...publicaciones
      .filter(
        (p) =>
          p.fecha_programada < hoy &&
          p.estado !== "publicada" &&
          p.estado !== "rechazada",
      )
      .map((p) => ({ ...p, tipo: getTipoPublicacionLabel(p.tipo), origen: "publicacion" })),
  ].sort((a, b) => new Date(a.fecha_programada) - new Date(b.fecha_programada));
  return atrasadas;
}

function getPiezasBloqueadas(historias, publicaciones) {
  const bloqueadas = [
    ...historias
      .filter((h) => h.estado === "bloqueada")
      .map((h) => ({ ...h, tipo: "Historia", origen: "historia" })),
    ...publicaciones
      .filter((p) => p.estado === "bloqueada")
      .map((p) => ({ ...p, tipo: getTipoPublicacionLabel(p.tipo), origen: "publicacion" })),
  ];
  return bloqueadas;
}

// Cualquier tarea encadenada a una tarea padre (tarea_padre_id, ver
// POST /piezas en el backend) que todavía no esté publicada — el caso típico es
// una edición esperando que Germán termine de filmar, pero la relación no
// está limitada a tipo_tarea "edicion".
function esperandoMaterial(tarea) {
  return Boolean(tarea.tarea_padre_id) && tarea.tarea_padre_estado !== ESTADO_FINAL_TAREA;
}

// Ediciones de video frenadas porque la filmación (tarea padre) todavía
// no está publicada — el cuello de botella real detrás de "Luciano atrasado"
// suele ser "Germán no filmó todavía", así que separarlo ayuda a saber a
// quién ir a destrabar.
function getEdicionesEsperandoMaterial(tareas) {
  return tareas.filter(
    (t) => t.tipo_tarea === "edicion" && t.estado !== ESTADO_FINAL_TAREA && esperandoMaterial(t),
  );
}

function getPublicacionesDeHoy(historias, publicaciones) {
  const hoy = getHoyLocalISO();
  const deHoy = [
    ...historias
      .filter((h) => h.fecha_programada && h.fecha_programada.startsWith(hoy))
      .map((h) => ({ ...h, tipo: "Historia", origen: "historia" })),
    ...publicaciones
      .filter((p) => p.fecha_programada && p.fecha_programada.startsWith(hoy))
      .map((p) => ({ ...p, tipo: getTipoPublicacionLabel(p.tipo), origen: "publicacion" })),
  ].sort((a, b) => {
    const timeA = a.fecha_programada.split(" ")[1] || "00:00";
    const timeB = b.fecha_programada.split(" ")[1] || "00:00";
    return timeA.localeCompare(timeB);
  });
  return deHoy;
}

function getTareasParaAsignar(tareas) {
  return tareas
    .filter(
      (t) =>
        t.estado === "pendiente" &&
        (!t.asignado_a ||
          ["Líder", "Agustín", "Franco"].includes(t.asignado_a)),
    )
    .slice(0, 10)
    .sort((a, b) => new Date(a.fecha_vencimiento || 0) - new Date(b.fecha_vencimiento || 0));
}

function getEstadoLabel(estado) {
  return estado.charAt(0).toUpperCase() + estado.slice(1);
}

function getHoyLocalISO() {
  const hoy = new Date();
  const year = hoy.getFullYear();
  const month = String(hoy.getMonth() + 1).padStart(2, "0");
  const day = String(hoy.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getEstadoHistoriaLabel(estado) {
  return estado.replace("_", " ");
}

const ESTADO_FINAL_TAREA = "publicada";
const ESTADO_TAREA_LABELS = {
  pendiente: "Pendiente",
  en_progreso: "En proceso",
  en_revision: "En revisión",
  programada: "Programada",
  publicada: "Publicada",
};

function getEstadoTareaLabel(estado) {
  return ESTADO_TAREA_LABELS[estado] || estado?.replaceAll("_", " ") || "—";
}

const TIPO_PUBLICACION_LABELS = {
  video: "Reel",
  carrusel: "Carrusel",
};

function getTipoPublicacionLabel(tipo) {
  return TIPO_PUBLICACION_LABELS[tipo] || "Reel";
}

function getPublicacionesKanban(publicaciones) {
  const columnas = [
    { estado: "Pendiente", publicaciones: [] },
    { estado: "En progreso", publicaciones: [] },
    { estado: "Corrección", publicaciones: [] },
  ];
  const columnasPorEstado = Object.fromEntries(
    columnas.map((columna) => [columna.estado, columna]),
  );

  publicaciones.forEach((publicacion) => {
    if (publicacion.estado === "en_revision" || publicacion.estado === "lista") {
      columnasPorEstado["En progreso"].publicaciones.push(publicacion);
      return;
    }

    if (
      publicacion.estado === "pendiente" ||
      publicacion.estado === "en_diseño" ||
      publicacion.estado === "bloqueada"
    ) {
      columnasPorEstado.Pendiente.publicaciones.push(publicacion);
    }
  });

  return columnas;
}

const USUARIO_A_RUTA = {
  lider: "/lider",
  augusto: "/augusto",
  luciano: "/luciano",
  german: "/german",
  oriana: "/oriana",
};

const USUARIO_INFO = {
  lider: { nombre: "Líder", rol: "admin" },
  augusto: { nombre: "Augusto", rol: "diseno" },
  luciano: { nombre: "Luciano", rol: "edicion" },
  german: { nombre: "Germán", rol: "produccion" },
  oriana: { nombre: "Oriana", rol: "community" },
};

function getUsuarioKey(usuario) {
  return (usuario || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getRutaUsuario(usuario) {
  const usuarioKey = getUsuarioKey(usuario);
  if (usuarioKey === "agustin") return "/lider";
  return USUARIO_A_RUTA[usuarioKey];
}

function getSesion() {
  const raw = localStorage.getItem("render_sesion");
  if (!raw) {
    return null;
  }
  try {
    const sesion = JSON.parse(raw);
    if (getUsuarioKey(sesion?.usuario?.usuario) === "franco") {
      localStorage.removeItem("render_sesion");
      return null;
    }
    if (getUsuarioKey(sesion?.usuario?.usuario) === "agustin") {
      return {
        ...sesion,
        usuario: { ...sesion.usuario, usuario: "lider", nombre: "Líder" },
      };
    }
    return sesion;
  } catch {
    return null;
  }
}

function getSesionDelPath(path) {
  const usuarioMatch = Object.entries(USUARIO_A_RUTA).find(([, ruta]) => ruta === path);
  if (!usuarioMatch) {
    return getSesion();
  }
  const usuario = usuarioMatch[0];
  const info = USUARIO_INFO[usuario];
  if (!info) {
    return getSesion();
  }
  return {
    token: null,
    usuario: {
      usuario: usuario,
      nombre: info.nombre,
      rol: info.rol,
    },
  };
}

function guardarSesion(token, usuario) {
  localStorage.setItem("render_sesion", JSON.stringify({ token, usuario }));
}

function inicialesUsuario(nombre) {
  return (nombre || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join("")
    .toUpperCase();
}

function cerrarSesion() {
  localStorage.removeItem("render_sesion");
  window.location.href = "/login";
}

function LoginPage() {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  const handleSubmit = (event) => {
    event.preventDefault();
    setError(null);
    setCargando(true);

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, password }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo iniciar sesión.");
        }
        return data;
      })
      .then((data) => {
        guardarSesion(data.token, data.usuario);
        const destino = getRutaUsuario(data.usuario.usuario) || "/";
        window.location.href = destino;
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setCargando(false);
      });
  };


  return (
    <main className="login-main" aria-label="Render platform login">
      <section className="login-card" aria-label="Inicio de sesión RENDER">
        <div className="login-brand">
          <div className="login-logo">RENDER</div>
          <div className="login-title">Sistema interno</div>
          <p>Ingresá con tu usuario asignado para ver tu tablero de trabajo.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form login-form-card">
          <label className="login-field">
            <span className="detail-label">Usuario</span>
            <input
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoCapitalize="none"
              autoComplete="username"
              placeholder="lider"
              required
              spellCheck={false}
            />
          </label>
          <label className="login-field">
            <span className="detail-label">Contraseña</span>
            <div className="password-input-wrap">
              <input
                type={mostrarPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoCapitalize="none"
                autoComplete="current-password"
                placeholder="Contraseña"
                required
                spellCheck={false}
              />
              <button
                aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="password-toggle"
                onClick={() => setMostrarPassword((valor) => !valor)}
                title={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                type="button"
              >
                {mostrarPassword ? "◐" : "👁"}
              </button>
            </div>
          </label>

          {error && <div className="caption login-error">{error}</div>}

          <button className="btn primary login-submit" type="submit" disabled={cargando}>
            {cargando ? "Ingresando..." : "Ingresar al sistema"}
          </button>
        </form>
      </section>
    </main>
  );
}

const RESPONSABLES = [
  "Líder",
  "Augusto",
  "Luciano",
  "Germán",
  "Oriana",
];

function NuevaTareaPage() {
  const [clientes, setClientes] = useState([]);
  const [titulo, setTitulo] = useState("");
  const [asignadoA, setAsignadoA] = useState("Augusto");
  const [clienteId, setClienteId] = useState("");
  const [estado, setEstado] = useState("pendiente");
  const [sector, setSector] = useState("");
  const [subtipo, setSubtipo] = useState("");
  const [prioridad, setPrioridad] = useState("media");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [requiereAprobacion, setRequiereAprobacion] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch("/api/clientes")
      .then((response) => response.json())
      .then(setClientes)
      .catch(() => setError("No se pudieron cargar los clientes."));
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    setMensaje(null);
    setError(null);
    setEnviando(true);

    fetch("/api/tareas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo,
        asignado_a: asignadoA,
        cliente_id: clienteId ? Number(clienteId) : null,
        estado,
        tipo_tarea: sector || null,
        subtipo: subtipo || null,
        prioridad,
        requiere_aprobacion: requiereAprobacion,
        fecha_vencimiento: fechaVencimiento || null,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo crear la tarea.");
        }
        return data;
      })
      .then((data) => {
        setMensaje(`Tarea creada: "${data.titulo}" asignada a ${data.asignado_a}.`);
        setTitulo("");
        setClienteId("");
        setEstado("pendiente");
        setSector("");
        setSubtipo("");
        setPrioridad("media");
        setFechaVencimiento("");
        setRequiereAprobacion(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setEnviando(false));
  };

  return (
    <main aria-label="Render platform nueva tarea">
      <div className="frame">
        <div className="content">
          <div className="section-label">Cargar tarea y asignar responsable</div>
          <div className="box">
            <form onSubmit={handleSubmit}>
              <div className="form-section-title">Qué hay que hacer</div>
              <div className="form-grid">
                <label className="form-field">
                  <span>Título de la tarea *</span>
                  <input
                    type="text"
                    value={titulo}
                    placeholder="Ej: Reel testimonio cliente"
                    onChange={(e) => setTitulo(e.target.value)}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Cliente</span>
                  <select
                    value={clienteId}
                    onChange={(e) => setClienteId(e.target.value)}
                  >
                    <option value="">Sin cliente asociado</option>
                    {clientes.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {cliente.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Sector</span>
                  <select value={sector} onChange={(e) => setSector(e.target.value)}>
                    <option value="">Sin sector</option>
                    {SECTORES_TAREA.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Subtipo</span>
                  <input
                    type="text"
                    value={subtipo}
                    placeholder="reel, historia, carrusel, visita…"
                    onChange={(e) => setSubtipo(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-section-title">Asignación y plazo</div>
              <div className="form-grid cols-2">
                <label className="form-field">
                  <span>Responsable *</span>
                  <select
                    value={asignadoA}
                    onChange={(e) => setAsignadoA(e.target.value)}
                  >
                    {RESPONSABLES.map((nombre) => (
                      <option key={nombre} value={nombre}>
                        {nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Vence el</span>
                  <input
                    type="date"
                    value={fechaVencimiento}
                    onChange={(e) => setFechaVencimiento(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Estado inicial</span>
                  <select
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="en_progreso">En proceso</option>
                    <option value="en_revision">En revisión</option>
                    <option value="publicada">Publicada</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Prioridad</span>
                  <select
                    value={prioridad}
                    onChange={(e) => setPrioridad(e.target.value)}
                  >
                    {PRIORIDADES_TAREA.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </label>
                <label
                  className="form-field"
                  style={{ flexDirection: "row", alignItems: "center", gap: "8px", marginTop: "18px" }}
                >
                  <input
                    type="checkbox"
                    checked={requiereAprobacion}
                    onChange={(e) => setRequiereAprobacion(e.target.checked)}
                  />
                  <span style={{ textTransform: "none" }}>
                    Requiere aprobación del Líder
                  </span>
                </label>
              </div>

              {error && <div className="caption login-error">{error}</div>}
              {mensaje && (
                <div className="caption" style={{ color: "#333", fontWeight: "bold" }}>
                  {mensaje}
                </div>
              )}

              <div style={{ marginTop: "14px" }}>
                <button className="btn primary" type="submit" disabled={enviando}>
                  {enviando ? "Creando..." : "Crear tarea"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

function TareasAsignadasGenericas({ nombre, nombres, tipoTarea, titulo }) {
  const [tareas, setTareas] = useState([]);
  const [error, setError] = useState(null);
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";
  const responsables = nombres?.length ? nombres : [nombre];

  const cargarTareas = () => {
    Promise.all(
      responsables.map((responsable) => {
        const params = new URLSearchParams({ asignado_a: responsable });
        if (tipoTarea) params.set("tipo_tarea", tipoTarea);
        return fetch(`/api/tareas?${params.toString()}`).then((response) =>
          response.json(),
        );
      }),
    )
      .then((listas) => {
        const propias = [
          ...new Map(listas.flat().map((tarea) => [tarea.id, tarea])).values(),
        ];
        setTareas(
          propias
            .slice()
            .sort((a, b) => (a.fecha_vencimiento || "").localeCompare(b.fecha_vencimiento || "")),
        );
      })
      .catch(() => setError("No se pudieron cargar las tareas asignadas."));
  };

  useEffect(() => {
    cargarTareas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nombre, tipoTarea, nombres?.join("|")]);

  const cambiarEstado = (tareaId, nuevoEstado) => {
    fetch(`/api/tareas/${tareaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevoEstado }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo actualizar el estado.");
        }
        return response.json();
      })
      .then(() => cargarTareas())
      .catch(() => setError("No se pudo actualizar el estado."));
  };

  return (
    <>
      <div className="section-label">{titulo || "Tareas asignadas"}</div>
      <div className="box">
        {error && <div className="caption">{error}</div>}
        {!error &&
          tareas.map((tarea) => {
            const bloqueaCierre = tarea.requiere_aprobacion && !esAdmin;
            const material = tarea.propiedades_extra?.material || tarea.propiedades_extra?.Material;
            const feedback = tarea.propiedades_extra?.feedback || tarea.propiedades_extra?.motivo_bloqueo;

            return (
              <div className="card" key={`tarea-generica-${tarea.id}`}>
                <div className="cliente">
                  {tarea.cliente_nombre ?? "Sin cliente"}
                </div>
                <div>{tarea.titulo}</div>
                <div className="meta">
                  {tarea.fecha_vencimiento && (
                    <>
                      Vence: {tarea.fecha_vencimiento}
                      {tarea.fecha_vencimiento < getHoyLocalISO() &&
                        tarea.estado !== ESTADO_FINAL_TAREA && (
                          <span
                            className="tag atraso"
                            style={{ marginLeft: "6px" }}
                          >
                            Atrasada
                          </span>
                        )}
                    </>
                  )}
                  {tarea.prioridad && tarea.prioridad !== "media" && (
                    <span
                      className={`tag ${tarea.prioridad === "alta" ? "atraso" : "operativa"}`}
                      style={{ marginLeft: "6px" }}
                    >
                      Prioridad {tarea.prioridad}
                    </span>
                  )}
                </div>
                {material && (
                  <div className="meta">Material: {material}</div>
                )}
                {feedback && (
                  <div className="meta">Feedback: {feedback}</div>
                )}
                <div className="meta">
                  {tarea.requiere_aprobacion && (
                    <span className="tag creativa">Requiere aprobación</span>
                  )}
                </div>
                <div className="meta">
                  <select
                    value={tarea.estado}
                    onChange={(e) => cambiarEstado(tarea.id, e.target.value)}
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="en_progreso">En proceso</option>
                    <option value="en_revision">En revisión</option>
                    <option value="publicada" disabled={bloqueaCierre}>
                      {bloqueaCierre
                        ? "Publicada (requiere aprobación de admin)"
                        : "Publicada"}
                    </option>
                  </select>
                </div>
              </div>
            );
          })}
        {!error && tareas.length === 0 && (
          <div className="caption">No hay tareas asignadas por ahora.</div>
        )}
        <div className="caption">
          → Podés cambiar el estado directo desde acá. Las tareas que requieren
          aprobación no se pueden marcar "Publicada" salvo que quien esté logueado
          sea Líder.
        </div>
      </div>
    </>
  );
}

// ── TAREAS: tablero operativo real, sobre la tabla `tareas` (no el UNION
// de historias+publicaciones que usa PiezasTableroPage más abajo) ────────

// Colores pensados para fondo oscuro (Tareas es la única sección de
// Sistema Render en modo oscuro, ver .tareas-viewport en styles.css) —
// estas constantes son exclusivas del módulo Tareas, no se usan en
// ningún lugar claro de la app (confirmado: NuevaTareaPage solo usa
// .label, no .bg/.fg).
const SECTORES_TAREA = [
  { id: "diseno", label: "Diseño", bg: "#2a1f33", fg: "#ce93d8" },
  { id: "produccion", label: "Producción", bg: "#0f2b28", fg: "#4db6ac" },
  { id: "edicion", label: "Edición", bg: "#17233a", fg: "#64b5f6" },
  { id: "community", label: "Community", bg: "#331825", fg: "#f06292" },
];

const ESTADOS_TAREA = [
  { id: "pendiente", label: "Pendiente", bg: "#24272b", fg: "#90a4ae" },
  { id: "en_progreso", label: "En proceso", bg: "#17233a", fg: "#64b5f6" },
  { id: "en_revision", label: "En revisión", bg: "#332413", fg: "#ffb74d" },
  { id: "publicada", label: "Publicada", bg: "#123320", fg: "#66bb6a" },
];

const PRIORIDADES_TAREA = [
  { id: "alta", label: "Alta", bg: "#331616", fg: "#ef5350" },
  { id: "media", label: "Media", bg: "#332413", fg: "#ffb74d" },
  { id: "baja", label: "Baja", bg: "#123320", fg: "#66bb6a" },
];

function getSectorTarea(id) {
  return SECTORES_TAREA.find((s) => s.id === id);
}
function getEstadoTarea(id) {
  return ESTADOS_TAREA.find((e) => e.id === id) || ESTADOS_TAREA[0];
}
function getPrioridadTarea(id) {
  return PRIORIDADES_TAREA.find((p) => p.id === id) || PRIORIDADES_TAREA[1];
}

const ORDEN_PRIORIDAD_TAREA = { alta: 0, media: 1, baja: 2 };

function ordenarTareasPorPrioridad(tareas) {
  return [...tareas].sort((a, b) => {
    const prioridad =
      (ORDEN_PRIORIDAD_TAREA[a.prioridad] ?? 1) -
      (ORDEN_PRIORIDAD_TAREA[b.prioridad] ?? 1);
    if (prioridad !== 0) return prioridad;
    return (a.fecha_vencimiento || "9999-12-31").localeCompare(
      b.fecha_vencimiento || "9999-12-31",
    );
  });
}

function TareasTableroPage() {
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";

  const [tareas, setTareas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [tareaSeleccionadaId, setTareaSeleccionadaId] = useState(null);
  const [vista, setVista] = useState("kanban");
  const [mostrarWizard, setMostrarWizard] = useState(false);
  const [filtroSector, setFiltroSector] = useState("todos");
  const [filtroResponsable, setFiltroResponsable] = useState("todos");
  const [mostrarCompletadas, setMostrarCompletadas] = useState(false);

  const cargarTareas = () => {
    setCargando(true);
    fetch("/api/tareas")
      .then((r) => r.json())
      .then((data) => {
        setTareas(Array.isArray(data) ? data : []);
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando tareas", err);
        setError("No se pudieron cargar las tareas.");
      })
      .finally(() => setCargando(false));
  };

  useEffect(cargarTareas, []);
  useEffect(() => {
    fetch("/api/clientes")
      .then((r) => r.json())
      .then((data) => setClientes(Array.isArray(data) ? data : []))
      .catch((err) => console.error("No se pudieron cargar clientes", err));
  }, []);

  const hoyISO = getHoyLocalISO();

  const responsablesDisponibles = [
    ...new Set([
      ...RESPONSABLES_EQUIPO,
      ...tareas.map((t) => t.asignado_a).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const tareasDelResponsable = tareas.filter(
    (t) =>
      filtroResponsable === "todos" ||
      t.asignado_a === filtroResponsable,
  );

  const tareasFiltradas = ordenarTareasPorPrioridad(tareasDelResponsable.filter((t) => {
    if (filtroSector !== "todos" && t.tipo_tarea !== filtroSector) return false;
    if (!mostrarCompletadas && t.estado === ESTADO_FINAL_TAREA) return false;
    return true;
  }));

  const fechaLimiteSemana = new Date();
  fechaLimiteSemana.setDate(fechaLimiteSemana.getDate() + 7);
  const fechaLimiteSemanaISO = [
    fechaLimiteSemana.getFullYear(),
    String(fechaLimiteSemana.getMonth() + 1).padStart(2, "0"),
    String(fechaLimiteSemana.getDate()).padStart(2, "0"),
  ].join("-");
  const tareasVencenSemana = tareasFiltradas.filter(
    (t) =>
      t.fecha_vencimiento &&
      t.fecha_vencimiento >= hoyISO &&
      t.fecha_vencimiento <= fechaLimiteSemanaISO &&
      t.estado !== ESTADO_FINAL_TAREA,
  ).length;
  const tareasAtrasadas = tareasFiltradas.filter(
    (t) =>
      t.fecha_vencimiento &&
      t.fecha_vencimiento < hoyISO &&
      t.estado !== ESTADO_FINAL_TAREA,
  ).length;
  const tareasEnRevision = tareasFiltradas.filter(
    (t) => t.estado === "en_revision",
  ).length;
  const hayFiltros =
    filtroResponsable !== "todos" || filtroSector !== "todos" || mostrarCompletadas;

  const grupos = ESTADOS_TAREA.map((e) => ({
    id: e.id,
    titulo: e.label,
    tareas: tareasFiltradas.filter((t) => t.estado === e.id),
  })).filter((grupo) => grupo.tareas.length > 0);

  const actualizarLocal = (id, campos) => {
    setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, ...campos } : t)));
  };

  const guardarEnServidor = async (id, campos) => {
    try {
      const res = await fetch(`/api/tareas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
      const actualizada = await res.json();
      setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, ...actualizada } : t)));
    } catch (err) {
      console.error("Error guardando tarea", err);
      setError("No se pudo guardar un cambio — reintentá.");
    }
  };

  const actualizarCampo = (id, campos) => {
    actualizarLocal(id, campos);
    guardarEnServidor(id, campos);
  };

  const eliminarTarea = async (id) => {
    if (!window.confirm("¿Eliminar esta tarea? No se puede deshacer.")) return;
    try {
      const res = await fetch(`/api/tareas/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setTareas((prev) => prev.filter((t) => t.id !== id));
      setTareaSeleccionadaId((actual) => (actual === id ? null : actual));
    } catch (err) {
      console.error("Error eliminando tarea", err);
      setError("No se pudo eliminar la tarea.");
    }
  };

  const tareaSeleccionada = tareas.find((t) => t.id === tareaSeleccionadaId) || null;

  return (
    <main aria-label="Render platform tareas" className="tareas-viewport">
      <div className="frame">
        <div className="content">
          <div className="h-workspace">
            <div className="h-main">
              <div className="task-page-heading">
                <div>
                  <h1>Tareas</h1>
                  <p>Organizá, asigná y revisá el trabajo del equipo.</p>
                </div>
                {esAdmin && (
                  <button className="btn task-new-button" type="button" onClick={() => setMostrarWizard(true)}>
                    + Nueva tarea
                  </button>
                )}
              </div>

              <div className="h-toolbar task-toolbar-simplified">
                <div className="sheet-view-tabs task-view-tabs">
                  <button type="button" className={vista === "tabla" ? "active" : ""} onClick={() => setVista("tabla")}>Lista</button>
                  <button type="button" className={vista === "kanban" ? "active" : ""} onClick={() => setVista("kanban")}>Columnas</button>
                  <button type="button" className={vista === "calendario" ? "active" : ""} onClick={() => setVista("calendario")}>Calendario</button>
                  <button type="button" className={vista === "proyecto" ? "active" : ""} onClick={() => setVista("proyecto")}>Por cliente</button>
                </div>

                <label className="task-compact-filter">
                  <span>Responsable</span>
                  <select
                    value={filtroResponsable}
                    onChange={(e) => setFiltroResponsable(e.target.value)}
                  >
                    <option value="todos">Todos los usuarios</option>
                    {responsablesDisponibles.map((nombre) => (
                      <option key={nombre} value={nombre}>
                        {nombre}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="task-compact-filter">
                  <span>Sector</span>
                  <select
                    value={filtroSector}
                    onChange={(e) => setFiltroSector(e.target.value)}
                  >
                    <option value="todos">Todos los sectores</option>
                    {SECTORES_TAREA.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="task-completed-toggle">
                  <input
                    type="checkbox"
                    checked={mostrarCompletadas}
                    onChange={(e) => setMostrarCompletadas(e.target.checked)}
                  />
                  <span>Mostrar completadas</span>
                </label>

                {hayFiltros && (
                  <button
                    className="btn task-clear-filters"
                    type="button"
                    onClick={() => {
                      setFiltroResponsable("todos");
                      setFiltroSector("todos");
                      setMostrarCompletadas(false);
                    }}
                  >
                    Limpiar
                  </button>
                )}
              </div>

              <div className="task-compact-summary" aria-label="Resumen de tareas filtradas">
                <span><strong>{tareasFiltradas.length}</strong> tareas</span>
                <i aria-hidden="true" />
                <span><strong>{tareasVencenSemana}</strong> vencen esta semana</span>
                <i aria-hidden="true" />
                <span className={tareasAtrasadas > 0 ? "is-alert" : ""}><strong>{tareasAtrasadas}</strong> atrasadas</span>
                <i aria-hidden="true" />
                <span><strong>{tareasEnRevision}</strong> en revisión</span>
              </div>

              <div className="h-body">
                {error && (
                  <div style={{ padding: "10px", background: "#331616", color: "#ef5350", borderRadius: "4px", marginBottom: "12px" }}>
                    {error}
                  </div>
                )}

                {cargando ? (
                  <div style={{ textAlign: "center", padding: "40px", color: "#6b6f76" }}>Cargando tareas…</div>
                ) : vista === "kanban" ? (
                  <TareaKanbanBoard
                    tareas={tareasFiltradas}
                    columnas={ESTADOS_TAREA}
                    campo="estado"
                    onMover={(id, nuevoEstado) => actualizarCampo(id, { estado: nuevoEstado })}
                    onAbrir={setTareaSeleccionadaId}
                  />
                ) : vista === "calendario" ? (
                  <TareaCalendario tareas={tareasFiltradas} onAbrir={setTareaSeleccionadaId} />
                ) : vista === "proyecto" ? (
                  <TareasPorCliente tareas={tareasFiltradas} onAbrir={setTareaSeleccionadaId} />
                ) : grupos.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px", color: "#6b6f76" }}>
                    {tareas.length === 0
                      ? "No hay tareas todavía."
                      : "Ninguna tarea coincide con estos filtros."}
                  </div>
                ) : (
                  <div className="sheet-frame task-list-frame">
                    <table className="sheet-table task-list-table">
                      <thead>
                        <tr>
                          <th>Tarea</th>
                          <th>Responsable</th>
                          <th>Estado</th>
                          <th>Vencimiento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupos.map((grupo) => (
                          <React.Fragment key={grupo.id}>
                            <tr>
                              <td colSpan={4} className="task-list-group">
                                {grupo.titulo} <span style={{ color: "#6b6f76", fontWeight: 400 }}>({grupo.tareas.length})</span>
                              </td>
                            </tr>
                            {grupo.tareas.map((t) => {
                              const est = getEstadoTarea(t.estado);
                              const prio = getPrioridadTarea(t.prioridad);
                              const sector = getSectorTarea(t.tipo_tarea);
                              const vencida = t.fecha_vencimiento && t.fecha_vencimiento < hoyISO && t.estado !== ESTADO_FINAL_TAREA;

                              return (
                                <tr key={t.id} className="task-list-row" onClick={() => setTareaSeleccionadaId(t.id)}>
                                  <td className="task-list-main">
                                    <strong>{t.titulo}</strong>
                                    <div>
                                      <span>{t.cliente_nombre || "Sin cliente"}</span>
                                      {sector && <span>{sector.label}</span>}
                                      {t.prioridad === "alta" && (
                                        <span style={{ color: prio.fg }}>Prioridad alta</span>
                                      )}
                                    </div>
                                    {esperandoMaterial(t) && (
                                      <small className="task-list-material">Esperando material</small>
                                    )}
                                  </td>
                                  <td><span className="task-list-person">{t.asignado_a}</span></td>
                                  <td><span className="task-list-status" style={{ color: est.fg, background: est.bg }}>{est.label}</span></td>
                                  <td className={vencida ? "task-list-due is-overdue" : "task-list-due"}>
                                    {formatearFechaTarea(t.fecha_vencimiento)}
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {tareaSeleccionada && (
              <TareaDetallePanel
                tarea={tareaSeleccionada}
                clientes={clientes}
                tareas={tareas}
                onCerrar={() => setTareaSeleccionadaId(null)}
                onAbrir={setTareaSeleccionadaId}
                onActualizarCampo={actualizarCampo}
                onEliminar={eliminarTarea}
                onSubtareaCreada={(creada) => {
                  const clienteNombre = clientes.find((c) => c.id === creada.cliente_id)?.nombre || null;
                  setTareas((prev) => [{ ...creada, cliente_nombre: clienteNombre }, ...prev]);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {mostrarWizard && (
        <NuevaTareaWizard
          clientes={clientes}
          onCerrar={() => setMostrarWizard(false)}
          onCreada={(creada) => {
            const clienteNombre = clientes.find((c) => c.id === creada.cliente_id)?.nombre || null;
            const tareaCompleta = { ...creada, cliente_nombre: clienteNombre };
            setTareas((prev) => [tareaCompleta, ...prev]);
            setMostrarWizard(false);
            setTareaSeleccionadaId(creada.id);
          }}
        />
      )}
    </main>
  );
}

const URL_EN_TAREA_REGEX = /(https?:\/\/[^\s<>"')\]]+)/gi;

function limpiarUrlTarea(url = "") {
  return url.replace(/[.,;:!?]+$/, "");
}

function extraerUrlsTarea(texto = "") {
  return [...texto.matchAll(URL_EN_TAREA_REGEX)]
    .map((coincidencia) => limpiarUrlTarea(coincidencia[0]))
    .filter(Boolean);
}

function renderizarTextoTarea(texto = "") {
  return texto.split(URL_EN_TAREA_REGEX).map((parte, indice) => {
    if (!/^https?:\/\//i.test(parte)) {
      return <React.Fragment key={`texto-${indice}`}>{parte}</React.Fragment>;
    }

    const url = limpiarUrlTarea(parte);
    const sufijo = parte.slice(url.length);
    return (
      <React.Fragment key={`link-${indice}`}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
        {sufijo}
      </React.Fragment>
    );
  });
}

function obtenerInfoLinkTarea(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("instagram.com")) {
      return { etiqueta: "Ver referencia de Instagram", dominio: "Instagram", tipo: "referencia" };
    }
    if (host.includes("tiktok.com")) {
      return { etiqueta: "Ver referencia de TikTok", dominio: "TikTok", tipo: "referencia" };
    }
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      return { etiqueta: "Ver referencia de YouTube", dominio: "YouTube", tipo: "referencia" };
    }
    if (host.includes("drive.google.com")) {
      return { etiqueta: "Abrir carpeta de Drive", dominio: "Google Drive", tipo: "material" };
    }
    if (host.includes("docs.google.com")) {
      return { etiqueta: "Abrir documento", dominio: "Google Docs", tipo: "material" };
    }
    return { etiqueta: "Abrir enlace", dominio: host, tipo: "referencia" };
  } catch {
    return { etiqueta: "Abrir enlace", dominio: "Enlace externo", tipo: "referencia" };
  }
}

function formatearFechaTarea(fecha) {
  if (!fecha) return "Sin vencimiento";
  const [anio, mes, dia] = String(fecha).slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia) return fecha;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(anio, mes - 1, dia));
}

function TareaDetallePanel({
  tarea,
  clientes,
  tareas,
  onCerrar,
  onAbrir,
  onActualizarCampo,
  onEliminar,
  onSubtareaCreada,
}) {
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";
  const esResponsable =
    getUsuarioKey(tarea.asignado_a) === getUsuarioKey(sesion?.usuario?.usuario);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [comentarios, setComentarios] = useState([]);
  const [comentarioNuevo, setComentarioNuevo] = useState("");
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const [tituloSubtarea, setTituloSubtarea] = useState("");
  const [creandoSubtarea, setCreandoSubtarea] = useState(false);
  const est = getEstadoTarea(tarea.estado);
  const prio = getPrioridadTarea(tarea.prioridad);
  const sector = getSectorTarea(tarea.tipo_tarea);
  const urlsAclaraciones = [...new Set(extraerUrlsTarea(tarea.aclaraciones || ""))];
  const materialUrl = tarea.material_referencia || "";
  const materialInfo = materialUrl ? obtenerInfoLinkTarea(materialUrl) : null;
  const referencias = urlsAclaraciones.filter((url) => url !== materialUrl);
  const resumen = tarea.propiedades_extra?.resumen || "";
  const etiquetas = Array.isArray(tarea.propiedades_extra?.etiquetas)
    ? tarea.propiedades_extra.etiquetas
    : [];
  const colaboradores = Array.isArray(tarea.propiedades_extra?.colaboradores)
    ? tarea.propiedades_extra.colaboradores
    : [];
  const subtareas = ordenarTareasPorPrioridad(
    tareas.filter((item) => Number(item.tarea_padre_id) === Number(tarea.id)),
  );
  if (materialUrl && materialInfo?.tipo !== "material" && !referencias.includes(materialUrl)) {
    referencias.unshift(materialUrl);
  }

  useEffect(() => {
    setModoEdicion(false);
    setComentarioNuevo("");
    setTituloSubtarea("");
    fetch(`/api/tareas/${tarea.id}/comentarios`)
      .then((respuesta) => respuesta.json())
      .then((data) => setComentarios(Array.isArray(data) ? data : []))
      .catch((error) => console.error("No se pudieron cargar comentarios", error));
  }, [tarea.id]);

  useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    const overscrollAnterior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = overflowAnterior;
      document.body.style.overscrollBehavior = overscrollAnterior;
    };
  }, []);

  const actualizarMetadatos = (campos) => {
    onActualizarCampo(tarea.id, {
      propiedades_extra: { ...tarea.propiedades_extra, ...campos },
    });
  };

  const enviarComentario = async () => {
    const contenido = comentarioNuevo.trim();
    if (!contenido || enviandoComentario) return;
    setEnviandoComentario(true);
    try {
      const respuesta = await fetch(`/api/tareas/${tarea.id}/comentarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autor: sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER",
          contenido,
        }),
      });
      const data = await respuesta.json();
      if (!respuesta.ok) throw new Error(data.error || "No se pudo comentar.");
      setComentarios((actuales) => [...actuales, data]);
      setComentarioNuevo("");
    } catch (error) {
      console.error("No se pudo guardar el comentario", error);
    } finally {
      setEnviandoComentario(false);
    }
  };

  const crearSubtarea = async () => {
    const titulo = tituloSubtarea.trim();
    if (!titulo || creandoSubtarea) return;
    setCreandoSubtarea(true);
    try {
      const respuesta = await fetch("/api/tareas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          asignado_a: tarea.asignado_a,
          cliente_id: tarea.cliente_id,
          tipo_tarea: tarea.tipo_tarea,
          prioridad: tarea.prioridad,
          tarea_padre_id: tarea.id,
        }),
      });
      const creada = await respuesta.json();
      if (!respuesta.ok) throw new Error(creada.error || "No se pudo crear la subtarea.");
      onSubtareaCreada(creada);
      setTituloSubtarea("");
    } catch (error) {
      console.error("No se pudo crear la subtarea", error);
    } finally {
      setCreandoSubtarea(false);
    }
  };

  const origen = tarea.historia_id
    ? {
        tipo: "Historia",
        fecha: tarea.historia_fecha_programada,
        estado: tarea.historia_estado,
        href: "/planificacion-historias",
      }
    : tarea.publicacion_id
      ? {
          tipo: getTipoPublicacionLabel(tarea.publicacion_tipo),
          fecha: tarea.publicacion_fecha_programada,
          estado: tarea.publicacion_estado,
          href: "/planificacion-publicaciones",
        }
      : null;

  return (
    <>
      <div className="td-panel-backdrop" onMouseDown={onCerrar} aria-hidden="true" />
      <aside className={`td-panel td-panel-readable ${modoEdicion ? "is-editing" : "is-reading"}`}>
        <header className="td-readable-header">
          <div className="td-readable-header-top">
            <div className="td-readable-kicker">
              {sector && (
                <span className={`td-readable-sector sector-${sector.id}`}>
                  {sector.label}
                </span>
              )}
              <span>{tarea.cliente_nombre || "Sin cliente"}</span>
            </div>
            <div className="td-readable-header-actions">
              {esAdmin && (
                <button
                  className="btn td-edit-toggle"
                  type="button"
                  onClick={() => setModoEdicion((actual) => !actual)}
                >
                  {modoEdicion ? "Ver tarea" : "Editar tarea"}
                </button>
              )}
              <button
                type="button"
                className="td-readable-close"
                onClick={onCerrar}
                title="Cerrar"
                aria-label="Cerrar tarea"
              >
                ✕
              </button>
            </div>
          </div>

          {modoEdicion ? (
            <input
              type="text"
              className="sheet-cell td-panel-title"
              value={tarea.titulo}
              onChange={(e) => onActualizarCampo(tarea.id, { titulo: e.target.value })}
              onBlur={(e) => onActualizarCampo(tarea.id, { titulo: e.target.value.trim() })}
            />
          ) : (
            <>
              <h2>{tarea.titulo}</h2>
              {resumen && <p className="td-readable-description">{resumen}</p>}
              {etiquetas.length > 0 && (
                <div className="td-task-tags">
                  {etiquetas.map((etiqueta) => <span key={etiqueta}>{etiqueta}</span>)}
                </div>
              )}
            </>
          )}

          {!modoEdicion && (
            <div className="td-readable-summary">
              <div>
                <span>Responsable</span>
                <strong>{tarea.asignado_a}</strong>
              </div>
              <div>
                <span>Vencimiento</span>
                <strong>{formatearFechaTarea(tarea.fecha_vencimiento)}</strong>
              </div>
              <div>
                <span>Prioridad</span>
                <strong style={{ color: prio.fg }}>{prio.label}</strong>
              </div>
              <div>
                <span>Estado</span>
                <strong style={{ color: est.fg }}>{est.label}</strong>
              </div>
              {colaboradores.length > 0 && (
                <div className="td-summary-wide">
                  <span>Colaboran</span>
                  <strong>{colaboradores.join(", ")}</strong>
                </div>
              )}
            </div>
          )}
        </header>

        {esperandoMaterial(tarea) && (
          <div className="td-panel-banner">
            Esperando material — la tarea de filmación todavía no está marcada como publicada.
          </div>
        )}

        {modoEdicion ? (
          <>
            <div className="td-panel-body td-edit-form">
              <label className="td-panel-field">
                <span>Responsable principal</span>
                <select
                  className="sheet-cell"
                  value={tarea.asignado_a}
                  onChange={(e) => onActualizarCampo(tarea.id, { asignado_a: e.target.value })}
                >
                  {RESPONSABLES_EQUIPO.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field td-edit-wide">
                <span>Resumen corto</span>
                <input
                  type="text"
                  className="sheet-cell"
                  placeholder="Una línea para entender la tarea rápidamente"
                  value={resumen}
                  onChange={(e) => actualizarMetadatos({ resumen: e.target.value })}
                />
              </label>

              <label className="td-panel-field td-edit-wide">
                <span>Etiquetas (separadas por coma)</span>
                <input
                  type="text"
                  className="sheet-cell"
                  placeholder="Mejora, Sitio web, Urgente"
                  value={etiquetas.join(", ")}
                  onChange={(e) => actualizarMetadatos({
                    etiquetas: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                  })}
                />
              </label>

              <fieldset className="td-panel-field td-edit-wide td-collaborators">
                <legend>Colaboradores</legend>
                <div>
                  {RESPONSABLES_EQUIPO.filter((nombre) => nombre !== tarea.asignado_a).map((nombre) => (
                    <label key={nombre}>
                      <input
                        type="checkbox"
                        checked={colaboradores.includes(nombre)}
                        onChange={(e) => actualizarMetadatos({
                          colaboradores: e.target.checked
                            ? [...colaboradores, nombre]
                            : colaboradores.filter((item) => item !== nombre),
                        })}
                      />
                      <span>{nombre}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="td-panel-field">
                <span>Cliente</span>
                <select
                  className="sheet-cell"
                  value={tarea.cliente_id ?? ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { cliente_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Sin cliente</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field">
                <span>Sector</span>
                <select
                  className="sheet-cell"
                  value={tarea.tipo_tarea ?? ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { tipo_tarea: e.target.value || null })}
                  style={sector ? { background: sector.bg, color: sector.fg, fontWeight: "600" } : undefined}
                >
                  <option value="">Sin sector</option>
                  {SECTORES_TAREA.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field">
                <span>Subtipo</span>
                <input
                  type="text"
                  className="sheet-cell"
                  placeholder="reel, historia, carrusel, visita…"
                  value={tarea.subtipo || ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { subtipo: e.target.value || null })}
                />
              </label>

              <label className="td-panel-field">
                <span>Estado</span>
                <select
                  className="sheet-cell"
                  value={tarea.estado}
                  onChange={(e) => onActualizarCampo(tarea.id, { estado: e.target.value })}
                  style={{ background: est.bg, color: est.fg, fontWeight: "600" }}
                >
                  {ESTADOS_TAREA.map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field">
                <span>Prioridad</span>
                <select
                  className="sheet-cell"
                  value={tarea.prioridad}
                  onChange={(e) => onActualizarCampo(tarea.id, { prioridad: e.target.value })}
                  style={{ background: prio.bg, color: prio.fg, fontWeight: "600" }}
                >
                  {PRIORIDADES_TAREA.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>

              <label className="td-panel-field">
                <span>Vencimiento</span>
                <input
                  type="date"
                  className="sheet-cell"
                  value={tarea.fecha_vencimiento || ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { fecha_vencimiento: e.target.value || null })}
                />
              </label>

              <label className="td-panel-field td-edit-brief">
                <span>Guion / indicaciones</span>
                <textarea
                  className="sheet-cell sheet-cell-textarea"
                  rows={12}
                  value={tarea.aclaraciones || ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { aclaraciones: e.target.value })}
                  onBlur={(e) => onActualizarCampo(tarea.id, { aclaraciones: e.target.value.trim() || null })}
                />
              </label>

              <label className="td-panel-field td-edit-material">
                <span>Material / link principal</span>
                <input
                  type="text"
                  className="sheet-cell"
                  placeholder="https://…"
                  value={tarea.material_referencia || ""}
                  onChange={(e) => onActualizarCampo(tarea.id, { material_referencia: e.target.value })}
                  onBlur={(e) => onActualizarCampo(tarea.id, { material_referencia: e.target.value.trim() || null })}
                />
                {tarea.material_referencia && (
                  <a href={tarea.material_referencia} target="_blank" rel="noopener noreferrer" className="td-panel-link">
                    Abrir enlace ↗
                  </a>
                )}
              </label>

              {origen && (
                <div className="td-panel-origen td-edit-wide">
                  <span>Origen</span>
                  <div>
                    {origen.tipo} · {origen.fecha || "sin fecha"} · {origen.estado}
                  </div>
                  <a href={origen.href}>Ir a la planificación →</a>
                </div>
              )}

              {tarea.tarea_padre_id && (
                <div className="td-panel-origen td-edit-wide">
                  <span>Depende de</span>
                  <div>Tarea #{tarea.tarea_padre_id} — estado: {tarea.tarea_padre_estado || "—"}</div>
                </div>
              )}
            </div>

            <div className="td-panel-footer td-edit-footer">
              <button
                type="button"
                className="btn td-danger-action"
                onClick={() => onEliminar(tarea.id)}
              >
                Eliminar tarea
              </button>
              <button className="btn primary" type="button" onClick={() => setModoEdicion(false)}>
                Terminar edición
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="td-readable-body">
              <section className="td-readable-section td-readable-brief">
                <div className="td-readable-section-heading">
                  <span>Brief operativo</span>
                  <h3>Guion e indicaciones</h3>
                </div>
                {tarea.aclaraciones ? (
                  <div className="td-readable-copy">
                    {renderizarTextoTarea(tarea.aclaraciones)}
                  </div>
                ) : (
                  <div className="td-readable-empty">
                    Esta tarea todavía no tiene indicaciones cargadas.
                  </div>
                )}
              </section>

              {referencias.length > 0 && (
                <section className="td-readable-section">
                  <div className="td-readable-section-heading">
                    <span>Enlaces externos</span>
                    <h3>Referencias</h3>
                  </div>
                  <div className="td-readable-links">
                    {referencias.map((url) => {
                      const info = obtenerInfoLinkTarea(url);
                      return (
                        <a href={url} target="_blank" rel="noopener noreferrer" key={url}>
                          <div>
                            <strong>{info.etiqueta}</strong>
                            <span>{info.dominio}</span>
                          </div>
                          <b>↗</b>
                        </a>
                      );
                    })}
                  </div>
                </section>
              )}

              {materialUrl && materialInfo?.tipo === "material" && (
                <section className="td-readable-section">
                  <div className="td-readable-section-heading">
                    <span>Archivos de trabajo</span>
                    <h3>Material / Drive</h3>
                  </div>
                  <a
                    className="td-readable-material"
                    href={materialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div>
                      <strong>{materialInfo.etiqueta}</strong>
                      <span>{materialInfo.dominio}</span>
                    </div>
                    <b>↗</b>
                  </a>
                </section>
              )}

              {(origen || tarea.tarea_padre_id) && (
                <section className="td-readable-section td-readable-context">
                  <div className="td-readable-section-heading">
                    <span>Contexto interno</span>
                    <h3>Origen y dependencia</h3>
                  </div>
                  {origen && (
                    <div className="td-readable-context-row">
                      <div>
                        <strong>{origen.tipo}</strong>
                        <span>{origen.fecha || "Sin fecha"} · {origen.estado}</span>
                      </div>
                      <a href={origen.href}>Ver planificación →</a>
                    </div>
                  )}
                  {tarea.tarea_padre_id && (
                    <div className="td-readable-context-row">
                      <div>
                        <strong>Depende de la tarea #{tarea.tarea_padre_id}</strong>
                        <span>Estado: {tarea.tarea_padre_estado || "—"}</span>
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="td-readable-section">
                <div className="td-readable-section-heading">
                  <span>Jerarquía</span>
                  <h3>Subtareas</h3>
                </div>
                <div className="td-subtasks">
                  {subtareas.map((subtarea) => {
                    const estadoSubtarea = getEstadoTarea(subtarea.estado);
                    return (
                      <button key={subtarea.id} type="button" onClick={() => onAbrir(subtarea.id)}>
                        <span className={subtarea.estado === ESTADO_FINAL_TAREA ? "is-done" : ""}>
                          {subtarea.titulo}
                        </span>
                        <b style={{ color: estadoSubtarea.fg }}>{estadoSubtarea.label}</b>
                      </button>
                    );
                  })}
                  {subtareas.length === 0 && (
                    <div className="td-readable-empty">No hay subtareas cargadas.</div>
                  )}
                </div>
                {esAdmin && (
                  <div className="td-subtask-create">
                    <input
                      type="text"
                      value={tituloSubtarea}
                      placeholder="Nombre de la subtarea"
                      onChange={(e) => setTituloSubtarea(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") crearSubtarea();
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={!tituloSubtarea.trim() || creandoSubtarea}
                      onClick={crearSubtarea}
                    >
                      {creandoSubtarea ? "Creando…" : "+ Agregar"}
                    </button>
                  </div>
                )}
              </section>

              <section className="td-readable-section">
                <div className="td-readable-section-heading">
                  <span>Conversación</span>
                  <h3>Comentarios</h3>
                </div>
                <div className="td-comments">
                  {comentarios.map((comentario) => (
                    <article key={comentario.id}>
                      <div>
                        <strong>{comentario.autor}</strong>
                        <time>{new Date(comentario.created_at).toLocaleString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}</time>
                      </div>
                      <p>{comentario.contenido}</p>
                    </article>
                  ))}
                  {comentarios.length === 0 && (
                    <div className="td-readable-empty">Todavía no hay comentarios.</div>
                  )}
                </div>
                <div className="td-comment-create">
                  <textarea
                    rows={3}
                    value={comentarioNuevo}
                    placeholder="Escribí una actualización, consulta o bloqueo…"
                    onChange={(e) => setComentarioNuevo(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={!comentarioNuevo.trim() || enviandoComentario}
                    onClick={enviarComentario}
                  >
                    {enviandoComentario ? "Enviando…" : "Comentar"}
                  </button>
                </div>
              </section>
            </div>

            <footer className="td-readable-footer">
              {esAdmin ? (
                <button className="btn primary" type="button" onClick={() => setModoEdicion(true)}>
                  Editar tarea
                </button>
              ) : esResponsable && tarea.estado === "pendiente" ? (
                <>
                  <div>
                    <span>Estado actual</span>
                    <strong>{est.label}</strong>
                  </div>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => onActualizarCampo(tarea.id, { estado: "en_progreso" })}
                  >
                    Empezar tarea
                  </button>
                </>
              ) : esResponsable && tarea.estado === "en_progreso" ? (
                <>
                  <div>
                    <span>Estado actual</span>
                    <strong>{est.label}</strong>
                  </div>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => onActualizarCampo(tarea.id, { estado: "en_revision" })}
                  >
                    Enviar a revisión
                  </button>
                </>
              ) : (
                <div className="td-readable-status-note">
                  <span>Estado actual</span>
                  <strong style={{ color: est.fg }}>{est.label}</strong>
                </div>
              )}
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

// Tablero drag-and-drop genérico: columnas + un campo de la tarea que se
// actualiza al soltar. Sirve tanto para "Columnas" (columnas = estado) como
// para "Por persona" (columnas = responsable) sin duplicar la lógica de
// arrastre — mismo patrón HTML5 nativo que ya usaba PiezasTableroPage.
const SUBTIPOS_SUGERIDOS = ["reel", "historia", "carrusel", "visita", "flyer", "editar", "filmar", "diseñar"];

function TareasPorCliente({ tareas, onAbrir }) {
  const grupos = [...tareas.reduce((mapa, tarea) => {
    const cliente = tarea.cliente_nombre || "Sin cliente";
    if (!mapa.has(cliente)) mapa.set(cliente, []);
    mapa.get(cliente).push(tarea);
    return mapa;
  }, new Map()).entries()].sort(([clienteA], [clienteB]) =>
    clienteA.localeCompare(clienteB),
  );

  if (grupos.length === 0) {
    return <div className="task-project-empty">No hay tareas para mostrar.</div>;
  }

  return (
    <div className="task-project-view">
      {grupos.map(([cliente, items]) => (
        <section key={cliente} className="task-project-group">
          <header>
            <h2>{cliente}</h2>
            <span>{items.length} {items.length === 1 ? "tarea" : "tareas"}</span>
          </header>
          <div>
            {items.map((tarea) => {
              const estado = getEstadoTarea(tarea.estado);
              return (
                <button key={tarea.id} type="button" onClick={() => onAbrir(tarea.id)}>
                  <span>
                    <strong>{tarea.titulo}</strong>
                    <small>{tarea.asignado_a} · {formatearFechaTarea(tarea.fecha_vencimiento)}</small>
                  </span>
                  <b style={{ color: estado.fg, background: estado.bg }}>{estado.label}</b>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// Formulario guiado de creación tipo Notion: en vez de una página aparte,
// abre en el momento sobre la tabla y la tarea aparece ahí apenas se crea.
// Reemplaza el link a /nueva-tarea en /piezas (esa página queda intacta
// para quien todavía la tenga en un enlace directo).
function NuevaTareaWizard({ clientes, onCreada, onCerrar }) {
  const [paso, setPaso] = useState(1);
  const [tipoTarea, setTipoTarea] = useState("");
  const [subtipo, setSubtipo] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [asignadoA, setAsignadoA] = useState("");
  const [titulo, setTitulo] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [prioridad, setPrioridad] = useState("media");
  const [materialReferencia, setMaterialReferencia] = useState("");
  const [aclaraciones, setAclaraciones] = useState("");
  const [resumen, setResumen] = useState("");
  const [etiquetas, setEtiquetas] = useState("");
  const [colaboradores, setColaboradores] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const TOTAL_PASOS = 5;

  const puedeAvanzar =
    (paso === 1 && Boolean(tipoTarea)) ||
    paso === 2 ||
    paso === 3 ||
    (paso === 4 && Boolean(asignadoA));

  const crearTarea = async () => {
    if (!titulo.trim()) {
      setError("Falta el título de la tarea.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/tareas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: titulo.trim(),
          asignado_a: asignadoA,
          cliente_id: clienteId ? Number(clienteId) : null,
          tipo_tarea: tipoTarea || null,
          subtipo: subtipo || null,
          prioridad,
          fecha_vencimiento: fechaVencimiento || null,
          material_referencia: materialReferencia.trim() || null,
          aclaraciones: aclaraciones.trim() || null,
          resumen: resumen.trim() || null,
          etiquetas: etiquetas.split(",").map((item) => item.trim()).filter(Boolean),
          colaboradores,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear la tarea.");
      onCreada(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nueva tarea — paso {paso} de {TOTAL_PASOS}</h2>
          <button onClick={onCerrar} style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#9aa0a6" }}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ padding: "10px", background: "#331616", color: "#ef5350", borderRadius: "4px", marginBottom: "14px" }}>
              {error}
            </div>
          )}

          {paso === 1 && (
            <>
              <div className="form-section-title">1 · Elegí el sector</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {SECTORES_TAREA.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setTipoTarea(s.id)}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "8px",
                      border: tipoTarea === s.id ? `2px solid ${s.fg}` : "1px solid #34363a",
                      background: tipoTarea === s.id ? s.bg : "#1f2023",
                      color: tipoTarea === s.id ? s.fg : "#e8eaed",
                      fontWeight: 600,
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {paso === 2 && (
            <>
              <div className="form-section-title">2 · Tipo de tarea (opcional)</div>
              <input
                type="text"
                value={subtipo}
                placeholder="reel, historia, carrusel, visita…"
                onChange={(e) => setSubtipo(e.target.value)}
                style={{ width: "100%", marginBottom: "10px" }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {SUBTIPOS_SUGERIDOS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="tag"
                    style={{ cursor: "pointer" }}
                    onClick={() => setSubtipo(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {paso === 3 && (
            <>
              <div className="form-section-title">3 · Elegí el cliente (opcional)</div>
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ width: "100%" }}>
                <option value="">Sin cliente asociado</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </>
          )}

          {paso === 4 && (
            <>
              <div className="form-section-title">4 · Asigná un responsable</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {RESPONSABLES_EQUIPO.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAsignadoA(r)}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "8px",
                      border: asignadoA === r ? "2px solid #188038" : "1px solid #34363a",
                      background: asignadoA === r ? "#123320" : "#1f2023",
                      color: asignadoA === r ? "#66bb6a" : "#e8eaed",
                      fontWeight: 600,
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </>
          )}

          {paso === 5 && (
            <>
              <div className="form-section-title">5 · Título, fecha, prioridad y detalle</div>
              <div className="form-grid">
                <label className="form-field">
                  <span>Título *</span>
                  <input
                    type="text"
                    value={titulo}
                    placeholder="Ej: Reel testimonio cliente"
                    onChange={(e) => setTitulo(e.target.value)}
                    autoFocus
                  />
                </label>
                <label className="form-field">
                  <span>Vence el</span>
                  <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Prioridad</span>
                  <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
                    {PRIORIDADES_TAREA.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Resumen corto</span>
                  <input
                    type="text"
                    value={resumen}
                    placeholder="Qué hay que resolver"
                    onChange={(e) => setResumen(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Material / link</span>
                  <input
                    type="text"
                    value={materialReferencia}
                    placeholder="Link al material…"
                    onChange={(e) => setMaterialReferencia(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Etiquetas</span>
                  <input
                    type="text"
                    value={etiquetas}
                    placeholder="Mejora, Sitio web"
                    onChange={(e) => setEtiquetas(e.target.value)}
                  />
                </label>
              </div>
              <fieldset className="td-collaborators" style={{ marginTop: "10px" }}>
                <legend>Colaboradores opcionales</legend>
                <div>
                  {RESPONSABLES_EQUIPO.filter((nombre) => nombre !== asignadoA).map((nombre) => (
                    <label key={nombre}>
                      <input
                        type="checkbox"
                        checked={colaboradores.includes(nombre)}
                        onChange={(e) => setColaboradores((actuales) =>
                          e.target.checked
                            ? [...actuales, nombre]
                            : actuales.filter((item) => item !== nombre),
                        )}
                      />
                      <span>{nombre}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="form-field" style={{ marginTop: "10px" }}>
                <span>Aclaraciones</span>
                <textarea
                  value={aclaraciones}
                  onChange={(e) => setAclaraciones(e.target.value)}
                  rows={3}
                  style={{ width: "100%", font: "inherit", padding: "8px 10px", border: "1px solid #34363a", borderRadius: "4px", background: "#1f2023", color: "#e8eaed" }}
                />
              </label>
            </>
          )}
        </div>

        <div className="modal-actions">
          {paso > 1 && (
            <button className="btn" type="button" onClick={() => setPaso((p) => p - 1)} disabled={enviando}>
              ← Atrás
            </button>
          )}
          {paso < TOTAL_PASOS ? (
            <button
              type="button"
              onClick={() => setPaso((p) => p + 1)}
              disabled={!puedeAvanzar}
              style={{
                marginLeft: "auto",
                background: puedeAvanzar ? "#188038" : "#34363a",
                color: puedeAvanzar ? "#fff" : "#9aa0a6",
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: puedeAvanzar ? "pointer" : "not-allowed",
              }}
            >
              Siguiente →
            </button>
          ) : (
            <button
              type="button"
              onClick={crearTarea}
              disabled={enviando || !titulo.trim()}
              style={{
                marginLeft: "auto",
                background: enviando || !titulo.trim() ? "#34363a" : "#188038",
                color: enviando || !titulo.trim() ? "#9aa0a6" : "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: enviando || !titulo.trim() ? "not-allowed" : "pointer",
              }}
            >
              {enviando ? "Creando…" : "Crear tarea"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TareaKanbanBoard({ tareas, columnas, campo, onMover, onAbrir }) {
  const [arrastrandoId, setArrastrandoId] = useState(null);
  const [columnaSobre, setColumnaSobre] = useState(null);

  const iniciarArrastre = (evento, tarea) => {
    setArrastrandoId(tarea.id);
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData("text/plain", String(tarea.id));
  };

  const terminarArrastre = () => {
    setArrastrandoId(null);
    setColumnaSobre(null);
  };

  const permitirSoltar = (evento, columnaId) => {
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    setColumnaSobre(columnaId);
  };

  const soltar = (evento, columnaId) => {
    evento.preventDefault();
    const id = arrastrandoId || Number(evento.dataTransfer.getData("text/plain"));
    terminarArrastre();
    const tarea = tareas.find((t) => t.id === id);
    if (!tarea || (tarea[campo] || null) === columnaId) return;
    onMover(id, columnaId);
  };

  return (
    <div className="kanban task-kanban-board" aria-label="Vista por columnas de tareas">
      {columnas.map((col) => {
        const items = tareas.filter((t) => (t[campo] || null) === col.id);
        return (
          <div
            key={col.id}
            className={`kanban-column task-kanban-column ${columnaSobre === col.id ? "kanban-column-over" : ""}`}
            onDragOver={(evento) => permitirSoltar(evento, col.id)}
            onDrop={(evento) => soltar(evento, col.id)}
          >
            <div className="kanban-header task-kanban-header">
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {col.fg && (
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: col.fg, display: "inline-block", flexShrink: 0 }}></span>
                )}
                {col.label}
              </span>
              <strong className="task-kanban-count">{items.length}</strong>
            </div>
            <div className="task-kanban-list">
              {items.map((t) => {
                const prio = getPrioridadTarea(t.prioridad);
                return (
                  <div
                    key={t.id}
                    className={`task-card task-kanban-card ${arrastrandoId === t.id ? "task-card-dragging" : ""}`}
                    draggable
                    onDragStart={(evento) => iniciarArrastre(evento, t)}
                    onDragEnd={terminarArrastre}
                    onClick={() => onAbrir(t.id)}
                  >
                    <div className="task-card-title">{t.titulo}</div>
                    {t.propiedades_extra?.resumen && (
                      <div className="task-kanban-summary">{t.propiedades_extra.resumen}</div>
                    )}
                    {t.cliente_nombre && (
                      <div className="task-kanban-client">{t.cliente_nombre}</div>
                    )}
                    <div className="task-card-meta task-kanban-meta">
                      <span>{t.asignado_a}</span>
                      {t.fecha_vencimiento && <span>{formatearFechaTarea(t.fecha_vencimiento)}</span>}
                      {t.prioridad === "alta" && <span style={{ color: prio.fg }}>Alta</span>}
                    </div>
                    {Array.isArray(t.propiedades_extra?.etiquetas) && t.propiedades_extra.etiquetas.length > 0 && (
                      <div className="task-kanban-tags">
                        {t.propiedades_extra.etiquetas.slice(0, 3).map((etiqueta) => (
                          <span key={etiqueta}>{etiqueta}</span>
                        ))}
                      </div>
                    )}
                    {esperandoMaterial(t) && (
                      <div className="task-kanban-material" style={{ color: "#e65100" }}>
                        Esperando material
                      </div>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && <div className="kanban-empty">Sin tareas</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Vista calendario de tareas por fecha de vencimiento. Mantiene la lectura
// mensual en escritorio y cambia a agenda vertical en pantallas angostas para
// no comprimir siete columnas hasta volverlas ilegibles.
function TareaCalendario({ tareas, onAbrir }) {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());

  const irMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  const volverAHoy = () => {
    setYear(hoy.getFullYear());
    setMonth(hoy.getMonth());
  };

  const hoyISO = getHoyLocalISO();
  const semanas = getGrillaMes(year, month);
  const claveMes = `${year}-${String(month + 1).padStart(2, "0")}`;
  const esMesActual = year === hoy.getFullYear() && month === hoy.getMonth();

  const porFecha = {};
  tareas.forEach((t) => {
    if (!t.fecha_vencimiento) return;
    (porFecha[t.fecha_vencimiento] = porFecha[t.fecha_vencimiento] || []).push(t);
  });
  Object.values(porFecha).forEach((items) => {
    items.sort((a, b) => {
      const estadoA = ESTADOS_TAREA.findIndex((estado) => estado.id === a.estado);
      const estadoB = ESTADOS_TAREA.findIndex((estado) => estado.id === b.estado);
      return estadoA - estadoB || a.titulo.localeCompare(b.titulo);
    });
  });

  const diasConTareas = Object.entries(porFecha)
    .filter(([fecha]) => fecha.startsWith(claveMes))
    .sort(([fechaA], [fechaB]) => fechaA.localeCompare(fechaB));
  const cantidadMes = diasConTareas.reduce((total, [, items]) => total + items.length, 0);

  const renderTarea = (t, variante = "") => {
    const estado = getEstadoTarea(t.estado);
    const contexto = [t.cliente_nombre || getSectorTarea(t.tipo_tarea)?.label, t.asignado_a]
      .filter(Boolean)
      .join(" · ");
    return (
      <button
        aria-label={`Abrir tarea ${t.titulo}`}
        className={`task-calendar-card ${variante}`}
        key={t.id}
        onClick={() => onAbrir(t.id)}
        style={{ borderLeftColor: estado.fg }}
        title={`${t.titulo} · ${contexto} · ${estado.label}`}
        type="button"
      >
        <span className="task-calendar-card-title">{t.titulo}</span>
        <span className="task-calendar-card-bottom">
          <span className="task-calendar-card-meta">{contexto || "Sin asignar"}</span>
          <span className="task-calendar-card-status" style={{ color: estado.fg }}>
            <i style={{ background: estado.fg }} />
            {estado.label}
          </span>
        </span>
      </button>
    );
  };

  return (
    <section className="task-calendar" aria-label={`Calendario de tareas de ${MESES[month]} ${year}`}>
      <header className="task-calendar-toolbar">
        <div className="task-calendar-heading">
          <span className="task-calendar-eyebrow">Calendario de tareas</span>
          <div className="task-calendar-heading-line">
            <h2>{MESES[month]} {year}</h2>
            <span>{cantidadMes} tareas en {diasConTareas.length} días</span>
          </div>
        </div>

        <div className="task-calendar-actions">
          <button className="btn task-calendar-today" disabled={esMesActual} onClick={volverAHoy} type="button">
            Hoy
          </button>
          <div className="task-calendar-monthnav" aria-label="Cambiar mes">
            <button aria-label="Mes anterior" className="btn task-calendar-navbtn" type="button" onClick={() => irMes(-1)}>‹</button>
            <button aria-label="Mes siguiente" className="btn task-calendar-navbtn" type="button" onClick={() => irMes(1)}>›</button>
          </div>
        </div>
      </header>

      <div className="task-calendar-grid">
        {DIAS_SEMANA.map((dia) => (
          <div className="task-calendar-dow" key={dia}>{dia}</div>
        ))}
        {semanas.map((semana, si) =>
          semana.map((dia, di) => {
            if (dia === null) {
              return <div className="task-calendar-cell empty" key={`${si}-${di}`}></div>;
            }
            const iso = fechaISODesde(year, month, dia);
            const items = porFecha[iso] || [];
            const visibles = items.slice(0, 3);
            const ocultos = Math.max(items.length - visibles.length, 0);
            return (
              <div
                className={`task-calendar-cell ${iso === hoyISO ? "today" : ""} ${di >= 5 ? "weekend" : ""}`}
                key={`${si}-${di}`}
              >
                <div className="task-calendar-dayhead">
                  <span className="task-calendar-daynum">{dia}</span>
                  {items.length > 0 && <span className="task-calendar-count">{items.length}</span>}
                </div>
                <div className="task-calendar-card-stack">
                  {visibles.map((t) => renderTarea(t))}
                  {ocultos > 0 && (
                    <div className="task-calendar-more">+{ocultos} tareas más</div>
                  )}
                </div>
              </div>
            );
          }),
        )}
      </div>

      <div className="task-calendar-agenda">
        {diasConTareas.length === 0 ? (
          <div className="task-calendar-agenda-empty">No hay tareas con fecha en este mes.</div>
        ) : (
          diasConTareas.map(([fecha, items]) => {
            const fechaLocal = new Date(`${fecha}T12:00:00`);
            const visibles = items.slice(0, 4);
            const ocultos = Math.max(items.length - visibles.length, 0);
            return (
              <article className={`task-calendar-agenda-day ${fecha === hoyISO ? "today" : ""}`} key={fecha}>
                <div className="task-calendar-agenda-date">
                  <strong>{fechaLocal.getDate()}</strong>
                  <span>{fechaLocal.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "")}</span>
                </div>
                <div className="task-calendar-agenda-content">
                  <div className="task-calendar-agenda-head">
                    <span>{items.length === 1 ? "1 tarea" : `${items.length} tareas`}</span>
                  </div>
                  <div className="task-calendar-agenda-list">
                    {visibles.map((t) => renderTarea(t, "agenda"))}
                  </div>
                  {ocultos > 0 && <div className="task-calendar-more">+{ocultos} tareas más</div>}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function PiezasTableroPage() {
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

function Sidebar({ path, sesion, onCerrarSesion, ROL_LABELS }) {
  const esAdmin = sesion?.usuario?.rol === "admin";
  const rutaTablero = getRutaUsuario(sesion?.usuario?.usuario);

  const seccionesNav = {
    inicio: [
      { href: rutaTablero || "/", label: "Inicio" },
    ],
    planificacion: [
      { href: "/planificacion-historias", label: "Historias" },
      { href: "/planificacion-publicaciones", label: "Publicaciones" },
    ],
    gestion: [
      { href: "/piezas", label: "Tareas" },
      { href: "/reportes-historias", label: "Reporte" },
    ],
    admin: esAdmin ? [
      { href: "/clientes", label: "Clientes" },
    ] : [],
    cuenta: [
      { href: "/perfil", label: "Perfil" },
      ...(esAdmin ? [{ href: "/empleados", label: "Usuarios" }] : []),
    ],
  };

  const enlacesPrincipales = [
    ...seccionesNav.inicio,
    ...seccionesNav.planificacion,
    ...seccionesNav.gestion,
    ...seccionesNav.admin,
  ];
  const enlacesCuenta = seccionesNav.cuenta;
  const cuentaActiva = enlacesCuenta.some((enlace) => path === enlace.href);

  const renderLinksSección = (enlaces) =>
    enlaces.map((enlace) => (
      <a
        key={enlace.href}
        href={enlace.href}
        className={`sidebar-link ${path === enlace.href ? "active" : ""}`}
      >
        {enlace.label}
      </a>
    ));

  return (
    <nav className="sidebar" aria-label="Navegación principal">
      <div className="sidebar-header">
        <div className="brand-mark">RENDER</div>
      </div>

      <div className="sidebar-content">
        {renderLinksSección(enlacesPrincipales)}
      </div>

      <details className={`account-menu ${cuentaActiva ? "active" : ""}`}>
        <summary className="account-trigger">
          <div className="user-badge">
            <div className="user-avatar">
              {sesion?.usuario?.foto_perfil ? (
                <img src={sesion.usuario.foto_perfil} alt="" />
              ) : (
                inicialesUsuario(sesion?.usuario?.nombre)
              )}
            </div>
            <div className="user-info">
              <div className="user-name">{sesion?.usuario?.nombre}</div>
              <div className="user-role">{ROL_LABELS[sesion?.usuario?.rol] || sesion?.usuario?.rol}</div>
            </div>
          </div>
        </summary>
        <div className="account-menu-panel">
          {renderLinksSección(enlacesCuenta)}
          <button
            className="sidebar-link logout-btn"
            onClick={onCerrarSesion}
          >
            Cerrar sesión
          </button>
        </div>
      </details>
    </nav>
  );
}

function App() {
  const path = window.location.pathname;
  let sesion = getSesion();

  if (path === "/agustin" || path === "/franco") {
    window.location.href = "/lider";
    return null;
  }

  // Si estamos en una ruta de usuario específica, usar esa sesión
  if (Object.values(USUARIO_A_RUTA).includes(path)) {
    sesion = getSesionDelPath(path);
  }

  if (path === "/login") {
    if (sesion) {
      window.location.href = getRutaUsuario(sesion.usuario.usuario) || "/";
      return null;
    }
    return <LoginPage />;
  }

  if (!sesion) {
    window.location.href = "/login";
    return null;
  }

  const esAdmin = sesion.usuario.rol === "admin";
  const rutaPropia = getRutaUsuario(sesion.usuario.usuario);
  const rutasCompartidas = ["/", "/calendario", "/calendario-estructura", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias", "/perfil", "/piezas"];
  const rutaPermitida =
    esAdmin || rutasCompartidas.includes(path) || rutaPropia === path;

  if (!rutaPermitida) {
    window.location.href = rutaPropia || "/";
    return null;
  }

  const dashboard = (() => {
    if (path === "/lider") {
      return <LiderDashboard />;
    }
    if (path === "/oriana") {
      return <OrianaDashboard />;
    }
    if (path === "/german") {
      return <GermanDashboard />;
    }
    if (path === "/luciano") {
      return <LucianoDashboard />;
    }
    if (path === "/augusto") {
      return <AugustoDashboard />;
    }
    if (path === "/equipo") {
      window.location.href = "/reportes-historias";
      return null;
    }
    if (path === "/clientes") {
      return <ClientesAdminPage />;
    }
    if (path === "/calendario") {
      // Alias histórico: el calendario ahora vive como pestaña dentro del
      // módulo unificado de Publicaciones (no se rompen links guardados).
      return <PublicacionesPage tabInicial="calendario" />;
    }
    if (path === "/calendario-estructura") {
      return <HistoriasPage initialTab="estructura" />;
    }
    if (path === "/planificacion-historias") {
      return <HistoriasPage />;
    }
    if (path === "/reportes-historias") {
      return <ReportesEquipoPage />;
    }
    if (path === "/perfil") {
      return <PerfilPage />;
    }
    if (path === "/empleados") {
      return <EmpleadosPage />;
    }
    if (path === "/nueva-tarea") {
      return <NuevaTareaPage />;
    }
    if (path === "/piezas") {
      return <TareasTableroPage />;
    }
    if (path === "/tareas-diseno") {
      return <TareasDisenioPage />;
    }
    if (path === "/tareas-edicion") {
      return <TareasEdicionPage />;
    }
    if (path === "/tareas-produccion") {
      return <TareasProduccionPage />;
    }
    if (path === "/planificacion-publicaciones") {
      return <PublicacionesPage />;
    }
    return <HomePage />;
  })();

  return (
    <>
      <Sidebar path={path} sesion={sesion} onCerrarSesion={cerrarSesion} ROL_LABELS={ROL_LABELS} />
      {dashboard}
    </>
  );
}

const ROLES_HOME = [
  { nombre: "Líder", descripcion: "Administración y aprobaciones", path: "/lider" },
  { nombre: "Augusto", descripcion: "Diseño", path: "/augusto" },
  { nombre: "Luciano", descripcion: "Edición", path: "/luciano" },
  { nombre: "Germán", descripcion: "Producción", path: "/german" },
  { nombre: "Oriana", descripcion: "Community", path: "/oriana" },
];

function HomePage() {
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";
  const rutaPropia = getRutaUsuario(sesion?.usuario?.usuario) || "/";

  const atajos = [
    {
      titulo: "Mi tablero",
      desc: "Tu vista de trabajo diaria",
      href: rutaPropia,
    },
    {
      titulo: "Publicaciones",
      desc: "Calendario, planilla y lista operativa en un solo lugar",
      href: "/planificacion-publicaciones",
    },
    {
      titulo: "Mi perfil",
      desc: "Tus datos, foto, usuario y contraseña",
      href: "/perfil",
    },
  ];
  if (esAdmin) {
    atajos.push({
      titulo: "Reporte del equipo",
      desc: "Objetivos, cumplimiento y pendientes por persona",
      href: "/reportes-historias",
    });
    atajos.push({
      titulo: "Tareas",
      desc: "Ver pendientes y cargar una tarea nueva",
      href: "/piezas",
    });
    atajos.push({
      titulo: "Gestión de empleados",
      desc: "Altas, bajas y accesos",
      href: "/empleados",
    });
  }

  return (
    <main aria-label="Render platform home">
      <div className="frame">
        <div className="content">
          <div className="home-hero">
            <h2>Hola, {sesion?.usuario?.nombre} 👋</h2>
            <div className="caption">
              Bienvenido a la plataforma interna de Render. Elegí por dónde
              seguir.
            </div>
          </div>

          <div className="section-label">Accesos rápidos</div>
          <div className="home-shortcuts">
            {atajos.map((atajo) => (
              <a className="home-shortcut" href={atajo.href} key={atajo.href}>
                <div>
                  <div className="hs-title">{atajo.titulo}</div>
                  <div className="hs-desc">{atajo.desc}</div>
                </div>
              </a>
            ))}
          </div>

          {esAdmin && (
            <>
              <div className="section-label">Ir al tablero de cada rol</div>
              <div className="box">
                <div className="home-grid">
                  {ROLES_HOME.map((rol) => (
                    <div className="home-role" key={rol.path}>
                      <div>
                        <div className="home-role-name">{rol.nombre}</div>
                        <div className="caption">{rol.descripcion}</div>
                      </div>
                      <a className="btn" href={rol.path}>
                        Abrir
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function getGrillaMes(year, month) {
  const primerDia = new Date(year, month, 1);
  const totalDias = new Date(year, month + 1, 0).getDate();
  let offset = primerDia.getDay();
  offset = offset === 0 ? 6 : offset - 1;

  const celdas = [];
  for (let i = 0; i < offset; i += 1) celdas.push(null);
  for (let d = 1; d <= totalDias; d += 1) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);

  const semanas = [];
  for (let i = 0; i < celdas.length; i += 7) {
    semanas.push(celdas.slice(i, i + 7));
  }
  return semanas;
}

function fechaISODesde(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function sumarDiasISO(fechaISO, dias) {
  const fecha = new Date(`${fechaISO}T00:00:00`);
  fecha.setDate(fecha.getDate() + dias);
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function abreviarClientePublicacion(nombre = "") {
  const limpio = nombre.replace(/^El Ángel Azul\s+/i, "Ángel ").trim();
  const abreviaturas = {
    "Búnker Training": "Búnker",
    "Capital Motos": "Capital",
    "El Ángel Azul Estudiantil": "Ángel Est.",
    "El Ángel Azul Turismo": "Ángel Tur.",
    "iPhone Shop": "iPhone",
    "Lavalle Hortícola": "Lavalle H.",
    "Lavalle Market": "Lavalle M.",
    "Litoral Maq": "Litoral",
    "RPM Chevrolet": "RPM",
  };
  return abreviaturas[nombre] || limpio.split(/\s+/).slice(0, 2).join(" ");
}

function etiquetaCortaPublicacion(pz) {
  const tipo = pz.tipo === "carrusel" ? "C" : "V";
  const check = pz.estado === "publicada" ? "✓ " : "";
  return `${check}${tipo} · ${abreviarClientePublicacion(pz.cliente_nombre)}`;
}

function getCheckPublicacionLabel(estado) {
  if (estado === "publicada") return "Publicado";
  if (estado === "bloqueada") return "No publicado / revisar";
  return "Pendiente";
}

function PublicacionesCalendarioTab({ onIrAPlanilla }) {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());
  const [piezas, setPiezas] = useState([]);
  const [error, setError] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [piezaSel, setPiezaSel] = useState(null);
  const [diaSel, setDiaSel] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);

  useEffect(() => {
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((publicaciones) => {
        setPiezas(
          publicaciones.map((p) => ({
            ...p,
            tipoLabel: getTipoPublicacionLabel(p.tipo),
          }))
        );
      })
      .catch((err) => {
        console.error("No se pudo cargar el calendario editorial", err);
        setError("No se pudo cargar el calendario editorial.");
      });
  }, []);

  const piezasFiltradas = useMemo(() => piezas.filter((pz) => {
    if (filtroTipo !== "todos" && pz.tipo !== filtroTipo) return false;
    if (filtroEstado === "pendientes" && pz.estado === "publicada") return false;
    if (
      filtroEstado !== "todos" &&
      filtroEstado !== "pendientes" &&
      pz.estado !== filtroEstado
    ) {
      return false;
    }
    return true;
  }), [piezas, filtroTipo, filtroEstado]);

  const porFecha = useMemo(() => {
    const tmp = {};
    piezasFiltradas.forEach((pz) => {
      if (!pz.fecha_programada) return;
      (tmp[pz.fecha_programada] = tmp[pz.fecha_programada] || []).push(pz);
    });
    Object.values(tmp).forEach((items) => {
      items.sort((a, b) => {
        if (a.estado === b.estado) return a.cliente_nombre.localeCompare(b.cliente_nombre);
        if (a.estado === "publicada") return 1;
        if (b.estado === "publicada") return -1;
        return a.estado.localeCompare(b.estado);
      });
    });
    return tmp;
  }, [piezasFiltradas]);

  const semanas = useMemo(() => getGrillaMes(year, month), [year, month]);
  const hoyISO = getHoyLocalISO();
  const finProximos7 = sumarDiasISO(hoyISO, 7);
  const mesISO = fechaISODesde(year, month, 1).slice(0, 7);

  const estadisticas = useMemo(() => {
    const piezasDelMes = piezas.filter(
      (pz) => pz.fecha_programada?.slice(0, 7) === mesISO,
    );
    const pendientesDelMes = piezasDelMes.filter((pz) => pz.estado !== "publicada");
    const publicadasDelMes = piezasDelMes.filter((pz) => pz.estado === "publicada");
    const pendientesVencidas = piezas.filter(
      (pz) => pz.fecha_programada < hoyISO && pz.estado !== "publicada",
    );
    const pendientesHoy = piezas.filter(
      (pz) => pz.fecha_programada === hoyISO && pz.estado !== "publicada",
    );
    const proximos7 = piezas.filter(
      (pz) =>
        pz.fecha_programada >= hoyISO &&
        pz.fecha_programada <= finProximos7 &&
        pz.estado !== "publicada",
    );
    return { piezasDelMes, pendientesDelMes, publicadasDelMes, pendientesVencidas, pendientesHoy, proximos7 };
  }, [piezas, mesISO, hoyISO, finProximos7]);

  const irMes = useCallback((delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }, [month, year]);

  const FILTROS = useMemo(() => [
    { key: "todos", label: "Todo" },
    { key: "video", label: "Reels" },
    { key: "carrusel", label: "Carruseles" },
  ], []);

  const FILTROS_ESTADO = useMemo(() => [
    { key: "todos", label: "Todos" },
    { key: "pendientes", label: "Pendientes" },
    { key: "publicada", label: "Publicadas" },
    { key: "bloqueada", label: "No publicado / revisar" },
  ], []);

  const cambiarEstadoPublicacion = useCallback(async (publicacion, nuevoEstado) => {
    setGuardandoId(publicacion.id);
    setError(null);
    try {
      const res = await fetch(`/api/publicaciones/${publicacion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      });
      if (!res.ok) throw new Error("No se pudo guardar el check de publicación.");
      const actualizada = await res.json();
      const piezaActualizada = {
        ...publicacion,
        ...actualizada,
        tipoLabel: getTipoPublicacionLabel(actualizada.tipo),
      };
      setPiezas((prev) =>
        prev.map((pz) => (pz.id === publicacion.id ? piezaActualizada : pz)),
      );
      setPiezaSel(piezaActualizada);
      setDiaSel((dia) =>
        dia?.fecha === piezaActualizada.fecha_programada
          ? {
              ...dia,
              items: dia.items.map((pz) =>
                pz.id === piezaActualizada.id ? piezaActualizada : pz,
              ),
            }
          : dia,
      );
    } catch (err) {
      console.error("No se pudo guardar el check de publicación", err);
      setError(err.message);
    } finally {
      setGuardandoId(null);
    }
  }, []);

  const abrirDia = useCallback((fecha, items) => {
    if (!items.length) return;
    setDiaSel({ fecha, items });
  }, []);

  return (
    <>
      <div className="cal-toolbar">
        <div className="cal-monthnav">
          <button
            aria-label="Mes anterior"
            className="btn cal-navbtn"
            type="button"
            onClick={() => irMes(-1)}
          >
            ‹
          </button>
          <span className="cal-title">
            {MESES[month]} {year}
          </span>
          <button
            aria-label="Mes siguiente"
            className="btn cal-navbtn"
            type="button"
            onClick={() => irMes(1)}
          >
            ›
          </button>
        </div>

        <div className="cal-filters" aria-label="Filtros de calendario">
          <label>
            Tipo
            <select
              value={filtroTipo}
              onChange={(event) => setFiltroTipo(event.target.value)}
            >
              {FILTROS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select
              value={filtroEstado}
              onChange={(event) => setFiltroEstado(event.target.value)}
            >
              {FILTROS_ESTADO.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="publication-check-summary">
        <div>
          <strong>{estadisticas.publicadasDelMes.length}</strong>
          <span>Publicadas del mes</span>
        </div>
        <div>
          <strong>{estadisticas.pendientesDelMes.length}</strong>
          <span>Pendientes del mes</span>
        </div>
        <div className={estadisticas.pendientesVencidas.length ? "alert" : ""}>
          <strong>{estadisticas.pendientesVencidas.length}</strong>
          <span>Vencidas sin check</span>
        </div>
        <div>
          <strong>{estadisticas.pendientesHoy.length}</strong>
          <span>Para publicar hoy</span>
        </div>
        <div>
          <strong>{estadisticas.proximos7.length}</strong>
          <span>Próximos 7 días</span>
        </div>
      </div>

      {error && <div className="caption">{error}</div>}

      <div className="cal-grid">
        {DIAS_SEMANA.map((dia) => (
          <div className="cal-dow" key={dia}>
            {dia}
          </div>
        ))}
        {semanas.map((semana, si) =>
          semana.map((dia, di) => {
            if (dia === null) {
              return (
                <div className="cal-cell empty" key={`${si}-${di}`}></div>
              );
            }
            const iso = fechaISODesde(year, month, dia);
            const items = porFecha[iso] || [];
            const visibles = items.slice(0, 3);
            const ocultos = Math.max(items.length - visibles.length, 0);
            return (
              <div
                className={`cal-cell ${iso === hoyISO ? "today" : ""} ${items.length ? "has-items" : ""}`}
                key={`${si}-${di}`}
                onClick={() => abrirDia(iso, items)}
              >
                <div className="cal-cell-head">
                  <span className="cal-daynum">{dia}</span>
                  {items.length > 0 && <span className="cal-count">{items.length}</span>}
                </div>
                <div className="cal-chip-stack">
                  {visibles.map((pz) => (
                    <div
                      className={`cal-chip ${pz.estado}`}
                      key={pz.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPiezaSel(pz);
                      }}
                      title={`${pz.tipoLabel} · ${pz.cliente_nombre} · ${getEstadoHistoriaLabel(
                        pz.estado,
                      )}`}
                    >
                      {etiquetaCortaPublicacion(pz)}
                    </div>
                  ))}
                  {ocultos > 0 && (
                    <button
                      className="cal-more"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        abrirDia(iso, items);
                      }}
                    >
                      +{ocultos} más
                    </button>
                  )}
                </div>
              </div>
            );
          }),
        )}
      </div>

      <div className="cal-legend">
        <span className="lg-pend">Pendiente / en diseño</span>
        <span className="lg-rev">En revisión</span>
        <span className="lg-bloq">Bloqueada</span>
        <span className="lg-pub">Publicada</span>
      </div>
      <div className="caption">
        Cada casilla muestra un resumen limpio. Tocá una fecha para ver todas
        las publicaciones del día y marcar el check correspondiente.
      </div>

      {diaSel && (
        <div className="modal-overlay open" role="dialog" aria-modal="true">
          <div className="modal day-modal">
            <div className="modal-header">
              <span>Publicaciones del {diaSel.fecha}</span>
              <button className="modal-close" type="button" onClick={() => setDiaSel(null)}>
                X
              </button>
            </div>
            <div className="modal-body">
              <div className="day-publication-list">
                {diaSel.items.map((pz) => (
                  <button
                    className={`day-publication-row ${pz.estado}`}
                    key={pz.id}
                    type="button"
                    onClick={() => setPiezaSel(pz)}
                  >
                    <span className="day-publication-main">
                      <strong>{pz.cliente_nombre}</strong>
                      <span>{pz.tipoLabel} · {getCheckPublicacionLabel(pz.estado)}</span>
                    </span>
                    <span className="day-publication-badge">
                      {pz.estado === "publicada" ? "✓" : pz.tipo === "carrusel" ? "C" : "V"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {piezaSel && (
        <div className="modal-overlay open" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <span>
                {piezaSel.cliente_nombre} · {piezaSel.idea || "Sin idea cargada"}
              </span>
              <button className="modal-close" type="button" onClick={() => setPiezaSel(null)}>
                X
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-field">
                  <div className="detail-label">Tipo</div>
                  <div>{piezaSel.tipoLabel}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Estado</div>
                  <div>{getEstadoHistoriaLabel(piezaSel.estado)}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Check publicación</div>
                  <div>
                    {getCheckPublicacionLabel(piezaSel.estado)}
                  </div>
                </div>
                {piezaSel.fecha_publicación_real && (
                  <div className="detail-field">
                    <div className="detail-label">Marcada publicada</div>
                    <div>{piezaSel.fecha_publicación_real}</div>
                  </div>
                )}
                <div className="detail-field">
                  <div className="detail-label">Fecha programada</div>
                  <div>{piezaSel.fecha_programada}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Responsable</div>
                  <div>{piezaSel.responsable || "—"}</div>
                </div>
                {piezaSel.copy && (
                  <div className="detail-field">
                    <div className="detail-label">Copy</div>
                    <div>{piezaSel.copy}</div>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={guardandoId === piezaSel.id || piezaSel.estado === "publicada"}
                  onClick={() => cambiarEstadoPublicacion(piezaSel, "publicada")}
                >
                  {guardandoId === piezaSel.id ? "Guardando..." : "Marcar publicado"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoId === piezaSel.id || piezaSel.estado === "lista"}
                  onClick={() => cambiarEstadoPublicacion(piezaSel, "lista")}
                >
                  Volver a pendiente
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoId === piezaSel.id || piezaSel.estado === "bloqueada"}
                  onClick={() => cambiarEstadoPublicacion(piezaSel, "bloqueada")}
                >
                  No publicado / revisar
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    onIrAPlanilla(piezaSel.cliente_id);
                    setPiezaSel(null);
                  }}
                >
                  Editar en la planilla →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const ROL_LABELS = {
  admin: "Líder",
  diseno: "Diseño",
  edicion: "Edición",
  produccion: "Producción",
  community: "Comunidad",
};

function normalizarPrimerNombre(nombre) {
  const primero = (nombre || "").trim().split(/\s+/)[0] || "";
  const limpio = primero
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
  if (!limpio) return "";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
}

function PerfilPage() {
  const sesion = getSesion();
  const usuario = sesion?.usuario;
  const [perfilUsuario, setPerfilUsuario] = useState(usuario);
  const [fotoPerfil, setFotoPerfil] = useState(usuario?.foto_perfil || "");
  const [usuarioNuevo, setUsuarioNuevo] = useState(usuario?.usuario || "");
  const [passwordUsuario, setPasswordUsuario] = useState("");
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mensajeFoto, setMensajeFoto] = useState(null);
  const [errorFoto, setErrorFoto] = useState(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [mensajeUsuario, setMensajeUsuario] = useState(null);
  const [errorUsuario, setErrorUsuario] = useState(null);
  const [enviandoUsuario, setEnviandoUsuario] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setPerfilUsuario(usuario);
    setFotoPerfil(usuario?.foto_perfil || "");
    setUsuarioNuevo(usuario?.usuario || "");
  }, [usuario?.usuario, usuario?.foto_perfil]);

  const actualizarSesionPerfil = (data) => {
    const usuarioActualizado = {
      usuario: data.usuario,
      nombre: data.nombre,
      rol: data.rol,
      foto_perfil: data.foto_perfil || "",
    };
    guardarSesion(sesion.token, usuarioActualizado);
    setPerfilUsuario(usuarioActualizado);
    setFotoPerfil(usuarioActualizado.foto_perfil);
    return usuarioActualizado;
  };

  const reducirFotoPerfil = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const size = 360;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / image.width, size / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          const x = (size - width) / 2;
          const y = (size - height) / 2;
          ctx.fillStyle = "#f5f5f5";
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(image, x, y, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        image.onerror = () => reject(new Error("No se pudo leer la imagen."));
        image.src = reader.result;
      };
      reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
      reader.readAsDataURL(file);
    });

  const guardarFotoPerfil = (foto) => {
    setEnviandoFoto(true);
    return fetch("/api/usuarios/foto", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: perfilUsuario.usuario,
        foto_perfil: foto,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo guardar la foto.");
        }
        return data;
      })
      .then((data) => {
        actualizarSesionPerfil(data);
        setMensajeFoto(foto ? "Foto de perfil actualizada." : "Foto de perfil quitada.");
      })
      .finally(() => setEnviandoFoto(false));
  };

  const handleFotoPerfil = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMensajeFoto(null);
    setErrorFoto(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorFoto("Elegí una imagen válida.");
      return;
    }
    try {
      const fotoReducida = await reducirFotoPerfil(file);
      await guardarFotoPerfil(fotoReducida);
    } catch (err) {
      setErrorFoto(err.message);
    }
  };

  const handleQuitarFotoPerfil = () => {
    setMensajeFoto(null);
    setErrorFoto(null);
    guardarFotoPerfil("").catch((err) => setErrorFoto(err.message));
  };

  const handleCambiarUsuario = (event) => {
    event.preventDefault();
    setMensajeUsuario(null);
    setErrorUsuario(null);

    const usuarioLimpio = usuarioNuevo.trim();
    if (!usuarioLimpio) {
      setErrorUsuario("El usuario nuevo no puede estar vacío.");
      return;
    }

    setEnviandoUsuario(true);
    fetch("/api/usuarios/perfil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario_actual: perfilUsuario.usuario,
        password_actual: passwordUsuario,
        usuario_nuevo: usuarioLimpio,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo cambiar el usuario.");
        }
        return data;
      })
      .then((data) => {
        actualizarSesionPerfil(data);
        setUsuarioNuevo(data.usuario);
        setPasswordUsuario("");
        setMensajeUsuario("Usuario actualizado correctamente.");
      })
      .catch((err) => setErrorUsuario(err.message))
      .finally(() => setEnviandoUsuario(false));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setMensaje(null);
    setError(null);

    if (nueva.length < 4) {
      setError("La nueva contraseña debe tener al menos 4 caracteres.");
      return;
    }
    if (nueva !== confirmar) {
      setError("La nueva contraseña y su confirmación no coinciden.");
      return;
    }

    setEnviando(true);
    fetch("/api/usuarios/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: perfilUsuario.usuario,
        password_actual: actual,
        password_nueva: nueva,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo cambiar la contraseña.");
        }
        return data;
      })
      .then(() => {
        setMensaje("Contraseña actualizada correctamente.");
        setActual("");
        setNueva("");
        setConfirmar("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setEnviando(false));
  };

  return (
    <main aria-label="Render platform perfil">
      <div className="frame">
        <div className="content">
          <div className="section-label">Mis datos</div>
          <div className="box">
            <div className="profile-photo-row">
              <div className="profile-photo-preview">
                {fotoPerfil ? (
                  <img src={fotoPerfil} alt="" />
                ) : (
                  inicialesUsuario(perfilUsuario?.nombre)
                )}
              </div>
              <div className="profile-photo-actions">
                <div className="detail-label">Foto de perfil</div>
                <label className={`btn primary ${enviandoFoto ? "disabled" : ""}`}>
                  {enviandoFoto ? "Guardando..." : fotoPerfil ? "Cambiar foto" : "Subir foto"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFotoPerfil}
                    disabled={enviandoFoto}
                    hidden
                  />
                </label>
                {fotoPerfil && (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleQuitarFotoPerfil}
                    disabled={enviandoFoto}
                  >
                    Quitar foto
                  </button>
                )}
                {errorFoto && <div className="caption login-error">{errorFoto}</div>}
                {mensajeFoto && (
                  <div className="caption" style={{ color: "#333", fontWeight: "bold" }}>
                    {mensajeFoto}
                  </div>
                )}
              </div>
            </div>
            <div className="detail-grid">
              <div className="detail-field">
                <div className="detail-label">Nombre</div>
                <div>{perfilUsuario?.nombre}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Usuario de acceso</div>
                <div>{perfilUsuario?.usuario}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Rol</div>
                <div>{ROL_LABELS[perfilUsuario?.rol] || perfilUsuario?.rol}</div>
              </div>
            </div>
          </div>

          <div className="section-label">Cambiar mi usuario</div>
          <div className="box">
            <form onSubmit={handleCambiarUsuario} className="login-form">
              <label className="login-field">
                <span className="detail-label">Nuevo usuario</span>
                <input
                  type="text"
                  value={usuarioNuevo}
                  onChange={(e) => setUsuarioNuevo(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label className="login-field">
                <span className="detail-label">Contraseña actual</span>
                <input
                  type="password"
                  value={passwordUsuario}
                  onChange={(e) => setPasswordUsuario(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              {errorUsuario && <div className="caption login-error">{errorUsuario}</div>}
              {mensajeUsuario && (
                <div className="caption" style={{ color: "#333", fontWeight: "bold" }}>
                  {mensajeUsuario}
                </div>
              )}

              <button className="btn primary" type="submit" disabled={enviandoUsuario}>
                {enviandoUsuario ? "Guardando..." : "Cambiar usuario"}
              </button>
            </form>
            <div className="caption">
              El rol es solo de lectura y no se puede cambiar desde el perfil.
            </div>
          </div>

          <div className="section-label">Cambiar mi contraseña</div>
          <div className="box">
            <form onSubmit={handleSubmit} className="login-form">
              <label className="login-field">
                <span className="detail-label">Contraseña actual</span>
                <input
                  type="password"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="login-field">
                <span className="detail-label">Nueva contraseña</span>
                <input
                  type="password"
                  value={nueva}
                  onChange={(e) => setNueva(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="login-field">
                <span className="detail-label">Repetir nueva contraseña</span>
                <input
                  type="password"
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              {error && <div className="caption login-error">{error}</div>}
              {mensaje && (
                <div className="caption" style={{ color: "#333", fontWeight: "bold" }}>
                  {mensaje}
                </div>
              )}

              <button className="btn primary" type="submit" disabled={enviando}>
                {enviando ? "Guardando..." : "Cambiar contraseña"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

function EmpleadosPage() {
  const [usuarios, setUsuarios] = useState([]);
  const [error, setError] = useState(null);
  const [modalAltaAbierto, setModalAltaAbierto] = useState(false);
  const [usuarioAdministrado, setUsuarioAdministrado] = useState(null);
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [rol, setRol] = useState("diseno");
  const [password, setPassword] = useState("");
  const [emailNotificaciones, setEmailNotificaciones] = useState("");
  const [correoEdicion, setCorreoEdicion] = useState("");
  const [editandoCorreo, setEditandoCorreo] = useState(false);
  const [guardandoCorreo, setGuardandoCorreo] = useState(false);
  const [formError, setFormError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const handleNombreChange = (event) => {
    const nuevoNombre = event.target.value;
    const usuarioActualSugerido = normalizarPrimerNombre(nombre);
    const passwordActualSugerida = usuarioActualSugerido ? `${usuarioActualSugerido}1` : "";
    const nuevoUsuarioSugerido = normalizarPrimerNombre(nuevoNombre);

    setNombre(nuevoNombre);
    if (!usuario || usuario === usuarioActualSugerido) {
      setUsuario(nuevoUsuarioSugerido);
    }
    if (!password || password === passwordActualSugerida) {
      setPassword(nuevoUsuarioSugerido ? `${nuevoUsuarioSugerido}1` : "");
    }
  };

  const cargarUsuarios = () => {
    fetch("/api/usuarios")
      .then((r) => r.json())
      .then((data) => {
        setUsuarios(data);
        setUsuarioAdministrado((actual) => {
          if (!actual) return null;
          return data.find((item) => item.id === actual.id) || null;
        });
      })
      .catch(() => setError("No se pudieron cargar los empleados."));
  };

  useEffect(cargarUsuarios, []);

  const abrirAlta = () => {
    setNombre("");
    setUsuario("");
    setRol("diseno");
    setPassword("");
    setEmailNotificaciones("");
    setFormError(null);
    setMensaje(null);
    setModalAltaAbierto(true);
  };

  const cerrarAlta = () => {
    if (enviando) return;
    setModalAltaAbierto(false);
    setFormError(null);
  };

  const abrirAdministracion = (u) => {
    setUsuarioAdministrado(u);
    setCorreoEdicion(u.email_notificaciones || "");
    setEditandoCorreo(false);
    setFormError(null);
    setMensaje(null);
  };

  const cerrarAdministracion = () => {
    if (guardandoCorreo) return;
    setUsuarioAdministrado(null);
    setEditandoCorreo(false);
    setFormError(null);
  };

  const handleCrear = (event) => {
    event.preventDefault();
    setFormError(null);
    setMensaje(null);
    setEnviando(true);

    fetch("/api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre,
        usuario,
        rol,
        password,
        email_notificaciones: emailNotificaciones,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo crear el empleado.");
        }
        return data;
      })
      .then((data) => {
        setMensaje(`Empleado creado: ${data.nombre} (${data.usuario}).`);
        setNombre("");
        setUsuario("");
        setRol("diseno");
        setPassword("");
        setEmailNotificaciones("");
        setModalAltaAbierto(false);
        cargarUsuarios();
      })
      .catch((err) => setFormError(err.message))
      .finally(() => setEnviando(false));
  };

  const handleEliminar = (u) => {
    if (
      !window.confirm(
        `¿Dar de baja a ${u.nombre} (${u.usuario})? Perderá el acceso a la plataforma.`,
      )
    ) {
      return;
    }
    fetch(`/api/usuarios/${u.id}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo dar de baja.");
        setUsuarioAdministrado(null);
        setMensaje(`${u.nombre} fue dado de baja.`);
        cargarUsuarios();
      })
      .catch(() => setError("No se pudo dar de baja al empleado."));
  };

  const iniciarEdicionCorreo = () => {
    setCorreoEdicion(usuarioAdministrado?.email_notificaciones || "");
    setEditandoCorreo(true);
    setFormError(null);
    setMensaje(null);
  };

  const guardarCorreo = (u) => {
    setGuardandoCorreo(true);
    setFormError(null);
    setMensaje(null);

    fetch(`/api/usuarios/${u.id}/email-notificaciones`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_notificaciones: correoEdicion }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo guardar el correo.");
        }
        return data;
      })
      .then((data) => {
        setMensaje(
          data.email_notificaciones
            ? `Correo guardado para ${data.nombre}.`
            : `Correo eliminado para ${data.nombre}.`,
        );
        setUsuarioAdministrado(data);
        setEditandoCorreo(false);
        cargarUsuarios();
      })
      .catch((err) => setFormError(err.message))
      .finally(() => setGuardandoCorreo(false));
  };

  const iniciales = (texto = "") =>
    texto
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0])
      .join("")
      .toUpperCase();

  const usuariosConCorreo = usuarios.filter(
    (u) => Boolean(u.email_notificaciones),
  ).length;
  const usuariosSinCorreo = usuarios.length - usuariosConCorreo;

  return (
    <main aria-label="Render platform empleados">
      <div className="frame">
        <div className="content usuarios-page">
          <div className="usuarios-header">
            <div>
              <div className="section-label">Administración del equipo</div>
              <h2>Usuarios</h2>
              <p>
                Administrá accesos, roles y correos de notificación desde un
                solo lugar.
              </p>
            </div>
            <button className="btn primary usuarios-add" type="button" onClick={abrirAlta}>
              + Agregar usuario
            </button>
          </div>

          <div className="usuarios-stats" aria-label="Resumen de usuarios">
            <div className="usuarios-stat">
              <span>Usuarios activos</span>
              <strong>{usuarios.length}</strong>
              <small>Con acceso a la plataforma</small>
            </div>
            <div className="usuarios-stat is-ready">
              <span>Con correo configurado</span>
              <strong>{usuariosConCorreo}</strong>
              <small>Pueden recibir notificaciones</small>
            </div>
            <div className={`usuarios-stat ${usuariosSinCorreo ? "is-pending" : "is-ready"}`}>
              <span>Sin correo</span>
              <strong>{usuariosSinCorreo}</strong>
              <small>{usuariosSinCorreo ? "Requieren configuración" : "Equipo completo"}</small>
            </div>
          </div>

          {error && <div className="usuarios-alert is-error">{error}</div>}
          {mensaje && <div className="usuarios-alert is-success">{mensaje}</div>}

          <section className="usuarios-listado" aria-label="Listado de usuarios">
            <div className="usuarios-listado-header">
              <div>
                <strong>Equipo con acceso</strong>
                <span>{usuarios.length} usuarios registrados</span>
              </div>
              <div className="usuarios-leyenda">
                <span><i className="usuarios-dot is-ready" /> Correo configurado</span>
                <span><i className="usuarios-dot is-pending" /> Falta correo</span>
              </div>
            </div>

            <div className="usuarios-columns" aria-hidden="true">
              <span>Persona</span>
              <span>Rol</span>
              <span>Acceso</span>
              <span>Notificaciones</span>
              <span />
            </div>

            <div className="usuarios-list">
              {usuarios.map((u) => (
                <article className="usuarios-row" key={u.id}>
                  <div className="usuarios-persona">
                    <div className="usuarios-avatar">
                      {u.foto_perfil ? (
                        <img src={u.foto_perfil} alt="" />
                      ) : (
                        iniciales(u.nombre)
                      )}
                    </div>
                    <div>
                      <strong>{u.nombre}</strong>
                      <span>Usuario activo</span>
                    </div>
                  </div>

                  <div className={`usuarios-role role-${u.rol}`}>
                    {ROL_LABELS[u.rol] || u.rol}
                  </div>

                  <div className="usuarios-access">
                    <span className="usuarios-mobile-label">Usuario de acceso</span>
                    <strong>{u.usuario}</strong>
                  </div>

                  <div className="usuarios-email">
                    <span className="usuarios-mobile-label">Notificaciones</span>
                    <strong>{u.email_notificaciones || "Sin correo configurado"}</strong>
                    <span className={u.email_notificaciones ? "status-ready" : "status-pending"}>
                      <i className={`usuarios-dot ${u.email_notificaciones ? "is-ready" : "is-pending"}`} />
                      {u.email_notificaciones ? "Configurado" : "Falta correo"}
                    </span>
                  </div>

                  <button
                    className="btn usuarios-manage"
                    type="button"
                    onClick={() => abrirAdministracion(u)}
                  >
                    Administrar
                  </button>
                </article>
              ))}

              {usuarios.length === 0 && !error && (
                <div className="usuarios-empty">
                  No hay usuarios cargados todavía.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {modalAltaAbierto && (
        <div className="usuarios-modal-backdrop" role="presentation" onMouseDown={cerrarAlta}>
          <section
            className="usuarios-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="alta-usuario-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="usuarios-modal-header">
              <div>
                <span className="usuarios-eyebrow">Nuevo acceso</span>
                <h3 id="alta-usuario-title">Agregar usuario</h3>
                <p>Creá la cuenta y dejá listo su correo de notificaciones.</p>
              </div>
              <button className="usuarios-close" type="button" onClick={cerrarAlta} aria-label="Cerrar">
                ×
              </button>
            </div>

            <form onSubmit={handleCrear}>
              <div className="form-grid cols-2 usuarios-form-grid">
                <label className="form-field">
                  <span>Nombre y apellido *</span>
                  <input type="text" value={nombre} onChange={handleNombreChange} required autoFocus />
                </label>
                <label className="form-field">
                  <span>Rol *</span>
                  <select value={rol} onChange={(e) => setRol(e.target.value)}>
                    {Object.entries(ROL_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Usuario de acceso *</span>
                  <input
                    type="text"
                    value={usuario}
                    placeholder="ej: Luciano"
                    onChange={(e) => setUsuario(e.target.value)}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Contraseña inicial *</span>
                  <input
                    type="text"
                    value={password}
                    placeholder="ej: Luciano1"
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <label className="form-field usuarios-form-email">
                  <span>Correo para notificaciones</span>
                  <input
                    type="email"
                    value={emailNotificaciones}
                    placeholder="nombre@gmail.com"
                    onChange={(e) => setEmailNotificaciones(e.target.value)}
                  />
                  <small>Puede agregarse después desde Administrar.</small>
                </label>
              </div>

              {formError && <div className="usuarios-alert is-error">{formError}</div>}

              <div className="usuarios-modal-actions">
                <button className="btn" type="button" onClick={cerrarAlta} disabled={enviando}>
                  Cancelar
                </button>
                <button className="btn primary" type="submit" disabled={enviando}>
                  {enviando ? "Creando..." : "Crear usuario"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {usuarioAdministrado && (
        <div className="usuarios-modal-backdrop" role="presentation" onMouseDown={cerrarAdministracion}>
          <aside
            className="usuarios-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="administrar-usuario-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="usuarios-panel-header">
              <button
                className="usuarios-close"
                type="button"
                onClick={cerrarAdministracion}
                aria-label="Cerrar"
              >
                ×
              </button>
              <div className="usuarios-panel-identity">
                <div className="usuarios-avatar is-large">
                  {usuarioAdministrado.foto_perfil ? (
                    <img src={usuarioAdministrado.foto_perfil} alt="" />
                  ) : (
                    iniciales(usuarioAdministrado.nombre)
                  )}
                </div>
                <div>
                  <span className="usuarios-eyebrow">Administrar usuario</span>
                  <h3 id="administrar-usuario-title">{usuarioAdministrado.nombre}</h3>
                  <div className={`usuarios-role role-${usuarioAdministrado.rol}`}>
                    {ROL_LABELS[usuarioAdministrado.rol] || usuarioAdministrado.rol}
                  </div>
                </div>
              </div>
            </div>

            <div className="usuarios-panel-body">
              {formError && <div className="usuarios-alert is-error">{formError}</div>}

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Datos de acceso</strong>
                    <span>Información actual de la cuenta</span>
                  </div>
                </div>
                <div className="usuarios-detail-grid">
                  <div>
                    <span>Nombre</span>
                    <strong>{usuarioAdministrado.nombre}</strong>
                  </div>
                  <div>
                    <span>Usuario</span>
                    <strong>{usuarioAdministrado.usuario}</strong>
                  </div>
                  <div>
                    <span>Rol</span>
                    <strong>{ROL_LABELS[usuarioAdministrado.rol] || usuarioAdministrado.rol}</strong>
                  </div>
                  <div>
                    <span>Estado</span>
                    <strong className="status-ready">Activo</strong>
                  </div>
                </div>
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Notificaciones por correo</strong>
                    <span>Destino de los avisos de nuevas tareas</span>
                  </div>
                  {!editandoCorreo && (
                    <button className="btn" type="button" onClick={iniciarEdicionCorreo}>
                      {usuarioAdministrado.email_notificaciones ? "Editar correo" : "Agregar correo"}
                    </button>
                  )}
                </div>

                {editandoCorreo ? (
                  <div className="usuarios-email-editor">
                    <label className="form-field">
                      <span>Correo de notificaciones</span>
                      <input
                        type="email"
                        value={correoEdicion}
                        placeholder="nombre@gmail.com"
                        onChange={(e) => setCorreoEdicion(e.target.value)}
                        autoFocus
                      />
                    </label>
                    <div className="usuarios-inline-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={guardandoCorreo}
                        onClick={() => {
                          setEditandoCorreo(false);
                          setFormError(null);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={guardandoCorreo}
                        onClick={() => guardarCorreo(usuarioAdministrado)}
                      >
                        {guardandoCorreo ? "Guardando..." : "Guardar correo"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`usuarios-notification-card ${usuarioAdministrado.email_notificaciones ? "is-ready" : "is-pending"}`}>
                    <i className={`usuarios-dot ${usuarioAdministrado.email_notificaciones ? "is-ready" : "is-pending"}`} />
                    <div>
                      <strong>
                        {usuarioAdministrado.email_notificaciones || "Correo pendiente de configurar"}
                      </strong>
                      <span>
                        {usuarioAdministrado.email_notificaciones
                          ? "Esta persona puede recibir avisos de tareas."
                          : "Esta persona todavía no recibirá avisos por email."}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <section className="usuarios-panel-section">
                <div className="usuarios-panel-section-title">
                  <div>
                    <strong>Seguridad</strong>
                    <span>Contraseña y acceso personal</span>
                  </div>
                </div>
                <div className="usuarios-security-note">
                  La contraseña no se muestra. Cada persona puede cambiarla
                  desde <strong>Mi perfil</strong>.
                </div>
              </section>

              <section className="usuarios-panel-section usuarios-danger-zone">
                <div>
                  <strong>Dar de baja el acceso</strong>
                  <span>La persona dejará de ingresar a la plataforma.</span>
                </div>
                <button
                  className="btn usuarios-danger-btn"
                  type="button"
                  onClick={() => handleEliminar(usuarioAdministrado)}
                >
                  Dar de baja
                </button>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function OrianaDashboard() {
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

          <div className="section-label">1 · Calendario del día</div>
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

          <div className="section-label">2 · Vencidas (no publicadas a tiempo)</div>
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

          <div className="section-label">3 · Próximas programadas</div>
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

          <div className="section-label">4 · Piezas bloqueadas por corrección</div>
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

          <div className="section-label">5 · Avance del día</div>
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

function ChecklistPublicacionOrianaModal({ publicacion, onClose, onPublicar }) {
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
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <span>
            {publicacion.cliente_nombre} ·{" "}
            {publicacion.idea || "Sin idea cargada"}
          </span>
          <button className="modal-close" type="button" onClick={onClose}>
            X
          </button>
        </div>
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
      </div>
    </div>
  );
}

function GermanDashboard() {
  const [produccionSeleccionada, setProduccionSeleccionada] = useState(null);
  const [tareasGerman, setTareasGerman] = useState([]);
  const [tareasGermanError, setTareasGermanError] = useState(null);

  const cargarTareasGerman = () => {
    fetch("/api/tareas")
      .then((response) => response.json())
      .then((tareas) => {
        setTareasGerman(
          tareas.filter((tarea) => tarea.asignado_a === "Germán"),
        );
      })
      .catch((error) => {
        console.error("No se pudieron cargar las tareas de Germán", error);
        setTareasGermanError("No se pudieron cargar las tareas.");
      });
  };

  useEffect(cargarTareasGerman, []);

  const pendientes = tareasGerman.filter((tarea) => tarea.estado !== ESTADO_FINAL_TAREA);

  // Compromiso mensual pactado por cliente (confirmado al definir
  // responsabilidades del equipo). El mes de cada tarea se aproxima por
  // fecha_vencimiento (no hay fecha_programada directa en tareas) — el
  // desvío es de a lo sumo unos días, aceptable para el MVP.
  const mesActual = getHoyLocalISO().slice(0, 7);
  const CUOTAS_GERMAN = [
    { cliente: "Luzin", cuota: 8 },
    { cliente: "Moketa", cuota: 8 },
    { cliente: "Búnker Training", cuota: 4 },
    { cliente: "Bohle", cuota: 6 },
    { cliente: "Capital Motos", cuota: 6 },
  ];
  const cumplimientoPorCliente = CUOTAS_GERMAN.map((c) => {
    const hechas = tareasGerman.filter(
      (t) =>
        t.cliente_nombre === c.cliente &&
        t.estado === ESTADO_FINAL_TAREA &&
        t.fecha_vencimiento?.startsWith(mesActual),
    ).length;
    return { ...c, hechas, porcentaje: Math.round((hechas / c.cuota) * 100) };
  });
  const cuotaTotal = CUOTAS_GERMAN.reduce((acc, c) => acc + c.cuota, 0);
  const hechasTotal = cumplimientoPorCliente.reduce((acc, c) => acc + c.hechas, 0);

  return (
    <main aria-label="Render platform German">
      <div className="frame">
        <div className="content">
          <div style={{ backgroundColor: "#fff3cd", border: "2px solid #ff9800", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
            {(() => {
              const proximaTarea = pendientes
                .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0];

              if (!proximaTarea) {
                return <div className="caption">✅ No hay tareas pendientes.</div>;
              }

              return (
                <div onClick={() => setProduccionSeleccionada(proximaTarea)} style={{ cursor: "pointer" }}>
                  <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>🎯 Tu próxima tarea</div>
                  <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "4px" }}>{proximaTarea.titulo}</div>
                  <div style={{ fontSize: "13px", color: "#333", marginBottom: "8px" }}>{proximaTarea.cliente_nombre ?? "Sin cliente"} · Vence {proximaTarea.fecha_vencimiento}</div>
                  <div style={{ fontSize: "12px", color: "#555" }}>Estado: {getEstadoTareaLabel(proximaTarea.estado)}</div>
                </div>
              );
            })()}
          </div>

          <div className="section-label">1 · Producciones pendientes</div>
          <div className="box">
            {tareasGermanError && (
              <div className="caption">{tareasGermanError}</div>
            )}
            {!tareasGermanError &&
              pendientes.map((tarea) => {
                return (
                  <div
                    className="priority-card"
                    key={tarea.id}
                    onClick={() => setProduccionSeleccionada(tarea)}
                  >
                    <div className="cliente">
                      {tarea.cliente_nombre ?? "Sin cliente"}
                    </div>
                    <div>{tarea.titulo}</div>
                    <div className="meta">
                      {tarea.propiedades_extra?.coordinada ? (
                        `Coordinado para ${
                          tarea.propiedades_extra.horario ??
                          "fecha sin especificar"
                        }`
                      ) : (
                        getEstadoTareaLabel(tarea.estado)
                      )}
                    </div>
                  </div>
                );
              })}
            {!tareasGermanError && pendientes.length === 0 && (
              <div className="caption">
                No hay producciones pendientes asignadas a Germán.
              </div>
            )}
            <div className="caption">
              → Germán ve solo producciones y material pendiente, sin mezclarse
              con edición o diseño.
            </div>
          </div>

          <div className="section-label">2 · Agenda de visitas</div>
          <div className="box">
            <div className="placeholder-box">
              [ Módulo de Agenda — Fase 2, no incluido en el MVP ]
            </div>
            <div className="caption">
              Por ahora, coordinación de horarios y rutas se sigue manejando
              fuera de la plataforma.
            </div>
          </div>

          <div className="section-label">3 · Cumplimiento mensual por cliente</div>
          <div className="box">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Videos entregados</th>
                  <th>Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {cumplimientoPorCliente.map((c) => (
                  <tr key={c.cliente}>
                    <td>{c.cliente}</td>
                    <td>{c.hechas} / {c.cuota}</td>
                    <td>{c.porcentaje}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="progress-card" style={{ marginTop: "12px" }}>
              <div className="progress-label">Total del mes</div>
              <div className="progress-value">
                {hechasTotal} / {cuotaTotal} ({Math.round((hechasTotal / cuotaTotal) * 100)}%)
              </div>
            </div>
            <div className="caption">
              → Un video cuenta como cumplido recién cuando queda marcado
              "Publicada" — no alcanza con haber ido a filmar.
            </div>
          </div>

          <div className="section-label">4 · En revisión</div>
          <div className="box">
            {tareasGerman.filter((t) => t.estado === "en_revision").length === 0 && (
              <div className="caption">No hay producciones en revisión.</div>
            )}
            {tareasGerman
              .filter((t) => t.estado === "en_revision")
              .map((t) => (
                <div className="priority-card" key={`revision-${t.id}`}>
                  <div className="cliente">{t.cliente_nombre ?? "Sin cliente"}</div>
                  <div>{t.titulo}</div>
                  <div className="meta">Pendiente de revisión.</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {produccionSeleccionada && (
        <DetalleProduccionGermanModal
          produccion={produccionSeleccionada}
          onClose={() => setProduccionSeleccionada(null)}
          onActualizado={cargarTareasGerman}
        />
      )}
      <TareasAsignadasGenericas nombre="Germán" tipoTarea="produccion" titulo="Producciones asignadas" />
    </main>
  );
}

function DetalleProduccionGermanModal({ produccion, onClose, onActualizado }) {
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);

  const handleCoordinarFecha = () => {
    const horario = window.prompt(
      "¿Para cuándo se coordina? (ej: 2026-07-25 10:00)",
      produccion.propiedades_extra?.horario || "",
    );
    if (!horario) return;

    setEnviando("coordinar");
    setError(null);

    fetch(`/api/tareas/${produccion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propiedades_extra: { horario, coordinada: true },
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo coordinar la fecha.");
        }
        return response.json();
      })
      .then(() => {
        onActualizado();
        onClose();
      })
      .catch(() => {
        setError("No se pudo coordinar la fecha. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  const handleMarcarEntregado = () => {
    setEnviando("entregar");
    setError(null);

    fetch(`/api/tareas/${produccion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: ESTADO_FINAL_TAREA }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo marcar el material como entregado.");
        }
        return response.json();
      })
      .then(() => {
        onActualizado();
        onClose();
      })
      .catch(() => {
        setError("No se pudo marcar como entregado. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <span>
            {produccion.cliente_nombre ?? "Sin cliente"} · {produccion.titulo}
          </span>
          <button className="modal-close" type="button" onClick={onClose}>
            X
          </button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-field">
              <div className="detail-label">Qué se necesita</div>
              <div>{produccion.titulo}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Estado actual</div>
              <div>{getEstadoTareaLabel(produccion.estado)}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Detalle</div>
              <div>
                {produccion.propiedades_extra?.motivo_bloqueo ??
                  produccion.propiedades_extra?.horario ??
                  "Sin detalle adicional cargado"}
              </div>
            </div>
          </div>

          {error && <div className="caption login-error">{error}</div>}

          <div className="modal-actions">
            <button
              className="btn primary"
              type="button"
              disabled={enviando !== null}
              onClick={handleCoordinarFecha}
            >
              {enviando === "coordinar" ? "Guardando..." : "Coordinar fecha"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={enviando !== null || produccion.estado === ESTADO_FINAL_TAREA}
              onClick={handleMarcarEntregado}
            >
              {enviando === "entregar"
                ? "Guardando..."
                : "Marcar material entregado"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LucianoDashboard() {
  const [edicionesLuciano, setEdicionesLuciano] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/tareas?asignado_a=Luciano&tipo_tarea=edicion")
      .then((response) => response.json())
      .then((tareas) => {
        setEdicionesLuciano(
          tareas
            .slice()
            .sort((a, b) => (a.fecha_vencimiento || "").localeCompare(b.fecha_vencimiento || "")),
        );
      })
      .catch((error) => {
        console.error("No se pudieron cargar las ediciones de Luciano", error);
        setError("No se pudieron cargar las ediciones.");
      });
  }, []);

  const pendientes = edicionesLuciano.filter((t) => t.estado !== ESTADO_FINAL_TAREA);
  const publicadas = edicionesLuciano.filter((t) => t.estado === ESTADO_FINAL_TAREA).length;
  const proxima = pendientes[0];

  return (
    <main aria-label="Render platform Luciano">
      <div className="frame">
        <div className="content">
          {error && <div className="caption">{error}</div>}

          <div style={{ backgroundColor: "#d4edff", border: "2px solid #0066cc", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
            {!proxima ? (
              <div className="caption">✅ No hay ediciones pendientes.</div>
            ) : (
              <div>
                <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>🎬 Tu próxima edición</div>
                <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "4px" }}>{proxima.titulo}</div>
                <div style={{ fontSize: "13px", color: "#333", marginBottom: "8px" }}>
                  {proxima.cliente_nombre ?? "Sin cliente"} · Vence {proxima.fecha_vencimiento}
                </div>
                <div style={{ fontSize: "12px", color: "#555" }}>
                  {proxima.requiere_aprobacion ? "Esperando aprobación del Líder" : `Estado: ${getEstadoTareaLabel(proxima.estado)}`}
                </div>
              </div>
            )}
          </div>

          <div className="section-label">Avance del mes</div>
          <div className="box">
            <div className="progress-card">
              <div className="progress-label">Videos editados</div>
              <div className="progress-value">
                {publicadas} / {edicionesLuciano.length}
              </div>
            </div>
            <div className="caption">
              → Solo tus ediciones asignadas — no ves diseño, filmación ni
              publicaciones de otros.
            </div>
          </div>
        </div>
      </div>

      <TareasAsignadasGenericas nombre="Luciano" tipoTarea="edicion" titulo="Ediciones asignadas — fecha límite, prioridad y material" />
    </main>
  );
}

function AugustoDashboard() {
  const [disenosAugusto, setDisenosAugusto] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/tareas?asignado_a=Augusto&tipo_tarea=diseno")
      .then((response) => response.json())
      .then((tareas) => {
        setDisenosAugusto(
          tareas
            .slice()
            .sort((a, b) => (a.fecha_vencimiento || "").localeCompare(b.fecha_vencimiento || "")),
        );
      })
      .catch((error) => {
        console.error("No se pudieron cargar los diseños de Augusto", error);
        setError("No se pudieron cargar los diseños.");
      });
  }, []);

  const hoy = getHoyLocalISO();
  const atrasadasOHoy = disenosAugusto.filter(
    (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento && t.fecha_vencimiento <= hoy,
  );
  const publicadas = disenosAugusto.filter((t) => t.estado === ESTADO_FINAL_TAREA).length;
  const proxima = disenosAugusto.find((t) => t.estado !== ESTADO_FINAL_TAREA);

  return (
    <main aria-label="Render platform Augusto">
      <div className="frame">
        <div className="content">
          {error && <div className="caption">{error}</div>}

          <div style={{ backgroundColor: "#fff3cd", border: "2px solid #ffc107", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
            {!proxima ? (
              <div className="caption">✅ No hay diseños pendientes.</div>
            ) : (
              <div>
                <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>📌 Tu próxima tarea</div>
                <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "4px" }}>{proxima.titulo}</div>
                <div style={{ fontSize: "13px", color: "#555", marginBottom: "8px" }}>
                  {proxima.cliente_nombre ?? "Sin cliente"} · Vence {proxima.fecha_vencimiento}
                </div>
                <div style={{ fontSize: "12px", color: "#666" }}>Estado: {getEstadoTareaLabel(proxima.estado)}</div>
              </div>
            )}
          </div>

          <div className="section-label">Atrasados / vencen hoy</div>
          <div className="box">
            {atrasadasOHoy.length === 0 && (
              <div className="caption">No hay diseños atrasados ni que venzan hoy.</div>
            )}
            {atrasadasOHoy.map((t) => (
              <div className="priority-card blocked" key={t.id}>
                <div className="cliente">{t.cliente_nombre ?? "Sin cliente"}</div>
                <div>{t.titulo}</div>
                <div className="meta">
                  {t.fecha_vencimiento} · {getEstadoTareaLabel(t.estado)}
                </div>
              </div>
            ))}
            <div className="caption">
              → Historias y carruseles juntos — todo lo que Augusto diseña, en
              una sola lista.
            </div>
          </div>

          <div className="section-label">Avance del mes</div>
          <div className="box">
            <div className="progress-card">
              <div className="progress-label">Diseños entregados</div>
              <div className="progress-value">
                {publicadas} / {disenosAugusto.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TareasAsignadasGenericas nombre="Augusto" tipoTarea="diseno" titulo="Diseños asignados — historias y carruseles" />
    </main>
  );
}

function EquipoDashboard() {
  const [resumenEquipo, setResumenEquipo] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/historias").then((r) => r.json()),
      fetch("/api/publicaciones").then((r) => r.json()),
      fetch("/api/tareas").then((r) => r.json()),
    ])
      .then(([historias, publicaciones, tareas]) => {
        setResumenEquipo(getResumenEquipo(historias, publicaciones, tareas));
      })
      .catch((err) => {
        console.error("No se pudo cargar el equipo", err);
        setError("No se pudo cargar la carga de trabajo del equipo.");
      });
  }, []);

  const equipoOrdenado = [...resumenEquipo].sort(
    (a, b) => b.cargaTotal - a.cargaTotal,
  );

  return (
    <main aria-label="Render platform Equipo">
      <div className="frame">

        <div className="content">
          <div className="section-label">
            Carga de trabajo y cumplimiento por persona — {getMesActualISO()}
          </div>
          <div className="box">
            {error && <div className="caption">{error}</div>}
            {!error && (
              <table>
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Asignadas (total)</th>
                    <th>Atrasadas</th>
                    <th>Bloqueadas</th>
                    <th>Cumplimiento del mes</th>
                  </tr>
                </thead>
                <tbody>
                  {equipoOrdenado.map((persona) => (
                    <tr key={persona.nombre}>
                      <td>{persona.nombre}</td>
                      <td>{persona.cargaTotal}</td>
                      <td>{persona.atrasadas}</td>
                      <td>{persona.bloqueadas}</td>
                      <td>{persona.cumplimiento}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="caption">
              → Ordenado por carga total, para detectar de un vistazo quién
              tiene más asignado, no solo quién está atrasado.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function ClienteCuotaResumen({ etiqueta, publicados, cuota }) {
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

function EditarCuotaClienteModal({ cliente, onClose, onGuardado }) {
  const esFeedCompartido = Boolean(cliente.grupo_feed_id);
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
  const formularioValido = esFeedCompartido
    ? esCuotaValida(cuotaFeedReels) && esCuotaValida(cuotaFeedCarruseles)
    : esCuotaValida(cuotaReels) && esCuotaValida(cuotaCarruseles);
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
    fetch(`/api/clientes/${cliente.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        esFeedCompartido
          ? {
              cuota_feed_reels: Number(cuotaFeedReels),
              cuota_feed_carruseles: Number(cuotaFeedCarruseles),
            }
          : {
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
    <div className="modal-overlay open" role="dialog" aria-modal="true" aria-label="Editar cuota mensual">
      <div className="modal cliente-create-modal">
        <div className="modal-header">
          <span>Editar cuota mensual</span>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">
            X
          </button>
        </div>
        <form className="modal-body cliente-create-modal-body" onSubmit={guardar}>
          <div className="clientes-panel-copy">
            <strong>{cliente.nombre}</strong>
            <span>
              {esFeedCompartido
                ? `Esta cuenta comparte su cuota con el grupo ${cliente.grupo_feed_nombre}.`
                : "Definí la cantidad contratada de cada formato para un mes."}
            </span>
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
              {guardando ? "Guardando..." : "Guardar cuota"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ClientesAdminPage() {
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

function LiderDashboard() {
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
  const [vistaLider, setVistaLider] = useState("panorama");

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
      });
  };

  useEffect(cargarPanorama, []);

  const clientesFiltrados = clientes.filter((cliente) =>
    cliente.nombre.toLowerCase().includes(busquedaCliente.toLowerCase()),
  );

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
                Panorama y estadísticas
              </button>
              <button
                aria-selected={vistaLider === "gestion"}
                className={vistaLider === "gestion" ? "active" : ""}
                onClick={() => setVistaLider("gestion")}
                role="tab"
                type="button"
              >
                Gestión y aprobaciones
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
            1 · Lo primero que ve al entrar — sin scroll
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
            <div className="caption">
              → El ojo va directo a los rojos. Por eso van arriba, no en orden
              alfabético.
            </div>
          </div>

          <div className="section-label">2 · Resumen de equipo</div>
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
            <div className="caption">
              → Vista de personas, no de clientes. Detecta sobrecarga o
              bloqueo de gente, no de cuentas.
            </div>
          </div>

          <div className="section-label">
            3 · Aprobaciones escaladas al Líder
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

          <div className="section-label">4 · Piezas atrasadas</div>
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
            <div className="caption">
              → Piezas que debían publicarse pero no lo hicieron. Revisar con
              el Líder.
            </div>
          </div>

          <div className="section-label">5 · Bloqueos críticos</div>
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

          <div className="section-label">6 · Publicaciones de hoy</div>
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
            <div className="caption">
              → Qué publica hoy. Revisar que esté aprobado y programado.
            </div>
          </div>

          <div className="caption">
            → Para editar la cuota mensual de un cliente, abrí su detalle
            haciendo clic en la fila del panorama.
          </div>
              </div>
          )}

          {vistaLider === "gestion" && (
            <div className="lider-dashboard-view" role="tabpanel">
              <div className="lider-dashboard-divider">
                <span>Gestión y aprobaciones</span>
                <strong>Decisiones operativas del Líder</strong>
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

function GestionLiderPanel() {
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
  const tareasEscaladas = tareasGestion.filter(
    (tarea) => tarea.propiedades_extra?.escalada_a,
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
            1 · Mi cola de aprobaciones — lo que sí requiere mi decisión
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

          <div className="section-label">2 · Piezas destrabadas hoy</div>
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

          <div className="section-label">3 · Casos escalados al Líder</div>
          <div className="box">
            {tareasEscaladas.map((tarea) => (
              <div className="card" key={tarea.id}>
                <div className="cliente">
                  {tarea.cliente_nombre ?? "Sin cliente"}
                </div>
                <div>{tarea.titulo}</div>
                <div className="meta">
                  Escalado · motivo:{" "}
                  {tarea.propiedades_extra.motivo ?? "Sin motivo cargado"}
                </div>
              </div>
            ))}
            {tareasGestionError && (
              <div className="caption">{tareasGestionError}</div>
            )}
            {!tareasGestionError && tareasEscaladas.length === 0 && (
              <div className="caption">No hay tareas escaladas al Líder.</div>
            )}
            <div className="caption">
              → Conserva también los casos escalados antes de la unificación.
            </div>
          </div>

          <div className="section-label">4 · Tareas para asignar</div>
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

function RevisionPiezaModal({ pieza, onClose, onAprobar, onCorreccion }) {
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
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <span>
            {pieza.cliente_nombre} · {pieza.metadata?.Idea || "Sin idea cargada"}
          </span>
          <button className="modal-close" type="button" onClick={onClose}>
            X
          </button>
        </div>
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
      </div>
    </div>
  );
}

function DetalleClienteModal({
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
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <span>{cliente.nombre}</span>
          <button className="modal-close" type="button" onClick={onClose}>
            X
          </button>
        </div>
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
      </div>
    </div>
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

function TareasWorkspacePage({ asignado_a, tipo_tarea, titulo, nombre_usuario, rol }) {
  const [tareas, setTareas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState("activas");
  const [filtroPrioridad, setFiltroPrioridad] = useState("todos");
  const [tareaSeleccionada, setTareaSeleccionada] = useState(null);
  const [actualizando, setActualizando] = useState(false);

  useEffect(() => {
    cargarTareas();
  }, []);

  const cargarTareas = () => {
    setCargando(true);
    fetch(`/api/tareas?asignado_a=${asignado_a}&tipo_tarea=${tipo_tarea}`)
      .then((r) => r.json())
      .then((data) => {
        setTareas(data);
        setCargando(false);
      })
      .catch((err) => {
        setError(err.message);
        setCargando(false);
      });
  };

  const tareasFiltradas = tareas.filter((t) => {
    if (filtroEstado === "activas" && t.estado === ESTADO_FINAL_TAREA) return false;
    if (filtroEstado !== "todos" && filtroEstado !== "activas" && t.estado !== filtroEstado) return false;
    if (filtroPrioridad !== "todos" && t.prioridad !== filtroPrioridad) return false;
    return true;
  });

  const estadosDisponibles = ["pendiente", "en_progreso", "en_revision", "publicada"];
  const hoyISO = getHoyLocalISO();
  const limiteSemana = new Date(`${hoyISO}T00:00:00`);
  limiteSemana.setDate(limiteSemana.getDate() + 7);
  const limiteSemanaISO = limiteSemana.toISOString().slice(0, 10);

  const ordenarTareas = (items) =>
    [...items].sort((a, b) => {
      const fechaA = a.fecha_vencimiento || "9999-12-31";
      const fechaB = b.fecha_vencimiento || "9999-12-31";
      return (
        fechaA.localeCompare(fechaB) ||
        (a.cliente_nombre || "").localeCompare(b.cliente_nombre || "") ||
        a.id - b.id
      );
    });

  const gruposOperativos = [
    {
      id: "vencidas",
      titulo: "Vencidas",
      tareas: tareasFiltradas.filter(
        (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
      ),
    },
    {
      id: "hoy",
      titulo: "Hoy",
      tareas: tareasFiltradas.filter(
        (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento === hoyISO,
      ),
    },
    {
      id: "semana",
      titulo: "Próximos 7 días",
      tareas: tareasFiltradas.filter(
        (t) =>
          t.estado !== ESTADO_FINAL_TAREA &&
          t.fecha_vencimiento &&
          t.fecha_vencimiento > hoyISO &&
          t.fecha_vencimiento <= limiteSemanaISO,
      ),
    },
    {
      id: "mas-adelante",
      titulo: "Más adelante",
      tareas: tareasFiltradas.filter(
        (t) =>
          t.estado !== ESTADO_FINAL_TAREA &&
          (!t.fecha_vencimiento || t.fecha_vencimiento > limiteSemanaISO),
      ),
    },
    {
      id: "publicadas",
      titulo: "Publicadas",
      tareas: tareasFiltradas.filter((t) => t.estado === ESTADO_FINAL_TAREA),
    },
  ]
    .map((grupo) => ({ ...grupo, tareas: ordenarTareas(grupo.tareas) }))
    .filter((grupo) => grupo.tareas.length > 0);

  const pendientesActivas = tareas.filter((t) => t.estado !== ESTADO_FINAL_TAREA).length;
  const vencidasActivas = tareas.filter(
    (t) => t.estado !== ESTADO_FINAL_TAREA && t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
  ).length;

  const actualizarEstado = (tareaId, nuevoEstado) => {
    setActualizando(true);
    fetch(`/api/tareas/${tareaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevoEstado }),
    })
      .then((r) => r.json())
      .then(() => {
        setTareas(tareas.map((t) => (t.id === tareaId ? { ...t, estado: nuevoEstado } : t)));
        setTareaSeleccionada(null);
        setActualizando(false);
      })
      .catch((err) => {
        setError(err.message);
        setActualizando(false);
      });
  };

  const getEstadoColor = (estado) => {
    const colores = {
      pendiente: "#ff9500",
      en_progreso: "#0066cc",
      en_revision: "#ff6b6b",
      programada: "#7e57c2",
      publicada: "#28a745",
    };
    return colores[estado] || "#ccc";
  };

  const getPrioridadBadge = (prioridad) => {
    const colores = {
      alta: "🔴",
      media: "🟡",
      baja: "🟢",
    };
    return colores[prioridad] || "◯";
  };

  return (
    <main aria-label={titulo}>
      <div className="frame">
        <div className="content">
          <div className="section-label">1 · Filtros</div>
          <div className="box" style={{ display: "flex", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              style={{
                padding: "8px 12px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            >
              <option value="activas">Activas</option>
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_progreso">En proceso</option>
              <option value="en_revision">En revisión</option>
              <option value="publicada">Publicada</option>
            </select>

            <select
              value={filtroPrioridad}
              onChange={(e) => setFiltroPrioridad(e.target.value)}
              style={{
                padding: "8px 12px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            >
              <option value="todos">Todas las prioridades</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>

            <div style={{ marginLeft: "auto", fontSize: "14px", color: "#666", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <span>{tareasFiltradas.length} visible{tareasFiltradas.length !== 1 ? "s" : ""}</span>
              <span>{pendientesActivas} activa{pendientesActivas !== 1 ? "s" : ""}</span>
              {vencidasActivas > 0 && <span style={{ color: "#c62828", fontWeight: 700 }}>{vencidasActivas} vencida{vencidasActivas !== 1 ? "s" : ""}</span>}
            </div>
          </div>

          <div className="section-label">2 · Lista operativa tipo ClickUp</div>
          <div className="box" style={{ padding: 0, overflow: "hidden" }}>
            {cargando && (
              <div style={{ padding: "24px", color: "#666" }}>Cargando tareas...</div>
            )}
            {error && (
              <div style={{ padding: "16px", color: "#c62828" }}>{error}</div>
            )}
            {!cargando && !error && gruposOperativos.length === 0 && (
              <div style={{ padding: "24px", color: "#999" }}>No hay tareas con ese filtro.</div>
            )}
            {!cargando && !error && gruposOperativos.map((grupo) => (
              <div key={grupo.id} style={{ borderTop: "1px solid #eee" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#fafafa", borderBottom: "1px solid #eee" }}>
                  <strong style={{ fontSize: "13px" }}>{grupo.titulo}</strong>
                  <span className="tag">{grupo.tareas.length}</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="sheet-table" style={{ minWidth: "820px" }}>
                    <tbody>
                      {grupo.tareas.map((tarea) => (
                        <tr key={tarea.id}>
                          <td style={{ width: "36%", fontWeight: 600 }}>
                            <button
                              type="button"
                              onClick={() => setTareaSeleccionada(tarea)}
                              style={{ border: 0, background: "transparent", padding: 0, textAlign: "left", font: "inherit", cursor: "pointer" }}
                            >
                              {tarea.titulo}
                            </button>
                            {esperandoMaterial(tarea) && (
                              <span style={{ marginLeft: "8px", fontSize: "11px", fontWeight: 700, color: "#e65100" }}>
                                ⏳ Esperando material
                              </span>
                            )}
                          </td>
                          <td style={{ width: "18%", color: "#555" }}>{tarea.cliente_nombre || "Sin cliente"}</td>
                          <td style={{ width: "12%", color: tarea.fecha_vencimiento && tarea.fecha_vencimiento < hoyISO && tarea.estado !== ESTADO_FINAL_TAREA ? "#c62828" : "#666", fontWeight: tarea.fecha_vencimiento && tarea.fecha_vencimiento < hoyISO && tarea.estado !== ESTADO_FINAL_TAREA ? 700 : 400 }}>
                            {tarea.fecha_vencimiento || "Sin fecha"}
                          </td>
                          <td style={{ width: "12%" }}>
                            <span style={{ color: getEstadoColor(tarea.estado), fontWeight: 700 }}>●</span>{" "}
                            {getEstadoTareaLabel(tarea.estado)}
                          </td>
                          <td style={{ width: "10%" }}>{getPrioridadBadge(tarea.prioridad)} {tarea.prioridad || "media"}</td>
                          <td style={{ width: "12%" }}>
                            <select
                              className="sheet-cell"
                              value={tarea.estado}
                              disabled={actualizando}
                              onChange={(e) => actualizarEstado(tarea.id, e.target.value)}
                            >
                              {estadosDisponibles.map((estado) => (
                                <option key={estado} value={estado}>{getEstadoTareaLabel(estado)}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {tareaSeleccionada && (
            <div className="modal-overlay" onClick={() => setTareaSeleccionada(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h2 style={{ margin: 0 }}>{tareaSeleccionada.titulo}</h2>
                  <button
                    onClick={() => setTareaSeleccionada(null)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "24px",
                      cursor: "pointer",
                      color: "#666",
                    }}
                  >
                    ✕
                  </button>
                </div>

                {esperandoMaterial(tareaSeleccionada) && (
                  <div style={{ padding: "10px 12px", background: "#fff3e0", color: "#e65100", borderRadius: "4px", fontWeight: 600, fontSize: "13px", marginBottom: "16px" }}>
                    ⏳ Esperando material — la tarea de filmación todavía no está marcada como publicada.
                  </div>
                )}

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Cliente:</strong> {tareaSeleccionada.cliente_nombre || "—"}
                  </div>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Estado actual:</strong> <span style={{ color: getEstadoColor(tareaSeleccionada.estado) }}>●</span> {getEstadoTareaLabel(tareaSeleccionada.estado)}
                  </div>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Prioridad:</strong> {getPrioridadBadge(tareaSeleccionada.prioridad)} {tareaSeleccionada.prioridad}
                  </div>
                  {tareaSeleccionada.fecha_vencimiento && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Vencimiento:</strong> {tareaSeleccionada.fecha_vencimiento}
                    </div>
                  )}
                  {tareaSeleccionada.subtipo && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Tipo:</strong> {tareaSeleccionada.subtipo}
                    </div>
                  )}
                  {tareaSeleccionada.material_referencia && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Material:</strong>{" "}
                      <a href={tareaSeleccionada.material_referencia} target="_blank" rel="noopener noreferrer">
                        {tareaSeleccionada.material_referencia}
                      </a>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <strong>Cambiar estado a:</strong>
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                    {estadosDisponibles
                      .filter((e) => e !== tareaSeleccionada.estado)
                      .map((estado) => (
                        <button
                          key={estado}
                          onClick={() => actualizarEstado(tareaSeleccionada.id, estado)}
                          disabled={actualizando}
                          style={{
                            padding: "8px 12px",
                            background: getEstadoColor(estado),
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 600,
                            textTransform: "capitalize",
                            opacity: actualizando ? 0.6 : 1,
                          }}
                        >
                          {actualizando ? "..." : getEstadoTareaLabel(estado)}
                        </button>
                      ))}
                  </div>
                </div>

                <button
                  onClick={() => setTareaSeleccionada(null)}
                  style={{
                    padding: "8px 16px",
                    background: "#ccc",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function TareasDisenioPage() {
  return (
    <TareasWorkspacePage
      asignado_a="Augusto"
      tipo_tarea="diseno"
      titulo="Mis diseños"
      nombre_usuario="Augusto"
      rol="diseño"
    />
  );
}

function TareasEdicionPage() {
  return (
    <TareasWorkspacePage
      asignado_a="Luciano"
      tipo_tarea="edicion"
      titulo="Mis ediciones"
      nombre_usuario="Luciano"
      rol="edición"
    />
  );
}

function TareasProduccionPage() {
  return (
    <TareasWorkspacePage
      asignado_a="Germán"
      tipo_tarea="produccion"
      titulo="Mis tareas"
      nombre_usuario="Germán"
      rol="producción"
    />
  );
}

// ── MÓDULO HISTORIAS: planilla por cliente + tablero + estructura ─────────────

const ESTADOS_HISTORIA = [
  { id: "pendiente", label: "Pendiente", bg: "#eceff1", fg: "#546e7a" },
  { id: "en_diseño", label: "En diseño", bg: "#f3e5f5", fg: "#7b1fa2" },
  { id: "en_revision", label: "En revisión", bg: "#fff3e0", fg: "#e65100" },
  { id: "lista", label: "Lista", bg: "#f0f4c3", fg: "#827717" },
  { id: "publicada", label: "Publicada", bg: "#e8f5e9", fg: "#2e7d32" },
  { id: "bloqueada", label: "Bloqueada", bg: "#ffebee", fg: "#c62828" },
];

const RESPONSABLES_EQUIPO = ["Augusto", "Luciano", "Germán", "Oriana", "Líder"];

// Orden de columnas navegables con Tab/Enter (coincide con el orden visual).
const COLUMNAS_PLANILLA = ["cliente", "fecha", "hora", "tipo", "copy", "material", "aclaraciones", "responsable", "estado"];
// Columnas de texto largo: son <textarea>, no <input> — admiten líneas
// propias (Enter no debe saltar de fila) y solo se tratan como pegado
// multi-celda si el portapapeles trae tabs (un salto de línea solo puede
// ser contenido real, como un copy con varios renglones).
const COLUMNAS_MULTILINEA = ["copy", "aclaraciones"];

// Convierte un valor pegado/tipeado en una columna al payload que espera
// PATCH /api/historias/:id. Devuelve null si el valor no es válido para esa
// columna (paste defensivo: mejor ignorar una celda que guardar basura).
function payloadColumnaPlanilla(columna, valorCrudo) {
  const valor = (valorCrudo || "").trim();
  switch (columna) {
    case "cliente":
      return null;
    case "fecha":
      return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? { fecha_programada: valor } : null;
    case "hora":
      return { metadata: { hora: valor } };
    case "tipo":
      return { metadata: { tipo: valor } };
    case "copy":
      return { copy: valor };
    case "material":
      return { material_referencia: valor };
    case "aclaraciones":
      return { aclaraciones: valor };
    case "responsable":
      return RESPONSABLES_EQUIPO.includes(valor)
        ? { responsable: valor, responsable_diseño: valor }
        : null;
    case "estado":
      return ESTADOS_HISTORIA.some((e) => e.id === valor) ? { estado: valor } : null;
    default:
      return null;
  }
}

function HistoriasPlanillaTab({
  clientes,
  year,
  month,
  cargando,
  historias,
  ultimoIdCreado,
  onActualizarLocal,
  onGuardarServidor,
  onAgregar,
  onDuplicar,
  onEliminar,
  clienteFiltradoNombre,
}) {
  const [error, setError] = useState(null);
  const gridRef = useRef(null);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  // Nombre corto pero inequívoco del día — antes era una sola letra
  // (M, X, J...) que obligaba a memorizar a qué día correspondía cada una.
  const LETRAS_DIA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  const clientesPorId = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nombre])), [clientes]);

  // Memoizar mapeo de estados para búsqueda rápida
  const estadoPorId = useMemo(() =>
    Object.fromEntries(ESTADOS_HISTORIA.map((e) => [e.id, e])),
    []
  );

  const filasVisibles = useMemo(() =>
    historias
      .filter((h) => h.fecha_programada && h.fecha_programada.startsWith(mesPrefix))
      .slice()
      .sort((a, b) =>
        (a.fecha_programada + (clientesPorId[a.cliente_id] || "") + (a.metadata?.hora || "")).localeCompare(
          b.fecha_programada + (clientesPorId[b.cliente_id] || "") + (b.metadata?.hora || ""),
        ),
      ),
    [historias, mesPrefix, clientesPorId]
  );

  const enfocarCelda = useCallback((rowIndex, columna) => {
    const el = gridRef.current?.querySelector(
      `[data-cell="${rowIndex}:${columna}"]`,
    );
    if (!el) return;
    el.focus();
    if (typeof el.select === "function") el.select();
  }, []);

  // Foco tras crear/duplicar una fila: el padre avisa por prop cuál es el
  // id nuevo apenas responde el servidor.
  useEffect(() => {
    if (!ultimoIdCreado) return;
    const idx = filasVisibles.findIndex((h) => h.id === ultimoIdCreado);
    if (idx === -1) return;
    requestAnimationFrame(() => enfocarCelda(idx, "fecha"));
  }, [ultimoIdCreado, filasVisibles, enfocarCelda]);

  const actualizarLocal = useCallback((historiaId, campos) => onActualizarLocal(historiaId, campos), [onActualizarLocal]);
  const guardarEnServidor = useCallback((historiaId, campos) => onGuardarServidor(historiaId, campos), [onGuardarServidor]);

  // onBlur de las celdas de texto: recorta espacios y sincroniza el
  // estado local con lo mismo que se manda al servidor (evita que quede
  // un valor con espacios en el input mientras la DB ya tiene la versión
  // recortada).
  const confirmarCampoTexto = useCallback((historiaId, campos) => {
    actualizarLocal(historiaId, campos);
    guardarEnServidor(historiaId, campos);
  }, [actualizarLocal, guardarEnServidor]);

  const copiarFila = useCallback(async (h) => {
    const est = estadoPorId[h.estado];
    const linea = [
      clientesPorId[h.cliente_id] || "",
      h.fecha_programada || "",
      h.metadata?.hora || "",
      h.metadata?.tipo || "",
      h.copy || "",
      h.material_referencia || "",
      h.aclaraciones || "",
      h.responsable_diseño || h.responsable || "",
      est?.label || h.estado || "",
    ].join("\t");
    try {
      await navigator.clipboard.writeText(linea);
    } catch (err) {
      console.error("No se pudo copiar la fila", err);
    }
  }, [clientesPorId, estadoPorId]);

  // Crece el textarea con el contenido en vez de esconder texto o abrir
  // scroll interno — la fila entera se estira, igual que en el Sheet.
  const ajustarAltura = useCallback((el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Enter mueve a la misma columna, fila de abajo (como Sheets/Excel). En
  // copy/observaciones Enter inserta un renglón propio en cambio — son
  // textos largos que legítimamente llevan varias líneas (un copy de
  // Instagram con su propio salto de párrafo, por ejemplo).
  const manejarEnterOTab = useCallback((e, rowIndex, columna) => {
    if (COLUMNAS_MULTILINEA.includes(columna)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      enfocarCelda(rowIndex + 1, columna);
    }
    // Tab usa el orden natural del DOM — no hace falta manejarlo a mano.
  }, [enfocarCelda]);

  // Pegado multi-celda: si el portapapeles trae tabs (un bloque copiado de
  // Sheets), lo distribuye sobre las filas/columnas existentes a partir de
  // la celda activa. En columnas de texto largo un salto de línea solo no
  // dispara esto — puede ser contenido real (un copy de varios renglones)
  // pegado en una sola celda, no un rango de Sheets.
  const manejarPaste = useCallback((e, rowIndex, columna) => {
    const texto = e.clipboardData.getData("text/plain");
    const esMultilinea = COLUMNAS_MULTILINEA.includes(columna);
    const esPegadoMultiCelda = esMultilinea
      ? texto.includes("\t")
      : texto.includes("\t") || texto.includes("\n");
    if (!esPegadoMultiCelda) return;
    e.preventDefault();

    const filasTexto = texto.replace(/\r/g, "").split("\n");
    while (filasTexto.length > 1 && filasTexto[filasTexto.length - 1] === "") {
      filasTexto.pop();
    }

    const colInicio = COLUMNAS_PLANILLA.indexOf(columna);

    filasTexto.forEach((filaTexto, dRow) => {
      const historiaObjetivo = filasVisibles[rowIndex + dRow];
      if (!historiaObjetivo) return;

      const valores = filaTexto.split("\t");
      let payload = {};
      valores.forEach((valorCelda, dCol) => {
        const colObjetivo = COLUMNAS_PLANILLA[colInicio + dCol];
        if (!colObjetivo) return;
        const campo = payloadColumnaPlanilla(colObjetivo, valorCelda);
        if (!campo) return;
        payload = {
          ...payload,
          ...campo,
          metadata: { ...(payload.metadata || {}), ...(campo.metadata || {}) },
        };
      });

      if (Object.keys(payload).length > 0) {
        actualizarLocal(historiaObjetivo.id, payload);
        guardarEnServidor(historiaObjetivo.id, payload);
      }
    });
  }, [filasVisibles, actualizarLocal, guardarEnServidor]);

  return (
    <>
      {error && (
        <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando planilla…</div>
      ) : (
        <div className="sheet-frame" ref={gridRef}>
          <table className="sheet-table sheet-planning-table">
            <colgroup>
              <col className="sheet-rownum-col" />
              <col className="sheet-client-col" />
              <col className="sheet-day-col" />
              <col className="sheet-date-col" />
              <col className="sheet-time-col" />
              <col className="sheet-type-col" />
              <col className="sheet-copy-col" />
              <col className="sheet-material-col" />
              <col className="sheet-notes-col" />
              <col className="sheet-owner-col" />
              <col className="sheet-status-col" />
              <col className="sheet-actions-col" />
            </colgroup>
            <thead>
              <tr className="sheet-column-letters">
                <th className="sheet-corner"></th>
                {["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].map((letra) => (
                  <th key={letra}>{letra}</th>
                ))}
              </tr>
              <tr>
                <th className="sheet-rownum-head"></th>
                <th>Local</th>
                <th>Día</th>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Copy</th>
                <th>Material</th>
                <th>Observaciones</th>
                <th>Responsable</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ textAlign: "center", padding: "24px", color: "#999" }}>
                    Sin historias planificadas este mes todavía.
                  </td>
                </tr>
              )}
              {filasVisibles.map((h, rowIndex) => {
                // Cache de cálculos por historia para evitar recalcular en cada render
                const cacheKey = `${h.id}:${h.fecha_programada}:${h.estado}`;
                const fecha = new Date(`${h.fecha_programada}T00:00:00`);
                const dow = fecha.getDay();
                const esFinde = dow === 0 || dow === 6;
                const esHoy = h.fecha_programada === hoyISO;
                const estaAtrasada = h.fecha_programada < hoyISO && h.estado !== "publicada";
                const est = estadoPorId[h.estado] || ESTADOS_HISTORIA[0];
                // Franjeado sutil por día (no por fila): ayuda a distinguir
                // rápido dónde termina un día y empieza el siguiente, igual
                // que en el Sheet, sin competir con hoy/atrasada/finde.
                const diaPar = fecha.getDate() % 2 === 0;
                const bgFila = estaAtrasada ? "#fff5f5" : esHoy ? "#e3f2fd" : esFinde ? "#fafafa" : diaPar ? "#fbfcfa" : undefined;
                const esNuevoDia = rowIndex === 0 || filasVisibles[rowIndex - 1].fecha_programada !== h.fecha_programada;

                return (
                  <tr key={h.id} style={{ background: bgFila, borderTop: esNuevoDia && rowIndex > 0 ? "2px solid #dadce0" : undefined }}>
                    <td className="sheet-row-number">{rowIndex + 1}</td>
                    <td className="sheet-client-cell">
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:cliente`}
                        value={h.cliente_id || ""}
                        onChange={(e) => {
                          const campos = { cliente_id: Number(e.target.value) };
                          actualizarLocal(h.id, campos);
                          guardarEnServidor(h.id, campos);
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "cliente")}
                      >
                        {clientes.map((cliente) => (
                          <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td className="sheet-day-cell" style={{ fontWeight: esHoy ? "700" : "600", color: estaAtrasada ? "#c62828" : esFinde ? "#999" : "#333" }}>
                      {esNuevoDia ? LETRAS_DIA[dow] : ""}
                      {estaAtrasada && esNuevoDia && <span title="Atrasada" style={{ marginLeft: "2px" }}>⚠</span>}
                    </td>
                    <td className="sheet-date-cell">
                      <input
                        type="date"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:fecha`}
                        value={h.fecha_programada || ""}
                        onChange={(e) => actualizarLocal(h.id, { fecha_programada: e.target.value })}
                        onBlur={(e) => guardarEnServidor(h.id, { fecha_programada: e.target.value })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "fecha")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "fecha")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:hora`}
                        placeholder="—"
                        value={h.metadata?.hora || ""}
                        onChange={(e) => actualizarLocal(h.id, { metadata: { hora: e.target.value } })}
                        onBlur={(e) => confirmarCampoTexto(h.id, { metadata: { hora: e.target.value.trim() } })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "hora")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "hora")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:tipo`}
                        placeholder="Testimonio, promo…"
                        value={h.metadata?.tipo || ""}
                        onChange={(e) => actualizarLocal(h.id, { metadata: { tipo: e.target.value } })}
                        onBlur={(e) => confirmarCampoTexto(h.id, { metadata: { tipo: e.target.value.trim() } })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "tipo")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "tipo")}
                      />
                    </td>
                    <td className="h-copy-cell">
                      <textarea
                        className="sheet-cell sheet-cell-textarea"
                        data-cell={`${rowIndex}:copy`}
                        placeholder="Escribir copy…"
                        rows={1}
                        ref={ajustarAltura}
                        value={h.copy || ""}
                        onChange={(e) => {
                          actualizarLocal(h.id, { copy: e.target.value });
                          ajustarAltura(e.target);
                        }}
                        onBlur={(e) => confirmarCampoTexto(h.id, { copy: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "copy")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "copy")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:material`}
                        placeholder="Link…"
                        value={h.material_referencia || ""}
                        onChange={(e) => actualizarLocal(h.id, { material_referencia: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(h.id, { material_referencia: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "material")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "material")}
                      />
                    </td>
                    <td>
                      <textarea
                        className="sheet-cell sheet-cell-textarea"
                        data-cell={`${rowIndex}:aclaraciones`}
                        placeholder="—"
                        rows={1}
                        ref={ajustarAltura}
                        value={h.aclaraciones || ""}
                        onChange={(e) => {
                          actualizarLocal(h.id, { aclaraciones: e.target.value });
                          ajustarAltura(e.target);
                        }}
                        onBlur={(e) => confirmarCampoTexto(h.id, { aclaraciones: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "aclaraciones")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "aclaraciones")}
                      />
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:responsable`}
                        value={h.responsable_diseño || h.responsable || "Augusto"}
                        onChange={(e) => {
                          const campos = { responsable: e.target.value, responsable_diseño: e.target.value };
                          actualizarLocal(h.id, campos);
                          guardarEnServidor(h.id, campos);
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "responsable")}
                      >
                        {RESPONSABLES_EQUIPO.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:estado`}
                        value={h.estado}
                        onChange={(e) => {
                          actualizarLocal(h.id, { estado: e.target.value });
                          guardarEnServidor(h.id, { estado: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "estado")}
                        style={{ background: est.bg, color: est.fg, fontWeight: "600", border: "1px solid transparent" }}
                      >
                        {ESTADOS_HISTORIA.map((e) => (
                          <option key={e.id} value={e.id}>{e.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="sheet-row-actions">
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => copiarFila(h)}
                          title="Copiar fila (para pegar en otra fila o en Sheets)"
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => onDuplicar(h)}
                          title="Duplicar historia"
                        >
                          ⎘
                        </button>
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => onEliminar(h.id)}
                          title="Eliminar"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="sheet-row-number">{filasVisibles.length + 1}</td>
                <td colSpan={11} style={{ padding: 0 }}>
                  <button type="button" className="sheet-add-row" onClick={onAgregar}>
                    <span style={{ fontSize: "15px" }}>+</span> Agregar historia
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="caption" style={{ marginTop: "10px" }}>
        {clienteFiltradoNombre
          ? `Planilla de ${clienteFiltradoNombre}.`
          : "Planilla general de historias: todos los locales en una sola hoja."}
      </div>
    </>
  );
}

// ── HOJA POR CLIENTE: calendario día por día de un cliente ──────────────────
const DIAS_SEMANA_CLIENTE = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES_CLIENTE = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function HistoriasClienteTab({ clientes, estructura, historias, year, month }) {
  const [clienteSeleccionado, setClienteSeleccionado] = useState(clientes.length > 0 ? clientes[0].id : null);

  const DIAS_SEMANA = DIAS_SEMANA_CLIENTE;
  const MESES = MESES_CLIENTE;
  const clienteActual = useMemo(() => clientes.find((c) => c.id === clienteSeleccionado), [clientes, clienteSeleccionado]);

  const estructuraPorDia = useMemo(() => {
    const acc = {};
    if (estructura && clienteSeleccionado) {
      estructura.forEach((e) => {
        if (e.cliente_id === clienteSeleccionado) {
          acc[e.dia_semana] = e;
        }
      });
    }
    return acc;
  }, [estructura, clienteSeleccionado]);

  // Indexar historias del cliente por fecha ISO — evita un .filter() O(n)
  // por cada una de las ~35 celdas del calendario (era O(dias * historias)).
  const historiasPorFecha = useMemo(() => {
    const acc = {};
    historias.forEach((h) => {
      if (h.cliente_id !== clienteSeleccionado || !h.fecha_programada) return;
      (acc[h.fecha_programada] = acc[h.fecha_programada] || []).push(h);
    });
    return acc;
  }, [historias, clienteSeleccionado]);

  const semanas = useMemo(() => {
    const primerDia = new Date(year, month, 1);
    const ultimoDia = new Date(year, month + 1, 0);
    const inicioCalendario = new Date(primerDia);
    inicioCalendario.setDate(primerDia.getDate() - ((primerDia.getDay() + 6) % 7));

    const resultado = [];
    const cursor = new Date(inicioCalendario);
    while (cursor <= ultimoDia) {
      const dias = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const diaSemana = d.getDay();
        const estructuraDelDia = estructuraPorDia[diaSemana];

        dias.push({
          date: d,
          iso,
          diaSemana,
          esDiaMes: d.getMonth() === primerDia.getMonth(),
          tema: estructuraDelDia?.tema || estructuraDelDia?.tipo || "No definido",
          horario: estructuraDelDia?.horario || "",
          historiasDelDia: historiasPorFecha[iso] || [],
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      resultado.push(dias);
    }
    return resultado;
  }, [year, month, estructuraPorDia, historiasPorFecha]);

  if (!clienteActual) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#999" }}>No hay clientes cargados</div>;
  }

  return (
    <>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "24px" }}>
        <label style={{ fontWeight: "600", color: "#333", fontSize: "14px" }}>Seleccionar cliente:</label>
        <select
          value={clienteSeleccionado}
          onChange={(e) => setClienteSeleccionado(Number(e.target.value))}
          style={{
            padding: "10px 14px",
            border: "1px solid #ddd",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "500",
            cursor: "pointer",
            background: "white",
          }}
        >
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      <div style={{ background: "linear-gradient(135deg, #1565c0 0%, #1976d2 100%)", color: "white", padding: "20px", borderRadius: "8px", marginBottom: "24px", boxShadow: "0 2px 8px rgba(21,101,192,0.2)" }}>
        <h2 style={{ fontSize: "20px", margin: "0 0 8px 0", fontWeight: "700" }}>{clienteActual.nombre}</h2>
        <p style={{ fontSize: "13px", margin: "0", opacity: 0.95, display: "flex", gap: "8px" }}>
          <span>🏢 {clienteActual.rubro || "—"}</span>
          {clienteActual.frecuencia && <span>•</span>}
          {clienteActual.frecuencia && <span>📅 {clienteActual.frecuencia}</span>}
        </p>
      </div>

      <div style={{ marginBottom: "16px", fontSize: "12px", color: "#666", padding: "12px", background: "#f0f4ff", borderRadius: "6px", borderLeft: "3px solid #1976d2" }}>
        📋 <strong>{MESES[month]} {year}</strong> — Estructura día por día
      </div>

      {semanas.map((dias, semanaIdx) => {
        const semanaInicio = dias.find((d) => d.esDiaMes);
        if (!semanaInicio) return null;

        return (
          <div key={semanaIdx} style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "12px", fontWeight: "700", color: "#1565c0", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Semana {semanaIdx + 1}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: "10px",
                background: "white",
                padding: "16px",
                borderRadius: "8px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              }}
            >
              {dias.map((dia) => (
                <div
                  key={dia.iso}
                  style={{
                    background: dia.esDiaMes ? "#f5f8ff" : "#f9f9f9",
                    border: dia.esDiaMes ? "2px solid #e3f2fd" : "1px solid #e8e8e8",
                    borderRadius: "8px",
                    padding: "12px",
                    textAlign: "center",
                    minHeight: "110px",
                    display: "flex",
                    flexDirection: "column",
                    opacity: !dia.esDiaMes ? 0.4 : 1,
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#999", marginBottom: "2px", textTransform: "uppercase" }}>
                    {DIAS_SEMANA[dia.diaSemana]}
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: "700", color: "#1976d2", marginBottom: "8px" }}>
                    {String(dia.date.getDate()).padStart(2, "0")}
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#333", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: "1.3" }}>
                    {dia.tema}
                  </div>
                  {dia.horario && (
                    <div style={{ fontSize: "11px", color: "#1976d2", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e0e8ff", fontWeight: "500" }}>
                      🕐 {dia.horario}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function HistoriasChecklistPublicadasTab({ clientes, historias, cargando, year, month, onHistoriasActualizadas }) {
  const [error, setError] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);
  const [checks, setChecks] = useState([]);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];

  const historiasMes = useMemo(() =>
    historias.filter((h) => h.fecha_programada && h.fecha_programada.startsWith(mesPrefix)),
    [historias, mesPrefix]
  );

  const historiasPorClienteFecha = useMemo(() =>
    historiasMes.reduce((acc, h) => {
      const key = `${h.cliente_id}:${h.fecha_programada}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(h);
      return acc;
    }, {}),
    [historiasMes]
  );

  const checksPorClienteFecha = useMemo(() =>
    checks.reduce((acc, check) => {
      acc[`${check.cliente_id}:${check.fecha}`] = check;
      return acc;
    }, {}),
    [checks]
  );

  const semanas = useMemo(() => {
    const primerDiaMes = new Date(year, month, 1);
    const ultimoDiaMes = new Date(year, month + 1, 0);
    const inicioCalendario = new Date(primerDiaMes);
    inicioCalendario.setDate(primerDiaMes.getDate() - ((primerDiaMes.getDay() + 6) % 7));
    const finCalendario = new Date(ultimoDiaMes);
    finCalendario.setDate(ultimoDiaMes.getDate() + (7 - ((ultimoDiaMes.getDay() + 6) % 7) - 1));

    const resultado = [];
    const cursor = new Date(inicioCalendario);
    while (cursor <= finCalendario) {
      const dias = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        dias.push({
          date: d,
          iso,
          label: `${LETRAS_DIA[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      resultado.push(dias);
    }
    return resultado;
  }, [year, month]);

  useEffect(() => {
    const desde = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const hasta = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;

    fetch(`/api/check-publicacion?desde=${desde}&hasta=${hasta}`)
      .then((r) => {
        if (!r.ok) throw new Error("No se pudo cargar el checklist");
        return r.json();
      })
      .then((data) => setChecks(data))
      .catch((err) => {
        console.error("No se pudo cargar checklist de historias", err);
        setError("No se pudo cargar el estado del checklist.");
      });
  }, [year, month]);

  const { publicadas, pendientes, vencidas } = useMemo(() => {
    const pub = historiasMes.filter((h) => h.estado === "publicada").length;
    const venc = historiasMes.filter(
      (h) => h.estado !== "publicada" && h.fecha_programada < hoyISO,
    ).length;
    return { publicadas: pub, pendientes: historiasMes.length - pub, vencidas: venc };
  }, [historiasMes, hoyISO]);

  const marcarPublicada = useCallback(async (clienteId, fecha, publicada) => {
    const nuevoEstado = publicada ? "publicada" : "pendiente";
    const key = `${clienteId}:${fecha}`;
    const historiasDelDia = historiasPorClienteFecha[key] || [];

    setGuardandoId(key);
    setChecks((prev) => {
      const existe = prev.some((check) => check.cliente_id === clienteId && check.fecha === fecha);
      if (existe) {
        return prev.map((check) =>
          check.cliente_id === clienteId && check.fecha === fecha
            ? { ...check, publicado: publicada }
            : check,
        );
      }
      return [
        ...prev,
        {
          id: `local-${key}`,
          cliente_id: clienteId,
          fecha,
          publicado: publicada,
          confirmado_por: getSesion()?.usuario?.nombre || null,
        },
      ];
    });
    onHistoriasActualizadas((prev) =>
      prev.map((h) =>
        h.cliente_id === clienteId && h.fecha_programada === fecha
          ? { ...h, estado: nuevoEstado }
          : h,
      ),
    );
    try {
      const checkRes = await fetch("/api/check-publicacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          fecha,
          publicado: publicada,
          confirmado_por: getSesion()?.usuario?.nombre || "Sistema",
        }),
      });
      if (!checkRes.ok) throw new Error("No se pudo guardar el OK");

      await Promise.all(
        historiasDelDia.map(async (h) => {
          const res = await fetch(`/api/historias/${h.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado: nuevoEstado }),
          });
          if (!res.ok) throw new Error("No se pudo guardar");
        }),
      );
      setError(null);
    } catch (err) {
      console.error("Error actualizando checklist", err);
      setError("No se pudo actualizar el checklist. Reintentá.");
    } finally {
      setGuardandoId(null);
    }
  }, [historiasPorClienteFecha, onHistoriasActualizadas]);

  return (
    <>
      <div className="sheet-toolbar">
        <div className="sheet-stats">
          <span>{historiasMes.length} historias</span>
          <span className="ok">{publicadas} publicadas</span>
          <span className="warn">{pendientes} pendientes</span>
          {vencidas > 0 && <span className="danger">{vencidas} vencidas</span>}
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando checklist…</div>
      ) : (
        <div className="sheet-frame check-sheet-frame">
          <div className="sheet-namebar">CHECK HISTORIAS — {MESES[month].toUpperCase()} {year}</div>
          {semanas.map((dias, semanaIndex) => {
            const desde = dias[0];
            const hasta = dias[6];
            const totalSemana = clientes.reduce(
              (acc, c) =>
                acc +
                dias.reduce((sum, d) => {
                  const items = historiasPorClienteFecha[`${c.id}:${d.iso}`] || [];
                  const check = checksPorClienteFecha[`${c.id}:${d.iso}`];
                  const publicadaPorHistorias = items.length > 0 && items.every((h) => h.estado === "publicada");
                  return sum + (check?.publicado || publicadaPorHistorias ? 1 : 0);
                }, 0),
              0,
            );
            const totalPorDia = dias.map((d) =>
              clientes.reduce((sum, c) => {
                const items = historiasPorClienteFecha[`${c.id}:${d.iso}`] || [];
                const check = checksPorClienteFecha[`${c.id}:${d.iso}`];
                const publicadaPorHistorias = items.length > 0 && items.every((h) => h.estado === "publicada");
                return sum + (check?.publicado || publicadaPorHistorias ? 1 : 0);
              }, 0),
            );

            return (
              <table className="check-sheet-table" key={desde.iso}>
                <thead>
                  <tr>
                    <th colSpan={9} className="check-week-title">
                      SEMANA {semanaIndex + 1} — {desde.label.slice(2)} al {hasta.label.slice(2)}
                    </th>
                  </tr>
                  <tr>
                    <th className="check-client-col">Cliente</th>
                    {dias.map((d) => (
                      <th key={d.iso} className={d.iso === hoyISO ? "check-day today" : "check-day"}>
                        {d.label}
                      </th>
                    ))}
                    <th className="check-total-col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => {
                    const totalCliente = dias.reduce((sum, d) => {
                      const items = historiasPorClienteFecha[`${c.id}:${d.iso}`] || [];
                      const check = checksPorClienteFecha[`${c.id}:${d.iso}`];
                      const publicadaPorHistorias = items.length > 0 && items.every((h) => h.estado === "publicada");
                      return sum + (check?.publicado || publicadaPorHistorias ? 1 : 0);
                    }, 0);

                    return (
                      <tr key={c.id}>
                        <td className="check-client-col">{c.nombre}</td>
                        {dias.map((d) => {
                          const key = `${c.id}:${d.iso}`;
                          const items = historiasPorClienteFecha[key] || [];
                          const check = checksPorClienteFecha[key];
                          const hayHistorias = items.length > 0;
                          const publicadasDia = items.filter((h) => h.estado === "publicada").length;
                          const todasPublicadas = Boolean(check?.publicado) || (hayHistorias && publicadasDia === items.length);
                          const algunasPublicadas = !check?.publicado && publicadasDia > 0 && publicadasDia < items.length;
                          return (
                            <td
                              key={d.iso}
                              className={[
                                "check-day-cell",
                                !hayHistorias && !check?.publicado ? "empty" : "",
                                todasPublicadas ? "ok" : "",
                                algunasPublicadas ? "partial" : "",
                              ].join(" ")}
                              title={
                                hayHistorias
                                  ? `${items.length} historia${items.length > 1 ? "s" : ""} · ${publicadasDia} publicada${publicadasDia !== 1 ? "s" : ""}`
                                  : check?.publicado
                                    ? "OK marcado en checklist"
                                    : "Sin historias planificadas"
                              }
                            >
                              <button
                                type="button"
                                className="check-sheet-toggle"
                                disabled={guardandoId === key}
                                aria-label={todasPublicadas ? "Quitar OK" : "Marcar OK"}
                                onClick={() => marcarPublicada(c.id, d.iso, !todasPublicadas)}
                              >
                                {guardandoId === key ? "..." : (todasPublicadas ? "✓" : "")}
                              </button>
                            </td>
                          );
                        })}
                        <td className="check-total-col">{totalCliente}</td>
                      </tr>
                    );
                  })}
                  <tr className="check-total-row">
                    <td>Total por día</td>
                    {totalPorDia.map((total, idx) => (
                      <td key={dias[idx].iso}>{total}</td>
                    ))}
                    <td>{totalSemana}</td>
                  </tr>
                </tbody>
              </table>
            );
          })}
        </div>
      )}

      <div className="caption" style={{ marginTop: "10px" }}>
        Matriz mensual igual a CHECKHISTORIAS: clientes por fila, días por columna.
      </div>
    </>
  );
}

function HistoriasEstructuraTab({ clientes }) {
  const [estructura, setEstructura] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const DIAS_SEMANA = [
    { id: 1, label: "Lunes", abrev: "L" },
    { id: 2, label: "Martes", abrev: "M" },
    { id: 3, label: "Miércoles", abrev: "X" },
    { id: 4, label: "Jueves", abrev: "J" },
    { id: 5, label: "Viernes", abrev: "V" },
    { id: 6, label: "Sábado", abrev: "S" },
    { id: 0, label: "Domingo", abrev: "D" },
  ];

  useEffect(() => {
    setCargando(true);
    fetch("/api/estructura")
      .then((r) => r.json())
      .then((data) => {
        setEstructura(data);
        setError(null);
      })
      .catch((err) => {
        console.error("No se pudo cargar estructura", err);
        setError("No se pudo cargar la estructura.");
      })
      .finally(() => setCargando(false));
  }, []);

  const estructuraPorClienteDia = {};
  estructura.forEach((e) => {
    if (!estructuraPorClienteDia[e.cliente_id]) estructuraPorClienteDia[e.cliente_id] = {};
    estructuraPorClienteDia[e.cliente_id][e.dia_semana] = e;
  });

  if (cargando) {
    return <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando estructura…</div>;
  }

  return (
    <>
      {error && (
        <div style={{ padding: "12px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "20px", fontSize: "13px" }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ background: "white", borderRadius: "8px", padding: "20px", marginBottom: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0", color: "#333" }}>📅 Estructura Semanal de Historias</h2>
        <p style={{ fontSize: "13px", color: "#666", margin: "0" }}>
          Qué tema va cada día para cada cliente y a qué hora se publica. Patrón base que se sugiere automáticamente.
        </p>
      </div>

      <div style={{ background: "white", borderRadius: "8px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#1565c0", color: "white" }}>
              <th style={{ padding: "14px 16px", textAlign: "left", fontWeight: "600", fontSize: "13px", borderBottom: "2px solid #0d47a1", minWidth: "140px" }}>
                Cliente
              </th>
              <th style={{ padding: "14px 8px", textAlign: "center", fontWeight: "600", fontSize: "12px", borderBottom: "2px solid #0d47a1", width: "14.28%" }}>
                Rubro
              </th>
              {DIAS_SEMANA.map((dia) => (
                <th
                  key={dia.id}
                  style={{
                    padding: "10px 4px",
                    textAlign: "center",
                    fontWeight: "600",
                    fontSize: "12px",
                    borderBottom: "2px solid #0d47a1",
                    width: "12.5%",
                  }}
                >
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.7)", fontWeight: "400", marginBottom: "1px" }}>{dia.abrev}</div>
                  <div>{dia.label.slice(0, 3)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clientes.map((cliente, idx) => {
              const estructuraCliente = estructuraPorClienteDia[cliente.id] || {};
              return (
                <tr key={cliente.id} style={{ borderBottom: "1px solid #e0e0e0", background: idx % 2 === 0 ? "#fafafa" : "#fff" }}>
                  <td style={{ padding: "16px", fontWeight: "600", color: "#333", fontSize: "13px", verticalAlign: "top" }}>
                    {cliente.nombre}
                  </td>
                  <td style={{ padding: "12px 8px", fontSize: "12px", color: "#666", textAlign: "center", verticalAlign: "top" }}>
                    {cliente.rubro || "—"}
                  </td>
                  {DIAS_SEMANA.map((dia) => {
                    const est = estructuraCliente[dia.id];
                    return (
                      <td
                        key={dia.id}
                        style={{
                          padding: "12px 6px",
                          textAlign: "center",
                          verticalAlign: "top",
                          fontSize: "12px",
                          background: est ? "#f0f4ff" : "#f9f9f9",
                          borderLeft: "1px solid #e0e8ff",
                        }}
                      >
                        {est ? (
                          <div style={{ minHeight: "70px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "4px" }}>
                            {est.horario && (
                              <div style={{ fontSize: "11px", color: "#1976d2", fontWeight: "600", padding: "2px 4px", background: "#e3f2fd", borderRadius: "3px" }}>
                                {est.horario}
                              </div>
                            )}
                            <div style={{ fontSize: "12px", fontWeight: "600", color: "#333" }}>
                              {est.tema || "Sin tema"}
                            </div>
                            {est.tipo && (
                              <div style={{ fontSize: "11px", color: "#999", fontStyle: "italic" }}>
                                ({est.tipo})
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ minHeight: "70px", display: "flex", alignItems: "center", justifyContent: "center", color: "#ccc", fontSize: "11px" }}>
                            —
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: "12px", color: "#666", marginTop: "16px", padding: "12px", background: "#f5f5f5", borderRadius: "4px" }}>
        💡 <strong>Consejo:</strong> Cuando agregues una historia nueva, el tipo y horario de ese día se sugieren automáticamente basándose en esta estructura.
      </div>
    </>
  );
}

function HistoriasFechasEspecialesTab({ clientes }) {
  const [fechasEspeciales, setFechasEspeciales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setCargando(true);
    fetch("/api/fechas-especiales")
      .then((r) => r.json())
      .then((data) => {
        setFechasEspeciales(
          data.slice().sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "")),
        );
        setError(null);
      })
      .catch((err) => {
        console.error("No se pudieron cargar fechas especiales", err);
        setError("No se pudieron cargar las fechas especiales.");
      })
      .finally(() => setCargando(false));
  }, []);

  const hoyISO = getHoyLocalISO();
  const estadoLabel = { pendiente: "Pendiente", en_curso: "En curso", hecho: "Hecho" };
  const clientesPorId = Object.fromEntries(clientes.map((c) => [c.id, c.nombre]));

  if (cargando) {
    return <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando fechas especiales…</div>;
  }

  return (
    <>
      {error && (
        <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      <div className="sheet-frame">
        <div className="sheet-namebar">Fechas especiales</div>
        {fechasEspeciales.length === 0 ? (
          <div style={{ color: "#999", textAlign: "center", padding: "20px" }}>No hay fechas especiales registradas.</div>
        ) : (
          <table className="sheet-table historias-special-dates-table">
            <thead>
              <tr>
                <th style={{ width: "110px" }}>Fecha</th>
                <th style={{ width: "170px" }}>Local</th>
                <th style={{ width: "24%" }}>Motivo</th>
                <th>Acción sugerida</th>
                <th style={{ width: "110px" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {fechasEspeciales.map((f) => (
                <tr key={f.id} className={f.fecha && f.fecha < hoyISO && f.estado !== "hecho" ? "sheet-row-danger" : undefined}>
                  <td style={{ padding: "8px 10px" }}>{f.fecha || "Sin fecha"}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{f.cliente_id ? clientesPorId[f.cliente_id] || "Sin local" : "Todos"}</td>
                  <td style={{ padding: "8px 10px" }}>{f.evento || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{f.idea || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span className="sheet-status-pill" style={{ background: f.estado === "hecho" ? "#c8e6c9" : f.estado === "en_curso" ? "#fff9c4" : "#ffccbc" }}>
                      {estadoLabel[f.estado] || f.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function FlyersMigrarBanner({ onMigrado }) {
  const [flyers, setFlyers] = useState([]);
  const [migrando, setMigrando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((data) => setFlyers(data.filter((p) => p.tipo === "flyer")))
      .catch((err) => console.error("No se pudieron revisar flyers legacy", err));
  }, []);

  if (flyers.length === 0) return null;

  const migrarTodos = async () => {
    setMigrando(true);
    setError(null);
    try {
      for (const f of flyers) {
        const res = await fetch(`/api/historias/convertir-flyer/${f.id}`, { method: "POST" });
        if (!res.ok) throw new Error("Falló la conversión de un flyer");
      }
      setFlyers([]);
      onMigrado && onMigrado();
    } catch (err) {
      console.error("Error migrando flyers", err);
      setError("No se pudieron convertir todos los flyers. Reintentá.");
    } finally {
      setMigrando(false);
    }
  };

  return (
    <div style={{ background: "#fff3e0", border: "1px solid #ffb74d", borderRadius: "6px", padding: "12px 16px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
      <div style={{ fontSize: "13px", color: "#e65100" }}>
        ⚠️ Hay <strong>{flyers.length}</strong> flyer{flyers.length > 1 ? "s" : ""} viejo{flyers.length > 1 ? "s" : ""} en Publicaciones. Los flyers ahora viven dentro de Historias.
        {error && <div style={{ marginTop: "4px" }}>{error}</div>}
      </div>
      <button className="btn" type="button" disabled={migrando} onClick={migrarTodos}>
        {migrando ? "Convirtiendo…" : `Convertir ${flyers.length} a Historias`}
      </button>
    </div>
  );
}

function getInicialesCliente(nombre = "") {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
}

function ClientesRail({ clientes, clienteSeleccionado, onSeleccionar, atrasadasPorCliente, compacto, onToggleCompacto }) {
  const [busqueda, setBusqueda] = useState("");
  const filtrados = clientes.filter((c) =>
    c.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
  );

  return (
    <aside className={`h-rail ${compacto ? "compact" : ""}`}>
      <div className="h-rail-head">
        <div className="h-rail-titlebar">
          <span>Locales</span>
          <button
            type="button"
            className="h-rail-toggle"
            onClick={onToggleCompacto}
            aria-label={compacto ? "Expandir locales" : "Compactar locales"}
            title={compacto ? "Expandir locales" : "Compactar locales"}
          >
            {compacto ? ">" : "<"}
          </button>
        </div>
        {!compacto && (
          <div className="h-rail-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Buscar local…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="h-rail-list">
        {filtrados.map((c) => {
          const atrasadas = atrasadasPorCliente[c.id] || 0;
          return (
            <button
              key={c.id}
              type="button"
              className={`h-client-row ${clienteSeleccionado === c.id ? "active" : ""}`}
              onClick={() => onSeleccionar(c.id)}
              title={c.nombre}
            >
              <span className={`h-client-dot ${atrasadas > 0 ? "danger" : "ok"}`}></span>
              {compacto && <span className="h-client-initials">{getInicialesCliente(c.nombre)}</span>}
              <span className="h-client-name">{c.nombre}</span>
              {atrasadas > 0 && <span className="h-client-badge">{atrasadas}</span>}
            </button>
          );
        })}
        {filtrados.length === 0 && (
          <div className="caption" style={{ padding: "10px" }}>Sin resultados.</div>
        )}
      </div>
    </aside>
  );
}

function HistoriasPage({ initialTab = "estructura" }) {
  const [vista, setVista] = useState(
    ["estructura", "checklist", "fechas"].includes(initialTab) ? initialTab : "estructura",
  );
  const [clientes, setClientes] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  // Filtro de cliente propio de la pestaña Planilla — separado de
  // clienteSeleccionado (que ya se usaba como destino por default de
  // "+ Nueva historia" en otras pestañas) para no cambiar ese comportamiento
  // existente. Vacío = "Hoja general" (todos los clientes), como hoy.
  const [filtroClientePlanilla, setFiltroClientePlanilla] = useState("");
  const [errorClientes, setErrorClientes] = useState(null);
  const [refrescarKey, setRefrescarKey] = useState(0);

  const [historias, setHistorias] = useState([]);
  const [cargandoHistorias, setCargandoHistorias] = useState(true);
  const [errorHistorias, setErrorHistorias] = useState(null);
  const [estructura, setEstructura] = useState([]);
  const [ultimoIdCreado, setUltimoIdCreado] = useState(null);

  const hoyDate = new Date();
  const [year, setYear] = useState(hoyDate.getFullYear());
  const [month, setMonth] = useState(hoyDate.getMonth());

  useEffect(() => {
    fetch("/api/clientes")
      .then((r) => r.json())
      .then((data) => {
        setClientes(data);
        if (data.length > 0) setClienteSeleccionado(data[0].id);
      })
      .catch((err) => {
        console.error("No se pudieron cargar clientes", err);
        setErrorClientes("No se pudieron cargar los clientes.");
      });
  }, []);

  const cargarHistorias = () => {
    setCargandoHistorias(true);
    fetch("/api/historias")
      .then((r) => r.json())
      .then((data) => {
        setHistorias(data);
        setErrorHistorias(null);
      })
      .catch((err) => {
        console.error("Error cargando historias", err);
        setErrorHistorias("No se pudieron cargar las historias.");
      })
      .finally(() => setCargandoHistorias(false));
  };
  useEffect(cargarHistorias, [refrescarKey]);

  useEffect(() => {
    fetch("/api/estructura")
      .then((r) => r.json())
      .then((data) => setEstructura(data))
      .catch((err) => console.error("No se pudo cargar la estructura semanal", err));
  }, []);

  const hoyISO = getHoyLocalISO();

  const irMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  };
  const irAHoy = () => {
    setMonth(hoyDate.getMonth());
    setYear(hoyDate.getFullYear());
  };

  const actualizarHistoriaLocal = (historiaId, campos) => {
    setHistorias((prev) =>
      prev.map((h) => {
        if (h.id !== historiaId) return h;
        const actualizado = { ...h, ...campos };
        if (campos.metadata) actualizado.metadata = { ...(h.metadata || {}), ...campos.metadata };
        return actualizado;
      }),
    );
  };

  const guardarHistoriaEnServidor = async (historiaId, campos) => {
    try {
      const res = await fetch(`/api/historias/${historiaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
    } catch (err) {
      console.error("Error guardando", err);
      setErrorHistorias("No se pudo guardar un cambio — reintentá.");
    }
  };

  const crearHistoria = async (clienteIdDestino, fechaISO) => {
    const res = await fetch("/api/piezas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "historia",
        cliente_id: clienteIdDestino,
        responsable: "Augusto",
        fecha_programada: fechaISO,
        estado: "pendiente",
        idea: "",
      }),
    });
    if (!res.ok) throw new Error("No se pudo crear");
    const creada = await res.json();

    // Sugerencia de tipo/hora según el patrón semanal de ese día.
    const diaSemana = new Date(`${fechaISO}T00:00:00`).getDay();
    const patron = estructura.find((e) => e.cliente_id === clienteIdDestino && e.dia_semana === diaSemana);
    let metadataSugerida = {};
    if (patron?.tema || patron?.horario) {
      const horaSugerida = patron.horario?.match(/\d{1,2}:\d{2}/)?.[0] || "";
      metadataSugerida = { tipo: patron.tema || "", hora: horaSugerida };
      await fetch(`/api/historias/${creada.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: metadataSugerida }),
      }).catch((err) => console.error("No se pudo sugerir tipo/hora", err));
    }

    setHistorias((prev) => [...prev, { ...creada, metadata: metadataSugerida }]);
    return creada.id;
  };

  // Punto de entrada único para "agregar historia": lo usan tanto el botón
  // de la barra superior (accesible sin scrollear hasta el pie de la
  // grilla) como el renglón "+" al final de la tabla — ambos crean en el
  // mismo lugar (hoy, o el día 1 si se está viendo otro mes) y enfocan la
  // fila nueva apenas aparece.
  const agregarHistoriaEnMesActual = async () => {
    // Si la Planilla está filtrada a un cliente, la historia nueva se crea
    // para ESE cliente (no tendría sentido crearla para otro mientras se
    // está mirando la hoja de uno en particular).
    const clienteDestino =
      vista === "planilla"
        ? (filtroClientePlanilla ? Number(filtroClientePlanilla) : clientes[0]?.id) || clienteSeleccionado
        : clienteSeleccionado;
    if (!clienteDestino) return;
    const hoyISOActual = getHoyLocalISO();
    const mesActualPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const iso = mesActualPrefix === hoyISOActual.slice(0, 7) ? hoyISOActual : `${mesActualPrefix}-01`;
    try {
      const id = await crearHistoria(clienteDestino, iso);
      setUltimoIdCreado(id);
    } catch (err) {
      console.error("Error creando historia", err);
      setErrorHistorias("No se pudo crear la historia.");
    }
  };

  const duplicarHistoria = async (historia) => {
    try {
      const res = await fetch("/api/piezas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "historia",
          cliente_id: historia.cliente_id,
          responsable: historia.responsable_diseño || historia.responsable || "Augusto",
          fecha_programada: historia.fecha_programada,
          estado: "pendiente",
          idea: historia.idea || "",
          copy: historia.copy || "",
          material_referencia: historia.material_referencia || "",
          aclaraciones: historia.aclaraciones || "",
          prioridad: historia.prioridad || "media",
        }),
      });
      if (!res.ok) throw new Error("No se pudo duplicar");
      const creada = await res.json();
      if (historia.metadata && Object.keys(historia.metadata).length > 0) {
        await fetch(`/api/historias/${creada.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: historia.metadata }),
        }).catch((err) => console.error("No se pudo copiar metadata al duplicar", err));
      }
      const nueva = { ...creada, metadata: historia.metadata || {} };
      setHistorias((prev) => [...prev, nueva]);
      setUltimoIdCreado(nueva.id);
    } catch (err) {
      console.error("Error duplicando historia", err);
      setErrorHistorias("No se pudo duplicar la historia.");
    }
  };

  const eliminarHistoria = async (historiaId) => {
    if (!window.confirm("¿Eliminar esta historia de la planilla?")) return;
    try {
      const res = await fetch(`/api/historias/${historiaId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setHistorias((prev) => prev.filter((h) => h.id !== historiaId));
    } catch (err) {
      console.error("Error eliminando historia", err);
      setErrorHistorias("No se pudo eliminar la historia.");
    }
  };

  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  // Cuando hay un cliente elegido en el selector de la Planilla, todo lo
  // que se ve en esa pestaña (tabla y contadores) se filtra a ese cliente
  // — sin filtro (vacío) se sigue viendo la Hoja general de siempre.
  const historiasPlanillaVisibles = filtroClientePlanilla
    ? historias.filter((h) => String(h.cliente_id) === filtroClientePlanilla)
    : historias;
  const historiasMes = historiasPlanillaVisibles.filter((h) => h.fecha_programada?.startsWith(mesPrefix));
  const publicadasMes = historiasMes.filter((h) => h.estado === "publicada").length;
  const atrasadasMes = historiasMes.filter((h) => h.fecha_programada < hoyISO && h.estado !== "publicada").length;

  return (
    <main aria-label="Render platform historias" className="historias-viewport">
      <div className="frame">
        <div className="content">
          {(errorClientes || errorHistorias) && (
            <div style={{ padding: "10px", background: "#ffebee", color: "#c62828" }}>
              {errorClientes || errorHistorias}
            </div>
          )}

          <div className="h-workspace">
            <div className="h-main">
              <div className="h-toolbar">
                {vista === "planilla" && (
                  <select
                    className="h-toolbar-client-select"
                    value={filtroClientePlanilla}
                    onChange={(e) => setFiltroClientePlanilla(e.target.value)}
                    aria-label="Filtrar planilla por cliente"
                  >
                    <option value="">Hoja general (todos los clientes)</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                )}
                {["planilla", "checklist"].includes(vista) && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button className="btn" type="button" onClick={() => irMes(-1)}>◀</button>
                    <strong className="sheet-title">{MESES[month]} {year}</strong>
                    <button className="btn" type="button" onClick={() => irMes(1)}>▶</button>
                  </div>
                )}
                {["planilla", "checklist"].includes(vista) && (
                  <button className="h-today-btn" type="button" onClick={irAHoy}>Ir a hoy</button>
                )}

                <div className="sheet-view-tabs" style={{ margin: 0 }}>
                  <button type="button" className={vista === "estructura" ? "active" : ""} onClick={() => setVista("estructura")}>1. Estructura</button>
                  <button type="button" className={vista === "checklist" ? "active" : ""} onClick={() => setVista("checklist")}>2. Checklist</button>
                  <button type="button" className={vista === "fechas" ? "active" : ""} onClick={() => setVista("fechas")}>Fechas especiales</button>
                </div>

                {vista === "planilla" && (
                  <div className="sheet-stats" style={{ marginLeft: "auto" }}>
                    <span>{historiasMes.length} historias</span>
                    <span className="ok">{publicadasMes} publicadas</span>
                    {atrasadasMes > 0 && <span className="danger">{atrasadasMes} atrasadas</span>}
                  </div>
                )}

                {vista === "planilla" && clientes.length > 0 && (
                  <button
                    className="add-btn"
                    type="button"
                    style={{ background: "#202124", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}
                    onClick={agregarHistoriaEnMesActual}
                  >
                    + Nueva historia
                  </button>
                )}
              </div>

              <div className="h-body">
                <FlyersMigrarBanner onMigrado={() => setRefrescarKey((k) => k + 1)} />

                {vista === "planilla" && (
                  <HistoriasPlanillaTab
                    key="p-general"
                    clientes={clientes}
                    year={year}
                    month={month}
                    cargando={cargandoHistorias}
                    historias={historiasPlanillaVisibles}
                    ultimoIdCreado={ultimoIdCreado}
                    onActualizarLocal={actualizarHistoriaLocal}
                    onGuardarServidor={guardarHistoriaEnServidor}
                    onAgregar={agregarHistoriaEnMesActual}
                    onDuplicar={duplicarHistoria}
                    onEliminar={eliminarHistoria}
                    clienteFiltradoNombre={
                      filtroClientePlanilla
                        ? clientes.find((c) => String(c.id) === filtroClientePlanilla)?.nombre
                        : null
                    }
                  />
                )}

                {vista === "estructura" && (
                  <HistoriasEstructuraTab
                    key="estructura-general"
                    clientes={clientes}
                  />
                )}

                {vista === "cliente" && (
                  <HistoriasClienteTab
                    key="cliente-general"
                    clientes={clientes}
                    estructura={estructura}
                    historias={historias}
                    year={year}
                    month={month}
                  />
                )}

                {vista === "fechas" && (
                  <HistoriasFechasEspecialesTab
                    key="fechas-especiales"
                    clientes={clientes}
                  />
                )}

                {vista === "checklist" && (
                  <HistoriasChecklistPublicadasTab
                    key={`c-${refrescarKey}`}
                    clientes={clientes}
                    historias={historias}
                    cargando={cargandoHistorias}
                    year={year}
                    month={month}
                    onHistoriasActualizadas={setHistorias}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ── REPORTES DE EQUIPO: rendimiento por empleado ──────────────────────────────

// Paleta compartida por Reportes y Clientes tras el rediseño: acento teal
// cálido en vez del azul/verde genérico anterior, bordes con tinte cálido
// (no gris-azulado frío), números en fuente monoespaciada para que las
// columnas de cifras alineen visualmente entre tarjetas.
const RR = {
  text: "#1b1b18",
  textMuted: "#6b6860",
  textFaint: "#948f83",
  border: "#e3dfd6",
  surface2: "#efece5",
  accent: "#1a8a80",
  success: "#3d7a53",
  successBg: "#e3ede5",
  warning: "#a8641c",
  warningBg: "#f6e9d8",
  danger: "#b23a2e",
  dangerBg: "#f7e6e3",
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace',
};

function ResumenEntregableEquipo({
  etiqueta,
  realizados,
  pendientes,
  total,
  verbo = "realizados",
  verboSingular = "realizado",
  enRevision = false,
}) {
  if (enRevision) {
    return (
      <div style={{ paddingTop: "12px", borderTop: `1px solid ${RR.border}` }}>
        <div style={{ fontWeight: "600", fontSize: "13px", color: RR.text }}>{etiqueta}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginTop: "10px" }}>
          <div style={{ fontSize: "12px", color: RR.textMuted }}>
            Objetivo mensual: <strong style={{ color: RR.text, fontSize: "18px", fontFamily: RR.mono, fontVariantNumeric: "tabular-nums" }}>{total}</strong>
          </div>
          <span style={{ padding: "3px 9px", borderRadius: "999px", background: RR.warningBg, color: RR.warning, fontSize: "11px", fontWeight: "500" }}>
            En revisión
          </span>
        </div>
        <div style={{ marginTop: "9px", fontSize: "12px", lineHeight: 1.5, color: RR.textFaint }}>
          El avance se confirmará cuando quede validada la trazabilidad del material.
        </div>
      </div>
    );
  }
  const porcentaje = total > 0 ? Math.round((realizados / total) * 100) : 0;
  const colorBarra = porcentaje >= 80 ? RR.success : porcentaje >= 50 ? RR.warning : RR.danger;
  return (
    <div style={{ paddingTop: "12px", borderTop: `1px solid ${RR.border}` }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ fontWeight: "600", fontSize: "13px", color: RR.text }}>{etiqueta}</div>
        <div style={{ fontSize: "12px", color: RR.textMuted, whiteSpace: "nowrap" }}>
          <strong style={{ color: RR.text, fontSize: "16px", fontFamily: RR.mono, fontVariantNumeric: "tabular-nums" }}>{realizados}</strong> de {total}
        </div>
      </div>
      <div style={{ height: "6px", background: RR.surface2, borderRadius: "999px", overflow: "hidden", margin: "9px 0 7px" }}>
        <div
          style={{
            width: `${Math.min(porcentaje, 100)}%`,
            height: "100%",
            background: colorBarra,
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "12px", color: RR.textFaint }}>
        <span>{realizados} {realizados === 1 ? verboSingular : verbo}</span>
        <span>{pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}</span>
        <strong style={{ color: RR.textMuted, fontFamily: RR.mono, fontVariantNumeric: "tabular-nums" }}>{porcentaje}%</strong>
      </div>
    </div>
  );
}

function TarjetaEntregablesEquipo({ nombre, rol, metricas = [], proximoMes = false }) {
  const inicial = (nombre || "?").trim().charAt(0).toUpperCase();
  return (
    <article
      style={{
        background: "#fff",
        border: `1px solid ${RR.border}`,
        borderRadius: "12px",
        padding: "16px",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              background: RR.surface2,
              color: RR.textMuted,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "13px",
              fontWeight: "600",
              flexShrink: 0,
            }}
          >
            {inicial}
          </div>
          <div>
            <div style={{ fontWeight: "600", fontSize: "14px", color: RR.text }}>{nombre}</div>
            <div style={{ fontSize: "11px", color: RR.textFaint, marginTop: "1px", textTransform: "uppercase", letterSpacing: "0.03em" }}>{rol}</div>
          </div>
        </div>
        {proximoMes && (
          <span style={{ padding: "4px 9px", borderRadius: "999px", background: "#eef2ff", color: "#3949ab", fontSize: "11px", fontWeight: "500" }}>
            Comienza el próximo mes
          </span>
        )}
      </div>
      {proximoMes ? (
        <div style={{ borderTop: `1px solid ${RR.border}`, paddingTop: "12px", color: RR.textFaint, fontSize: "12px", lineHeight: 1.5 }}>
          Desde agosto se medirán carruseles e historias. Julio no muestra ceros ni porcentajes ficticios.
        </div>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {metricas.map((metrica) => (
            <ResumenEntregableEquipo key={metrica.etiqueta} {...metrica} />
          ))}
        </div>
      )}
    </article>
  );
}

function ReportesEquipoPage() {
  const sesion = getSesion();
  const usuarioSesion = sesion?.usuario;
  const esVistaAdmin = usuarioSesion?.rol === "admin";
  const nombrePropio = usuarioSesion?.nombre;
  const [tareas, setTareas] = useState([]);
  const [historias, setHistorias] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [periodo, setPeriodo] = useState("mes_actual");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [detalleDe, setDetalleDe] = useState(null);

  useEffect(() => {
    const tareasUrl =
      esVistaAdmin || !nombrePropio
        ? "/api/tareas"
        : `/api/tareas?asignado_a=${encodeURIComponent(nombrePropio)}`;
    Promise.all([
      fetch(tareasUrl).then((r) => r.json()),
      fetch("/api/historias").then((r) => r.json()),
      fetch("/api/publicaciones").then((r) => r.json()),
      fetch("/api/usuarios").then((r) => r.json()),
    ])
      .then(([t, h, p, u]) => {
        setTareas(Array.isArray(t) ? t : []);
        setHistorias(Array.isArray(h) ? h : []);
        setPublicaciones(Array.isArray(p) ? p : []);
        setUsuarios(Array.isArray(u) ? u : []);
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando reportes", err);
        setError("No se pudieron cargar los datos del reporte.");
      })
      .finally(() => setCargando(false));
  }, [esVistaAdmin, nombrePropio]);

  const hoyISO = getHoyLocalISO();
  const ahora = new Date();
  const OBJETIVOS_MENSUALES_EQUIPO = {
    edicion: 40,
    diseno: 30,
    produccion: 12,
    community: 120,
  };

  const rangoPeriodo = useMemo(() => {
    const pad = (n) => String(n).padStart(2, "0");
    if (periodo === "mes_actual") {
      const desde = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-01`;
      const sig = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
      const hasta = `${sig.getFullYear()}-${pad(sig.getMonth() + 1)}-01`;
      return {
        desde,
        hasta,
        dias: new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate(),
        diasTranscurridos: ahora.getDate(),
      };
    }
    if (periodo === "mes_pasado") {
      const prev = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      const desde = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`;
      const hasta = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-01`;
      const dias = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
      return { desde, hasta, dias, diasTranscurridos: dias };
    }
    const d30 = new Date(ahora);
    d30.setDate(d30.getDate() - 30);
    const desde = `${d30.getFullYear()}-${pad(d30.getMonth() + 1)}-${pad(d30.getDate())}`;
    return { desde, hasta: "9999-12-31", dias: 30, diasTranscurridos: 30 };
  }, [periodo, ahora]);

  const enPeriodo = useCallback((fechaISO) =>
    typeof fechaISO === "string" &&
    fechaISO.slice(0, 10) >= rangoPeriodo.desde &&
    fechaISO.slice(0, 10) < rangoPeriodo.hasta,
    [rangoPeriodo]
  );

  const empleados = useMemo(() => {
    const nombresConTareas = [...new Set(tareas.map((t) => t.asignado_a).filter(Boolean))];
    const nombresUsuarios = usuarios
      .filter((u) => u.rol !== "admin" || nombresConTareas.includes(u.nombre))
      .map((u) => u.nombre);
    return esVistaAdmin
      ? [...new Set([...nombresUsuarios, ...nombresConTareas])]
      : [nombrePropio].filter(Boolean);
  }, [tareas, usuarios, esVistaAdmin, nombrePropio]);

  const filas = useMemo(() => empleados.map((nombre) => {
    const propias = tareas.filter((t) => t.asignado_a === nombre);
    // Cuando una persona tiene una base mensual auditada desde ClickUp, esa
    // fuente es la que gobierna el reporte del mes. Así no se mezclan tareas
    // operativas reales con backfills automáticos o registros históricos que
    // siguen visibles en el tablero por otros motivos.
    const periodoMensual = periodo === "mes_actual" || periodo === "mes_pasado"
      ? rangoPeriodo.desde.slice(0, 7)
      : null;
    const propiasFuenteMensual = periodoMensual
      ? propias.filter(
          (t) =>
            t.propiedades_extra?.reporte_fuente === "clickup" &&
            t.propiedades_extra?.reporte_periodo === periodoMensual,
        )
      : [];
    const propiasReporte = propiasFuenteMensual.length > 0
      ? propiasFuenteMensual
      : propias;

    const activas = propiasReporte.filter((t) => t.estado !== ESTADO_FINAL_TAREA);
    const atrasadas = activas.filter(
      (t) => t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
    );
    const terminadasPeriodo = propiasReporte.filter(
      (t) =>
        t.estado === ESTADO_FINAL_TAREA &&
        enPeriodo(t.propiedades_extra?.clickup_cerrada_at || t.updated_at || ""),
    );
    const vencianEnPeriodo = propiasReporte.filter(
      (t) => t.fecha_vencimiento && enPeriodo(t.fecha_vencimiento),
    );
    const vencidasPublicadas = vencianEnPeriodo.filter((t) => t.estado === ESTADO_FINAL_TAREA);
    const cumplimiento =
      vencianEnPeriodo.length > 0
        ? Math.round((vencidasPublicadas.length / vencianEnPeriodo.length) * 100)
        : null;

    const tiempos = terminadasPeriodo
      .map((t) => {
        if (!t.created_at || !t.updated_at) return null;
        const dias = (new Date(t.updated_at) - new Date(t.created_at)) / 86400000;
        return dias >= 0 ? dias : null;
      })
      .filter((d) => d !== null);
    const tiempoPromedio =
      tiempos.length > 0
        ? (tiempos.reduce((a, b) => a + b, 0) / tiempos.length).toFixed(1)
        : null;

    const productividad = (terminadasPeriodo.length / (rangoPeriodo.dias / 7)).toFixed(1);

    const rol = usuarios.find((u) => u.nombre === nombre)?.rol;
    const objetivoMensual = OBJETIVOS_MENSUALES_EQUIPO[rol] || null;
    const objetivoAlDia = objetivoMensual
      ? Math.max(
          1,
          Math.ceil(
            objetivoMensual *
              (Math.min(rangoPeriodo.diasTranscurridos, rangoPeriodo.dias) / rangoPeriodo.dias),
          ),
        )
      : null;
    const avanceObjetivo = objetivoMensual
      ? Math.round((terminadasPeriodo.length / objetivoMensual) * 100)
      : null;
    const estadoObjetivo = (() => {
      if (!objetivoMensual) return { label: "Sin objetivo", bg: RR.surface2, fg: RR.textMuted };
      if (atrasadas.length > 0) return { label: "Atrasado", bg: RR.dangerBg, fg: RR.danger };
      if (terminadasPeriodo.length >= objetivoAlDia) return { label: "Al día", bg: RR.successBg, fg: RR.success };
      if (terminadasPeriodo.length >= Math.ceil(objetivoAlDia * 0.75)) {
        return { label: "En riesgo", bg: RR.warningBg, fg: RR.warning };
      }
      return { label: "Atrasado", bg: RR.dangerBg, fg: RR.danger };
    })();

    return {
      nombre,
      rol,
      objetivoMensual,
      objetivoAlDia,
      avanceObjetivo,
      estadoObjetivo,
      carga: activas.length,
      terminadas: terminadasPeriodo.length,
      atrasadas,
      cumplimiento,
      tiempoPromedio,
      productividad,
    };
  }), [empleados, tareas, usuarios, rangoPeriodo, hoyISO, enPeriodo, ESTADO_FINAL_TAREA, OBJETIVOS_MENSUALES_EQUIPO]);

  const PRIORIDAD_ESTADO = useMemo(() => ({ Atrasado: 0, "En riesgo": 1, "Al día": 2, "Sin objetivo": 3 }), []);

  const filasOrdenadas = useMemo(() => {
    const ordenadas = [...filas].sort((a, b) => {
      const estadoA = PRIORIDAD_ESTADO[a.estadoObjetivo.label] ?? 9;
      const estadoB = PRIORIDAD_ESTADO[b.estadoObjetivo.label] ?? 9;
      if (estadoA !== estadoB) return estadoA - estadoB;
      return a.nombre.localeCompare(b.nombre);
    });
    return ordenadas;
  }, [filas, PRIORIDAD_ESTADO]);

  const filaPropia = useMemo(() => !esVistaAdmin ? filasOrdenadas[0] : null, [esVistaAdmin, filasOrdenadas]);

  const totales = useMemo(() => ({
    activas: filas.reduce((s, f) => s + f.carga, 0),
    terminadas: filas.reduce((s, f) => s + f.terminadas, 0),
    atrasadas: filas.reduce((s, f) => s + f.atrasadas.length, 0),
  }), [filas]);

  const piezasPorResponsable = useMemo(() =>
    empleados
      .map((nombre) => {
        const hs = historias.filter(
          (h) => (h.responsable_diseño || h.responsable) === nombre,
        );
        const ps = publicaciones.filter((p) => p.responsable === nombre);
        const total = hs.length + ps.length;
        const publicadas =
          hs.filter((h) => h.estado === "publicada").length +
          ps.filter((p) => p.estado === "publicada").length;
        return { nombre, total, publicadas };
      })
      .filter((f) => f.total > 0)
      .sort((a, b) => b.total - a.total),
    [empleados, historias, publicaciones]
  );

  const periodoMensualReporte = periodo === "mes_actual" || periodo === "mes_pasado"
    ? rangoPeriodo.desde.slice(0, 7)
    : null;
  const tareasDelPeriodoPorPersona = (nombre) => {
    const propias = tareas.filter((t) => t.asignado_a === nombre);
    const fuenteMensual = periodoMensualReporte
      ? propias.filter(
          (t) =>
            t.propiedades_extra?.reporte_fuente === "clickup" &&
            t.propiedades_extra?.reporte_periodo === periodoMensualReporte,
        )
      : [];
    if (fuenteMensual.length > 0) return fuenteMensual;
    return propias.filter((t) => {
      const cerradaEnPeriodo =
        t.estado === ESTADO_FINAL_TAREA &&
        enPeriodo(t.propiedades_extra?.clickup_cerrada_at || t.updated_at || "");
      return cerradaEnPeriodo || enPeriodo(t.fecha_vencimiento || "");
    });
  };
  const resumenEntregas = (items) => {
    const realizados = items.filter((item) => item.estado === ESTADO_FINAL_TAREA).length;
    return {
      realizados,
      pendientes: Math.max(items.length - realizados, 0),
      total: items.length,
    };
  };
  const esCarrusel = (tarea) => {
    const titulo = (tarea.titulo || "").toLocaleLowerCase("es");
    const lista = (tarea.propiedades_extra?.clickup_lista || "").toLocaleLowerCase("es");
    return titulo.includes("carrusel") || lista.includes("carrusel");
  };

  const carruselesAugusto = resumenEntregas(
    tareasDelPeriodoPorPersona("Augusto").filter(esCarrusel),
  );
  const videosLuciano = resumenEntregas(
    tareasDelPeriodoPorPersona("Luciano").filter((t) => t.tipo_tarea === "edicion"),
  );
  const historiasDelPeriodo = historias.filter((h) => enPeriodo(h.fecha_programada || ""));
  const reelsDelPeriodo = publicaciones.filter(
    (p) => p.tipo === "video" && enPeriodo(p.fecha_programada || ""),
  );
  const historiasOriana = resumenEntregas(historiasDelPeriodo);
  const reelsOriana = resumenEntregas(reelsDelPeriodo);

  const inicioMariano = "2026-08-01";
  const marianoActivo = periodo === "ultimos_30"
    ? hoyISO >= inicioMariano
    : rangoPeriodo.desde >= inicioMariano;
  const carruselesMariano = resumenEntregas(
    tareasDelPeriodoPorPersona("Mariano").filter(esCarrusel),
  );
  const historiasMariano = resumenEntregas(
    historiasDelPeriodo.filter(
      (h) => (h.responsable_diseño || h.responsable || "").toLocaleLowerCase("es") === "mariano",
    ),
  );

  const tarjetasEntregables = [
    {
      nombre: "Augusto",
      rol: "Diseño",
      metricas: [{ etiqueta: "Carruseles", ...carruselesAugusto }],
    },
    {
      nombre: "Luciano",
      rol: "Edición",
      metricas: [{ etiqueta: "Videos editados", ...videosLuciano }],
    },
    {
      nombre: "Germán",
      rol: "Producción",
      metricas: [
        {
          etiqueta: "Videos útiles a grabar",
          total: 40,
          enRevision: true,
        },
      ],
    },
    {
      nombre: "Oriana",
      rol: "Publicación",
      metricas: [
        { etiqueta: "Historias publicadas", verbo: "publicadas", verboSingular: "publicada", ...historiasOriana },
        { etiqueta: "Reels publicados", verbo: "publicados", verboSingular: "publicado", ...reelsOriana },
      ],
    },
    {
      nombre: "Mariano",
      rol: "Diseño y contenido",
      proximoMes: !marianoActivo,
      metricas: [
        { etiqueta: "Carruseles", ...carruselesMariano },
        { etiqueta: "Historias", ...historiasMariano },
      ],
    },
  ];

  const PERIODOS = [
    { id: "mes_actual", label: "Este mes" },
    { id: "mes_pasado", label: "Mes pasado" },
    { id: "ultimos_30", label: "Últimos 30 días" },
  ];

  const cardStyle = useMemo(() => ({ padding: "16px", borderRadius: "8px", textAlign: "center" }), []);
  const numStyle = { fontFamily: RR.mono, fontVariantNumeric: "tabular-nums" };

  return (
    <main aria-label="Render platform reportes equipo">
      <div className="frame">
        <div className="content">
          <div className="section-label">
            {esVistaAdmin ? "Rendimiento mensual del equipo" : "Mi rendimiento mensual"}
          </div>
          <div className="caption" style={{ marginBottom: "16px" }}>
            {esVistaAdmin
              ? "Entregas realizadas y pendientes según el trabajo concreto de cada persona."
              : "Seguimiento de tu objetivo, tareas completadas y pendientes."}
          </div>

          {error && (
            <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
              {error}
            </div>
          )}

          <div className="tabs" style={{ marginBottom: "16px" }}>
            {PERIODOS.map((p) => (
              <span
                key={p.id}
                className={periodo === p.id ? "active" : ""}
                onClick={() => setPeriodo(p.id)}
                style={{ cursor: "pointer" }}
              >
                {p.label}
              </span>
            ))}
          </div>

          {cargando ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando reportes…</div>
          ) : (
            <>
              <div className="section-label">
                {esVistaAdmin ? "1 · Producción del mes" : "1 · Mi objetivo mensual — vista rápida"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${esVistaAdmin ? "230px" : "150px"}, 1fr))`, gap: "14px", marginBottom: "12px" }}>
                {esVistaAdmin ? (
                  tarjetasEntregables.map((tarjeta) => (
                    <TarjetaEntregablesEquipo key={tarjeta.nombre} {...tarjeta} />
                  ))
                ) : (
                  <>
                    <div style={{ ...cardStyle, background: filaPropia?.estadoObjetivo?.bg || RR.surface2 }}>
                      <div style={{ fontSize: "20px", fontWeight: "600", color: filaPropia?.estadoObjetivo?.fg || RR.textMuted }}>
                        {filaPropia?.estadoObjetivo?.label || "Sin datos"}
                      </div>
                      <div style={{ fontSize: "12px", color: filaPropia?.estadoObjetivo?.fg || RR.textMuted }}>Estado</div>
                    </div>
                    <div style={{ ...cardStyle, background: RR.surface2 }}>
                      <div style={{ ...numStyle, fontSize: "24px", fontWeight: "600", color: RR.accent }}>{filaPropia?.avanceObjetivo ?? 0}%</div>
                      <div style={{ fontSize: "12px", color: RR.textMuted }}>Avance al 100%</div>
                    </div>
                    <div style={{ ...cardStyle, background: RR.successBg }}>
                      <div style={{ ...numStyle, fontSize: "24px", fontWeight: "600", color: RR.success }}>{filaPropia?.terminadas ?? 0}</div>
                      <div style={{ fontSize: "12px", color: RR.success }}>Publicadas este mes</div>
                    </div>
                    <div style={{ ...cardStyle, background: RR.warningBg }}>
                      <div style={{ ...numStyle, fontSize: "24px", fontWeight: "600", color: RR.warning }}>{filaPropia?.carga ?? 0}</div>
                      <div style={{ fontSize: "12px", color: RR.warning }}>Pendientes</div>
                    </div>
                  </>
                )}
              </div>
              {esVistaAdmin && (
                <div className="caption" style={{ marginBottom: "24px" }}>
                  Carruseles, ediciones, grabaciones y publicaciones se calculan por separado. No se mezclan tareas de otros roles.
                </div>
              )}

              {!esVistaAdmin && (
                <>
                  <div className="section-label">2 · Mi rendimiento</div>
                  <div className="box" style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #333", background: "#fafafa" }}>
                      <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: "600", fontSize: "12px" }}>Empleado</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Objetivo</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Publicadas</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Avance al 100%</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Estado</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Pendientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasOrdenadas.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "#999" }}>
                          Sin datos de tareas todavía.
                        </td>
                      </tr>
                    )}
                    {filasOrdenadas.map((f) => (
                      <React.Fragment key={f.nombre}>
                        <tr
                          style={{ borderBottom: "1px solid #eee", cursor: f.atrasadas.length > 0 ? "pointer" : "default" }}
                          onClick={() =>
                            f.atrasadas.length > 0 &&
                            setDetalleDe(detalleDe === f.nombre ? null : f.nombre)
                          }
                        >
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: "600", fontSize: "13px" }}>{f.nombre}</div>
                            {f.rol && (
                              <div style={{ fontSize: "11px", color: "#999" }}>{ROL_LABELS[f.rol] || f.rol}</div>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", fontWeight: "600" }}>
                            {f.objetivoMensual ? (
                              <>
                                <div>{f.objetivoMensual}</div>
                                <div style={{ fontSize: "11px", color: "#999" }}>al mes</div>
                              </>
                            ) : (
                              <span style={{ color: "#bbb" }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", color: "#2e7d32", fontWeight: "600" }}>{f.terminadas}</td>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            {f.avanceObjetivo === null ? (
                              <span style={{ color: "#bbb", fontSize: "12px" }}>Sin objetivo</span>
                            ) : (
                              <>
                                <div style={{ display: "inline-block", width: "56px", height: "6px", background: "#e0e0e0", borderRadius: "3px", overflow: "hidden", verticalAlign: "middle" }}>
                                  <div
                                    style={{
                                      width: `${Math.min(f.avanceObjetivo, 100)}%`,
                                      height: "100%",
                                      background: f.avanceObjetivo >= 100 ? "#4caf50" : f.avanceObjetivo >= 70 ? "#ff9800" : "#f44336",
                                    }}
                                  />
                                </div>
                                <div style={{ fontSize: "11px", marginTop: "2px", fontWeight: "600" }}>{f.avanceObjetivo}%</div>
                              </>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            <span style={{ background: f.estadoObjetivo.bg, color: f.estadoObjetivo.fg, padding: "3px 8px", borderRadius: "10px", fontWeight: "700", fontSize: "12px" }}>
                              {f.estadoObjetivo.label}
                            </span>
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>
                            <strong>{f.carga}</strong>
                            {f.atrasadas.length > 0 && (
                              <span style={{ background: "#fff3e0", color: "#e65100", padding: "2px 6px", borderRadius: "10px", fontWeight: "700", fontSize: "11px", marginLeft: "6px" }}>
                                {f.atrasadas.length} atras.
                              </span>
                            )}
                          </td>
                        </tr>
                        {detalleDe === f.nombre &&
                          f.atrasadas.map((t) => (
                            <tr key={`det-${t.id}`} style={{ background: "#fffde7", borderBottom: "1px solid #f0f0f0" }}>
                              <td colSpan={6} style={{ padding: "6px 12px 6px 32px", fontSize: "12px", color: "#795548" }}>
                                <strong>{t.titulo}</strong>
                                {t.cliente_nombre ? ` · ${t.cliente_nombre}` : ""} · vencía {t.fecha_vencimiento} ·{" "}
                                {getEstadoTareaLabel(t.estado)}
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                  </div>
                  <div className="caption" style={{ marginTop: "8px", marginBottom: "20px" }}>
                    El 100% se calcula contra el objetivo mensual de tu rol. El estado compara lo hecho con el ritmo esperado del mes y marca atrasos si hay vencidas.
                  </div>
                </>
              )}

              {!esVistaAdmin && (
                <>
                  <div className="section-label">3 · Mis piezas asignadas</div>
                  <div className="box">
                {piezasPorResponsable.length === 0 ? (
                  <div style={{ color: "#999", textAlign: "center", padding: "20px" }}>Sin piezas asignadas todavía.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #333" }}>
                        <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: "600", fontSize: "12px" }}>Responsable</th>
                        <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Piezas asignadas</th>
                        <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Publicadas</th>
                        <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Avance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {piezasPorResponsable.map((f) => {
                        const avance = f.total > 0 ? Math.round((f.publicadas / f.total) * 100) : 0;
                        return (
                          <tr key={f.nombre} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "10px 12px", fontWeight: "600", fontSize: "13px" }}>{f.nombre}</td>
                            <td style={{ padding: "10px", textAlign: "center" }}>{f.total}</td>
                            <td style={{ padding: "10px", textAlign: "center", color: "#2e7d32" }}>{f.publicadas}</td>
                            <td style={{ padding: "10px", textAlign: "center" }}>
                              <div style={{ display: "inline-block", width: "60px", height: "6px", background: "#e0e0e0", borderRadius: "3px", overflow: "hidden", verticalAlign: "middle" }}>
                                <div
                                  style={{
                                    width: `${avance}%`,
                                    height: "100%",
                                    background: avance >= 70 ? "#4caf50" : avance >= 30 ? "#ff9800" : "#f44336",
                                  }}
                                />
                              </div>
                              <span style={{ fontSize: "11px", marginLeft: "6px" }}>{avance}%</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// ── MÓDULO PUBLICACIONES: vista general filtrable + planilla por cliente ──────

const ESTADOS_PUBLICACION = [
  { id: "pendiente", label: "Pendiente", bg: "#eceff1", fg: "#546e7a" },
  { id: "en_diseño", label: "En diseño", bg: "#f3e5f5", fg: "#7b1fa2" },
  { id: "en_edición", label: "En edición", bg: "#e1f5fe", fg: "#0277bd" },
  { id: "en_revision", label: "En revisión", bg: "#fff3e0", fg: "#e65100" },
  { id: "lista", label: "Lista", bg: "#f0f4c3", fg: "#827717" },
  { id: "publicada", label: "Publicada", bg: "#e8f5e9", fg: "#2e7d32" },
  { id: "bloqueada", label: "Bloqueada", bg: "#ffebee", fg: "#c62828" },
];

const TIPOS_PUBLICACION = [
  { id: "video", label: "Reel" },
  { id: "carrusel", label: "Carrusel" },
];

const COLUMNAS_PUBLICACION = ["fecha", "tipo", "idea", "copy", "material", "aclaraciones", "responsable", "estado"];

function payloadColumnaPublicacion(columna, valorCrudo) {
  const valor = (valorCrudo || "").trim();
  switch (columna) {
    case "fecha":
      return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? { fecha_programada: valor } : null;
    case "tipo":
      return TIPOS_PUBLICACION.some((t) => t.id === valor) ? { tipo: valor } : null;
    case "idea":
      return { idea: valor };
    case "copy":
      return { copy: valor };
    case "material":
      return { material_referencia: valor };
    case "aclaraciones":
      return { aclaraciones: valor };
    case "responsable":
      return RESPONSABLES_EQUIPO.includes(valor) ? { responsable: valor } : null;
    case "estado":
      return ESTADOS_PUBLICACION.some((e) => e.id === valor) ? { estado: valor } : null;
    default:
      return null;
  }
}

function PublicacionesGeneralTab({ clientes, onIrACliente }) {
  const [publicaciones, setPublicaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [filtroCliente, setFiltroCliente] = useState("todos");
  const [filtroMes, setFiltroMes] = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroResponsable, setFiltroResponsable] = useState("todos");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  useEffect(() => {
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((data) => {
        setPublicaciones(data);
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando publicaciones", err);
        setError("No se pudieron cargar las publicaciones.");
      })
      .finally(() => setCargando(false));
  }, []);

  const mesesDisponibles = [
    ...new Set(publicaciones.map((p) => p.fecha_programada?.slice(0, 7)).filter(Boolean)),
  ].sort();

  const responsablesDisponibles = [
    ...new Set(publicaciones.map((p) => p.responsable).filter(Boolean)),
  ].sort();

  const filtradas = publicaciones.filter((p) => {
    if (filtroCliente !== "todos" && p.cliente_id !== Number(filtroCliente)) return false;
    if (filtroMes !== "todos" && !p.fecha_programada?.startsWith(filtroMes)) return false;
    if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
    if (filtroResponsable !== "todos" && p.responsable !== filtroResponsable) return false;
    if (filtroTipo !== "todos" && p.tipo !== filtroTipo) return false;
    return true;
  });

  const selectStyle = { fontSize: "12px", padding: "6px 8px" };

  return (
    <>
      <div className="section-label">Control de publicaciones</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        <select style={selectStyle} value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
          <option value="todos">Todos los clientes</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <select style={selectStyle} value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}>
          <option value="todos">Todos los meses</option>
          {mesesDisponibles.map((m) => (
            <option key={m} value={m}>
              {MESES[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
            </option>
          ))}
        </select>
        <select style={selectStyle} value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="todos">Todos los estados</option>
          {ESTADOS_PUBLICACION.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
        <select style={selectStyle} value={filtroResponsable} onChange={(e) => setFiltroResponsable(e.target.value)}>
          <option value="todos">Todos los responsables</option>
          {responsablesDisponibles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select style={selectStyle} value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {TIPOS_PUBLICACION.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <span style={{ fontSize: "12px", color: "#777", alignSelf: "center", marginLeft: "auto" }}>
          {filtradas.length} publicaciones
        </span>
      </div>

      {error && (
        <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando publicaciones…</div>
      ) : (
        <div className="box" style={{ padding: 0, overflow: "auto", maxHeight: "70vh" }}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{ width: "100px" }}>Fecha</th>
                <th style={{ width: "180px" }}>Cliente</th>
                <th style={{ width: "90px" }}>Tipo</th>
                <th>Idea</th>
                <th style={{ width: "120px" }}>Responsable</th>
                <th style={{ width: "120px" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "#999" }}>
                    Sin publicaciones para estos filtros.
                  </td>
                </tr>
              )}
              {filtradas.map((p) => {
                const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado) || ESTADOS_PUBLICACION[0];
                return (
                  <tr
                    key={p.id}
                    className="row-clickable"
                    onClick={() => onIrACliente(p.cliente_id)}
                    title="Ver la planilla de este cliente"
                  >
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{p.fecha_programada}</td>
                    <td style={{ padding: "6px 10px", fontSize: "13px", fontWeight: "600" }}>{p.cliente_nombre}</td>
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{getTipoPublicacionLabel(p.tipo)}</td>
                    <td style={{ padding: "6px 10px", fontSize: "13px", color: p.idea ? "#222" : "#bbb" }}>
                      {p.idea || "Sin idea cargada"}
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{p.responsable || "—"}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ background: est.bg, color: est.fg, fontWeight: "600", fontSize: "11px", padding: "3px 8px", borderRadius: "10px" }}>
                        {est.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PublicacionesPlanillaTab({ clienteId, clienteNombre, year, month }) {
  const [publicaciones, setPublicaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const gridRef = useRef(null);
  const enfocarProximoId = useRef(null);

  const cargar = () => {
    setCargando(true);
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((data) => {
        setPublicaciones(data.filter((p) => p.cliente_id === clienteId));
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando publicaciones", err);
        setError("No se pudieron cargar las publicaciones.");
      })
      .finally(() => setCargando(false));
  };

  useEffect(cargar, [clienteId]);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];

  const filasVisibles = publicaciones
    .filter((p) => p.fecha_programada && p.fecha_programada.startsWith(mesPrefix))
    .slice()
    .sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada));

  useEffect(() => {
    if (!enfocarProximoId.current) return;
    const idx = filasVisibles.findIndex((p) => p.id === enfocarProximoId.current);
    if (idx === -1) return;
    enfocarProximoId.current = null;
    requestAnimationFrame(() => enfocarCelda(idx, "fecha"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicaciones]);

  const actualizarLocal = (id, campos) => {
    setPublicaciones((prev) => prev.map((p) => (p.id === id ? { ...p, ...campos } : p)));
  };

  const guardarEnServidor = async (id, campos) => {
    try {
      const res = await fetch(`/api/publicaciones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
    } catch (err) {
      console.error("Error guardando", err);
      setError("No se pudo guardar un cambio — reintentá.");
    }
  };

  const confirmarCampoTexto = (id, campos) => {
    actualizarLocal(id, campos);
    guardarEnServidor(id, campos);
  };

  const crearPublicacion = async () => {
    const iso = mesPrefix === hoyISO.slice(0, 7) ? hoyISO : `${mesPrefix}-01`;
    try {
      const res = await fetch("/api/piezas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "video",
          cliente_id: clienteId,
          responsable: "Augusto",
          fecha_programada: iso,
          estado: "pendiente",
          idea: "",
        }),
      });
      if (!res.ok) throw new Error("No se pudo crear");
      const creada = await res.json();
      enfocarProximoId.current = creada.id;
      cargar();
    } catch (err) {
      console.error("Error creando publicación", err);
      setError("No se pudo crear la publicación.");
    }
  };

  const borrarPublicacion = async (id) => {
    if (!window.confirm("¿Eliminar esta publicación de la planilla?")) return;
    try {
      const res = await fetch(`/api/publicaciones/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setPublicaciones((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Error eliminando publicación", err);
      setError("No se pudo eliminar la publicación.");
    }
  };

  const copiarFila = async (p) => {
    const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado);
    const linea = [
      p.fecha_programada || "",
      getTipoPublicacionLabel(p.tipo),
      p.idea || "",
      p.copy || "",
      p.material_referencia || "",
      p.aclaraciones || "",
      p.responsable || "",
      est?.label || p.estado || "",
    ].join("\t");
    try {
      await navigator.clipboard.writeText(linea);
    } catch (err) {
      console.error("No se pudo copiar la fila", err);
    }
  };

  const enfocarCelda = (rowIndex, columna) => {
    const el = gridRef.current?.querySelector(`[data-cell="${rowIndex}:${columna}"]`);
    if (!el) return;
    el.focus();
    if (typeof el.select === "function") el.select();
  };

  const manejarEnterOTab = (e, rowIndex, columna) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      enfocarCelda(rowIndex + 1, columna);
    }
  };

  const manejarPaste = (e, rowIndex, columna) => {
    const texto = e.clipboardData.getData("text/plain");
    if (!texto.includes("\t") && !texto.includes("\n")) return;
    e.preventDefault();

    const filasTexto = texto.replace(/\r/g, "").split("\n");
    while (filasTexto.length > 1 && filasTexto[filasTexto.length - 1] === "") {
      filasTexto.pop();
    }

    const colInicio = COLUMNAS_PUBLICACION.indexOf(columna);

    filasTexto.forEach((filaTexto, dRow) => {
      const objetivo = filasVisibles[rowIndex + dRow];
      if (!objetivo) return;

      const valores = filaTexto.split("\t");
      let payload = {};
      valores.forEach((valorCelda, dCol) => {
        const colObjetivo = COLUMNAS_PUBLICACION[colInicio + dCol];
        if (!colObjetivo) return;
        const campo = payloadColumnaPublicacion(colObjetivo, valorCelda);
        if (!campo) return;
        payload = { ...payload, ...campo };
      });

      if (Object.keys(payload).length > 0) {
        actualizarLocal(objetivo.id, payload);
        guardarEnServidor(objetivo.id, payload);
      }
    });
  };

  return (
    <>
      {error && (
        <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando planilla…</div>
      ) : (
        <div className="sheet-frame" ref={gridRef}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{ width: "56px" }}>Día</th>
                <th style={{ width: "120px" }}>Fecha</th>
                <th style={{ width: "100px" }}>Tipo</th>
                <th style={{ width: "20%" }}>Idea</th>
                <th style={{ width: "24%" }}>Copy</th>
                <th style={{ width: "14%" }}>Material</th>
                <th style={{ width: "16%" }}>Observaciones</th>
                <th style={{ width: "110px" }}>Responsable</th>
                <th style={{ width: "120px" }}>Estado</th>
                <th style={{ width: "56px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "24px", color: "#999" }}>
                    Sin publicaciones planificadas este mes todavía.
                  </td>
                </tr>
              )}
              {filasVisibles.map((p, rowIndex) => {
                const fecha = new Date(`${p.fecha_programada}T00:00:00`);
                const dow = fecha.getDay();
                const esFinde = dow === 0 || dow === 6;
                const esHoy = p.fecha_programada === hoyISO;
                const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado) || ESTADOS_PUBLICACION[0];
                const bgFila = esHoy ? "#e3f2fd" : esFinde ? "#fafafa" : undefined;

                return (
                  <tr key={p.id} style={{ background: bgFila }}>
                    <td style={{ padding: "6px 10px", fontWeight: esHoy ? "700" : "600", color: esFinde ? "#999" : "#333", fontSize: "12px" }}>
                      {LETRAS_DIA[dow]}
                    </td>
                    <td>
                      <input
                        type="date"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:fecha`}
                        value={p.fecha_programada || ""}
                        onChange={(e) => actualizarLocal(p.id, { fecha_programada: e.target.value })}
                        onBlur={(e) => guardarEnServidor(p.id, { fecha_programada: e.target.value })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "fecha")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "fecha")}
                      />
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:tipo`}
                        value={p.tipo}
                        onChange={(e) => {
                          actualizarLocal(p.id, { tipo: e.target.value });
                          guardarEnServidor(p.id, { tipo: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "tipo")}
                      >
                        {TIPOS_PUBLICACION.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:idea`}
                        placeholder="Escribir idea…"
                        value={p.idea || ""}
                        onChange={(e) => actualizarLocal(p.id, { idea: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { idea: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "idea")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "idea")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:copy`}
                        placeholder="Escribir copy…"
                        value={p.copy || ""}
                        onChange={(e) => actualizarLocal(p.id, { copy: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { copy: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "copy")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "copy")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:material`}
                        placeholder="Link…"
                        value={p.material_referencia || ""}
                        onChange={(e) => actualizarLocal(p.id, { material_referencia: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { material_referencia: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "material")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "material")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:aclaraciones`}
                        placeholder="—"
                        value={p.aclaraciones || ""}
                        onChange={(e) => actualizarLocal(p.id, { aclaraciones: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { aclaraciones: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "aclaraciones")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "aclaraciones")}
                      />
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:responsable`}
                        value={p.responsable || "Augusto"}
                        onChange={(e) => {
                          actualizarLocal(p.id, { responsable: e.target.value });
                          guardarEnServidor(p.id, { responsable: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "responsable")}
                      >
                        {RESPONSABLES_EQUIPO.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:estado`}
                        value={p.estado}
                        onChange={(e) => {
                          actualizarLocal(p.id, { estado: e.target.value });
                          guardarEnServidor(p.id, { estado: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "estado")}
                        style={{ background: est.bg, color: est.fg, fontWeight: "600", border: "1px solid transparent" }}
                      >
                        {ESTADOS_PUBLICACION.map((e) => (
                          <option key={e.id} value={e.id}>{e.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="sheet-row-actions">
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => copiarFila(p)}
                          title="Copiar fila (para pegar en otra fila o en Sheets)"
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => borrarPublicacion(p.id)}
                          title="Eliminar"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={10} style={{ padding: 0 }}>
                  <button type="button" className="sheet-add-row" onClick={crearPublicacion}>
                    <span style={{ fontSize: "15px" }}>+</span> Agregar publicación
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="caption" style={{ marginTop: "10px" }}>
        Planilla de {clienteNombre} · Click en una celda para escribir · Tab / Enter para moverte · pegá bloques copiados de Sheets directamente sobre la grilla.
      </div>
    </>
  );
}

function PublicacionesPage({ tabInicial = "calendario" }) {
  const [tabPrincipal, setTabPrincipal] = useState(tabInicial);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [errorClientes, setErrorClientes] = useState(null);
  const [publicaciones, setPublicaciones] = useState([]);

  const hoyDate = new Date();
  const [year, setYear] = useState(hoyDate.getFullYear());
  const [month, setMonth] = useState(hoyDate.getMonth());

  useEffect(() => {
    fetch("/api/clientes")
      .then((r) => r.json())
      .then((data) => {
        setClientes(data);
        if (data.length > 0) setClienteSeleccionado((prev) => prev ?? data[0].id);
      })
      .catch((err) => {
        console.error("No se pudieron cargar clientes", err);
        setErrorClientes("No se pudieron cargar los clientes.");
      });
  }, []);

  // Solo para alimentar el punto rojo del panel lateral (quién tiene
  // publicaciones atrasadas) sin entrar a cada cliente — la grilla editable
  // de cada cliente sigue trayendo sus propios datos por separado.
  useEffect(() => {
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((data) => setPublicaciones(Array.isArray(data) ? data : []))
      .catch((err) => console.error("No se pudo cargar el panorama de publicaciones", err));
  }, []);

  const irAPlanillaDeCliente = (clienteId) => {
    setClienteSeleccionado(clienteId);
    setTabPrincipal("planilla");
  };

  const clienteActual = clientes.find((c) => c.id === clienteSeleccionado);
  const clienteNombre = clienteActual?.nombre || "";

  const hoyISO = getHoyLocalISO();
  const atrasadasPorCliente = {};
  publicaciones.forEach((p) => {
    if (p.fecha_programada < hoyISO && p.estado !== "publicada") {
      atrasadasPorCliente[p.cliente_id] = (atrasadasPorCliente[p.cliente_id] || 0) + 1;
    }
  });

  const irMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  };
  const irAHoy = () => {
    setMonth(hoyDate.getMonth());
    setYear(hoyDate.getFullYear());
  };

  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const publicacionesClienteMes = publicaciones.filter(
    (p) => p.cliente_id === clienteSeleccionado && p.fecha_programada?.startsWith(mesPrefix),
  );
  const publicadasCliente = publicacionesClienteMes.filter((p) => p.estado === "publicada").length;
  const atrasadasCliente = publicacionesClienteMes.filter(
    (p) => p.fecha_programada < hoyISO && p.estado !== "publicada",
  ).length;

  const TABS_PRINCIPALES = [
    { id: "calendario", label: "Calendario" },
    { id: "lista", label: "Control" },
    { id: "planilla", label: "Planilla" },
  ];

  return (
    <main aria-label="Render platform publicaciones" className="publicaciones-viewport">
      <div className="frame">
        <div className="content">
          {errorClientes && (
            <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
              {errorClientes}
            </div>
          )}

          <div className="h-workspace">
            <ClientesRail
              clientes={clientes}
              clienteSeleccionado={clienteSeleccionado}
              onSeleccionar={irAPlanillaDeCliente}
              atrasadasPorCliente={atrasadasPorCliente}
            />

            <div className="h-main">
              <div className="h-toolbar">
                {tabPrincipal === "planilla" && (
                  <div className="h-toolbar-client">{clienteNombre || "…"}</div>
                )}
                {tabPrincipal === "planilla" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button className="btn" type="button" onClick={() => irMes(-1)}>◀</button>
                    <strong className="sheet-title">{MESES[month]} {year}</strong>
                    <button className="btn" type="button" onClick={() => irMes(1)}>▶</button>
                  </div>
                )}
                {tabPrincipal === "planilla" && (
                  <button className="h-today-btn" type="button" onClick={irAHoy}>Ir a hoy</button>
                )}

                <div className="sheet-view-tabs" style={{ margin: 0 }}>
                  {TABS_PRINCIPALES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={tabPrincipal === t.id ? "active" : ""}
                      onClick={() => setTabPrincipal(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tabPrincipal === "planilla" && (
                  <div className="sheet-stats" style={{ marginLeft: "auto" }}>
                    <span>{publicacionesClienteMes.length} publicaciones</span>
                    <span className="ok">{publicadasCliente} publicadas</span>
                    {atrasadasCliente > 0 && <span className="danger">{atrasadasCliente} atrasadas</span>}
                  </div>
                )}
              </div>

              <div className="h-body">
                {tabPrincipal === "calendario" && (
                  <PublicacionesCalendarioTab onIrAPlanilla={irAPlanillaDeCliente} />
                )}

                {tabPrincipal === "lista" && (
                  <PublicacionesGeneralTab clientes={clientes} onIrACliente={irAPlanillaDeCliente} />
                )}

                {tabPrincipal === "planilla" && clienteActual && (
                  <PublicacionesPlanillaTab
                    key={`pub-${clienteSeleccionado}`}
                    clienteId={clienteSeleccionado}
                    clienteNombre={clienteNombre}
                    year={year}
                    month={month}
                  />
                )}

                {tabPrincipal === "planilla" && !clienteActual && (
                  <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>
                    Elegí un cliente en el panel izquierdo.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
