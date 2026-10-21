import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('first monthly agreement: explicit basic-client onboarding, atomic CAS and current admin authority', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55749 });
  const connections = new Set();
  t.after(async () => {
    for (const db of connections) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA109 cleanup ENOENT: ${f.root}; PostgreSQL port55749`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55749/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55749, url, identity });
  const connect = async () => {
    const db = new pg.Client({ connectionString: url, application_name: 'qa109-own-barrier', statement_timeout: 15000 });
    connections.add(db); await db.connect(); return db;
  };
  const close = async db => { await db.query('ROLLBACK').catch(() => {}); await db.end(); connections.delete(db); };
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), otherAdmin = await login('qa_agustin'), staff = await login('qa_luciano');
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const path = id => `/clientes/${id}/acuerdo-mensual/iniciar`;
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  let sequence = 0;
  const basic = async () => ok(await api('/clientes', admin, 'POST', { nombre: `QA109 basic ${++sequence}` }), 201);
  const revision = async (id, token = admin) => {
    const rows = ok(await api('/clientes?periodo=2026-10', token)), row = rows.find(item => item.id === id);
    assert.ok(row); assert.match(row.agreement_revision, new RegExp(`^a1:${id}:[1-9][0-9]*:0:0$`));
    return row.agreement_revision;
  };
  const payload = expected => ({ vigente_desde: '2026-10', expected_revision: expected, rubro: 'Servicios QA109',
    cuota_reels: 2, cuota_carruseles: 1, abono_mensual: '817293.46', dias_historias: [1, 3],
    dias_reels: [2], dias_carruseles: [4], disenador_responsable: 'Augusto' });
  const eligible = async client => {
    const body = ok(await api(path(client.id), admin));
    keys(body, ['version', 'eligible', 'agreement_revision', 'cliente']);
    assert.equal(body.version, 1); assert.equal(body.eligible, true);
    keys(body.cliente, ['id', 'nombre', 'activo', 'rubro', 'fecha_inicio']);
    assert.deepEqual(body.cliente, { id: client.id, nombre: client.nombre, activo: true, rubro: null, fecha_inicio: null });
    assert.equal(body.agreement_revision, await revision(client.id)); return body;
  };
  const checkAck = (body, client, input) => {
    keys(body, ['version', 'cliente']); assert.equal(body.version, 1);
    const row = body.cliente;
    keys(row, ['id', 'nombre', 'activo', 'rubro', 'fecha_inicio', 'cuota_reels', 'cuota_carruseles', 'grupo_feed_id',
      'configuracion_completa', 'configuracion_vigente_desde', 'abono_vigente_desde', 'abono_mensual',
      'dias_historias', 'dias_reels', 'dias_carruseles', 'disenador_responsable', 'agreement_revision']);
    assert.equal(row.id, client.id); assert.equal(row.nombre, client.nombre); assert.equal(row.activo, true);
    assert.equal(row.rubro, input.rubro); assert.equal(row.fecha_inicio, `${input.vigente_desde}-01`);
    assert.equal(row.cuota_reels, input.cuota_reels); assert.equal(row.cuota_carruseles, input.cuota_carruseles);
    assert.equal(row.grupo_feed_id, null); assert.equal(row.configuracion_completa, true);
    assert.equal(row.configuracion_vigente_desde, `${input.vigente_desde}-01`); assert.equal(row.abono_vigente_desde, `${input.vigente_desde}-01`);
    assert.equal(row.abono_mensual, Number(input.abono_mensual).toFixed(2));
    for (const field of ['dias_historias', 'dias_reels', 'dias_carruseles', 'disenador_responsable']) assert.deepEqual(row[field], input[field]);
    assert.match(row.agreement_revision, new RegExp(`^a1:${client.id}:[1-9][0-9]*:0:0$`));
    assert.notEqual(row.agreement_revision, input.expected_revision);
  };
  const assertOnlyAgreementChanged = (before, after, id) => {
    for (const table of tables.filter(name => !['clientes', 'cliente_configuraciones', 'cliente_abonos'].includes(name)))
      assert.deepEqual(after[table], before[table], table);
    assert.deepEqual(after.clientes.filter(row => row.id !== id), before.clientes.filter(row => row.id !== id));
    for (const table of ['cliente_configuraciones', 'cliente_abonos']) {
      assert.deepEqual(after[table].filter(row => row.cliente_id !== id), before[table].filter(row => row.cliente_id !== id));
      assert.equal(after[table].filter(row => row.cliente_id === id).length, 1);
    }
  };

  await t.test('eligible GET is closed and repeatedly read-only; explicit onboarding commits only client/configuration/fee', async () => {
    const client = await basic(), beforeRead = await snapshot();
    const observation = await eligible(client); await eligible(client);
    assert.deepEqual(await snapshot(), beforeRead);
    const input = payload(observation.agreement_revision), before = await snapshot();
    checkAck(ok(await api(path(client.id), admin, 'POST', input)), client, input);
    const after = await snapshot(); assertOnlyAgreementChanged(before, after, client.id);
    const config = after.cliente_configuraciones.find(row => row.cliente_id === client.id);
    const fee = after.cliente_abonos.find(row => row.cliente_id === client.id);
    assert.equal(Number(config.abono_mensual), 817293.46); assert.equal(Number(fee.importe), 817293.46);
    assert.equal(config.cuota_reels, 2); assert.equal(config.cuota_carruseles, 1);
    const fresh = await revision(client.id);
    const committed = await snapshot();
    assert.equal(ok(await api(path(client.id), admin), 409).code, 'CLIENT_FIRST_AGREEMENT_INELIGIBLE');
    assert.equal(ok(await api(path(client.id), admin, 'POST', { ...input, expected_revision: fresh }), 409).code, 'CLIENT_FIRST_AGREEMENT_INELIGIBLE');
    assert.deepEqual(await snapshot(), committed);
    const row = ok(await api('/clientes?periodo=2026-10', otherAdmin)).find(item => item.id === client.id);
    assert.equal(row.agreement_revision, fresh); assert.equal(row.configuracion_completa, true);
  });

  await t.test('explicit zero quotas and zero fee are valid, without invented payments or monthly content', async () => {
    const client = await basic(), observation = await eligible(client);
    const input = { ...payload(observation.agreement_revision), cuota_reels: 0, cuota_carruseles: 0, abono_mensual: '0' };
    const before = await snapshot(); checkAck(ok(await api(path(client.id), admin, 'POST', input)), client, input);
    assertOnlyAgreementChanged(before, await snapshot(), client.id);
  });

  await t.test('first November agreement never backdates base quotas into October catalogue or goals; reads create no content', async () => {
    const client = await basic(), observation = await eligible(client);
    const input = { ...payload(observation.agreement_revision), vigente_desde: '2026-11', abono_mensual: '125000' };
    const before = await snapshot();
    checkAck(ok(await api(path(client.id), admin, 'POST', input)), client, input);
    const committed = await snapshot(); assertOnlyAgreementChanged(before, committed, client.id);
    const stored = committed.clientes.find(row => row.id === client.id);
    assert.equal(stored.cuota_reels, 2); assert.equal(stored.cuota_carruseles, 1);
    for (const period of ['2026-10', '2026-11']) {
      const rows = ok(await api(`/clientes?periodo=${period}`, otherAdmin));
      const row = rows.find(item => item.id === client.id); assert.ok(row);
      assert.equal(row.fecha_inicio, '2026-11-01');
      if (period === '2026-10') {
        assert.equal(row.cuota_reels, 0); assert.equal(row.cuota_carruseles, 0);
        assert.equal(row.abono_mensual, null); assert.equal(row.abono_vigente_desde, null);
        assert.equal(row.configuracion_completa, false); assert.equal(row.configuracion_vigente_desde, null);
      } else {
        assert.equal(row.cuota_reels, 2); assert.equal(row.cuota_carruseles, 1);
        assert.equal(Number(row.abono_mensual), 125000); assert.equal(row.abono_vigente_desde, '2026-11-01');
        assert.equal(row.configuracion_completa, true); assert.equal(row.configuracion_vigente_desde, '2026-11-01');
      }
      for (const token of [admin, staff]) {
        const goals = ok(await api(`/cliente-objetivos?periodo=${period}`, token));
        const matching = goals.clientes.filter(goal => goal.cuentas.some(account => account.id === client.id));
        if (period === '2026-10') assert.deepEqual(matching, []);
        else {
          assert.equal(matching.length, 1); assert.equal(matching[0].clave, `cliente-${client.id}`);
          assert.equal(matching[0].preparado, false); assert.deepEqual(matching[0].piezas, []);
          assert.equal(matching[0].reels, 2); assert.equal(matching[0].carruseles, 1);
          assert.deepEqual(matching[0].cuota_actual, { reels: 2, carruseles: 1 });
        }
      }
    }
    assert.deepEqual(await snapshot(), committed, 'Catalogue and goal reads must not prepare or mutate any business rows');
  });

  await t.test('January first agreement respects year boundary; legacy midmonth/null starts and earlier effective configurations retain their semantics', async () => {
    const january = await basic(), observation = await eligible(january);
    const input = { ...payload(observation.agreement_revision), vigente_desde: '2027-01', abono_mensual: '91.20' };
    const beforeAgreement = await snapshot();
    checkAck(ok(await api(path(january.id), admin, 'POST', input)), january, input);
    assertOnlyAgreementChanged(beforeAgreement, await snapshot(), january.id);
    // These legacy shapes are fixture-only historical data, not a new onboarding
    // API or permission to rewrite pre-existing effective configurations.
    const legacy = await f.query(`INSERT INTO clientes(nombre,activo,fecha_inicio,cuota_reels,cuota_carruseles)
      VALUES ('QA109 legacy midmonth',true,'2026-10-18',4,2),
        ('QA109 legacy null start',true,NULL,5,3),
        ('QA109 historical config precedes future start',true,'2027-01-01',9,8)
      RETURNING id,nombre`);
    const [midmonth, nullStart, configuredBeforeStart] = legacy;
    await f.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,
      dias_historias,disenador_responsable,abono_mensual)
      VALUES ($1,'2026-09-01',1,2,'{1}','Augusto',23.40)`, [configuredBeforeStart.id]);
    const beforeReads = await snapshot();
    for (const period of ['2026-12', '2027-01']) {
      const rows = ok(await api(`/clientes?periodo=${period}`, otherAdmin));
      const row = rows.find(item => item.id === january.id); assert.ok(row);
      if (period === '2026-12') {
        assert.equal(row.cuota_reels, 0); assert.equal(row.cuota_carruseles, 0);
        assert.equal(row.abono_mensual, null); assert.equal(row.abono_vigente_desde, null);
        assert.equal(row.configuracion_completa, false); assert.equal(row.configuracion_vigente_desde, null);
      } else {
        assert.equal(row.cuota_reels, 2); assert.equal(row.cuota_carruseles, 1);
        assert.equal(Number(row.abono_mensual), 91.2); assert.equal(row.abono_vigente_desde, '2027-01-01');
        assert.equal(row.configuracion_completa, true); assert.equal(row.configuracion_vigente_desde, '2027-01-01');
      }
    }
    for (const token of [admin, staff]) {
      const rows = ok(await api('/clientes?periodo=2026-10', token));
      const mid = rows.find(row => row.id === midmonth.id), absent = rows.find(row => row.id === nullStart.id);
      const historical = rows.find(row => row.id === configuredBeforeStart.id);
      assert.ok(mid && absent && historical);
      assert.equal(mid.fecha_inicio, '2026-10-18'); assert.equal(mid.cuota_reels, 4); assert.equal(mid.cuota_carruseles, 2);
      assert.equal(mid.configuracion_completa, false); assert.equal(mid.configuracion_vigente_desde, null);
      assert.equal(absent.fecha_inicio, null); assert.equal(absent.cuota_reels, 5); assert.equal(absent.cuota_carruseles, 3);
      assert.equal(absent.configuracion_completa, false); assert.equal(absent.configuracion_vigente_desde, null);
      assert.equal(historical.fecha_inicio, '2027-01-01'); assert.equal(historical.cuota_reels, 1); assert.equal(historical.cuota_carruseles, 2);
      assert.equal(historical.configuracion_completa, true); assert.equal(historical.configuracion_vigente_desde, '2026-09-01');
      if (token === admin) { assert.equal(Number(historical.abono_mensual), 23.4); assert.equal(historical.abono_vigente_desde, '2026-09-01'); }
    }
    assert.deepEqual(await snapshot(), beforeReads, 'Temporal catalogue projections must not alter any historical business rows');
  });

  await t.test('two admins share one observed precondition: one commits, the other conflicts without overwrite', async () => {
    const client = await basic(), observation = await eligible(client), before = await snapshot();
    const inputs = [payload(observation.agreement_revision), { ...payload(observation.agreement_revision), cuota_reels: 4, abono_mensual: '91.20' }];
    const results = await Promise.all(inputs.map((input, i) => api(path(client.id), i ? otherAdmin : admin, 'POST', input)));
    assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
    const winner = results.findIndex(row => row.status === 200); checkAck(results[winner].body, client, inputs[winner]);
    const after = await snapshot(); assertOnlyAgreementChanged(before, after, client.id);
    assert.equal(after.cliente_configuraciones.find(row => row.cliente_id === client.id).cuota_reels, inputs[winner].cuota_reels);
    assert.equal(Number(after.cliente_abonos.find(row => row.cliente_id === client.id).importe), Number(inputs[winner].abono_mensual));
  });

  await t.test('strict body/query/ID and precondition validation reject without changing any business rows', async () => {
    const client = await basic(), input = payload((await eligible(client)).agreement_revision);
    const { expected_revision, ...missing } = input;
    const cases = [[missing, 428], [{ ...input, expected_revision: 'bad' }, 400], [{ ...input, extra: true }, 400]];
    for (const field of ['vigente_desde', 'cuota_reels', 'cuota_carruseles', 'abono_mensual', 'dias_historias',
      'dias_reels', 'dias_carruseles', 'disenador_responsable', 'rubro']) {
      const incomplete = { ...input }; delete incomplete[field]; cases.push([incomplete, 400]);
    }
    for (const value of ['0000-10', '2026-00', '2026-13', '2026-1', null, ['2026-10']]) cases.push([{ ...input, vigente_desde: value }, 400]);
    for (const field of ['cuota_reels', 'cuota_carruseles']) for (const value of [-1, 101, 1.2, '2', null]) cases.push([{ ...input, [field]: value }, 400]);
    for (const value of [1, null, '', '01', '-1', '+1', '1e2', ' 1', '1 ', '1.001', '1000000000000', '1\n']) cases.push([{ ...input, abono_mensual: value }, 400]);
    for (const field of ['dias_historias', 'dias_reels', 'dias_carruseles']) for (const value of [null, '1', [1, 1], [-1], [7], ['1']]) cases.push([{ ...input, [field]: value }, 400]);
    cases.push([{ ...input, dias_historias: [] }, 400], [{ ...input, rubro: ' ' }, 400], [{ ...input, disenador_responsable: 'QA109-not-a-designer-catalog-label' }, 400]);
    const before = await snapshot();
    for (const [body, status] of cases) {
      const rejected = ok(await api(path(client.id), admin, 'POST', body), status);
      assert.equal(rejected.code, body === missing ? 'CLIENT_AGREEMENT_REQUIRED'
        : body.expected_revision === 'bad' ? 'CLIENT_AGREEMENT_INVALID' : 'CLIENT_FIRST_AGREEMENT_INPUT');
    }
    for (const id of ['0', '-1', '01', '1.0', '2147483648', 'bad']) {
      ok(await api(path(id), admin), 400); ok(await api(path(id), admin, 'POST', input), 400);
    }
    for (const query of ['?mes=2026-10', '?x=1', '?x[]=1', '?x=1&x=2']) ok(await api(`${path(client.id)}${query}`, admin), 400);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('stale observed client revision rejects; neither employee nor anonymous receives financial eligibility or writes', async () => {
    const client = await basic(), input = payload((await eligible(client)).agreement_revision);
    await f.query("UPDATE clientes SET nombre=nombre||' changed' WHERE id=$1", [client.id]);
    const before = await snapshot();
    assert.equal(ok(await api(path(client.id), admin, 'POST', input), 409).code, 'CLIENT_AGREEMENT_CONFLICT');
    for (const token of [staff, null]) {
      const status = token ? 403 : 401;
      for (const method of ['GET', 'POST']) {
        const rejected = ok(await api(path(client.id), token, method, method === 'POST' ? input : undefined), status);
        assert.equal(JSON.stringify(rejected).includes('817293.46'), false);
        for (const key of ['cliente', 'agreement_revision', 'abono_mensual']) assert.equal(Object.hasOwn(rejected, key), false);
      }
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('any historical/future fee or configuration, base quotas, feed, dates and inactive status block first agreement', async () => {
    const seeds = [
      async id => f.query("INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe) VALUES($1,'2020-01-01',0)", [id]),
      async id => f.query("INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe) VALUES($1,'2030-01-01',1)", [id]),
      async id => f.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,dias_historias,disenador_responsable,abono_mensual)
        VALUES($1,'2030-01-01',0,0,'{1}','Augusto',0)`, [id]),
      async id => f.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,dias_historias,disenador_responsable,abono_mensual)
        VALUES($1,'2020-01-01',0,0,'{1}','Augusto',0)`, [id]),
      async id => f.query('UPDATE clientes SET cuota_reels=1 WHERE id=$1', [id]),
      async id => f.query("UPDATE clientes SET fecha_inicio='2020-01-01' WHERE id=$1", [id]),
      async id => f.query("UPDATE clientes SET fecha_fin='2030-01-01' WHERE id=$1", [id]),
      async id => f.query('UPDATE clientes SET activo=false WHERE id=$1', [id]),
      async id => { const [group] = await f.query("INSERT INTO grupos_feed(nombre) VALUES('QA109 existing feed') RETURNING id"); await f.query('UPDATE clientes SET grupo_feed_id=$1 WHERE id=$2', [group.id, id]); },
    ];
    for (const seed of seeds) {
      const client = await basic(); await seed(client.id);
      const rows = ok(await api('/clientes?periodo=2026-10', admin)), current = rows.find(row => row.id === client.id);
      assert.ok(current);
      const before = await snapshot();
      assert.equal(ok(await api(path(client.id), admin), 409).code, 'CLIENT_FIRST_AGREEMENT_INELIGIBLE');
      assert.equal(ok(await api(path(client.id), admin, 'POST', payload(current.agreement_revision)), 409).code, 'CLIENT_FIRST_AGREEMENT_INELIGIBLE');
      assert.deepEqual(await snapshot(), before);
    }
  });

  await t.test('late SQL failure rolls back configuration, fee, root fields and agreement version atomically', async () => {
    const client = await basic(), input = payload((await eligible(client)).agreement_revision);
    await f.query(`CREATE FUNCTION qa109_fail_fee() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.cliente_id=${client.id} THEN RAISE EXCEPTION 'QA109 fixture fault'; END IF; RETURN NEW; END $$`);
    await f.query('CREATE TRIGGER qa109_fee_fault BEFORE INSERT ON cliente_abonos FOR EACH ROW EXECUTE FUNCTION qa109_fail_fee()');
    try {
      const before = await snapshot(); ok(await api(path(client.id), admin, 'POST', input), 500);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await f.query('DROP TRIGGER qa109_fee_fault ON cliente_abonos'); await f.query('DROP FUNCTION qa109_fail_fee()');
    }
    checkAck(ok(await api(path(client.id), admin, 'POST', input)), client, input);
  });

  for (const [index, loss] of [
    { name: 'epoch revocation', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'role demotion', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
  ].entries()) await t.test(`${loss.name} while HTTP awaits client mutex denies before agreement DML`, async () => {
    const id = 991091 + index, usuario = `qa109_actor_${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA109 isolated admin','admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario]);
    const token = await login(usuario), client = await basic(), input = payload((await eligible(client)).agreement_revision);
    const holder = await connect(), changer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(8142,1)');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = (async () => {
        const response = await fetch(new URL(`/api${path(client.id)}`, f.base), { method: 'POST', signal: AbortSignal.timeout(20000),
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
        return { status: response.status, body: await response.json() };
      })(); void pending.catch(() => {});
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await changer.query(`SELECT l.pid FROM pg_locks l WHERE l.locktype='advisory'
          AND l.classid=8142::oid AND l.objid=1::oid AND l.objsubid=2 AND NOT l.granted
          AND $1::int=ANY(pg_blocking_pids(l.pid))`, [pid]);
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'Principal HTTP must actually await the held client administration mutex');
      await changer.query(loss.sql, [id]); const before = await snapshot();
      await holder.query('COMMIT'); ok(await pending, loss.status); assert.deepEqual(await snapshot(), before);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(changer); await close(holder);
    }
  });
});
