import assert from "node:assert/strict";
import test from "node:test";
import {
  buscarDestinatario,
  configuracionCorreoDisponible,
  crearContenidoCorreo,
  normalizarNombre,
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

test("arma el aviso con los datos operativos y enlace directo", () => {
  const contenido = crearContenidoCorreo({
    tarea: {
      id: 42,
      titulo: "Carrusel de prueba",
      fecha_vencimiento: "2026-07-25",
      prioridad: "alta",
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

test("distingue comentarios, revisión y bloqueos en las notificaciones", () => {
  const base = {
    tarea: { id: 42, titulo: "Carrusel de prueba", prioridad: "alta" },
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
