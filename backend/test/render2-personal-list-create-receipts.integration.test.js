import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Opt-in only: no configured DATABASE_URL or external account is accepted.
test('personal page creation receipts: atomic actor-scoped retry, current recovery and serialized cap/order', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55864 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own page-receipt fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:fixture.root,cwd:fixture.root,port:55864,
    url:'postgresql://render2_fixture@127.0.0.1:55864/render2_local_test',identity});
  const api = (path, token, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const owner = await login('qa_luciano'), other = await login('qa_designer');
  const [ownerRow] = await fixture.query('SELECT id FROM usuarios WHERE usuario=$1', ['qa_luciano']);
  const [otherRow] = await fixture.query('SELECT id FROM usuarios WHERE usuario=$1', ['qa_designer']);
  const post = (body, token = owner) => api('/listas-personales', token, 'POST', body);
  const recover = (key, token = owner) => api(`/listas-personales/creaciones/${encodeURIComponent(key)}`, token);
  const payload = (patch = {}) => ({ request_id: randomUUID(), titulo: 'QA164 intentional private page', emoji: '📝',
    bloques: [{ tipo: 'texto', contenido: { texto: 'QA164 original' } }, { tipo: 'checklist', contenido: { titulo: 'QA164 tasks', items: [] } }], ...patch });
  const page = (response, key) => {
    assert.equal(response.creation_request_id, key);
    assert.match(String(response.id), /^[1-9]\d*$/); assert.equal(typeof response.titulo, 'string');
    assert.ok(Number.isSafeInteger(response.version) && response.version > 0);
    for (const field of ['bloques', 'secciones']) assert.ok(Array.isArray(response[field]), field);
    return response;
  };
  const receiptTables = ['personal_list_create_receipts'];
  assert.deepEqual(await fixture.query("SELECT to_regclass('public.personal_list_create_receipts') AS relation"),
    [{ relation: 'personal_list_create_receipts' }], 'Creation must use the agreed durable receipt relation');
  assert.deepEqual(await fixture.query(`SELECT column_name,data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='personal_list_create_receipts' ORDER BY column_name`), [
    { column_name: 'actor_user_id', data_type: 'integer' },
    { column_name: 'committed_at', data_type: 'timestamp with time zone' },
    { column_name: 'list_id', data_type: 'bigint' },
    { column_name: 'payload_hash', data_type: 'text' },
    { column_name: 'request_id', data_type: 'uuid' },
  ], 'Receipt schema must retain exact actor/key/hash/list/timestamp fields');
  const snapshot = async () => {
    const state = {};
    for (const table of ['listas_personales', 'lista_secciones', 'lista_items', 'lista_bloques', ...receiptTables]) {
      assert.match(table, /^[a-z_]+$/);
      state[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    }
    return state;
  };
  const receiptCount = state => receiptTables.reduce((sum, name) => sum + state[name].length, 0);
  const receiptState = state => Object.fromEntries(receiptTables.map(name => [name, state[name]]));

  await t.test('UUID is mandatory; malformed identity and invalid blocks never create page/section/block/receipt', async () => {
    const before = await snapshot(), missing = payload(); delete missing.request_id;
    ok(await post(missing), 428);
    for (const request_id of [null, '', 'not-a-uuid', 1, {}, `${randomUUID()}\n`]) ok(await post(payload({ request_id })), 400);
    const invalid = payload({ bloques: [{ tipo: 'unknown', contenido: {} }] }); ok(await post(invalid), 400);
    ok(await recover(invalid.request_id), 404); assert.deepEqual(await snapshot(), before);
  });
  await t.test('same-key concurrent create commits exactly one complete page and one durable receipt', async () => {
    const body = payload(), before = await snapshot();
    const responses = await Promise.all([post(body), post(body)]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 201]);
    const a = page(responses[0].body, body.request_id), b = page(responses[1].body, body.request_id);
    assert.deepEqual(a, b); assert.equal(a.bloques.length, 2); assert.equal(a.secciones.length, 1);
    const after = await snapshot();
    assert.equal(after.listas_personales.length, before.listas_personales.length + 1);
    assert.equal(after.lista_secciones.length, before.lista_secciones.length + 1);
    assert.equal(after.lista_bloques.length, before.lista_bloques.length + 2);
    assert.deepEqual(after.lista_items, before.lista_items); assert.equal(receiptCount(after), receiptCount(before) + 1);
    const stable = await snapshot(); assert.deepEqual(page(ok(await recover(body.request_id)), body.request_id), a);
    assert.deepEqual(page(ok(await post(body)), body.request_id), a); assert.deepEqual(await snapshot(), stable, 'Replay and recovery are read-only');
  });
  await t.test('equal pages with different keys are intentional creations, while changed intent on same key conflicts', async () => {
    const aBody = payload(), bBody = { ...aBody, request_id: randomUUID() }, before = await snapshot();
    const a = page(ok(await post(aBody), 201), aBody.request_id), b = page(ok(await post(bBody), 201), bBody.request_id);
    assert.notEqual(String(a.id), String(b.id)); assert.equal(a.titulo, b.titulo);
    assert.deepEqual(a.bloques.map(row => row.contenido), b.bloques.map(row => row.contenido));
    const after = await snapshot(); assert.equal(after.listas_personales.length, before.listas_personales.length + 2); assert.equal(receiptCount(after), receiptCount(before) + 2);
    for (const patch of [{ titulo: 'Changed intent' }, { emoji: '✅' }, { bloques: [] }]) {
      ok(await post({ ...aBody, ...patch }), 409); assert.deepEqual(await snapshot(), after);
    }
  });
  await t.test('lost observed response recovers current owned list including later edits, never cached creation content', async () => {
    const body = payload(); assert.equal((await post(body)).status, 201); // Deliberately discard the first DTO; no TCP-fault claim.
    const original = page(ok(await recover(body.request_id)), body.request_id), block = original.bloques[0];
    ok(await api(`/listas-personales/${original.id}`, owner, 'PATCH', { titulo: 'QA164 current renamed', expected_version: original.version }));
    ok(await api(`/listas-personales/bloques/${block.id}`, owner, 'PATCH', { tipo: block.tipo, contenido: { texto: 'QA164 current block' }, expected_version: block.version }));
    const before = await snapshot(), current = page(ok(await recover(body.request_id)), body.request_id);
    assert.equal(current.titulo, 'QA164 current renamed'); assert.ok(current.version > original.version);
    assert.equal(current.bloques.find(row => String(row.id) === String(block.id)).contenido.texto, 'QA164 current block');
    assert.deepEqual(page(ok(await post(body)), body.request_id), current); assert.deepEqual(await snapshot(), before);
  });
  await t.test('ownership is actor-scoped: foreign GET is404, same UUID may create another actor own page', async () => {
    const body = payload(), own = page(ok(await post(body), 201), body.request_id), before = await snapshot();
    ok(await recover(body.request_id, other), 404); assert.deepEqual(await snapshot(), before);
    const foreign = page(ok(await post(body, other), 201), body.request_id); assert.notEqual(String(foreign.id), String(own.id));
    assert.equal(page(ok(await recover(body.request_id)), body.request_id).id, own.id);
    assert.equal(page(ok(await recover(body.request_id, other)), body.request_id).id, foreign.id);
    const [ownership] = await fixture.query('SELECT usuario_id FROM listas_personales WHERE id=$1', [foreign.id]); assert.equal(ownership.usuario_id, otherRow.id);
    const visible = ok(await api('/listas-personales', other)); assert.equal(visible.some(row => String(row.id) === String(own.id)), false);
    const [ownOwnership] = await fixture.query('SELECT usuario_id FROM listas_personales WHERE id=$1', [own.id]); assert.equal(ownOwnership.usuario_id, ownerRow.id);
  });
  await t.test('deleted page keeps its receipt tombstone and returns409 without resurrection', async () => {
    const body = payload(), created = page(ok(await post(body), 201), body.request_id), receipts = receiptState(await snapshot());
    ok(await api(`/listas-personales/${created.id}`, owner, 'DELETE'));
    const before = await snapshot(); assert.deepEqual(receiptState(before), receipts, 'Physical page deletion must not cascade away receipt');
    ok(await recover(body.request_id), 409); ok(await post(body), 409); assert.deepEqual(await snapshot(), before);
  });

  const account = async suffix => {
    const username = `qa_personal_receipts164_${suffix}`;
    const [user] = await fixture.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'diseno',password_hash,true,1 FROM usuarios WHERE usuario='qa_designer' RETURNING id`, [username, `QA164 ${suffix}`]);
    return { id: user.id, username, token: await login(username) };
  };
  await t.test('inactive and revoked actors cannot create or recover existing receipt; no extra writes', async () => {
    for (const mode of ['inactive', 'revoked']) {
      const user = await account(mode), body = payload(); page(ok(await post(body, user.token), 201), body.request_id);
      await fixture.query(mode === 'inactive' ? 'UPDATE usuarios SET activo=false WHERE id=$1' : 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [user.id]);
      const before = await snapshot();
      ok(await post(payload(), user.token), 401); ok(await post(body, user.token), 401); ok(await recover(body.request_id, user.token), 401);
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('different-key concurrent creates serialize per-owner order positions', async () => {
    const user = await account('order'), bodies = Array.from({ length: 4 }, () => payload());
    const before = await snapshot(), pages = (await Promise.all(bodies.map(body => post(body, user.token)))).map((response, i) => page(ok(response, 201), bodies[i].request_id));
    assert.equal(new Set(pages.map(row => String(row.id))).size, 4);
    assert.deepEqual(pages.map(row => row.posicion).sort((a, b) => a - b), [0, 1, 2, 3]);
    const after = await snapshot(); assert.equal(receiptCount(after), receiptCount(before) + 4);
    assert.equal(after.listas_personales.length, before.listas_personales.length + 4); assert.equal(after.lista_bloques.length, before.lista_bloques.length + 8);
  });
  await t.test('near-cap concurrent distinct intents allow one creation, reject one atomically; replay still works at cap', async () => {
    const user = await account('cap');
    await fixture.query(`INSERT INTO listas_personales(usuario_id,titulo,emoji,posicion)
      SELECT $1,'QA164 cap seed '||n,'📝',n FROM generate_series(0,98) n`, [user.id]);
    const bodies = [payload(), payload()], before = await snapshot(), responses = await Promise.all(bodies.map(body => post(body, user.token)));
    assert.deepEqual(responses.map(row => row.status).sort(), [201, 409]);
    const winner = responses.findIndex(row => row.status === 201), loser = 1 - winner;
    const created = page(responses[winner].body, bodies[winner].request_id); assert.equal(created.posicion, 99);
    const after = await snapshot(); assert.equal(after.listas_personales.length, before.listas_personales.length + 1);
    assert.equal(after.lista_secciones.length, before.lista_secciones.length + 1); assert.equal(after.lista_bloques.length, before.lista_bloques.length + 2);
    assert.equal(receiptCount(after), receiptCount(before) + 1); ok(await recover(bodies[loser].request_id, user.token), 404);
    assert.deepEqual(page(ok(await post(bodies[winner], user.token)), bodies[winner].request_id), created);
    ok(await post(payload(), user.token), 409); assert.deepEqual(await snapshot(), after);
    const [count] = await fixture.query('SELECT count(*)::int AS total FROM listas_personales WHERE usuario_id=$1', [user.id]); assert.equal(count.total, 100);
  });
});
