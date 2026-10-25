import { buildMoodboardTaskReadPredicate, moodboardTaskId } from './moodboard-task-access.js';

export async function readMoodboardTaskContext(pool, auth, rawBoardId, rawTaskId, query = {}) {
  const boardId = moodboardTaskId(rawBoardId), taskId = moodboardTaskId(rawTaskId);
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).length) throw invalid();
  const predicate = buildMoodboardTaskReadPredicate(auth, 't', '$3');
  const values = predicate.value === null ? [boardId, taskId] : [boardId, taskId, predicate.value];
  const { rows } = await pool.query(`SELECT DISTINCT t.id, t.titulo FROM tareas t
    JOIN moodboard_board_clients bc ON bc.cliente_id = t.cliente_id
    WHERE bc.board_id = $1 AND t.id = $2 AND ${predicate.sql}`, values);
  if (rows.length !== 1) throw Object.assign(new Error('La tarea solicitada no está disponible en este moodboard.'), { status: 404 });
  return { version: 1, item: rows[0] };
}

const invalid = () => Object.assign(new Error('Paginación de tareas inválida.'), { status: 400 });
export function moodboardTaskPageQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(key => !['limit', 'offset'].includes(key))) throw invalid();
  const paginated = Object.keys(query).length > 0;
  const number = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    const match = typeof value === 'string' && /^(0|[1-9]\d*)$/.exec(value);
    if (!match || match[0] !== value) throw invalid();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw invalid();
    return parsed;
  };
  return { paginated, limit: number(query.limit, 150, 1, 150), offset: number(query.offset, 0, 0, 1000000) };
}

export async function readMoodboardTaskPage(pool, auth, rawBoardId, query) {
  const boardId = moodboardTaskId(rawBoardId), page = moodboardTaskPageQuery(query);
  const predicate = buildMoodboardTaskReadPredicate(auth, 't', '$2');
  const values = predicate.value === null ? [boardId] : [boardId, predicate.value];
  const take = values.push(page.limit + (page.paginated ? 1 : 0)), skip = values.push(page.offset);
  const { rows } = await pool.query(`SELECT DISTINCT t.id, t.titulo FROM tareas t
    JOIN moodboard_board_clients bc ON bc.cliente_id = t.cliente_id
    WHERE bc.board_id = $1 AND ${predicate.sql}
    ORDER BY t.titulo,t.id LIMIT $${take} OFFSET $${skip}`, values);
  if (!page.paginated) return rows;
  const items = rows.slice(0, page.limit);
  const nextOffset = rows.length > page.limit ? page.offset + items.length : null;
  // Never offer a continuation that this bounded API cannot accept.
  if (nextOffset !== null && nextOffset > 1000000) {
    throw Object.assign(new Error('El catálogo supera el límite de paginación disponible.'), { status: 422 });
  }
  return { version: 1, items, limit: page.limit, offset: page.offset,
    next_offset: nextOffset };
}
