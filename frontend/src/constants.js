export const ESTADO_FINAL_TAREA = "publicada";

export const ESTADO_TAREA_LABELS = {
  pendiente: "Pendiente",
  en_progreso: "En proceso",
  en_revision: "En revisión",
  programada: "Programada",
  publicada: "Publicada",
};

export const TIPO_PUBLICACION_LABELS = {
  video: "Reel",
  carrusel: "Carrusel",
};

export const USUARIO_A_RUTA = {
  lider: "/lider",
  augusto: "/augusto",
  luciano: "/luciano",
  german: "/german",
  oriana: "/oriana",
};

export const USUARIO_INFO = {
  lider: { nombre: "Líder", rol: "admin" },
  augusto: { nombre: "Augusto", rol: "diseno" },
  luciano: { nombre: "Luciano", rol: "edicion" },
  german: { nombre: "Germán", rol: "produccion" },
  oriana: { nombre: "Oriana", rol: "community" },
};

export const ROL_LABELS = {
  admin: "Líder",
  diseno: "Diseño",
  edicion: "Edición",
  produccion: "Producción",
  community: "Comunidad",
};

// Paleta compartida por Reportes y Clientes: acento teal cálido,
// bordes con tinte cálido, números en fuente monoespaciada.
export const RR = {
  text: "#1b1b18",
  textMuted: "#6b6860",
  textFaint: "#948f83",
  border: "#e3dfd6",
  surface2: "#efece5",
  accent: "#1a8a80",
  success: "#3d7a53",
  successBg: "#e3ede5",
  warning: "#a8641c",
  warningBg: "#f6e9d8",
  danger: "#b23a2e",
  dangerBg: "#f7e6e3",
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace',
};

export const PRIORIDAD_CLIENTES_ADMIN = [
  "rpm",
  "iphone shop",
  "luzin",
  "moketa",
];

export const RESPONSABLES = [
  "Líder",
  "Augusto",
  "Luciano",
  "Germán",
  "Oriana",
];

export const SECTORES_TAREA = [
  { id: "diseno", label: "Diseño", bg: "#2a1f33", fg: "#ce93d8" },
  { id: "produccion", label: "Producción", bg: "#0f2b28", fg: "#4db6ac" },
  { id: "edicion", label: "Edición", bg: "#17233a", fg: "#64b5f6" },
  { id: "community", label: "Community", bg: "#331825", fg: "#f06292" },
];

export const ESTADOS_TAREA = [
  { id: "pendiente", label: "Pendiente", bg: "#24272b", fg: "#90a4ae" },
  { id: "en_progreso", label: "En proceso", bg: "#17233a", fg: "#64b5f6" },
  { id: "en_revision", label: "En revisión", bg: "#332413", fg: "#ffb74d" },
  { id: "publicada", label: "Publicada", bg: "#123320", fg: "#66bb6a" },
];

export const PRIORIDADES_TAREA = [
  { id: "alta", label: "Alta", bg: "#331616", fg: "#ef5350" },
  { id: "media", label: "Media", bg: "#332413", fg: "#ffb74d" },
  { id: "baja", label: "Baja", bg: "#123320", fg: "#66bb6a" },
];

export const SUBTIPOS_SUGERIDOS = ["reel", "historia", "carrusel", "visita", "flyer", "editar", "filmar", "diseñar"];

export const ROLES_HOME = [
  { nombre: "Líder", descripcion: "Administración y aprobaciones", path: "/lider" },
  { nombre: "Augusto", descripcion: "Diseño", path: "/augusto" },
  { nombre: "Luciano", descripcion: "Edición", path: "/luciano" },
  { nombre: "Germán", descripcion: "Producción", path: "/german" },
  { nombre: "Oriana", descripcion: "Community", path: "/oriana" },
];

export const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export const ESTADOS_HISTORIA = [
  { id: "pendiente", label: "Pendiente", bg: "#eeeeec", fg: "#62656d" },
  { id: "en_diseño", label: "En diseño", bg: "#f1e9f5", fg: "#7a4d8f" },
  { id: "en_revision", label: "En revisión", bg: "#f7ecd9", fg: "#b7791f" },
  { id: "lista", label: "Lista", bg: "#e3f0ee", fg: "#0e6e67" },
  { id: "publicada", label: "Publicada", bg: "#e2f0e7", fg: "#1c8753" },
  { id: "bloqueada", label: "Bloqueada", bg: "#f6e3e0", fg: "#c0392b" },
];

export const RESPONSABLES_EQUIPO = ["Augusto", "Luciano", "Germán", "Oriana", "Líder"];

// Orden de columnas navegables con Tab/Enter (coincide con el orden visual).

export const COLUMNAS_PLANILLA = ["cliente", "fecha", "hora", "tipo", "copy", "material", "aclaraciones", "responsable", "estado"];
// Columnas de texto largo: son <textarea>, no <input> — admiten líneas
// propias (Enter no debe saltar de fila) y solo se tratan como pegado
// multi-celda si el portapapeles trae tabs (un salto de línea solo puede
// ser contenido real, como un copy con varios renglones).

export const COLUMNAS_MULTILINEA = ["copy", "aclaraciones"];

// Convierte un valor pegado/tipeado en una columna al payload que espera
// PATCH /api/historias/:id. Devuelve null si el valor no es válido para esa
// columna (paste defensivo: mejor ignorar una celda que guardar basura).

export const DIAS_SEMANA_CLIENTE = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export const MESES_CLIENTE = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export const ESTADOS_PUBLICACION = [
  { id: "pendiente", label: "Pendiente", bg: "#eceff1", fg: "#546e7a" },
  { id: "en_diseño", label: "En diseño", bg: "#f3e5f5", fg: "#7b1fa2" },
  { id: "en_edición", label: "En edición", bg: "#e1f5fe", fg: "#0277bd" },
  { id: "en_revision", label: "En revisión", bg: "#fff3e0", fg: "#e65100" },
  { id: "lista", label: "Lista", bg: "#f0f4c3", fg: "#827717" },
  { id: "publicada", label: "Publicada", bg: "#e8f5e9", fg: "#2e7d32" },
  { id: "bloqueada", label: "Bloqueada", bg: "#ffebee", fg: "#c62828" },
];

export const TIPOS_PUBLICACION = [
  { id: "video", label: "Reel" },
  { id: "carrusel", label: "Carrusel" },
];

export const COLUMNAS_PUBLICACION = ["fecha", "tipo", "idea", "copy", "material", "aclaraciones", "responsable", "estado"];

