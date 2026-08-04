import nodemailer from "nodemailer";
import { promises as dns } from "node:dns";

const APP_URL_POR_DEFECTO = "https://sistema.rendercorrientes.com";

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
  detalle = "",
  appUrl = APP_URL_POR_DEFECTO,
}) {
  const tituloAccion = ({
    reasignada: "Te reasignaron una tarea",
    comentario: "Hay un comentario nuevo en tu tarea",
    revision: "La tarea pasó a revisión",
    bloqueada: "Hay un bloqueo en tu tarea",
  })[motivo] || "Tenés una nueva tarea";
  const esRenderOS = tarea.propiedades_extra?.workspace === "render_os";
  const rutaTarea = esRenderOS
    ? `/workspace/tareas?task=${encodeURIComponent(tarea.id)}`
    : `/piezas?tarea=${encodeURIComponent(tarea.id)}`;
  const enlace = `${appUrl.replace(/\/$/, "")}${rutaTarea}`;
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
      ...(detalle ? [`Detalle: ${detalle}`] : []),
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
        ${detalle ? `<p><strong>Detalle:</strong> ${escaparHtml(detalle)}</p>` : ""}
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

export async function resolverSMTPIPv4(
  hostname,
  lookup = dns.lookup,
) {
  const resultado = await lookup(hostname, { family: 4 });
  const address =
    typeof resultado === "string" ? resultado : resultado?.address;

  if (!address) {
    throw new Error(`No se pudo resolver una dirección IPv4 para ${hostname}`);
  }

  return {
    address,
    servername: hostname,
  };
}

async function crearTransporter(env = process.env) {
  const destino = await resolverSMTPIPv4(env.SMTP_HOST);

  return nodemailer.createTransport({
    // Nodemailer hace su propia resolución DNS. Pasarle directamente la IPv4
    // evita que vuelva a elegir una dirección IPv6 sin salida en Render.
    host: destino.address,
    port: Number(env.SMTP_PORT || 465),
    secure: String(env.SMTP_SECURE ?? "true").toLowerCase() === "true",
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    // Aunque el socket se abra contra una IP, TLS debe validar el certificado
    // contra el hostname original de Gmail.
    tls: {
      servername: destino.servername,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export async function notificarAsignacionTarea({
  pool,
  tarea,
  motivo = "creada",
  detalle = "",
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
    detalle,
    appUrl: env.APP_URL || APP_URL_POR_DEFECTO,
  });

  const mailer = transporter || (await crearTransporter(env));
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

export async function enviarInstruccionesAcceso({ usuario, env = process.env, transporter }) {
  if (!configuracionCorreoDisponible(env)) {
    return { enviado: false, razon: "correo_no_configurado" };
  }
  if (!usuario?.email_notificaciones) {
    return { enviado: false, razon: "usuario_sin_correo" };
  }

  const appUrl = (env.APP_URL || APP_URL_POR_DEFECTO).replace(/\/$/, "");
  const googleDisponible = Boolean(usuario.google_email);
  const contenido = {
    subject: "Tu acceso a RENDER Platform",
    text: [
      `Hola ${usuario.nombre},`,
      "",
      "Tu cuenta de RENDER Platform está preparada.",
      `Ingresá desde: ${appUrl}/login`,
      googleDisponible
        ? `Podés continuar con la cuenta de Google ${usuario.google_email}.`
        : `Podés ingresar con ${usuario.email_notificaciones} y tu contraseña actual.`,
      "Si no conocés tu contraseña, pedile al Líder que coordine una recuperación segura.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;color:#202124;line-height:1.5">
        <h2>Tu acceso a RENDER Platform</h2>
        <p>Hola ${escaparHtml(usuario.nombre)},</p>
        <p>Tu cuenta está preparada.</p>
        <p>${googleDisponible
          ? `Podés continuar con la cuenta de Google <strong>${escaparHtml(usuario.google_email)}</strong>.`
          : `Podés ingresar con <strong>${escaparHtml(usuario.email_notificaciones)}</strong> y tu contraseña actual.`}</p>
        <p><a href="${escaparHtml(`${appUrl}/login`)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Ingresar a RENDER</a></p>
        <p style="color:#667085;font-size:13px">Si no conocés tu contraseña, pedile al Líder que coordine una recuperación segura.</p>
      </div>
    `,
  };

  const mailer = transporter || (await crearTransporter(env));
  const info = await mailer.sendMail({
    from: env.EMAIL_FROM || env.SMTP_USER,
    to: usuario.email_notificaciones,
    replyTo: env.EMAIL_REPLY_TO || undefined,
    ...contenido,
  });
  return { enviado: true, destinatario: usuario.email_notificaciones, messageId: info.messageId };
}

export function notificarAsignacionSinInterrumpir(opciones) {
  void notificarAsignacionTarea(opciones)
    .then((resultado) => {
      if (resultado.enviado) {
        console.info(`Notificación de tarea ${opciones.tarea.id} enviada.`);
        return;
      }
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
