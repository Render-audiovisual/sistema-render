import { createHash } from 'node:crypto';

const fail = (message, status = 500) => Object.assign(new Error(message), { status });
const fault = () => fail('La página del calendario no es consistente.');
const timezone = 'America/Argentina/Cordoba';
const kinds = ['all', 'tarea', 'visita', 'hito', 'programacion', 'publicacion'];
const datePattern = '^([0-9]{4})-[0-9]{2}-[0-9]{2}$';
const validDateSql = expression => `(${expression} ~ '${datePattern}' AND ${expression} >= '0001-01-01' AND ${expression} <= '9999-12-31')`;
const instantSql = expression => `(${expression} >= timestamptz '0001-01-01 00:00:00+00' AND ${expression} < timestamptz '10000-01-01 00:00:00+00')`;

// Only the caller's static, authoritative SELECTs are accepted. Remove the
// terminal legacy cap, never rewrite/copy their access or membership predicates.
function uncapped(sql) {
  if (typeof sql !== 'string' || !/\sLIMIT 2001\s*$/i.test(sql) || sql.includes(';')) throw fault();
  return sql.replace(/\sLIMIT 2001\s*$/i, '');
}

function querySql(filters, dependencies) {
  const bases = [], candidates = [];
  const add = (name, source, kind, sql, extra = '') => {
    bases.push(`${name} AS MATERIALIZED (${uncapped(sql)})`);
    candidates.push(`SELECT '${source}'::text source,'${kind}'::text kind,r.date::text date,
      '${kind}:${source}:' || r.id::text key,to_jsonb(r) raw,NULL::jsonb footprint
      FROM ${name} r WHERE ${validDateSql('r.date')}
      AND (r.cliente_id IS NULL OR r.cliente_id BETWEEN 1 AND 2147483647) ${extra}`);
  };
  if (!filters.vista && ['all', 'tarea'].includes(filters.kind)) add('task_rows', 'tarea', 'tarea', dependencies.taskSql, 'AND r.id BETWEEN 1 AND 2147483647');
  if (!filters.vista && !filters.formato && ['all', 'visita'].includes(filters.kind)) add('visit_rows', 'visita', 'visita', dependencies.visitSql);
  if (!filters.vista && ['all', 'hito'].includes(filters.kind)) add('milestone_rows', 'hito', 'hito', dependencies.milestoneSql,
    "AND r.estado IN ('pendiente','completado','cancelado')");
  if (['all', 'programacion', 'publicacion'].includes(filters.kind)) {
    for (const [index, domain] of (filters.vista ? ['publicacion'] : ['historia', 'publicacion']).entries()) {
      const name = `editorial_${index}`;
      bases.push(`${name}_base AS MATERIALIZED (${uncapped(dependencies.editorialSql(domain, filters.kind, filters.vista, filters.formato))})`);
      // Same proof tuple used by annotateEditorialEvidence. Its authoritative
      // projector still rechecks every selected/preview row in this RR snapshot.
      // Include even non-current evidence in the fingerprint, not in the DTO.
      bases.push(`${name} AS MATERIALIZED (SELECT r.*,to_jsonb(v) AS version_footprint,to_jsonb(e) AS event_footprint,
        e.occurred_at AS proof_occurred_at,
        (v.revision BETWEEN 1 AND 9007199254740991 AND v.current_event_id=e.id
          AND e.dominio='${domain}' AND e.pieza_id=r.id AND e.cliente_id=r.cliente_id
          AND e.action='confirmar' AND e.source='manual' AND e.actor_id BETWEEN 1 AND 2147483647
          AND r.estado='publicada' AND r.fecha_publicación_real=e.occurred_at
          AND ${instantSql('e.occurred_at')} AND ${instantSql('e.recorded_at')}
          AND ${validDateSql(`to_char(e.occurred_at AT TIME ZONE '${timezone}','YYYY-MM-DD')`)}
          AND ${validDateSql(`to_char(e.recorded_at AT TIME ZONE '${timezone}','YYYY-MM-DD')`)}
          AND ${validDateSql('r.fecha_programada')}) AS valid_proof
        FROM ${name}_base r
        LEFT JOIN editorial_publicacion_versiones v ON v.dominio='${domain}' AND v.pieza_id=r.id
        LEFT JOIN editorial_publicacion_eventos e ON e.id=v.current_event_id
        WHERE r.id BETWEEN 1 AND 2147483647 AND r.cliente_id BETWEEN 1 AND 2147483647)`);
      const raw = "to_jsonb(r)-ARRAY['version_footprint','event_footprint','proof_occurred_at','valid_proof']::text[]";
      const footprint = 'jsonb_build_array(r.version_footprint,r.event_footprint)';
      if (filters.kind !== 'publicacion') candidates.push(`SELECT '${domain}'::text source,'programacion'::text kind,
        r.fecha_programada::text date,'programacion:${domain}:' || r.id::text key,${raw} raw,${footprint} footprint
        FROM ${name} r WHERE ${validDateSql('r.fecha_programada')}
        AND r.fecha_programada >= $1::text AND r.fecha_programada < $2::text`);
      if (filters.kind !== 'programacion') candidates.push(`SELECT '${domain}'::text source,'publicacion'::text kind,
        to_char(r.proof_occurred_at AT TIME ZONE '${timezone}','YYYY-MM-DD') date,
        'publicacion:${domain}:' || r.id::text key,${raw} raw,${footprint} footprint
        FROM ${name} r WHERE r.valid_proof IS TRUE
        AND ${validDateSql(`to_char(r.proof_occurred_at AT TIME ZONE '${timezone}','YYYY-MM-DD')`)}
        AND r.proof_occurred_at >= ($1::date::timestamp AT TIME ZONE '${timezone}')
        AND r.proof_occurred_at < ($2::date::timestamp AT TIME ZONE '${timezone}')`);
    }
  }
  const order = 'date COLLATE "C",kind COLLATE "C",key COLLATE "C"';
  const envelope = "jsonb_build_object('source',source,'kind',kind,'date',date,'key',key,'raw',raw)";
  return `WITH ${bases.join(',\n')},
    candidates AS MATERIALIZED (${candidates.join('\nUNION ALL\n')}),
    ranked AS MATERIALIZED (SELECT *,row_number() OVER (PARTITION BY date ORDER BY kind COLLATE "C",key COLLATE "C") day_rank FROM candidates),
    selected AS MATERIALIZED (SELECT * FROM candidates WHERE ($8::text IS NULL OR date=$8::text)
      ORDER BY ${order} LIMIT $6::int OFFSET $7::bigint),
    day_counts AS (SELECT date,count(*)::text total,
      jsonb_agg(${envelope} ORDER BY kind COLLATE "C",key COLLATE "C") FILTER (WHERE day_rank<=2) preview
      FROM ranked GROUP BY date)
    SELECT (SELECT count(*)::text FROM candidates WHERE ($8::text IS NULL OR date=$8::text)) total,
      (SELECT count(*)::text FROM candidates) range_total,
      encode(sha256(convert_to(COALESCE((SELECT string_agg(
        encode(sha256(convert_to(jsonb_build_array(source,kind,date,key,raw,footprint)::text,'UTF8')),'hex'),'' ORDER BY ${order}) FROM candidates),''),'UTF8')),'hex') fingerprint,
      COALESCE((SELECT jsonb_agg(${envelope} ORDER BY ${order}) FROM selected),'[]'::jsonb) events,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('date',date,'total',total,'preview',preview) ORDER BY date COLLATE "C") FROM day_counts),'[]'::jsonb) days`;
}

function count(value) {
  if (!(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) && !Number.isSafeInteger(value)) throw fault();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw fault();
  return result;
}
function day(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(0, 4) !== '0000'
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Caller owns the current-actor-validated RR READ ONLY transaction and clients
 * observation. No BEGIN/COMMIT, lease, writes or automatic conflict retry here.
 * Returns only {events,truncated,pagination}; caller wraps legacy envelope fields.
 */
export async function readCalendarPage(db, { filters, page, clients, user }, dependencies) {
  const base = { desde: filters.desde, hasta: filters.hasta, scope: filters.scope, kind: filters.kind, cliente_id: filters.cliente_id };
  if (filters.vista === 'publicaciones') base.vista = filters.vista;
  if (filters.formato) base.formato = filters.formato;
  const { limit, offset } = page;
  const expected_snapshot = page.expected_snapshot ?? undefined;
  const dia = page.dia ?? null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0
    || (expected_snapshot !== undefined && (typeof expected_snapshot !== 'string' || !/^c1:[0-9a-f]{64}$/.test(expected_snapshot)))
    || (offset > 0 && expected_snapshot === undefined)
    || (dia !== null && (!day(dia) || dia < base.desde || dia >= base.hasta))) throw fail('Página de calendario inválida.', 400);
  if (!kinds.includes(base.kind) || !day(base.desde) || !day(base.hasta) || base.desde >= base.hasta
    || !['team', 'mine'].includes(base.scope)) throw fault();
  // Explicit fields: filters.pagination and page size/offset never enter identity.
  const context = JSON.stringify({ actor: [user.id, user.rol, user.session_version], filters: base, dia,
    clients: clients.map(client => ({ id: client.id, nombre: client.nombre })) });
  const result = (await db.query(querySql(base, dependencies), [base.desde, base.hasta, base.cliente_id,
    user.id, base.scope === 'team', limit, offset, dia])).rows;
  if (result.length !== 1) throw fault();
  const row = result[0];
  if (typeof row.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(row.fingerprint)) throw fault();
  const snapshot = `c1:${createHash('sha256').update(context).update('\n').update(row.fingerprint).digest('hex')}`;
  if (expected_snapshot !== undefined && expected_snapshot !== snapshot) throw fail('El calendario cambió. Reiniciá la consulta.', 409);
  const total = count(row.total), rangeTotal = count(row.range_total);
  if (!Array.isArray(row.events) || !Array.isArray(row.days) || row.days.length > 62
    || row.events.length !== Math.min(limit, Math.max(0, total - offset))) throw fault();
  let sum = 0, previous = '';
  for (const entry of row.days) {
    const n = count(entry.total);
    if (!day(entry.date) || entry.date < base.desde || entry.date >= base.hasta || entry.date <= previous || n < 1
      || !Array.isArray(entry.preview) || entry.preview.length !== Math.min(2, n)) throw fault();
    sum += n; previous = entry.date;
  }
  if (!Number.isSafeInteger(sum) || sum !== rangeTotal
    || total !== (dia === null ? sum : count(row.days.find(entry => entry.date === dia)?.total ?? 0))) throw fault();
  const entries = [...row.events, ...row.days.flatMap(entry => entry.preview)];
  const editorial = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.raw || !day(entry.date) || typeof entry.key !== 'string') throw fault();
    if (['historia', 'publicacion'].includes(entry.source)) {
      const key = `${entry.source}:${entry.raw.id}`;
      if (editorial.has(key) && JSON.stringify(editorial.get(key).raw) !== JSON.stringify(entry.raw)) throw fault();
      editorial.set(key, entry);
    }
  }
  const annotated = new Map();
  for (const domain of ['historia', 'publicacion']) {
    const input = [...editorial.values()].filter(entry => entry.source === domain).map(entry => entry.raw);
    if (!input.length) continue;
    const rows = await dependencies.annotateEvidence(db, domain, input);
    if (!Array.isArray(rows) || rows.length !== input.length) throw fault();
    for (let index = 0; index < rows.length; index++) {
      if (rows[index]?.id !== input[index].id) throw fault();
      annotated.set(`${domain}:${rows[index].id}`, rows[index]);
    }
  }
  const slots = { tarea: 'tasks', visita: 'visits', hito: 'hitos', historia: 'historias', publicacion: 'publicaciones' };
  const project = entry => {
    if (!Object.hasOwn(slots, entry.source) || !kinds.includes(entry.kind) || entry.kind === 'all') throw fault();
    const raw = annotated.get(`${entry.source}:${entry.raw.id}`) ?? entry.raw;
    const events = dependencies.buildEvents({ [slots[entry.source]]: [raw] }, { ...base, kind: entry.kind });
    if (!Array.isArray(events) || events.length !== 1 || events[0].key !== entry.key || events[0].date !== entry.date
      || events[0].source !== entry.source || events[0].kind !== entry.kind) throw fault();
    return events[0];
  };
  const ordered = entries => entries.every((entry, index) => index === 0 ||
    `${entries[index - 1].date}\n${entries[index - 1].kind}\n${entries[index - 1].key}` < `${entry.date}\n${entry.kind}\n${entry.key}`);
  if (!ordered(row.events) || row.events.some(entry => dia !== null && entry.date !== dia)
    || row.days.some(entry => !ordered(entry.preview) || entry.preview.some(preview => preview.date !== entry.date))) throw fault();
  const events = row.events.map(project);
  const days = row.days.map(entry => ({ date: entry.date, total: count(entry.total), preview: entry.preview.map(project) }));
  return { events, truncated: events.length < total,
    pagination: { version: 1, limit, offset, total, has_more: offset + events.length < total, snapshot, day: dia, days } };
}
