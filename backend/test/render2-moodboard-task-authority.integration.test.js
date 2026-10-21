import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('moodboard link mutations recheck current authority and task scope after real lock waits', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55723 });
  let pool;
  t.after(async () => { try { if (pool) await pool.end(); } finally { await f.cleanup(); } await assert.rejects(access(f.root), { code: 'ENOENT' }); });
  const guard = { root: f.root, cwd: f.root, port: 55723, url: 'postgresql://render2_fixture@127.0.0.1:55723/render2_local_test' };
  assertFixtureIdentity(guard);
  pool = new pg.Pool({ connectionString: guard.url, max: 5, statement_timeout: 10000, connectionTimeoutMillis: 5000 });
  assertFixtureIdentity({ ...guard, identity: (await pool.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`)).rows[0] });
  const [client] = (await pool.query("INSERT INTO clientes(nombre) VALUES('QA97 authority client') RETURNING id")).rows;
  const [board] = (await pool.query("INSERT INTO moodboard_boards(nombre) VALUES('QA97 authority board') RETURNING id")).rows;
  await pool.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES($1,$2)', [board.id, client.id]);
  const [reference] = (await pool.query(`INSERT INTO moodboard_references(board_id,titulo,nota,tipo_fuente,enlace_externo,autor_id,autor_nombre)
    VALUES($1,'QA97 reference','QA97 retained','enlace','https://example.invalid/authority',91001,'QA fixture') RETURNING id`, [board.id])).rows;
  const links = async () => (await pool.query('SELECT reference_id,tarea_id FROM moodboard_reference_tasks ORDER BY reference_id,tarea_id')).rows;
  let serial = 0;
  async function actor(role = 'edicion') {
    const username = `qa97_authority_${++serial}`;
    const [user] = (await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,'QA97 actor',$2,password_hash,true,1 FROM usuarios WHERE id=91004 RETURNING id`, [username, role])).rows;
    const r = await request(f.base, '/api/login', { method: 'POST', body: { usuario: username, password: fixturePassword } });
    assert.equal(r.status, 200); return { id: user.id, token: r.body.token };
  }
  async function task(owner) {
    const [row] = (await pool.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,propiedades_extra)
      VALUES('QA97 private historical task','QA97 display only',$1,'pendiente','{}'::jsonb) RETURNING id`, [client.id])).rows;
    if (owner) await pool.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')", [row.id, owner]);
    return row;
  }
  const mutate = async (method, token, taskId) => {
    const r = await fetch(new URL(`/api/moodboards/references/${reference.id}/tasks/${taskId}`, f.base), {
      method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
    });
    await r.arrayBuffer(); return r.status;
  };
  async function blockedBy(pid) {
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const result = await pool.query(`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))`, [pid]);
      if (result.rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Expected real request blocked by the owned transaction');
  }
  for (const method of ['POST', 'DELETE']) for (const change of ['epoch', 'inactive', 'role']) {
    await t.test(`${method}: ${change} committed after middleware rejects relation write`, async () => {
      const user = await actor('admin'), row = await task();
      if (method === 'DELETE') await pool.query('INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES($1,$2)', [reference.id, row.id]);
      const before = await links(), locker = await pool.connect(); let pending;
      try {
        await locker.query('BEGIN'); await locker.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
        await locker.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [user.id]);
        const pid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = mutate(method, user.token, row.id).then(value => ({ value }), error => ({ error }));
        await blockedBy(pid);
        if (change === 'epoch') await locker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [user.id]);
        if (change === 'inactive') await locker.query('UPDATE usuarios SET activo=false WHERE id=$1', [user.id]);
        if (change === 'role') await locker.query("UPDATE usuarios SET rol='edicion' WHERE id=$1", [user.id]);
        await locker.query('COMMIT'); const result = await pending;
        if (result.error) throw result.error;
        assert.equal(result.value, change === 'role' ? 404 : 401); assert.deepEqual(await links(), before);
      } finally { try { await locker.query('ROLLBACK'); } finally { if (pending) await pending; locker.release(); } }
    });
  }
  for (const method of ['POST', 'DELETE']) await t.test(`${method}: historical membership removed during task lock wait denies without DML`, async () => {
    const user = await actor(), row = await task(user.id);
    if (method === 'DELETE') await pool.query('INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES($1,$2)', [reference.id, row.id]);
    const before = await links(), locker = await pool.connect(); let pending;
    try {
      await locker.query('BEGIN'); await locker.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
      await locker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE', [row.id]);
      const pid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = mutate(method, user.token, row.id).then(value => ({ value }), error => ({ error }));
      await blockedBy(pid);
      await locker.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2', [row.id, user.id]);
      await locker.query('COMMIT'); const result = await pending;
      if (result.error) throw result.error;
      assert.equal(result.value, 404); assert.deepEqual(await links(), before);
    } finally { try { await locker.query('ROLLBACK'); } finally { if (pending) await pending; locker.release(); } }
  });
});
