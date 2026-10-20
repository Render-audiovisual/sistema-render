import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Discovery does not import server/db or open any configured connection.
test('team home HTTP: distinct work, ID memberships, closed paging and current admin authority', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55646, clusterOnly: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own team-home fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55646,
    url: 'postgresql://render2_fixture@127.0.0.1:55646/render2_local_test', identity });
  const [dates] = await fixture.query(`SELECT
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today,
    to_char((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date-1,'YYYY-MM-DD') AS yesterday,
    to_char((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date+1,'YYYY-MM-DD') AS tomorrow`);
  await fixture.query("ALTER ROLE render2_fixture SET timezone='Pacific/Kiritimati'");
  await fixture.query("ALTER ROLE render2_fixture SET log_statement='all'");
  const people = [];
  for (let n = 0; n < 27; n++) {
    const person = { id: 98801 + n, nombre: n < 2 ? 'QA Team Homonym' : `QA Team ${n}`, activo: n !== 25 };
    const inserted = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,'edicion',password_hash,$4,1 FROM usuarios WHERE id=91004 RETURNING id`,
    [person.id, `qa_team_${n}`, person.nombre, person.activo]);
    assert.deepEqual(inserted, [{ id: person.id }]);
    people.push(person);
  }
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Team active',true) RETURNING id");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Team inactive',false) RETURNING id");
  const secret = 'QA_TEAM_PRIVATE_55646';
  await fixture.query(`INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por)
    VALUES ($1,'2026-01-01',845219.73,'QA fixture only')`, [client.id]);
  const tasks = [];
  let sequence = 0;
  const seed = async ({ owner = people[0].id, collaborators = [], due = dates.today, state = 'pendiente',
    clientId = client.id, props = {}, visible = true } = {}) => {
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,prioridad,
      cliente_id,fecha_vencimiento,aclaraciones,propiedades_extra)
      VALUES ($1,'QA Team Homonym',$2,'diseno','media',$3,$4,$5,$6::jsonb) RETURNING id`,
    [`QA Team task ${++sequence}`, state, clientId, due, secret,
      JSON.stringify({ workspace: 'render_os', motivo: secret, private_finance: { importe: 845219.73 },
        unknown_bag: { secret }, colaboradores: ['QA Team Homonym', 'QA Team Homonym'], ...props })]);
    if (owner !== null) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    for (const id of collaborators.filter(id => id !== owner)) await fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
      VALUES ($1,$2,'colaborador') ON CONFLICT(tarea_id,usuario_id) DO NOTHING`, [row.id, id]);
    const task = { id: row.id, visible, due,
      state: state === 'en_revision' && props.revision_aprobada === true ? 'aprobada' : state,
      members: new Set([owner, ...collaborators].filter(id => id !== null)) };
    tasks.push(task); return task;
  };
  for (let n = 0; n < 26; n++) await seed({ owner: people[n].id,
    due: n % 3 === 0 ? dates.yesterday : n % 3 === 1 ? dates.today : null });
  const shared = await seed({ owner: people[0].id,
    collaborators: [...people.slice(1, 26).map(p => p.id), people[1].id, people[1].id],
    due: dates.yesterday, state: 'en_revision' });
  const boolApproved = await seed({ state: 'en_revision', props: { revision_aprobada: true }, due: dates.yesterday });
  await seed({ state: 'en_revision', props: { revision_aprobada: 'true' }, due: dates.tomorrow });
  await seed({ state: 'aprobada', due: null });
  await seed({ state: 'programada', clientId: null }); // Valid historical 058 state, still open.
  await seed({ owner: null, due: dates.yesterday });
  await seed({ owner: null, due: dates.today, state: 'en_revision' });
  await seed({ owner: null, due: null, state: 'aprobada' });
  // A task with only collaborator bindings is assigned, not unassigned.
  await seed({ owner: null, collaborators: [people[2].id, people[2].id], due: dates.tomorrow });
  for (const props of [{ workspace: 'historical' }, { workspace: null },
    { archivada_render_os: true }, { archivada_render_os: 'true' },
    { papelera_render_os: true }, { papelera_render_os: 'true' }]) {
    await seed({ due: dates.yesterday, props, visible: false });
  }
  await seed({ clientId: inactive.id, due: dates.yesterday, visible: false });
  for (const state of ['finalizada', 'publicada']) {
    await seed({ state, due: dates.yesterday });
    await seed({ owner: null, state, due: dates.yesterday });
  }
  await seed({ owner: people[26].id, state: 'finalizada' }); // No open work: omit this person entirely.
  const actual = await fixture.launchActual({ entry: 'server' });
  const { base } = await actual.ready;
  const api = (route, options) => request(base, `/api${route}`, options);
  const expect = (result, status) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => {
    const body = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }), 200);
    assert.ok(body.token); return body.token;
  };
  const admin = await login('qa_franco');
  const employee = await login('qa_luciano');
  const team = (query = '', token = admin) => api(`/inicio/equipo${query}`, { token });
  const open = tasks.filter(task => task.visible && !['finalizada', 'publicada'].includes(task.state));
  const overdue = task => task.due !== null && task.due < dates.today;
  const groups = people.map(person => {
    const mine = open.filter(task => task.members.has(person.id));
    return { user: person, open: mine.length, overdue: mine.filter(overdue).length,
      review: mine.filter(task => task.state === 'en_revision').length,
      approved: mine.filter(task => task.state === 'aprobada').length };
  }).filter(group => group.open > 0).sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.user.id - b.user.id);
  const unassigned = open.filter(task => task.members.size === 0);
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const check = (body, offset = 0, limit = 20) => {
    keys(body, ['version', 'today', 'offset', 'limit', 'total_tasks', 'total_overdue', 'total_people', 'has_more', 'unassigned', 'items']);
    assert.equal(body.version, 1); assert.equal(body.today, dates.today);
    assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(body.offset, offset); assert.equal(body.limit, limit);
    assert.equal(body.total_tasks, open.length);
    assert.equal(body.total_overdue, open.filter(overdue).length);
    assert.equal(body.total_people, groups.length);
    assert.equal(body.has_more, offset + limit < groups.length);
    keys(body.unassigned, ['open', 'overdue']);
    assert.deepEqual(body.unassigned, { open: unassigned.length, overdue: unassigned.filter(overdue).length });
    assert.deepEqual(body.items, groups.slice(offset, offset + limit), 'Exact per-ID counts, names, inactive flags and ordering');
    for (const item of body.items) {
      keys(item, ['user', 'open', 'overdue', 'review', 'approved']);
      keys(item.user, ['id', 'nombre', 'activo']);
      assert.equal(typeof item.user.activo, 'boolean');
      for (const key of ['open', 'overdue', 'review', 'approved']) assert.ok(Number.isSafeInteger(item[key]) && item[key] >= 0);
    }
    const encoded = JSON.stringify(body);
    assert.ok(!encoded.includes(secret) && !encoded.includes('845219.73'));
    for (const key of ['propiedades_extra', 'password_hash', 'session_version', 'motivo', 'private_finance',
      'fecha_vencimiento', 'updated_at', 'created_at', 'sql']) assert.ok(!encoded.includes(`"${key}"`));
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ['usuarios', 'tareas', 'tarea_asignaciones', 'clientes', 'cliente_abonos', 'historias', 'publicaciones'])
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  await t.test('default and explicit pages preserve all distinct global totals, including beyond end', async () => {
    const before = await snapshot();
    const logOffset = (await readFile(`${fixture.root}/postgres.log`, 'utf8')).length;
    const first = expect(await team(), 200); check(first);
    const second = expect(await team('?offset=20'), 200); check(second, 20);
    assert.deepEqual([...first.items, ...second.items], groups);
    assert.ok(groups.length > 20);
    for (const [offset, limit] of [[0, 1], [1, 7], [8, 7], [0, 50], [26, 20], [1000000, 50]]) {
      check(expect(await team(`?offset=${offset}&limit=${limit}`), 200), offset, limit);
    }
    check(expect(await team('?limit=7'), 200), 0, 7);
    assert.deepEqual(await snapshot(), before);
    const statements = (await readFile(`${fixture.root}/postgres.log`, 'utf8')).slice(logOffset);
    assert.match(statements, /BEGIN(?: TRANSACTION)? ISOLATION LEVEL REPEATABLE READ READ ONLY/i);
    assert.ok(!/(?:statement:|execute [^:]*:)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(statements));
    // Closed DTO assertions above are behavioral evidence. They do not claim
    // runtime observation can prove every SQL projection avoids whole-row JSON.
  });
  await t.test('homonyms, collaborators, inactive users, unassigned labels and approval aliases stay distinct', async () => {
    const body = expect(await team('?limit=50'), 200); check(body, 0, 50);
    const a = body.items.find(item => item.user.id === people[0].id);
    const b = body.items.find(item => item.user.id === people[1].id);
    assert.equal(a.user.nombre, b.user.nombre); assert.notEqual(a.open, b.open);
    assert.ok(body.items.some(item => item.user.id === people[25].id && item.user.activo === false));
    assert.ok(!body.items.some(item => item.user.id === people[26].id));
    assert.ok(body.items.reduce((sum, item) => sum + item.open, 0) > body.total_tasks);
    assert.deepEqual(body.unassigned, { open: 3, overdue: 1 });
    const bindings = await fixture.query('SELECT usuario_id FROM tarea_asignaciones WHERE tarea_id=$1', [shared.id]);
    assert.equal(bindings.length, 26); assert.equal(new Set(bindings.map(row => row.usuario_id)).size, 26);
    const [stored] = await fixture.query('SELECT estado,propiedades_extra FROM tareas WHERE id=$1', [boolApproved.id]);
    assert.equal(stored.estado, 'en_revision'); assert.equal(stored.propiedades_extra.revision_aprobada, true);
  });
  await t.test('strict query scope rejects malformed and duplicate actual parameters without mutations', async () => {
    const before = await snapshot();
    for (const query of ['offset=-1', 'offset=1000001', 'offset=01', 'offset=1.0', 'offset=1e2', 'offset=%2B1',
      'offset=', 'offset=%201', 'offset=1%20', 'offset=NaN', 'offset=9007199254740992',
      'limit=0', 'limit=51', 'limit=01', 'limit=-1', 'limit=1.5', 'limit=1e1', 'limit=', 'limit=%2B1',
      'offset=0&offset=0', 'offset=0&offset=1', 'limit=2&limit=2', 'limit=2&limit=3', 'offset[]=1', 'limit[x]=2',
      'usuario_id=91001', 'user_id=91001', 'id=91001', 'usuario=Franco', 'rol=admin',
      'workspace=render_os', 'cliente_id=1', 'estado=en_revision', 'unknown=1']) {
      expect(await team(`?${query}`), 400);
    }
    // Unlike general task listing, this closed query contract rejects unknown
    // bracket keys even when Express simple parsing treats them as literal keys.
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('anonymous, employees, downgraded and revoked sessions fail closed without endpoint writes', async () => {
    let before = await snapshot();
    expect(await api('/inicio/equipo'), 401);
    expect(await team('', employee), 403);
    assert.deepEqual(await snapshot(), before);
    const otherAdmin = await login('qa_agustin');
    check(expect(await team('', otherAdmin), 200));
    await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=91002");
    try {
      before = await snapshot(); expect(await team('', otherAdmin), 403);
      assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    const revoked = await login('qa_agustin');
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    before = await snapshot(); expect(await team('', revoked), 401);
    assert.deepEqual(await snapshot(), before);
    const inactiveToken = await login('qa_agustin');
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=91002');
    try {
      before = await snapshot(); expect(await team('', inactiveToken), 401);
      assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=91002'); }
    check(expect(await team('', await login('qa_agustin')), 200));
  });
});
