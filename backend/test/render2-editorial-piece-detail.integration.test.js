import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Explicit opt-in only. Never import db/server or read a configured DB URL here.
test('editorial piece detail HTTP: closed identity/content, byte limit, visibility and current session', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55654, clusterOnly: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own editorial-detail fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55654,
    url: 'postgresql://render2_fixture@127.0.0.1:55654/render2_local_test', identity });
  const [clock] = await fixture.query(`SELECT to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today`);
  await fixture.query("ALTER ROLE render2_fixture SET log_statement='all'");
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Detail active',true) RETURNING id,nombre");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Detail inactive',false) RETURNING id,nombre");
  const secret = 'QA_EDITORIAL_DETAIL_FINANCE_55654';
  await fixture.query(`INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por)
    VALUES ($1,'2026-01-01',893217.43,'QA fixture')`, [client.id]);
  const accounts = [['qa_franco', 91001], ['qa_luciano', 91003], ['qa_designer', 91004]];
  for (const [n, role] of ['produccion', 'community', 'programacion', 'edicion'].entries()) {
    const id = 990101 + n, usuario = `qa_piece_detail_${n}`;
    const inserted = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA detail actor',$3,password_hash,true,1 FROM usuarios WHERE id=91004 RETURNING id`, [id, usuario, role]);
    assert.deepEqual(inserted, [{ id }]); accounts.push([usuario, id]);
  }
  const tables = { historia: 'historias', publicacion: 'publicaciones' };
  const contentKeys = ['idea', 'copy', 'material_referencia', 'aclaraciones'];
  const seed = async (domain, { id, clientId = client.id, state = 'lista', actual = null,
    metadata = {}, content = { idea: `  ${domain} root idea  `, copy: '  Root copy\n\tsecond line  ',
      material_referencia: '  https://example.invalid/root-material\nsecond-reference  ',
      aclaraciones: `  ${domain} original notes\n${'Línea auténtica 🙂\ttexto\n'.repeat(400)}  ` } } = {}) => {
    const [row] = await fixture.query(`INSERT INTO ${tables[domain]}
      (${id === undefined ? '' : 'id,'}cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,
       fecha_programada,"fecha_publicación_real",idea,copy,material_referencia,aclaraciones,metadata)
      VALUES (${id === undefined ? '' : `${id},`}$1,${domain === 'publicacion' ? "'video'," : ''}$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id`,
    [clientId, state, clock.today, actual, ...contentKeys.map(key => content[key]), JSON.stringify({
      idea: 'Metadata must not replace nonempty root idea', copy: `Metadata copy ${secret}`,
      material_referencia: secret, aclaraciones: secret, finance: { importe: 893217.43, secret }, unknown_bag: [secret],
      publication_classification: 'confirmada_manualmente',
      publicacion_evidencia: { classification: 'confirmada_manualmente', confirmation: { id: randomUUID(), actor_id: 91001 } },
      ...metadata,
    })]);
    return { domain, id: row.id, content, state, clientId,
      classification: state === 'publicada' || actual ? 'historica_sin_confirmacion' : 'no_publicada' };
  };
  const pieces = [], hidden = [], historical = [], proof = [], nullable = [], oversized = [];
  for (const domain of Object.keys(tables)) {
    pieces.push(await seed(domain, { id: 990001 }));
    historical.push(await seed(domain, { state: 'publicada', actual: `${clock.today}T12:00:00Z` }));
    historical.push(await seed(domain, { state: 'publicada' }));
    historical.push(await seed(domain, { state: 'lista', actual: `${clock.today}T13:00:00Z` }));
    proof.push(await seed(domain));
    nullable.push(await seed(domain, { content: { idea: null, copy: '', material_referencia: null, aclaraciones: '' },
      metadata: { idea: 'Allowed list-title fallback, not detail content', copy: secret } }));
    for (const value of [true, 'true']) hidden.push(await seed(domain, { metadata: { archivado_tablero: value } }));
    hidden.push(await seed(domain, { clientId: inactive.id }));
    const huge = '🙂'.repeat(270000);
    assert.ok(huge.length < 1048576 && Buffer.byteLength(huge, 'utf8') > 1048576, 'UTF-8 test differs from JS length');
    oversized.push(await seed(domain, { content: { idea: '', copy: huge, material_referencia: null, aclaraciones: '' } }));
    const field = 'é'.repeat(180000);
    assert.ok(Buffer.byteLength(field, 'utf8') < 1048576);
    oversized.push(await seed(domain, { content: { idea: field, copy: field, material_referencia: null, aclaraciones: field } }));
  }
  const actual = await fixture.launchActual({ entry: 'server' });
  const { base } = await actual.ready;
  const api = (route, options) => request(base, `/api${route}`, options);
  const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => {
    const body = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.ok(body.token); return body.token;
  };
  const tokens = new Map(); for (const [usuario, id] of accounts) tokens.set(id, await login(usuario));
  const admin = tokens.get(91001), employee = tokens.get(91003);
  // Only the existing verified HTTP confirmation route creates proof. Forged
  // metadata above intentionally remains present and is never evidence.
  for (const piece of proof) {
    const path = `/editorial-publicacion/${piece.domain}/${piece.id}`;
    const current = expect(await api(path, { token: admin }));
    const confirmed = expect(await api(`${path}/confirmar`, { token: admin, method: 'POST', body: {
      request_id: randomUUID(), expected_revision: current.piece.revision, occurred_at: `${clock.today}T12:00:00Z`,
    } }), 201);
    assert.equal(confirmed.classification, 'confirmada_manualmente');
    piece.state = 'publicada'; piece.classification = 'confirmada_manualmente';
  }
  const path = piece => `/editorial-control/${piece.domain}/${piece.id}`;
  const detail = (piece, token = admin) => api(path(piece), { token });
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const check = (dto, piece) => {
    keys(dto, ['version', 'piece', 'content']); assert.equal(dto.version, 1);
    keys(dto.piece, ['domain', 'id', 'titulo', 'estado', 'tipo', 'cliente', 'fecha_programada', 'publication_classification']);
    keys(dto.piece.cliente, ['id', 'nombre']);
    assert.equal(dto.piece.domain, piece.domain); assert.equal(dto.piece.id, piece.id);
    assert.equal(dto.piece.estado, piece.state); assert.equal(dto.piece.tipo, piece.domain === 'historia' ? 'historia' : 'video');
    assert.deepEqual(dto.piece.cliente, { id: client.id, nombre: client.nombre });
    assert.equal(dto.piece.fecha_programada, clock.today);
    assert.equal(dto.piece.publication_classification, piece.classification);
    assert.ok(typeof dto.piece.titulo === 'string' && dto.piece.titulo.length <= 160);
    keys(dto.content, contentKeys); assert.deepEqual(dto.content, piece.content, 'Root strings/null preserved byte-for-byte, not metadata or truncated text');
    for (const value of Object.values(dto.content)) assert.ok(value === null || typeof value === 'string');
    const encoded = JSON.stringify(dto);
    assert.ok(!encoded.includes(secret) && !encoded.includes('893217.43'));
    for (const forbidden of ['metadata', 'finance', 'unknown_bag', 'publicacion_evidencia', 'current_confirmation',
      'fecha_publicacion_real', 'fecha_publicación_real', 'actor_id', 'session_version', 'href']) assert.ok(!encoded.includes(`"${forbidden}"`));
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ['usuarios', 'clientes', 'cliente_abonos', 'historias', 'publicaciones', 'tareas',
      'tarea_asignaciones', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  await t.test('domain+ID detail preserves >5k multiline root content and closed list projection under RR read only', async () => {
    const before = await snapshot();
    const logOffset = (await readFile(`${fixture.root}/postgres.log`, 'utf8')).length;
    for (const piece of [...pieces, ...nullable]) for (const token of [admin, employee]) check(expect(await detail(piece, token)), piece);
    assert.equal(pieces[0].id, pieces[1].id); assert.notEqual(pieces[0].content.aclaraciones, pieces[1].content.aclaraciones);
    for (const piece of pieces) {
      assert.ok(piece.content.aclaraciones.length > 5000);
      assert.equal(expect(await detail(piece)).piece.titulo, piece.content.idea.trim());
    }
    const list = expect(await api('/editorial-control?bucket=today&limit=50', { token: employee }));
    for (const piece of [...pieces, ...nullable]) {
      const listed = list.items.find(item => item.domain === piece.domain && item.id === piece.id);
      assert.ok(listed); assert.deepEqual(expect(await detail(piece)).piece, listed, 'Reuse existing closed list projection');
    }
    assert.deepEqual(await snapshot(), before);
    const statements = (await readFile(`${fixture.root}/postgres.log`, 'utf8')).slice(logOffset);
    assert.match(statements, /BEGIN(?: TRANSACTION)? ISOLATION LEVEL REPEATABLE READ READ ONLY/i);
    assert.ok(!/(?:statement:|execute [^:]*:)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(statements));
    // This confirms observed transaction mode and closed responses, not a
    // concurrent evidence barrier or every internal SQL projection/plan.
  });
  await t.test('proof comes from verified confirmation, not metadata or historical state/actual date', async () => {
    const before = await snapshot();
    for (const piece of [...pieces, ...historical, ...proof]) check(expect(await detail(piece, employee)), piece);
    for (const piece of proof) assert.equal(expect(await detail(piece)).piece.publication_classification, 'confirmada_manualmente');
    for (const piece of historical) assert.equal(expect(await detail(piece)).piece.publication_classification, 'historica_sin_confirmacion');
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('combined UTF-8 content over one MiB returns explicit 413, never partial/truncated content', async () => {
    const before = await snapshot();
    for (const piece of oversized) for (const token of [admin, employee]) {
      const result = await detail(piece, token); expect(result, 413);
      assert.ok(typeof result.body.error === 'string');
      assert.ok(!Object.hasOwn(result.body, 'content') && !Object.hasOwn(result.body, 'piece'));
      assert.ok(!JSON.stringify(result.body).includes(secret));
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('missing/hidden rows are 404; domain, canonical PostgreSQL IDs and any query are strict', async () => {
    const before = await snapshot();
    for (const piece of hidden) for (const token of [admin, employee]) expect(await detail(piece, token), 404);
    for (const domain of ['historia', 'publicacion']) expect(await detail({ domain, id: 2147483647 }), 404);
    for (const domain of ['tarea', 'historias', 'publicaciones', 'Historia', 'unknown'])
      expect(await api(`/editorial-control/${domain}/1`, { token: admin }), 400);
    for (const id of ['0', '-1', '01', '1.0', '1e2', '%2B1', '2147483648', '9007199254740992', 'NaN', 'null', '%201'])
      expect(await api(`/editorial-control/historia/${id}`, { token: admin }), 400);
    for (const query of ['bucket=today', 'offset=0', 'limit=20', 'usuario_id=91001', 'cliente_id=1',
      'id=1&id=2', 'unknown=1&unknown=1', 'unknown[]=1', 'domain=publicacion', 'metadata[x]=1'])
      expect(await api(`${path(pieces[0])}?${query}`, { token: employee }), 400);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('all system roles can read; anonymous, current unknown role, revoked and inactive identities fail closed', async () => {
    let before = await snapshot();
    expect(await api(path(pieces[0])), 401);
    for (const [, id] of accounts) check(expect(await detail(pieces[0], tokens.get(id))), pieces[0]);
    assert.deepEqual(await snapshot(), before);
    const id = 990104, token = tokens.get(id);
    await fixture.query("UPDATE usuarios SET rol='qa_unknown' WHERE id=$1", [id]);
    try { before = await snapshot(); expect(await detail(pieces[0], token), 403); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=$1", [id]); }
    const revoked = await login('qa_piece_detail_3');
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [id]);
    before = await snapshot(); expect(await detail(pieces[0], revoked), 401); assert.deepEqual(await snapshot(), before);
    const inactiveToken = await login('qa_piece_detail_3');
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=$1', [id]);
    try { before = await snapshot(); expect(await detail(pieces[0], inactiveToken), 401); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=$1', [id]); }
    check(expect(await detail(pieces[0], await login('qa_piece_detail_3'))), pieces[0]);
  });
});
