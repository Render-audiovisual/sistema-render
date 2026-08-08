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

export function normalizePersonName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es")
    .split(/\s+/)[0] || "";
}

export function belongsToPerson(value, personName) {
  const valueKey = normalizePersonName(value);
  const personKey = normalizePersonName(personName);
  return Boolean(valueKey && personKey && valueKey === personKey);
}

export function filterItemsByPeriod(items = [], isInPeriod, dateField = "fecha_programada") {
  if (typeof isInPeriod !== "function") return [];
  return items.filter((item) => isInPeriod(item?.[dateField] || ""));
}

export function normalizeClientName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MARIANO_CLIENTS = new Set([
  "iphone shop",
  "luzin",
  "lucin",
  "rpm",
  "rpm chevrolet",
  "lavalle market",
  "la valle market",
  "el angel azul estudiantil",
  "angel azul estudiantil",
  "joyeria cristal",
  "cristal joyeria",
  "cristal joyerias",
]);

export function getCarouselDesignerForClient(client = {}) {
  return MARIANO_CLIENTS.has(normalizeClientName(client.nombre)) ? "Mariano" : "Augusto";
}

export function getClientCarouselTarget(client = {}, clients = []) {
  if (!client.grupo_feed_id) return Number(client.cuota_carruseles) || 0;
  const groupClients = clients.filter((item) => item.grupo_feed_id === client.grupo_feed_id);
  const groupTarget = Number(client.cuota_feed_carruseles) || 0;
  return groupClients.length > 0 ? groupTarget / groupClients.length : 0;
}

export function getDesignerCarouselSummary(designer, clients = [], publications = []) {
  const assignedClients = clients.filter((client) => getCarouselDesignerForClient(client) === designer);
  const assignedIds = new Set(assignedClients.map((client) => Number(client.id)));
  const total = assignedClients.reduce(
    (sum, client) => sum + getClientCarouselTarget(client, clients),
    0,
  );
  const realizados = publications.filter(
    (publication) =>
      assignedIds.has(Number(publication.cliente_id)) &&
      publication.tipo === "carrusel" &&
      publication.estado === "publicada",
  ).length;
  return {
    realizados,
    pendientes: Math.max(total - realizados, 0),
    total,
  };
}

export function formatPeriodDeadline(endExclusive = "") {
  const match = String(endExclusive).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const deadline = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1);
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long" }).format(deadline);
}
