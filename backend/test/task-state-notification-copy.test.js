import test from 'node:test';
import assert from 'node:assert/strict';
import { getStateNotification } from '../src/task-workflow.js';
import { crearContenidoCorreo } from '../src/email-notifications.js';
import { crearMensajePrivadoTarea } from '../src/private-task-notifications.js';
import { buildMiaPendingEvent } from '../src/wilson-integration.js';

// Real workflow -> both real renderers, offline. No recipient resolution,
// queue, SMTP or database claim. Legacy event keys must remain compatible.
for (const estado of ['finalizada', 'publicada']) {
  test(`${estado}: completion notice describes work, never an assignment or effective publication`, () => {
    const task = Object.freeze({ id: 42, revision: 3, titulo: 'Edición QA', estado,
      propiedades_extra: Object.freeze({ workspace: 'render_os' }) });
    const before = JSON.stringify(task);
    const event = getStateNotification(task, 'aprobada');
    assert.equal(event.motivo, estado);
    const mail = crearContenidoCorreo({ tarea: task, destinatario: { nombre: 'QA' }, motivo: event.motivo });
    const privateMessage = crearMensajePrivadoTarea({ tarea: task, motivo: event.motivo });
    for (const value of [mail.subject, mail.text, mail.html, privateMessage.text]) {
      assert.match(value, /La tarea fue finalizada/);
      assert.doesNotMatch(value, /nueva tarea|tarea fue publicada|publicación realizada/i);
    }
    assert.match(mail.text, /workspace\/tareas\?task=42/);
    assert.match(privateMessage.url, /workspace\/tareas\?task=42/);
    assert.equal(JSON.stringify(task), before, 'Rendering must not reinterpret historical rows');
    assert.equal(getStateNotification(task, estado), null, 'No duplicate state transition');
  });
}

test('creation retains its assignment message in both channels', () => {
  const tarea = { id: 42, titulo: 'QA', propiedades_extra: { workspace: 'render_os' } };
  assert.match(crearContenidoCorreo({ tarea, destinatario: { nombre: 'QA' } }).subject, /Tenés una nueva tarea/);
  assert.match(crearMensajePrivadoTarea({ tarea }).text, /Tenés una nueva tarea/);
});

for (const tipo of ['tarea_publicada', 'tarea_finalizada']) {
  test(`MIA ${tipo}: historical task markers do not assert editorial publication`, () => {
    const task = { id: 42, titulo: 'Edición QA', propiedades_extra: {
      mia_notificacion_pendiente: { tipo, destino: 'edicion', creado_en: '2026-10-25T12:00:00Z' },
    } };
    const before = JSON.stringify(task);
    const event = buildMiaPendingEvent(task);
    assert.equal(event.text, 'Tarea finalizada: Edición QA');
    assert.equal(event.type, tipo);
    assert.equal(event.id, `42:2026-10-25T12:00:00Z:${tipo}`);
    assert.equal(event.destination, 'edicion');
    assert.equal(JSON.stringify(task), before);
  });
}
