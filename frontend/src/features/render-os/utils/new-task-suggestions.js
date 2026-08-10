import { getCarouselDesignerForClient, normalizeClientName } from "../../../shared/reports/report-utils.js";

function normalize(value = "") {
  return normalizeClientName(value);
}

function findPerson(users = [], expectedName = "") {
  const expected = normalize(expectedName).split(" ")[0];
  return users.find((user) => normalize(user.nombre || user.usuario).split(" ")[0] === expected) || null;
}

export function inferClientFromTaskTitle(title = "", clients = []) {
  const normalizedTitle = ` ${normalize(title)} `;
  return [...clients]
    .sort((left, right) => normalize(right.nombre).length - normalize(left.nombre).length)
    .find((client) => normalizedTitle.includes(` ${normalize(client.nombre)} `)) || null;
}

export function getNewTaskSuggestions({ title = "", clients = [], users = [], clientId = "" } = {}) {
  const normalizedTitle = normalize(title);
  const hasExplicitClient = clientId !== "";
  const inferredClient = hasExplicitClient
    ? clients.find((client) => String(client.id) === String(clientId)) || null
    : inferClientFromTaskTitle(title, clients);
  const editingVideo = /(editar|edicion|edicion de)\s+(un\s+)?(video|reel)|\b(video|reel)\b.*\b(editar|edicion)\b/.test(normalizedTitle);
  const designWork = /\b(carrusel|historia|flyer|diseno|placa)\b/.test(normalizedTitle);

  if (editingVideo) {
    const editor = findPerson(users, "Luciano");
    const leader = findPerson(users, "Líder") || users.find((user) => user.rol === "admin") || null;
    return {
      client: inferredClient,
      primary: editor?.nombre || "",
      collaborators: leader && leader.nombre !== editor?.nombre ? [leader.nombre] : [],
      tipo_tarea: "edicion",
      subtipo: normalizedTitle.includes("reel") ? "reel" : "video",
      message: editor ? `Edición detectada: ${editor.nombre}${leader ? ` + ${leader.nombre}` : ""}.` : "Edición detectada.",
    };
  }

  if (designWork && inferredClient) {
    const designerName = getCarouselDesignerForClient(inferredClient);
    const designer = findPerson(users, designerName);
    const subtype = ["carrusel", "historia", "flyer", "placa"].find((value) => normalizedTitle.includes(value)) || "diseño";
    return {
      client: inferredClient,
      primary: designer?.nombre || "",
      collaborators: [],
      tipo_tarea: "diseno",
      subtipo: subtype,
      message: designer ? `${inferredClient.nombre} detectado: se asignó a ${designer.nombre}.` : `${inferredClient.nombre} detectado.`,
    };
  }

  return {
    client: inferredClient,
    primary: "",
    collaborators: [],
    tipo_tarea: "",
    subtipo: "",
    message: inferredClient ? `Cliente detectado: ${inferredClient.nombre}.` : "",
  };
}

export function getTaskDirectUrl(origin = "", taskId) {
  const url = new URL("/workspace/tareas", origin);
  url.searchParams.set("task", String(taskId));
  return url.toString();
}
