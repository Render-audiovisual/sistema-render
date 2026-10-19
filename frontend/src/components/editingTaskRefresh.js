// A committed delivery/decision must never stay busy forever while its parent
// refreshes. Abort the read, reject the callback, and ignore a late response.
export async function refreshEditingTask({ taskId, request, onRefreshed, timers = globalThis }, isCurrent) {
  if (!isCurrent()) return;
  const controller = new AbortController();
  let timer, expired = false;
  const deadline = new Promise((_resolve, reject) => {
    timer = timers.setTimeout(() => { expired = true; controller.abort(); reject(new Error('No se pudo actualizar la tarea a tiempo.')); }, 15000);
  });
  try {
    const refreshed = await Promise.race([request(taskId, { signal: controller.signal }), deadline]);
    if (expired || !isCurrent()) return;
    onRefreshed(refreshed);
  } finally { timers.clearTimeout(timer); }
}
