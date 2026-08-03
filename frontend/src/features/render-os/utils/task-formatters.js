export function areaForTask(task) {
  const text = `${task.tipo_tarea || ""} ${task.subtipo || ""} ${task.titulo || ""}`.toLowerCase();
  if (text.includes("chatbot") || text.includes("bot ")) return "chatbots";
  if (text.includes("web") || text.includes("landing") || text.includes("página")) return "web";
  if (text.includes("cartel")) return "carteleria";
  if (text.includes("carrusel")) return "carruseles";
  if (text.includes("historia") || text.includes("flyer") || text.includes("community")) return "historias";
  if (text.includes("produccion") || text.includes("producción") || text.includes("visita") || text.includes("filmar")) return "produccion";
  if (text.includes("edicion") || text.includes("edición") || text.includes("editar") || text.includes("reel")) return "edicion";
  return task.tipo_tarea === "diseno" ? "carruseles" : "edicion";
}

export function formatDate(value) {
  if (!value) return "Sin fecha";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return day && month ? `${day}/${month}/${year}` : value;
}

export function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function initials(value = "") {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

export function personForTask(task, users) {
  const assigned = String(task?.asignado_a || "").toLowerCase();
  return users.find((user) => user.nombre?.toLowerCase() === assigned || user.usuario?.toLowerCase() === assigned);
}
