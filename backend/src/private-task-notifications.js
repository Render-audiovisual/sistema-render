import crypto from "node:crypto";
import { normalizarNombre, responsablesNotificables, destinatarioUnicoPorNombre } from "./email-notifications.js";

const APP_URL_POR_DEFECTO = "https://sistema.rendercorrientes.com";

const TITULOS = Object.freeze({
  creada: "Tenés una nueva tarea",
  reasignada: "Te asignaron una tarea",
  comentario: "Hay un comentario nuevo",
  correcciones: "Correcciones solicitadas",
  revision: "La tarea pasó a revisión",
  bloqueada: "Hay un bloqueo en la tarea",
  en_progreso: "La tarea comenzó",
  finalizada: "La tarea fue finalizada",
  // Preserve the legacy event key without asserting an effective publication.
  publicada: "La tarea fue finalizada",
  aprobada: "La tarea fue aprobada",
});

export function destinatariosNuevosDeAsignacion({
  asignadoAnterior = "", asignadoActual = "", colaboradoresAnteriores = [], colaboradoresActuales = [],
  cambioAsignado = true, cambioColaboradores = true,
}) {
  const resultado = [];
  const vistos = new Set();
  const agregar = (nombre) => {
    const clave = normalizarNombre(nombre);
    if (!clave || vistos.has(clave)) return;
    vistos.add(clave);
    resultado.push(nombre);
  };

  if (cambioAsignado && normalizarNombre(asignadoAnterior) !== normalizarNombre(asignadoActual)) {
    agregar(asignadoActual);
  }

  if (cambioColaboradores) {
    const anteriores = new Set(colaboradoresAnteriores.map(normalizarNombre).filter(Boolean));
    for (const colaborador of colaboradoresActuales) {
      if (!anteriores.has(normalizarNombre(colaborador))) agregar(colaborador);
    }
  }
  return resultado;
}

async function resolverUsuarios(pool, nombres) {
  const { rows } = await pool.query("SELECT id, usuario, nombre FROM usuarios WHERE activo IS TRUE");
  return nombres.map(nombre => destinatarioUnicoPorNombre(rows, nombre));
}

export function crearMensajePrivadoTarea({ tarea, clienteNombre, motivo = "creada", detalle = "", appUrl = APP_URL_POR_DEFECTO }) {
  const titulo = TITULOS[motivo] || TITULOS.creada;
  const url = `${appUrl.replace(/\/$/, "")}/workspace/tareas?task=${encodeURIComponent(tarea.id)}`;
  const lineas = [
    `🔔 ${titulo}`,
    `${clienteNombre || "Sin cliente"} · ${tarea.titulo}`,
    `Entrega: ${tarea.fecha_vencimiento || "Sin fecha"} · Prioridad: ${tarea.prioridad || "media"}`,
    ...(detalle ? [String(detalle).trim()] : []),
    `Abrir tarea: ${url}`,
  ];
  return { text: lineas.join("\n"), url };
}

export async function encolarNotificacionPrivadaTarea({
  pool, tarea, motivo = "creada", detalle = "", nombresDestinatarios, actor = "", env = process.env,
  destinatarioIds, actorId,
}) {
  const byId = destinatarioIds !== undefined;
  const actorById = actorId !== undefined;
  const positive = value => Number.isSafeInteger(value) && value > 0;
  if (actorById && !positive(actorId)
    || byId && (!Array.isArray(destinatarioIds) || destinatarioIds.some(id => !positive(id)) || !positive(actorId))) {
    throw Object.assign(new Error("Destinatarios de notificación inválidos."), { status: 400 });
  }
  const nombres = Array.isArray(nombresDestinatarios) ? nombresDestinatarios : responsablesNotificables(tarea);
  // Compatibility labels still require a unique active account. Once resolved,
  // retain that account ID so delivery can revalidate it after rename/revocation.
  // This never infers identities for historical queued notices.
  const candidatos = byId
    ? (await pool.query("SELECT id,usuario,nombre FROM usuarios WHERE id=ANY($1::integer[]) AND activo IS TRUE ORDER BY id", [[...new Set(destinatarioIds)]])).rows
    : await resolverUsuarios(pool, nombres);
  const actorNormalizado = normalizarNombre(actor);
  const destinatarios = candidatos.filter((candidate, index, items) => {
    if (!candidate) return false;
    if (byId) return candidate.id !== actorId && items.findIndex(item => item?.id === candidate.id) === index;
    if (actorById && !positive(candidate.id)) return false;
    const clave = normalizarNombre(candidate.usuario);
    // A verified actor ID can accompany legacy recipient labels. A homonym is
    // not the author, and a renamed author must still exclude their own ID.
    const esActor = actorById ? candidate.id === actorId : actorNormalizado && [candidate.nombre, candidate.usuario]
      .some((value) => normalizarNombre(value) === actorNormalizado);
    return !esActor && items.findIndex((item) => item && normalizarNombre(item.usuario) === clave) === index;
  });
  if (!destinatarios.length) return { encolado: false, razon: "responsable_sin_usuario" };

  let clienteNombre = null;
  if (tarea.cliente_id) {
    const cliente = await pool.query("SELECT nombre FROM clientes WHERE id = $1", [tarea.cliente_id]);
    clienteNombre = cliente.rows[0]?.nombre || null;
  }
  const mensaje = crearMensajePrivadoTarea({
    tarea, clienteNombre, motivo, detalle, appUrl: env.APP_URL || APP_URL_POR_DEFECTO,
  });
  const eventVersion = tarea.updated_at || tarea.created_at || tarea.fecha_vencimiento || "sin-version";
  const entregas = [];
  for (const destinatario of destinatarios) {
    const destinatarioClave = normalizarNombre(destinatario.usuario);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify([
      ...(byId ? ["task-recipient-id-v1", Number(tarea.id), motivo, destinatario.id, tarea.revision ?? eventVersion]
        : [Number(tarea.id), motivo, destinatarioClave, eventVersion]), String(detalle || "").trim(),
    ])).digest("hex");
    const result = await pool.query(
      `INSERT INTO mia_private_task_notifications
        (fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,detalles)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT(fingerprint) DO NOTHING
       RETURNING id,fingerprint`,
      [fingerprint, destinatario.nombre, destinatarioClave, tarea.id, motivo, mensaje.text, mensaje.url,
        JSON.stringify({ cliente: clienteNombre, actor: actor || null,
          destinatario_usuario_id: destinatario.id,
          ...(actorById ? { actor_usuario_id: actorId } : {}) })],
    );
    if (result.rows[0]) entregas.push(result.rows[0]);
  }
  return { encolado: entregas.length > 0, entregas, duplicadas: destinatarios.length - entregas.length };
}
