// Alertas del panel de Instagram. Reglas fijas y comprobables: cada alerta
// explica el porqué con los números que la dispararon. No envía mensajes.

const DAY = 86400000;
export const ALERT_RULES = Object.freeze({
  ritmoMinimoDia: 7,          // antes del día 7 no se evalúa el ritmo de cupo
  ritmoTolerancia: 1,         // piezas de margen sobre lo esperado a la fecha
  caidaUmbral: 0.7,           // alcance promedio < 70 % de la base
  basePiezasMinimas: 4,       // base de comparación: al menos 4 piezas medidas
  actualPiezasMinimas: 2,     // y al menos 2 piezas medidas en el mes
  diasSinPublicar: 7,
  horasSinSincronizar: 24,
});

function cordobaParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(({ type, value }) => [type, value]));
}

export function monthProgress(period, now) {
  const parts = cordobaParts(now);
  const current = `${parts.year}-${parts.month}`;
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (period < current) return { day: days, days, fraction: 1, current: false };
  if (period > current) return { day: 0, days, fraction: 0, current: false };
  const day = Number(parts.day);
  return { day, days, fraction: day / days, current: true };
}

export function computeAlerts(panel, { now = new Date(), rules = ALERT_RULES } = {}) {
  const progress = monthProgress(panel.periodo, now);
  const alerts = [];
  const push = (cliente, tipo, nivel, titulo, detalle) => alerts.push({ clave: cliente.clave, cliente: cliente.nombre, tipo, nivel, titulo, detalle });

  for (const cliente of panel.clientes) {
    const hasAccount = cliente.instagram.length > 0;
    if (cliente.cupo && hasAccount && progress.day >= rules.ritmoMinimoDia) {
      const cupo = cliente.cupo.reels + cliente.cupo.carruseles;
      const hechas = cliente.actual.reels + cliente.actual.carruseles;
      const esperadas = Math.floor(cupo * progress.fraction);
      if (cupo > 0 && hechas < esperadas - rules.ritmoTolerancia) {
        const faltan = cupo - hechas;
        const diasRestantes = progress.days - progress.day;
        push(cliente, 'cupo_atrasado', progress.current ? 'alta' : 'media',
          progress.current ? 'Atrasado con el cupo del mes' : 'Cupo del mes sin cumplir',
          progress.current
            ? `Lleva ${hechas} de ${cupo} piezas al día ${progress.day}; a esta altura deberían ser ${esperadas}. Faltan ${faltan} en ${diasRestantes} días.`
            : `Cerró con ${hechas} de ${cupo} piezas.`);
      }
    }
    const base = cliente.base;
    if (base && base.medidas >= rules.basePiezasMinimas && cliente.actual.medidas >= rules.actualPiezasMinimas) {
      const promedioBase = base.alcance / base.medidas;
      const promedio = cliente.actual.alcance / cliente.actual.medidas;
      if (promedioBase > 0 && promedio < promedioBase * rules.caidaUmbral) {
        const caida = Math.round((1 - promedio / promedioBase) * 100);
        push(cliente, 'caida_alcance', 'media', 'Bajó el alcance por pieza',
          `Promedio del mes: ${Math.round(promedio)} por pieza, ${caida} % menos que los 3 meses anteriores (${Math.round(promedioBase)}).`);
      }
    }
    if (progress.current && hasAccount && cliente.cupo) {
      const last = cliente.ultima_publicacion ? new Date(cliente.ultima_publicacion) : null;
      const days = last ? Math.floor((now - last) / DAY) : null;
      if (days === null || days >= rules.diasSinPublicar) {
        push(cliente, 'sin_publicar', 'alta', 'Sin publicaciones recientes',
          days === null ? 'No hay publicaciones registradas en Instagram.' : `La última publicación fue hace ${days} días.`);
      }
    }
    if (cliente.sin_vincular > 0) {
      push(cliente, 'sin_vincular', 'baja', 'Publicaciones sin pieza asignada',
        `${cliente.sin_vincular} post${cliente.sin_vincular === 1 ? '' : 's'} del mes no ${cliente.sin_vincular === 1 ? 'está vinculado' : 'están vinculados'} a una pieza del sistema; no cuentan para el equipo.`);
    }
    for (const account of cliente.instagram) {
      const synced = account.sincronizada_at ? new Date(account.sincronizada_at) : null;
      if (!synced || now - synced > rules.horasSinSincronizar * 3600000) {
        push(cliente, 'sin_sincronizar', 'media', 'Datos de Meta desactualizados',
          synced ? `@${account.username} no se sincroniza desde hace ${Math.floor((now - synced) / 3600000)} horas.` : `@${account.username} todavía no se sincronizó.`);
      }
    }
  }
  const order = { alta: 0, media: 1, baja: 2 };
  return alerts.sort((a, b) => order[a.nivel] - order[b.nivel] || a.cliente.localeCompare(b.cliente, 'es'));
}
