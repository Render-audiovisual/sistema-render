import assert from 'node:assert/strict';
import { access, readFile, writeFile, lstat, realpath, chmod } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { captureReleaseSnapshot } from '../../src/release-preservation-snapshot.js';

export const RESTORED_EXECUTOR_QA_ROOT = '/private/tmp/render2-upgrade-PhlcZ6';
const SOURCE = 'render2_upgrade_test', PORT = 55998;
const PG = '/opt/homebrew/opt/postgresql@18/bin', LIB = '/opt/homebrew/opt/libpq/bin';
const command = promisify(execFile);
const env = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'C', LC_ALL: 'C' };
const qi = name => '"' + name.replaceAll('"', '""') + '"';
export const qaHash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fileSha256(file) {
  const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex');
}
async function run(bin, args, extra = {}) {
  try { return (await command(bin, args, { env, timeout: 30000, maxBuffer: 4000000, ...extra })).stdout; }
  catch { throw Error('Owned release QA subprocess failed; inspect private local evidence.'); }
}
export async function readonlySnapshot(pool) {
  const db = await pool.connect();
  try { await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const snapshot = await captureReleaseSnapshot(db); await db.query('COMMIT'); return snapshot; }
  catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
  finally { db.release(); }
}
function projections(snapshot) {
  // Restore changes catalog OIDs/ACL ownership. This verifies original row and
  // column projections only; never claim a full ACL/service restoration.
  return snapshot.tables.map(({ name, columns, rows, dataSha256 }) => ({ name, columns, rows, dataSha256 }));
}
export async function originalColumnHashes(pool, snapshot, migrationNames = []) {
  const db = await pool.connect(), result = [];
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL TimeZone TO 'UTC'"); await db.query("SET LOCAL DateStyle TO 'ISO, MDY'");
    await db.query("SET LOCAL IntervalStyle TO 'postgres'"); await db.query('SET LOCAL extra_float_digits TO 3');
    for (const table of snapshot.tables) {
      const current = (await db.query(`SELECT attname AS name,format_type(atttypid,atttypmod) AS type,attnotnull AS "notNull"
        FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`, [`public.${qi(table.name)}`])).rows;
      for (const old of table.columns) assert.deepEqual(current.find(c => c.name === old.name), old, 'Original column contract changed');
      const filter = table.name === '_migrations' && migrationNames.length ? 'WHERE NOT (nombre=ANY($1::text[]))' : '';
      const params = filter ? [migrationNames] : [];
      const row = (await db.query(`SELECT count(*)::text AS rows,
        encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS hash
        FROM (SELECT encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS h
          FROM (SELECT ${table.columns.map(c => qi(c.name)).join(',')},xmin::text AS qa_xmin,ctid::text AS qa_ctid
            FROM ONLY public.${qi(table.name)} ${filter}) p) hashed`, params)).rows[0];
      result.push({ table: table.name, ...row });
    }
    await db.query('COMMIT'); return result;
  } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
  finally { db.release(); }
}

/** Exact, previously authorized stopped local restoration only. Never reads a
 * production URL, runtime credential file, environment connection or backup.
 * Creates a database copy; keeps source rows untouched and all copies stopped
 * afterward for independent inspection. Host auth edits are confined to this
 * generated data directory and restored before shutdown.
 */
export async function withRestoredExecutorCopy(work) {
  const root = RESTORED_EXECUTOR_QA_ROOT, data = `${root}/data`, socket = `${root}/socket`;
  for (const dir of [root, data, socket]) { assert.equal(await realpath(dir), dir); assert.equal((await lstat(dir)).isDirectory(), true); }
  const marker = JSON.parse(await readFile(`${root}/rehearsal-marker.json`, 'utf8'));
  assert.equal(marker.root, root); assert.equal(marker.purpose, 'authorized-isolated-upgrade-rehearsal');
  assert.equal(marker.sourceArchiveSha256, 'a78b83041c118a426b0b0b38073c60747f7b4698eacdb5ac1cecddc556b42d0b');
  await assert.rejects(access(`${data}/postmaster.pid`), { code: 'ENOENT' });
  const policy = `(version 1)\n(allow default)\n(deny network-outbound)\n(deny file-write*)\n(allow file-write* (subpath "${data}") (subpath "${socket}") (literal "${root}/server.private.log"))\n`;
  assert.equal(await readFile(`${root}/server.sb`, 'utf8'), policy);
  const suffix = randomBytes(5).toString('hex'), target = `release_executor_qa_${suffix}`, restored = `release_backup_qa_${suffix}`;
  const role = `release_qa_${suffix}`, password = randomBytes(32).toString('hex');
  const hbaPath = `${data}/pg_hba.conf`, oldHba = await readFile(hbaPath);
  let control, pool, sourcePool, started = false, hbaChanged = false, sourceBefore;
  const start = async () => { await run('/usr/bin/sandbox-exec', ['-f', `${root}/server.sb`, `${PG}/pg_ctl`, '-D', data, '-l', `${root}/server.private.log`, '-w', '-t', '20', 'start']); };
  const stop = async () => {
    const pid = (await readFile(`${data}/postmaster.pid`, 'utf8')).split('\n'); assert.equal(pid[1], data);
    await run(`${PG}/pg_ctl`, ['-D', data, '-m', 'fast', '-w', '-t', '20', 'stop']);
    await assert.rejects(access(`${data}/postmaster.pid`), { code: 'ENOENT' });
  };
  const config = database => ({ host: '127.0.0.1', port: PORT, database, user: role, password: () => password,
    ssl: false, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000, lock_timeout: 5000 });
  const openControl = async () => { const db = new pg.Client({ host: socket, port: PORT, database: 'postgres', user: 'render_rehearsal', password: () => '', ssl: false, connectionTimeoutMillis: 5000 }); await db.connect(); return db; };
  try {
    started = true; await start(); control = await openControl();
    const guard = (await control.query(`SELECT current_setting('data_directory') AS directory,
      current_setting('port') AS port,current_setting('server_version_num') AS version`)).rows[0];
    assert.equal(guard.directory, data); assert.equal(guard.port, String(PORT)); assert.ok(Number(guard.version) >= 180000 && Number(guard.version) < 190000);
    assert.equal((await control.query('SELECT datname FROM pg_database WHERE datname=ANY($1::text[])', [[target, restored]])).rowCount, 0);
    const createRole = (await control.query("SELECT format('CREATE ROLE %I LOGIN SUPERUSER PASSWORD %L',$1::text,$2::text) AS sql", [role, password])).rows[0].sql;
    await control.query(createRole); // Generated local role only; no real person mapping.
    await control.query(`CREATE DATABASE ${qi(target)} WITH TEMPLATE ${qi(SOURCE)} OWNER render_rehearsal`);
    hbaChanged = true;
    await writeFile(hbaPath, `local all all trust\nhost ${target},${restored},${SOURCE} ${role} 127.0.0.1/32 scram-sha-256\nhost all all 127.0.0.1/32 reject\nhost all all ::1/128 reject\n`, { mode: 0o600 });
    await run(`${PG}/pg_ctl`, ['-D', data, 'reload']);
    pool = new pg.Pool(config(target)); sourcePool = new pg.Pool(config(SOURCE));
    pool.on('error', () => {}); sourcePool.on('error', () => {});
    for (const [database, db] of [[target, pool], [SOURCE, sourcePool]]) {
      const actual = (await db.query(`SELECT current_database() AS database,current_setting('data_directory') AS directory,
        host(inet_server_addr()) AS address,inet_server_port() AS port,current_user AS username`)).rows[0];
      assert.deepEqual(actual, { database, directory: data, address: '127.0.0.1', port: PORT, username: role });
    }
    sourceBefore = await readonlySnapshot(sourcePool);
    assert.deepEqual(projections(await readonlySnapshot(pool)), projections(sourceBefore));
    const backupSnapshot = await readonlySnapshot(pool);
    const [idRow] = (await pool.query('SELECT max(id)::bigint+100000 AS id FROM public.tareas')).rows;
    const taskId = Number(idRow.id); assert.ok(Number.isSafeInteger(taskId) && taskId > 0 && taskId <= 2147483647);
    const taskCols = backupSnapshot.tables.find(t => t.name === 'tareas').columns.map(c => c.name);
    assert.ok(['id', 'titulo', 'estado', 'tipo_tarea'].every(c => taskCols.includes(c)));
    const projected = taskCols.map(c => c === 'id' ? '$1' : c === 'titulo' ? '$2' : qi(c));
    await pool.query(`INSERT INTO public.tareas(${taskCols.map(qi).join(',')}) OVERRIDING SYSTEM VALUE
      SELECT ${projected.join(',')} FROM public.tareas ORDER BY id LIMIT 1`, [taskId, 'QA POSTBACKUP EXECUTOR SYNTHETIC ONLY']);
    const freshSnapshot = await readonlySnapshot(pool); assert.notEqual(freshSnapshot.sha256, backupSnapshot.sha256);
    assert.equal(BigInt(freshSnapshot.tables.find(t => t.name === 'tareas').rows), BigInt(backupSnapshot.tables.find(t => t.name === 'tareas').rows) + 1n);

    // Actual post-canary archive, written ONLY under this owned temporary root.
    const archivePath = `${root}/executor-postbackup-${suffix}.dump`;
    const dumpEnv = { ...env, PGHOST: socket, PGPORT: String(PORT), PGUSER: 'render_rehearsal', PGDATABASE: target, PGCONNECT_TIMEOUT: '5' };
    await run(`${LIB}/pg_dump`, ['--format=custom', '--schema=public', '--file', archivePath], { env: dumpEnv });
    await chmod(archivePath, 0o600);
    const archiveHash = await fileSha256(archivePath);
    await control.query(`CREATE DATABASE ${qi(restored)} OWNER render_rehearsal`);
    const restoreControl = new pg.Client({ host: socket, port: PORT, database: restored, user: 'render_rehearsal', password: () => '', ssl: false });
    await restoreControl.connect(); try { await restoreControl.query('DROP SCHEMA public'); } finally { await restoreControl.end(); }
    await run(`${LIB}/pg_restore`, ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--no-publications', '--no-subscriptions', '--dbname', restored, archivePath], { env: dumpEnv });
    const restoredPool = new pg.Pool(config(restored));
    try {
      assert.deepEqual(projections(await readonlySnapshot(restoredPool)), projections(freshSnapshot), 'Actual new dump restoration must contain originals AND postbackup task');
      assert.equal((await restoredPool.query('SELECT count(*)::int AS n FROM public.tareas WHERE id=$1', [taskId])).rows[0].n, 1);
    } finally { await restoredPool.end(); }
    assert.equal(await fileSha256(archivePath), archiveHash);
    const restorationEvidence = { version: 1, purpose: 'isolated-rehearsal-only', archiveHash,
      snapshotHash: freshSnapshot.sha256, originalColumnProjectionsMatch: true, postBackupTaskId: taskId,
      restoredDatabase: restored, originalTableCount: freshSnapshot.tables.length, aclOwnershipVerified: false,
      productionAuthority: false, liveConfigurationVerified: false };
    const evidencePath = `${root}/executor-restoration-${suffix}.json`;
    await writeFile(evidencePath, JSON.stringify(restorationEvidence) + '\n', { mode: 0o600, flag: 'wx' });
    const fixture = { root, pool, sourcePool, target, role, taskId, backupSnapshot, freshSnapshot, archivePath, archiveHash,
      connectionUrl: `postgresql://${role}:${password}@127.0.0.1:${PORT}/${target}`,
      restorationEvidence, restorationEvidencePath: evidencePath, restorationEvidenceHash: await fileSha256(evidencePath),
      async restart() {
        await pool.end(); await sourcePool.end(); await control.end(); control = null;
        await stop(); started = false; started = true; await start(); control = await openControl();
        pool = new pg.Pool(config(target)); sourcePool = new pg.Pool(config(SOURCE));
        pool.on('error', () => {}); sourcePool.on('error', () => {});
        fixture.pool = pool; fixture.sourcePool = sourcePool;
      },
    };
    return await work(fixture);
  } catch (cause) {
    // PostgreSQL row-constraint errors may include restored private row values.
    if (cause?.severity && /^[A-Z0-9]{5}$/.test(cause.code || '')) throw Object.assign(new Error('Isolated release QA SQL failed; private row values suppressed.'), { code: cause.code });
    throw cause;
  } finally {
    try { if (sourcePool && sourceBefore) assert.deepEqual(await readonlySnapshot(sourcePool), sourceBefore, 'Original restored database must remain unchanged'); }
    finally {
      await pool?.end().catch(() => {}); await sourcePool?.end().catch(() => {}); await control?.end().catch(() => {});
      try {
        if (hbaChanged) await writeFile(hbaPath, oldHba, { mode: 0o600 });
      } finally {
        // An authentication-file restore error must never skip stopping this
        // exact owned cluster. Preserve the error, but still close the listener.
        if (started) {
          try { await access(`${data}/postmaster.pid`); await stop(); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        await assert.rejects(access(`${data}/postmaster.pid`), { code: 'ENOENT' });
      }
    }
  }
}
