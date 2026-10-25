import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

test('actual task HTTP writers serialize current actor authority before state, text and canonical closure locks', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 300000,
}, async t => {
  const port = 55936, f = await startLocalHarness({ port });
  const connections = new Set(), pendingOperations = new Set();
  t.after(async () => {
    try {
      await Promise.all([...connections].map(db => db.query('ROLLBACK').catch(() => {})));
      await Promise.allSettled([...pendingOperations]);
      await Promise.all([...connections].map(db => db.end()));
    } finally {
      await f.cleanup();
      await assert.rejects(access(f.root), error => error.code === 'ENOENT');
      t.diagnostic('Owned state authority HTTP fixture stopped and removed.');
    }
  });
  const url = `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const identitySql = `SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard = identity => assertFixtureIdentity({ root: f.root, cwd: f.root, port, url, identity });
  guard((await f.query(identitySql))[0]);
  async function auxiliary() {
    const db = new pg.Client({ host:'127.0.0.1',port,user:'render2_fixture',password:'',database:'render2_local_test',ssl:false,
      application_name:'render2_qa317_state_authority',statement_timeout: 20000,
      lock_timeout: 18000, connectionTimeoutMillis: 5000 });
    await db.connect(); connections.add(db);
    guard((await db.query(identitySql)).rows[0]);
    db.pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    return db;
  }
  async function dispose(db) {
    if (!db) return;
    try { await db.query('ROLLBACK').catch(() => {}); } finally { await db.end(); connections.delete(db); }
  }
  function observe(promise) {
    pendingOperations.add(promise);
    const state = { promise, settled: false };
    promise.then(() => { state.settled = true; }, () => { state.settled = true; });
    return state;
  }
  const monitor = await auxiliary();
  async function waiterBehind(blockerPid, pending, kind) {
    const deadline = Date.now() + 7000;
    do {
      assert.equal(pending.settled, false, 'HTTP ended before its required PostgreSQL blocking edge');
      const { rows } = await monitor.query(`SELECT pid,
        query ILIKE '%FROM usuarios%FOR SHARE%' AS actor_guard,
        query ILIKE '%UPDATE tareas%' AS task_write
        FROM pg_stat_activity WHERE datname=current_database()
        AND $1::int=ANY(pg_blocking_pids(pid)) AND pid<>ALL($2::int[])`,
      [blockerPid, [...connections].map(db => db.pid)]);
      if (rows.length) {
        assert.equal(rows.length, 1, 'Only the intended HTTP writer may wait on this owned blocker');
        assert.equal(rows[0][kind], true, 'Observed wait must belong to the expected writer stage');
        return rows[0].pid;
      }
      await new Promise(resolve => setTimeout(resolve, 15));
    } while (Date.now() < deadline);
    assert.fail('Required HTTP/PostgreSQL blocking edge was not observed within seven seconds');
  }
  async function blocked(waiterPid, blockerPid, pending) {
    const deadline = Date.now() + 7000;
    do {
      assert.equal(pending.settled, false, 'Operation ended before the required actor-retention edge');
      const { rows } = await monitor.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked', [waiterPid, blockerPid]);
      if (rows[0].blocked) return;
      await new Promise(resolve => setTimeout(resolve, 15));
    } while (Date.now() < deadline);
    assert.fail('Required revoker-to-writer edge was not observed within seven seconds');
  }
  // Only the fixture's known synthetic credential is copied; no hash/token is printed.
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT 91005,'qa_state_producer','QA317 Producer','produccion',password_hash,true,1 FROM usuarios WHERE id=91003`);
  const login = await request(f.base, '/api/login', { method: 'POST',
    body: { usuario: 'qa_state_producer', password: fixturePassword } });
  assert.equal(login.status, 200); assert.equal(login.body.usuario.id, 91005);
  assert.equal(typeof login.body.token, 'string');
  const token = login.body.token;
  async function http(route, method = 'GET', body, requestToken = token) {
    const response = await fetch(new URL('/api' + route, f.base), {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${requestToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA317 state authority',true) RETURNING id");
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded = []) {
    const hashes = {};
    for (const table of tables.filter(name => !excluded.includes(name))) {
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table] = row.hash;
    }
    return hashes;
  }
  const privateActorHash = async (id=91005) => (await f.query(`SELECT md5((to_jsonb(u)-'activo'-'rol'-'session_version'-'user_admin_version')::text) AS hash
    FROM usuarios u WHERE id=$1`,[id]))[0].hash;
  const otherUsersHash = async (id=91005) => (await f.query(`SELECT md5(coalesce(jsonb_agg(
    jsonb_build_array(to_jsonb(u),u.xmin::text,u.ctid::text) ORDER BY u.id)::text,'[]')) AS hash
    FROM usuarios u WHERE id<>$1`,[id]))[0].hash;
  const resetActor = () => f.query("UPDATE usuarios SET activo=true,rol='produccion',session_version=1 WHERE id=91005");
  let serial = 0;
  async function scenario(kind) {
    if (kind === 'generic' || kind === 'text') {
      const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
        VALUES($1,'QA317 Producer',$2,'pendiente','desarrollo','{"workspace":"render_os"}'::jsonb) RETURNING id,revision`,
      [`QA317 generic ${++serial}`, client.id]);
      await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91005,'responsable')", [task.id]);
      return { task, body: kind === 'text' ? {
        titulo: `QA318 revised text ${serial}`, aclaraciones: 'QA318 revised instructions',
        fecha_vencimiento: '2026-10-30', propiedades_extra: { copy_trabajo: 'QA318 revised copy' },
        expected_revision: task.revision,
      } : { estado: 'en_progreso', expected_revision: task.revision } };
    }
    const created = await http('/tareas', 'POST', { request_id: randomUUID(), workspace: 'render_os',
      titulo: `QA317 Visita ${++serial}`, asignado_a_id: 91005, colaborador_ids: [], cliente_id: client.id,
      tipo_tarea: 'produccion', fecha_vencimiento: '2026-10-29', produccion_videos_previstos: 1 });
    assert.equal(created.status, 201); const task = created.body.task;
    assert.equal(task.asignado_a_id, 91005);
    const [visit] = await f.query('SELECT id,revision FROM produccion_visitas WHERE tarea_origen_id=$1', [task.id]);
    assert.ok(visit);
    const recorded = await http(`/producciones/${visit.id}/videos`, 'POST', {
      expected_revision: visit.revision, titulo: 'QA317 recorded evidence', estado: 'grabado',
    });
    assert.equal(recorded.status, 201);
    const context = await http(`/producciones/tareas/${task.id}`);
    assert.equal(context.status, 200); assert.equal(context.body.vinculo.finalizacion.habilitada, true);
    assert.equal(context.body.vinculo.finalizacion.task_revision, task.revision);
    return { task, body: { estado: 'finalizada', expected_revision: task.revision,
      expected_production_visit: { id: context.body.vinculo.id, revision: context.body.vinculo.revision } } };
  }
  const changes = [
    { name: 'inactive', sql: 'UPDATE usuarios SET activo=false WHERE id=91005', field: 'activo', value: false },
    { name: 'session', sql: 'UPDATE usuarios SET session_version=2 WHERE id=91005', field: 'session_version', value: 2 },
    { name: 'role', sql: "UPDATE usuarios SET rol='diseno' WHERE id=91005", field: 'rol', value: 'diseno' },
  ];
  for (const kind of ['generic', 'canonical', 'text']) for (const change of changes) {
    await t.test(`${kind}: committed ${change.name} revocation wins before actor SHARE and denies401 without business writes`, async () => {
      await resetActor(); const { task, body } = await scenario(kind);
      const before = await snapshot(['usuarios']), actorHash = await privateActorHash(), othersHash = await otherUsersHash();
      const revoker = await auxiliary(); let pending;
      try {
        await revoker.query('BEGIN');
        await revoker.query('SELECT id FROM usuarios WHERE id=91005 FOR UPDATE');
        await revoker.query(change.sql);
        // A state-only request without query context still resolves its stored
        // workspace. Canonical closure uses its supported API contract.
        const suffix = change.name === 'session' && kind === 'generic' ? '' : '?workspace=render_os';
        pending = observe(http(`/tareas/${task.id}${suffix}`, 'PATCH', body));
        await waiterBehind(revoker.pid, pending, 'actor_guard');
        await revoker.query('COMMIT');
        const result = await pending.promise;
        assert.equal(result.status, 401); assert.deepEqual(Object.keys(result.body), ['error']);
        assert.deepEqual(await snapshot(['usuarios']), before);
        assert.equal(await privateActorHash(), actorHash); assert.equal(await otherUsersHash(), othersHash);
        const [user] = await f.query('SELECT activo,rol,session_version FROM usuarios WHERE id=91005');
        assert.equal(user[change.field], change.value);
      } finally {
        await revoker.query('ROLLBACK').catch(() => {});
        if (pending) await Promise.allSettled([pending.promise]);
        await dispose(revoker); await resetActor();
      }
    });
  }
  for (const kind of ['generic', 'canonical', 'text']) {
    await t.test(`${kind}: actor SHARE retained before task lock makes revocation wait through authorized commit`, async () => {
      await resetActor(); const { task, body } = await scenario(kind);
      const exclusions = kind === 'text' ? ['usuarios', 'tareas'] : ['usuarios', 'tareas', 'mia_private_task_notifications'];
      const before = await snapshot(exclusions);
      const actorHash = await privateActorHash(), othersHash = await otherUsersHash();
      const beforeTask = (await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1', [task.id]))[0].row;
      const otherTasks = await f.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) AS hash FROM tareas t WHERE id<>$1", [task.id]);
      const stopper = await auxiliary(), revoker = await auxiliary(); let pending, revoke;
      try {
        await stopper.query('BEGIN'); await stopper.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE', [task.id]);
        pending = observe(http(`/tareas/${task.id}?workspace=render_os`, 'PATCH', body));
        const writerPid = await waiterBehind(stopper.pid, pending, 'task_write');
        await revoker.query('BEGIN');
        revoke = observe(revoker.query('UPDATE usuarios SET session_version=2 WHERE id=91005'));
        await blocked(revoker.pid, writerPid, revoke);
        await stopper.query('COMMIT');
        const result = await pending.promise; assert.equal(result.status, 200);
        assert.equal(result.body.id, task.id); assert.equal(result.body.estado, kind === 'text' ? beforeTask.estado : body.estado);
        assert.equal(result.body.revision, task.revision + 1);
        await revoke.promise; await revoker.query('COMMIT');
        const afterTask = (await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1', [task.id]))[0].row;
        if (kind === 'text') {
          assert.deepEqual(afterTask, { ...beforeTask,
            titulo: body.titulo, aclaraciones: body.aclaraciones, fecha_vencimiento: body.fecha_vencimiento,
            propiedades_extra: { ...beforeTask.propiedades_extra, ...body.propiedades_extra },
            revision: beforeTask.revision + 1, updated_at: afterTask.updated_at,
          });
        }
        assert.deepEqual(afterTask.propiedades_extra.produccion_registros, beforeTask.propiedades_extra.produccion_registros);
        assert.deepEqual(await snapshot(exclusions), before);
        assert.deepEqual(await f.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) AS hash FROM tareas t WHERE id<>$1", [task.id]), otherTasks);
        assert.equal(await privateActorHash(), actorHash); assert.equal(await otherUsersHash(), othersHash);
        assert.equal((await f.query('SELECT session_version FROM usuarios WHERE id=91005'))[0].session_version, 2);
        assert.equal((await http(`/tareas/${task.id}?workspace=render_os`)).status, 401);
      } finally {
        await stopper.query('ROLLBACK').catch(() => {});
        if (revoke) await Promise.allSettled([revoke.promise]);
        await revoker.query('ROLLBACK').catch(() => {});
        if (pending) await Promise.allSettled([pending.promise]);
        await dispose(stopper); await dispose(revoker); await resetActor();
      }
    });
  }
  await t.test('a production employee cannot use canonical closure evidence through a historical-scope PATCH', async () => {
    await resetActor(); const {task,body}=await scenario('canonical');
    const before=await snapshot();
    const result=await http(`/tareas/${task.id}?workspace=historical`,'PATCH',body);
    assert.equal(result.status,403);assert.deepEqual(Object.keys(result.body),['error']);
    assert.deepEqual(await snapshot(),before);
  });
  for(const suffix of ['', '?workspace=historical']) {
    await t.test(`admin text PATCH ${suffix || 'without query'} cannot bypass the actor guard`,async()=>{
      const adminLogin=await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}});
      assert.equal(adminLogin.status,200);assert.equal(adminLogin.body.usuario.id,91001);
      const {task,body}=await scenario('text');
      const before=await snapshot(['usuarios']), actorHash=await privateActorHash(91001), othersHash=await otherUsersHash(91001);
      const revoker=await auxiliary();let pending;
      try {
        await revoker.query('BEGIN');
        await revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91001');
        pending=observe(http(`/tareas/${task.id}${suffix}`,'PATCH',body,adminLogin.body.token));
        await waiterBehind(revoker.pid,pending,'actor_guard');
        await revoker.query('COMMIT');
        assert.equal((await pending.promise).status,401);
        assert.deepEqual(await snapshot(['usuarios']),before);
        assert.equal(await privateActorHash(91001),actorHash);assert.equal(await otherUsersHash(91001),othersHash);
      } finally {
        await revoker.query('ROLLBACK').catch(()=>{});
        if(pending)await Promise.allSettled([pending.promise]);
        await dispose(revoker);
      }
    });
  }
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
});
