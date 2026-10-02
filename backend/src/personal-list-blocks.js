const BLOCK_TYPES = new Set(["texto", "listado", "checklist", "tabla"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function cleanText(value, max, fallback = "") {
  const clean = String(value ?? fallback).replace(/\r\n/g, "\n").trim();
  if ([...clean].length > max) invalid("El contenido del bloque es demasiado largo.");
  return clean;
}

function cleanId(value, field = "elemento") {
  const clean = String(value || "");
  if (!ID_PATTERN.test(clean)) invalid(`El identificador del ${field} no es válido.`);
  return clean;
}

function uniqueIds(items, field) {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) invalid(`Hay ${field} repetidos.`);
}

function normalizeItems(rawItems, withChecks) {
  if (!Array.isArray(rawItems)) return [];
  if (rawItems.length > 300) invalid("Un bloque no puede tener más de 300 elementos.");
  const items = rawItems.map((item) => ({
    id: cleanId(item?.id, "elemento"),
    texto: cleanText(item?.texto, 500),
    ...(withChecks ? { completado: Boolean(item?.completado) } : {}),
  }));
  uniqueIds(items, "elementos");
  return items;
}

function normalizeTable(content) {
  const rawColumns = Array.isArray(content?.columnas) ? content.columnas : [];
  const rawRows = Array.isArray(content?.filas) ? content.filas : [];
  if (!rawColumns.length || rawColumns.length > 14) invalid("La tabla debe tener entre 1 y 14 columnas.");
  if (rawRows.length > 100) invalid("La tabla no puede tener más de 100 filas.");
  const columnas = rawColumns.map((column) => ({
    id: cleanId(column?.id, "columna"),
    titulo: cleanText(column?.titulo, 80, "Columna") || "Columna",
  }));
  uniqueIds(columnas, "columnas");
  const columnIds = new Set(columnas.map((column) => column.id));
  const filas = rawRows.map((row) => {
    const celdas = {};
    for (const column of columnas) {
      const source = row?.celdas?.[column.id] || {};
      celdas[column.id] = {
        texto: cleanText(source.texto, 500),
        completado: Boolean(source.completado),
      };
    }
    for (const key of Object.keys(row?.celdas || {})) {
      if (!columnIds.has(key)) invalid("La tabla contiene una celda sin columna.");
    }
    return { id: cleanId(row?.id, "fila"), celdas };
  });
  uniqueIds(filas, "filas");
  return { titulo: cleanText(content?.titulo, 120, "Tabla") || "Tabla", columnas, filas };
}

export function normalizeBlockType(value) {
  const type = String(value || "");
  if (!BLOCK_TYPES.has(type)) invalid("El tipo de bloque no es válido.");
  return type;
}

export function normalizeBlockContent(typeValue, rawContent) {
  const type = normalizeBlockType(typeValue);
  const content = rawContent && typeof rawContent === "object" && !Array.isArray(rawContent) ? rawContent : {};
  let normalized;
  if (type === "texto") {
    normalized = { texto: cleanText(content.texto, 10000) };
  } else if (type === "tabla") {
    normalized = normalizeTable(content);
  } else {
    normalized = {
      titulo: cleanText(content.titulo, 120, type === "checklist" ? "Pendientes" : "Listado") || (type === "checklist" ? "Pendientes" : "Listado"),
      items: normalizeItems(content.items, type === "checklist"),
    };
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > 150_000) invalid("El bloque supera el tamaño permitido.");
  return normalized;
}

export function normalizeBlocks(value, { max = 80 } = {}) {
  if (!Array.isArray(value)) invalid("Los bloques no son válidos.");
  if (value.length > max) invalid(`Una página no puede tener más de ${max} bloques.`);
  return value.map((block) => ({
    tipo: normalizeBlockType(block?.tipo),
    contenido: normalizeBlockContent(block?.tipo, block?.contenido),
  }));
}
