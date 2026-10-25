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
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

// The pool wrapper pauses only AFTER a genuine task SELECT has returned with
// its PostgreSQL locks held. All authentication, SQL, data and HTTP are real.
test('signed preview and another admin confirming its reporter token use one lock scope without deadlock', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port = 55974, f = await startLocalHarness({port, clusterOnly: true});
  const operations = [], errors = [], notices = [], acquired = deferred(), releasePreview = deferred();
  let pool, monitor, server, pause = false;
  t.after(async () => {
    releasePreview.resolve();
    try {
      await Promise.allSettled(operations);
      if (server) {server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}
      await monitor?.end(); await pool?.end();
    } finally {
      await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
      t.diagnostic('Owned PG55974/signed HTTP removed; no provider/native claim.');
    }
  });
  const identitySql = `SELECT current_database() database,current_user username,host(inet_server_addr()) address,
    inet_server_port() port,current_setting('data_directory') directory`;
  const check = identity => assertFixtureIdentity({root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity});
  check((await f.query(identitySql))[0]);
  const config = {host: '127.0.0.1', port, database: 'render2_local_test', user: 'render2_fixture', password: '', ssl: false,
    statement_timeout: 20000, lock_timeout: 18000, connectionTimeoutMillis: 5000, application_name: 'render2_qa390_review'};
  pool = new pg.Pool({...config, max: 8}); check((await pool.query(identitySql)).rows[0]);
  monitor = new pg.Client(config); await monitor.connect(); check((await monitor.query(identitySql)).rows[0]);
  const wrappedPool = {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return {
        release: discard => client.release(discard),
        async query(...args) {
          const result = await client.query(...args);
          const sql = String(args[0]?.text ?? args[0]).replace(/\s+/g, ' ');
          if (pause && sql.startsWith('SELECT t.id,t.revision,t.titulo,') && sql.includes('FOR UPDATE OF t')) {
            pause = false; acquired.resolve(client.processID); await releasePreview.promise;
          }
          return result;
        },
      };
    },
  };
  const reporter = 'qa390-reporter-whatsapp', admin = 'qa390-admin-whatsapp', group = 'qa390-private-group';
  for (const [id, actor, role, username] of [[91005, reporter, 'edicion', 'qa390_editor'], [91006, admin, 'admin', 'qa390_admin']]) {
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,whatsapp_habilitado)
      SELECT $1,$2,$2,$3,password_hash,true,1,true FROM usuarios WHERE id=91003`, [id, username, role]);
    await f.query(`INSERT INTO mia_whatsapp_identities(actor_hash,usuario_id,notification_key,display_name,enabled)
      VALUES($1,$2,$3,$3,true)`, [sha(actor), id, username]);
  }
  const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
  const app = express(); app.use(express.json({limit: '128kb'}));
  app.use('/api/integraciones/wilson', createWilsonRouter({pool: wrappedPool,
    env: {NODE_ENV: 'test', WILSON_PUBLIC_KEY: publicKey.export({type: 'spki', format: 'pem'}),
      WILSON_ALLOWED_WHATSAPP_IDS: `${reporter},${admin}`, WILSON_ALLOWED_WHATSAPP_GROUP_IDS: group,
      WILSON_SYSTEM_ACTOR_ID: 'qa390-unused-system'},
    notifyAssignment: notice => {notices.push(notice);},
    notifyTaskReceiptEmail: () => assert.fail('No email'), notifyFeedback: () => assert.fail('No feedback provider'),
  }));
  app.use((error, _req, res, _next) => {
    errors.push({code: typeof error?.code === 'string' ? error.code : null});
    res.status(Number.isInteger(error?.status) ? error.status : 500).json({error: 'Fixture request rejected'});
  });
  server = await new Promise((resolve, reject) => {const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject);});
  async function signed(path, body, actor = reporter) {
    const url = new URL(`/api/integraciones/wilson${path}`, `http://127.0.0.1:${server.address().port}`);
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID(), name = 'UNTRUSTED display';
    const message = ['v2', timestamp, nonce, 'whatsapp', actor, group, name, 'POST',
      `${url.pathname}${url.search}`, sha(canonical(body))].join('\n');
    try {
      const response = await fetch(url, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: {'content-type': 'application/json', 'x-wilson-signature-version': '2',
          'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce, 'x-wilson-channel': 'whatsapp',
          'x-wilson-actor-id': actor, 'x-wilson-actor-name': name, 'x-wilson-group-id': group,
          'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64')}, body: JSON.stringify(body)});
      return {status: response.status, body: await response.json()};
    } catch {throw new Error('Owned signed HTTP failed (credentials/headers omitted)');}
  }
  const ids = [];
  for (const [type, subtype] of [['edicion', 'video'], ['diseno', 'carrusel']]) {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,material_referencia,propiedades_extra)
      VALUES($1,'qa390_editor','en_progreso',$2,$3,'https://example.invalid/qa390/material',
        '{"workspace":"render_os","qa390":"preserve"}'::jsonb) RETURNING id`, [`QA390 ${type}`, type, subtype]);
    ids.push(row.id);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91005,'responsable')", [row.id]);
  }
  // Reverse display order deliberately; lock ordering must not reorder the DTO.
  const displayIds = [...ids].reverse();
  const first = await signed('/lotes/revision/previsualizar', {task_ids: displayIds});
  assert.equal(first.status, 201); assert.deepEqual(first.body.task_ids, displayIds);
  const token = first.body.confirmacion_token; assert.equal(typeof token, 'string');
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  t.diagnostic(`Full public-table catalog: ${tables.length}, JSON/xmin/ctid.`);
  async function snapshot(excluded = []) {
    assert.deepEqual((await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename), tables);
    const hashes = {};
    for (const table of tables.filter(name => !excluded.includes(name))) hashes[table] = (await pool.query(`SELECT md5(coalesce(jsonb_agg(
      jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text) ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`)).rows[0].hash;
    return hashes;
  }
  const before = await snapshot(['integracion_confirmaciones']);
  const tokensBefore = (await pool.query('SELECT to_jsonb(c) row FROM integracion_confirmaciones c ORDER BY token')).rows.map(r => r.row);
  pause = true;
  const preview = signed('/lotes/revision/previsualizar', {task_ids: displayIds}); operations.push(preview);
  const previewPid = await Promise.race([acquired.promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Actual preview task locks not acquired within seven seconds')), 7000); timer.unref();
  })]);
  const confirmation = signed('/lotes/revision/confirmar', {confirmacion_token: token}, admin); operations.push(confirmation);
  let waiter;
  const deadline = Date.now() + 7000;
  do {
    const {rows} = await monitor.query(`SELECT pid,query FROM pg_stat_activity WHERE datname=current_database()
      AND $1::int=ANY(pg_blocking_pids(pid)) AND state='active'`, [previewPid]);
    if (rows.length) {assert.equal(rows.length, 1); waiter = rows[0]; break;}
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.ok(waiter, 'Actual confirming HTTP must wait behind paused preview transaction');
  const stage = waiter.query.includes('pg_advisory_xact_lock') ? 'scope' : /FROM tareas\b/.test(waiter.query) ? 'task' : 'unexpected';
  assert.notEqual(stage, 'unexpected'); t.diagnostic(`Observed confirm -> preview pg_blocking_pids edge; stage=${stage}; different confirming admin, original reporter scope.`);
  releasePreview.resolve();
  const [previewResponse, confirmResponse] = await Promise.all([preview, confirmation]);
  t.diagnostic(`Actual HTTP preview=${previewResponse.status}, confirm=${confirmResponse.status}; SQLSTATEs=${errors.map(e => e.code).filter(Boolean).join(',') || 'none'}.`);
  assert.equal(errors.some(error => error.code === '40P01'), false, 'No PostgreSQL deadlock may escape either real request');
  assert.equal(previewResponse.status, 201, 'Preview with task locks first must supersede the earlier token, not HTTP500');
  assert.equal(confirmResponse.status, 409, 'Superseded confirmation must reject, not deadlock or update tasks');
  assert.equal(stage, 'scope', 'Confirming a reporter token as another admin must wait on the reporter advisory scope');
  assert.deepEqual(previewResponse.body.task_ids, displayIds);
  assert.deepEqual(await snapshot(['integracion_confirmaciones']), before);
  assert.equal(notices.length, 0);
  const tokensAfter = (await pool.query('SELECT to_jsonb(c) row FROM integracion_confirmaciones c ORDER BY token')).rows.map(r => r.row);
  assert.equal(tokensAfter.length, tokensBefore.length + 1);
  for (const original of tokensBefore) {
    const current = tokensAfter.find(row => row.token === original.token); assert.ok(current);
    if (original.token === token) {assert.ok(current.used_at); assert.deepEqual({...current, used_at: null}, original);}
    else assert.deepEqual(current, original);
  }
  const next = tokensAfter.find(row => !tokensBefore.some(original => original.token === row.token));
  assert.equal(next.token, previewResponse.body.confirmacion_token); assert.equal(next.used_at, null);
  assert.equal(next.informante_actor_id, reporter); assert.equal(next.actor_id, reporter); assert.equal(next.grupo_id, group);
  const stable = await snapshot();
  assert.equal((await signed('/lotes/revision/confirmar', {confirmacion_token: token}, admin)).status, 409);
  assert.deepEqual(await snapshot(), stable); assert.equal(notices.length, 0);

  // A real unlocked hint has already been read when this request waits on the
  // reporter advisory. Mutating one immutable scope field must not re-key or
  // consume the token after the retained gate is released.
  let staleConfirmation;
  try {
    await monitor.query('BEGIN');
    await monitor.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [JSON.stringify(['wilson-review-batch-v1', 'wilson', 'whatsapp', reporter, group])]);
    const monitorPid = (await monitor.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    staleConfirmation = signed('/lotes/revision/confirmar', {confirmacion_token: next.token}, admin);
    operations.push(staleConfirmation);
    let staleWaiter;
    const staleDeadline = Date.now() + 7000;
    do {
      const {rows} = await pool.query(`SELECT pid,query FROM pg_stat_activity WHERE datname=current_database()
        AND $1::int=ANY(pg_blocking_pids(pid)) AND state='active'`, [monitorPid]);
      if (rows.length) {assert.equal(rows.length, 1); staleWaiter = rows[0]; break;}
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < staleDeadline);
    assert.ok(staleWaiter, 'Real confirmation must wait on the held reporter advisory after reading its hint');
    assert.ok(staleWaiter.query.includes('pg_advisory_xact_lock'));
    const changed = await pool.query(`UPDATE integracion_confirmaciones SET actor_id=$2
      WHERE token=$1 AND used_at IS NULL RETURNING grupo_id,operacion,informante_actor_id,used_at`,
    [next.token, 'qa390-fixture-changed-external-actor']);
    assert.equal(changed.rowCount, 1);
    assert.deepEqual(changed.rows[0], {grupo_id: group, operacion: 'revisar_lote', informante_actor_id: reporter, used_at: null});
    const changedBaseline = await snapshot();
    const priorErrors = errors.length;
    await monitor.query('COMMIT');
    assert.equal((await staleConfirmation).status, 409, 'Locked scope re-read must reject the changed hint, not acquire a second key');
    assert.deepEqual(await snapshot(), changedBaseline);
    assert.equal(notices.length, 0); assert.equal(errors.length, priorErrors);
    t.diagnostic('Actual stale hint after advisory wait rejected HTTP409; all public tables/unused token unchanged after deliberate actor_id fixture mutation.');
  } finally {
    // Release the owned gate before draining HTTP, including assertion failure.
    await monitor.query('ROLLBACK').catch(() => {});
    if (staleConfirmation) await Promise.allSettled([staleConfirmation]);
  }
});
