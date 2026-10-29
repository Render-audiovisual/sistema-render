import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { runScheduledEditorial } from '../src/scheduled-editorial.js';
import { readGoals } from '../src/client-goals.js';
import { runMiaSupervisor, notificationContactAllowed } from '../src/mia-supervisor.js';

test('scheduled domains: real editorial reconciliation and supervisor queue replay', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port = 56028;
  const f = await startLocalHarness({ port, clusterOnly: true });
  const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'render2_fixture', database: 'render2_local_test',
    password: '', ssl: false, max: 4, statement_timeout: 15000, lock_timeout: 10000,
    connectionTimeoutMillis: 5000, application_name: 'owned_scheduled_domains_test' });
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw Error('External providers forbidden in this fixture'); };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    try { await pool.end(); } finally {
      await f.cleanup();
      await assert.rejects(access(f.root), { code: 'ENOENT' });
      t.diagnostic('Owned PG56028 stopped and removed; no web server, delivery worker or external messages.');
    }
  });
  const identity = (await pool.query(`SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  const now = new Date('2026-10-02T13:00:00Z');
  const clientId = (await pool.query(`INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles)
    VALUES('Scheduled synthetic client',true,1,1) RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO cliente_objetivo_responsables(clave,tipo,usuario_id,actualizado_por)
    VALUES($1,'video',91003,'Synthetic explicit fixture'),($1,'carrusel',91004,'Synthetic explicit fixture')`, [`cliente-${clientId}`]);
  const rows = async table => (await pool.query(`SELECT to_jsonb(r) data FROM "${table}" r ORDER BY to_jsonb(r)::text`)).rows;
  const editorialState = async () => {
    // Calendar may refresh updated_at on untouched automatic slots. Compare
    // identities, quota, content and assignments rather than volatile stamps.
    const result = {};
    for (const table of ['publicaciones', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'tareas', 'tarea_asignaciones']) {
      result[table] = (await rows(table)).map(({ data }) => {
        const { updated_at, ...business } = data;
        void updated_at;
        return business;
      });
    }
    return result;
  };

  await t.test('actual scheduled editorial creates exact quota once; repeated runs do not duplicate pieces or tasks', async () => {
    try {
      await runScheduledEditorial(pool, { now });
      const goals = (await readGoals(pool, '2026-10')).clientes;
      t.diagnostic(`Goal seed observation: ${JSON.stringify(goals.map(c => ({ clave: c.clave, reels: c.reels, carruseles: c.carruseles, preparado: c.preparado, cuota_desactualizada: c.cuota_desactualizada })))}`);
      const objective = (await pool.query('SELECT id,reels,carruseles FROM cliente_objetivos_mensuales WHERE clave=$1', [`cliente-${clientId}`])).rows;
      assert.equal(objective.length, 1, 'Seeded explicit responsible IDs must prepare one objective');
      assert.equal(objective[0].reels, 1); assert.equal(objective[0].carruseles, 1);
      const pieces = (await pool.query('SELECT tipo,numero,tarea_id,publicacion_id FROM cliente_objetivo_piezas WHERE objetivo_id=$1 ORDER BY tipo', [objective[0].id])).rows;
      assert.deepEqual(pieces.map(p => [p.tipo, p.numero]), [['carrusel', 1], ['video', 1]]);
      assert.ok(pieces.every(p => p.tarea_id && p.publicacion_id));
      assert.equal((await rows('publicaciones')).length, 2);
      assert.equal((await rows('tareas')).length, 2);
      const assignments = (await pool.query(`SELECT p.tipo,a.usuario_id,a.tipo asignacion FROM cliente_objetivo_piezas p
        JOIN tarea_asignaciones a ON a.tarea_id=p.tarea_id ORDER BY p.tipo,a.usuario_id`)).rows;
      assert.deepEqual(assignments, [{ tipo: 'carrusel', usuario_id: 91004, asignacion: 'responsable' }, { tipo: 'video', usuario_id: 91003, asignacion: 'responsable' }]);
      const before = await editorialState();
      await runScheduledEditorial(pool, { now });
      await runScheduledEditorial(pool, { now });
      assert.deepEqual(await editorialState(), before);
    } catch (error) {
      t.diagnostic(`Editorial seed failure (no domain changes attempted): ${error.message}`);
      t.diagnostic(`Persisted goals: ${JSON.stringify(await rows('cliente_objetivos_mensuales'))}`);
      throw error;
    }
  });

  await t.test('actual supervisor repeats without duplicating queue, followups or existing cooldown evidence', async () => {
    const hash = createHash('sha256').update('local-synthetic-supervisor-contact').digest('hex');
    await pool.query('UPDATE usuarios SET whatsapp_habilitado=true,whatsapp_id_hash=$1 WHERE id=91003', [hash]);
    await pool.query(`INSERT INTO mia_whatsapp_identities(actor_hash,usuario_id,notification_key,display_name)
      VALUES($1,91003,'qa_luciano','Synthetic explicit contact')`, [hash]);
    const taskId = (await pool.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,cliente_id,
      propiedades_extra,fecha_vencimiento,created_at,updated_at)
      VALUES('Synthetic overdue task','Not an identity','pendiente','edicion',$1,
      '{"workspace":"render_os"}','2026-10-01','2026-09-30T13:00:00Z','2026-09-30T13:00:00Z') RETURNING id`, [clientId])).rows[0].id;
    await pool.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [taskId]);
    // Synthetic prior cooldown, not a claimed provider delivery. The scan is
    // allowed to enqueue, but must never create/advance delivery receipts.
    await pool.query(`INSERT INTO mia_private_contact_limits(actor_hash,last_delivered_at,supervisor_window)
      VALUES($1,$2,'2026-10-02:am')`, [hash, now]);
    const env = Object.freeze({ MIA_SUPERVISOR_ENABLED: 'true', MIA_SUPERVISOR_REASONING_ENABLED: 'false', APP_URL: 'http://127.0.0.1' });
    const first = await runMiaSupervisor(pool, { dryRun: false, now, env });
    assert.equal(first.enabled, true); assert.equal(first.dry_run, false); assert.equal(first.within_work_hours, true);
    assert.ok(first.queued > 0, 'test must exercise a real outbox insertion');
    const followups = (await pool.query('SELECT usuario_id,attempts,estado FROM mia_supervisor_followups WHERE tarea_id=$1', [taskId])).rows;
    assert.deepEqual(followups, [{ usuario_id: 91003, attempts: 0, estado: 'waiting' }]);
    const notices = (await pool.query('SELECT * FROM mia_private_task_notifications WHERE tarea_id=$1 AND supervisor_followup_id IS NOT NULL', [taskId])).rows;
    assert.equal(notices.length, 1);
    assert.equal(notices[0].destinatario_clave, 'qa_luciano');
    assert.equal(notices[0].estado, 'pending');
    assert.equal(notices[0].delivered_at, null);
    assert.equal(await notificationContactAllowed(pool, notices[0], now), false, 'real cooldown prevents immediate delivery');
    const tables = ['mia_private_task_notifications', 'mia_supervisor_followups', 'mia_supervisor_proposals',
      'mia_supervisor_signals', 'mia_private_contact_limits', 'tarea_comentarios', 'integracion_auditoria'];
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(table)])));
    const before = await snapshot();
    const beforeEditorial = await editorialState();
    for (let i = 0; i < 2; i++) {
      const repeated = await runMiaSupervisor(pool, { dryRun: false, now, env });
      assert.equal(repeated.queued, 0);
      assert.deepEqual(await snapshot(), before);
    }
    assert.deepEqual(await editorialState(), beforeEditorial);
    assert.equal((await rows('mia_private_contact_limits')).length, 1);
    assert.equal(externalCalls, 0);
  });
});
