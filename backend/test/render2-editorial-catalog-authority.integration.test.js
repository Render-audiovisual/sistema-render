import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loadEditorialCatalogSnapshot, EDITORIAL_CATALOG_SQL } from '../src/editorial-catalog.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('QA156 editorial catalogs retain current authority and coherent piece/evidence snapshot', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55803 }); let pool;
  t.after(async () => { await pool?.end(); await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA156 fixture cleanup ENOENT: ${f.root}; port55803`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55803/render2_local_test';
  const identitySql = `SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`;
  const verify = identity => assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55803, url, identity });
  verify((await f.query(identitySql))[0]);
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 15000, application_name: 'qa156-editorial-catalog' });
  verify((await pool.query(identitySql)).rows[0]);
  const mutableId = 991561, customId = 991562;
  for (const [id, name, role] of [[mutableId, 'qa156_mutable', 'admin'], [customId, 'qa156_custom', 'qa_catalog_custom']])
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$2,$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, name, role]);
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA156 synthetic editorial',true) RETURNING id");
  const domains = [
    { domain: 'historia', table: 'historias', route: '/api/historias' },
    { domain: 'publicacion', table: 'publicaciones', route: '/api/publicaciones' },
  ];
  const privateCanary = 'QA156_PRIVATE_METADATA';
  for (const d of domains) {
    const metadata = { tipo: 'Promo', hora: '10:30', private_catalog_canary: privateCanary };
    const extra = d.domain === 'publicacion' ? ",tipo" : '';
    const typeValue = d.domain === 'publicacion' ? ",'video'" : '';
    [d.piece] = await f.query(`INSERT INTO ${d.table}(cliente_id,estado,fecha_programada,idea,metadata${extra})
      VALUES($1,'pendiente',current_date,'QA156 original',$2::jsonb${typeValue}) RETURNING id`, [client.id, JSON.stringify(metadata)]);
    [d.archived] = await f.query(`INSERT INTO ${d.table}(cliente_id,estado,fecha_programada,idea,metadata${extra})
      VALUES($1,'pendiente',current_date,'QA156 archived',$2::jsonb${typeValue}) RETURNING id`,
    [client.id, JSON.stringify({ ...metadata, archivado_tablero: true })]);
    // Real UPDATE trigger supplies the starting evidence revision; never seed ledger proof.
    await f.query(`UPDATE ${d.table} SET copy='QA156 initial copy' WHERE id=$1`, [d.piece.id]);
  }
  const checked = (r, status = 200) => { assert.equal(r.status, status, 'Principal HTTP status; auth/body omitted'); return r.body; };
  const login = async name => checked(await request(f.base, '/api/login', { method: 'POST', body: { usuario: name, password: fixturePassword } })).token;
  const owner = await login('qa_franco'), staff = await login('qa_luciano'), custom = await login('qa156_custom');
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
  const snapshot = async () => {
    const hashes = {};
    for (const table of tables) { assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      hashes[table] = createHash('sha256').update(JSON.stringify(await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`))).digest('hex'); }
    return hashes;
  };
  const target = (rows, d) => { const row = rows.find(row => row.id === d.piece.id); assert.ok(row, 'Expected synthetic piece'); return row; };
  const http = async (route, token) => {
    const r = await fetch(new URL(route, f.base), { redirect: 'error', signal: AbortSignal.timeout(15000), headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') };
  };
  const commonFields = ['id','cliente_id','cliente_nombre','estado','fecha_programada','idea','copy','material_referencia','aclaraciones','prioridad','responsable',
    'responsable_diseño','responsable_revisión','responsable_publicacion','fecha_diseño_entrega','fecha_revisión_aprobación','fecha_publicación_real','metadata','created_at','updated_at','publicacion_evidencia'];
  const domainFields = {
    historia: ['responsable_planificacion','fecha_planificacion_inicio','fecha_diseño_inicio','fecha_revisión_inicio','notas_planificacion','notas_diseño','notas_revisión','notas_bloqueador'],
    publicacion: ['tipo','duracion_segundos','num_imagenes','responsable_edición','fecha_edición_entrega','origen_calendario','calendario_clave','fecha_bloqueada'],
  };
  for (const d of domains) await t.test(`${d.domain}: actual HTTP/helper no-store, original admin field set, staff/custom privacy and archive parity without DML`, async () => {
    const before = await snapshot();
    for (const [token, auth] of [[owner, { id: 91001, rol: 'admin', session_version: 1 }], [staff, { id: 91003, rol: 'edicion', session_version: 1 }],
      [custom, { id: customId, rol: 'qa_catalog_custom', session_version: 1 }]]) {
      for (const includeArchived of [false, true]) {
        const response = await http(`${d.route}?incluir_archivadas=${includeArchived}`, token), rows = checked(response);
        assert.equal(response.cache, 'no-store');
        const direct = await loadEditorialCatalogSnapshot(pool, auth, d.domain, { includeArchived });
        assert.equal(digest(rows), digest(direct), 'HTTP/helper parity without printing private rows');
        const piece = target(rows, d);
        assert.equal(rows.some(row => row.id === d.archived.id), d.domain === 'publicacion' && includeArchived);
        assert.equal(piece.idea, 'QA156 original'); assert.ok(Number.isSafeInteger(piece.publicacion_evidencia.revision));
        if (auth.rol === 'admin') {
          assert.deepEqual(Object.keys(piece).sort(), [...commonFields, ...domainFields[d.domain]].sort());
          assert.equal(piece.metadata.private_catalog_canary, privateCanary);
        } else {
          assert.equal(JSON.stringify(rows).includes(privateCanary), false);
          assert.equal(Object.hasOwn(piece.metadata || {}, 'private_catalog_canary'), false);
          assert.equal(piece.metadata.tipo, 'Promo');
        }
      }
    }
    checked(await http(d.route), 401); assert.deepEqual(await snapshot(), before);
  });

  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  async function reached(ready, pending) {
    let timer; try { await Promise.race([ready, pending.then(() => { throw Error('Expected SQL barrier not reached'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Bounded editorial barrier timeout')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  const actorSql = 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1';
  function pause(d, when) {
    const ready = deferred(), gate = deferred(), queries = [], releases = []; let paused = false;
    return { ready, gate, queries, releases, pool: { async connect() {
      const db = await pool.connect();
      return { release(error) { releases.push(error); db.release(error); }, async query(sql, values) {
        queries.push(sql);
        if (sql === actorSql && when === 'before' && !paused) { paused = true; ready.resolve(); await gate.promise; }
        // No diagnostic SELECT before actor: it must establish the RR snapshot.
        const result = await db.query(sql, values);
        if (sql === EDITORIAL_CATALOG_SQL[d.domain] && when === 'afterBase' && !paused) {
          paused = true;
          const settings = (await db.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];
          assert.equal(settings.isolation, 'repeatable read'); assert.equal(settings.readonly, 'on');
          ready.resolve(); await gate.promise;
        }
        return result;
      } };
    } } };
  }
  const reset = () => f.query("UPDATE usuarios SET rol='admin',activo=true,session_version=1 WHERE id=$1", [mutableId]);
  const auth = () => ({ id: mutableId, rol: 'admin', session_version: 1 });
  for (const d of domains) {
    for (const [label, update] of [['epoch', 'session_version=2'], ['role', "rol='edicion'"], ['inactive', 'activo=false']]) {
      await t.test(`${d.domain}: ${label} committed before actor read denies401 before catalog or evidence`, async () => {
        await reset(); const barrier = pause(d, 'before');
        const pending = loadEditorialCatalogSnapshot(barrier.pool, auth(), d.domain).then(data => ({ data }), error => ({ error })); let before;
        try { await reached(barrier.ready.promise, pending);
          assert.equal(barrier.queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          await f.query(`UPDATE usuarios SET ${update} WHERE id=$1`, [mutableId]); before = await snapshot();
        } finally { barrier.gate.resolve(); }
        const result = await pending; assert.equal(result.error?.status, 401); assert.equal(result.data, undefined);
        assert.deepEqual(barrier.queries, ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', actorSql, 'ROLLBACK']);
        assert.equal(barrier.releases.length, 1); assert.deepEqual(await snapshot(), before);
      });
    }
    await t.test(`${d.domain}: committed content/revision change after base read cannot tear evidence or reuse revoked actor`, async () => {
      await reset(); const beforeRows = await loadEditorialCatalogSnapshot(pool, auth(), d.domain), original = target(beforeRows, d);
      const barrier = pause(d, 'afterBase');
      const pending = loadEditorialCatalogSnapshot(barrier.pool, auth(), d.domain).then(data => ({ data }), error => ({ error })); let after;
      try { await reached(barrier.ready.promise, pending);
        const external = await pool.connect();
        try { verify((await external.query(identitySql)).rows[0]); await external.query('BEGIN');
          await external.query(`UPDATE ${d.table} SET idea='QA156 changed',metadata=metadata || $2::jsonb WHERE id=$1`,
            [d.piece.id, JSON.stringify({ tipo: 'Changed', private_catalog_canary: 'QA156_CHANGED_PRIVATE' })]);
          await external.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [mutableId]); await external.query('COMMIT');
        } catch (error) { await external.query('ROLLBACK'); throw error; } finally { external.release(); }
        after = await snapshot();
      } finally { barrier.gate.resolve(); }
      const result = await pending; assert.equal(result.error, undefined);
      const old = target(result.data, d);
      assert.equal(old.idea, original.idea); assert.equal(digest(old.metadata), digest(original.metadata), 'Old-consistent metadata');
      assert.equal(old.publicacion_evidencia.revision, original.publicacion_evidencia.revision);
      assert.ok(barrier.queries.some(sql => sql.includes('LEFT JOIN editorial_publicacion_versiones')));
      assert.equal(barrier.queries.at(-1), 'COMMIT'); assert.equal(barrier.releases.length, 1);
      await assert.rejects(loadEditorialCatalogSnapshot(pool, auth(), d.domain), error => error.status === 401);
      const fresh = target(await loadEditorialCatalogSnapshot(pool, { ...auth(), session_version: 2 }, d.domain), d);
      assert.equal(fresh.idea, 'QA156 changed'); assert.equal(fresh.metadata.tipo, 'Changed');
      assert.equal(fresh.publicacion_evidencia.revision, original.publicacion_evidencia.revision + 1);
      assert.deepEqual(await snapshot(), after);
    });
  }

  await t.test('mutable auth/options cannot redirect captured prelease actor or include archived publications', async () => {
    for (const revoke of [false, true]) {
      await reset(); const ready = deferred(), gate = deferred(), observed = auth(), options = { includeArchived: false };
      const pending = loadEditorialCatalogSnapshot({ async connect() { ready.resolve(); await gate.promise; return pool.connect(); } }, observed, 'publicacion', options)
        .then(data => ({ data }), error => ({ error })); let before;
      try { await reached(ready.promise, pending); observed.id = 91001; observed.session_version = 1; options.includeArchived = true;
        if (revoke) await f.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [mutableId]); before = await snapshot();
      } finally { gate.resolve(); }
      const result = await pending;
      if (revoke) { assert.equal(result.error?.status, 401); assert.equal(result.data, undefined); }
      else { assert.equal(result.error, undefined); assert.equal(result.data.some(row => row.id === domains[1].archived.id), false); }
      assert.deepEqual(await snapshot(), before);
    }
  });
});
