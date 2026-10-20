import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const defaultCategories = ['Fotografía', 'Tipografía', 'Color', 'Composición', 'Historias', 'Carrusel', 'Flyer'];

// Explicit physical opt-in only. No principal imports, configured DB, image
// download, model/provider call or existing cluster. All data is fixture-only.
test('principal read-only resources: Moodboards/Wilson GET preserve rows; explicit initializer is atomic and idempotent', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55679 });
  t.after(async () => {
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own read-only resources fixture stopped and removed: ${fixture.root}`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55679/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55679, url, identity });
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'Principal HTTP status; credentials intentionally omitted'); return response.body;
  };
  const api = (route, token, method = 'GET', body) => request(fixture.base, `/api${route}`, { token, method, body });
  const login = async usuario => checked(await api('/login', undefined, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), designer = await login('qa_designer'), editor = await login('qa_luciano');
  const initialize = (token = designer, body = {}) => api('/moodboards/boards/initialize', token, 'POST', body);
  const [clock] = await fixture.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period`);
  const clients = {};
  const client = async (name, active = true) => (await fixture.query('INSERT INTO clientes(nombre,activo) VALUES ($1,$2) RETURNING id,nombre', [name, active]))[0];
  clients.existing = await client('QA readonly existing client 55679');
  clients.first = await client('QA readonly first uninitialized client 55679');
  clients.second = await client('QA readonly second uninitialized client 55679');
  clients.inactive = await client('QA readonly inactive client 55679', false);
  const [existingBoard] = await fixture.query('INSERT INTO moodboard_boards(nombre) VALUES ($1) RETURNING id', ['QA readonly existing board 55679']);
  await fixture.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES ($1,$2)', [existingBoard.id, clients.existing.id]);
  const [existingCategory] = await fixture.query(`INSERT INTO moodboard_categories(board_id,nombre,orden) VALUES ($1,'QA preserved custom category',42) RETURNING id`, [existingBoard.id]);
  const [existingReference] = await fixture.query(`INSERT INTO moodboard_references
    (board_id,category_id,titulo,nota,etiquetas,estado,tipo_fuente,enlace_externo,autor_id,autor_nombre)
    VALUES ($1,$2,'QA stored real fixture reference','Preserve this exact authored note',ARRAY['preserve'],'aprobada',
      'enlace','https://example.invalid/readonly-existing-reference',91004,'QA fixture designer') RETURNING id`, [existingBoard.id, existingCategory.id]);
  const [conversation] = await fixture.query(`INSERT INTO wilson_conversaciones(usuario_id,periodo,created_at,updated_at,last_read_at)
    VALUES (91003,$1,'2026-01-01T10:00:00Z','2026-01-02T10:00:00Z','2026-01-01T10:30:00Z') RETURNING id`, [clock.period]);
  const [message] = await fixture.query(`INSERT INTO wilson_mensajes(conversacion_id,remitente,contenido,tipo,metadata,created_at)
    VALUES ($1,'wilson','QA original stored conversation message','mensaje','{"qa_preserve":true}','2026-01-02T10:00:00Z') RETURNING id`, [conversation.id]);
  const tables = (await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  // Full rows/timestamps, including all Wilson actions/read state and reference
  // history. Digests prevent accidental private-content dumps in failures.
  const snapshot = async () => {
    const state = {};
    for (const name of tables) state[name] = fingerprint(await fixture.query(`SELECT * FROM "${name}" r ORDER BY to_jsonb(r)::text`));
    return state;
  };
  const preservedReferences = async () => fixture.query('SELECT * FROM moodboard_references r ORDER BY to_jsonb(r)::text');
  const originalReferences = await preservedReferences();
  const assertPreserved = async () => assert.equal(fingerprint(await preservedReferences()), fingerprint(originalReferences),
    'Initializer must neither seed fictional references nor rewrite preexisting references');
  const unmapped = async id => assert.deepEqual(await fixture.query('SELECT board_id FROM moodboard_board_clients WHERE cliente_id=$1', [id]), []);
  const assertInitialized = async wanted => {
    const ids = [];
    const boards = checked(await api('/moodboards/boards', designer));
    for (const item of wanted) {
      const links = await fixture.query('SELECT board_id FROM moodboard_board_clients WHERE cliente_id=$1', [item.id]);
      assert.equal(links.length, 1, 'Exactly one mapping for each explicitly initialized active client');
      const boardId = links[0].board_id; ids.push(boardId);
      assert.equal(boards.filter(board => board.id === boardId && board.clientes.some(row => row.id === item.id)).length, 1);
      const named = await fixture.query('SELECT id FROM moodboard_boards WHERE nombre=$1', [item.nombre]);
      assert.deepEqual(named, [{ id: boardId }], 'No orphan or duplicate board created by a competing initializer');
      const categories = checked(await api(`/moodboards/boards/${boardId}/categories`, designer));
      assert.deepEqual(categories.map(row => row.nombre), defaultCategories);
      assert.deepEqual(categories.map(row => row.orden), [1, 2, 3, 4, 5, 6, 7]);
      assert.equal(new Set(categories.map(row => row.id)).size, 7);
      assert.deepEqual(checked(await api(`/moodboards/boards/${boardId}/references`, designer)), []);
    }
    assert.equal(new Set(ids).size, wanted.length, 'Distinct ordinary client names have distinct boards');
    await unmapped(clients.inactive.id); await assertPreserved();
  };

  await t.test('repeated Moodboard GET and Wilson self/admin GET do not initialize resources or touch existing conversations', async () => {
    const before = await snapshot();
    for (let pass = 0; pass < 3; pass += 1) {
      const boards = checked(await api('/moodboards/boards', designer));
      for (const item of [clients.first, clients.second, clients.inactive]) {
        assert.equal(boards.some(board => board.clientes.some(row => row.id === item.id)), false); await unmapped(item.id);
      }
      const absent = checked(await api('/wilson/conversacion', designer));
      assert.equal(absent.conversation, null); assert.deepEqual(absent.messages, []);
      const present = checked(await api('/wilson/conversacion', editor));
      assert.equal(present.conversation.id, conversation.id); assert.equal(present.messages.length, 1); assert.equal(present.messages[0].id, message.id);
      for (const [userId, exists] of [[91003, true], [91002, false], [91004, false]]) {
        const detail = checked(await api(`/wilson/conversaciones/${userId}`, admin));
        assert.equal(detail.conversation?.id ?? null, exists ? conversation.id : null);
        assert.deepEqual(detail.messages.map(row => row.id), exists ? [message.id] : []);
      }
      checked(await api('/wilson/conversaciones', admin));
      checked(await api('/wilson/notificaciones', editor));
      checked(await api(`/moodboards/boards/${existingBoard.id}/categories`, designer));
      checked(await api(`/moodboards/boards/${existingBoard.id}/references`, designer));
      checked(await api(`/moodboards/boards/${existingBoard.id}/tasks`, designer));
    }
    assert.deepEqual(await snapshot(), before, 'GET must not INSERT conversations/boards/categories or UPDATE read/updated timestamps');
  });

  await t.test('anonymous and malformed initialization requests reject without resource writes; employee cannot read admin conversations', async () => {
    const before = await snapshot();
    for (const [route, method] of [['/moodboards/boards', 'GET'], ['/moodboards/boards/initialize', 'POST'],
      ['/wilson/conversacion', 'GET'], ['/wilson/conversaciones/91003', 'GET']])
      checked(await api(route, undefined, method, method === 'POST' ? {} : undefined), 401);
    for (const body of [{ force: true }, { cliente_id: clients.first.id }, []]) checked(await initialize(designer, body), 400);
    checked(await api('/wilson/conversaciones/91003', designer), 403);
    checked(await api('/wilson/conversaciones', designer), 403);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('designer explicit POST creates actual active-client boards/categories, without fabricated references or changes to existing history', async () => {
    const before = await snapshot();
    assert.deepEqual(checked(await initialize()), { ok: true });
    await assertInitialized([clients.first, clients.second]);
    const after = await snapshot();
    const mutable = new Set(['moodboard_boards', 'moodboard_board_clients', 'moodboard_categories']);
    for (const name of tables.filter(name => !mutable.has(name))) assert.equal(after[name], before[name], `${name} preserved by initialization`);
    assert.equal((await fixture.query('SELECT id FROM moodboard_references WHERE id=$1', [existingReference.id])).length, 1);
  });

  await t.test('repeated POST and subsequent GETs are exact row-idempotent including timestamps', async () => {
    const before = await snapshot();
    assert.deepEqual(checked(await initialize()), { ok: true });
    assert.deepEqual(checked(await initialize(editor)), { ok: true });
    await assertInitialized([clients.first, clients.second]);
    checked(await api('/wilson/conversacion', editor));
    checked(await api('/wilson/conversaciones/91004', admin));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('two different current actors initializing new clients concurrently create no duplicate boards/categories', async () => {
    clients.third = await client('QA readonly concurrent third client 55679');
    clients.fourth = await client('QA readonly concurrent fourth client 55679');
    const beforeGet = await snapshot(); checked(await api('/moodboards/boards', designer));
    await unmapped(clients.third.id); await unmapped(clients.fourth.id); assert.deepEqual(await snapshot(), beforeGet);
    const results = await Promise.all([initialize(designer), initialize(editor)]);
    for (const result of results) assert.deepEqual(checked(result), { ok: true });
    await assertInitialized([clients.first, clients.second, clients.third, clients.fourth]);
    const stable = await snapshot(); checked(await initialize()); assert.deepEqual(await snapshot(), stable);
  });

  await t.test('initializer waiting for its advisory lock rechecks current actor version before any board write', async () => {
    const pendingClient = await client('QA readonly revoked pending client 55679');
    // Connect only to this generated, identity-checked physical fixture.
    const barrier = new pg.Client({ connectionString: url }); await barrier.connect();
    let pending;
    try {
      await barrier.query("SELECT pg_advisory_lock(hashtext('render:moodboards:initialize'))");
      const pid = (await barrier.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = initialize(editor);
      let blocked = false;
      const until = Date.now() + 2500;
      while (Date.now() < until) {
        if ((await barrier.query('SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))', [pid])).rowCount) {
          blocked = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.ok(blocked, 'Actual HTTP initializer must be waiting on the fixture-held advisory lock');
      await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
      const revoked = await snapshot();
      await barrier.query("SELECT pg_advisory_unlock(hashtext('render:moodboards:initialize'))");
      checked(await pending, 401); await unmapped(pendingClient.id); assert.deepEqual(await snapshot(), revoked);
      await assertPreserved();
    } finally {
      await barrier.query("SELECT pg_advisory_unlock(hashtext('render:moodboards:initialize'))");
      if (pending) await pending.catch(() => {});
      await barrier.end();
    }
  });
});
