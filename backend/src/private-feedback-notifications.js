import { normalizarNombre } from "./email-notifications.js";
import { feedbackFingerprint } from "./feedback-workflow.js";
import { normalizeFeedbackResponsibleIds } from '../../shared/feedback-responsibles.mjs';

const APP_URL_POR_DEFECTO = "https://sistema.rendercorrientes.com";
const positiveId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

async function resolverUsuarios(pool, nombres) {
  const { rows } = await pool.query("SELECT id, usuario, nombre FROM usuarios WHERE activo IS TRUE");
  return nombres.map((nombre) => {
    const buscado = normalizarNombre(nombre);
    if (!buscado) return null;
    const matches = new Map(rows.filter(usuario => positiveId(usuario.id)
      && (normalizarNombre(usuario.usuario) === buscado || normalizarNombre(usuario.nombre) === buscado))
      .map(usuario => [usuario.id, usuario]));
    // Display labels are not identities. Never choose the first homonym or
    // fan out an ambiguous label; preserve the note without guessing a target.
    return matches.size === 1 ? matches.values().next().value : null;
  });
}

export function crearMensajePrivadoFeedback({ nota, appUrl = APP_URL_POR_DEFECTO }) {
  const cliente = nota.feedback?.cliente || "Equipo RENDER";
  const url = `${appUrl.replace(/\/$/, "")}/feedback?section=${nota.feedback?.cliente ? "clients" : "team"}&note=${encodeURIComponent(nota.id)}`;
  return {
    text: [`💬 Tenés un feedback nuevo`, `${cliente} · ${nota.titulo}`, `Estado: ${nota.feedback?.estado || "pendiente"}`, `Abrir feedback: ${url}`].join("\n"),
    url,
  };
}

export async function encolarNotificacionPrivadaFeedback({ pool, nota, actor = "", actorId, env = process.env }) {
  const actorById = actorId !== undefined;
  if (actorById && !positiveId(actorId)) throw Object.assign(new Error("Actor de notificación inválido."), {status:400});
  const nombres = Array.isArray(nota.feedback?.responsables) ? nota.feedback.responsables : [];
  const explicit = Object.hasOwn(nota.feedback ?? {},'responsable_ids');
  const ids = explicit ? normalizeFeedbackResponsibleIds(nota.feedback.responsable_ids) : null;
  const usuarios = explicit ? ids.length ? (await pool.query(
    'SELECT id,usuario,nombre FROM usuarios WHERE id=ANY($1::integer[]) AND activo IS TRUE ORDER BY id',[ids]
  )).rows.filter(row => ids.includes(row.id)) : [] : await resolverUsuarios(pool, nombres);
  const actorNormalizado = normalizarNombre(actor);
  const destinatarios = usuarios.filter((usuario, index, items) => usuario && positiveId(usuario.id)
    && !(actorById ? usuario.id === actorId : [usuario.nombre, usuario.usuario].some((value) => normalizarNombre(value) === actorNormalizado))
    && items.findIndex((item) => item?.id === usuario.id) === index);
  if (!destinatarios.length) return { encolado: false, razon: "responsable_sin_usuario" };
  const mensaje = crearMensajePrivadoFeedback({ nota, appUrl: env.APP_URL || APP_URL_POR_DEFECTO });
  const entregas = [];
  for (const destinatario of destinatarios) {
    const clave = normalizarNombre(destinatario.usuario);
    const fingerprint = feedbackFingerprint(["feedback-recipient-id-v1", Number(nota.id), destinatario.id, nota.updated_at || nota.created_at]);
    const result = await pool.query(
      `INSERT INTO mia_private_task_notifications
        (fingerprint,destinatario,destinatario_clave,tarea_id,feedback_id,motivo,mensaje,tarea_url,detalles)
       VALUES($1,$2,$3,NULL,$4,'feedback',$5,$6,$7::jsonb)
       ON CONFLICT(fingerprint) DO NOTHING RETURNING id,fingerprint`,
      [fingerprint, destinatario.nombre, clave, nota.id, mensaje.text, mensaje.url,
        JSON.stringify({ cliente: nota.feedback?.cliente || null, actor: actor || null,
          destinatario_usuario_id: destinatario.id, ...(actorById ? {actor_usuario_id:actorId} : {}) })],
    );
    if (result.rows[0]) entregas.push(result.rows[0]);
  }
  return { encolado: entregas.length > 0, entregas, duplicadas: destinatarios.length - entregas.length };
}
