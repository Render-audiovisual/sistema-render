import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarDestinatario, notificarAsignacionTarea } from '../src/email-notifications.js';
import { encolarNotificacionPrivadaTarea } from '../src/private-task-notifications.js';

// Query-contract tests, not a substitute for physical PostgreSQL filtering.
test('legacy email resolution excludes inactive accounts in the database query', async () => {
  const pool = { async query(sql) {
    assert.match(sql, /activo IS TRUE/);
    assert.doesNotMatch(sql, /email_notificaciones IS NOT NULL/);
    return { rows: [{ id: 12, usuario: 'qa_active', nombre: 'QA', email_notificaciones: 'qa@example.invalid' }] };
  } };
  assert.equal((await buscarDestinatario(pool, 'QA')).usuario, 'qa_active');
});

test('legacy private notification does not enqueue when no active account matches', async () => {
  let reads = 0;
  const pool = { async query(sql) {
    assert.match(sql, /^SELECT id, usuario, nombre FROM usuarios WHERE activo IS TRUE$/);
    reads++; return { rows: [] };
  } };
  const result = await encolarNotificacionPrivadaTarea({ pool, tarea: { id: 1, titulo: 'QA' },
    nombresDestinatarios: ['Franco'], actor: 'Editor QA', motivo: 'revision' });
  assert.equal(reads, 1); assert.equal(result.encolado, false);
});

test('legacy email pipeline stops before SMTP when the active lookup is empty', async () => {
  let sends = 0;
  const result = await notificarAsignacionTarea({
    pool: { async query(sql) { assert.match(sql, /activo IS TRUE/); return { rows: [] }; } },
    tarea: { id: 1, titulo: 'QA' }, nombresDestinatarios: ['Franco'], actor: 'Editor QA', motivo: 'revision',
    env: { SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'qa', SMTP_PASS: 'synthetic' },
    transporter: { async sendMail() { sends++; assert.fail('Inactive account must not receive email'); } },
  });
  assert.equal(result.enviado, false); assert.equal(sends, 0);
});
