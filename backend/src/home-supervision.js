import { effectiveTaskStateSql, taskLiveVisibilitySql } from './task-review-query.js';

export const SUPERVISION_TEAMS = Object.freeze({ agustin: [11, 8], franco: [10, 9] });
export const HOME_SUPERVISION_SQL = `SELECT t.id,t.titulo,${effectiveTaskStateSql('t')} AS estado,
 to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS deadline,t.cliente_id,c.nombre AS cliente,c.grupo_feed_id,
 (statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date::text AS today,
 ARRAY(SELECT a.usuario_id FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=ANY($1::int[])) AS members
 FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
 WHERE ${taskLiveVisibilitySql('t','c')}
 AND (t.fecha_vencimiento IS NULL OR t.fecha_vencimiento>=date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date)
 AND EXISTS(SELECT 1 FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.usuario_id=ANY($1::int[]))`;

export function supervisionSummary(rows, people, today) {
  const work = [...new Map(rows.map(row => [row.id, row])).values()];
  const finished = row => ['finalizada', 'publicada'].includes(row.estado);
  const open = work.filter(row => !finished(row));
  const tier = row => row.deadline && row.deadline < today ? 0 : row.deadline === today ? 1 : row.estado === 'en_revision' ? 2 : 3;
  const clients = new Map();
  for (const row of work.filter(row => row.deadline?.slice(0, 7) === today.slice(0, 7))) {
    const client = clients.get(row.cliente_id) || { id: row.cliente_id, name: row.cliente || 'Sin cliente',
      statsKey: row.cliente_id === null ? null : row.grupo_feed_id == null ? `cliente-${row.cliente_id}` : `grupo-${row.grupo_feed_id}`,
      total: 0, done: 0 };
    client.total++; if (finished(row)) client.done++; clients.set(row.cliente_id, client);
  }
  return { today, people: people.map(person => ({ id: person.id, name: person.nombre,
    open: open.filter(row => row.members.includes(person.id)).length,
    review: open.filter(row => row.members.includes(person.id) && row.estado === 'en_revision').length,
    done: work.filter(row => row.deadline?.slice(0, 7) === today.slice(0, 7) && row.members.includes(person.id) && finished(row)).length })),
    priorities: open.sort((a, b) => tier(a) - tier(b) || (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.id - b.id)
      .slice(0, 12).map(({ id, titulo, estado, deadline, cliente }) => ({ id, titulo, estado, deadline, cliente })),
    clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
