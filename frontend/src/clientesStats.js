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
  return hoy.getDate() / new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
}

export function calcularPorcentajeCuota(realizadas, cuota) {
  const total = Number(cuota) || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((Number(realizadas) || 0) / total) * 100));
}

export function calcularCuotaHistoriasPorDias(diasHistorias, mesISO) {
  const dias = new Set((diasHistorias || []).map(Number));
  if (!dias.size || !/^\d{4}-\d{2}$/.test(mesISO)) return 0;
  const [year, month] = mesISO.split("-").map(Number);
  const cantidadDias = new Date(year, month, 0).getDate();
  let cuota = 0;
  for (let dia = 1; dia <= cantidadDias; dia += 1) {
    if (dias.has(new Date(year, month - 1, dia).getDay())) cuota += 1;
  }
  return cuota;
}

export function getClaveFeed(cliente) {
  return cliente.grupo_feed_id ? `grupo-${cliente.grupo_feed_id}` : `cliente-${cliente.id}`;
}

export function getCuotaReelsMensual(cliente) {
  return cliente.grupo_feed_id ? Number(cliente.cuota_feed_reels) || 0 : Number(cliente.cuota_reels) || 0;
}

export function getCuotaCarruselesMensual(cliente) {
  return cliente.grupo_feed_id ? Number(cliente.cuota_feed_carruseles) || 0 : Number(cliente.cuota_carruseles) || 0;
}

export function getPublicacionesDelMismoFeed(cliente, clientes, publicaciones) {
  const ids = new Set(
    cliente.grupo_feed_id
      ? clientes.filter((item) => item.grupo_feed_id === cliente.grupo_feed_id).map((item) => item.id)
      : [cliente.id],
  );
  return publicaciones.filter((publicacion) => ids.has(publicacion.cliente_id));
}

export function getEstadoCuota({ cuota, realizadas, planificadas, avanceDelMes }) {
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

export function getResumenClientes(clientes, historias, publicaciones, { mes, avanceDelMes }) {
  return clientes.map((cliente) => {
    const historiasMes = historias.filter(
      (historia) => historia.cliente_id === cliente.id && esDelMes(historia.fecha_programada, mes),
    );
    const publicacionesMes = getPublicacionesDelMismoFeed(cliente, clientes, publicaciones)
      .filter((publicacion) => esDelMes(publicacion.fecha_programada, mes));
    const historiasPublicadas = historiasMes.filter((historia) => historia.estado === "publicada");
    const publicacionesPublicadas = publicacionesMes.filter((publicacion) => publicacion.estado === "publicada");
    const reelsPublicados = publicacionesPublicadas.filter(
      (publicacion) => publicacion.tipo === "reel" || publicacion.tipo === "video",
    ).length;
    const carruselesPublicados = publicacionesPublicadas.filter(
      (publicacion) => publicacion.tipo === "carrusel",
    ).length;
    const cuotaHistorias = calcularCuotaHistoriasPorDias(cliente.dias_historias, mes);
    const activo = cliente.activo !== false;
    const estadoHistorias = activo ? getEstadoCuota({
      cuota: cuotaHistorias,
      realizadas: historiasPublicadas.length,
      planificadas: historiasMes.length,
      avanceDelMes,
    }) : { color: "gris", label: "Inactivo", tipo: "inactivo" };
    return {
      ...cliente,
      activo,
      cuotaHistorias,
      historiasMes: historiasMes.length,
      historiasPublicadas: historiasPublicadas.length,
      porcentajePlanificacionHistorias: calcularPorcentajeCuota(historiasMes.length, cuotaHistorias),
      porcentajeHistorias: calcularPorcentajeCuota(historiasPublicadas.length, cuotaHistorias),
      estadoHistorias,
      reelsPublicados,
      carruselesPublicados,
      feedCompartido: Boolean(cliente.grupo_feed_id),
    };
  });
}

export function getTotalesCartera(filas) {
  const activas = filas.filter((cliente) => cliente.activo);
  const claves = new Set();
  const feedsUnicos = activas.filter((cliente) => {
    const clave = getClaveFeed(cliente);
    if (claves.has(clave)) return false;
    claves.add(clave);
    return true;
  });
  const sumar = (items, selector) => items.reduce((total, item) => total + selector(item), 0);
  const cuotaHistorias = sumar(activas, (cliente) => cliente.cuotaHistorias);
  const historiasPlanificadas = sumar(activas, (cliente) => cliente.historiasMes);
  const historiasPublicadas = sumar(activas, (cliente) => cliente.historiasPublicadas);
  const cuotaReels = sumar(feedsUnicos, getCuotaReelsMensual);
  const cuotaCarruseles = sumar(feedsUnicos, getCuotaCarruselesMensual);
  const reelsPublicados = sumar(feedsUnicos, (cliente) => cliente.reelsPublicados);
  const carruselesPublicados = sumar(feedsUnicos, (cliente) => cliente.carruselesPublicados);
  const piezasPublicadas = historiasPublicadas + reelsPublicados + carruselesPublicados;
  const piezasContratadas = cuotaHistorias + cuotaReels + cuotaCarruseles;
  return {
    clientesActivos: activas.length,
    cuotaHistorias,
    historiasPlanificadas,
    historiasPublicadas,
    cuotaReels,
    reelsPublicados,
    cuotaCarruseles,
    carruselesPublicados,
    piezasPublicadas,
    piezasContratadas,
    porcentajePlanificacionHistorias: calcularPorcentajeCuota(historiasPlanificadas, cuotaHistorias),
    porcentajeHistorias: calcularPorcentajeCuota(historiasPublicadas, cuotaHistorias),
    porcentajeReels: calcularPorcentajeCuota(reelsPublicados, cuotaReels),
    porcentajeCarruseles: calcularPorcentajeCuota(carruselesPublicados, cuotaCarruseles),
    porcentajeTotal: calcularPorcentajeCuota(piezasPublicadas, piezasContratadas),
  };
}
