import { normalizarNombre } from "./email-notifications.js";
import { feedbackFingerprint } from "./feedback-workflow.js";

const APP_URL_POR_DEFECTO = "https://sistema.rendercorrientes.com";

async function resolverUsuarios(pool, nombres) {
  const { rows } = await pool.query("SELECT usuario, nombre FROM usuarios");
  return nombres.map((nombre) => {
    const buscado = normalizarNombre(nombre);
    return rows.find((usuario) => normalizarNombre(usuario.usuario) === buscado
      || normalizarNombre(usuario.nombre) === buscado) || null;
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

export async function encolarNotificacionPrivadaFeedback({ pool, nota, actor = "", env = process.env }) {
  const nombres = Array.isArray(nota.feedback?.responsables) ? nota.feedback.responsables : [];
  const usuarios = await resolverUsuarios(pool, nombres);
  const actorNormalizado = normalizarNombre(actor);
  const destinatarios = usuarios.filter((usuario, index, items) => usuario
    && ![usuario.nombre, usuario.usuario].some((value) => normalizarNombre(value) === actorNormalizado)
    && items.findIndex((item) => item && normalizarNombre(item.usuario) === normalizarNombre(usuario.usuario)) === index);
  if (!destinatarios.length) return { encolado: false, razon: "responsable_sin_usuario" };
  const mensaje = crearMensajePrivadoFeedback({ nota, appUrl: env.APP_URL || APP_URL_POR_DEFECTO });
  const entregas = [];
  for (const destinatario of destinatarios) {
    const clave = normalizarNombre(destinatario.usuario);
    const fingerprint = feedbackFingerprint(["feedback", Number(nota.id), clave, nota.updated_at || nota.created_at]);
    const result = await pool.query(
      `INSERT INTO mia_private_task_notifications
        (fingerprint,destinatario,destinatario_clave,tarea_id,feedback_id,motivo,mensaje,tarea_url,detalles)
       VALUES($1,$2,$3,NULL,$4,'feedback',$5,$6,$7::jsonb)
       ON CONFLICT(fingerprint) DO NOTHING RETURNING id,fingerprint`,
      [fingerprint, destinatario.nombre, clave, nota.id, mensaje.text, mensaje.url,
        JSON.stringify({ cliente: nota.feedback?.cliente || null, actor: actor || null })],
    );
    if (result.rows[0]) entregas.push(result.rows[0]);
  }
  return { encolado: entregas.length > 0, entregas, duplicadas: destinatarios.length - entregas.length };
}
