import test from 'node:test';
import assert from 'node:assert/strict';
import {crearMensajePrivadoTarea} from '../src/private-task-notifications.js';
import {crearContenidoCorreo} from '../src/email-notifications.js';

test('correction is an explicit decision notice, not a new task or comment', () => {
  const options = {tarea: {id: 12, titulo: 'Video QA', propiedades_extra: {workspace: 'render_os'}},
    destinatario: {nombre: 'Editor QA'}, motivo: 'correcciones', detalle: 'Corregir audio <script>privado</script>',
    clienteNombre: 'Cliente QA', appUrl: 'https://example.invalid'};
  const privateMessage = crearMensajePrivadoTarea(options), email = crearContenidoCorreo(options);
  assert.match(privateMessage.text, /Correcciones solicitadas/);
  assert.match(email.subject, /Correcciones solicitadas/);
  assert.match(email.text, /Corregir audio <script>privado<\/script>/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;privado&lt;\/script&gt;/);
  for (const message of [privateMessage.text, email.text, email.html]) assert.match(message, /workspace\/tareas\?task=12/);
});
