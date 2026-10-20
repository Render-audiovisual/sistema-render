import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

// Principal backend/real PostgreSQL only, in the harness's generated disposable
// directory. Importing/running the normal suite never starts a service.
test('client agreement revisions serialize observed admin changes without rebasing or leaking private tokens', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55697 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const owner = await login('qa_franco'), other = await login('qa_agustin'), employee = await login('qa_luciano');
  const [clock] = await f.query("SELECT to_char(current_date,'YYYY-MM') AS period,to_char(date_trunc('month',current_date)+interval '1 month','YYYY-MM-DD') AS next_month");
  const read = async (id, token = owner, period = clock.period) => {
    const rows = ok(await api(`/clientes?periodo=${period}`, token));
    assert.ok(Array.isArray(rows)); const row = rows.find(item => item.id === id); assert.ok(row, `Missing client ${id}`); return row;
  };
  const revision = (row, id = row.id ?? row.cliente_id) => {
    assert.equal(typeof row.agreement_revision, 'string');
    assert.match(row.agreement_revision, /^a1:[1-9]\d*:[1-9]\d*:(?:0|[1-9]\d*):(?:0|[1-9]\d*)$/);
    const [, clientId, clientVersion, groupId, groupVersion] = row.agreement_revision.split(':');
    assert.equal(Number(clientId), id);
    assert.ok(Number.isSafeInteger(Number(clientVersion)));
    assert.equal(groupId === '0', groupVersion === '0');
    return row.agreement_revision;
  };
  const advanced = (before, after, id) => {
    const old = revision(before, id), current = revision(after, id); assert.notEqual(current, old);
    const a = old.split(':').map(Number), b = current.split(':').map(Number);
    assert.ok(b[2] >= a[2]); if (b[3] === a[3]) assert.ok(b[4] >= a[4]);
    return current;
  };
  const conflict = response => { assert.equal(response.status, 409, JSON.stringify(response.body)); assert.equal(response.body.code, 'CLIENT_AGREEMENT_CONFLICT'); };
  const rawClient = async (name, groupId = null) => (await f.query('INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles,grupo_feed_id) VALUES($1,true,2,1,$2) RETURNING id', [name, groupId]))[0];
  const configBody = (row, changes = {}) => ({ nombre: row.nombre, rubro: 'Servicios', vigente_desde: clock.period,
    cuota_reels: 2, cuota_carruseles: 1, dias_historias: [1,3], dias_reels: [2], dias_carruseles: [4],
    disenador_responsable: 'Augusto', abono_mensual: 817293.46, expected_revision: revision(row), ...changes });
  const snapshot = async () => ({ clients: await f.query('SELECT * FROM clientes ORDER BY id'), groups: await f.query('SELECT * FROM grupos_feed ORDER BY id'),
    configs: await f.query('SELECT * FROM cliente_configuraciones ORDER BY id'), fees: await f.query('SELECT * FROM cliente_abonos ORDER BY id') });

  await t.test('complete creation ACK binds the client and its committed configuration/fee revision', async () => {
    const created = ok(await api('/clientes', owner, 'POST', { nombre: 'QA82 created agreement', rubro: 'Servicios', vigente_desde: clock.period,
      cuota_reels: 2, cuota_carruseles: 1, dias_historias: [1,3], dias_reels: [2], dias_carruseles: [4], disenador_responsable: 'Augusto', abono_mensual: 817293.46 }), 201);
    const loaded = await read(created.id, other);
    assert.equal(revision(created), revision(loaded)); assert.equal(Number(loaded.abono_mensual), 817293.46);
    assert.equal(loaded.configuracion_completa, true);
  });

  await t.test('all four existing-client writers require a canonical resource-bound revision before writing', async () => {
    const client = await rawClient('QA82 required revision'), row = await read(client.id);
    const routes = [ ['PATCH', `/clientes/${client.id}`, { nombre: 'Must not save' }],
      ['POST', `/clientes/${client.id}/configuraciones`, configBody(row)],
      ['POST', `/clientes/${client.id}/abono-proximo-mes`, { importe: 999 }], ['DELETE', `/clientes/${client.id}`, {}] ];
    const before = await snapshot();
    for (const [method, path, body] of routes) {
      const { expected_revision: ignored, ...without } = body;
      assert.equal((await api(path, owner, method, without)).status, 428);
      for (const invalid of [null, '', 1, {}, 'a1:1:1:0', 'a1:01:1:0:0', `a1:${client.id}:0:0:0`]) {
        assert.equal((await api(path, owner, method, { ...without, expected_revision: invalid })).status, 400);
      }
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('two owners with the same observation have one winner and an unchanged loser', async () => {
    const client = await rawClient('QA82 concurrent root'), row = await read(client.id), observed = revision(row);
    const results = await Promise.all([owner,other].map((token,index) => api(`/clientes/${client.id}`, token, 'PATCH', { nombre: `QA82 root winner ${index}`, expected_revision: observed })));
    assert.deepEqual(results.map(result => result.status).sort(), [200,409]);
    const winner = results.find(result => result.status === 200), loserIndex = results.findIndex(result => result.status === 409);
    conflict(results[loserIndex]); advanced(row, winner.body, client.id);
    assert.equal((await read(client.id)).nombre, winner.body.nombre);
    const afterWinner = await snapshot();
    conflict(await api(`/clientes/${client.id}`, [owner,other][loserIndex], 'PATCH', { nombre: 'QA82 stale retry must not save', expected_revision: observed }));
    assert.deepEqual(await snapshot(), afterWinner);
  });

  await t.test('a token from another client with identical counters cannot authorize any writer', async () => {
    const a = await rawClient('QA82 resource A'), b = await rawClient('QA82 resource B');
    const first = await read(a.id), second = await read(b.id);
    assert.equal(first.agreement_revision.split(':')[2], second.agreement_revision.split(':')[2]);
    const before = await snapshot();
    for (const [method,path,body] of [['PATCH',`/clientes/${b.id}`,{nombre:'Wrong resource'}],
      ['POST',`/clientes/${b.id}/configuraciones`,configBody(second)], ['POST',`/clientes/${b.id}/abono-proximo-mes`,{importe:111}], ['DELETE',`/clientes/${b.id}`,{}]]) {
      const response = await api(path, other, method, { ...body, expected_revision: revision(first) });
      // A canonical token for a different resource is not malformed; it conflicts.
      conflict(response);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('root, monthly configuration and next fee invalidate each other and return the new committed revision', async () => {
    const client = await rawClient('QA82 interleaving'), initial = await read(client.id);
    const configured = ok(await api(`/clientes/${client.id}/configuraciones`, owner, 'POST', configBody(initial)));
    advanced(initial, configured, client.id);
    conflict(await api(`/clientes/${client.id}`, other, 'PATCH', { activo:false, expected_revision:revision(initial) }));
    const fee = ok(await api(`/clientes/${client.id}/abono-proximo-mes`, other, 'POST', { importe:765432.10, expected_revision:revision(configured,client.id) }));
    advanced(configured,fee,client.id); assert.equal(fee.cliente_id,client.id); assert.equal(fee.vigente_desde,clock.next_month);
    const before = await snapshot();
    conflict(await api(`/clientes/${client.id}/configuraciones`, owner, 'POST', configBody(await read(client.id), { expected_revision:revision(configured,client.id), cuota_reels:99 })));
    assert.deepEqual(await snapshot(),before);
    const root = ok(await api(`/clientes/${client.id}`,owner,'PATCH',{nombre:'QA82 interleaving renamed',expected_revision:revision(fee,client.id)}));
    advanced(fee,root,client.id);
    conflict(await api(`/clientes/${client.id}/abono-proximo-mes`,other,'POST',{importe:1,expected_revision:revision(fee,client.id)}));
  });

  await t.test('shared group update invalidates another client despite its unchanged root version', async () => {
    const [group] = await f.query("INSERT INTO grupos_feed(nombre,cuota_mensual,cuota_reels,cuota_carruseles) VALUES('QA82 shared group',3,2,1) RETURNING id");
    const a = await rawClient('QA82 shared A',group.id), b = await rawClient('QA82 shared B',group.id);
    const first = await read(a.id), second = await read(b.id);
    const updated = ok(await api(`/clientes/${a.id}`,owner,'PATCH',{cuota_feed_reels:5,expected_revision:revision(first)}));
    advanced(first,updated,a.id);
    const reloaded = await read(b.id); assert.equal(reloaded.cuota_feed_reels,5);
    assert.equal(revision(second).split(':')[2],revision(reloaded).split(':')[2]);
    assert.ok(Number(revision(reloaded).split(':')[4]) > Number(revision(second).split(':')[4]));
    const before = await snapshot();
    conflict(await api(`/clientes/${b.id}`,other,'PATCH',{cuota_feed_carruseles:9,expected_revision:revision(second)}));
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('concurrent edits through different members of one group serialize with one conflict, not a deadlock', async () => {
    const [group] = await f.query("INSERT INTO grupos_feed(nombre,cuota_mensual,cuota_reels,cuota_carruseles) VALUES('QA82 concurrent shared',3,2,1) RETURNING id");
    const a = await rawClient('QA82 concurrent shared A',group.id), b = await rawClient('QA82 concurrent shared B',group.id);
    const rows = [await read(a.id), await read(b.id)];
    const results = await Promise.all(rows.map((row,index) => api(`/clientes/${row.id}`,[owner,other][index],'PATCH',{
      cuota_feed_reels: 6 + index, expected_revision:revision(row),
    })));
    assert.deepEqual(results.map(result=>result.status).sort(),[200,409]); conflict(results.find(result=>result.status===409));
    const winner=results.find(result=>result.status===200).body;
    assert.equal((await read(a.id)).cuota_feed_reels,winner.cuota_feed_reels);
    assert.equal((await read(b.id)).cuota_feed_reels,winner.cuota_feed_reels);
  });

  await t.test('shared-group SQL ABA advances both members without changing either client counter', async () => {
    const [group] = await f.query("INSERT INTO grupos_feed(nombre,cuota_mensual,cuota_reels,cuota_carruseles) VALUES('QA82 group ABA',3,2,1) RETURNING id");
    const client=await rawClient('QA82 group ABA member',group.id), initial=await read(client.id);
    await f.query('UPDATE grupos_feed SET cuota_reels=9 WHERE id=$1',[group.id]); const middle=await read(client.id); advanced(initial,middle,client.id);
    await f.query('UPDATE grupos_feed SET cuota_reels=2 WHERE id=$1',[group.id]); const final=await read(client.id); advanced(middle,final,client.id);
    assert.equal(initial.agreement_revision.split(':')[2],final.agreement_revision.split(':')[2]);
    assert.equal(final.cuota_feed_reels,initial.cuota_feed_reels);
    conflict(await api(`/clientes/${client.id}`,owner,'PATCH',{nombre:'Must not save group ABA',expected_revision:revision(initial)}));
  });

  await t.test('create and existing-client update wait on the global advisory lock before taking client/group row locks', async () => {
    const [group] = await f.query("INSERT INTO grupos_feed(nombre,cuota_mensual,cuota_reels,cuota_carruseles) VALUES('QA82 lock order',3,2,1) RETURNING id");
    const client=await rawClient('QA82 lock order member',group.id), row=await read(client.id);
    const waitFor=async(sql,params=[])=>{
      for(let attempt=0;attempt<100;attempt++){
        if((await f.query(sql,params))[0].ready)return;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.fail('Expected isolated fixture lock barrier was not observed');
    };
    const blocker=f.query('DO $qa82_agreement_barrier$ BEGIN PERFORM pg_advisory_xact_lock(8142,1); PERFORM pg_sleep(2); END $qa82_agreement_barrier$');
    await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep' AND query LIKE '%DO $qa82_agreement_barrier$%') AS ready");
    const patch=api(`/clientes/${client.id}`,owner,'PATCH',{nombre:'QA82 lock order saved',expected_revision:revision(row)});
    const create=api('/clientes',other,'POST',{nombre:'QA82 lock order created'});
    try {
      await waitFor("SELECT count(*)>=2 AS ready FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT pg_advisory_xact_lock(8142, 1)'");
      assert.equal((await f.query('SELECT id FROM clientes WHERE id=$1 FOR UPDATE NOWAIT',[client.id]))[0].id,client.id);
      assert.equal((await f.query('SELECT id FROM grupos_feed WHERE id=$1 FOR UPDATE NOWAIT',[group.id]))[0].id,group.id);
      ok(await patch); revision(ok(await create,201));
    } finally { await Promise.allSettled([blocker,patch,create]); }
  });

  await t.test('root ABA SQL changes never revive the original token', async () => {
    const client = await rawClient('QA82 SQL root ABA'), initial = await read(client.id);
    await f.query("UPDATE clientes SET nombre='QA82 temporary root' WHERE id=$1",[client.id]);
    const middle = await read(client.id); advanced(initial,middle,client.id);
    await f.query('UPDATE clientes SET nombre=$2 WHERE id=$1',[client.id,initial.nombre]);
    const final = await read(client.id); advanced(middle,final,client.id); assert.equal(final.nombre,initial.nombre);
    conflict(await api(`/clientes/${client.id}`,owner,'PATCH',{activo:false,expected_revision:revision(initial)}));
  });

  await t.test('configuration SQL insert, update and delete each advance root observation, including ABA', async () => {
    const client = await rawClient('QA82 SQL configuration ABA'); let previous = await read(client.id);
    const [config] = await f.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,dias_historias,disenador_responsable,abono_mensual)
      VALUES($1,$2::date,2,1,ARRAY[1,3]::smallint[],'Augusto',100) RETURNING id`,[client.id,`${clock.period}-01`]);
    let current = await read(client.id); advanced(previous,current,client.id); previous = current;
    for (const amount of [200,100]) { await f.query('UPDATE cliente_configuraciones SET abono_mensual=$2 WHERE id=$1',[config.id,amount]); current = await read(client.id); advanced(previous,current,client.id); previous = current; }
    await f.query('DELETE FROM cliente_configuraciones WHERE id=$1',[config.id]); current = await read(client.id); advanced(previous,current,client.id);
  });

  await t.test('fee SQL insert, update and delete each advance root observation, including ABA', async () => {
    const client = await rawClient('QA82 SQL fee ABA'); let previous = await read(client.id);
    const [fee] = await f.query('INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe) VALUES($1,$2::date,100) RETURNING id',[client.id,`${clock.period}-01`]);
    let current = await read(client.id); advanced(previous,current,client.id); previous = current;
    for (const amount of [200,100]) { await f.query('UPDATE cliente_abonos SET importe=$2 WHERE id=$1',[fee.id,amount]); current = await read(client.id); advanced(previous,current,client.id); previous = current; }
    await f.query('DELETE FROM cliente_abonos WHERE id=$1',[fee.id]); current = await read(client.id); advanced(previous,current,client.id);
  });

  await t.test('historical and current projections carry the same agreement version without mixing monthly fees', async () => {
    const client = await rawClient('QA82 historical agreement'), row = await read(client.id);
    const historic = ok(await api(`/clientes/${client.id}/configuraciones`,owner,'POST',configBody(row,{vigente_desde:'2020-02',cuota_reels:7,abono_mensual:15001})));
    assert.equal(historic.configuracion_vigente_desde,'2020-02-01');
    const current = ok(await api(`/clientes/${client.id}/configuraciones`,other,'POST',configBody(await read(client.id),{cuota_reels:3,abono_mensual:817293.46})));
    const oldView = await read(client.id,owner,'2020-02'), nowView = await read(client.id,other);
    assert.equal(revision(oldView),revision(nowView)); assert.equal(revision(nowView),revision(current,client.id));
    assert.equal(oldView.cuota_reels,7); assert.equal(Number(oldView.abono_mensual),15001);
    assert.equal(nowView.cuota_reels,3); assert.equal(Number(nowView.abono_mensual),817293.46);
    const before = await snapshot(); conflict(await api(`/clientes/${client.id}`,owner,'PATCH',{activo:false,expected_revision:revision(historic,client.id)})); assert.deepEqual(await snapshot(),before);
  });

  await t.test('partial chain keeps committed configuration but another owner prevents activation using the old ACK', async () => {
    const client = await rawClient('QA82 partial chain'), row = await read(client.id);
    const config = ok(await api(`/clientes/${client.id}/configuraciones`,owner,'POST',configBody(row,{cuota_reels:8})));
    const renamed = ok(await api(`/clientes/${client.id}`,other,'PATCH',{nombre:'QA82 partial chain other owner',expected_revision:revision(config,client.id)}));
    const before = await snapshot();
    conflict(await api(`/clientes/${client.id}`,owner,'PATCH',{activo:false,expected_revision:revision(config,client.id)}));
    assert.deepEqual(await snapshot(),before);
    const final = await read(client.id); assert.equal(final.cuota_reels,8); assert.equal(final.activo,true); assert.equal(final.nombre,renamed.nombre); assert.equal(revision(final),revision(renamed,client.id));
  });

  await t.test('delete checks observed CAS before deleting, while current empty-client deletion remains available', async () => {
    const client = await rawClient('QA82 delete CAS'), row = await read(client.id);
    const updated = ok(await api(`/clientes/${client.id}`,other,'PATCH',{nombre:'QA82 delete renamed',expected_revision:revision(row)}));
    const before = await snapshot(); conflict(await api(`/clientes/${client.id}`,owner,'DELETE',{expected_revision:revision(row)})); assert.deepEqual(await snapshot(),before);
    const deleted = ok(await api(`/clientes/${client.id}`,owner,'DELETE',{expected_revision:revision(updated,client.id)}));
    assert.equal(deleted.ok,true); assert.equal(deleted.cliente.id,client.id);
    assert.deepEqual(await f.query('SELECT id FROM clientes WHERE id=$1',[client.id]),[]);
  });

  await t.test('employee cannot read agreement revisions/financial fields or invoke any agreement mutation', async () => {
    const client = await rawClient('QA82 private agreement'), row = await read(client.id);
    ok(await api(`/clientes/${client.id}/configuraciones`,owner,'POST',configBody(row)));
    const admin = await read(client.id), visible = await read(client.id,employee);
    for (const key of ['agreement_revision','agreement_version','abono_mensual','abono_vigente_desde','abono_proximo_mes','abono_proximo_vigente_desde']) assert.equal(Object.hasOwn(visible,key),false,key);
    assert.ok(!JSON.stringify(visible).includes('817293.46')); assert.ok(!JSON.stringify(visible).includes(revision(admin)));
    const before = await snapshot();
    for (const [method,path,body] of [['POST','/clientes',{nombre:'QA82 forbidden create'}], ['PATCH',`/clientes/${client.id}`,{activo:false}],
      ['POST',`/clientes/${client.id}/configuraciones`,configBody(admin)], ['POST',`/clientes/${client.id}/abono-proximo-mes`,{importe:1}], ['DELETE',`/clientes/${client.id}`,{}]]) {
      assert.equal((await api(path,employee,method,{...body,expected_revision:revision(admin)})).status,403);
    }
    assert.deepEqual(await snapshot(),before);
  });
});
