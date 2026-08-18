export const ESTADOS_CLIENTE = Object.freeze([
  { value: "activo", label: "Activo" },
  { value: "pausado", label: "Pausado" },
  { value: "finalizado", label: "Finalizado" },
]);

export function getMesISO(fecha = new Date()) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

export function esDelMes(fechaISO, mesISO) {
  return typeof fechaISO === "string" && fechaISO.startsWith(mesISO);
}

export function getAvanceMes(mesISO, hoy = new Date()) {
  const actual = getMesISO(hoy);
  if (mesISO < actual) return 1;
  if (mesISO > actual) return 0;
  const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  return hoy.getDate() / diasEnMes;
}

export function calcularPorcentajeCuota(realizadas, cuota) {
  const total = Number(cuota) || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((Number(realizadas) || 0) / total) * 100));
}

export function getClaveFeed(cliente) {
  return cliente.grupo_feed_id
    ? `grupo-${cliente.grupo_feed_id}`
    : `cliente-${cliente.id}`;
}

export function getCuotaReelsMensual(cliente) {
  if (cliente.grupo_feed_id) return Number(cliente.cuota_feed_reels) || 0;
  return Number(cliente.cuota_reels) || 0;
}

export function getCuotaCarruselesMensual(cliente) {
  if (cliente.grupo_feed_id) return Number(cliente.cuota_feed_carruseles) || 0;
  return Number(cliente.cuota_carruseles) || 0;
}

export function getCuotaHistoriasMensual(cliente) {
  return Number(cliente.cuota_historias) || 0;
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

export function getEstadoCuota({ cuota, realizadas, planificadas = realizadas, avanceDelMes = 0 }) {
  if (cuota <= 0) return { color: "gris", label: "No incluido", tipo: "no_incluido" };
  if (planificadas <= 0) {
    return avanceDelMes >= 0.25
      ? { color: "rojo", label: "Sin planificación", tipo: "sin_planificacion" }
      : { color: "gris", label: "Por planificar", tipo: "sin_planificacion" };
  }
  const porcentaje = calcularPorcentajeCuota(realizadas, cuota);
  const esperado = Math.round(avanceDelMes * 100);
  if (porcentaje + 15 < esperado) return { color: "rojo", label: "Necesita seguimiento", tipo: "atrasado" };
  if (porcentaje < esperado) return { color: "amarillo", label: "Revisar ritmo", tipo: "en_riesgo" };
  return { color: "verde", label: "Al día", tipo: "al_dia" };
}

export function getResumenClientes(clientes, historias, publicaciones, opciones = {}) {
  const mes = opciones.mes || getMesISO();
  const avanceDelMes = opciones.avanceDelMes ?? 0;

  return clientes.map((cliente) => {
    const historiasMes = historias.filter(
      (historia) => historia.cliente_id === cliente.id && esDelMes(historia.fecha_programada, mes),
    );
    const publicacionesMes = getPublicacionesDelMismoFeed(cliente, clientes, publicaciones)
      .filter((publicacion) => esDelMes(publicacion.fecha_programada, mes));
    const historiasPublicadas = historiasMes.filter((historia) => historia.estado === "publicada");
    const publicacionesPublicadas = publicacionesMes.filter(
      (publicacion) => publicacion.estado === "publicada",
    );
    const reelsPublicados = publicacionesPublicadas.filter(
      (publicacion) => publicacion.tipo === "reel" || publicacion.tipo === "video",
    ).length;
    const carruselesPublicados = publicacionesPublicadas.filter(
      (publicacion) => publicacion.tipo === "carrusel",
    ).length;
    const cuotaHistorias = getCuotaHistoriasMensual(cliente);
    const estadoHistorias = getEstadoCuota({
      cuota: cuotaHistorias,
      realizadas: historiasPublicadas.length,
      planificadas: historiasMes.length,
      avanceDelMes,
    });

    return {
      ...cliente,
      estado_cliente: cliente.estado_cliente || "activo",
      activo: (cliente.estado_cliente || "activo") === "activo",
      cuotaHistorias,
      historiasMes: historiasMes.length,
      historiasPublicadas: historiasPublicadas.length,
      porcentajePlanificacionHistorias: calcularPorcentajeCuota(historiasMes.length, cuotaHistorias),
      porcentajeHistorias: calcularPorcentajeCuota(historiasPublicadas.length, cuotaHistorias),
      estadoHistorias,
      ultimaHistoriaOk: historiasPublicadas
        .map((historia) => historia.fecha_programada)
        .filter(Boolean)
        .sort()
        .at(-1),
      reelsPublicados,
      carruselesPublicados,
      feedCompartido: Boolean(cliente.grupo_feed_id),
    };
  });
}

export function getTotalesCartera(filas) {
  const activas = filas.filter((cliente) => cliente.activo);
  const clavesFeedContadas = new Set();
  const feedsUnicos = activas.filter((cliente) => {
    const clave = getClaveFeed(cliente);
    if (clavesFeedContadas.has(clave)) return false;
    clavesFeedContadas.add(clave);
    return true;
  });
  const sumar = (lista, selector) => lista.reduce((total, item) => total + selector(item), 0);
  const historiasPlanificadas = sumar(activas, (cliente) => cliente.historiasMes);
  const historiasPublicadas = sumar(activas, (cliente) => cliente.historiasPublicadas);
  const cuotaHistorias = sumar(activas, getCuotaHistoriasMensual);
  const reelsPublicados = sumar(feedsUnicos, (cliente) => cliente.reelsPublicados);
  const carruselesPublicados = sumar(feedsUnicos, (cliente) => cliente.carruselesPublicados);
  const cuotaReels = sumar(feedsUnicos, getCuotaReelsMensual);
  const cuotaCarruseles = sumar(feedsUnicos, getCuotaCarruselesMensual);
  const piezasPublicadas = historiasPublicadas + reelsPublicados + carruselesPublicados;
  const piezasContratadas = cuotaHistorias + cuotaReels + cuotaCarruseles;

  return {
    clientesActivos: activas.length,
    historiasPlanificadas,
    historiasPublicadas,
    cuotaHistorias,
    reelsPublicados,
    cuotaReels,
    carruselesPublicados,
    cuotaCarruseles,
    piezasPublicadas,
    piezasContratadas,
    porcentajePlanificacionHistorias: calcularPorcentajeCuota(historiasPlanificadas, cuotaHistorias),
    porcentajeHistorias: calcularPorcentajeCuota(historiasPublicadas, cuotaHistorias),
    porcentajeReels: calcularPorcentajeCuota(reelsPublicados, cuotaReels),
    porcentajeCarruseles: calcularPorcentajeCuota(carruselesPublicados, cuotaCarruseles),
    porcentajeTotal: calcularPorcentajeCuota(piezasPublicadas, piezasContratadas),
  };
}
