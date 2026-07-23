import assert from "node:assert/strict";
import test from "node:test";
import {
  buscarDestinatario,
  configuracionCorreoDisponible,
  crearContenidoCorreo,
  normalizarNombre,
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
  assert.match(contenido.text, /piezas\?tarea=42/);
});
