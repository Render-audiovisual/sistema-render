import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {access} from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import {startLocalHarness, assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {createWilsonRouter} from '../src/wilson-integration.js';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

// Real router, signed synthetic integration identity, own HTTP listener and PG.
// No browser JWT epoch or notification/provider transport is involved.
test('Wilson signed review batch retains current WhatsApp actor before consuming token or updating tasks', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const port = 55973, f = await startLocalHarness({port, clusterOnly: true});
  const connections = new Set(), operations = new Set(), notices = [];
  let pool, server;
  t.after(async () => {
    try {
      await Promise.all([...connections].map(db => db.query('ROLLBACK').catch(() => {})));
      await Promise.allSettled([...operations]);
      if (server) {server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}
      await Promise.all([...connections].map(db => db.end())); await pool?.end();
    } finally {
      await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
      t.diagnostic('Owned signed Wilson review PG55973/HTTP removed; no external delivery or browser-session claim.');
    }
  });
  const identitySql = `SELECT current_database() database,current_user username,host(inet_server_addr()) address,
    inet_server_port() port,current_setting('data_directory') directory`;
  const check = identity => assertFixtureIdentity({root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity});
  check((await f.query(identitySql))[0]);
  const config = {host: '127.0.0.1', port, database: 'render2_local_test', user: 'render2_fixture', password: '', ssl: false,
    statement_timeout: 20000, lock_timeout: 18000, connectionTimeoutMillis: 5000, application_name: 'render2_qa386_review'};
  pool = new pg.Pool({...config, max: 8}); check((await pool.query(identitySql)).rows[0]);
  async function auxiliary() {
    const db = new pg.Client(config); await db.connect(); connections.add(db);
    check((await db.query(identitySql)).rows[0]); db.pid = (await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    return db;
  }
  async function dispose(db) {if (!db) return; try {await db.query('ROLLBACK');} finally {await db.end(); connections.delete(db);}}
  const actorId = 'qa386-synthetic-whatsapp', actorHash = sha(actorId), userId = 91005, group = 'qa386-private-group';
  const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
  const app = express(); app.use(express.json({limit: '128kb'}));
  app.use('/api/integraciones/wilson', createWilsonRouter({pool,
    env: {NODE_ENV: 'test', WILSON_PUBLIC_KEY: publicKey.export({type: 'spki', format: 'pem'}),
      WILSON_ALLOWED_WHATSAPP_IDS: actorId, WILSON_ALLOWED_WHATSAPP_GROUP_IDS: group,
      WILSON_SYSTEM_ACTOR_ID: 'qa386-unused-system'},
    notifyAssignment: notice => {notices.push(notice);},
    notifyTaskReceiptEmail: () => assert.fail('No task creation email'), notifyFeedback: () => assert.fail('No feedback transport'),
  }));
  app.use((error, _req, res, _next) => res.status(Number.isInteger(error?.status) ? error.status : 500).json({error: 'Fixture request rejected'}));
  server = await new Promise((resolve, reject) => {const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject);});
  const base = `http://127.0.0.1:${server.address().port}`;
  async function signed(path, body) {
    const url = new URL(`/api/integraciones/wilson${path}`, base), timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID(), name = 'UNTRUSTED transport display label';
    const message = ['v2', timestamp, nonce, 'whatsapp', actorId, group, name, 'POST',
      `${url.pathname}${url.search}`, sha(canonical(body))].join('\n');
    let response;
    try {
      response = await fetch(url, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: {'content-type': 'application/json', 'x-wilson-signature-version': '2',
          'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce, 'x-wilson-channel': 'whatsapp',
          'x-wilson-actor-id': actorId, 'x-wilson-actor-name': name, 'x-wilson-group-id': group,
          'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64')}, body: JSON.stringify(body)});
      return {status: response.status, body: await response.json()};
    } catch {throw new Error('Owned signed Wilson request failed (credentials/headers omitted)');}
  }
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,whatsapp_habilitado)
    SELECT $1,'qa386_editor','QA386 Original','edicion',password_hash,true,1,true FROM usuarios WHERE id=91003`, [userId]);
  await f.query(`INSERT INTO mia_whatsapp_identities(actor_hash,usuario_id,notification_key,display_name,enabled)
    VALUES($1,$2,'qa386_editor','QA386 fixture mapping',true)`, [actorHash, userId]);
  async function restore() {
    await f.query("UPDATE usuarios SET activo=true,rol='edicion',nombre='QA386 Original',whatsapp_habilitado=true WHERE id=$1", [userId]);
    await f.query('UPDATE mia_whatsapp_identities SET enabled=true,usuario_id=$2 WHERE actor_hash=$1', [actorHash, userId]);
  }
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  t.diagnostic(`Full public-table snapshot catalog: ${tables.length} tables, including physical xmin/ctid.`);
  async function snapshot(db = pool, excluded = []) {
    assert.deepEqual((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename), tables);
    const hashes = {};
    for (const table of tables.filter(name => !excluded.includes(name))) hashes[table] = (await db.query(`SELECT md5(coalesce(jsonb_agg(
      jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text) ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`)).rows[0].hash;
    return hashes;
  }
  let sequence = 0;
  async function prepare(ownerId = userId) {
    const ids = [];
    for (const type of ['edicion', 'diseno']) {
      const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,material_referencia,propiedades_extra)
        VALUES($1,'QA386 Original','en_progreso',$2,$3,'https://example.invalid/qa386/material',
          '{"workspace":"render_os","qa386":"preserve"}'::jsonb) RETURNING id`,
      [`QA386 batch ${++sequence}`, type, type === 'edicion' ? 'video' : 'carrusel']);
      ids.push(task.id); await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')", [task.id, ownerId]);
    }
    const response = await signed('/lotes/revision/previsualizar', {task_ids: ids});
    assert.equal(response.status, 201, 'Expected signed preview HTTP201 (body/headers omitted)');
    assert.deepEqual(response.body.task_ids, ids);
    const token = response.body.confirmacion_token; assert.equal(typeof token, 'string');
    return {ids, token};
  }
  const confirm = token => signed('/lotes/revision/confirmar', {confirmacion_token: token});
  async function unused(token) {assert.equal((await f.query('SELECT used_at FROM integracion_confirmaciones WHERE token=$1', [token]))[0].used_at, null);}
  async function edge(blocker, pending, monitor) {
    const deadline = Date.now() + 7000;
    do {
      assert.equal(pending.settled, false, 'Confirmation ended before retained actor blocking edge');
      const {rows} = await monitor.query(`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))
        AND pid<>ALL($2::int[]) AND state='active'
        AND query='SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash,whatsapp_habilitado FROM usuarios WHERE id=$1 FOR SHARE'`,
      [blocker.pid, [...connections].map(db => db.pid)]);
      if (rows.length) {assert.equal(rows.length, 1); return rows[0].pid;}
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    assert.fail('Retained actor pg_blocking_pids edge missing within seven seconds');
  }
  for (const change of ['inactive', 'role', 'mapping']) {
    await t.test(`committed ${change === 'role' ? 'admin-to-edicion downgrade with foreign task membership' : change} withdrawal during actor lock wait rejects without consuming batch or changing any other public rows`, async () => {
      await restore();
      if (change === 'role') await f.query("UPDATE usuarios SET rol='admin' WHERE id=$1", [userId]);
      const batch = await prepare(change === 'role' ? 91003 : userId);
      if (change === 'role') {
        assert.deepEqual((await f.query('SELECT tarea_id,usuario_id FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id', [batch.ids])),
          batch.ids.map(id => ({tarea_id: id, usuario_id: 91003})));
      }
      let blocker, monitor, pending;
      const noticeCount = notices.length;
      try {
        blocker = await auxiliary(); monitor = await auxiliary();
        await blocker.query('BEGIN'); await blocker.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [userId]);
        if (change === 'inactive') await blocker.query('UPDATE usuarios SET activo=false WHERE id=$1', [userId]);
        if (change === 'role') await blocker.query("UPDATE usuarios SET rol='edicion' WHERE id=$1", [userId]);
        if (change === 'mapping') await blocker.query('UPDATE mia_whatsapp_identities SET enabled=false WHERE actor_hash=$1', [actorHash]);
        // This connection sees the deliberate fixture mutation before commit;
        // that complete image is the required no-additional-DML postcondition.
        const before = await snapshot(blocker);
        const promise = confirm(batch.token); operations.add(promise);
        pending = {promise, settled: false}; promise.then(() => {pending.settled = true;}, () => {pending.settled = true;});
        await edge(blocker, pending, monitor); await blocker.query('COMMIT');
        const response = await promise; assert.equal(response.status, 403);
        await unused(batch.token); assert.deepEqual(await snapshot(), before); assert.equal(notices.length, noticeCount);
      } finally {
        if (blocker) await blocker.query('ROLLBACK').catch(() => {});
        if (pending) await Promise.allSettled([pending.promise]);
        try {await dispose(blocker);} finally {try {await dispose(monitor);} finally {await restore();}}
      }
    });
  }
  for (const renamed of [false, true]) {
    await t.test(`valid original mapped actor confirms exactly once; rename=${renamed}, browser session epoch irrelevant`, async () => {
      await restore(); const batch = await prepare();
      const label = renamed ? 'QA386 Renamed Same ID' : 'QA386 Original';
      await f.query('UPDATE usuarios SET nombre=$2,session_version=session_version+1 WHERE id=$1', [userId, label]);
      const excluded = ['tareas', 'integracion_confirmaciones', 'integracion_auditoria'];
      const before = await snapshot(pool, excluded), noticesBefore = notices.length;
      const tasksBefore = await f.query('SELECT id,estado,revision,propiedades_extra FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [batch.ids]);
      const result = await confirm(batch.token); assert.equal(result.status, 200); assert.equal(result.body.updated, true);
      assert.deepEqual(result.body.task_ids, batch.ids);
      const tasks = await f.query('SELECT id,estado,revision,propiedades_extra FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [batch.ids]);
      for (const [index, task] of tasks.entries()) {
        assert.equal(task.estado, 'en_revision'); assert.equal(task.revision, tasksBefore[index].revision + 1);
        assert.equal(task.propiedades_extra.qa386, 'preserve'); assert.equal(task.propiedades_extra.mia_revision_confirmada_por, label);
      }
      assert.notEqual((await f.query('SELECT used_at FROM integracion_confirmaciones WHERE token=$1', [batch.token]))[0].used_at, null);
      const audits = await f.query("SELECT actor_id,actor_nombre,tarea_id FROM integracion_auditoria WHERE detalles->>'token'=$1 ORDER BY tarea_id", [batch.token]);
      assert.equal(audits.length, 2); assert.deepEqual(audits.map(row => row.tarea_id), batch.ids);
      for (const audit of audits) {assert.equal(audit.actor_id, actorId); assert.equal(audit.actor_nombre, label);}
      assert.equal(notices.length, noticesBefore + 2);
      for (const notice of notices.slice(noticesBefore)) {assert.equal(notice.actorId, userId); assert.equal(notice.actor, label);}
      assert.deepEqual(await snapshot(pool, excluded), before);
      const confirmed = await snapshot(); assert.equal((await confirm(batch.token)).status, 409);
      assert.deepEqual(await snapshot(), confirmed); assert.equal(notices.length, noticesBefore + 2);
    });
  }
});
