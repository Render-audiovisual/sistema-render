import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

test('bulk task HTTP actions retain actor authority and recheck complete ID membership after task locks', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 300000,
}, async t => {
  const port = 55949, f = await startLocalHarness({ port });
  const connections = new Set(), operations = new Set();
  t.after(async () => {
    try {
      await Promise.all([...connections].map(db => db.query('ROLLBACK').catch(() => {})));
      await Promise.allSettled([...operations]);
      await Promise.all([...connections].map(db => db.end()));
    } finally {
      await f.cleanup();
      await assert.rejects(access(f.root), error => error.code === 'ENOENT');
      t.diagnostic('Owned PG55949/API fixture stopped and removed; no configured database used.');
    }
  });
  const identitySql = `SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard = identity => assertFixtureIdentity({ root:f.root,cwd:f.root,port,
    url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity });
  guard((await f.query(identitySql))[0]);
  async function auxiliary() {
    const db = new pg.Client({ host:'127.0.0.1',port,user:'render2_fixture',password:'',
      database:'render2_local_test',ssl:false,application_name:'render2_qa338_bulk',
      statement_timeout:20000,lock_timeout:18000,connectionTimeoutMillis:5000 });
    await db.connect(); connections.add(db);
    guard((await db.query(identitySql)).rows[0]);
    db.pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    return db;
  }
  async function dispose(db) {
    try { await db.query('ROLLBACK').catch(() => {}); }
    finally { await db.end(); connections.delete(db); }
  }
  function observe(promise) {
    operations.add(promise);
    const pending = { promise,settled:false };
    promise.then(() => { pending.settled=true; }, () => { pending.settled=true; });
    return pending;
  }
  const monitor = await auxiliary();
  async function edge(blockerPid, pending, stage, waiterPid) {
    const deadline = Date.now()+7000;
    do {
      assert.equal(pending.settled,false,'Operation ended before the required PostgreSQL blocking edge');
      const { rows } = await monitor.query(`SELECT pid,
        query ILIKE '%FROM usuarios%FOR SHARE%' AS actor,
        query ILIKE '%SELECT id FROM tareas%ORDER BY id FOR UPDATE%' AS tasks
        FROM pg_stat_activity WHERE datname=current_database()
        AND $1::int=ANY(pg_blocking_pids(pid))
        AND (($2::int IS NOT NULL AND pid=$2) OR ($2::int IS NULL AND pid<>ALL($3::int[])))`,
      [blockerPid,waiterPid ?? null,[...connections].map(db => db.pid)]);
      if (rows.length) {
        assert.equal(rows.length,1,'Only the intended writer may wait on the owned blocker');
        if (stage) assert.equal(rows[0][stage],true,'Wait belongs to the expected HTTP transaction stage');
        return rows[0].pid;
      }
      await new Promise(resolve => setTimeout(resolve,15));
    } while (Date.now()<deadline);
    assert.fail('Required pg_blocking_pids edge not observed within seven seconds');
  }
  // Copy only the known disposable credential, never a configured user's secret.
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT 91005,'qa_bulk_actor','QA338 Actor','produccion',password_hash,true,1 FROM usuarios WHERE id=91003`);
  async function login(usuario,id) {
    const response = await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}});
    assert.equal(response.status,200); assert.equal(response.body.usuario.id,id);
    assert.equal(typeof response.body.token,'string'); return response.body.token;
  }
  const token = await login('qa_bulk_actor',91005);
  const adminToken = await login('qa_franco',91001);
  const adminLabel = (await f.query('SELECT nombre,usuario FROM usuarios WHERE id=91001'))[0];
  async function http(ids,action,credential=token) {
    const response = await fetch(new URL('/api/tareas/acciones-masivas?workspace=render_os',f.base),{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{authorization:`Bearer ${credential}`,'content-type':'application/json'},
      body:JSON.stringify({ids,accion:action}),
    });
    return {status:response.status,body:await response.json()};
  }
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded=[]) {
    const result = {};
    for (const table of tables.filter(name => !excluded.includes(name))) {
      result[table] = (await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`))[0].hash;
    }
    return result;
  }
  const actorPrivateHash = async () => (await f.query(`SELECT md5((to_jsonb(u)-'activo'-'rol'-'session_version'-'user_admin_version')::text) AS hash
    FROM usuarios u WHERE id=91005`))[0].hash;
  const otherUsersHash = async () => (await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(u),u.xmin::text,u.ctid::text)
    ORDER BY id)::text,'[]')) AS hash FROM usuarios u WHERE id<>91005`))[0].hash;
  const reset = () => f.query("UPDATE usuarios SET activo=true,rol='produccion',session_version=1 WHERE id=91005");
  let serial=0;
  async function task(action,member=true,collaborator=false) {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES($1,'QA338 Actor','pendiente','desarrollo',$2::jsonb) RETURNING *`,
    [`QA338 fixture ${++serial}`,JSON.stringify({workspace:'render_os',qa338:'preserve',
      archivada_render_os:action==='restaurar',papelera_render_os:action==='restaurar'})]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')",[row.id,member&&!collaborator?91005:91001]);
    if (collaborator) await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91005,'colaborador')",[row.id]);
    return (await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[row.id]))[0].row;
  }
  async function otherTasksHash(ids) {
    return (await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(t),t.xmin::text,t.ctid::text)
      ORDER BY id)::text,'[]')) AS hash FROM tareas t WHERE NOT(id=ANY($1::bigint[]))`,[ids]))[0].hash;
  }
  async function assertChanged(rows,action,label,response) {
    assert.equal(response.status,200);
    assert.deepEqual({...response.body,ids:[...response.body.ids].sort((a,b)=>a-b)},
      {ok:true,accion:action,ids:rows.map(r=>r.id).sort((a,b)=>a-b),cantidad:rows.length});
    for (const before of rows) {
      const after = (await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[before.id]))[0].row;
      const prefix = action==='papelera'?'papelera':'restaurada';
      const timestamp=after.propiedades_extra[`${prefix}_at`];
      assert.equal(typeof timestamp,'string'); assert.ok(Number.isFinite(Date.parse(timestamp)));
      assert.deepEqual(after,{...before,revision:before.revision+1,updated_at:after.updated_at,
        propiedades_extra:{...before.propiedades_extra,archivada_render_os:action==='papelera',
          papelera_render_os:action==='papelera',[`${prefix}_por`]:label,[`${prefix}_at`]:timestamp}});
    }
  }
  const revocations = [
    ['inactive','UPDATE usuarios SET activo=false WHERE id=91005'],
    ['session','UPDATE usuarios SET session_version=2 WHERE id=91005'],
    ['role',"UPDATE usuarios SET rol='diseno' WHERE id=91005"],
  ];
  for (const action of ['papelera','restaurar']) {
    for (const [name,sql] of revocations) await t.test(`${action}: ${name} revocation before actor guard denies401 without domain DML`,async () => {
      await reset(); const row=await task(action),before=await snapshot(['usuarios']);
      const privateHash=await actorPrivateHash(),others=await otherUsersHash();
      const revoker=await auxiliary(); let pending;
      try {
        await revoker.query('BEGIN'); await revoker.query('SELECT id FROM usuarios WHERE id=91005 FOR UPDATE');
        await revoker.query(sql);
        pending=observe(http([row.id],action)); await edge(revoker.pid,pending,'actor');
        await revoker.query('COMMIT');
        assert.equal((await pending.promise).status,401);
        assert.deepEqual(await snapshot(['usuarios']),before);
        assert.equal(await actorPrivateHash(),privateHash); assert.equal(await otherUsersHash(),others);
      } finally {
        await revoker.query('ROLLBACK').catch(()=>{});
        if(pending) await Promise.allSettled([pending.promise]);
        await dispose(revoker); await reset();
      }
    });
    await t.test(`${action}: held actor SHARE blocks revocation until authorized batch commits`,async () => {
      await reset(); const rows=[await task(action),await task(action)],ids=rows.map(r=>r.id);
      const before=await snapshot(['usuarios','tareas']),others=await otherTasksHash(ids);
      const privateHash=await actorPrivateHash(),otherUsers=await otherUsersHash();
      const stopper=await auxiliary(),revoker=await auxiliary(); let pending,revoke;
      try {
        await stopper.query('BEGIN'); await stopper.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[ids[0]]);
        pending=observe(http([...ids].reverse(),action)); const writer=await edge(stopper.pid,pending,'tasks');
        await revoker.query('BEGIN'); revoke=observe(revoker.query('UPDATE usuarios SET session_version=2 WHERE id=91005'));
        await edge(writer,revoke,null,revoker.pid);
        await stopper.query('COMMIT'); const response=await pending.promise;
        await revoke.promise; await revoker.query('COMMIT');
        await assertChanged(rows,action,'QA338 Actor',response);
        assert.deepEqual(await snapshot(['usuarios','tareas']),before); assert.equal(await otherTasksHash(ids),others);
        assert.equal(await actorPrivateHash(),privateHash); assert.equal(await otherUsersHash(),otherUsers);
      } finally {
        await stopper.query('ROLLBACK').catch(()=>{});
        if(revoke) await Promise.allSettled([revoke.promise]);
        await revoker.query('ROLLBACK').catch(()=>{});
        if(pending) await Promise.allSettled([pending.promise]);
        await dispose(stopper); await dispose(revoker); await reset();
      }
    });
    await t.test(`${action}: task-locked membership removal wins and fresh ACL rolls back the whole batch`,async () => {
      const rows=[await task(action),await task(action)],ids=rows.map(r=>r.id);
      const before=await snapshot(['tarea_asignaciones']);
      const assignments=await f.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id,tipo');
      const blocker=await auxiliary(); let pending;
      try {
        await blocker.query('BEGIN'); await blocker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[ids[0]]);
        // Same ordering as persistAssignedTask: task lock precedes relation replacement.
        await blocker.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91005',[ids[0]]);
        pending=observe(http([...ids].reverse(),action)); await edge(blocker.pid,pending,'tasks');
        await blocker.query('COMMIT'); assert.equal((await pending.promise).status,403);
        assert.deepEqual(await snapshot(['tarea_asignaciones']),before);
        assert.deepEqual(await f.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id,tipo'),
          assignments.filter(row=>!(row.tarea_id===ids[0]&&row.usuario_id===91005)));
      } finally {
        await blocker.query('ROLLBACK').catch(()=>{});
        if(pending) await Promise.allSettled([pending.promise]); await dispose(blocker);
      }
    });
    await t.test(`${action}: mixed authorized and foreign IDs deny the entire batch without DML`,async () => {
      const own=await task(action),foreign=await task(action,false),before=await snapshot();
      assert.equal((await http([foreign.id,own.id],action)).status,403);
      assert.deepEqual(await snapshot(),before);
    });
    for (const admin of [false,true]) await t.test(`${action}: ${admin?'admin':'responsible and collaborator'} positive changes only selected task flags`,async () => {
      const rows=[await task(action,!admin),await task(action,!admin,!admin)],ids=rows.map(r=>r.id);
      const before=await snapshot(['tareas']),others=await otherTasksHash(ids);
      const response=await http([...ids].reverse(),action,admin?adminToken:token);
      await assertChanged(rows,action,admin?(adminLabel.nombre||adminLabel.usuario).trim():'QA338 Actor',response);
      assert.deepEqual(await snapshot(['tareas']),before); assert.equal(await otherTasksHash(ids),others);
    });
  }
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename),tables);
});
