const invalid = () => { throw Object.assign(new Error('Paginación de tareas no válida.'), { status: 400 }); };

export function parseTaskPagination(query = {}) {
  const integer = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) invalid();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) invalid();
    return parsed;
  };
  return { limit: integer(query.limit, 100, 1, 500), offset: integer(query.offset, 0, 0, 1000000) };
}
