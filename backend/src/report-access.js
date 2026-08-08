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

export function filterReportDataForUser(data, auth = {}) {
  if (auth.rol === "admin") return data;
  const identity = auth.nombre || auth.usuario || "";
  const ownTask = (task) => belongsTo(task.asignado_a, identity)
    || (Array.isArray(task.propiedades_extra?.colaboradores)
      && task.propiedades_extra.colaboradores.some((name) => belongsTo(name, identity)));
  const ownUsers = data.usuarios.filter((user) => belongsTo(user.nombre || user.usuario, identity));

  if (auth.rol === "community") {
    return { ...data, tareas: data.tareas.filter(ownTask), tareasRenderOs: [], clientes: [], usuarios: ownUsers };
  }
  if (auth.rol === "diseno") {
    const assignedIds = new Set(data.clientes.filter((client) => clientBelongsToDesigner(client, identity)).map((client) => Number(client.id)));
    return {
      ...data,
      tareas: data.tareas.filter(ownTask),
      tareasRenderOs: [],
      historias: [],
      publicaciones: data.publicaciones.filter((item) => item.tipo === "carrusel" && assignedIds.has(Number(item.cliente_id))),
      usuarios: ownUsers,
    };
  }
  if (auth.rol === "produccion") {
    return {
      ...data,
      tareas: data.tareas.filter(ownTask),
      tareasRenderOs: data.tareasRenderOs.filter(ownTask),
      historias: [], publicaciones: [], clientes: [], usuarios: ownUsers,
    };
  }
  return {
    ...data,
    tareas: data.tareas.filter(ownTask),
    tareasRenderOs: [], historias: [], publicaciones: [], clientes: [], usuarios: ownUsers,
  };
}
