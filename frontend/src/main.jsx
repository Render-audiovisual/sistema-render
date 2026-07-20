import React, { useEffect, useRef, useState } from "react";
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

function getPanoramaClientes(clientes, historias, publicaciones) {
  return clientes
    .map((cliente) => {
      const historiasCliente = historias.filter(
        (historia) =>
          historia.cliente_id === cliente.id &&
          esDelMesActual(historia.fecha_programada),
      );
      const feedDelMes = publicaciones.filter(
        (publicacion) =>
          publicacion.cliente_id === cliente.id &&
          esDelMesActual(publicacion.fecha_programada),
      );
      const feedDeEstaSemana = feedDelMes.filter((publicacion) =>
        esDeEstaSemana(publicacion.fecha_programada),
      );

      const cuotaFeedMes =
        (cliente.cuota_reels || 0) + (cliente.cuota_carruseles || 0);
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

function getAprobacionesAgustin(tareas) {
  return tareas.filter(
    (tarea) =>
      tarea.propiedades_extra?.escalada_a === "Agustín" &&
      tarea.estado !== "hecha",
  );
}

function getEstadoPorObjetivo(objetivo) {
  if (objetivo < 60) return "rojo";
  if (objetivo < 90) return "amarillo";
  return "verde";
}

function getEstadoHistoriasCliente(total, porcentaje) {
  if (total === 0) {
    return { color: "gris", label: "Sin planificación" };
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
      const publicacionesMes = publicaciones.filter(
        (publicacion) =>
          publicacion.cliente_id === cliente.id &&
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
            (cliente.cuota_reels || 0) + (cliente.cuota_carruseles || 0),
          ),
          feedSemana: 0,
          objetivo: porcentajeHistorias,
          historiasPublicadas: historiasPublicadas.length,
          historiasTotal: historiasMes.length,
          feedPublicado: reelsPublicados + carruselesPublicados,
          feedTotal: (cliente.cuota_reels || 0) + (cliente.cuota_carruseles || 0),
        },
        historiasMes: historiasMes.length,
        historiasPublicadas: historiasPublicadas.length,
        porcentajeHistorias,
        estadoHistorias,
        ultimaHistoriaOk,
        reelsPublicados,
        carruselesPublicados,
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
    .filter((t) => t.estado === "pendiente" && (!t.asignado_a || t.asignado_a === "Franco"))
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
  agustin: "/agustin",
  franco: "/franco",
  augusto: "/augusto",
  luciano: "/luciano",
  german: "/german",
  oriana: "/oriana",
};

const USUARIO_INFO = {
  agustin: { nombre: "Agustín", rol: "admin" },
  franco: { nombre: "Franco", rol: "admin" },
  augusto: { nombre: "Augusto", rol: "diseno" },
  luciano: { nombre: "Luciano", rol: "edicion" },
  german: { nombre: "Germán", rol: "produccion" },
  oriana: { nombre: "Oriana", rol: "community" },
};

function getSesion() {
  const raw = localStorage.getItem("render_sesion");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
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
        const destino = USUARIO_A_RUTA[data.usuario.usuario] || "/";
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
              placeholder="agustin"
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
  "Agustín",
  "Franco",
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
        setFechaVencimiento("");
        setRequiereAprobacion(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setEnviando(false));
  };

  return (
    <main aria-label="Render platform nueva tarea">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Nueva tarea</span>
            <a href="/">Home</a>
          </div>
          <div className="tag">Cargar trabajo</div>
        </div>

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
                    <option value="en_progreso">En progreso</option>
                    <option value="bloqueada">Bloqueada</option>
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
                    Requiere aprobación de Franco
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

function TareasAsignadasGenericas({ nombre, tipoTarea, titulo }) {
  const [tareas, setTareas] = useState([]);
  const [error, setError] = useState(null);
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";

  const cargarTareas = () => {
    const params = new URLSearchParams({ asignado_a: nombre });
    if (tipoTarea) params.set("tipo_tarea", tipoTarea);
    fetch(`/api/tareas?${params.toString()}`)
      .then((response) => response.json())
      .then((propias) => {
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
  }, [nombre, tipoTarea]);

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
                        tarea.estado !== "hecha" && (
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
                    <option value="en_progreso">En progreso</option>
                    <option value="en_revision">En revisión</option>
                    <option value="hecha" disabled={bloqueaCierre}>
                      {bloqueaCierre
                        ? "Hecha (requiere aprobación de admin)"
                        : "Hecha"}
                    </option>
                    <option value="bloqueada">Bloqueada</option>
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
          aprobación no se pueden marcar "Hecha" salvo que quien esté logueado
          sea admin (Agustín o Franco).
        </div>
      </div>
    </>
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

  // Filtros
  const [filtroResponsable, setFiltroResponsable] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroPrioridad, setFiltroPrioridad] = useState("");

  // Estados posibles
  const ESTADOS = [
    "pendiente",
    "en_diseño",
    "en_edición",
    "en_revisión",
    "lista",
    "publicada",
    "bloqueada",
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

  // Cargar piezas al montar
  useEffect(() => {
    cargarPiezas();
  }, []);

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

  // Filtrar piezas según los filtros activos
  const piezasFiltradas = piezas.filter((pieza) => {
    if (filtroResponsable && pieza.responsable !== filtroResponsable)
      return false;
    if (filtroCliente && pieza.cliente_id !== parseInt(filtroCliente))
      return false;
    if (filtroPrioridad && pieza.prioridad !== filtroPrioridad) return false;
    return true;
  });

  // Obtener responsables únicos
  const responsables = [...new Set(piezas.map((p) => p.responsable).filter(Boolean))].sort();

  // Obtener clientes únicos
  const clientesPorId = new Map();
  piezas.forEach((p) => {
    if (p.cliente_id && !clientesPorId.has(p.cliente_id)) {
      clientesPorId.set(p.cliente_id, p.cliente_nombre);
    }
  });
  const clientes = [...clientesPorId.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  // Prioridades
  const prioridades = ["baja", "media", "alta"];

  // Agrupar por estado
  function agruparPorEstado() {
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
  }

  async function cambiarEstado(piezaId, nuevoEstado) {
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

      // Actualizar pieza localmente
      setPiezas(
        piezas.map((p) =>
          p.id === piezaId ? { ...p, estado: nuevoEstado } : p
        )
      );

      // Actualizar modal si está abierto
      if (piezaSeleccionada?.id === piezaId) {
        setPiezaSeleccionada({ ...piezaSeleccionada, estado: nuevoEstado });
      }
    } catch (err) {
      alert("Error al cambiar estado: " + err.message);
    } finally {
      setEnviando(false);
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

  function obtenerColorPrioridad(prioridad) {
    switch (prioridad) {
      case "alta":
        return "#333";
      case "media":
        return "#777";
      case "baja":
        return "#ccc";
      default:
        return "#aaa";
    }
  }

  function obtenerColorTextoPrioridad(prioridad) {
    return prioridad === "baja" ? "#333" : "#fff";
  }

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
        {/* Controles */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "20px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
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
          <span
            style={{
              marginLeft: "12px",
              fontSize: "11px",
              fontWeight: 600,
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Filtros:
          </span>

          <select
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
              setFiltroResponsable("");
              setFiltroCliente("");
              setFiltroPrioridad("");
            }}
            style={{ marginLeft: "auto" }}
          >
            Limpiar filtros
          </button>
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
              const piezasDelEstado = agruparPorEstado()[estado];
              return (
                <div key={estado} className="kanban-column">
                  <div className="kanban-header">
                    <span className="font-weight-bold">
                      {ESTADO_LABELS[estado]}
                    </span>
                    <span style={{ fontSize: "12px", color: "#999" }}>
                      ({piezasDelEstado.length})
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {piezasDelEstado.map((pieza) => (
                      <div
                        key={`${pieza.origen}-${pieza.id}`}
                        className="card"
                        onClick={() => abrirModal(pieza)}
                        style={{ cursor: "pointer" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "start",
                            marginBottom: "6px",
                          }}
                        >
                          <div>
                            <span style={{ fontSize: "16px" }}>
                              {TIPO_ICONOS[pieza.tipo] || "📄"}
                            </span>
                            <span style={{ fontSize: "14px", fontWeight: "bold" }}>
                              {pieza.tipo.charAt(0).toUpperCase() +
                                pieza.tipo.slice(1)}
                            </span>
                          </div>
                          <div
                            style={{
                              width: "10px",
                              height: "10px",
                              borderRadius: "50%",
                              backgroundColor: obtenerColorPrioridad(
                                pieza.prioridad
                              ),
                            }}
                            title={pieza.prioridad}
                          ></div>
                        </div>

                        <div className="cliente">
                          {pieza.cliente_nombre || "Sin cliente"}
                        </div>

                        <div className="meta" style={{ marginTop: "6px" }}>
                          <small>
                            Responsable: <strong>{pieza.responsable}</strong>
                          </small>
                        </div>

                        {pieza.fecha_programada && (
                          <div className="meta">
                            <small>
                              Fecha:{" "}
                              <strong>
                                {new Date(
                                  pieza.fecha_programada
                                ).toLocaleDateString()}
                              </strong>
                            </small>
                          </div>
                        )}

                        {pieza.idea && (
                          <div className="meta" style={{ marginTop: "6px" }}>
                            <small>
                              <strong>Idea:</strong> {pieza.idea.substring(0, 50)}
                              {pieza.idea.length > 50 ? "..." : ""}
                            </small>
                          </div>
                        )}
                      </div>
                    ))}
                    {piezasDelEstado.length === 0 && (
                      <div
                        style={{
                          padding: "10px",
                          textAlign: "center",
                          fontSize: "12px",
                          color: "#999",
                        }}
                      >
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
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "13px" }}>
              <thead>
                <tr>
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
                {piezasFiltradas.map((pieza) => (
                  <tr key={`${pieza.origen}-${pieza.id}`}>
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
                ))}
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

function Sidebar({ path, sesion, enlacesNav, onCerrarSesion, ROL_LABELS }) {
  const [abierto, setAbierto] = useState(false);
  const esAdmin = sesion?.usuario?.rol === "admin";
  const rutaTablero =
    sesion?.usuario?.usuario === "agustin"
      ? "/agustin"
      : sesion?.usuario?.usuario === "franco"
        ? "/franco"
        : USUARIO_A_RUTA[sesion?.usuario?.usuario];

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
      { href: "/reportes-historias", label: "Reportes" },
    ],
    admin: esAdmin ? [
      { href: "/clientes", label: "Clientes" },
      { href: "/empleados", label: "Usuarios / permisos" },
    ] : [],
    cuenta: [
      { href: "/perfil", label: "Perfil" },
    ],
  };

  const renderLinksSección = (enlaces) =>
    enlaces.map((enlace) => (
      <a
        key={enlace.href}
        href={enlace.href}
        className={`sidebar-link ${path === enlace.href ? "active" : ""}`}
        onClick={() => setAbierto(false)}
      >
        {enlace.label}
      </a>
    ));

  return (
    <>
      <button className="sidebar-toggle" onClick={() => setAbierto(!abierto)}>
        ☰
      </button>
      <nav className={`sidebar ${abierto ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="user-badge">
            <div className="user-avatar">👤</div>
            <div className="user-info">
              <div className="user-name">{sesion?.usuario?.nombre}</div>
              <div className="user-role">{ROL_LABELS[sesion?.usuario?.rol] || sesion?.usuario?.rol}</div>
            </div>
          </div>
          <button className="sidebar-close" onClick={() => setAbierto(false)}>
            ✕
          </button>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-section">
            {renderLinksSección(seccionesNav.inicio)}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Planificación</div>
            {renderLinksSección(seccionesNav.planificacion)}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Gestión</div>
            {renderLinksSección(seccionesNav.gestion)}
          </div>

          {esAdmin && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Administración</div>
              {renderLinksSección(seccionesNav.admin)}
            </div>
          )}

          <div className="sidebar-section">
            <div className="sidebar-section-title">Cuenta</div>
            {renderLinksSección(seccionesNav.cuenta)}
            <button
              className="sidebar-link logout-btn"
              onClick={() => {
                setAbierto(false);
                onCerrarSesion();
              }}
            >
              🚪 Cerrar sesión
            </button>
          </div>
        </div>
      </nav>
      {abierto && <div className="sidebar-overlay" onClick={() => setAbierto(false)} />}
    </>
  );
}

function App() {
  const path = window.location.pathname;
  let sesion = getSesion();

  // Si estamos en una ruta de usuario específica, usar esa sesión
  if (Object.values(USUARIO_A_RUTA).includes(path)) {
    sesion = getSesionDelPath(path);
  }

  if (path === "/login") {
    if (sesion) {
      window.location.href = USUARIO_A_RUTA[sesion.usuario.usuario] || "/";
      return null;
    }
    return <LoginPage />;
  }

  if (!sesion) {
    window.location.href = "/login";
    return null;
  }

  const esAdmin = sesion.usuario.rol === "admin";
  const rutaPropia = USUARIO_A_RUTA[sesion.usuario.usuario];
  const rutasCompartidas = ["/", "/calendario", "/calendario-estructura", "/planificacion-historias", "/planificacion-publicaciones", "/reportes-historias", "/perfil", "/piezas"];
  const rutaPermitida =
    esAdmin || rutasCompartidas.includes(path) || rutaPropia === path;

  if (!rutaPermitida) {
    window.location.href = rutaPropia || "/";
    return null;
  }

  const dashboard = (() => {
    if (path === "/agustin") {
      return <AgustinDashboard />;
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
    if (path === "/franco") {
      return <FrancoDashboard />;
    }
    if (path === "/equipo") {
      return <EquipoDashboard />;
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
      return <PiezasTableroPage />;
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

  const enlacesNav = [
    { href: "/", label: "Home" },
    { href: rutaPropia || "/", label: "Mi tablero" },
    { href: "/planificacion-historias", label: "🎯 Historias" },
    { href: "/planificacion-publicaciones", label: "🎬 Publicaciones" },
    { href: "/reportes-historias", label: "📊 Reportes" },
    { href: "/perfil", label: "Mi perfil" },
    { href: "/piezas", label: "📋 Tareas" },
  ];
  if (esAdmin) {
    enlacesNav.push({ href: "/clientes", label: "Clientes" });
    enlacesNav.push({ href: "/empleados", label: "Empleados" });
    enlacesNav.push({ href: "/nueva-tarea", label: "+ Nueva tarea" });
  }

  return (
    <>
      <Sidebar path={path} sesion={sesion} enlacesNav={enlacesNav} onCerrarSesion={cerrarSesion} ROL_LABELS={ROL_LABELS} />
      {dashboard}
    </>
  );
}

const ROLES_HOME = [
  { nombre: "Agustín", descripcion: "Panorama admin", path: "/agustin" },
  { nombre: "Franco", descripcion: "Cola de aprobaciones", path: "/franco" },
  { nombre: "Augusto", descripcion: "Diseño", path: "/augusto" },
  { nombre: "Luciano", descripcion: "Edición", path: "/luciano" },
  { nombre: "Germán", descripcion: "Producción", path: "/german" },
  { nombre: "Oriana", descripcion: "Community", path: "/oriana" },
];

function HomePage() {
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";
  const rutaPropia = USUARIO_A_RUTA[sesion?.usuario?.usuario] || "/";

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
      desc: "Tus datos y contraseña",
      href: "/perfil",
    },
  ];
  if (esAdmin) {
    atajos.push({
      titulo: "Vista de equipo",
      desc: "Carga y cumplimiento por persona",
      href: "/equipo",
    });
    atajos.push({
      titulo: "Cargar tarea nueva",
      desc: "Asignar trabajo a alguien",
      href: "/nueva-tarea",
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
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Home</span>
          </div>
          <div className="tag">
            {sesion?.usuario?.nombre} · {sesion?.usuario?.rol}
          </div>
        </div>

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

  const piezasFiltradas = piezas.filter((pz) => {
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
  });

  const porFecha = {};
  piezasFiltradas.forEach((pz) => {
    if (!pz.fecha_programada) return;
    (porFecha[pz.fecha_programada] = porFecha[pz.fecha_programada] || []).push(pz);
  });
  Object.values(porFecha).forEach((items) => {
    items.sort((a, b) => {
      if (a.estado === b.estado) return a.cliente_nombre.localeCompare(b.cliente_nombre);
      if (a.estado === "publicada") return 1;
      if (b.estado === "publicada") return -1;
      return a.estado.localeCompare(b.estado);
    });
  });

  const semanas = getGrillaMes(year, month);
  const hoyISO = getHoyLocalISO();
  const finProximos7 = sumarDiasISO(hoyISO, 7);
  const mesISO = fechaISODesde(year, month, 1).slice(0, 7);
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

  const filtros = [
    { key: "todos", label: "Todo" },
    { key: "video", label: "Reels" },
    { key: "carrusel", label: "Carruseles" },
  ];
  const filtrosEstado = [
    { key: "todos", label: "Todos" },
    { key: "pendientes", label: "Pendientes" },
    { key: "publicada", label: "Publicadas" },
    { key: "bloqueada", label: "No publicado / revisar" },
  ];

  const cambiarEstadoPublicacion = async (publicacion, nuevoEstado) => {
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
  };

  const abrirDia = (fecha, items) => {
    if (!items.length) return;
    setDiaSel({ fecha, items });
  };

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
              {filtros.map((f) => (
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
              {filtrosEstado.map((f) => (
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
          <strong>{publicadasDelMes.length}</strong>
          <span>Publicadas del mes</span>
        </div>
        <div>
          <strong>{pendientesDelMes.length}</strong>
          <span>Pendientes del mes</span>
        </div>
        <div className={pendientesVencidas.length ? "alert" : ""}>
          <strong>{pendientesVencidas.length}</strong>
          <span>Vencidas sin check</span>
        </div>
        <div>
          <strong>{pendientesHoy.length}</strong>
          <span>Para publicar hoy</span>
        </div>
        <div>
          <strong>{proximos7.length}</strong>
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
  admin: "Administrador",
  diseno: "Diseño",
  edicion: "Edición",
  produccion: "Producción",
  community: "Community",
};

function PerfilPage() {
  const sesion = getSesion();
  const usuario = sesion?.usuario;
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

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
        usuario: usuario.usuario,
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
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Mi perfil</span>
            <a href="/">Home</a>
          </div>
          <div className="tag">{usuario?.nombre}</div>
        </div>

        <div className="content">
          <div className="section-label">Mis datos</div>
          <div className="box">
            <div className="detail-grid">
              <div className="detail-field">
                <div className="detail-label">Nombre</div>
                <div>{usuario?.nombre}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Usuario de acceso</div>
                <div>{usuario?.usuario}</div>
              </div>
              <div className="detail-field">
                <div className="detail-label">Rol</div>
                <div>{ROL_LABELS[usuario?.rol] || usuario?.rol}</div>
              </div>
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
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [rol, setRol] = useState("diseno");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cargarUsuarios = () => {
    fetch("/api/usuarios")
      .then((r) => r.json())
      .then(setUsuarios)
      .catch(() => setError("No se pudieron cargar los empleados."));
  };

  useEffect(cargarUsuarios, []);

  const handleCrear = (event) => {
    event.preventDefault();
    setFormError(null);
    setMensaje(null);
    setEnviando(true);

    fetch("/api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, usuario, rol, password }),
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
        cargarUsuarios();
      })
      .catch(() => setError("No se pudo dar de baja al empleado."));
  };

  return (
    <main aria-label="Render platform empleados">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Empleados</span>
            <a href="/">Home</a>
          </div>
          <div className="tag">Gestión de accesos</div>
        </div>

        <div className="content">
          <div className="section-label">Empleados con acceso</div>
          <div className="box">
            {error && <div className="caption">{error}</div>}
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td>{u.nombre}</td>
                    <td>{u.usuario}</td>
                    <td>{ROL_LABELS[u.rol] || u.rol}</td>
                    <td>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => handleEliminar(u)}
                      >
                        Dar de baja
                      </button>
                    </td>
                  </tr>
                ))}
                {usuarios.length === 0 && !error && (
                  <tr>
                    <td colSpan="4">No hay empleados cargados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="section-label">Alta de nuevo empleado</div>
          <div className="box">
            <form onSubmit={handleCrear}>
              <div className="form-grid cols-2">
                <label className="form-field">
                  <span>Nombre y apellido *</span>
                  <input
                    type="text"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Usuario de acceso *</span>
                  <input
                    type="text"
                    value={usuario}
                    placeholder="ej: martina"
                    onChange={(e) => setUsuario(e.target.value)}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Rol *</span>
                  <select value={rol} onChange={(e) => setRol(e.target.value)}>
                    {Object.entries(ROL_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Contraseña inicial *</span>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
              </div>

              {formError && (
                <div className="caption login-error">{formError}</div>
              )}
              {mensaje && (
                <div className="caption" style={{ color: "#333", fontWeight: "bold" }}>
                  {mensaje}
                </div>
              )}

              <div style={{ marginTop: "14px" }}>
                <button className="btn primary" type="submit" disabled={enviando}>
                  {enviando ? "Creando..." : "Crear empleado"}
                </button>
              </div>
            </form>
            <div className="caption">
              → La contraseña inicial se le comparte al empleado, y él puede
              cambiarla desde "Mi perfil".
            </div>
          </div>
        </div>
      </div>
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
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Calendario</span>
            <span>Publicaciones</span>
          </div>
          <div className="tag">Oriana · publicación</div>
        </div>

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

          <div className="modal-actions">
            {/* Regla dura: solo Agustín o Franco pueden marcar publicada. */}
            <button
              className="btn primary disabled"
              disabled={!esAdmin || enviando}
              title={esAdmin ? undefined : "Solo admin puede marcar publicada"}
              type="button"
              onClick={esAdmin ? handleMarcarPublicada : undefined}
            >
              {enviando ? "Marcando..." : "Marcar publicada"}
            </button>
          </div>
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

  const pendientes = tareasGerman.filter((tarea) => tarea.estado !== "hecha");

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
        t.estado === "hecha" &&
        t.fecha_vencimiento?.startsWith(mesActual),
    ).length;
    return { ...c, hechas, porcentaje: Math.round((hechas / c.cuota) * 100) };
  });
  const cuotaTotal = CUOTAS_GERMAN.reduce((acc, c) => acc + c.cuota, 0);
  const hechasTotal = cumplimientoPorCliente.reduce((acc, c) => acc + c.hechas, 0);

  return (
    <main aria-label="Render platform German">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Producciones</span>
            <span>Agenda</span>
          </div>
          <div className="tag">Germán · producción</div>
        </div>

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
                  <div style={{ fontSize: "12px", color: "#555" }}>Estado: {proximaTarea.estado === "bloqueada" ? "Bloqueada: " + (proximaTarea.propiedades_extra?.motivo_bloqueo ?? "sin motivo") : getEstadoHistoriaLabel(proximaTarea.estado)}</div>
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
                const estaBloqueada = tarea.estado === "bloqueada";

                return (
                  <div
                    className={`priority-card ${estaBloqueada ? "blocked" : ""}`}
                    key={tarea.id}
                    onClick={() => setProduccionSeleccionada(tarea)}
                  >
                    <div className="cliente">
                      {tarea.cliente_nombre ?? "Sin cliente"}
                    </div>
                    <div>{tarea.titulo}</div>
                    <div className="meta">
                      {estaBloqueada ? (
                        <span className="tag operativa">
                          Bloqueada:{" "}
                          {tarea.propiedades_extra?.motivo_bloqueo ??
                            "sin motivo cargado"}
                        </span>
                      ) : tarea.propiedades_extra?.coordinada ? (
                        `Coordinado para ${
                          tarea.propiedades_extra.horario ??
                          "fecha sin especificar"
                        }`
                      ) : (
                        getEstadoHistoriaLabel(tarea.estado)
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
              "Hecha" — no alcanza con haber ido a filmar.
            </div>
          </div>

          <div className="section-label">4 · Bloqueos</div>
          <div className="box">
            {tareasGerman.filter((t) => t.estado === "bloqueada").length === 0 && (
              <div className="caption">Sin bloqueos activos.</div>
            )}
            {tareasGerman
              .filter((t) => t.estado === "bloqueada")
              .map((t) => (
                <div className="priority-card blocked" key={`bloqueo-${t.id}`}>
                  <div className="cliente">{t.cliente_nombre ?? "Sin cliente"}</div>
                  <div>{t.titulo}</div>
                  <div className="meta">{t.propiedades_extra?.motivo_bloqueo ?? "Sin motivo cargado"}</div>
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
      body: JSON.stringify({ estado: "hecha" }),
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
              <div>{getEstadoHistoriaLabel(produccion.estado)}</div>
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
              disabled={enviando !== null || produccion.estado === "hecha"}
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

  const pendientes = edicionesLuciano.filter((t) => t.estado !== "hecha");
  const hechas = edicionesLuciano.filter((t) => t.estado === "hecha").length;
  const proxima = pendientes[0];

  return (
    <main aria-label="Render platform Luciano">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Mis ediciones</span>
          </div>
          <div className="tag">Luciano · edición</div>
        </div>

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
                  {proxima.requiere_aprobacion ? "Esperando aprobación de Franco" : `Estado: ${getEstadoHistoriaLabel(proxima.estado)}`}
                </div>
              </div>
            )}
          </div>

          <div className="section-label">Avance del mes</div>
          <div className="box">
            <div className="progress-card">
              <div className="progress-label">Videos editados</div>
              <div className="progress-value">
                {hechas} / {edicionesLuciano.length}
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
    (t) => t.estado !== "hecha" && t.fecha_vencimiento && t.fecha_vencimiento <= hoy,
  );
  const hechas = disenosAugusto.filter((t) => t.estado === "hecha").length;
  const proxima = disenosAugusto.find((t) => t.estado !== "hecha");

  return (
    <main aria-label="Render platform Augusto">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Mis diseños</span>
          </div>
          <div className="tag">Augusto · diseño</div>
        </div>

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
                <div style={{ fontSize: "12px", color: "#666" }}>Estado: {getEstadoHistoriaLabel(proxima.estado)}</div>
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
                  {t.fecha_vencimiento} · {getEstadoHistoriaLabel(t.estado)}
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
                {hechas} / {disenosAugusto.length}
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
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span>Panorama</span>
            <span className="active">Equipo</span>
          </div>
          <div className="tag">Vista de equipo</div>
        </div>

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

function ClientesAdminPage() {
  const [clientes, setClientes] = useState([]);
  const [historias, setHistorias] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  const cargarClientes = () => {
    setCargando(true);
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
      .finally(() => setCargando(false));
  };

  useEffect(cargarClientes, []);

  const filas = getResumenClientesActivos(clientes, historias, publicaciones);
  const filasFiltradas = filas.filter((cliente) =>
    cliente.nombre.toLowerCase().includes(busqueda.toLowerCase()),
  );
  const conPlanificacion = filas.filter((cliente) => cliente.historiasMes > 0);
  const cumplimientoHistorias =
    conPlanificacion.length === 0
      ? 0
      : Math.round(
          conPlanificacion.reduce(
            (sum, cliente) => sum + cliente.porcentajeHistorias,
            0,
          ) / conPlanificacion.length,
        );
  const clientesBajos = filas.filter(
    (cliente) => cliente.estadoHistorias.color === "rojo",
  ).length;

  return (
    <main aria-label="Administración de clientes">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Clientes</span>
            <a href="/empleados">Usuarios / permisos</a>
          </div>
          <div className="tag">Administración</div>
        </div>

        <div className="content">
          <div className="section-label">
            Clientes activos — {getMesActualISO()}
          </div>

          <div
            style={{
              display: "grid",
              gap: "10px",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              marginBottom: "16px",
            }}
          >
            <div className="box" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>
                {filas.length}
              </div>
              <div className="caption">Clientes activos</div>
            </div>
            <div className="box" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>
                {cumplimientoHistorias}%
              </div>
              <div className="caption">Cumplimiento historias</div>
            </div>
            <div className="box" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>
                {clientesBajos}
              </div>
              <div className="caption">Clientes bajos</div>
            </div>
          </div>

          <div className="box">
            <div className="box-header">
              <strong>Control mensual de clientes</strong>
              <span className="tag">Checklist de historias conectado</span>
            </div>

            <input
              type="text"
              placeholder="Buscar cliente por nombre..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ marginBottom: "12px", width: "100%" }}
            />

            {error && <div className="caption login-error">{error}</div>}
            {cargando ? (
              <div style={{ padding: "24px", textAlign: "center", color: "#999" }}>
                Cargando clientes...
              </div>
            ) : (
              <div style={{ overflowX: "hidden" }}>
                <table className="clientes-admin-table">
                  <thead>
                    <tr>
                      <th>Estado</th>
                      <th>Cliente</th>
                      <th>Reels</th>
                      <th>Carr.</th>
                      <th>Historias</th>
                      <th>Alerta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasFiltradas.map((cliente) => (
                      <tr
                        className="row-clickable"
                        key={cliente.id}
                        onClick={() => setClienteSeleccionado(cliente)}
                      >
                        <td>
                          <span
                            className={`semaforo ${cliente.estadoHistorias.color}`}
                          ></span>
                          {cliente.estadoHistorias.label}
                        </td>
                        <td>
                          <strong>{cliente.nombre}</strong>
                          <div className="caption">Activo</div>
                        </td>
                        <td>
                          {cliente.reelsPublicados} / {cliente.cuota_reels ?? 0}
                        </td>
                        <td>
                          {cliente.carruselesPublicados} /{" "}
                          {cliente.cuota_carruseles ?? 0}
                        </td>
                        <td>
                          <strong>{cliente.porcentajeHistorias}%</strong>
                          <div className="caption">
                            {cliente.historiasPublicadas} / {cliente.historiasMes} OK
                          </div>
                          <div className="caption">
                            Último: {cliente.ultimaHistoriaOk || "-"}
                          </div>
                        </td>
                        <td>
                          {cliente.historiasMes === 0
                            ? "Sin planificación cargada"
                            : cliente.estadoHistorias.color === "rojo"
                              ? "Se están subiendo pocas historias"
                              : cliente.estadoHistorias.color === "amarillo"
                                ? "Revisar ritmo"
                                : "Al día"}
                        </td>
                      </tr>
                    ))}
                    {filasFiltradas.length === 0 && (
                      <tr>
                        <td colSpan="6">No hay clientes con ese criterio.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="caption">
              Historias sale de la checklist: las marcadas OK cuentan como
              publicadas. Si un cliente no tiene historias planificadas, queda
              gris y no se lo castiga como incumplido.
            </div>
          </div>
        </div>
      </div>

      {clienteSeleccionado && (
        <DetalleClienteModal
          cliente={clienteSeleccionado}
          historias={historias.filter((h) => h.cliente_id === clienteSeleccionado.id)}
          publicaciones={publicaciones.filter(
            (p) => p.cliente_id === clienteSeleccionado.id,
          )}
          onClose={() => setClienteSeleccionado(null)}
          onCuotaActualizada={cargarClientes}
        />
      )}
    </main>
  );
}

function AgustinDashboard() {
  const [clientes, setClientes] = useState([]);
  const [resumenEquipo, setResumenEquipo] = useState([]);
  const [aprobacionesAgustin, setAprobacionesAgustin] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [panoramaError, setPanoramaError] = useState(null);
  const [resumenEquipoError, setResumenEquipoError] = useState(null);
  const [aprobacionesAgustinError, setAprobacionesAgustinError] =
    useState(null);
  const [historiasRaw, setHistoriasRaw] = useState([]);
  const [publicacionesRaw, setPublicacionesRaw] = useState([]);
  const [busquedaCliente, setBusquedaCliente] = useState("");

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
        setAprobacionesAgustin(getAprobacionesAgustin(tareasApi));
        setHistoriasRaw(historiasApi);
        setPublicacionesRaw(publicacionesApi);
      })
      .catch((error) => {
        console.error("No se pudieron cargar los datos de Agustín", error);
        setPanoramaError("No se pudo cargar el panorama de clientes.");
        setResumenEquipoError("No se pudo cargar el resumen de equipo.");
        setAprobacionesAgustinError("No se pudieron cargar las aprobaciones.");
      });
  };

  useEffect(cargarPanorama, []);

  const clientesFiltrados = clientes.filter((cliente) =>
    cliente.nombre.toLowerCase().includes(busquedaCliente.toLowerCase()),
  );

  return (
    <main aria-label="Render platform">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Panorama</span>
            <span>Clientes</span>
            <span>Config Maestra</span>
            <a href="/equipo">Equipo</a>
          </div>
          <div className="tag">Agustín · admin</div>
        </div>

        <div className="content">
          <div style={{ backgroundColor: "#ffe0e0", border: "2px solid #d32f2f", borderRadius: "4px", padding: "12px", marginBottom: "20px", fontSize: "13px" }}>
            {(() => {
              const atrasadas = getPiezasAtrasadas(historiasRaw, publicacionesRaw);
              const bloqueadas = getPiezasBloqueadas(historiasRaw, publicacionesRaw);
              const cumplimiento = getCumplimientoGeneral(clientes);

              return (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
                  <div>
                    <span style={{ marginRight: "20px" }}>
                      🔴 {atrasadas.length} atrasados
                    </span>
                    <span style={{ marginRight: "20px" }}>
                      ⚠️ {bloqueadas.length} bloqueados
                    </span>
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
            3 · Aprobaciones que le corresponden a él directamente
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
                {aprobacionesAgustin.map((aprobacion) => (
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
                            body: JSON.stringify({ estado: "hecha" }),
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
                {aprobacionesAgustinError && (
                  <tr>
                    <td colSpan="4">{aprobacionesAgustinError}</td>
                  </tr>
                )}
                {!aprobacionesAgustinError &&
                  aprobacionesAgustin.length === 0 && (
                    <tr>
                      <td colSpan="4">
                        No hay tareas escaladas a Agustín.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
            <div className="caption">
              → No es la cola completa (esa es de Franco). Solo lo escalado
              específicamente a Agustín.
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
              Franco.
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
      </div>

      {clienteSeleccionado && (
        <DetalleClienteModal
          cliente={clienteSeleccionado}
          historias={historiasRaw.filter(
            (h) => h.cliente_id === clienteSeleccionado.id,
          )}
          publicaciones={publicacionesRaw.filter(
            (p) => p.cliente_id === clienteSeleccionado.id,
          )}
          onClose={() => setClienteSeleccionado(null)}
          onCuotaActualizada={cargarPanorama}
        />
      )}
      <TareasAsignadasGenericas nombre="Agustín" />
    </main>
  );
}

function FrancoDashboard() {
  const [piezaSeleccionada, setPiezaSeleccionada] = useState(null);
  const [piezasEnRevision, setPiezasEnRevision] = useState([]);
  const [piezasEnRevisionError, setPiezasEnRevisionError] = useState(null);
  const [filtroCola, setFiltroCola] = useState("todas");
  const [tareasFranco, setTareasFranco] = useState([]);
  const [tareasFrancoError, setTareasFrancoError] = useState(null);
  const [tareaAsignando, setTareaAsignando] = useState(null);
  const [responsableSeleccionado, setResponsableSeleccionado] = useState("");

  const tareasDestrabadas = tareasFranco.filter(
    (tarea) => tarea.propiedades_extra?.destrabada_por,
  );
  const tareasEscaladas = tareasFranco.filter(
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
        console.error("No se pudieron cargar las aprobaciones de Franco", error);
        setPiezasEnRevisionError("No se pudieron cargar las aprobaciones.");
      });
  };

  useEffect(() => {
    cargarCola();

    fetch("/api/tareas")
      .then((response) => response.json())
      .then((tareas) => {
        setTareasFranco(tareas);
      })
      .catch((error) => {
        console.error("No se pudieron cargar las tareas de Franco", error);
        setTareasFrancoError("No se pudieron cargar las tareas.");
      });
  }, []);

  const piezasFiltradas = piezasEnRevision.filter((pieza) => {
    if (filtroCola === "creativa") return pieza.estado === "en_revision";
    if (filtroCola === "bloqueo") return pieza.estado === "bloqueada";
    return true;
  });

  return (
    <main aria-label="Render platform Franco">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Mi cola</span>
            <span>Clientes</span>
            <a href="/equipo">Equipo</a>
          </div>
          <div className="tag">Franco · aprobación</div>
        </div>

        <div className="content">
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
              → Esta cola no mezcla todo: solo lo que necesita decisión directa
              de Franco.
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
                {tareasFrancoError && (
                  <tr>
                    <td colSpan="3">{tareasFrancoError}</td>
                  </tr>
                )}
                {!tareasFrancoError && tareasDestrabadas.length === 0 && (
                  <tr>
                    <td colSpan="3">No hay piezas destrabadas registradas.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="caption">
              → Historial simple de lo que Franco ya destrabó hoy.
            </div>
          </div>

          <div className="section-label">3 · Escalado a Agustín</div>
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
            {tareasFrancoError && (
              <div className="caption">{tareasFrancoError}</div>
            )}
            {!tareasFrancoError && tareasEscaladas.length === 0 && (
              <div className="caption">No hay tareas escaladas a Agustín.</div>
            )}
            <div className="caption">
              → Franco ve qué ya salió de su cancha y está esperando respuesta.
            </div>
          </div>

          <div className="section-label">4 · Tareas para asignar</div>
          <div className="box">
            {(() => {
              const porAsignar = getTareasParaAsignar(tareasFranco);
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
              → Tareas pendientes que Franco puede asignar rápidamente.
            </div>
          </div>
        </div>
      </div>

      {piezaSeleccionada && (
        <RevisionPiezaModal
          pieza={piezaSeleccionada}
          onClose={() => setPiezaSeleccionada(null)}
          onAprobar={cargarCola}
          onCorreccion={cargarCola}
        />
      )}
      <TareasAsignadasGenericas nombre="Franco" />
    </main>
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
      "¿Cuál es el motivo para escalar esto a Agustín?",
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
        asignado_a: "Franco",
        cliente_id: pieza.cliente_id,
        estado: "pendiente",
        requiere_aprobacion: true,
        escalada_a: "Agustín",
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
        metadata: { Aclaración: `Desbloqueada por Franco: ${resolucion}` },
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
                  {enviando === "escalar" ? "Escalando..." : "Escalar a Agustín"}
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
                  {enviando === "escalar" ? "Escalando..." : "Escalar a Agustín"}
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
}) {
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const porcentajes = getPorcentajesCliente(cliente);
  const estado = getEstadoPorObjetivo(porcentajes.objetivo);

  const handleEditarCuota = () => {
    const nuevaCuotaReels = window.prompt(
      "Nueva cuota de reels por mes:",
      cliente.cuota_reels ?? "0",
    );
    if (nuevaCuotaReels === null) return;
    const nuevaCuotaCarruseles = window.prompt(
      "Nueva cuota de carruseles por mes:",
      cliente.cuota_carruseles ?? "0",
    );
    if (nuevaCuotaCarruseles === null) return;

    const cuota_reels = Number(nuevaCuotaReels);
    const cuota_carruseles = Number(nuevaCuotaCarruseles);
    if (
      !Number.isInteger(cuota_reels) ||
      !Number.isInteger(cuota_carruseles) ||
      cuota_reels < 0 ||
      cuota_carruseles < 0
    ) {
      setError("Las cuotas deben ser números enteros ≥ 0.");
      return;
    }

    setEnviando("cuota");
    setError(null);

    fetch(`/api/clientes/${cliente.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cuota_reels, cuota_carruseles }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo actualizar la cuota.");
        }
        return response.json();
      })
      .then(() => {
        onCuotaActualizada();
        onClose();
      })
      .catch(() => {
        setError("No se pudo actualizar la cuota. Intentá de nuevo.");
        setEnviando(null);
      });
  };

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

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <span>{cliente.nombre}</span>
          <button className="modal-close" type="button" onClick={onClose}>
            X
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-client-status">
            <span className={`semaforo ${estado}`}></span>
            <strong>
              {getEstadoLabel(estado)} · {porcentajes.objetivo}% objetivo mes
            </strong>
          </div>

          <div className="caption">
            Cuota mensual: {cliente.cuota_reels ?? 0} reels ·{" "}
            {cliente.cuota_carruseles ?? 0} carruseles
          </div>

          {error && <div className="caption login-error">{error}</div>}

          <table>
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
              onClick={() => handleAvisar("Franco")}
            >
              {enviando === "Franco" ? "Enviando..." : "Escalar a Franco"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={enviando !== null}
              onClick={handleEditarCuota}
            >
              {enviando === "cuota" ? "Guardando..." : "Editar cuota"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
    if (filtroEstado === "activas" && t.estado === "hecha") return false;
    if (filtroEstado !== "todos" && filtroEstado !== "activas" && t.estado !== filtroEstado) return false;
    if (filtroPrioridad !== "todos" && t.prioridad !== filtroPrioridad) return false;
    return true;
  });

  const estadosDisponibles = ["pendiente", "en_progreso", "en_revision", "hecha"];
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
        (t) => t.estado !== "hecha" && t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
      ),
    },
    {
      id: "hoy",
      titulo: "Hoy",
      tareas: tareasFiltradas.filter(
        (t) => t.estado !== "hecha" && t.fecha_vencimiento === hoyISO,
      ),
    },
    {
      id: "semana",
      titulo: "Próximos 7 días",
      tareas: tareasFiltradas.filter(
        (t) =>
          t.estado !== "hecha" &&
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
          t.estado !== "hecha" &&
          (!t.fecha_vencimiento || t.fecha_vencimiento > limiteSemanaISO),
      ),
    },
    {
      id: "hechas",
      titulo: "Hechas",
      tareas: tareasFiltradas.filter((t) => t.estado === "hecha"),
    },
  ]
    .map((grupo) => ({ ...grupo, tareas: ordenarTareas(grupo.tareas) }))
    .filter((grupo) => grupo.tareas.length > 0);

  const pendientesActivas = tareas.filter((t) => t.estado !== "hecha").length;
  const vencidasActivas = tareas.filter(
    (t) => t.estado !== "hecha" && t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
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
      hecha: "#28a745",
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
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">{titulo}</span>
          </div>
          <div className="tag">{nombre_usuario} · {rol}</div>
        </div>

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
              <option value="en_progreso">En progreso</option>
              <option value="en_revision">En revisión</option>
              <option value="hecha">Hecha</option>
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
                          </td>
                          <td style={{ width: "18%", color: "#555" }}>{tarea.cliente_nombre || "Sin cliente"}</td>
                          <td style={{ width: "12%", color: tarea.fecha_vencimiento && tarea.fecha_vencimiento < hoyISO && tarea.estado !== "hecha" ? "#c62828" : "#666", fontWeight: tarea.fecha_vencimiento && tarea.fecha_vencimiento < hoyISO && tarea.estado !== "hecha" ? 700 : 400 }}>
                            {tarea.fecha_vencimiento || "Sin fecha"}
                          </td>
                          <td style={{ width: "12%" }}>
                            <span style={{ color: getEstadoColor(tarea.estado), fontWeight: 700 }}>●</span>{" "}
                            {getEstadoHistoriaLabel(tarea.estado)}
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
                                <option key={estado} value={estado}>{getEstadoHistoriaLabel(estado)}</option>
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

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Cliente:</strong> {tareaSeleccionada.cliente_nombre || "—"}
                  </div>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Estado actual:</strong> <span style={{ color: getEstadoColor(tareaSeleccionada.estado) }}>●</span> {tareaSeleccionada.estado}
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
                          {actualizando ? "..." : estado.replace("_", " ")}
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

const RESPONSABLES_EQUIPO = ["Augusto", "Luciano", "Germán", "Oriana", "Franco", "Agustín"];

// Orden de columnas navegables con Tab/Enter (coincide con el orden visual).
const COLUMNAS_PLANILLA = ["fecha", "hora", "tipo", "copy", "material", "aclaraciones", "responsable", "estado"];
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

function HistoriasPlanillaTab({ clienteId, clienteNombre }) {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());
  const [historias, setHistorias] = useState([]);
  const [estructura, setEstructura] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const gridRef = useRef(null);
  const enfocarProximoId = useRef(null);

  const cargar = () => {
    setCargando(true);
    fetch("/api/historias")
      .then((r) => r.json())
      .then((data) => {
        setHistorias(data.filter((h) => h.cliente_id === clienteId));
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando historias", err);
        setError("No se pudieron cargar las historias.");
      })
      .finally(() => setCargando(false));
  };

  useEffect(cargar, [clienteId]);

  // Estructura semanal base del cliente — se usa solo para sugerir tipo/hora
  // al crear una historia nueva, no cambia nada del guardado.
  useEffect(() => {
    fetch("/api/estructura")
      .then((r) => r.json())
      .then((data) => setEstructura(data.filter((e) => e.cliente_id === clienteId)))
      .catch((err) => console.error("No se pudo cargar la estructura semanal", err));
  }, [clienteId]);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];

  const filasVisibles = historias
    .filter((h) => h.fecha_programada && h.fecha_programada.startsWith(mesPrefix))
    .slice()
    .sort((a, b) =>
      (a.fecha_programada + (a.metadata?.hora || "")).localeCompare(
        b.fecha_programada + (b.metadata?.hora || ""),
      ),
    );

  const publicadas = filasVisibles.filter((h) => h.estado === "publicada").length;
  const atrasadas = filasVisibles.filter(
    (h) => h.fecha_programada < hoyISO && h.estado !== "publicada",
  ).length;

  // Foco tras crear una fila nueva: la agrega el efecto de abajo apenas
  // aparece en la lista (el fetch de recarga puede tardar un instante).
  useEffect(() => {
    if (!enfocarProximoId.current) return;
    const idx = filasVisibles.findIndex((h) => h.id === enfocarProximoId.current);
    if (idx === -1) return;
    enfocarProximoId.current = null;
    requestAnimationFrame(() => enfocarCelda(idx, "fecha"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historias]);

  const actualizarLocal = (historiaId, campos) => {
    setHistorias((prev) =>
      prev.map((h) => {
        if (h.id !== historiaId) return h;
        const actualizado = { ...h, ...campos };
        if (campos.metadata) actualizado.metadata = { ...(h.metadata || {}), ...campos.metadata };
        return actualizado;
      }),
    );
  };

  const guardarEnServidor = async (historiaId, campos) => {
    try {
      const res = await fetch(`/api/historias/${historiaId}`, {
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

  // onBlur de las celdas de texto: recorta espacios y sincroniza el
  // estado local con lo mismo que se manda al servidor (evita que quede
  // un valor con espacios en el input mientras la DB ya tiene la versión
  // recortada).
  const confirmarCampoTexto = (historiaId, campos) => {
    actualizarLocal(historiaId, campos);
    guardarEnServidor(historiaId, campos);
  };

  const crearHistoria = async () => {
    const iso = mesPrefix === hoyISO.slice(0, 7) ? hoyISO : `${mesPrefix}-01`;
    try {
      const res = await fetch("/api/piezas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "historia",
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

      // Sugerencia de tipo/hora según el patrón semanal del cliente para ese
      // día — se espera antes de recargar para que ya aparezca sugerido.
      const diaSemana = new Date(`${iso}T00:00:00`).getDay();
      const patron = estructura.find((e) => e.dia_semana === diaSemana);
      if (patron?.tema || patron?.horario) {
        const horaSugerida = patron.horario?.match(/\d{1,2}:\d{2}/)?.[0] || "";
        await fetch(`/api/historias/${creada.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { tipo: patron.tema || "", hora: horaSugerida },
          }),
        }).catch((err) => console.error("No se pudo sugerir tipo/hora", err));
      }

      cargar();
    } catch (err) {
      console.error("Error creando historia", err);
      setError("No se pudo crear la historia.");
    }
  };

  const borrarHistoria = async (historiaId) => {
    if (!window.confirm("¿Eliminar esta historia de la planilla?")) return;
    try {
      const res = await fetch(`/api/historias/${historiaId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setHistorias((prev) => prev.filter((h) => h.id !== historiaId));
    } catch (err) {
      console.error("Error eliminando historia", err);
      setError("No se pudo eliminar la historia.");
    }
  };

  const copiarFila = async (h) => {
    const est = ESTADOS_HISTORIA.find((e) => e.id === h.estado);
    const linea = [
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
  };

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

  const enfocarCelda = (rowIndex, columna) => {
    const el = gridRef.current?.querySelector(
      `[data-cell="${rowIndex}:${columna}"]`,
    );
    if (!el) return;
    el.focus();
    if (typeof el.select === "function") el.select();
  };

  // Crece el textarea con el contenido en vez de esconder texto o abrir
  // scroll interno — la fila entera se estira, igual que en el Sheet.
  const ajustarAltura = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Enter mueve a la misma columna, fila de abajo (como Sheets/Excel). En
  // copy/observaciones Enter inserta un renglón propio en cambio — son
  // textos largos que legítimamente llevan varias líneas (un copy de
  // Instagram con su propio salto de párrafo, por ejemplo).
  const manejarEnterOTab = (e, rowIndex, columna) => {
    if (COLUMNAS_MULTILINEA.includes(columna)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      enfocarCelda(rowIndex + 1, columna);
    }
    // Tab usa el orden natural del DOM — no hace falta manejarlo a mano.
  };

  // Pegado multi-celda: si el portapapeles trae tabs (un bloque copiado de
  // Sheets), lo distribuye sobre las filas/columnas existentes a partir de
  // la celda activa. En columnas de texto largo un salto de línea solo no
  // dispara esto — puede ser contenido real (un copy de varios renglones)
  // pegado en una sola celda, no un rango de Sheets.
  const manejarPaste = (e, rowIndex, columna) => {
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
  };

  return (
    <>
      <div className="sheet-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button className="btn" type="button" onClick={() => irMes(-1)}>◀</button>
          <strong className="sheet-title">
            {MESES[month]} {year}
          </strong>
          <button className="btn" type="button" onClick={() => irMes(1)}>▶</button>
        </div>
        <div className="sheet-stats">
          <span>
            {filasVisibles.length} planificadas
          </span>
          <span className="ok">
            {publicadas} publicadas
          </span>
          <span className="warn">
            {filasVisibles.length - publicadas} pendientes
          </span>
          {atrasadas > 0 && (
            <span className="danger">{atrasadas} atrasadas</span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando planilla…</div>
      ) : (
        <div className="sheet-frame" ref={gridRef}>
          <div className="sheet-namebar">{clienteNombre}</div>
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{ width: "40px" }}>Día</th>
                <th style={{ width: "108px" }}>Fecha</th>
                <th style={{ width: "62px" }}>Hora</th>
                <th style={{ width: "150px" }}>Tipo</th>
                <th style={{ width: "34%" }}>Copy</th>
                <th style={{ width: "11%" }}>Material</th>
                <th style={{ width: "19%" }}>Observaciones</th>
                <th style={{ width: "100px" }}>Responsable</th>
                <th style={{ width: "118px" }}>Estado</th>
                <th style={{ width: "50px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "24px", color: "#999" }}>
                    Sin historias planificadas este mes todavía.
                  </td>
                </tr>
              )}
              {filasVisibles.map((h, rowIndex) => {
                const fecha = new Date(`${h.fecha_programada}T00:00:00`);
                const dow = fecha.getDay();
                const esFinde = dow === 0 || dow === 6;
                const esHoy = h.fecha_programada === hoyISO;
                const estaAtrasada = h.fecha_programada < hoyISO && h.estado !== "publicada";
                const est = ESTADOS_HISTORIA.find((e) => e.id === h.estado) || ESTADOS_HISTORIA[0];
                // Franjeado sutil por día (no por fila): ayuda a distinguir
                // rápido dónde termina un día y empieza el siguiente, igual
                // que en el Sheet, sin competir con hoy/atrasada/finde.
                const diaPar = fecha.getDate() % 2 === 0;
                const bgFila = estaAtrasada ? "#fff5f5" : esHoy ? "#e3f2fd" : esFinde ? "#fafafa" : diaPar ? "#fbfcfa" : undefined;
                const esNuevoDia = rowIndex === 0 || filasVisibles[rowIndex - 1].fecha_programada !== h.fecha_programada;

                return (
                  <tr key={h.id} style={{ background: bgFila, borderTop: esNuevoDia && rowIndex > 0 ? "2px solid #dadce0" : undefined }}>
                    <td style={{ padding: "8px 6px", fontWeight: esHoy ? "700" : "600", color: estaAtrasada ? "#c62828" : esFinde ? "#999" : "#333", fontSize: "12px" }}>
                      {esNuevoDia ? LETRAS_DIA[dow] : ""}
                      {estaAtrasada && esNuevoDia && <span title="Atrasada" style={{ marginLeft: "2px" }}>⚠</span>}
                    </td>
                    <td>
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
                    <td>
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
                          onClick={() => borrarHistoria(h.id)}
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
                  <button type="button" className="sheet-add-row" onClick={crearHistoria}>
                    <span style={{ fontSize: "15px" }}>+</span> Agregar historia
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="caption" style={{ marginTop: "10px" }}>
        Planilla de {clienteNombre}
      </div>
    </>
  );
}

function HistoriasChecklistPublicadasTab({ clientes }) {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());
  const [historias, setHistorias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);

  const cargar = () => {
    setCargando(true);
    fetch("/api/historias")
      .then((r) => r.json())
      .then((data) => {
        setHistorias(data);
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando checklist de historias", err);
        setError("No se pudo cargar el checklist de historias.");
      })
      .finally(() => setCargando(false));
  };

  useEffect(cargar, []);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];

  const historiasMes = historias.filter(
    (h) => h.fecha_programada && h.fecha_programada.startsWith(mesPrefix),
  );

  const historiasPorClienteFecha = historiasMes.reduce((acc, h) => {
    const key = `${h.cliente_id}:${h.fecha_programada}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(h);
    return acc;
  }, {});

  const primerDiaMes = new Date(year, month, 1);
  const ultimoDiaMes = new Date(year, month + 1, 0);
  const inicioCalendario = new Date(primerDiaMes);
  inicioCalendario.setDate(primerDiaMes.getDate() - ((primerDiaMes.getDay() + 6) % 7));
  const finCalendario = new Date(ultimoDiaMes);
  finCalendario.setDate(ultimoDiaMes.getDate() + (7 - ((ultimoDiaMes.getDay() + 6) % 7) - 1));

  const semanas = [];
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
    semanas.push(dias);
  }

  const publicadas = historiasMes.filter((h) => h.estado === "publicada").length;
  const pendientes = historiasMes.length - publicadas;
  const vencidas = historiasMes.filter(
    (h) => h.estado !== "publicada" && h.fecha_programada < hoyISO,
  ).length;

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

  const marcarPublicada = async (clienteId, fecha, publicada) => {
    const nuevoEstado = publicada ? "publicada" : "pendiente";
    const key = `${clienteId}:${fecha}`;
    const historiasDelDia = historiasPorClienteFecha[key] || [];
    if (historiasDelDia.length === 0) return;

    setGuardandoId(key);
    setHistorias((prev) =>
      prev.map((h) =>
        h.cliente_id === clienteId && h.fecha_programada === fecha
          ? { ...h, estado: nuevoEstado }
          : h,
      ),
    );
    try {
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
      cargar();
    } finally {
      setGuardandoId(null);
    }
  };

  return (
    <>
      <div className="sheet-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button className="btn" type="button" onClick={() => irMes(-1)}>◀</button>
          <strong className="sheet-title">
            {MESES[month]} {year}
          </strong>
          <button className="btn" type="button" onClick={() => irMes(1)}>▶</button>
        </div>
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
                  return sum + items.filter((h) => h.estado === "publicada").length;
                }, 0),
              0,
            );
            const totalPorDia = dias.map((d) =>
              clientes.reduce((sum, c) => {
                const items = historiasPorClienteFecha[`${c.id}:${d.iso}`] || [];
                return sum + items.filter((h) => h.estado === "publicada").length;
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
                      return sum + items.filter((h) => h.estado === "publicada").length;
                    }, 0);

                    return (
                      <tr key={c.id}>
                        <td className="check-client-col">{c.nombre}</td>
                        {dias.map((d) => {
                          const key = `${c.id}:${d.iso}`;
                          const items = historiasPorClienteFecha[key] || [];
                          const hayHistorias = items.length > 0;
                          const publicadasDia = items.filter((h) => h.estado === "publicada").length;
                          const todasPublicadas = hayHistorias && publicadasDia === items.length;
                          const algunasPublicadas = publicadasDia > 0 && publicadasDia < items.length;

                          return (
                            <td
                              key={d.iso}
                              className={[
                                "check-day-cell",
                                !hayHistorias ? "empty" : "",
                                todasPublicadas ? "ok" : "",
                                algunasPublicadas ? "partial" : "",
                              ].join(" ")}
                              title={
                                hayHistorias
                                  ? `${items.length} historia${items.length > 1 ? "s" : ""} · ${publicadasDia} publicada${publicadasDia !== 1 ? "s" : ""}`
                                  : "Sin historias planificadas"
                              }
                            >
                              {hayHistorias ? (
                                <button
                                  type="button"
                                  className="check-sheet-toggle"
                                  disabled={guardandoId === key}
                                  onClick={() => marcarPublicada(c.id, d.iso, !todasPublicadas)}
                                >
                                  {todasPublicadas ? "TRUE" : "FALSE"}
                                </button>
                              ) : (
                                <span className="check-empty"> </span>
                              )}
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

function HistoriasEstructuraTab({ clienteId, clienteNombre }) {
  const [estructura, setEstructura] = useState([]);
  const [fechasEspeciales, setFechasEspeciales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

  useEffect(() => {
    if (!clienteId) return;
    setCargando(true);
    Promise.all([
      fetch("/api/estructura").then((r) => r.json()),
      fetch("/api/fechas-especiales").then((r) => r.json()),
    ])
      .then(([est, fechas]) => {
        setEstructura(est.filter((e) => e.cliente_id === clienteId));
        setFechasEspeciales(
          fechas
            .filter((f) => !f.cliente_id || f.cliente_id === clienteId)
            .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "")),
        );
        setError(null);
      })
      .catch((err) => {
        console.error("No se pudo cargar estructura", err);
        setError("No se pudo cargar la estructura.");
      })
      .finally(() => setCargando(false));
  }, [clienteId]);

  const estructuraPorDia = {};
  estructura.forEach((e) => {
    estructuraPorDia[e.dia_semana] = e;
  });

  const hoyISO = getHoyLocalISO();
  const estadoLabel = { pendiente: "Pendiente", en_curso: "En curso", hecho: "Hecho" };

  if (cargando) {
    return <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando estructura…</div>;
  }

  return (
    <>
      {error && (
        <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      <div className="sheet-frame">
        <div className="sheet-namebar">Estructura base semanal — {clienteNombre}</div>
        <table className="sheet-table">
          <thead>
            <tr>
              <th style={{ width: "120px" }}>Día</th>
              <th style={{ width: "110px" }}>Tipo</th>
              <th>Tema</th>
              <th style={{ width: "22%" }}>Horario</th>
              <th style={{ width: "22%" }}>CTA fijo</th>
            </tr>
          </thead>
          <tbody>
            {NOMBRES_DIA.map((dia, idx) => {
              const est = estructuraPorDia[idx];
              return (
                <tr key={idx}>
                  <td style={{ padding: "8px 10px", fontWeight: "600" }}>{dia}</td>
                  <td style={{ padding: "8px 10px" }}>{est?.tipo || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{est?.tema || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{est?.horario || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{est?.cta_fijo || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="caption" style={{ marginTop: "10px", marginBottom: "18px" }}>
        → Patrón base de cada día de la semana. Al agregar una historia nueva en
        la Planilla, el tipo y horario de este día se sugieren solos.
      </div>

      <div className="sheet-frame">
        <div className="sheet-namebar">Fechas especiales próximas</div>
        {fechasEspeciales.length === 0 ? (
          <div style={{ color: "#999", textAlign: "center", padding: "20px" }}>No hay fechas especiales registradas.</div>
        ) : (
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{ width: "110px" }}>Fecha</th>
                <th>Evento</th>
                <th style={{ width: "110px" }}>Estado</th>
                <th>Idea</th>
              </tr>
            </thead>
            <tbody>
              {fechasEspeciales.map((f) => (
                <tr key={f.id} className={f.fecha && f.fecha < hoyISO && f.estado !== "hecho" ? "sheet-row-danger" : undefined}>
                  <td style={{ padding: "8px 10px" }}>{f.fecha || "Sin fecha"}</td>
                  <td style={{ padding: "8px 10px" }}>{f.evento}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span className="sheet-status-pill" style={{ background: f.estado === "hecho" ? "#c8e6c9" : f.estado === "en_curso" ? "#fff9c4" : "#ffccbc" }}>
                      {estadoLabel[f.estado] || f.estado}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px" }}>{f.idea || "—"}</td>
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

function HistoriasPage({ initialTab = "planilla" }) {
  const [vista, setVista] = useState(
    ["checklist", "estructura"].includes(initialTab) ? initialTab : "planilla",
  );
  const [clientes, setClientes] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [errorClientes, setErrorClientes] = useState(null);
  const [refrescarKey, setRefrescarKey] = useState(0);

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

  const clienteNombre =
    clientes.find((c) => c.id === clienteSeleccionado)?.nombre || "";

  return (
    <main aria-label="Render platform historias" className="historias-viewport">
      <div className="frame">
          <div className="topbar">
            <div className="logo-box">[ LOGO RENDER ]</div>
            <div className="nav">
              <span className="active">Planificación de historias</span>
            </div>
          <div className="tag">Planilla mensual</div>
          </div>

        <div className="content">
          {errorClientes && (
            <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
              {errorClientes}
            </div>
          )}

          <FlyersMigrarBanner onMigrado={() => setRefrescarKey((k) => k + 1)} />

          <div className="sheet-view-tabs">
            <button
              type="button"
              className={vista === "planilla" ? "active" : ""}
              onClick={() => setVista("planilla")}
            >
              Planilla mensual
            </button>
            <button
              type="button"
              className={vista === "checklist" ? "active" : ""}
              onClick={() => setVista("checklist")}
            >
              Checklist publicadas
            </button>
            <button
              type="button"
              className={vista === "estructura" ? "active" : ""}
              onClick={() => setVista("estructura")}
            >
              Estructura
            </button>
          </div>

          {(vista === "planilla" || vista === "estructura") && (
            <div style={{ display: "flex", gap: "4px", overflowX: "auto", borderBottom: "2px solid #ddd", marginBottom: "16px", paddingBottom: "0" }}>
              {clientes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setClienteSeleccionado(c.id)}
                  style={{
                    padding: "8px 18px",
                    border: "none",
                    borderBottom: clienteSeleccionado === c.id ? "3px solid #1a73e8" : "3px solid transparent",
                    background: clienteSeleccionado === c.id ? "#e8f0fe" : "transparent",
                    color: clienteSeleccionado === c.id ? "#1a73e8" : "#555",
                    fontWeight: clienteSeleccionado === c.id ? "700" : "500",
                    fontSize: "13px",
                    cursor: "pointer",
                    borderRadius: "6px 6px 0 0",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
          )}

          {clienteSeleccionado && vista === "planilla" && (
            <HistoriasPlanillaTab
              key={`p-${clienteSeleccionado}-${refrescarKey}`}
              clienteId={clienteSeleccionado}
              clienteNombre={clienteNombre}
            />
          )}

          {clienteSeleccionado && vista === "estructura" && (
            <HistoriasEstructuraTab
              key={`e-${clienteSeleccionado}`}
              clienteId={clienteSeleccionado}
              clienteNombre={clienteNombre}
            />
          )}

          {vista === "checklist" && (
            <HistoriasChecklistPublicadasTab
              key={`c-${refrescarKey}`}
              clientes={clientes}
            />
          )}
        </div>
      </div>
    </main>
  );
}

// ── REPORTES DE EQUIPO: rendimiento por empleado ──────────────────────────────

function ReportesEquipoPage() {
  const [tareas, setTareas] = useState([]);
  const [historias, setHistorias] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [periodo, setPeriodo] = useState("mes_actual");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [detalleDe, setDetalleDe] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/tareas").then((r) => r.json()),
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
  }, []);

  const hoyISO = getHoyLocalISO();
  const ahora = new Date();

  const rangoPeriodo = (() => {
    const pad = (n) => String(n).padStart(2, "0");
    if (periodo === "mes_actual") {
      const desde = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-01`;
      const sig = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
      const hasta = `${sig.getFullYear()}-${pad(sig.getMonth() + 1)}-01`;
      return { desde, hasta, dias: new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate() };
    }
    if (periodo === "mes_pasado") {
      const prev = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      const desde = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`;
      const hasta = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-01`;
      return { desde, hasta, dias: new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate() };
    }
    const d30 = new Date(ahora);
    d30.setDate(d30.getDate() - 30);
    const desde = `${d30.getFullYear()}-${pad(d30.getMonth() + 1)}-${pad(d30.getDate())}`;
    return { desde, hasta: "9999-12-31", dias: 30 };
  })();

  const enPeriodo = (fechaISO) =>
    typeof fechaISO === "string" &&
    fechaISO.slice(0, 10) >= rangoPeriodo.desde &&
    fechaISO.slice(0, 10) < rangoPeriodo.hasta;

  const nombresConTareas = [...new Set(tareas.map((t) => t.asignado_a).filter(Boolean))];
  const nombresUsuarios = usuarios
    .filter((u) => u.rol !== "admin" || nombresConTareas.includes(u.nombre))
    .map((u) => u.nombre);
  const empleados = [...new Set([...nombresUsuarios, ...nombresConTareas])];

  const filas = empleados.map((nombre) => {
    const propias = tareas.filter((t) => t.asignado_a === nombre);
    const activas = propias.filter((t) => t.estado !== "hecha");
    const bloqueadas = propias.filter((t) => t.estado === "bloqueada");
    const atrasadas = activas.filter(
      (t) => t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
    );
    const terminadasPeriodo = propias.filter(
      (t) => t.estado === "hecha" && enPeriodo(t.updated_at || ""),
    );
    const vencianEnPeriodo = propias.filter(
      (t) => t.fecha_vencimiento && enPeriodo(t.fecha_vencimiento),
    );
    const vencidasHechas = vencianEnPeriodo.filter((t) => t.estado === "hecha");
    const cumplimiento =
      vencianEnPeriodo.length > 0
        ? Math.round((vencidasHechas.length / vencianEnPeriodo.length) * 100)
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

    return {
      nombre,
      rol,
      carga: activas.length,
      terminadas: terminadasPeriodo.length,
      atrasadas,
      bloqueadas: bloqueadas.length,
      cumplimiento,
      tiempoPromedio,
      productividad,
    };
  });

  const filasOrdenadas = [...filas].sort((a, b) => b.carga - a.carga);

  const totales = {
    activas: filas.reduce((s, f) => s + f.carga, 0),
    terminadas: filas.reduce((s, f) => s + f.terminadas, 0),
    atrasadas: filas.reduce((s, f) => s + f.atrasadas.length, 0),
    bloqueadas: filas.reduce((s, f) => s + f.bloqueadas, 0),
  };

  const piezasPorResponsable = empleados
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
    .sort((a, b) => b.total - a.total);

  const PERIODOS = [
    { id: "mes_actual", label: "Este mes" },
    { id: "mes_pasado", label: "Mes pasado" },
    { id: "ultimos_30", label: "Últimos 30 días" },
  ];

  const cardStyle = { padding: "16px", borderRadius: "8px", textAlign: "center" };

  return (
    <main aria-label="Render platform reportes equipo">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Reportes</span>
          </div>
          <div className="tag">Rendimiento del equipo</div>
        </div>

        <div className="content">
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
              <div className="section-label">1 · Salud del equipo — vista rápida</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "24px" }}>
                <div style={{ ...cardStyle, background: "#e3f2fd" }}>
                  <div style={{ fontSize: "26px", fontWeight: "700", color: "#1565c0" }}>{totales.activas}</div>
                  <div style={{ fontSize: "12px", color: "#1565c0" }}>Tareas activas</div>
                </div>
                <div style={{ ...cardStyle, background: "#e8f5e9" }}>
                  <div style={{ fontSize: "26px", fontWeight: "700", color: "#2e7d32" }}>{totales.terminadas}</div>
                  <div style={{ fontSize: "12px", color: "#2e7d32" }}>Terminadas en el período</div>
                </div>
                <div style={{ ...cardStyle, background: "#fff3e0" }}>
                  <div style={{ fontSize: "26px", fontWeight: "700", color: "#e65100" }}>{totales.atrasadas}</div>
                  <div style={{ fontSize: "12px", color: "#e65100" }}>Atrasadas hoy</div>
                </div>
                <div style={{ ...cardStyle, background: "#ffebee" }}>
                  <div style={{ fontSize: "26px", fontWeight: "700", color: "#c62828" }}>{totales.bloqueadas}</div>
                  <div style={{ fontSize: "12px", color: "#c62828" }}>Bloqueadas</div>
                </div>
              </div>

              <div className="section-label">2 · Rendimiento por empleado</div>
              <div className="box" style={{ padding: 0, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "820px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #333", background: "#fafafa" }}>
                      <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: "600", fontSize: "12px" }}>Empleado</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Carga actual</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Terminadas</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Atrasadas</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Bloqueadas</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Cumplimiento</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Tiempo prom.</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Ritmo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasOrdenadas.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "#999" }}>
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
                          <td style={{ padding: "10px", textAlign: "center", fontWeight: "600" }}>{f.carga}</td>
                          <td style={{ padding: "10px", textAlign: "center", color: "#2e7d32", fontWeight: "600" }}>{f.terminadas}</td>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            {f.atrasadas.length > 0 ? (
                              <span style={{ background: "#fff3e0", color: "#e65100", padding: "2px 8px", borderRadius: "10px", fontWeight: "700", fontSize: "12px" }}>
                                {f.atrasadas.length} ▾
                              </span>
                            ) : (
                              <span style={{ color: "#bbb" }}>0</span>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            {f.bloqueadas > 0 ? (
                              <span style={{ background: "#ffebee", color: "#c62828", padding: "2px 8px", borderRadius: "10px", fontWeight: "700", fontSize: "12px" }}>
                                {f.bloqueadas}
                              </span>
                            ) : (
                              <span style={{ color: "#bbb" }}>0</span>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            {f.cumplimiento === null ? (
                              <span style={{ color: "#bbb", fontSize: "12px" }}>Sin venc.</span>
                            ) : (
                              <>
                                <div style={{ display: "inline-block", width: "56px", height: "6px", background: "#e0e0e0", borderRadius: "3px", overflow: "hidden", verticalAlign: "middle" }}>
                                  <div
                                    style={{
                                      width: `${f.cumplimiento}%`,
                                      height: "100%",
                                      background: f.cumplimiento >= 80 ? "#4caf50" : f.cumplimiento >= 50 ? "#ff9800" : "#f44336",
                                    }}
                                  />
                                </div>
                                <div style={{ fontSize: "11px", marginTop: "2px", fontWeight: "600" }}>{f.cumplimiento}%</div>
                              </>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>
                            {f.tiempoPromedio !== null ? `${f.tiempoPromedio} días` : <span style={{ color: "#bbb" }}>—</span>}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>
                            {f.productividad} /sem
                          </td>
                        </tr>
                        {detalleDe === f.nombre &&
                          f.atrasadas.map((t) => (
                            <tr key={`det-${t.id}`} style={{ background: "#fffde7", borderBottom: "1px solid #f0f0f0" }}>
                              <td colSpan={8} style={{ padding: "6px 12px 6px 32px", fontSize: "12px", color: "#795548" }}>
                                ⏰ <strong>{t.titulo}</strong>
                                {t.cliente_nombre ? ` · ${t.cliente_nombre}` : ""} · vencía {t.fecha_vencimiento} ·{" "}
                                {t.estado === "bloqueada" ? "bloqueada" : "en curso"}
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="caption" style={{ marginTop: "8px", marginBottom: "20px" }}>
                Cumplimiento = tareas que vencían en el período y fueron terminadas. Ritmo = tareas terminadas por semana. Click en una fila con atrasadas para ver el detalle.
              </div>

              <div className="section-label">3 · Piezas asignadas por responsable</div>
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

function PublicacionesPlanillaTab({ clienteId, clienteNombre }) {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());
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

  const publicadas = filasVisibles.filter((p) => p.estado === "publicada").length;

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button className="btn" type="button" onClick={() => irMes(-1)}>◀</button>
          <strong style={{ fontSize: "16px", minWidth: "160px", textAlign: "center" }}>
            {MESES[month]} {year}
          </strong>
          <button className="btn" type="button" onClick={() => irMes(1)}>▶</button>
        </div>
        <div style={{ display: "flex", gap: "8px", fontSize: "12px" }}>
          <span style={{ padding: "4px 10px", background: "#eceff1", borderRadius: "12px" }}>
            {filasVisibles.length} planificadas
          </span>
          <span style={{ padding: "4px 10px", background: "#e8f5e9", color: "#2e7d32", borderRadius: "12px" }}>
            {publicadas} publicadas
          </span>
          <span style={{ padding: "4px 10px", background: "#fff3e0", color: "#e65100", borderRadius: "12px" }}>
            {filasVisibles.length - publicadas} pendientes
          </span>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando planilla…</div>
      ) : (
        <div className="box" style={{ padding: 0, overflow: "auto", maxHeight: "70vh" }} ref={gridRef}>
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

  const irAPlanillaDeCliente = (clienteId) => {
    setClienteSeleccionado(clienteId);
    setTabPrincipal("planilla");
  };

  const clienteActual = clientes.find((c) => c.id === clienteSeleccionado);

  const TABS_PRINCIPALES = [
    { id: "calendario", label: "Calendario" },
    { id: "lista", label: "Control" },
  ];

  return (
    <main aria-label="Render platform publicaciones">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Planificación de publicaciones</span>
          </div>
          <div className="tag">Calendario y control</div>
        </div>

        <div className="content">
          {errorClientes && (
            <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
              {errorClientes}
            </div>
          )}

          <div className="tabs" style={{ marginBottom: "16px" }}>
            {TABS_PRINCIPALES.map((t) => (
              <span
                key={t.id}
                className={tabPrincipal === t.id ? "active" : ""}
                onClick={() => setTabPrincipal(t.id)}
                style={{ cursor: "pointer" }}
              >
                {t.label}
              </span>
            ))}
          </div>

          {tabPrincipal === "calendario" && (
            <PublicacionesCalendarioTab onIrAPlanilla={irAPlanillaDeCliente} />
          )}

          {tabPrincipal === "lista" && (
            <PublicacionesGeneralTab clientes={clientes} onIrACliente={irAPlanillaDeCliente} />
          )}

          {tabPrincipal === "planilla" && (
            <>
              <div style={{ display: "flex", gap: "4px", overflowX: "auto", borderBottom: "2px solid #ddd", marginBottom: "16px", paddingBottom: "0" }}>
                {clientes.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setClienteSeleccionado(c.id)}
                    style={{
                      padding: "8px 18px",
                      border: "none",
                      borderBottom: clienteSeleccionado === c.id ? "3px solid #1a73e8" : "3px solid transparent",
                      background: clienteSeleccionado === c.id ? "#e8f0fe" : "transparent",
                      color: clienteSeleccionado === c.id ? "#1a73e8" : "#555",
                      fontWeight: clienteSeleccionado === c.id ? "700" : "500",
                      fontSize: "13px",
                      cursor: "pointer",
                      borderRadius: "6px 6px 0 0",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.nombre}
                  </button>
                ))}
              </div>

              {clienteActual && (
                <PublicacionesPlanillaTab
                  key={`pub-${clienteSeleccionado}`}
                  clienteId={clienteSeleccionado}
                  clienteNombre={clienteActual.nombre}
                />
              )}
            </>
          )}
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
