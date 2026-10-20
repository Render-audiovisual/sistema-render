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
  {
    usuario: "Franco",
    nombre: "Franco Romero",
    email_notificaciones: "franco@example.com",
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

test("avisos por ID no confunden homónimos ni excluyen al destinatario por nombre", async () => {
  const enviados = [];
  const result = await notificarAsignacionTarea({
    pool: { async query(sql, params) {
      assert.match(sql, /id=ANY/);
      assert.deepEqual(params, [[11, 12]]);
      return { rows: [
        { id: 11, nombre: 'Agustín', usuario: 'owner_a', email_notificaciones: 'actor@example.com' },
        { id: 12, nombre: 'Agustín', usuario: 'member_a', email_notificaciones: 'member@example.com' },
      ] };
    } },
    tarea: { id: 87, titulo: 'Prueba por identidad' },
    destinatarioIds: [11, 12, 12], actorId: 11, actor: 'Agustín',
    env: { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'test@example.com', SMTP_PASS: 'fixture' },
    transporter: { async sendMail(options) { enviados.push(options.to); return { messageId: 'fake' }; } },
  });
  assert.equal(result.enviado, true);
  assert.deepEqual(enviados, ['member@example.com']);
  await assert.rejects(notificarAsignacionTarea({ destinatarioIds: ['12'], actorId: 11, env: {} }), { status: 400 });
});

test("resuelve Germán, el Líder y Franco sin mezclar sus cuentas", async () => {
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
    "franco@example.com",
  );
});

test("los avisos de flujo excluyen a la persona que realizó la acción", async () => {
  const enviados = [];
  const result = await notificarAsignacionTarea({
    pool,
    tarea: { id: 48, titulo: "Video para revisar", propiedades_extra: { workspace: "render_os" } },
    motivo: "revision",
    nombresDestinatarios: ["Agustín", "Franco"],
    actor: "Franco Romero",
    env: { SMTP_HOST: "smtp.example.com", SMTP_USER: "render@example.com", SMTP_PASS: "secret" },
    transporter: { async sendMail(options) { enviados.push(options.to); return { messageId: "mail-flow" }; } },
  });
  assert.equal(result.enviado, true);
  assert.deepEqual(enviados, ["lider@example.com"]);
});

test("RENDER OS notifica a todas las personas responsables sin duplicados", async () => {
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
  assert.match(crearContenidoCorreo({ ...base, motivo: "en_progreso" }).subject, /comenzó/i);
  assert.match(crearContenidoCorreo({ ...base, motivo: "publicada" }).subject, /publicada/i);
  assert.match(crearContenidoCorreo({ ...base, motivo: "aprobada" }).subject, /lista para publicar/i);
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

const invitationEnv = {
  SMTP_HOST: 'smtp.example.test', SMTP_USER: 'sender@example.test', SMTP_PASS: 'smtp-secret-not-for-body',
  EMAIL_FROM: 'Render <sender@example.test>', EMAIL_REPLY_TO: 'support@example.test', APP_URL: 'https://render.example.test/',
};
async function captureInvitation(usuario) {
  const messages = [];
  const result = await enviarInstruccionesAcceso({ usuario, env: invitationEnv,
    transporter: { async sendMail(message) { messages.push(message); return { messageId: 'fake-invitation' }; } },
  });
  return { result, messages };
}

test('invitación sin Google distingue destinatario de avisos y usuario real de acceso, sin incluir secretos', async () => {
  const usuario = { id: 87, nombre: 'Persona QA', usuario: 'cuenta_operativa_87', email_notificaciones: 'avisos-distintos@example.test', google_email: null,
    password: 'password-fixture-never-send', password_hash: '$2b$10$hash-fixture-never-send', google_id: 'google-id-never-send', session_version: 81234 };
  const before = structuredClone(usuario);
  const { result, messages } = await captureInvitation(usuario);
  assert.deepEqual(result, { enviado: true, destinatario: usuario.email_notificaciones, messageId: 'fake-invitation' });
  assert.equal(messages.length, 1);
  const message = messages[0];
  assert.equal(message.to, usuario.email_notificaciones);
  assert.equal(message.from, invitationEnv.EMAIL_FROM); assert.equal(message.replyTo, invitationEnv.EMAIL_REPLY_TO);
  assert.match(message.text, /usuario de acceso cuenta_operativa_87 y tu contraseña actual/);
  assert.match(message.html, /usuario de acceso <strong>cuenta_operativa_87<\/strong>/);
  assert.match(message.text, /https:\/\/render\.example\.test\/login/);
  for (const body of [message.text,message.html]) {
    assert.ok(!body.includes(usuario.email_notificaciones));
    for (const secret of [usuario.password,usuario.password_hash,usuario.google_id,invitationEnv.SMTP_PASS]) assert.ok(!body.includes(secret));
  }
  assert.deepEqual(usuario,before);
});

test('invitación conserva únicamente la cuenta Google explícita cuando difiere del login y del correo de avisos', async () => {
  const usuario = { nombre: 'Persona QA', usuario: 'login_distinto', email_notificaciones: 'solo-avisos@example.test', google_email: 'google-configurado@example.test', password_hash: 'never-send-hash' };
  const { result,messages } = await captureInvitation(usuario);
  assert.equal(result.enviado,true); assert.equal(messages.length,1); assert.equal(messages[0].to,usuario.email_notificaciones);
  for (const body of [messages[0].text,messages[0].html]) {
    assert.ok(body.includes('Podés continuar con la cuenta de Google'));
    assert.ok(body.includes(usuario.google_email));
    assert.ok(!body.includes(usuario.email_notificaciones)); assert.ok(!body.includes(usuario.usuario)); assert.ok(!body.includes(usuario.password_hash));
  }
});

test('usuario de acceso se conserva literal en texto y escapado en HTML, sin inventar identidad desde avisos', async () => {
  const login = 'cuenta<&"\'>'; const { messages } = await captureInvitation({nombre:'Persona',usuario:login,email_notificaciones:'avisos@example.test',google_email:null});
  assert.equal(messages.length,1); assert.ok(messages[0].text.includes(login));
  assert.ok(messages[0].html.includes('cuenta&lt;&amp;&quot;&#039;&gt;')); assert.ok(!messages[0].html.includes(login));
});

test('sin login ni Google explícito no envía instrucciones falsas ni usa el correo de avisos como identidad', async () => {
  for (const usuario of [undefined,null,'', '  ', 87, {}]) {
    const { result,messages } = await captureInvitation({nombre:'Persona',usuario,email_notificaciones:'avisos@example.test',google_email:null});
    assert.deepEqual(result,{enviado:false,razon:'usuario_sin_login'}); assert.deepEqual(messages,[]);
  }
  // The unchanged Google branch remains independently actionable.
  const { result,messages } = await captureInvitation({nombre:'Persona',email_notificaciones:'avisos@example.test',google_email:'google@example.test'});
  assert.equal(result.enviado,true); assert.equal(messages.length,1);
});
