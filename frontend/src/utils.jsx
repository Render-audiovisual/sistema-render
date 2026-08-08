import React from "react";
import {
  esDeEstaSemana,
  esDelMesActual,
  fechaISODesde,
  getGrillaMes,
  getHoyLocalISO,
  getInicioSemanaISO,
  getMesActualISO,
  sumarDiasISO,
} from "./shared/date/date-utils.js";
export {
  esDeEstaSemana,
  esDelMesActual,
  fechaISODesde,
  getGrillaMes,
  getHoyLocalISO,
  getInicioSemanaISO,
  getMesActualISO,
  sumarDiasISO,
} from "./shared/date/date-utils.js";
import {
  PRIORIDAD_CLIENTES_ADMIN,
  SECTORES_TAREA,
  ESTADOS_TAREA,
  PRIORIDADES_TAREA,
  ESTADOS_HISTORIA,
  RESPONSABLES_EQUIPO,
  ESTADOS_PUBLICACION,
  TIPOS_PUBLICACION,
  ESTADO_FINAL_TAREA,
  ESTADO_TAREA_LABELS,
  TIPO_PUBLICACION_LABELS,
  USUARIO_A_RUTA,
} from "./constants.js";
import { getDefaultUserRoute, normalizeUserKey } from "./shared/session/route-utils.js";

export function calcularPorcentajePublicadas(items) {
  if (items.length === 0) return 0;

  const publicadas = items.filter((item) => item.estado === "publicada").length;
  return Math.round((publicadas / items.length) * 100);
}

export function calcularPorcentajeCuota(publicadas, cuota) {
  if (cuota <= 0) return 0;
  return Math.min(100, Math.round((publicadas / cuota) * 100));
}

export function getClaveFeed(cliente) {
  return cliente.grupo_feed_id
    ? `grupo-${cliente.grupo_feed_id}`
    : `cliente-${cliente.id}`;
}

export function getClienteIdsDelMismoFeed(cliente, clientes) {
  if (!cliente.grupo_feed_id) return [cliente.id];
  return clientes
    .filter((item) => item.grupo_feed_id === cliente.grupo_feed_id)
    .map((item) => item.id);
}

export function getPublicacionesDelMismoFeed(cliente, clientes, publicaciones) {
  const clienteIds = new Set(getClienteIdsDelMismoFeed(cliente, clientes));
  return publicaciones.filter((publicacion) => clienteIds.has(publicacion.cliente_id));
}

export function getCuotaFeedMensual(cliente) {
  return getCuotaReelsMensual(cliente) + getCuotaCarruselesMensual(cliente);
}

export function getCuotaReelsMensual(cliente) {
  if (cliente.grupo_feed_id) return Number(cliente.cuota_feed_reels) || 0;
  return Number(cliente.cuota_reels) || 0;
}

export function getCuotaCarruselesMensual(cliente) {
  if (cliente.grupo_feed_id) return Number(cliente.cuota_feed_carruseles) || 0;
  return Number(cliente.cuota_carruseles) || 0;
}

export function getPanoramaClientes(clientes, historias, publicaciones) {
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

export function getCumplimientoGeneral(clientes) {
  const conDatos = clientes.filter((cliente) => cliente.porcentajes);
  if (conDatos.length === 0) return 0;
  const suma = conDatos.reduce(
    (acc, cliente) => acc + cliente.porcentajes.objetivo,
    0,
  );
  return Math.round(suma / conDatos.length);
}

export function getPorcentajesCliente(cliente) {
  return (
    cliente.porcentajes ?? {
      historias: 0,
      feed: 0,
      feedSemana: 0,
      objetivo: 0,
    }
  );
}

export function getResumenEquipo(historias, publicaciones, tareas) {
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

export function getAprobacionesLider(tareas) {
  return tareas.filter(
    (tarea) =>
      ["Líder", "Agustín", "Franco"].includes(
        tarea.propiedades_extra?.escalada_a,
      ) &&
      tarea.estado !== ESTADO_FINAL_TAREA,
  );
}

export function getEstadoPorObjetivo(objetivo) {
  if (objetivo < 60) return "rojo";
  if (objetivo < 90) return "amarillo";
  return "verde";
}

// Fracción del mes ya transcurrida (0 a 1). Sirve para no tratar igual a un
// cliente sin historias cargadas el día 2 del mes (normal, recién arranca)
// que a uno sin cargar nada el día 20 (alerta real).

export function getAvanceDelMes() {
  const hoy = new Date();
  const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  return hoy.getDate() / diasEnMes;
}

export function getEstadoHistoriasCliente(total, porcentaje, avanceDelMes = getAvanceDelMes()) {
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

export function normalizarNombreCliente(nombre = "") {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getPrioridadCliente(nombre) {
  const normalizado = normalizarNombreCliente(nombre);
  const index = PRIORIDAD_CLIENTES_ADMIN.findIndex(
    (prioridad) =>
      normalizado === prioridad || normalizado.includes(prioridad),
  );
  return index === -1 ? PRIORIDAD_CLIENTES_ADMIN.length : index;
}

export function getResumenClientesActivos(clientes, historias, publicaciones) {
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

export function getPiezasAtrasadas(historias, publicaciones) {
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

export function getPiezasBloqueadas(historias, publicaciones) {
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

export function esperandoMaterial(tarea) {
  return Boolean(tarea.tarea_padre_id) && tarea.tarea_padre_estado !== ESTADO_FINAL_TAREA;
}

// Ediciones de video frenadas porque la filmación (tarea padre) todavía
// no está publicada — el cuello de botella real detrás de "Luciano atrasado"
// suele ser "Germán no filmó todavía", así que separarlo ayuda a saber a
// quién ir a destrabar.

export function getEdicionesEsperandoMaterial(tareas) {
  return tareas.filter(
    (t) => t.tipo_tarea === "edicion" && t.estado !== ESTADO_FINAL_TAREA && esperandoMaterial(t),
  );
}

export function getPublicacionesDeHoy(historias, publicaciones) {
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

export function getTareasParaAsignar(tareas) {
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

export function getEstadoLabel(estado) {
  return estado.charAt(0).toUpperCase() + estado.slice(1);
}

export function getEstadoHistoriaLabel(estado) {
  return estado.replace("_", " ");
}

export function getEstadoTareaLabel(estado) {
  return ESTADO_TAREA_LABELS[estado] || estado?.replaceAll("_", " ") || "—";
}

export function getTipoPublicacionLabel(tipo) {
  return TIPO_PUBLICACION_LABELS[tipo] || "Reel";
}

export function getPublicacionesKanban(publicaciones) {
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

export function getUsuarioKey(usuario) {
  return normalizeUserKey(usuario);
}

export function getRutaUsuario(usuario, rol) {
  return getDefaultUserRoute({ usuario, rol }, USUARIO_A_RUTA);
}

export function getSesion() {
  const raw = localStorage.getItem("render_sesion");
  if (!raw) {
    return null;
  }
  try {
    const sesion = JSON.parse(raw);
    if (!sesion?.token || !sesion?.usuario) {
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

export function guardarSesion(token, usuario) {
  localStorage.setItem("render_sesion", JSON.stringify({ token, usuario }));
}

export function inicialesUsuario(nombre) {
  return (nombre || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join("")
    .toUpperCase();
}

export function cerrarSesion() {
  localStorage.removeItem("render_sesion");
  window.location.href = "/login";
}

export function getSectorTarea(id) {
  return SECTORES_TAREA.find((s) => s.id === id);
}

export function getEstadoTarea(id) {
  return ESTADOS_TAREA.find((e) => e.id === id) || ESTADOS_TAREA[0];
}

export function getPrioridadTarea(id) {
  return PRIORIDADES_TAREA.find((p) => p.id === id) || PRIORIDADES_TAREA[1];
}

const ORDEN_PRIORIDAD_TAREA = { alta: 0, media: 1, baja: 2 };

export function ordenarTareasPorPrioridad(tareas) {
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

export function limpiarUrlTarea(url = "") {
  return url.replace(/[.,;:!?]+$/, "");
}

const URL_EN_TAREA_REGEX = /(https?:\/\/[^\s<>"')\]]+)/gi;

export function extraerUrlsTarea(texto = "") {
  return [...texto.matchAll(URL_EN_TAREA_REGEX)]
    .map((coincidencia) => limpiarUrlTarea(coincidencia[0]))
    .filter(Boolean);
}

export function renderizarTextoTarea(texto = "") {
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

export function obtenerInfoLinkTarea(url) {
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

export function formatearFechaTarea(fecha) {
  if (!fecha) return "Sin vencimiento";
  const [anio, mes, dia] = String(fecha).slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia) return fecha;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(anio, mes - 1, dia));
}

export function abreviarClientePublicacion(nombre = "") {
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

export function etiquetaCortaPublicacion(pz) {
  const tipo = pz.tipo === "carrusel" ? "C" : "V";
  const check = pz.estado === "publicada" ? "✓ " : "";
  return `${check}${tipo} · ${abreviarClientePublicacion(pz.cliente_nombre)}`;
}

export function getCheckPublicacionLabel(estado) {
  if (estado === "publicada") return "Publicado";
  if (estado === "bloqueada") return "No publicado / revisar";
  return "Pendiente";
}

export function normalizarPrimerNombre(nombre) {
  const primero = (nombre || "").trim().split(/\s+/)[0] || "";
  const limpio = primero
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
  if (!limpio) return "";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
}

export function payloadColumnaPlanilla(columna, valorCrudo) {
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

export function getInicialesCliente(nombre = "") {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
}

export function payloadColumnaPublicacion(columna, valorCrudo) {
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
