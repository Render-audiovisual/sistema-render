import nodemailer from "nodemailer";

const APP_URL_POR_DEFECTO = "https://sistema-render-xuwo.onrender.com";

const USUARIO_POR_RESPONSABLE = new Map([
  ["agus", "lider"],
  ["agustin", "lider"],
  ["franco", "lider"],
  ["lider", "lider"],
]);

export function normalizarNombre(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function escaparHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function configuracionCorreoDisponible(env = process.env) {
  return Boolean(
    env.SMTP_HOST &&
      env.SMTP_USER &&
      env.SMTP_PASS &&
      (env.EMAIL_FROM || env.SMTP_USER),
  );
}

export async function buscarDestinatario(pool, asignadoA) {
  const responsable = normalizarNombre(asignadoA);
  const usuarioEsperado = USUARIO_POR_RESPONSABLE.get(responsable);
  const { rows } = await pool.query(
    `SELECT usuario, nombre, email_notificaciones
     FROM usuarios
     WHERE email_notificaciones IS NOT NULL`,
  );

  return (
    rows.find((usuario) => {
      const usuarioNormalizado = normalizarNombre(usuario.usuario);
      if (usuarioEsperado) return usuarioNormalizado === usuarioEsperado;
      return (
        usuarioNormalizado === responsable ||
        normalizarNombre(usuario.nombre) === responsable
      );
    }) || null
  );
}

export function crearContenidoCorreo({
  tarea,
  destinatario,
  clienteNombre,
  motivo = "creada",
  appUrl = APP_URL_POR_DEFECTO,
}) {
  const tituloAccion =
    motivo === "reasignada"
      ? "Te reasignaron una tarea"
      : "Tenés una nueva tarea";
  const enlace = `${appUrl.replace(/\/$/, "")}/piezas?tarea=${encodeURIComponent(
    tarea.id,
  )}`;
  const fecha = tarea.fecha_vencimiento || "Sin fecha definida";
  const prioridad = tarea.prioridad || "media";
  const cliente = clienteNombre || "Sin cliente";

  return {
    subject: `${tituloAccion}: ${tarea.titulo}`,
    text: [
      `Hola ${destinatario.nombre},`,
      "",
      `${tituloAccion} en RENDER Platform.`,
      `Cliente: ${cliente}`,
      `Tarea: ${tarea.titulo}`,
      `Fecha de entrega: ${fecha}`,
      `Prioridad: ${prioridad}`,
      `Abrir tarea: ${enlace}`,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;color:#202124;line-height:1.5">
        <h2 style="margin-bottom:8px">${escaparHtml(tituloAccion)}</h2>
        <p>Hola ${escaparHtml(destinatario.nombre)},</p>
        <p>Tenés una asignación en RENDER Platform.</p>
        <ul>
          <li><strong>Cliente:</strong> ${escaparHtml(cliente)}</li>
          <li><strong>Tarea:</strong> ${escaparHtml(tarea.titulo)}</li>
          <li><strong>Fecha de entrega:</strong> ${escaparHtml(fecha)}</li>
          <li><strong>Prioridad:</strong> ${escaparHtml(prioridad)}</li>
        </ul>
        <p>
          <a href="${escaparHtml(enlace)}"
             style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">
            Abrir tarea
          </a>
        </p>
      </div>
    `,
  };
}

function crearTransporter(env = process.env) {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 465),
    secure: String(env.SMTP_SECURE ?? "true").toLowerCase() === "true",
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    // Render no siempre tiene salida IPv6 completa, y Gmail SMTP resuelve a
    // IPv6 cuando está disponible — sin esto la conexión falla con
    // ENETUNREACH antes de intentar autenticar. Forzar IPv4 evita ese salto.
    family: 4,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export async function notificarAsignacionTarea({
  pool,
  tarea,
  motivo = "creada",
  env = process.env,
  transporter,
}) {
  if (!configuracionCorreoDisponible(env)) {
    return { enviado: false, razon: "correo_no_configurado" };
  }

  const destinatario = await buscarDestinatario(pool, tarea.asignado_a);
  if (!destinatario?.email_notificaciones) {
    return { enviado: false, razon: "responsable_sin_correo" };
  }

  let clienteNombre = null;
  if (tarea.cliente_id) {
    const cliente = await pool.query(
      "SELECT nombre FROM clientes WHERE id = $1",
      [tarea.cliente_id],
    );
    clienteNombre = cliente.rows[0]?.nombre || null;
  }

  const contenido = crearContenidoCorreo({
    tarea,
    destinatario,
    clienteNombre,
    motivo,
    appUrl: env.APP_URL || APP_URL_POR_DEFECTO,
  });

  const mailer = transporter || crearTransporter(env);
  const info = await mailer.sendMail({
    from: env.EMAIL_FROM || env.SMTP_USER,
    to: destinatario.email_notificaciones,
    replyTo: env.EMAIL_REPLY_TO || undefined,
    ...contenido,
  });

  return {
    enviado: true,
    destinatario: destinatario.email_notificaciones,
    messageId: info.messageId,
  };
}

export function notificarAsignacionSinInterrumpir(opciones) {
  void notificarAsignacionTarea(opciones)
    .then((resultado) => {
      if (!resultado.enviado && resultado.razon !== "correo_no_configurado") {
        console.warn(
          `Notificación de tarea ${opciones.tarea.id} omitida: ${resultado.razon}`,
        );
      }
    })
    .catch((error) => {
      console.error(
        `No se pudo enviar la notificación de la tarea ${opciones.tarea.id}:`,
        error.message,
      );
    });
}
