import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { createCapturedRequest } from '../../frontend/src/shared/session/captured-request.js';
import { createMoodboardReferenceOperation, createMoodboardTaskLinkOperation } from '../../frontend/src/shared/session/moodboard-reference-operation.js';
import { createMoodboardReferenceWrite } from '../../frontend/src/shared/session/moodboard-reference-write.js';

test('real Moodboard controllers recover observed failures without recreating references or replaying stale links', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55730 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55730,
    url: 'postgresql://render2_fixture@127.0.0.1:55730/render2_local_test', identity });
  const api = (path, options) => request(f.base, `/api${path}`, options);
  const ok = (result, status = 200) => { assert.equal(result.status, status, 'Unexpected principal HTTP status'); return result.body; };
  const login = async usuario => {
    const dto = ok(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.equal(typeof dto.token, 'string'); assert.ok(Number.isSafeInteger(dto.usuario.id)); return dto;
  };
  const actor = await login('qa_luciano'), peer = await login('qa_franco'), other = await login('qa_designer');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA101 recovery client',true) RETURNING id");
  const [board] = await f.query("INSERT INTO moodboard_boards(nombre) VALUES ('QA101 recovery board') RETURNING id");
  await f.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES ($1,$2)', [board.id, client.id]);
  const [category] = await f.query("INSERT INTO moodboard_categories(board_id,nombre) VALUES ($1,'QA101 category') RETURNING id", [board.id]);
  const seed = async (title, owner) => {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
      VALUES ($1,'QA101 same name',$2,'pendiente','edicion','{}'::jsonb) RETURNING id`, [title, client.id]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]); return row;
  };
  const task = await seed('ZZZ QA101 permitted task', 91003);
  const hidden = await seed('QA101_PRIVATE_HISTORY_SENTINEL', 91004);
  const data = () => ({ title: 'QA101 same title deliberately not an identity', note: 'Synthetic reference',
    category_id: category.id, tags: ['qa101'], external_url: 'https://example.invalid/qa101' });
  const refs = () => f.query('SELECT * FROM moodboard_references ORDER BY id');
  const links = () => f.query('SELECT * FROM moodboard_reference_tasks ORDER BY reference_id,tarea_id');
  const linkURL = id => `/api/moodboards/references/${id}/tasks/${task.id}`;
  const real = async (url, options = {}) => {
    const response = await fetch(new URL(url, f.base), { ...options, signal: options.signal || AbortSignal.timeout(5000) });
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) throw Object.assign(new Error('Principal HTTP rejection'), { status: response.status });
    return body;
  };
  const peerLink = (id, method) => real(linkURL(id), { method, headers: { authorization: `Bearer ${peer.token}` } });
  function context({ fault, refreshFault } = {}) {
    let live = actor, active = true, epoch = 1;
    const renderedEpoch = epoch, calls = [];
    const transport = async (url, options) => {
      calls.push({ url, method: options.method || 'GET', body: options.body });
      return fault ? fault(url, options, real) : real(url, options);
    };
    const capture = () => createCapturedRequest({ session: actor, readSession: () => live,
      request: transport, isActive: () => active && epoch === renderedEpoch });
    const refresh = async guard => {
      guard.assertCurrent(); if (refreshFault) await refreshFault();
      const [references, categories, tasks] = await Promise.all(['references', 'categories', 'tasks'].map(kind =>
        guard.request(`/api/moodboards/boards/${board.id}/${kind}`)));
      guard.assertCurrent(); return { references, categories, tasks };
    };
    return { capture, refresh, calls, replace: () => { live = other; }, unmount: () => { active = false; },
      changeBoardEpoch: () => { epoch++; } };
  }
  const creator = ctx => createMoodboardReferenceOperation({ boardId: board.id, taskId: task.id, capture: ctx.capture, refresh: ctx.refresh });
  const createReference = async () => ok(await api('/moodboards/reference-operations', {
    token: actor.token, method: 'POST', body: { request_id:randomUUID(),action:'create',board_id:board.id,fields:data() },
  }), 201).reference;
  const reference = async id => {
    const rows = ok(await api(`/moodboards/boards/${board.id}/references`, { token: actor.token }));
    return rows.find(row => row.id === id);
  };
  const writes = ctx => ctx.calls.filter(call => call.method !== 'GET');

  await t.test('real pre-insert validation400 permits corrected deliberate submission on the same controller', async () => {
    const ctx = context(), op = creator(ctx), before = await refs(), beforeLinks = await links();
    await assert.rejects(op.create({ ...data(), external_url:'not-a-valid-url' }), error => error.status === 400);
    assert.equal(op.snapshot.phase, 'idle'); assert.equal(op.snapshot.busy, false);
    assert.equal(op.snapshot.createdId, null);
    assert.deepEqual(await refs(), before); assert.deepEqual(await links(), beforeLinks);
    await op.create(data());
    assert.ok(Number.isSafeInteger(op.snapshot.createdId));
    assert.equal((await refs()).length, before.length + 1);
    assert.equal(op.snapshot.observedLinked, true);
  });

  await t.test('confirmed create plus known link rejection retries same reference only', async () => {
    let reject = true;
    const ctx = context({ fault: async (url, options, send) => {
      if (url.includes('/tasks/') && reject) { reject = false; throw Object.assign(new Error('Synthetic known rejection before link dispatch'), { status: 404 }); }
      return send(url, options);
    } });
    const op = creator(ctx), before = await refs();
    await assert.rejects(op.create(data()));
    assert.equal(op.snapshot.phase, 'link_failed'); assert.equal(op.snapshot.busy, false);
    const id = op.snapshot.createdId; assert.ok(Number.isSafeInteger(id));
    assert.equal((await refs()).length, before.length + 1);
    await op.retryLink();
    assert.equal(op.snapshot.createdId, id); assert.equal(op.snapshot.observedLinked, true);
    assert.equal((await refs()).length, before.length + 1);
    assert.equal(writes(ctx).filter(call => call.url.endsWith('/reference-operations')).length, 1);
    assert.equal(writes(ctx).filter(call => call.url.includes('/tasks/')).every(call => call.url === linkURL(id)), true);
  });

  await t.test('committed link with lost response then peer unlink: recovery reads current absence without restoring intent', async () => {
    let lose = true;
    const ctx = context({ fault: async (url, options, send) => {
      const value = await send(url, options);
      if (url.includes('/tasks/') && lose) { lose = false; throw new TypeError('Synthetic response loss after real commit'); }
      return value;
    } });
    const op = creator(ctx); await assert.rejects(op.create(data()));
    const id = op.snapshot.createdId; assert.equal(op.snapshot.phase, 'link_uncertain');
    assert.ok((await links()).some(row => row.reference_id === id && row.tarea_id === task.id));
    await peerLink(id, 'DELETE');
    const beforeRefs = await refs(), beforeLinks = await links(), count = writes(ctx).length;
    await assert.rejects(op.retryLink()); await op.refresh();
    assert.equal(op.snapshot.observedLinked, false); assert.equal(writes(ctx).length, count);
    assert.deepEqual(await refs(), beforeRefs); assert.deepEqual(await links(), beforeLinks);
    assert.equal(op.finish().referenceId, id);
  });

  await t.test('initial create commits but response is lost: exact receipt verification, never title-based ID recovery', async () => {
    let lose = true;
    const ctx = context({ fault: async (url, options, send) => {
      const value = await send(url, options);
      if (url.endsWith('/reference-operations') && options.method === 'POST' && lose) { lose = false; throw new TypeError('Synthetic create response loss'); }
      return value;
    } });
    const op = creator(ctx), before = await refs();
    await assert.rejects(op.create(data())); assert.equal(op.snapshot.phase, 'creation_uncertain');
    assert.equal(op.snapshot.createdId, null); assert.equal((await refs()).length, before.length + 1);
    const count = writes(ctx).length, beforeLinks = await links(),savedRows=await refs(),committed=savedRows.find(row=>!before.some(old=>old.id===row.id));
    await assert.rejects(op.create(data())); await assert.rejects(op.retryLink());
    await assert.rejects(op.refresh()); assert.equal(op.snapshot.createdId, null); assert.throws(()=>op.finish());
    assert.equal(writes(ctx).length, count); assert.deepEqual(await links(), beforeLinks);
    await op.verifyCreate();assert.equal(op.snapshot.createdId,committed.id);assert.equal(op.finish().referenceId,committed.id);
    assert.equal((await refs()).length,before.length+1);assert.equal(writes(ctx).length,count+1);
    const creationWrites=writes(ctx).filter(call=>call.url.endsWith('/reference-operations'));
    assert.equal(creationWrites.length,2);assert.equal(creationWrites[0].body,creationWrites[1].body);
    assert.equal(writes(ctx).filter(call=>call.url.includes('/tasks/')).length,0);
    assert.equal(op.snapshot.phase,'observed_missing');assert.equal(op.snapshot.observedLinked,false);
  });

  await t.test('lost creation ACK then peer link and unlink: receipt verification never restores removed link',async()=>{
    let lose=true;const ctx=context({fault:async(url,options,send)=>{const value=await send(url,options);if(url.endsWith('/reference-operations')&&lose){lose=false;throw Error('Lost committed creation ACK');}return value;}});
    const op=creator(ctx),before=await refs();await assert.rejects(op.create(data()));
    const inserted=(await refs()).find(row=>!before.some(old=>old.id===row.id));assert.ok(inserted);
    await peerLink(inserted.id,'POST');assert.ok((await links()).some(row=>row.reference_id===inserted.id&&row.tarea_id===task.id));
    await peerLink(inserted.id,'DELETE');const beforeVerify=await links(),beforeReferences=await refs();
    await op.verifyCreate();assert.equal(op.snapshot.createdId,inserted.id);assert.equal(op.snapshot.phase,'observed_missing');assert.equal(op.snapshot.observedLinked,false);assert.equal(op.snapshot.canRetryLink,false);
    await assert.rejects(op.retryLink());assert.deepEqual(await links(),beforeVerify);assert.deepEqual(await refs(),beforeReferences);
    assert.equal(writes(ctx).length,2);assert.equal(writes(ctx).filter(call=>call.url.includes('/tasks/')).length,0);assert.equal(writes(ctx)[0].body,writes(ctx)[1].body);
  });

  await t.test('physically deleted reference replay is unavailable and never recreated or linked',async()=>{
    let lose=true;
    const ctx=context({fault:async(url,options,send)=>{const value=await send(url,options);if(url.endsWith('/reference-operations')&&lose){lose=false;throw Error('Lost committed creation ACK');}return value;}});
    const op=creator(ctx),before=await refs(),beforeLinks=await links();await assert.rejects(op.create(data()));
    const inserted=(await refs()).find(row=>!before.some(old=>old.id===row.id));assert.ok(inserted);
    const observed=await reference(inserted.id);
    const deletion=ok(await api('/moodboards/reference-operations',{token:peer.token,method:'POST',body:{request_id:randomUUID(),action:'delete',board_id:board.id,reference_id:observed.id,expected_revision:observed.revision}}));
    assert.equal(deletion.reference,null);assert.equal(deletion.operation.result_revision,observed.revision);
    await op.verifyCreate();assert.equal(op.snapshot.gone,true);assert.equal(op.finish().referenceId,null);
    assert.deepEqual(await refs(),before);assert.deepEqual(await links(),beforeLinks);
    assert.equal(writes(ctx).length,2);assert.equal(writes(ctx)[0].body,writes(ctx)[1].body);assert.equal(writes(ctx).some(call=>call.url.includes('/tasks/')),false);
  });

  await t.test('real edit CAS conflict is explicit; uncertain delete verifies only its captured receipt',async()=>{
    const observed=await createReference(),ctx=context(),edit=createMoodboardReferenceWrite({boardId:board.id,capture:ctx.capture,refresh:ctx.refresh});
    const saved=await edit.submit('edit',observed,{status:'aprobada'});assert.equal(saved.ack.reference.revision,observed.revision+1);await edit.settle();edit.complete();
    const stale=createMoodboardReferenceWrite({boardId:board.id,capture:ctx.capture,refresh:ctx.refresh}),before=await refs();
    await assert.rejects(stale.submit('edit',observed,{status:'descartada'}),error=>error.status===409);const count=writes(ctx).length;
    await assert.rejects(stale.verify());await stale.observe();assert.equal(stale.snapshot.observed.revision,saved.ack.reference.revision);assert.equal(writes(ctx).length,count);assert.deepEqual(await refs(),before);stale.releaseConflict();
    let lose=true;const deleting=context({fault:async(url,options,send)=>{const value=await send(url,options);if(url.endsWith('/reference-operations')&&lose){lose=false;throw Error('Lost committed delete ACK');}return value;}});
    const operation=createMoodboardReferenceWrite({boardId:board.id,capture:deleting.capture,refresh:deleting.refresh});
    await assert.rejects(operation.submit('delete',saved.ack.reference));assert.equal(operation.snapshot.phase,'uncertain');
    const verified=await operation.verify();assert.equal(verified.ack.reference,null);assert.equal(verified.ack.operation.replayed,true);assert.equal(verified.ack.operation.result_revision,saved.ack.reference.revision);
    await operation.settle();assert.equal(writes(deleting).length,2);assert.equal(writes(deleting)[0].body,writes(deleting)[1].body);assert.equal((await refs()).some(row=>row.id===observed.id),false);
  });

  for (const transition of ['replace', 'unmount', 'changeBoardEpoch']) await t.test(`${transition} after real create ACK prevents link stage`, async () => {
    let ctx;
    ctx = context({ fault: async (url, options, send) => {
      const value = await send(url, options);
      if (url.endsWith('/reference-operations') && options.method === 'POST') ctx[transition]();
      return value;
    } });
    const op = creator(ctx), before = await refs(), beforeLinks = await links();
    await assert.rejects(op.create(data()), error => error.code === 'session_binding_obsolete');
    assert.equal(op.snapshot.phase, 'blocked'); assert.equal(op.snapshot.busy, false);
    assert.equal((await refs()).length, before.length + 1);
    assert.deepEqual(await links(), beforeLinks);
    assert.equal(writes(ctx).length, 1);
    await assert.rejects(op.refresh()); assert.equal(writes(ctx).length, 1);
  });

  await t.test('confirmed create/link but failed refresh never repeats either write', async () => {
    let failRead = true;
    const ctx = context({ refreshFault: async () => { if (failRead) throw new Error('Synthetic read unavailable'); } });
    const op = creator(ctx); await assert.rejects(op.create(data()));
    assert.equal(op.snapshot.phase, 'refresh_failed'); assert.equal(op.snapshot.writeConfirmed, true);
    const count = writes(ctx).length, beforeRefs = await refs(), beforeLinks = await links();
    await assert.rejects(op.create(data())); await assert.rejects(op.retryLink());
    failRead = false; await op.refresh(); assert.equal(op.snapshot.observedLinked, true);
    assert.equal(writes(ctx).length, count); assert.deepEqual(await refs(), beforeRefs); assert.deepEqual(await links(), beforeLinks);
  });

  await t.test('toggle DELETE commits/lost response then peer POST: refresh keeps peer link without stale DELETE', async () => {
    const saved = await createReference(); await peerLink(saved.id, 'POST');
    let lose = true;
    const ctx = context({ fault: async (url, options, send) => {
      const value = await send(url, options);
      if (options.method === 'DELETE' && lose) { lose = false; throw new TypeError('Synthetic unlink response loss'); }
      return value;
    } });
    const op = createMoodboardTaskLinkOperation({ boardId: board.id, reference: await reference(saved.id), capture: ctx.capture, refresh: ctx.refresh });
    await assert.rejects(op.change(task.id, false)); assert.equal(op.snapshot.phase, 'uncertain');
    await peerLink(saved.id, 'POST'); const before = await links(), count = writes(ctx).length;
    await assert.rejects(op.retryWrite()); await op.refresh();
    assert.equal(op.isLinked(task.id), true); assert.equal(op.snapshot.locked, false);
    assert.equal(writes(ctx).length, count); assert.deepEqual(await links(), before);
  });

  await t.test('toggle synchronous busy prevents duplicate dispatch; confirmed write/read failure is refresh-only', async () => {
    const saved = await createReference(); let release;
    const gate = new Promise(resolve => { release = resolve; });
    let entered; const started = new Promise(resolve => { entered = resolve; });
    let failRead = true;
    const ctx = context({ fault: async (url, options, send) => {
      if (options.method === 'POST' && url.includes('/tasks/')) { entered(); await gate; }
      return send(url, options);
    }, refreshFault: async () => { if (failRead) throw new Error('Synthetic read failure'); } });
    const op = createMoodboardTaskLinkOperation({ boardId: board.id, reference: await reference(saved.id), capture: ctx.capture, refresh: ctx.refresh });
    const pending = op.change(task.id, true); await started;
    assert.equal(op.snapshot.busy, true); await assert.rejects(op.change(task.id, true));
    release(); await assert.rejects(pending);
    assert.equal(op.snapshot.busy, false); assert.equal(op.snapshot.phase, 'refresh_failed');
    assert.equal(op.snapshot.writeConfirmed, true); const count = writes(ctx).length;
    await assert.rejects(op.retryWrite()); failRead = false; await op.refresh();
    assert.equal(op.isLinked(task.id), true); assert.equal(writes(ctx).length, count);
  });

  await t.test('recovery uses actual visible links, not capped task candidates; historical private IDs stay hidden', async () => {
    await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
      SELECT 'AAA QA101 candidate '||n,'Fixture volume',$1,'pendiente','edicion','{"workspace":"render_os"}'::jsonb
      FROM generate_series(1,155) n`, [client.id]);
    const saved = await createReference(); await peerLink(saved.id, 'POST');
    await f.query('INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES ($1,$2)', [saved.id, hidden.id]);
    const ctx = context(); const observed = await ctx.refresh(ctx.capture());
    assert.equal(observed.tasks.length, 150); assert.equal(observed.tasks.some(row => row.id === task.id), false);
    const visible = observed.references.find(row => row.id === saved.id);
    assert.ok(visible.tareas.some(row => row.id === task.id));
    assert.equal(visible.tareas.some(row => row.id === hidden.id), false);
    assert.equal(JSON.stringify(observed).includes('QA101_PRIVATE_HISTORY_SENTINEL'), false);
    const op = createMoodboardTaskLinkOperation({ boardId: board.id, reference: visible, capture: ctx.capture, refresh: ctx.refresh });
    assert.equal(op.isLinked(task.id), true);
    const before = await links();
    await assert.rejects(op.change(hidden.id, true), error => error.status === 404);
    assert.equal(op.snapshot.phase, 'write_failed');
    const count = writes(ctx).length; await op.refresh(); assert.equal(writes(ctx).length, count);
    assert.deepEqual(await links(), before);
  });
});
