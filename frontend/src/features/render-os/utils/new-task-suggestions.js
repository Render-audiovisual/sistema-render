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
  const localVisit = /\bvisita\b/.test(normalizedTitle);
  const designWork = /\b(carrusel|historia|flyer|diseno|grafica|placa)\b|aviso importante/.test(normalizedTitle);
  const leader = findPerson(users, "Líder") || users.find((user) => user.rol === "admin") || null;

  if (editingVideo) {
    const editor = findPerson(users, "Luciano");
    return {
      client: inferredClient,
      primary: editor?.nombre || "",
      collaborators: leader && leader.nombre !== editor?.nombre ? [leader.nombre] : [],
      tipo_tarea: "edicion",
      subtipo: normalizedTitle.includes("reel") ? "reel" : "video",
      message: editor ? `Edición detectada: ${editor.nombre}${leader ? ` + ${leader.nombre}` : ""}.` : "Edición detectada.",
    };
  }

  if (localVisit) {
    const filmmaker = findPerson(users, "Germán");
    return {
      client: inferredClient,
      primary: filmmaker?.nombre || "",
      collaborators: leader && leader.nombre !== filmmaker?.nombre ? [leader.nombre] : [],
      tipo_tarea: "produccion",
      subtipo: "visita",
      message: filmmaker ? `Visita detectada: ${filmmaker.nombre}${leader ? ` + ${leader.nombre}` : ""}.` : "Visita de producción detectada.",
    };
  }

  if (designWork) {
    const communityManager = findPerson(users, "Oriana");
    const designerName = inferredClient ? getCarouselDesignerForClient(inferredClient) : "";
    const designer = designerName ? findPerson(users, designerName) : null;
    const primary = designer || communityManager;
    const collaborators = communityManager && communityManager.nombre !== primary?.nombre ? [communityManager.nombre] : [];
    const subtype = ["carrusel", "historia", "flyer", "placa"].find((value) => normalizedTitle.includes(value))
      || (normalizedTitle.includes("aviso importante") ? "aviso importante" : "diseño");
    return {
      client: inferredClient,
      primary: primary?.nombre || "",
      collaborators,
      tipo_tarea: "diseno",
      subtipo: subtype,
      message: designer
        ? `${inferredClient.nombre} detectado: ${designer.nombre} + ${communityManager?.nombre || "Oriana"}.`
        : `Pieza gráfica detectada${communityManager ? `: ${communityManager.nombre}` : ""}. Elegí el cliente para asignar diseñador.`,
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
