import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Actual principal HTTP and generated disposable PG only; no provider or
// notification transport. Ordinary discovery opens no listeners/connections.
test('moodboard task pages reach all authorized IDs while legacy reads remain bounded and read-only', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55921 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic('Own moodboard task-pages fixture stopped and removed.');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55921,
    url: 'postgresql://render2_fixture@127.0.0.1:55921/render2_local_test', identity });
  const logged = await request(f.base, '/api/login', { method: 'POST',
    body: { usuario: 'qa_luciano', password: fixturePassword } });
  assert.equal(logged.status, 200, 'Synthetic fixture login succeeds');
  assert.equal(logged.body.usuario.id, 91003); assert.equal(typeof logged.body.token, 'string');
  const token = logged.body.token;
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA task pages client',true) RETURNING id");
  const [outsideClient] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA task pages outside client',true) RETURNING id");
  const [board] = await f.query("INSERT INTO moodboard_boards(nombre) VALUES('QA paginated task picker') RETURNING id");
  await f.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES($1,$2)', [board.id, client.id]);
  const shared = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
    SELECT 'QA page task '||lpad(n::text,3,'0'),'QA shared display',$1,'pendiente','edicion',
      '{"workspace":"render_os"}'::jsonb FROM generate_series(1,151) n RETURNING id,titulo`, [client.id]);
  const [last] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
    VALUES('ZZ QA historical task assigned by ID','QA shared display',$1,'pendiente','edicion','{}'::jsonb)
    RETURNING id,titulo`, [client.id]);
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [last.id]);
  const privateCanary = 'AA_QA_PRIVATE_HISTORY_MUST_NOT_ESCAPE';
  const outsideCanary = 'AA_QA_OUTSIDE_CLIENT_MUST_NOT_ESCAPE';
  const [hidden] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
    VALUES($1,'Luciano QA',$2,'pendiente','edicion','{}'::jsonb) RETURNING id`, [privateCanary, client.id]);
  const [outside] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
    VALUES($1,'QA shared display',$2,'pendiente','edicion','{"workspace":"render_os"}'::jsonb) RETURNING id`,
  [outsideCanary, outsideClient.id]);
  const expected = [...shared].sort((a, b) => a.titulo < b.titulo ? -1 : a.titulo > b.titulo ? 1 : a.id - b.id).concat(last);
  assert.equal(expected.length, 152);
  const route = `/api/moodboards/boards/${board.id}/tasks`;
  const get = async (query = '', authenticated = true) => {
    const response = await fetch(new URL(route + query, f.base), {
      redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: authenticated ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  for (const table of tables) assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
  const snapshot = async () => {
    const hashes = {};
    for (const table of tables) {
      // Include tuple versions/locations: an identical-value UPDATE is not a
      // read-only success. Only digests enter failure diagnostics, not rows.
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table] = row.hash;
    }
    return hashes;
  };
  const baseline = await snapshot();
  const noLeaks = items => {
    assert.ok(Array.isArray(items));
    for (const row of items) {
      assert.deepEqual(Object.keys(row).sort(), ['id', 'titulo']);
      assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
      assert.equal(typeof row.titulo, 'string');
      assert.equal([hidden.id, outside.id].includes(row.id), false, 'Forbidden task ID must not escape');
      assert.equal(row.titulo.includes(privateCanary) || row.titulo.includes(outsideCanary), false, 'Forbidden title must not escape');
    }
  };
  const page = (result, limit, offset, items, nextOffset) => {
    assert.equal(result.status, 200); assert.equal(result.cache, 'no-store');
    assert.deepEqual(Object.keys(result.body).sort(), ['version', 'items', 'limit', 'offset', 'next_offset'].sort());
    assert.equal(result.body.version, 1); assert.equal(result.body.limit, limit); assert.equal(result.body.offset, offset);
    assert.equal(result.body.next_offset, nextOffset); noLeaks(result.body.items);
    assert.deepEqual(result.body.items, items);
  };

  await t.test('legacy no-query array remains first150 while explicit pages reach the final authorized ID', async () => {
    const legacy = await get();
    assert.equal(legacy.status, 200); assert.equal(legacy.cache, 'no-store'); noLeaks(legacy.body);
    assert.deepEqual(legacy.body, expected.slice(0, 150));
    const first = await get('?limit=150&offset=0'); page(first, 150, 0, expected.slice(0, 150), 150);
    const second = await get('?limit=150&offset=150'); page(second, 150, 150, expected.slice(150), null);
    assert.equal(second.body.items.at(-1).id, last.id);
    assert.equal(new Set([...first.body.items, ...second.body.items].map(row => row.id)).size, 152);
    assert.deepEqual(await snapshot(), baseline);
  });

  await t.test('strict positive page size, exhausted pages and maximum canonical offset keep the exact response contract', async () => {
    page(await get('?limit=1&offset=0'), 1, 0, expected.slice(0, 1), 1);
    page(await get('?limit=1&offset=151'), 1, 151, [last], null);
    page(await get('?limit=150&offset=152'), 150, 152, [], null);
    page(await get('?limit=150&offset=1000000'), 150, 1000000, [], null);
    assert.deepEqual(await snapshot(), baseline);
  });

  await t.test('malformed, noncanonical, duplicate and unknown page arguments reject without changing any table', async () => {
    const invalid = [
      '?limit=0&offset=0', '?limit=151&offset=0', '?limit=-1&offset=0', '?limit=01&offset=0',
      '?limit=1.0&offset=0', '?limit=1e2&offset=0', '?limit=%2B1&offset=0', '?limit=&offset=0',
      '?limit=%201&offset=0', '?limit=1%0A&offset=0', '?limit=NaN&offset=0',
      '?limit=150&offset=-1', '?limit=150&offset=1000001', '?limit=150&offset=00',
      '?limit=150&offset=1.0', '?limit=150&offset=1e2', '?limit=150&offset=%2B1', '?limit=150&offset=',
      '?limit=1&limit=2&offset=0', '?limit=150&offset=0&offset=1',
      '?limit%5B%5D=1&offset=0', '?limit=150&offset%5B%5D=0', '?q=private',
      '?limit=150&offset=0&unexpected=1',
    ];
    for (const query of invalid) {
      const result = await get(query);
      assert.equal(result.status, 400, 'Malformed page query must reject');
      assert.equal(Array.isArray(result.body), false);
      assert.equal(Object.hasOwn(result.body, 'items'), false);
      assert.equal(JSON.stringify(result.body).includes(privateCanary), false);
    }
    assert.deepEqual(await snapshot(), baseline);
  });

  await t.test('anonymous access remains unauthorized and every GET preserves the seeded domain and authentication rows', async () => {
    assert.equal((await get('?limit=150&offset=0', false)).status, 401);
    assert.deepEqual(await snapshot(), baseline);
    assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
  });
});
