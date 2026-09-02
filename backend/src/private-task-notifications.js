import crypto from "node:crypto";
import { normalizarNombre, responsablesNotificables } from "./email-notifications.js";

const APP_URL_POR_DEFECTO = "https://sistema.rendercorrientes.com";
const USUARIO_POR_RESPONSABLE = new Map([
  ["agus", "lider"],
  ["agustin", "lider"],
  ["lider", "lider"],
]);

const TITULOS = Object.freeze({
  creada: "Tenés una nueva tarea",
  reasignada: "Te asignaron una tarea",
  comentario: "Hay un comentario nuevo",
  revision: "La tarea pasó a revisión",
  bloqueada: "Hay un bloqueo en la tarea",
  en_progreso: "La tarea comenzó",
  publicada: "La tarea fue publicada",
  aprobada: "La tarea está lista para publicar",
});

async function resolverUsuarios(pool, nombres) {
  const { rows } = await pool.query("SELECT usuario, nombre FROM usuarios");
  return nombres.map((nombre) => {
    const buscado = normalizarNombre(nombre);
    const usuarioEsperado = USUARIO_POR_RESPONSABLE.get(buscado);
    return rows.find((usuario) => usuarioEsperado
      ? normalizarNombre(usuario.usuario) === usuarioEsperado
      : normalizarNombre(usuario.usuario) === buscado || normalizarNombre(usuario.nombre) === buscado) || null;
  });
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
}) {
  const nombres = Array.isArray(nombresDestinatarios) ? nombresDestinatarios : responsablesNotificables(tarea);
  const candidatos = await resolverUsuarios(pool, nombres);
  const actorNormalizado = normalizarNombre(actor);
  const destinatarios = candidatos.filter((candidate, index, items) => {
    if (!candidate) return false;
    const clave = normalizarNombre(candidate.usuario);
    const esActor = actorNormalizado && [candidate.nombre, candidate.usuario]
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
      Number(tarea.id), motivo, destinatarioClave, eventVersion, String(detalle || "").trim(),
    ])).digest("hex");
    const result = await pool.query(
      `INSERT INTO mia_private_task_notifications
        (fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url,detalles)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT(fingerprint) DO NOTHING
       RETURNING id,fingerprint`,
      [fingerprint, destinatario.nombre, destinatarioClave, tarea.id, motivo, mensaje.text, mensaje.url,
        JSON.stringify({ cliente: clienteNombre, actor: actor || null })],
    );
    if (result.rows[0]) entregas.push(result.rows[0]);
  }
  return { encolado: entregas.length > 0, entregas, duplicadas: destinatarios.length - entregas.length };
}
