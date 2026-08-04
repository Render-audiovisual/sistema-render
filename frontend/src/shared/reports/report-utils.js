export function isFilmingTask(task = {}) {
  const text = `${task.titulo || ""} ${task.subtipo || ""} ${task.propiedades_extra?.clickup_lista || ""}`.toLocaleLowerCase("es");
  return task.tipo_tarea === "produccion" || text.includes("filmar") || text.includes("grabac") || text.includes("filmación");
}

export function groupFilmingTasksByClient(tasks = [], finalState = "publicada") {
  return Object.values(
    tasks.filter(isFilmingTask).reduce((groups, task) => {
      const name = task.cliente_nombre || "Sin cliente";
      if (!groups[name]) groups[name] = { nombre: name, total: 0, grabados: 0, pendientes: 0 };
      groups[name].total += 1;
      if (task.estado === finalState) groups[name].grabados += 1;
      else groups[name].pendientes += 1;
      return groups;
    }, {}),
  ).sort((a, b) => b.grabados - a.grabados || b.total - a.total || a.nombre.localeCompare(b.nombre));
}
