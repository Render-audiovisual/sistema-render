import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { readFeedbackNotesPage, readFeedbackNoteDetail } from '../src/feedback-notes-read.js';

test('QA119 physical shared feedback-note pagination, deep reads and observation fences', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55768 });
  let pool;
  t.after(async () => {
    try { await pool?.end(); } finally { await f.cleanup(); }
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA119 cleanup ENOENT: ${f.root}; PostgreSQL port55768`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55768/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55768, url, identity });
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 15000, application_name: 'qa119-own-notes' });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), staff = await login('qa_luciano');
  const customId = 991190;
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,'qa119_custom','QA119 verified custom','qa_unknown',password_hash,true,1 FROM usuarios WHERE id=91004`, [customId]);
  const custom = await login('qa119_custom');
  await f.query("INSERT INTO clientes(nombre,activo) VALUES('Zafiro119',true),('Obsidiana119',true)");
  const marker = 'QA119_PRIVATE_FINANCIAL_CANARY';
  // Volume is explicit synthetic fixture SQL, never claimed as 620 API writes.
  // Five distinct microsecond values collapse to one JS millisecond; each also
  // has many exact timestamp ties, so both timestamp precision and ID tie-break
  // are needed to produce a complete stable traversal.
  const bulk = await f.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback,created_at,updated_at)
    SELECT 'QA119 client '||g,CASE WHEN g=5 THEN 'needle119 beyond the old 500' ELSE 'Synthetic client note '||g END,
      CASE WHEN g%3=0 THEN 'diseno' WHEN g%3=1 THEN 'reunion' ELSE 'general' END,'QA119 fixture','QA119 fixture',
      jsonb_build_object('cliente','Zafiro119','responsables',jsonb_build_array('QA119 fixture'),'flujo','feedback',
        'estado','pendiente','vigencia','puntual','referencia','https://example.invalid/qa119/reference',
        'finance',jsonb_build_object('marker',$1::text,'importe',817293.46))
        ||CASE WHEN g=5 THEN jsonb_build_object('origen','mia_whatsapp','confirmado_por','QA119 historical fixture',
          'confirmado_por_id',91001,'confirmado_at','2026-10-01T12:00:00.123456Z','provenance_version',1,
          'wilson_idempotency_key',$1::text,'unknown_bag',jsonb_build_object('marker',$1::text)) ELSE '{}'::jsonb END,
      '2026-10-01T12:00:00.123000Z'::timestamptz,
      '2026-10-01T12:00:00.123000Z'::timestamptz+(g%5)*interval '1 microsecond'
    FROM generate_series(1,620) g RETURNING id,titulo,categoria`, [marker]);
  const ordered = [...bulk].sort((a, b) => {
    const ai = Number(a.titulo.split(' ').at(-1)), bi = Number(b.titulo.split(' ').at(-1));
    return bi % 5 - ai % 5 || b.id - a.id;
  });
  const deep = bulk.find(row => row.titulo === 'QA119 client 5');
  assert.ok(ordered.findIndex(row => row.id === deep.id) >= 500);
  // Provenance above is persisted historical fixture data, not a live MIA claim.
  // Insert it initially: the real 061 UPDATE trigger would advance updated_at.
  const team = await f.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback,updated_at)
    SELECT 'Acta interna119 '||g,'Team synthetic record','reunion','QA119 fixture','QA119 fixture',
      '{"cliente":"","flujo":"feedback","responsables":["QA119 fixture"]}',
      '2026-09-01T12:00:00.123456Z' FROM generate_series(1,13) g RETURNING id`);
  const trash = await f.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback,eliminado_at,updated_at)
    SELECT 'QA119 trash '||g,'Trashed synthetic record','general','QA119 fixture','QA119 fixture',
      jsonb_build_object('cliente',CASE WHEN g<=9 THEN 'Zafiro119' ELSE '' END,'flujo','feedback'),
      '2026-10-02T12:00:00Z','2026-10-01T12:00:00.123456Z'
    FROM generate_series(1,17) g RETURNING id,titulo`);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const rows = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      rows[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return rows;
  };
  const keys = (row, expected) => assert.deepEqual(Object.keys(row).sort(), [...expected].sort());
  const assertNote = note => {
    keys(note, ['id', 'titulo', 'contenido', 'categoria', 'feedback', 'creado_por', 'modificado_por',
      'eliminado_at', 'created_at', 'updated_at', 'resolved_client', 'section']);
    assert.ok(Number.isSafeInteger(note.id) && note.id > 0);
    assert.ok(['clients', 'team'].includes(note.section)); assert.equal(typeof note.resolved_client, 'string');
    for (const field of ['created_at', 'updated_at']) assert.match(note[field], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    const allowed = new Set(['cliente', 'responsable', 'responsables', 'referencia', 'estado', 'vigencia', 'flujo',
      'origen', 'confirmado_por', 'confirmado_at', 'confirmado_por_id', 'provenance_version']);
    for (const field of Object.keys(note.feedback)) assert.ok(allowed.has(field), `Unexpected feedback field: ${field}`);
    assert.equal(JSON.stringify(note).includes(marker), false); assert.equal(JSON.stringify(note).includes('817293.46'), false);
    return note;
  };
  const assertPage = body => {
    keys(body, ['version', 'limit', 'offset', 'total', 'has_more', 'snapshot', 'context', 'items']);
    assert.equal(body.version, 1); assert.match(body.snapshot, /^[a-f0-9]{64}$/);
    keys(body.context, ['section', 'papelera', 'categoria', 'q']);
    assert.ok(Number.isSafeInteger(body.total) && body.total >= 0); assert.ok(Array.isArray(body.items));
    body.items.forEach(assertNote);
    assert.equal(body.has_more, body.offset + body.items.length < body.total);
    assert.equal(JSON.stringify(body).includes(marker), false); assert.equal(JSON.stringify(body).includes('817293.46'), false);
    return body;
  };
  const page = async (params = {}, token = admin) => assertPage(ok(await api(`/notas/pagina?${new URLSearchParams({
    section: 'clients', limit: '50', offset: '0', ...params,
  })}`, token)));
  const legacyRead = async (token, search = '') => {
    const response = await fetch(new URL(`/api/notas${search}`, f.base), {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const items = await response.json(); assert.ok(Array.isArray(items)); items.forEach(assertNote);
    assert.equal(JSON.stringify(items).includes(marker), false);
    assert.equal(JSON.stringify(items).includes('817293.46'), false);
    return { items, total: response.headers.get('x-total-count'), truncated: response.headers.get('x-feedback-truncated') };
  };

  await t.test('all 620 client notes traverse beyond 500 in exact microsecond/ID order with no duplicates or GET mutations', async () => {
    const before = await snapshot(), first = await page();
    assert.equal(first.total, 620); assert.equal(first.offset, 0); assert.equal(first.limit, 50);
    const seen = [...first.items.map(row => row.id)];
    for (let offset = 50; offset < 620; offset += 50) {
      const next = await page({ offset: String(offset), expected_snapshot: first.snapshot });
      assert.equal(next.total, 620); assert.equal(next.snapshot, first.snapshot); seen.push(...next.items.map(row => row.id));
    }
    assert.deepEqual(seen, ordered.map(row => row.id)); assert.equal(new Set(seen).size, 620);
    const end = await page({ offset: '1000', expected_snapshot: first.snapshot });
    assert.equal(end.total, 620); assert.deepEqual(end.items, []); assert.equal(end.has_more, false);
    for (const token of [admin, staff, custom]) {
      const legacy = await legacyRead(token);
      assert.equal(legacy.items.length, 500); assert.equal(legacy.total, '633'); assert.equal(legacy.truncated, 'true');
      assert.deepEqual(legacy.items.map(row => row.id), ordered.slice(0, 500).map(row => row.id));
      const filtered = await legacyRead(token, '?q=needle119');
      assert.deepEqual(filtered.items.map(row => row.id), [deep.id]);
      assert.equal(filtered.total, '1'); assert.equal(filtered.truncated, 'false');
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('global query/category/section/trash filters find old matches before pagination, including shared custom access', async () => {
    const before = await snapshot();
    for (const token of [admin, staff, custom]) {
      const found = await page({ q: 'needle119' }, token);
      assert.equal(found.total, 1); assert.deepEqual(found.items.map(row => row.id), [deep.id]);
      assert.equal(found.items[0].section, 'clients');
      const internal = await page({ section: 'team' }, token);
      assert.equal(internal.total, 13); assert.deepEqual(internal.items.map(row => row.id), team.map(row => row.id).sort((a, b) => b - a));
      const deleted = await page({ papelera: 'true' }, token);
      assert.equal(deleted.total, 9);
      assert.deepEqual(deleted.items.map(row => row.id), trash.filter(row => Number(row.titulo.split(' ').at(-1)) <= 9).map(row => row.id).sort((a, b) => b - a));
      const category = await page({ categoria: 'diseno' }, token);
      assert.equal(category.total, bulk.filter(row => row.categoria === 'diseno').length);
      assert.deepEqual(category.items.map(row => row.id), ordered.filter(row => row.categoria === 'diseno').slice(0, 50).map(row => row.id));
      const intersection = await page({ categoria: 'diseno', q: 'needle119' }, token);
      assert.equal(intersection.total, 0); assert.deepEqual(intersection.items, []);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('deep link outside the legacy window is independently readable; trash state must match explicitly', async () => {
    const before = await snapshot();
    for (const token of [admin, staff, custom]) {
      const body = ok(await api(`/notas/${deep.id}/detalle?papelera=false`, token));
      keys(body, ['version', 'item']); assert.equal(body.version, 1); assert.equal(body.item.id, deep.id);
      assertNote(body.item);
      assert.equal(body.item.contenido, 'needle119 beyond the old 500'); assert.equal(body.item.section, 'clients');
      assert.equal(body.item.resolved_client, 'Zafiro119');
      assert.equal(body.item.feedback.referencia, 'https://example.invalid/qa119/reference');
      assert.equal(body.item.feedback.origen, 'mia_whatsapp');
      assert.equal(body.item.feedback.confirmado_por, 'QA119 historical fixture');
      assert.equal(body.item.feedback.confirmado_por_id, 91001); assert.equal(body.item.feedback.provenance_version, 1);
      assert.equal(body.item.feedback.confirmado_at, '2026-10-01T12:00:00.123456Z');
      assert.equal(JSON.stringify(body).includes(marker), false);
      ok(await api(`/notas/${deep.id}/detalle?papelera=true`, token), 404);
      const deleted = ok(await api(`/notas/${trash[0].id}/detalle?papelera=true`, token));
      assert.equal(deleted.item.id, trash[0].id);
      ok(await api(`/notas/${trash[0].id}/detalle?papelera=false`, token), 404);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('snapshot binds exact actor and filters, and offset pages require the observed token', async () => {
    const first = await page(), before = await snapshot();
    ok(await api('/notas/pagina?section=clients&offset=50&limit=50', admin), 428);
    for (const [token, suffix] of [[staff, 'section=clients'], [custom, 'section=clients'],
      [admin, 'section=team'], [admin, 'section=clients&q=QA119'], [admin, 'section=clients&categoria=diseno'],
      [admin, 'section=clients&papelera=true']]) {
      const denied = ok(await api(`/notas/pagina?${suffix}&offset=50&limit=50&expected_snapshot=${first.snapshot}`, token), 409);
      assert.equal(Object.hasOwn(denied, 'items'), false);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('legacy title classification matches the shared catalog, including historical names without a current client row', async () => {
    const inserted = await f.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback)
      VALUES('Legacy119 Zafiro119 correction','Legacy title only','general','QA119','QA119','{}'),
        ('Legacy119 Obsidiana119 Zafiro119 mixed','Ambiguous title','general','QA119','QA119','{}'),
        ('Historical name catalog seed','Persisted old account','general','QA119','QA119','{"cliente":"Retirado119"}'),
        ('Legacy119 Retirado119 correction','Old name inferred','general','QA119','QA119','{}') RETURNING id,titulo`);
    try {
      const before = await snapshot();
      const selected = await page({ section: 'all', q: 'Legacy119' });
      assert.equal(selected.total, 3);
      const byId = new Map(selected.items.map(row => [row.id, row]));
      assert.equal(byId.get(inserted[0].id).resolved_client, 'Zafiro119');
      assert.equal(byId.get(inserted[0].id).section, 'clients');
      assert.equal(byId.get(inserted[1].id).resolved_client, ''); assert.equal(byId.get(inserted[1].id).section, 'team');
      assert.equal(byId.get(inserted[3].id).resolved_client, 'Retirado119');
      assert.equal(byId.get(inserted[3].id).section, 'clients');
      assert.deepEqual(await snapshot(), before);
    } finally { await f.query('DELETE FROM notas_compartidas WHERE id=ANY($1::int[])', [inserted.map(row => row.id)]); }
  });

  await t.test('malformed pagination/filter/token/deep selectors and anonymous reads reject with no DML', async () => {
    const before = await snapshot();
    for (const search of ['limit=0', 'limit=101', 'limit=-1', 'limit=01', 'limit=1.5', 'limit=1e2',
      'limit=50&limit=50', 'limit[]=50', 'offset=-1', 'offset=01', 'offset=1000001', 'offset=9007199254740992',
      'offset=0&offset=0', 'section=other', 'section=team&section=clients', 'papelera=1', 'papelera=false&papelera=true',
      'categoria=other', 'categoria=general&categoria=diseno', 'q[x]=secret', 'q=one&q=two', 'q=%0A',
      `q=${'a'.repeat(201)}`, 'expected_snapshot=abc', `expected_snapshot=${'A'.repeat(64)}`,
      `expected_snapshot=${'a'.repeat(64)}&expected_snapshot=${'a'.repeat(64)}`, 'unknown=1'])
      ok(await api(`/notas/pagina?${search}`, admin), 400);
    for (const id of ['0', '-1', '01', '1.5', 'abc', '9007199254740992'])
      ok(await api(`/notas/${id}/detalle?papelera=false`, admin), 400);
    for (const suffix of ['papelera=1', 'papelera=true&papelera=false', 'papelera[]=false', 'limit=50'])
      ok(await api(`/notas/${deep.id}/detalle?${suffix}`, admin), 400);
    ok(await api('/notas/2147483647/detalle?papelera=false', admin), 404);
    for (const path of ['/notas/pagina', `/notas/${deep.id}/detalle?papelera=false`, '/notas']) {
      const body = ok(await api(path, null), 401);
      assert.equal(Object.hasOwn(body, 'items'), false); assert.equal(Object.hasOwn(body, 'item'), false);
      assert.equal(JSON.stringify(body).includes(marker), false);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('real RR source held between 500-row batches returns old-consistent counts/token/items despite an external commit', async () => {
    const first = await page();
    const target = bulk.find(row => row.titulo === 'QA119 client 10');
    const expected = await page({ offset: '600', expected_snapshot: first.snapshot });
    assert.ok(expected.items.some(row => row.id === target.id));
    let reached, resume, paused = false;
    const ready = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { resume = resolve; });
    const wrapper = { connect: async () => {
      const db = await pool.connect();
      return { release: error => db.release(error), query: async (...args) => {
        const result = await db.query(...args), sql = typeof args[0] === 'string' ? args[0] : args[0].text;
        if (!paused && /FROM notas_compartidas WHERE/.test(sql) && /LIMIT 500/.test(sql)) {
          paused = true; assert.equal(result.rows.length, 500);
          const settings = (await db.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];
          assert.equal(settings.isolation, 'repeatable read'); assert.equal(settings.readonly, 'on');
          reached(); await gate;
        }
        return result;
      } };
    } };
    const pending = readFeedbackNotesPage(wrapper, { id: 91001, rol: 'admin', session_version: 1 }, {
      section: 'clients', limit: '50', offset: '600', expected_snapshot: first.snapshot,
    });
    try {
      await Promise.race([ready, pending.then(() => { throw Error('The real 500-row query barrier was not reached'); })]);
      const external = await pool.connect();
      try {
        await external.query('BEGIN');
        await external.query("UPDATE notas_compartidas SET contenido='QA119 independently committed edit',updated_at=now() WHERE id=$1", [target.id]);
        await external.query('COMMIT');
      } catch (error) { await external.query('ROLLBACK'); throw error; }
      finally { external.release(); }
    } finally { resume(); }
    const held = assertPage(await pending);
    assert.deepEqual(held, expected);
    const stale = ok(await api(`/notas/pagina?section=clients&offset=600&limit=50&expected_snapshot=${first.snapshot}`, admin), 409);
    assert.equal(Object.hasOwn(stale, 'items'), false);
    const fresh = await page(); assert.equal(fresh.total, 620); assert.notEqual(fresh.snapshot, first.snapshot);
    assert.equal(fresh.items[0].id, target.id); assert.equal(fresh.items[0].contenido, 'QA119 independently committed edit');
  });

  await t.test('actor observation is immutable before real lease; current epoch, role and active changes deny all read models', async () => {
    for (const kind of ['page', 'detail']) for (const change of ['epoch', 'role', 'inactive']) {
      await f.query("UPDATE usuarios SET activo=true,rol='qa_unknown',session_version=1 WHERE id=$1", [customId]);
      let reached, resume;
      const ready = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { resume = resolve; });
      const wrapper = { connect: async () => { reached(); await gate; return pool.connect(); } };
      const observed = { id: customId, rol: 'qa_unknown', session_version: 1 };
      const pending = kind === 'page' ? readFeedbackNotesPage(wrapper, observed, { section: 'clients' })
        : readFeedbackNoteDetail(wrapper, observed, String(deep.id), { papelera: 'false' });
      const rejected = assert.rejects(pending, error => error.status === 401);
      await ready;
      try {
        await f.query(`UPDATE usuarios SET ${change === 'epoch' ? 'session_version=2' : change === 'role' ? "rol='admin'" : 'activo=false'} WHERE id=$1`, [customId]);
        observed.id = 91001; observed.rol = 'admin'; observed.session_version = 2;
        const before = await snapshot(); resume(); await rejected; assert.deepEqual(await snapshot(), before);
        const response = await api(kind === 'page' ? '/notas/pagina' : `/notas/${deep.id}/detalle?papelera=false`, custom);
        if (change === 'role') {
          // The HTTP middleware observes the new role before this fresh call.
          // Shared reads remain permitted; only the old prelease observation
          // above is obsolete. JWTs intentionally contain no cached role.
          const fresh = ok(response);
          if (kind === 'page') assertPage(fresh); else assertNote(fresh.item);
        } else {
          const denied = ok(response, 401);
          assert.equal(Object.hasOwn(denied, 'items'), false); assert.equal(Object.hasOwn(denied, 'item'), false);
        }
      } finally {
        resume(); await rejected;
        await f.query("UPDATE usuarios SET activo=true,rol='qa_unknown',session_version=1 WHERE id=$1", [customId]);
      }
    }
  });

  await t.test('real edit, trash and restoration each invalidate a later page; explicit new first page recovers', async () => {
    let observed = await page();
    ok(await api(`/notas/${deep.id}`, admin, 'PATCH', { contenido: 'QA119 genuine HTTP edit' }));
    const stale = async token => {
      const denied = ok(await api(`/notas/pagina?section=clients&offset=50&limit=50&expected_snapshot=${token}`, admin), 409);
      assert.equal(Object.hasOwn(denied, 'items'), false);
    };
    await stale(observed.snapshot); observed = await page(); assert.equal(observed.total, 620);
    ok(await api(`/notas/${deep.id}`, admin, 'DELETE')); await stale(observed.snapshot);
    observed = await page(); assert.equal(observed.total, 619);
    ok(await api(`/notas/${deep.id}/restaurar`, admin, 'POST', {})); await stale(observed.snapshot);
    observed = await page(); assert.equal(observed.total, 620); assert.equal(observed.items[0].id, deep.id);
  });

  await t.test('PATCH ACK closes historical metadata without erasing stored private/unknown fields or provenance', async () => {
    // Keep this write-only regression last: prior read-only baselines remain
    // unchanged. SQL injects historical bags solely inside this fresh fixture.
    await f.query(`UPDATE notas_compartidas SET feedback=feedback||$2::jsonb WHERE id=$1`, [deep.id,
      JSON.stringify({ private_finance: { marker, importe: 817293.46 }, unknown_private_field: marker })]);
    for (const [index, token] of [admin, staff, custom].entries()) {
      const observed = ok(await api(`/notas/${deep.id}/detalle?papelera=false`, token)).item;
      assertNote(observed);
      const before = await snapshot();
      const stored = before.notas_compartidas.find(row => row.id === deep.id);
      assert.equal(stored.feedback.private_finance.marker, marker);
      assert.equal(stored.feedback.unknown_private_field, marker);
      assert.equal(stored.feedback.unknown_bag.marker, marker);
      const contenido = `QA119 verified ACK metadata closure ${index}`;
      const saved = ok(await api(`/notas/${deep.id}`, token, 'PATCH', {
        expected_updated_at: observed.updated_at, contenido,
      }));
      keys(saved, ['id', 'titulo', 'contenido', 'categoria', 'feedback', 'creado_por', 'modificado_por',
        'eliminado_at', 'created_at', 'updated_at']);
      assert.equal(saved.id, deep.id); assert.equal(saved.contenido, contenido);
      assert.deepEqual(saved.feedback, observed.feedback);
      assert.equal(JSON.stringify(saved).includes(marker), false);
      assert.equal(JSON.stringify(saved).includes('817293.46'), false);
      for (const field of ['private_finance', 'unknown_private_field', 'unknown_bag', 'finance', 'wilson_idempotency_key'])
        assert.equal(Object.hasOwn(saved.feedback, field), false);
      const after = await snapshot(), updated = after.notas_compartidas.find(row => row.id === deep.id);
      assert.equal(updated.contenido, contenido);
      assert.deepEqual(updated.feedback, stored.feedback, 'ACK projection must not rewrite historical stored JSON');
      assert.deepEqual(after.notas_compartidas.filter(row => row.id !== deep.id), before.notas_compartidas.filter(row => row.id !== deep.id));
      for (const table of tables.filter(name => name !== 'notas_compartidas')) assert.deepEqual(after[table], before[table], table);
      const reloaded = ok(await api(`/notas/${deep.id}/detalle?papelera=false`, token)).item;
      assertNote(reloaded); assert.equal(reloaded.contenido, contenido); assert.deepEqual(reloaded.feedback, observed.feedback);
      const search = new URLSearchParams({ cliente: 'Zafiro119', titulo: reloaded.titulo, contenido });
      const response = await fetch(new URL(`/api/notas/similares?${search}`, f.base), {
        headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
      });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      const candidates = await response.json(); keys(candidates, ['similares']);
      assert.ok(Array.isArray(candidates.similares));
      const match = candidates.similares.find(row => row.id === deep.id);
      assert.ok(match, 'The actual persisted canary note must participate in similarity results');
      for (const row of candidates.similares) keys(row, ['id', 'titulo', 'cliente', 'estado', 'similitud', 'updated_at']);
      assert.equal(match.cliente, 'Zafiro119'); assert.equal(match.estado, 'pendiente'); assert.equal(match.similitud, 1);
      for (const secret of [marker, '817293.46', 'private_finance', 'unknown_private_field', 'unknown_bag', 'wilson_idempotency_key'])
        assert.equal(JSON.stringify(candidates).includes(secret), false);
      assert.deepEqual(await snapshot(), after, 'Similarity GET and detail reload must remain read-only');
    }
  });
});
