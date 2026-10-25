const limit = 150;
const validTask = task => Number.isSafeInteger(task?.id) && task.id > 0 && task.id <= 2147483647 && typeof task.titulo === 'string';
export function mergeMoodboardTasks(...groups) {
  const rows = new Map();
  for (const tasks of groups) for (const task of tasks) if (validTask(task) && !rows.has(task.id)) rows.set(task.id, { id: task.id, titulo: task.titulo });
  return [...rows.values()];
}
export function createMoodboardTaskPager({ boardId, initial, capture, onChange = () => {} }) {
  if (!Number.isSafeInteger(boardId) || boardId < 1 || boardId > 2147483647 || !Array.isArray(initial)
    || initial.length > limit || initial.some(task => !validTask(task))
    || new Set(initial.map(task => task.id)).size !== initial.length) throw new Error('Catálogo de tareas inválido.');
  let items = mergeMoodboardTasks(initial), next = initial.length === limit ? limit : null;
  let busy = false, error = '', generation = 0, controller;
  const notify = scope => { if (scope.current()) onChange(); };
  return {
    get snapshot() { return { items: [...items], nextOffset: next, busy, error }; },
    cancel() { generation++; controller?.abort(); busy = false; },
    async loadMore() {
      if (busy || next === null) return;
      const scope = capture(); if (!scope.current()) return;
      const offset = next, observed = generation, own = new AbortController(); controller = own;
      const current = () => scope.current() && observed === generation && !own.signal.aborted;
      busy = true; error = ''; notify(scope);
      try {
        const page = await scope.request(`/api/moodboards/boards/${boardId}/tasks?limit=${limit}&offset=${offset}`, { signal: own.signal });
        if (!current()) return;
        if (page?.version !== 1 || page.limit !== limit || page.offset !== offset || !Array.isArray(page.items)
          || page.items.length > limit || page.items.some(task => !validTask(task))
          || new Set(page.items.map(task => task.id)).size !== page.items.length
          || (page.next_offset !== null && (page.items.length !== limit || page.next_offset !== offset + limit || page.next_offset > 1000000))) throw new Error('Respuesta inválida.');
        items = mergeMoodboardTasks(items, page.items); next = page.next_offset;
      } catch {
        if (current()) error = 'No se pudieron cargar más tareas. Volvé a intentarlo.';
      } finally {
        if (observed === generation) busy = false;
        if (current()) notify(scope);
      }
    },
  };
}
