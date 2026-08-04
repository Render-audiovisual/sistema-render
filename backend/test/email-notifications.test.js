import assert from "node:assert/strict";
import test from "node:test";
import {
  buscarDestinatario,
  configuracionCorreoDisponible,
  crearContenidoCorreo,
  enviarInstruccionesAcceso,
  normalizarNombre,
  notificarAsignacionTarea,
  responsablesNotificables,
  resolverSMTPIPv4,
} from "../src/email-notifications.js";

const usuarios = [
  {
    usuario: "lider",
    nombre: "Líder",
    email_notificaciones: "lider@example.com",
  },
  {
    usuario: "German",
    nombre: "Germán",
    email_notificaciones: "german@example.com",
  },
];

const pool = {
  async query() {
    return { rows: usuarios };
  },
};

test("normaliza acentos y mayúsculas", () => {
  assert.equal(normalizarNombre("  GERMÁN "), "german");
});

test("resuelve Germán por nombre y Líder para Agus o Franco", async () => {
  assert.equal(
    (await buscarDestinatario(pool, "Germán")).email_notificaciones,
    "german@example.com",
  );
  assert.equal(
    (await buscarDestinatario(pool, "Agus")).email_notificaciones,
    "lider@example.com",
  );
  assert.equal(
    (await buscarDestinatario(pool, "Franco")).email_notificaciones,
    "lider@example.com",
  );
});

test("RENDER OS notifica al responsable principal y a colaboradores sin duplicados", async () => {
  const tarea = {
    id: 45,
    titulo: "Tarea compartida",
    asignado_a: "Germán",
    propiedades_extra: { workspace: "render_os", colaboradores: ["Agus", "GERMÁN"] },
  };
  assert.deepEqual(responsablesNotificables(tarea), ["Germán", "Agus"]);
  const enviados = [];
  const result = await notificarAsignacionTarea({
    pool,
    tarea,
    env: { SMTP_HOST: "smtp.example.com", SMTP_USER: "render@example.com", SMTP_PASS: "secret" },
    transporter: {
      async sendMail(options) {
        enviados.push(options.to);
        return { messageId: `mail-${enviados.length}` };
      },
    },
  });
  assert.equal(result.enviado, true);
  assert.deepEqual(enviados.sort(), ["german@example.com", "lider@example.com"]);
});

test("solo considera configurado el correo con credenciales completas", () => {
  assert.equal(configuracionCorreoDisponible({}), false);
  assert.equal(
    configuracionCorreoDisponible({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
      SMTP_PASS: "secret",
    }),
    true,
  );
});

test("arma el aviso RENDER OS con los datos operativos y enlace directo", () => {
  const contenido = crearContenidoCorreo({
    tarea: {
      id: 42,
      titulo: "Carrusel de prueba",
      fecha_vencimiento: "2026-07-25",
      prioridad: "alta",
      propiedades_extra: { workspace: "render_os" },
    },
    destinatario: usuarios[1],
    clienteNombre: "Luzin",
    appUrl: "https://plataforma.example.com/",
  });

  assert.match(contenido.subject, /Carrusel de prueba/);
  assert.match(contenido.text, /Cliente: Luzin/);
  assert.match(contenido.text, /Fecha de entrega: 2026-07-25/);
  assert.match(contenido.text, /workspace\/tareas\?task=42/);
});

test("conserva el enlace histórico para tareas sin workspace RENDER OS", () => {
  const contenido = crearContenidoCorreo({
    tarea: {
      id: 43,
      titulo: "Tarea histórica",
      propiedades_extra: {},
    },
    destinatario: usuarios[1],
    appUrl: "https://plataforma.example.com/",
  });

  assert.match(contenido.text, /\/piezas\?tarea=43/);
  assert.doesNotMatch(contenido.text, /workspace\/tareas/);
});

test("distingue comentarios, revisión y bloqueos en las notificaciones", () => {
  const base = {
    tarea: { id: 42, titulo: "Carrusel de prueba", prioridad: "alta", propiedades_extra: { workspace: "render_os" } },
    destinatario: usuarios[1],
    detalle: "Agustín: falta el material",
  };

  assert.match(crearContenidoCorreo({ ...base, motivo: "comentario" }).subject, /comentario nuevo/i);
  assert.match(crearContenidoCorreo({ ...base, motivo: "revision" }).subject, /pasó a revisión/i);
  const bloqueo = crearContenidoCorreo({ ...base, motivo: "bloqueada" });
  assert.match(bloqueo.subject, /bloqueo/i);
  assert.match(bloqueo.text, /Agustín: falta el material/);
});

test("resuelve SMTP a IPv4 sin perder el hostname usado por TLS", async () => {
  let opcionesRecibidas = null;
  const destino = await resolverSMTPIPv4(
    "smtp.gmail.com",
    async (_hostname, opciones) => {
      opcionesRecibidas = opciones;
      return { address: "142.250.0.108", family: 4 };
    },
  );

  assert.deepEqual(opcionesRecibidas, { family: 4 });
  assert.deepEqual(destino, {
    address: "142.250.0.108",
    servername: "smtp.gmail.com",
  });
});

test("las instrucciones de acceso usan Hostinger y nunca incluyen contraseñas", async () => {
  let correo = null;
  const result = await enviarInstruccionesAcceso({
    usuario: {
      nombre: "Augusto",
      email_notificaciones: "augusto@example.com",
      google_email: "augusto@example.com",
    },
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "render@example.com",
      SMTP_PASS: "secret",
    },
    transporter: {
      async sendMail(options) {
        correo = options;
        return { messageId: "test-message" };
      },
    },
  });

  assert.equal(result.enviado, true);
  assert.equal(correo.to, "augusto@example.com");
  assert.match(correo.text, /https:\/\/sistema\.rendercorrientes\.com\/login/);
  assert.doesNotMatch(correo.text, /onrender\.com/);
  assert.doesNotMatch(correo.text, /contraseña temporal/i);
});
