import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Actual HTTP/physical PostgreSQL only after opt-in; never a configured DB.
test('editorial control HTTP: closed team buckets, stable union paging and verified evidence', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55650, clusterOnly: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own editorial-control fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55650,
    url: 'postgresql://render2_fixture@127.0.0.1:55650/render2_local_test', identity });
  const [dates] = await fixture.query(`SELECT
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today,
    to_char((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date-1,'YYYY-MM-DD') AS yesterday,
    to_char((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date+1,'YYYY-MM-DD') AS tomorrow,
    to_char((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date+730,'YYYY-MM-DD') AS distant`);
  await fixture.query("ALTER ROLE render2_fixture SET timezone='Pacific/Kiritimati'");
  await fixture.query("ALTER ROLE render2_fixture SET log_statement='all'");
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Editorial Control active',true) RETURNING id,nombre");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Editorial Control inactive',false) RETURNING id,nombre");
  const secret = 'QA_EDITORIAL_CONTROL_PRIVATE_55650';
  await fixture.query(`INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por)
    VALUES ($1,'2026-01-01',689123.57,'QA fixture only')`, [client.id]);
  const accounts = [
    ['qa_franco', 91001], ['qa_designer', 91004], ['qa_luciano', 91003],
  ];
  for (const [n, role] of ['produccion', 'community', 'programacion', 'edicion'].entries()) {
    const id = 989101 + n, usuario = `qa_editorial_control_${n}`;
    const inserted = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA editorial control actor',$3,password_hash,true,1 FROM usuarios WHERE id=91004 RETURNING id`, [id, usuario, role]);
    assert.deepEqual(inserted, [{ id }]); accounts.push([usuario, id]);
  }
  const tables = { historia: 'historias', publicacion: 'publicaciones' };
  const pieces = [];
  let sequence = 0;
  const seed = async (domain, { id, state = 'lista', date = dates.today, actual = null,
    clientId = client.id, metadata = {}, idea = 'QA approved title', copy = 'QA fallback copy',
    title = idea, visible = true } = {}) => {
    const table = tables[domain];
    const bag = { private_finance: { importe: 689123.57, marker: secret }, unknown_bag: { secret }, ...metadata };
    const [row] = await fixture.query(`INSERT INTO ${table}
      (${id === undefined ? '' : 'id,'}cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,
       fecha_programada,"fecha_publicación_real",idea,copy,metadata)
      VALUES (${id === undefined ? '' : `${id},`}$1,${domain === 'publicacion' ? "'video'," : ''}$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
    [clientId, state, date, actual, idea, copy, JSON.stringify(bag)]);
    const piece = { domain, id: row.id, titulo: (title ?? '').slice(0, 160), estado: state,
      tipo: domain === 'historia' ? 'historia' : 'video', cliente: { id: clientId, nombre: clientId === client.id ? client.nombre : inactive.nombre },
      fecha_programada: date, publication_classification: state === 'publicada' || actual ? 'historica_sin_confirmacion' : 'no_publicada', visible };
    pieces.push(piece); sequence++; return piece;
  };
  const confirmed = [], forged = [];
  for (const domain of Object.keys(tables)) {
    // Identical integer IDs in different domains must never collapse in UNION.
    await seed(domain, { id: 989001, title: `${domain} same ID`, idea: `${domain} same ID` });
    confirmed.push(await seed(domain));
    forged.push(await seed(domain, { metadata: { publication_classification: 'confirmada_manualmente',
      publicacion_evidencia: { classification: 'confirmada_manualmente', confirmation: { actor_id: 91001, id: randomUUID() } },
      current_confirmation: { id: randomUUID(), source: 'manual' } } }));
    await seed(domain, { state: 'publicada', actual: `${dates.today}T12:00:00Z` });
    await seed(domain, { state: 'publicada' });
    await seed(domain, { state: 'lista', actual: `${dates.today}T13:00:00Z` });
    for (let n = 0; n < 24; n++) {
      await seed(domain, { state: n % 3 === 0 ? 'bloqueada' : n % 3 === 1 ? 'pendiente' : 'lista',
        idea: `QA today ${domain} ${n}`, title: `QA today ${domain} ${n}` });
      await seed(domain, { date: dates.yesterday, state: n % 2 ? 'lista' : 'bloqueada' });
      await seed(domain, { date: n % 2 ? dates.tomorrow : dates.distant, state: 'lista' });
    }
    await seed(domain, { date: dates.yesterday, state: 'publicada' });
    await seed(domain, { date: dates.tomorrow, state: 'bloqueada' });
    await seed(domain, { date: dates.today, state: 'bloqueada', clientId: inactive.id, visible: false });
    for (const value of [true, 'true']) await seed(domain, { metadata: { archivado_tablero: value }, visible: false });
    await seed(domain, { idea: '  ', metadata: { idea: '  Lowercase metadata title  ' }, title: 'Lowercase metadata title' });
    await seed(domain, { idea: '', metadata: { idea: { marker: secret }, Idea: 'Uppercase metadata title' }, title: 'Uppercase metadata title' });
    await seed(domain, { idea: '', metadata: { idea: { marker: secret }, Idea: [secret] },
      copy: 'C'.repeat(190), title: 'C'.repeat(160) });
    await seed(domain, { idea: 'T'.repeat(190), copy: secret, title: 'T'.repeat(160) });
  }
  // Completed tasks are not evidence that an editorial piece was published.
  await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra,publicacion_id,cliente_id)
    VALUES ('QA editorial unrelated completed task','Luciano QA','finalizada','edicion',
      '{"workspace":"render_os"}',$1,$2)`, [forged.find(p => p.domain === 'publicacion').id, client.id]);
  const server = await fixture.launchActual({ entry: 'server' });
  const { base } = await server.ready;
  const api = (route, options) => request(base, `/api${route}`, options);
  const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const tokens = new Map();
  for (const [usuario, id] of accounts) tokens.set(id, await login(usuario));
  const admin = tokens.get(91001);
  for (const piece of confirmed) {
    const path = `/editorial-publicacion/${piece.domain}/${piece.id}`;
    const current = expect(await api(path, { token: admin }));
    const response = expect(await api(`${path}/confirmar`, { token: admin, method: 'POST', body: {
      request_id: randomUUID(), expected_revision: current.piece.revision, occurred_at: `${dates.today}T12:00:00Z`,
    } }), 201);
    assert.equal(response.classification, 'confirmada_manualmente');
    piece.estado = 'publicada'; piece.publication_classification = 'confirmada_manualmente';
  }
  const inBucket = (piece, bucket) => piece.visible && (bucket === 'today' ? piece.fecha_programada === dates.today
    : bucket === 'overdue' ? piece.fecha_programada !== null && piece.fecha_programada < dates.today && !['publicada', 'rechazada'].includes(piece.estado)
      : bucket === 'blocked' ? piece.estado === 'bloqueada'
        : piece.estado === 'lista' && piece.fecha_programada !== null && piece.fecha_programada > dates.today);
  const buckets = ['today', 'overdue', 'blocked', 'upcoming_ready'];
  const summary = Object.fromEntries(buckets.map(bucket => [bucket, pieces.filter(p => inBucket(p, bucket)).length]));
  const selected = bucket => pieces.filter(p => inBucket(p, bucket)).sort((a, b) =>
    Number(a.fecha_programada === null) - Number(b.fecha_programada === null)
    || (a.fecha_programada || '').localeCompare(b.fecha_programada || '') || a.domain.localeCompare(b.domain) || a.id - b.id);
  const dto = ({ visible, ...piece }) => piece;
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const control = (query = '', token = admin) => api(`/editorial-control${query}`, { token });
  const check = (body, bucket = 'today', offset = 0, limit = 20) => {
    keys(body, ['version', 'today', 'bucket', 'offset', 'limit', 'total', 'has_more', 'summary', 'items']);
    assert.equal(body.version, 1); assert.equal(body.today, dates.today); assert.equal(body.bucket, bucket);
    assert.equal(body.offset, offset); assert.equal(body.limit, limit);
    assert.equal(body.total, selected(bucket).length); assert.equal(body.has_more, offset + limit < body.total);
    keys(body.summary, buckets); assert.deepEqual(body.summary, summary);
    assert.deepEqual(body.items, selected(bucket).slice(offset, offset + limit).map(dto));
    for (const item of body.items) {
      keys(item, ['domain', 'id', 'titulo', 'estado', 'tipo', 'cliente', 'fecha_programada', 'publication_classification']);
      keys(item.cliente, ['id', 'nombre']);
      assert.ok(item.titulo.length <= 160);
      assert.ok(['no_publicada', 'historica_sin_confirmacion', 'confirmada_manualmente'].includes(item.publication_classification));
    }
    const encoded = JSON.stringify(body);
    assert.ok(!encoded.includes(secret) && !encoded.includes('689123.57'));
    for (const forbidden of ['href', 'metadata', 'publicacion_evidencia', 'current_confirmation', 'password_hash', 'sql'])
      assert.ok(!encoded.includes(`"${forbidden}"`));
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ['usuarios', 'clientes', 'cliente_abonos', 'historias', 'publicaciones', 'tareas',
      'tarea_asignaciones', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  await t.test('all buckets overlap correctly and paginate the exact domain/ID union with global summary beyond end', async () => {
    const before = await snapshot();
    const logOffset = (await readFile(`${fixture.root}/postgres.log`, 'utf8')).length;
    const transport = await fetch(`${base}/api/editorial-control`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(transport.status, 200);
    assert.equal(transport.headers.get('cache-control'), 'no-store');
    check(await transport.json());
    check(expect(await control()));
    for (const bucket of buckets) {
      assert.ok(selected(bucket).length > 20);
      const all = [];
      for (let offset = 0; offset < selected(bucket).length; offset += 20) {
        const body = expect(await control(`?bucket=${bucket}&offset=${offset}`)); check(body, bucket, offset);
        all.push(...body.items);
      }
      assert.deepEqual(all, selected(bucket).map(dto));
      assert.equal(new Set(all.map(p => `${p.domain}:${p.id}`)).size, all.length);
      for (const [offset, limit] of [[0, 1], [1, 7], [0, 50], [1000000, 50]])
        check(expect(await control(`?bucket=${bucket}&offset=${offset}&limit=${limit}`)), bucket, offset, limit);
    }
    assert.equal(selected('today').filter(p => p.id === 989001).length, 2);
    assert.ok(pieces.some(p => inBucket(p, 'today') && inBucket(p, 'blocked')));
    assert.ok(selected('upcoming_ready').some(p => p.fecha_programada === dates.distant));
    assert.deepEqual(await snapshot(), before);
    const statements = (await readFile(`${fixture.root}/postgres.log`, 'utf8')).slice(logOffset);
    assert.match(statements, /BEGIN(?: TRANSACTION)? ISOLATION LEVEL REPEATABLE READ READ ONLY/i);
    assert.ok(!/(?:statement:|execute [^:]*:)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(statements));
    // HTTP proves bounded responses; no claim that source/plan review or a
    // same-snapshot evidence barrier test has been replaced by these assertions.
  });
  await t.test('real confirmation differs from history/forged metadata and task completion for each domain', async () => {
    const all = expect(await control('?limit=50')).items.concat(expect(await control('?limit=50&offset=50')).items);
    for (const piece of confirmed) assert.equal(all.find(p => p.domain === piece.domain && p.id === piece.id)?.publication_classification, 'confirmada_manualmente');
    for (const piece of forged) assert.equal(all.find(p => p.domain === piece.domain && p.id === piece.id)?.publication_classification, 'no_publicada');
    assert.ok(all.some(p => p.estado === 'publicada' && p.publication_classification === 'historica_sin_confirmacion'));
  });
  await t.test('current schema rejects undated pieces; pure NULL predicate is checked without claiming HTTP coverage', async () => {
    const before = await snapshot();
    for (const [domain, table] of Object.entries(tables)) {
      await fixture.query(`DO $qa$ DECLARE seen text; BEGIN
        BEGIN INSERT INTO ${table}(cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada)
          VALUES (${client.id},${domain === 'publicacion' ? "'video'," : ''}'bloqueada',NULL);
          RAISE EXCEPTION 'QA expected NOT NULL failure';
        EXCEPTION WHEN not_null_violation THEN
          GET STACKED DIAGNOSTICS seen=COLUMN_NAME;
          IF seen IS DISTINCT FROM 'fecha_programada' THEN RAISE EXCEPTION 'Wrong NOT NULL column: %',seen; END IF;
        END; END $qa$`);
    }
    const [predicate] = await fixture.query(`SELECT ('bloqueada'::text='bloqueada') AS blocked,
      (NULL::date=$1::date) IS TRUE AS today,
      (NULL::date<$1::date AND 'bloqueada' NOT IN ('publicada','rechazada')) IS TRUE AS overdue,
      ('bloqueada'='lista' AND NULL::date>$1::date) IS TRUE AS upcoming_ready`, [dates.today]);
    assert.deepEqual(predicate, { blocked: true, today: false, overdue: false, upcoming_ready: false });
    assert.deepEqual(await snapshot(), before);
    t.diagnostic('NULL scheduled dates are blocked by the current real schema. Predicate-only NULL check is not runtime undated coverage; schema transition remains future work. rechazada is also not seedable under current editorial state CHECKs.');
  });
  await t.test('closed query rejects malformed pagination, duplicate/unknown filters and bucket values without writes', async () => {
    const before = await snapshot();
    for (const query of ['bucket=', 'bucket=all', 'bucket=TODAY', 'bucket=today&bucket=today', 'bucket[]=today',
      'offset=-1', 'offset=1000001', 'offset=01', 'offset=1.0', 'offset=1e2', 'offset=', 'offset=%2B1',
      'offset=%201', 'offset=NaN', 'offset=9007199254740992', 'offset=0&offset=0', 'offset[]=1',
      'limit=0', 'limit=51', 'limit=01', 'limit=-1', 'limit=1.5', 'limit=1e1', 'limit=', 'limit=%2B1',
      'limit=2&limit=2', 'limit[x]=2', 'usuario_id=91001', 'rol=admin', 'cliente_id=1', 'scope=mine',
      'desde=2026-01-01', 'hasta=2026-02-01', 'unknown=1']) expect(await control(`?${query}`), 400);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('all system roles share team reads; unknown, revoked and inactive current identities fail closed', async () => {
    let before = await snapshot();
    expect(await api('/editorial-control'), 401);
    for (const [, id] of accounts) check(expect(await control('', tokens.get(id))));
    assert.deepEqual(await snapshot(), before);
    const unknownId = 989104, unknownToken = tokens.get(unknownId);
    await fixture.query("UPDATE usuarios SET rol='qa_unknown' WHERE id=$1", [unknownId]);
    try { before = await snapshot(); expect(await control('', unknownToken), 403); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=$1", [unknownId]); }
    const revoked = await login('qa_editorial_control_3');
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [unknownId]);
    before = await snapshot(); expect(await control('', revoked), 401); assert.deepEqual(await snapshot(), before);
    const inactiveToken = await login('qa_editorial_control_3');
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=$1', [unknownId]);
    try { before = await snapshot(); expect(await control('', inactiveToken), 401); assert.deepEqual(await snapshot(), before); }
    finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=$1', [unknownId]); }
    check(expect(await control('', await login('qa_editorial_control_3'))));
  });
});
