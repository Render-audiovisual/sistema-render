// La cartera vigente suma más de 120 piezas mensuales. Cinco espacios diarios
// permiten distribuirla sin dejar clientes fuera del calendario.
const MAX_PER_DAY = 5;

export function normalizeEditorialPeriod(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""))) {
    throw new Error("El período debe tener formato AAAA-MM.");
  }
  return String(value);
}

function dateISO(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function defaultDays(client) {
  return /gastronom/i.test(client.rubro || "") ? [0] : [1, 2, 3, 4, 5, 6];
}

function distanceToPreferred(day, preferred, year, month) {
  return preferred.includes(weekday(year, month, day)) ? 0 : 1;
}

export function buildEditorialSlots({ period, clients, occupied = [] }) {
  const normalized = normalizeEditorialPeriod(period);
  const [year, month] = normalized.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const load = new Map();
  occupied.forEach((item) => {
    if (item.fecha_programada?.startsWith(normalized)) {
      load.set(item.fecha_programada, (load.get(item.fecha_programada) || 0) + 1);
    }
  });
  const slots = [];
  const activeClients = clients
    .filter((client) => client.activo !== false)
    .filter((client) => !client.fecha_inicio || client.fecha_inicio.slice(0, 7) <= normalized)
    .filter((client) => !client.fecha_fin || client.fecha_fin.slice(0, 7) >= normalized)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));

  for (const client of activeClients) {
    for (const type of ["video", "carrusel"]) {
      const quota = Number(type === "video" ? client.cuota_reels : client.cuota_carruseles) || 0;
      const configured = type === "video" ? client.dias_reels : client.dias_carruseles;
      const preferred = Array.isArray(configured) && configured.length ? configured.map(Number) : defaultDays(client);
      for (let index = 0; index < quota; index += 1) {
        const target = Math.round(((index + 0.5) * daysInMonth) / quota);
        const candidates = Array.from({ length: daysInMonth }, (_, offset) => offset + 1)
          .filter((day) => (load.get(dateISO(year, month, day)) || 0) < MAX_PER_DAY)
          .sort((a, b) => {
            const preference = distanceToPreferred(a, preferred, year, month) - distanceToPreferred(b, preferred, year, month);
            if (preference) return preference;
            const cadence = Math.abs(a - target) - Math.abs(b - target);
            if (cadence) return cadence;
            const pressure = (load.get(dateISO(year, month, a)) || 0) - (load.get(dateISO(year, month, b)) || 0);
            return pressure || a - b;
          });
        if (!candidates.length) throw new Error(`No hay capacidad disponible en ${normalized}.`);
        const fecha = dateISO(year, month, candidates[0]);
        load.set(fecha, (load.get(fecha) || 0) + 1);
        slots.push({
          cliente_id: Number(client.id), tipo: type, fecha_programada: fecha,
          calendario_clave: `${normalized}:${client.id}:${type}:${index + 1 + Number(client[`${type}_offset`] || 0)}`,
        });
      }
    }
  }
  return slots;
}

export async function reconcileEditorialCalendar(db, period) {
  const normalized = normalizeEditorialPeriod(period);
  const periodDate = `${normalized}-01`;
  const clientsResult = await db.query(`
    SELECT c.id, c.nombre, c.rubro, c.activo,
      to_char(c.fecha_inicio, 'YYYY-MM-DD') fecha_inicio,
      to_char(c.fecha_fin, 'YYYY-MM-DD') fecha_fin,
      COALESCE(cfg.cuota_reels,
        CASE WHEN c.grupo_feed_id IS NOT NULL
          THEN floor(gf.cuota_reels::numeric / NULLIF(group_members.cantidad, 0))::int
          ELSE c.cuota_reels END, 0) cuota_reels,
      COALESCE(cfg.cuota_carruseles,
        CASE WHEN c.grupo_feed_id IS NOT NULL
          THEN floor(gf.cuota_carruseles::numeric / NULLIF(group_members.cantidad, 0))::int
          ELSE c.cuota_carruseles END, 0) cuota_carruseles,
      COALESCE(cfg.dias_reels, '{}') dias_reels,
      COALESCE(cfg.dias_carruseles, '{}') dias_carruseles
    FROM clientes c
    LEFT JOIN LATERAL (
      SELECT * FROM cliente_configuraciones cc
      WHERE cc.cliente_id = c.id AND cc.vigente_desde <= $1::date
      ORDER BY cc.vigente_desde DESC LIMIT 1
    ) cfg ON TRUE
    LEFT JOIN grupos_feed gf ON gf.id = c.grupo_feed_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int cantidad FROM clientes member
      WHERE member.grupo_feed_id = c.grupo_feed_id
        AND member.activo IS NOT FALSE
        AND (member.fecha_inicio IS NULL OR member.fecha_inicio <= ($1::date + interval '1 month - 1 day'))
        AND (member.fecha_fin IS NULL OR member.fecha_fin >= $1::date)
    ) group_members ON c.grupo_feed_id IS NOT NULL`, [periodDate]);
  const existingResult = await db.query(`
    SELECT id, cliente_id, tipo, estado, to_char(fecha_programada, 'YYYY-MM-DD') fecha_programada,
      origen_calendario, calendario_clave, fecha_bloqueada
    FROM publicaciones WHERE to_char(fecha_programada, 'YYYY-MM') = $1`, [normalized]);
  const fixed = existingResult.rows.filter((item) => item.origen_calendario !== "automatico" || item.fecha_bloqueada || item.estado === "publicada");
  const clientsAdjusted = clientsResult.rows.map((client) => {
    const adjusted = { ...client };
    for (const type of ["video", "carrusel"]) {
      const fixedForType = fixed.filter((item) => Number(item.cliente_id) === Number(client.id) && item.tipo === type);
      const quotaField = type === "video" ? "cuota_reels" : "cuota_carruseles";
      adjusted[quotaField] = Math.max(0, Number(client[quotaField] || 0) - fixedForType.length);
      adjusted[`${type}_offset`] = fixedForType.reduce((max, item) => {
        const ordinal = Number(String(item.calendario_clave || "").split(":").at(-1));
        return Number.isFinite(ordinal) ? Math.max(max, ordinal) : max;
      }, 0);
    }
    return adjusted;
  });
  const desired = buildEditorialSlots({ period: normalized, clients: clientsAdjusted, occupied: fixed });
  const desiredKeys = new Set(desired.map((item) => item.calendario_clave));
  const removable = existingResult.rows.filter((item) => item.origen_calendario === "automatico" && !item.fecha_bloqueada && item.estado !== "publicada" && !desiredKeys.has(item.calendario_clave));
  if (removable.length) await db.query("DELETE FROM publicaciones WHERE id = ANY($1::int[])", [removable.map((item) => item.id)]);
  let created = 0;
  let updated = 0;
  for (const slot of desired) {
    const result = await db.query(`
      INSERT INTO publicaciones (cliente_id, tipo, estado, fecha_programada, idea, origen_calendario, calendario_clave)
      VALUES ($1, $2, 'pendiente', $3, '', 'automatico', $4)
      ON CONFLICT (calendario_clave) WHERE calendario_clave IS NOT NULL DO UPDATE SET
        fecha_programada = CASE WHEN publicaciones.fecha_bloqueada OR publicaciones.estado = 'publicada'
          THEN publicaciones.fecha_programada ELSE EXCLUDED.fecha_programada END,
        updated_at = now()
      RETURNING (xmax = 0) AS inserted`, [slot.cliente_id, slot.tipo, slot.fecha_programada, slot.calendario_clave]);
    if (result.rows[0].inserted) created += 1; else updated += 1;
  }
  return { periodo: normalized, creadas: created, actualizadas: updated, eliminadas: removable.length, preservadas: fixed.length };
}
