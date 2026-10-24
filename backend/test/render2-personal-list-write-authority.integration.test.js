import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loginAbuseBucketKey } from '../src/login-abuse.js';

// Principal HTTP + disposable PostgreSQL only. Ordinary discovery starts no DB
// or listener. Main must authorize the physical run after writer adoption.
test('personal-list writers retain current actor authority until commit across every private write family', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55865 });
  const clients = new Set();
  t.after(async () => {
    for (const client of clients) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own personal-list authority fixture removed: ${fixture.root}`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55865/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55865, url, identity });
  const connect = async name => {
    const client = new pg.Client({ connectionString: url, application_name: `qa176-${name}`, statement_timeout: 15000 });
    clients.add(client); await client.connect(); return client;
  };
  const close = async client => {
    try { await client.query('ROLLBACK'); } finally { await client.end(); clients.delete(client); }
  };
  const observer = await connect('observer');
  const waitFor = async (sql, values, message) => {
    const deadline = Date.now() + 6000;
    do {
      const result = await observer.query(sql, values);
      if (result.rows.length) return result.rows[0];
      // Poll pacing, never evidence: success requires actual PostgreSQL blockers.
      await new Promise(resolve => setTimeout(resolve, 15));
    } while (Date.now() < deadline);
    assert.fail(message);
  };
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Expected principal HTTP status'); return result.body; };
  const login = async (usuario = 'qa_luciano') => {
    // This authority matrix intentionally needs >20 genuine fresh logins for
    // one synthetic account. Reset ONLY that identifier's disposable-fixture
    // bucket; retain the peer bucket and all production throttling semantics.
    await fixture.query('DELETE FROM auth_login_buckets WHERE bucket_key=$1',
      [loginAbuseBucketKey('identifier', usuario, fixture.secret)]);
    const body = checked(await request(fixture.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.equal(typeof body.token, 'string'); return body.token;
  };
  const api = async (path, token, method = 'GET', body) => {
    const response = await fetch(new URL(`/api${path}`, fixture.base), {
      method, signal: AbortSignal.timeout(20000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const tables = ['listas_personales', 'lista_secciones', 'lista_items', 'lista_bloques', 'lista_plantillas_personales',
    'personal_list_create_receipts', 'lista_recordatorios_personales', 'mia_lista_propuestas', 'mia_lista_auditoria',
    'tareas', 'tarea_asignaciones', 'tarea_comentarios'];
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      const rows = await fixture.query(`SELECT * FROM ${table} r ORDER BY to_jsonb(r)::text`);
      result[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    }
    return result;
  };
  const actorId = 91003;
  let token = await login();
  const page = checked(await api('/listas-personales', token, 'POST', { request_id: randomUUID(),
    titulo: 'QA176 private page', emoji: '📝', bloques: [
      { tipo: 'texto', contenido: { texto: 'Original private text' } },
      { tipo: 'checklist', contenido: { titulo: 'Retained checklist', items: [{ id: 'keep176', texto: 'Preserve reminder history', completado: false }] } },
    ] }), 201);
  const read = async () => checked(await api('/listas-personales', token));
  const own = async () => { const value = (await read()).find(row => row.id === page.id); assert.ok(value); return value; };
  assert.equal(page.bloques.length, 2);
  const textBlock = page.bloques.find(row => row.tipo === 'texto');
  const checklist = page.bloques.find(row => row.tipo === 'checklist');
  const section = checked(await api(`/listas-personales/${page.id}/secciones`, token, 'POST', { titulo: 'QA176 explicit section' }), 201);
  const item = checked(await api(`/listas-personales/secciones/${section.id}/items`, token, 'POST', { texto: 'Original item' }), 201);
  const template = checked(await api('/listas-personales/plantillas', token, 'POST', { titulo: 'QA176 template', emoji: '📝', bloques: [] }), 201);
  // Fixture-only history makes denied cascade deletion observable, not vacuous.
  await fixture.query(`INSERT INTO lista_recordatorios_personales(usuario_id,lista_id,bloque_id,item_uid,texto,proximo_envio_at)
    VALUES($1,$2,$3,'keep176','QA176 synthetic reminder',now()+interval '1 day')`, [actorId, page.id, checklist.id]);
  await fixture.query(`INSERT INTO mia_lista_auditoria(usuario_id,actor_usuario_id,operacion,lista_id,bloque_id,item_uid,detalles)
    VALUES($1,$1,'qa176_fixture',$2,$3,'keep176','{"fixture":true}'::jsonb)`, [actorId, page.id, checklist.id]);

  const writers = [
    { name: 'template create', method: 'POST', path: '/listas-personales/plantillas', body: () => ({ titulo: 'Never insert template', emoji: '📝', bloques: [] }) },
    { name: 'template delete', method: 'DELETE', path: `/listas-personales/plantillas/${template.id}` },
    { name: 'page PATCH', method: 'PATCH', path: `/listas-personales/${page.id}`, body: fresh => ({ titulo: 'Never overwrite page', expected_version: fresh.version }) },
    { name: 'page delete', method: 'DELETE', path: `/listas-personales/${page.id}` },
    { name: 'section create', method: 'POST', path: `/listas-personales/${page.id}/secciones`, body: () => ({ titulo: 'Never insert section' }) },
    { name: 'section PATCH', method: 'PATCH', path: `/listas-personales/secciones/${section.id}`, body: () => ({ titulo: 'Never rename section' }) },
    { name: 'section delete', method: 'DELETE', path: `/listas-personales/secciones/${section.id}` },
    { name: 'item create', method: 'POST', path: `/listas-personales/secciones/${section.id}/items`, body: () => ({ texto: 'Never insert item' }) },
    { name: 'item PATCH', method: 'PATCH', path: `/listas-personales/items/${item.id}`, body: () => ({ texto: 'Never overwrite item', completado: true }) },
    { name: 'item delete', method: 'DELETE', path: `/listas-personales/items/${item.id}` },
    { name: 'block create', method: 'POST', path: `/listas-personales/${page.id}/bloques`, body: () => ({ tipo: 'texto', contenido: { texto: 'Never insert block' } }) },
    { name: 'block PATCH', method: 'PATCH', path: `/listas-personales/bloques/${textBlock.id}`, body: fresh => ({ tipo: 'texto', contenido: { texto: 'Never overwrite block' }, expected_version: fresh.bloques.find(row => row.id === textBlock.id).version }) },
    { name: 'block delete', method: 'DELETE', path: `/listas-personales/bloques/${checklist.id}` },
    { name: 'reorder', method: 'PATCH', path: '/listas-personales/orden/reordenar', body: fresh => ({ tipo: 'bloques', parent_id: page.id, ids: fresh.bloques.map(row => row.id).reverse() }) },
  ];
  assert.equal(writers.length, 14);
  const deniedAfterActorWait = async (writer, changeSql, subsequentReadStatus = 401) => {
    // Fresh genuine login per case: epochs only advance, never reset backwards.
    token = await login();
    const fresh = await own(), body = writer.body?.(fresh), before = await snapshot();
    const holder = await connect('actor-holder'); let pending;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [actorId]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = api(writer.path, token, writer.method, body); void pending.catch(() => {});
      await waitFor(`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
        AND a.pid<>pg_backend_pid() AND a.wait_event_type='Lock' AND a.query ILIKE '%usuarios%'
        AND a.query ILIKE '%FOR UPDATE%' AND $1::int=ANY(pg_blocking_pids(a.pid))`, [holderPid],
      `${writer.name} must authenticate then wait at its transaction actor FOR UPDATE`);
      await holder.query(changeSql, [actorId]);
      await holder.query('COMMIT');
      checked(await pending, 401);
      assert.deepEqual(await snapshot(), before, 'Authority denial must not mutate private rows, cascades, receipts or MIA history');
      // The in-flight write pins its observed role and must fail above. A later
      // request reloads the live role; role-only SQL did not revoke the epoch.
      const home = checked(await api('/inicio', token), subsequentReadStatus);
      if (subsequentReadStatus === 200) assert.equal(home.user.id, actorId);
      assert.deepEqual(await snapshot(), before, 'Subsequent identity check must also leave business data unchanged');
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      if (pending) await Promise.allSettled([pending]);
      await close(holder);
      // Restore only fixture role/activity for the next genuine login; keep epoch.
      await fixture.query("UPDATE usuarios SET rol='edicion',activo=true WHERE id=$1", [actorId]);
    }
  };
  for (const writer of writers) await t.test(`${writer.name}: epoch revocation before actor lock denies401 without DML`, () =>
    deniedAfterActorWait(writer, 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1'));
  for (const tipo of ['listas','secciones','items']) await t.test(`${tipo} reorder: epoch revocation before actor lock denies401 without DML`, () =>
    deniedAfterActorWait({name:`${tipo} reorder`,method:'PATCH',path:'/listas-personales/orden/reordenar',body:fresh=>({
      tipo,ids:tipo==='listas'?[page.id]:tipo==='secciones'?fresh.secciones.map(row=>row.id):[item.id],
      ...(tipo==='listas'?{}:{parent_id:tipo==='items'?section.id:page.id}),
    })}, 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1'));
  for (const name of ['page PATCH', 'block PATCH']) for (const [loss, sql, subsequentReadStatus] of [
    ['role replacement', "UPDATE usuarios SET rol='diseno' WHERE id=$1", 200],
    ['inactive account', 'UPDATE usuarios SET activo=false WHERE id=$1', 401],
  ]) await t.test(`${name}: ${loss} before actor lock also denies401`, () => deniedAfterActorWait(writers.find(row => row.name === name), sql, subsequentReadStatus));

  for (const kind of ['page', 'block']) await t.test(`${kind} PATCH: acquired actor authority serializes revocation behind the domain writer`, async () => {
    token = await login(); const originalToken = token, fresh = await own();
    const old = kind === 'page' ? fresh : fresh.bloques.find(row => row.id === textBlock.id);
    const path = kind === 'page' ? `/listas-personales/${page.id}` : `/listas-personales/bloques/${textBlock.id}`;
    const table = kind === 'page' ? 'listas_personales' : 'lista_bloques';
    const body = kind === 'page' ? { titulo: 'QA176 serialized page ACK', expected_version: old.version }
      : { tipo: 'texto', contenido: { texto: 'QA176 serialized block ACK' }, expected_version: old.version };
    const holder = await connect('domain-holder'), revoker = await connect('revoker'); let pending, revocation;
    try {
      await holder.query('BEGIN'); await holder.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [old.id]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = api(path, originalToken, 'PATCH', body); void pending.catch(() => {});
      const writer = await waitFor(`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
        AND a.pid<>pg_backend_pid() AND a.wait_event_type='Lock' AND a.query ILIKE $2
        AND $1::int=ANY(pg_blocking_pids(a.pid))`, [holderPid, `%${table}%`],
      'HTTP writer must already hold actor authority while waiting on the owned domain row');
      await revoker.query('BEGIN');
      const revokerPid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      revocation = revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [actorId]);
      void revocation.catch(() => {});
      await waitFor(`SELECT pid FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'
        AND $2::int=ANY(pg_blocking_pids(pid))`, [revokerPid, writer.pid],
      'Independent revocation must wait on the actual writer actor lock, not merely an unfinished HTTP promise');
      await holder.query('COMMIT');
      const saved = checked(await pending); assert.equal(saved.id, old.id); assert.equal(saved.version, old.version + 1);
      await revocation; await revoker.query('COMMIT');
      checked(await api('/inicio', originalToken), 401);
      token = await login(); const reread = await own();
      const actual = kind === 'page' ? reread : reread.bloques.find(row => row.id === old.id);
      assert.equal(actual.version, saved.version);
      if (kind === 'page') assert.equal(actual.titulo, body.titulo); else assert.deepEqual(actual.contenido, body.contenido);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      if (pending) await Promise.allSettled([pending]);
      if (revocation) await Promise.allSettled([revocation]);
      await close(revoker); await close(holder);
    }
  });

  await t.test('late reorder SQL failure rolls back every earlier position/version update; healthy explicit retry succeeds', async () => {
    token = await login(); const fresh = await own(), ids = fresh.bloques.map(row => row.id).reverse();
    assert.equal(ids.length, 2); assert.match(String(ids[1]), /^[1-9][0-9]*$/);
    const before = await snapshot();
    // Own generated fixture only. No persistent schema/constraint is altered.
    await fixture.query(`CREATE FUNCTION qa176_reorder_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'QA176 intentional second-row fault'; END $$;
      CREATE TRIGGER qa176_reorder_fault BEFORE UPDATE ON lista_bloques
        FOR EACH ROW WHEN (NEW.id=${ids[1]}) EXECUTE FUNCTION qa176_reorder_fault()`);
    try {
      checked(await api('/listas-personales/orden/reordenar', token, 'PATCH', { tipo: 'bloques', parent_id: page.id, ids }), 500);
      assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query('DROP TRIGGER qa176_reorder_fault ON lista_bloques; DROP FUNCTION qa176_reorder_fault()'); }
    checked(await api('/listas-personales/orden/reordenar', token, 'PATCH', { tipo: 'bloques', parent_id: page.id, ids }));
    const reread = await own(); assert.deepEqual(reread.bloques.map(row => row.id), ids);
    for (const row of reread.bloques) assert.equal(row.version, fresh.bloques.find(prior => prior.id === row.id).version + 1);
    assert.deepEqual(reread.bloques.map(row => row.contenido), ids.map(id => fresh.bloques.find(row => row.id === id).contenido));
  });

  await t.test('ordinary stale CAS, foreign owner and anonymous requests remain fail-closed after authority adoption', async () => {
    token = await login();
    const fresh = await own(), foreign = await login('qa_designer'), before = await snapshot();
    checked(await api(`/listas-personales/${page.id}`, null, 'PATCH', { titulo: 'Anonymous', expected_version: fresh.version }), 401);
    checked(await api(`/listas-personales/${page.id}`, foreign, 'PATCH', { titulo: 'Foreign', expected_version: fresh.version }), 404);
    checked(await api(`/listas-personales/bloques/${textBlock.id}`, foreign, 'PATCH', { tipo: 'texto', contenido: { texto: 'Foreign' }, expected_version: fresh.bloques.find(row => row.id === textBlock.id).version }), 404);
    checked(await api(`/listas-personales/${page.id}`, token, 'PATCH', { titulo: 'Stale', expected_version: page.version }), 409);
    assert.deepEqual(await snapshot(), before);
  });
});
