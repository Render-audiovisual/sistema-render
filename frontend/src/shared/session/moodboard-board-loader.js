// A board is one coherent read: never combine references, categories or tasks
// from different selections. Abort is an optimization; generation is authority.
export function createMoodboardBoardLoader({ request, isCurrent = () => true }) {
  let generation = 0;
  let controller = null;
  const live = () => { try { return Boolean(isCurrent()); } catch { return false; } };
  function cancel() {
    generation++;
    controller?.abort();
    controller = null;
  }
  return Object.freeze({ cancel,
    async load(boardId, taskId = null) {
      cancel();
      if (!live()) return null;
      if (!Number.isSafeInteger(boardId) || boardId <= 0) throw new Error('El moodboard no es válido.');
      if (taskId !== null && (!Number.isSafeInteger(taskId) || taskId <= 0 || taskId > 2147483647)) throw new Error('La tarea del moodboard no es válida.');
      const observed = generation;
      const own = new AbortController();
      controller = own;
      const current = () => generation === observed && !own.signal.aborted && live();
      try {
        const resources = ['references', 'categories', 'tasks'];
        if (taskId !== null) resources.push(`tasks/${taskId}`);
        const [references, categories, tasks, context] = await Promise.all(
          resources.map(resource => request(
            `/api/moodboards/boards/${boardId}/${resource}`, { signal: own.signal },
          )),
        );
        if (!current()) return null;
        if (![references, categories, tasks].every(Array.isArray)) {
          throw new Error('No se pudieron verificar los datos del moodboard. Volvé a cargar.');
        }
        if (taskId !== null && (context?.version !== 1 || context?.item?.id !== taskId || typeof context.item.titulo !== 'string')) {
          throw new Error('No se pudo verificar la tarea del moodboard. Volvé a cargar.');
        }
        return { references, categories, tasks, ...(taskId === null ? {} : { contextTask: context.item }) };
      } catch (error) {
        if (!current()) return null;
        own.abort(); // Stop sibling reads without swallowing the current failure.
        throw error;
      } finally {
        if (controller === own) controller = null;
      }
    },
  });
}
