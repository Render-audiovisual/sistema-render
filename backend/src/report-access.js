function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function belongsTo(value, identity) {
  const left = normalize(value).split(/\s+/)[0];
  const right = normalize(identity).split(/\s+/)[0];
  return Boolean(left && right && left === right);
}

const MARIANO_CLIENTS = new Set([
  "iphone shop", "luzin", "lucin", "rpm", "rpm chevrolet", "lavalle market",
  "la valle market", "el angel azul estudiantil", "angel azul estudiantil",
  "joyeria cristal", "cristal joyeria", "cristal joyerias",
]);

function clientBelongsToDesigner(client, identity) {
  const isMariano = belongsTo(identity, "Mariano");
  const isAugusto = belongsTo(identity, "Augusto");
  if (!isMariano && !isAugusto) return false;
  const belongsToMariano = MARIANO_CLIENTS.has(normalize(client?.nombre).replace(/[^a-z0-9]+/g, " ").trim());
  return isMariano ? belongsToMariano : !belongsToMariano;
}

function renderOsCategory(task = {}) {
  const text = normalize(`${task.titulo || ""} ${task.subtipo || ""} ${task.tipo_tarea || ""}`);
  if (text.includes("carrusel")) return "carruseles";
  if (task.tipo_tarea === "edicion" || text.includes("edicion") || text.includes("editar reel") || text.includes("editar video")) return "ediciones";
  if (task.tipo_tarea !== "produccion" && (/^video\b/.test(normalize(task.titulo)) || text.includes(" reel") || text.includes("video "))) return "reels_planificados";
  return null;
}

export function summarizeRenderOsByDay(tasks = []) {
  return tasks.reduce((summary, task) => {
    if (task.propiedades_extra?.archivada_render_os === true) return summary;
    const category = renderOsCategory(task);
    const date = String(task.fecha_vencimiento || task.updated_at || "").slice(0, 10);
    if (!category || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return summary;
    if (!summary[date]) summary[date] = {};
    if (!summary[date][category]) summary[date][category] = { total: 0, publicadas: 0 };
    summary[date][category].total += 1;
    if (task.estado === "publicada") summary[date][category].publicadas += 1;
    return summary;
  }, {});
}

export function filterReportDataForUser(data, auth = {}) {
  const reportData = { ...data, resumenRenderOsPorDia: summarizeRenderOsByDay(data.tareasRenderOs) };
  if (auth.rol === "admin") return reportData;
  const identity = auth.nombre || auth.usuario || "";
  const ownTask = (task) => belongsTo(task.asignado_a, identity)
    || (Array.isArray(task.propiedades_extra?.colaboradores)
      && task.propiedades_extra.colaboradores.some((name) => belongsTo(name, identity)));
  const ownUsers = data.usuarios.filter((user) => belongsTo(user.nombre || user.usuario, identity));

  if (auth.rol === "community") {
    return { ...reportData, tareas: data.tareas.filter(ownTask), tareasRenderOs: [], clientes: [], usuarios: ownUsers };
  }
  if (auth.rol === "diseno") {
    const assignedIds = new Set(data.clientes.filter((client) => clientBelongsToDesigner(client, identity)).map((client) => Number(client.id)));
    return {
      ...reportData,
      tareas: data.tareas.filter(ownTask),
      tareasRenderOs: data.tareasRenderOs.filter(ownTask),
      historias: [],
      publicaciones: data.publicaciones.filter((item) => item.tipo === "carrusel" && assignedIds.has(Number(item.cliente_id))),
      usuarios: ownUsers,
    };
  }
  if (auth.rol === "produccion") {
    return {
      ...reportData,
      tareas: data.tareas.filter(ownTask),
      tareasRenderOs: data.tareasRenderOs.filter(ownTask),
      historias: [], publicaciones: [], clientes: [], usuarios: ownUsers,
    };
  }
  return {
    ...reportData,
    tareas: data.tareas.filter(ownTask),
    tareasRenderOs: data.tareasRenderOs.filter(ownTask), historias: [], publicaciones: [], clientes: [], usuarios: ownUsers,
  };
}
