import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// TEMPORAL — reemplazar cuando exista tabla de historias/publicaciones/tareas.
const piezasDetalleClienteDemo = [
  {
    pieza: "Historia — Catálogo semanal",
    responsable: "Augusto",
    estado: "Bloqueada (falta material)",
  },
  {
    pieza: "Reel — Producto destacado",
    responsable: "Augusto",
    estado: "Pendiente",
  },
  {
    pieza: "Reel — Producto destacado #2",
    responsable: "Augusto",
    estado: "Pendiente",
  },
];

// TEMPORAL — reemplazar cuando exista tabla de historias/publicaciones/tareas.
const piezasDestrabadasFrancoDemo = [
  {
    cliente: "Bendita",
    pieza: "Historia — Nuevo producto",
    dudaResuelta: "Confirmó copy final a Augusto",
  },
];

// TEMPORAL — reemplazar cuando exista tabla de historias/publicaciones/tareas.
const escaladosAgustinFrancoDemo = [
  {
    cliente: "RPM Chevrolet",
    pieza: "Duda comercial sobre promo",
    estado: "Escalado hoy · esperando respuesta de Agustín",
  },
];

// TEMPORAL — reemplazar cuando exista tabla de publicaciones.
const avanceAugustoDemo = {
  feed: 64,
};

// TEMPORAL — reemplazar cuando exista tabla de tareas.
const proximosLucianoDemo = [
  {
    cliente: "Moketa",
    pieza: "Reel producto destacado",
    vencimiento: "Publica hoy",
    tag: "Requiere aprobación de Franco",
    requiereAprobacion: true,
  },
  {
    cliente: "Luzin",
    pieza: "Reel novedades julio",
    vencimiento: "Publica mañana",
    tag: "No requiere aprobación",
    requiereAprobacion: false,
  },
];

// TEMPORAL — reemplazar cuando exista tabla de tareas.
const tableroLucianoDemo = [
  {
    estado: "Pendiente",
    tareas: [
      {
        cliente: "RPM Chevrolet",
        pieza: "Reel testimonio",
        tag: "No requiere aprobación",
        requiereAprobacion: false,
      },
      {
        cliente: "Bendita",
        pieza: "Reel producto nuevo",
        tag: "Requiere aprobación",
        requiereAprobacion: true,
      },
    ],
  },
  {
    estado: "En progreso",
    tareas: [
      {
        cliente: "Litoral Maq",
        pieza: "Reel institucional",
        detalle: "Editando ahora",
      },
    ],
  },
  {
    estado: "Corrección",
    tareas: [
      {
        cliente: "Capital Motos",
        pieza: "Reel 0km",
        tag: "Nota de Franco",
        requiereAprobacion: true,
      },
    ],
  },
];

// TEMPORAL — reemplazar cuando exista tabla de tareas.
const avanceLucianoDemo = {
  editados: 34,
  objetivo: 48,
};

// TEMPORAL — reemplazar cuando exista tabla de tareas.
const produccionesGermanDemo = [
  {
    cliente: "Lavalle Market",
    pieza: "Fotos de producto (3 destacados)",
    estado: "Pedido por Augusto · sin fecha coordinada todavía",
    abreModal: true,
  },
  {
    cliente: "RPM Chevrolet",
    pieza: "Video testimonio cliente",
    estado: "Coordinado para el jueves (fuera de la plataforma, por WhatsApp)",
    abreModal: false,
  },
  {
    cliente: "Litoral Maq",
    pieza: "Fotos de maquinaria nueva",
    tag: "Bloqueada: falta acceso al predio",
    abreModal: false,
  },
];

// TEMPORAL — reemplazar cuando exista tabla de tareas.
const avanceGermanDemo = {
  entregadas: 9,
  objetivo: 14,
};

// TEMPORAL — reemplazar cuando exista tabla de historias/publicaciones.
const calendarioOrianaDemo = [
  {
    hora: "09:00",
    cliente: "Luzin",
    pieza: "Historia novedades",
    tag: "Lista para subir",
    estado: "lista",
    abreModal: true,
  },
  {
    hora: "11:00",
    cliente: "RPM Chevrolet",
    pieza: "Reel promo permuta",
    tag: "Bloqueada: falta check de precio",
    estado: "bloqueada",
    abreModal: false,
  },
  {
    hora: "14:00",
    cliente: "Moketa",
    pieza: "Carrusel catálogo",
    tag: "Ya publicada 09:15",
    estado: "publicada",
    abreModal: false,
  },
];

// TEMPORAL — reemplazar cuando exista tabla de historias/publicaciones.
const bloqueadasOrianaDemo = [
  {
    cliente: "RPM Chevrolet",
    pieza: "Reel promo permuta",
    estado: "Bloqueada por Oriana: precio sin confirmar · avisado a Augusto",
  },
];

// TEMPORAL — reemplazar cuando exista tabla de historias/publicaciones.
const avanceOrianaDemo =
  "Subidas hoy: 1 / 6 — 1 bloqueada, 4 pendientes de horario";

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
  reel: "Reel",
  carrusel: "Carrusel",
  flyer: "Flyer",
  video: "Video",
};

function getTipoPublicacionLabel(tipo) {
  return TIPO_PUBLICACION_LABELS[tipo] || "Reel";
}

function getHistoriasAugustoKanban(historias) {
  const columnas = [
    { estado: "Pendiente", historias: [] },
    { estado: "En progreso", historias: [] },
    { estado: "Corrección", historias: [] },
  ];
  const columnasPorEstado = Object.fromEntries(
    columnas.map((columna) => [columna.estado, columna]),
  );

  historias.forEach((historia) => {
    if (historia.estado === "en_revision" || historia.estado === "lista") {
      columnasPorEstado["En progreso"].historias.push(historia);
      return;
    }

    if (
      historia.estado === "pendiente" ||
      historia.estado === "en_diseño" ||
      historia.estado === "bloqueada"
    ) {
      columnasPorEstado.Pendiente.historias.push(historia);
    }
  });

  return columnas;
}

function getPorcentajeHistoriasPublicadas(historias) {
  if (historias.length === 0) {
    return "0.0";
  }

  const publicadas = historias.filter(
    (historia) => historia.estado === "publicada",
  ).length;

  return ((publicadas / historias.length) * 100).toFixed(1);
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
    <main aria-label="Render platform login">
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Iniciar sesión</span>
          </div>
        </div>

        <div className="content">
          <div className="section-label">Ingresá con tu usuario</div>
          <div className="box">
            <form onSubmit={handleSubmit} className="login-form">
              <label className="login-field">
                <span className="detail-label">Usuario</span>
                <input
                  type="text"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label className="login-field">
                <span className="detail-label">Contraseña</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              {error && <div className="caption login-error">{error}</div>}

              <button className="btn primary" type="submit" disabled={cargando}>
                {cargando ? "Ingresando..." : "Ingresar"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

function NuevaTareaPage() {
  const [clientes, setClientes] = useState([]);
  const [titulo, setTitulo] = useState("");
  const [asignadoA, setAsignadoA] = useState("Augusto");
  const [clienteId, setClienteId] = useState("");
  const [estado, setEstado] = useState("pendiente");
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
        setRequiereAprobacion(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setEnviando(false));
  };

  return (
    <main aria-label="Render platform nueva tarea">
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Nueva tarea</span>
            <a href="/">Home</a>
          </div>
        </div>

        <div className="content">
          <div className="section-label">Cargar tarea y asignar responsable</div>
          <div className="box">
            <form onSubmit={handleSubmit} className="login-form">
              <label className="login-field">
                <span className="detail-label">Título</span>
                <input
                  type="text"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  required
                />
              </label>

              <label className="login-field">
                <span className="detail-label">Cliente (opcional)</span>
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

              <label className="login-field">
                <span className="detail-label">Responsable</span>
                <select
                  value={asignadoA}
                  onChange={(e) => setAsignadoA(e.target.value)}
                >
                  <option value="Agustín">Agustín</option>
                  <option value="Franco">Franco</option>
                  <option value="Augusto">Augusto</option>
                  <option value="Luciano">Luciano</option>
                  <option value="Germán">Germán</option>
                  <option value="Oriana">Oriana</option>
                </select>
              </label>

              <label
                className="login-field"
                style={{ flexDirection: "row", alignItems: "center", gap: "8px" }}
              >
                <input
                  type="checkbox"
                  checked={requiereAprobacion}
                  onChange={(e) => setRequiereAprobacion(e.target.checked)}
                />
                <span className="detail-label">Requiere aprobación de Franco</span>
              </label>

              {error && <div className="caption login-error">{error}</div>}
              {mensaje && <div className="caption">{mensaje}</div>}

              <button className="btn primary" type="submit" disabled={enviando}>
                {enviando ? "Creando..." : "Crear tarea"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

function TareasAsignadasGenericas({ nombre }) {
  const [tareas, setTareas] = useState([]);
  const [error, setError] = useState(null);
  const sesion = getSesion();
  const esAdmin = sesion?.usuario?.rol === "admin";

  const cargarTareas = () => {
    fetch("/api/tareas")
      .then((response) => response.json())
      .then((todas) => {
        setTareas(todas.filter((tarea) => tarea.asignado_a === nombre));
      })
      .catch(() => setError("No se pudieron cargar las tareas asignadas."));
  };

  useEffect(() => {
    cargarTareas();
  }, [nombre]);

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
      <div className="section-label">
        Tareas asignadas (cargadas desde la plataforma)
      </div>
      <div className="box">
        {error && <div className="caption">{error}</div>}
        {!error &&
          tareas.map((tarea) => {
            const bloqueaCierre = tarea.requiere_aprobacion && !esAdmin;

            return (
              <div className="card" key={`tarea-generica-${tarea.id}`}>
                <div className="cliente">
                  {tarea.cliente_nombre ?? "Sin cliente"}
                </div>
                <div>{tarea.titulo}</div>
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
          <div className="caption">No hay tareas cargadas asignadas.</div>
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

function App() {
  const path = window.location.pathname;
  const sesion = getSesion();

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
  const rutasCompartidas = ["/", "/calendario", "/perfil"];
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
    if (path === "/calendario") {
      return <CalendarioPage />;
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
    return <HomePage />;
  })();

  return (
    <>
      {dashboard}
      <div className="session-bar">
        <span className="caption">
          {sesion.usuario.nombre} · {sesion.usuario.rol}
        </span>
        <div className="session-bar-links">
          <a className="btn" href="/">
            Home
          </a>
          {esAdmin && (
            <a className="btn" href="/nueva-tarea">
              + Nueva tarea
            </a>
          )}
          <button className="btn" type="button" onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </div>
      </div>
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
      titulo: "Calendario",
      desc: "Cuándo se publica cada pieza",
      href: "/calendario",
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

function CalendarioPage() {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());
  const [piezas, setPiezas] = useState([]);
  const [error, setError] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [piezaSel, setPiezaSel] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/historias").then((r) => r.json()),
      fetch("/api/publicaciones").then((r) => r.json()),
    ])
      .then(([historias, publicaciones]) => {
        setPiezas([
          ...historias.map((h) => ({
            ...h,
            origen: "historia",
            tipo: "historia",
            tipoLabel: "Historia",
          })),
          ...publicaciones.map((p) => ({
            ...p,
            origen: "publicacion",
            tipoLabel: getTipoPublicacionLabel(p.tipo),
          })),
        ]);
      })
      .catch((err) => {
        console.error("No se pudo cargar el calendario", err);
        setError("No se pudo cargar el calendario.");
      });
  }, []);

  const piezasFiltradas = piezas.filter((pz) => {
    if (filtroTipo === "todos") return true;
    if (filtroTipo === "historia") return pz.origen === "historia";
    return pz.tipo === filtroTipo;
  });

  const porFecha = {};
  piezasFiltradas.forEach((pz) => {
    if (!pz.fecha_programada) return;
    (porFecha[pz.fecha_programada] = porFecha[pz.fecha_programada] || []).push(pz);
  });

  const semanas = getGrillaMes(year, month);
  const hoyISO = getHoyLocalISO();

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
    { key: "historia", label: "Historias" },
    { key: "reel", label: "Reels" },
    { key: "carrusel", label: "Carruseles" },
    { key: "flyer", label: "Flyers" },
    { key: "video", label: "Videos" },
  ];

  return (
    <main aria-label="Render platform calendario">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Calendario</span>
          </div>
          <div className="tag">Publicaciones e historias</div>
        </div>

        <div className="content">
          <div className="cal-toolbar">
            <button className="btn" type="button" onClick={() => irMes(-1)}>
              ◀ Mes anterior
            </button>
            <span className="cal-title">
              {MESES[month]} {year}
            </span>
            <button className="btn" type="button" onClick={() => irMes(1)}>
              Mes siguiente ▶
            </button>
          </div>

          <div className="tabs">
            {filtros.map((f) => (
              <span
                key={f.key}
                className={filtroTipo === f.key ? "active" : ""}
                onClick={() => setFiltroTipo(f.key)}
              >
                {f.label}
              </span>
            ))}
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
                return (
                  <div
                    className={`cal-cell ${iso === hoyISO ? "today" : ""}`}
                    key={`${si}-${di}`}
                  >
                    <div className="cal-daynum">{dia}</div>
                    {items.map((pz) => (
                      <div
                        className={`cal-chip ${pz.estado}`}
                        key={`${pz.origen}-${pz.id}`}
                        onClick={() => setPiezaSel(pz)}
                        title={`${pz.tipoLabel} · ${pz.cliente_nombre} · ${getEstadoHistoriaLabel(
                          pz.estado,
                        )}`}
                      >
                        {pz.tipoLabel[0]} · {pz.cliente_nombre}
                      </div>
                    ))}
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
            → Cada casilla muestra las piezas programadas ese día. La inicial
            indica el tipo (H istoria, R eel, C arrusel, F lyer, V ideo).
          </div>
        </div>
      </div>

      {piezaSel && (
        <CalendarioPiezaModal pieza={piezaSel} onClose={() => setPiezaSel(null)} />
      )}
    </main>
  );
}

function CalendarioPiezaModal({ pieza, onClose }) {
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
          <div className="detail-grid">
            <div className="detail-field">
              <div className="detail-label">Tipo</div>
              <div>{pieza.tipoLabel}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Estado</div>
              <div>{getEstadoHistoriaLabel(pieza.estado)}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Fecha programada</div>
              <div>{pieza.fecha_programada}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Responsable</div>
              <div>{pieza.responsable}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PerfilPage() {
  return (
    <main aria-label="Render platform perfil">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Mi perfil</span>
          </div>
        </div>
        <div className="content">
          <div className="box">
            <div className="caption">Perfil en construcción.</div>
          </div>
        </div>
      </div>
    </main>
  );
}

function EmpleadosPage() {
  return (
    <main aria-label="Render platform empleados">
      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Empleados</span>
          </div>
        </div>
        <div className="content">
          <div className="box">
            <div className="caption">Gestión de empleados en construcción.</div>
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
  const piezasHoy = piezasOriana.filter(
    (pieza) => pieza.fecha_programada === hoy,
  );
  const bloqueadas = piezasOriana.filter(
    (pieza) => pieza.estado === "bloqueada",
  );
  const publicadasHoy = piezasHoy.filter(
    (pieza) => pieza.estado === "publicada",
  ).length;

  return (
    <main aria-label="Render platform Oriana">
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

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
                    <div>{pieza.metadata?.Idea || "Sin idea cargada"}</div>
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
              → Oriana ve primero el calendario del día y qué piezas ya están
              listas, bloqueadas o publicadas.
            </div>
          </div>

          <div className="section-label">2 · Piezas bloqueadas por corrección</div>
          <div className="box">
            {bloqueadas.map((pieza) => (
              <div
                className="priority-card blocked"
                key={`bloqueada-${pieza.origen}-${pieza.id}`}
              >
                <div className="cliente">{pieza.cliente_nombre}</div>
                <div>{pieza.metadata?.Idea || "Sin idea cargada"}</div>
                <div className="meta">
                  {pieza.metadata?.Aclaración || "Sin aclaración cargada"}
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

          <div className="section-label">3 · Avance del día</div>
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
            {publicacion.metadata?.Idea || "Sin idea cargada"}
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
  const entregadas = tareasGerman.filter(
    (tarea) => tarea.estado === "hecha",
  ).length;

  return (
    <main aria-label="Render platform German">
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

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

          <div className="section-label">3 · Avance del mes</div>
          <div className="box">
            <div className="progress-card">
              <div className="progress-label">
                Producciones entregadas este mes
              </div>
              <div className="progress-value">
                {entregadas} / {tareasGerman.length}
              </div>
            </div>
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
      <TareasAsignadasGenericas nombre="Germán" />
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
  const [piezaSeleccionada, setPiezaSeleccionada] = useState(null);
  const [publicacionesLuciano, setPublicacionesLuciano] = useState([]);
  const [publicacionesLucianoError, setPublicacionesLucianoError] =
    useState(null);

  useEffect(() => {
    fetch("/api/publicaciones")
      .then((response) => response.json())
      .then((publicaciones) => {
        setPublicacionesLuciano(
          publicaciones
            .filter((publicacion) => publicacion.responsable === "Luciano")
            .sort((a, b) =>
              a.fecha_programada < b.fecha_programada ? -1 : 1,
            ),
        );
      })
      .catch((error) => {
        console.error(
          "No se pudieron cargar las publicaciones de Luciano",
          error,
        );
        setPublicacionesLucianoError(
          "No se pudieron cargar las publicaciones.",
        );
      });
  }, []);

  const reelsLuciano = publicacionesLuciano.filter(
    (publicacion) => publicacion.tipo === "reel",
  );
  const reelsPublicados = reelsLuciano.filter(
    (publicacion) => publicacion.estado === "publicada",
  ).length;

  return (
    <main aria-label="Render platform Luciano">
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Mis reels</span>
            <span>Clientes</span>
          </div>
          <div className="tag">Luciano · edición</div>
        </div>

        <div className="content">
          <div className="section-label">1 · Próximo a publicar</div>
          <div className="box">
            {publicacionesLucianoError && (
              <div className="caption">{publicacionesLucianoError}</div>
            )}
            {!publicacionesLucianoError &&
              publicacionesLuciano.map((publicacion) => {
                const requiereAprobacion =
                  publicacion.estado === "en_revision";

                return (
                  <div
                    className={`priority-card ${
                      requiereAprobacion ? "blocked" : ""
                    }`}
                    key={publicacion.id}
                    onClick={() => {
                      if (requiereAprobacion) {
                        setPiezaSeleccionada(publicacion);
                      }
                    }}
                  >
                    <div className="cliente">
                      {publicacion.cliente_nombre}
                    </div>
                    <div>
                      {publicacion.metadata?.Idea || "Sin idea cargada"}
                    </div>
                    <div className="meta">{publicacion.fecha_programada}</div>
                    <div className="meta">
                      <span
                        className={`tag ${
                          requiereAprobacion ? "creativa" : "operativa"
                        }`}
                      >
                        {requiereAprobacion
                          ? "Requiere aprobación de Franco"
                          : "No requiere aprobación"}
                      </span>
                    </div>
                  </div>
                );
              })}
            {!publicacionesLucianoError &&
              publicacionesLuciano.length === 0 && (
                <div className="caption">
                  No hay publicaciones asignadas a Luciano.
                </div>
              )}
            <div className="caption">
              → Primero ve lo que está cerca de publicarse y si necesita
              aprobación antes de salir.
            </div>
          </div>

          <div className="section-label">2 · Tablero por estado</div>
          <div className="box">
            <div className="kanban">
              {getPublicacionesKanban(publicacionesLuciano).map((columna) => (
                <div className="kanban-column" key={columna.estado}>
                  <div className="kanban-header">
                    <span>{columna.estado}</span>
                    <span>{columna.publicaciones.length}</span>
                  </div>

                  {columna.publicaciones.map((publicacion) => (
                    <div className="card" key={`kanban-${publicacion.id}`}>
                      <div className="cliente">
                        {publicacion.cliente_nombre}
                      </div>
                      <div>
                        {publicacion.metadata?.Idea || "Sin idea cargada"}
                      </div>
                      <div className="meta">
                        {publicacion.estado === "bloqueada" ? (
                          publicacion.metadata?.Aclaración ||
                          "Sin aclaración cargada"
                        ) : (
                          <span
                            className={`tag ${
                              publicacion.estado === "en_revision"
                                ? "creativa"
                                : "operativa"
                            }`}
                          >
                            {getEstadoHistoriaLabel(publicacion.estado)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="caption">
              → Vista por estado para separar lo pendiente, lo que está en
              edición y lo que volvió con corrección.
            </div>
          </div>

          <div className="section-label">3 · Avance del mes</div>
          <div className="box">
            <div className="progress-card">
              <div className="progress-label">Reels editados este mes</div>
              <div className="progress-value">
                {reelsPublicados} / {reelsLuciano.length}
              </div>
            </div>
            <div className="caption">
              → Conteo real de reels de Luciano ya publicados sobre el total
              asignado.
            </div>
          </div>
        </div>
      </div>

      {piezaSeleccionada && (
        <TareaAprobacionPendienteModal
          tarea={piezaSeleccionada}
          onClose={() => setPiezaSeleccionada(null)}
        />
      )}
      <TareasAsignadasGenericas nombre="Luciano" />
    </main>
  );
}

function TareaAprobacionPendienteModal({ tarea, onClose }) {
  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <span>
            {tarea.cliente_nombre} · {tarea.metadata?.Idea || "Sin idea cargada"}
          </span>
          <button className="modal-close" type="button" onClick={onClose}>
            X
          </button>
        </div>
        <div className="modal-body">
          <span className="tag creativa">Requiere aprobación de Franco</span>

          <div className="detail-grid">
            <div className="detail-field">
              <div className="detail-label">Estado actual</div>
              <div>{getEstadoHistoriaLabel(tarea.estado)}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Material</div>
              <div>{tarea.metadata?.Material || "Sin material cargado"}</div>
            </div>
          </div>

          <div className="modal-actions">
            {/* Luciano no puede cerrar esta pieza hasta que Franco la apruebe. */}
            <button
              className="btn disabled"
              disabled
              title="Bloqueado hasta que Franco apruebe"
              type="button"
            >
              Marcar como hecha
            </button>
            <span className="caption">
              Esperando revisión de Franco — no requiere ninguna acción tuya
              por ahora.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AugustoDashboard() {
  const [historiaSeleccionada, setHistoriaSeleccionada] = useState(null);
  const [historiasAugusto, setHistoriasAugusto] = useState([]);
  const [historiasAugustoError, setHistoriasAugustoError] = useState(null);

  const cargarHistoriasAugusto = () => {
    fetch("/api/historias")
      .then((response) => response.json())
      .then((historias) => {
        setHistoriasAugusto(
          historias.filter((historia) => historia.responsable === "Augusto"),
        );
      })
      .catch((error) => {
        console.error("No se pudieron cargar las historias de Augusto", error);
        setHistoriasAugustoError("No se pudieron cargar las historias.");
      });
  };

  useEffect(cargarHistoriasAugusto, []);

  return (
    <main aria-label="Render platform Augusto">
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

      <div className="frame">
        <div className="topbar">
          <div className="logo-box">[ LOGO RENDER ]</div>
          <div className="nav">
            <span className="active">Mis diseños</span>
            <span>Clientes</span>
          </div>
          <div className="tag">Augusto · diseño</div>
        </div>

        <div className="content">
          <div className="section-label">1 · Atrasadas / vencen hoy</div>
          <div className="box">
            {historiasAugustoError && (
              <div className="caption">{historiasAugustoError}</div>
            )}
            {!historiasAugustoError &&
              historiasAugusto
                .filter((historia) => {
                  const vencidaOVenceHoy =
                    historia.fecha_programada <= getHoyLocalISO() &&
                    historia.estado !== "publicada";
                  return vencidaOVenceHoy || historia.estado === "bloqueada";
                })
                .map((historia) => {
                  const estaAtrasada =
                    historia.fecha_programada < getHoyLocalISO() &&
                    historia.estado !== "publicada";
                  const estaBloqueada = historia.estado === "bloqueada";

                  return (
                    <div
                      className={`priority-card ${
                        estaAtrasada || estaBloqueada ? "blocked" : ""
                      }`}
                      key={historia.id}
                      onClick={() => setHistoriaSeleccionada(historia)}
                    >
                      <div className="cliente">{historia.cliente_nombre}</div>
                      <div>{historia.metadata?.Idea || "Sin idea cargada"}</div>
                      <div className="meta">
                        {historia.fecha_programada} ·{" "}
                        {getEstadoHistoriaLabel(historia.estado)}
                      </div>
                      {estaBloqueada && (
                        <div className="meta">
                          <span className="tag operativa">
                            Bloqueada:{" "}
                            {historia.metadata?.Aclaración ||
                              "sin aclaración cargada"}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
            {!historiasAugustoError &&
              historiasAugusto.filter((historia) => {
                const vencidaOVenceHoy =
                  historia.fecha_programada <= getHoyLocalISO() &&
                  historia.estado !== "publicada";
                return vencidaOVenceHoy || historia.estado === "bloqueada";
              }).length === 0 && (
                <div className="caption">
                  No hay historias atrasadas ni que venzan hoy.
                </div>
              )}
            <div className="caption">
              → Primero ve historias reales asignadas a Augusto. El detalle del
              modal queda para el próximo paso.
            </div>
          </div>

          <div className="section-label">2 · Tablero por estado</div>
          <div className="box">
            <div className="kanban">
              {getHistoriasAugustoKanban(historiasAugusto).map((columna) => (
                <div className="kanban-column" key={columna.estado}>
                  <div className="kanban-header">
                    <span>{columna.estado}</span>
                    <span>{columna.historias.length}</span>
                  </div>

                  {columna.historias.map((historia) => {
                    const estaBloqueada = historia.estado === "bloqueada";

                    return (
                      <div className="card" key={`kanban-${historia.id}`}>
                        <div className="cliente">
                          {historia.cliente_nombre}
                        </div>
                        <div>
                          {historia.metadata?.Idea || "Sin idea cargada"}
                        </div>
                        <div className="meta">
                          {historia.fecha_programada} ·{" "}
                          {getEstadoHistoriaLabel(historia.estado)}
                        </div>
                        {estaBloqueada && (
                          <div className="meta">
                            <span className="tag operativa">
                              Bloqueada:{" "}
                              {historia.metadata?.Aclaración ||
                                "sin aclaración cargada"}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="caption">
              → Vista real por estado para que Augusto ordene qué diseñar y qué
              está en marcha.
            </div>
          </div>

          <div className="section-label">3 · Avance del mes</div>
          <div className="box">
            <div className="progress-grid">
              <div className="progress-card">
                <div className="progress-label">Historias</div>
                <div className="progress-value">
                  {getPorcentajeHistoriasPublicadas(historiasAugusto)}%
                </div>
              </div>
              <div className="progress-card">
                <div className="progress-label">Feed</div>
                <div className="progress-value">{avanceAugustoDemo.feed}%</div>
              </div>
            </div>
            <div className="caption">
              → Historias calculado desde datos reales. Feed temporal hasta
              conectar publicaciones reales.
            </div>
          </div>
        </div>
      </div>

      {historiaSeleccionada && (
        <DetalleHistoriaModal
          historia={historiaSeleccionada}
          onClose={() => setHistoriaSeleccionada(null)}
          onActualizado={cargarHistoriasAugusto}
        />
      )}
      <TareasAsignadasGenericas nombre="Augusto" />
    </main>
  );
}

function DetalleHistoriaModal({ historia, onClose, onActualizado }) {
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const estaBloqueada = historia.estado === "bloqueada";

  const handleDesbloquear = () => {
    setEnviando("desbloquear");
    setError(null);

    fetch(`/api/historias/${historia.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "pendiente" }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo desbloquear la historia.");
        }
        return response.json();
      })
      .then(() => {
        onActualizado();
        onClose();
      })
      .catch(() => {
        setError("No se pudo desbloquear la historia. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  const handleAvisarGerman = () => {
    const nota = window.prompt("¿Qué necesita saber Germán sobre esta historia?");
    if (!nota) return;

    setEnviando("avisar");
    setError(null);

    fetch("/api/tareas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo: `${historia.cliente_nombre}: ${
          historia.metadata?.Idea || "historia"
        } — ${nota}`,
        asignado_a: "Germán",
        cliente_id: historia.cliente_id,
        estado: "pendiente",
        motivo: nota,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudo avisar a Germán.");
        }
        return response.json();
      })
      .then(() => {
        onClose();
      })
      .catch(() => {
        setError("No se pudo avisar a Germán. Intentá de nuevo.");
        setEnviando(null);
      });
  };

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <span>
            {historia.cliente_nombre} ·{" "}
            {historia.metadata?.Idea || "Historia sin idea cargada"}
          </span>
          <button className="modal-close" type="button" onClick={onClose}>
            X
          </button>
        </div>
        <div className="modal-body">
          <span className="tag operativa">
            {getEstadoHistoriaLabel(historia.estado)}
          </span>

          <div className="detail-grid">
            <div className="detail-field">
              <div className="detail-label">Copy</div>
              <div>{historia.metadata?.Copy || "Sin copy cargado"}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">CTA</div>
              <div>{historia.metadata?.CTA || "Sin CTA cargado"}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Material</div>
              <div>{historia.metadata?.Material || "Sin material cargado"}</div>
            </div>
            <div className="detail-field">
              <div className="detail-label">Aclaración</div>
              <div>
                {historia.metadata?.Aclaración || "Sin aclaración cargada"}
              </div>
            </div>
          </div>

          {error && <div className="caption login-error">{error}</div>}

          <div className="modal-actions">
            <button
              className="btn primary"
              type="button"
              disabled={!estaBloqueada || enviando !== null}
              title={estaBloqueada ? undefined : "Esta historia no está bloqueada"}
              onClick={handleDesbloquear}
            >
              {enviando === "desbloquear"
                ? "Desbloqueando..."
                : "Marcar como desbloqueada"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={enviando !== null}
              onClick={handleAvisarGerman}
            >
              {enviando === "avisar" ? "Enviando..." : "Avisar a Germán"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

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
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

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
      <div className="note">
        WIREFRAME — baja fidelidad, sin marca ni color final. Objetivo:
        validar estructura y navegación, no estética.
      </div>

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

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
