import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness } from '../scripts/render2-local-test.js';

const user = { owner: 94001, impostor: 94002, collaborator: 94003, inactive: 94004, ambiguousA: 94005, ambiguousB: 94006 };
const actor = Object.fromEntries(Object.keys(user).map(key => [key, `qa-wa-${key}`]));
actor.admin = 'qa-wa-admin';
actor.unlinked = 'qa-wa-unlinked';
const group = 'qa-wilson-group';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

test('Wilson signed HTTP resolves current external identity and stable task membership', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fixture = await startLocalHarness({ port: 55596, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    telegramUserBindings: JSON.stringify({ 'qa-tg-owner': user.owner, 'qa-tg-admin': 91001 }),
    allowedTelegramIds: 'qa-tg-owner,qa-tg-admin,qa-tg-unmapped',
    allowedWhatsappIds: Object.values(actor).join(','), allowedWhatsappGroups: group,
    systemActorId: 'qa-wilson-system',
  } });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own Wilson fixture stopped and removed: ${fixture.root}`);
  });
  const signed = async (actorId, route, { channel = 'whatsapp', groupId = '', method = 'GET', body,
    actorName = 'Franco', tamper = false, changedQuery, signatureVersion = '2' } = {}) => {
    const url = new URL(`/api/integraciones/wilson${route}`, fixture.base);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    const message = ['v2', timestamp, nonce, channel, actorId, groupId, actorName, method,
      `${url.pathname}${url.search}`, hash(body === undefined ? '' : canonical(body))].join('\n');
    const signature = crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64');
    if (changedQuery !== undefined) url.search = changedQuery;
    const response = await fetch(url, { method, signal: AbortSignal.timeout(5000), headers: {
      'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce,
      ...(signatureVersion === null ? {} : { 'x-wilson-signature-version': signatureVersion }),
      'x-wilson-signature': tamper ? Buffer.from('invalid').toString('base64') : signature,
      'x-wilson-channel': channel, 'x-wilson-actor-id': actorId, 'x-wilson-actor-name': actorName,
      ...(groupId ? { 'x-wilson-group-id': groupId } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const denied = result => assert.ok([403, 404].includes(result.status), JSON.stringify(result));
  for (const [key, id] of Object.entries(user)) {
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,whatsapp_id_hash,whatsapp_habilitado)
      SELECT $1,$2,$3,'diseno',password_hash,$4,1,$5,true FROM usuarios WHERE id=91004`,
    [id, `qa_wilson_${key}`, ['owner', 'impostor'].includes(key) ? 'QA Wilson Shared' : `QA Wilson ${key}`,
      key !== 'inactive', hash(actor[key])]);
  }
  await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=91001', [hash(actor.admin)]);
  // Ambiguity across both supported link sources, without weakening UNIQUE indexes.
  await fixture.query(`INSERT INTO mia_whatsapp_identities(actor_hash,usuario_id,notification_key,display_name)
    VALUES ($1,$2,'qa-wilson-ambiguous','QA Wilson ambiguous alternate')`, [hash(actor.ambiguousA), user.ambiguousB]);
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA Wilson client') RETURNING id");
  const newTask = async (title, ownerId = user.owner, collaborators = []) => {
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
      VALUES ($1,'QA Wilson Shared',$2,'pendiente','diseno','carrusel','2026-10-25',
      '{"workspace":"render_os","colaboradores":["QA Wilson collaborator"]}') RETURNING id`, [title, client.id]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [task.id, ownerId]);
    for (const id of collaborators)
      await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'colaborador')", [task.id, id]);
    return task.id;
  };
  const taskId = await newTask('QA Wilson unique own task', user.owner, [user.collaborator]);
  const foreignId = await newTask('QA Wilson foreign task', user.impostor);
  const snapshot = id => fixture.query('SELECT * FROM tareas WHERE id=$1', [id]);
  const edit = async (actorId, id, title, options = {}) => {
    const payload = { titulo: title, idempotency_key: crypto.randomUUID() };
    if (options.channel === 'telegram') return signed(actorId, `/tareas/${id}`, {
      ...options, method: 'PATCH', body: { ...payload, confirmado: true },
    });
    const confirmation = await signed(actorId, '/confirmaciones', { ...options, method: 'POST',
      body: { operacion: 'editar', tarea_id: id, payload } });
    if (confirmation.status !== 201) return confirmation;
    return signed(actorId, `/tareas/${id}`, { ...options, method: 'PATCH',
      body: { ...payload, confirmacion_token: confirmation.body.confirmacion_token } });
  };

  await t.test('real ephemeral signature accepted; invalid signature rejected', async () => {
    assert.equal((await signed(actor.owner, `/tareas/${taskId}`)).status, 200);
    assert.equal((await signed(actor.owner, `/tareas/${taskId}`, { tamper: true })).status, 401);
  });
  await t.test('v2 signs the exact request target including query; tampered query and legacy versions are rejected', async () => {
    for (const [id, channel] of [[actor.owner, 'whatsapp'], ['qa-tg-owner', 'telegram']]) {
      const valid = await signed(id, '/tareas?limit=7&qa_marker=a%2Bb', { channel });
      assert.equal(valid.status, 200, JSON.stringify(valid.body));
      assert.equal((await signed(id, '/tareas?limit=7&qa_marker=a%2Bb', {
        channel, changedQuery: '?limit=8&qa_marker=a%2Bb',
      })).status, 401);
      for (const signatureVersion of ['1', '', null]) {
        const rejected = await signed(id, `/tareas/${taskId}`, { channel, signatureVersion });
        assert.equal(rejected.status, 401, `Version ${JSON.stringify(signatureVersion)} must not authenticate ${channel}`);
      }
    }
  });
  await t.test('same-name account cannot read, list, edit or review another ID-bound task', async () => {
    const own = await signed(actor.owner, `/tareas/${taskId}`);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.task.id, taskId);
    denied(await signed(actor.impostor, `/tareas/${taskId}`));
    const list = await signed(actor.impostor, '/tareas');
    assert.equal(list.status, 200);
    assert.ok(list.body.tasks.some(task => task.id === foreignId));
    assert.ok(!list.body.tasks.some(task => task.id === taskId));
    const before = await snapshot(taskId);
    denied(await edit(actor.impostor, taskId, 'Homonym must not edit'));
    denied(await signed(actor.impostor, '/lotes/revision/previsualizar', { method: 'POST', body: { task_ids: [taskId] } }));
    assert.deepEqual(await snapshot(taskId), before);
    const written = await edit(actor.owner, taskId, 'QA Wilson owner edited');
    assert.equal(written.status, 200, JSON.stringify(written.body));
    assert.equal((await snapshot(taskId))[0].titulo, 'QA Wilson owner edited');
  });
  await t.test('allowed group does not bypass ID membership or unlinked identity denial', async () => {
    const before = await snapshot(taskId);
    denied(await signed(actor.impostor, `/tareas/${taskId}`, { groupId: group }));
    denied(await edit(actor.impostor, taskId, 'Group bypass must fail', { groupId: group }));
    denied(await signed(actor.impostor, '/lotes/revision/previsualizar', { groupId: group, method: 'POST', body: { task_ids: [taskId] } }));
    denied(await signed(actor.unlinked, `/tareas/${taskId}`, { groupId: group }));
    const list = await signed(actor.impostor, '/tareas', { groupId: group });
    assert.equal(list.status, 200);
    assert.ok(!list.body.tasks.some(task => task.id === taskId));
    assert.deepEqual(await snapshot(taskId), before);
  });
  await t.test('supervisor employee context uses stable owner IDs, not shared names; tick stays system-only', async () => {
    const ownerContext = await signed(actor.owner, '/supervisor/contexto');
    assert.equal(ownerContext.status, 200, JSON.stringify(ownerContext.body));
    assert.equal(ownerContext.body.scope, 'employee');
    assert.ok(ownerContext.body.tasks.some(task => task.id === taskId));
    assert.ok(!ownerContext.body.tasks.some(task => task.id === foreignId));
    const impostorContext = await signed(actor.impostor, '/supervisor/contexto');
    assert.equal(impostorContext.status, 200, JSON.stringify(impostorContext.body));
    assert.equal(impostorContext.body.scope, 'employee');
    assert.ok(impostorContext.body.tasks.some(task => task.id === foreignId));
    assert.ok(!impostorContext.body.tasks.some(task => task.id === taskId));
    denied(await signed(actor.owner, '/supervisor/tick', { method: 'POST', body: { dry_run: true } }));
  });
  await t.test('inactive, disabled and ambiguous WhatsApp links fail closed', async () => {
    for (const id of [actor.inactive, actor.ambiguousA, actor.unlinked])
      denied(await signed(id, `/tareas/${taskId}`));
    await fixture.query('UPDATE usuarios SET whatsapp_habilitado=false WHERE id=$1', [user.collaborator]);
    try { denied(await signed(actor.collaborator, `/tareas/${taskId}`)); }
    finally { await fixture.query('UPDATE usuarios SET whatsapp_habilitado=true WHERE id=$1', [user.collaborator]); }
  });
  await t.test('revoked collaborator stays denied despite old JSON, including pending review confirmation', async () => {
    const id = await newTask('QA Wilson revoke during review', user.owner, [user.collaborator]);
    assert.equal((await signed(actor.collaborator, `/tareas/${id}`)).status, 200);
    const preview = await signed(actor.collaborator, '/lotes/revision/previsualizar', { method: 'POST', body: { task_ids: [id] } });
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    await fixture.query("DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2 AND tipo='colaborador'", [id, user.collaborator]);
    const before = await snapshot(id);
    assert.deepEqual(before[0].propiedades_extra.colaboradores, ['QA Wilson collaborator']);
    denied(await signed(actor.collaborator, `/tareas/${id}`));
    const context = await signed(actor.collaborator, '/supervisor/contexto');
    assert.equal(context.status, 200, JSON.stringify(context.body));
    assert.ok(!context.body.tasks.some(task => task.id === id), 'Supervisor must not restore revoked membership from JSON');
    denied(await edit(actor.collaborator, id, 'Revoked edit denied'));
    denied(await signed(actor.collaborator, '/lotes/revision/previsualizar', { method: 'POST', body: { task_ids: [id] } }));
    const confirmed = await signed(actor.collaborator, '/lotes/revision/confirmar', { method: 'POST', body: { confirmacion_token: preview.body.confirmacion_token } });
    assert.ok([403, 404, 409].includes(confirmed.status), JSON.stringify(confirmed));
    assert.deepEqual(await snapshot(id), before);
  });
  await t.test('owner can preview and confirm actual review transition', async () => {
    const id = await newTask('QA Wilson actual review');
    const preview = await signed(actor.owner, '/lotes/revision/previsualizar', { method: 'POST', body: { task_ids: [id] } });
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    const confirmed = await signed(actor.owner, '/lotes/revision/confirmar', { method: 'POST', body: { confirmacion_token: preview.body.confirmacion_token } });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal((await snapshot(id))[0].estado, 'en_revision');
  });
  await t.test('Telegram is denied without binding; explicit mapping scopes detail, list and write by ID', async () => {
    denied(await signed('qa-tg-unmapped', `/tareas/${taskId}`, { channel: 'telegram', actorName: 'Agustín' }));
    const own = await signed('qa-tg-owner', `/tareas/${taskId}`, { channel: 'telegram' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    denied(await signed('qa-tg-owner', `/tareas/${foreignId}`, { channel: 'telegram' }));
    const list = await signed('qa-tg-owner', '/tareas', { channel: 'telegram' });
    assert.equal(list.status, 200);
    assert.ok(list.body.tasks.some(task => task.id === taskId));
    assert.ok(!list.body.tasks.some(task => task.id === foreignId));
    const written = await edit('qa-tg-owner', taskId, 'QA Telegram mapped owner edit', { channel: 'telegram' });
    assert.equal(written.status, 200, JSON.stringify(written.body));
  });
  await t.test('admin authority comes from current DB role, not signed actor name or Telegram defaults', async () => {
    for (const [id, channel] of [[actor.admin, 'whatsapp'], ['qa-tg-admin', 'telegram']])
      assert.equal((await signed(id, `/tareas/${taskId}`, { channel })).status, 200);
    await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=91001");
    try {
      for (const [id, channel] of [[actor.admin, 'whatsapp'], ['qa-tg-admin', 'telegram']]) {
        denied(await signed(id, `/tareas/${taskId}`, { channel, actorName: 'Franco' }));
        denied(await edit(id, taskId, 'Stale admin authority denied', { channel }));
      }
    } finally { await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91001"); }
  });
  await t.test('renamed owner can PATCH through stable external and task IDs despite historical task labels', async () => {
    const before = (await snapshot(taskId))[0];
    assert.equal(before.asignado_a, 'QA Wilson Shared');
    await fixture.query("UPDATE usuarios SET nombre='QA Wilson Renamed Owner' WHERE id=$1", [user.owner]);
    try {
      for (const [id, channel] of [[actor.owner, 'whatsapp'], ['qa-tg-owner', 'telegram']]) {
        const own = await signed(id, `/tareas/${taskId}`, { channel, actorName: 'Stale signed label' });
        assert.equal(own.status, 200, JSON.stringify(own.body));
        const written = await edit(id, taskId, `QA renamed owner edited via ${channel}`, { channel, actorName: 'Stale signed label' });
        assert.equal(written.status, 200, JSON.stringify(written.body));
        assert.equal((await snapshot(taskId))[0].titulo, `QA renamed owner edited via ${channel}`);
        assert.deepEqual(await fixture.query("SELECT usuario_id FROM tarea_asignaciones WHERE tarea_id=$1 AND tipo='responsable'", [taskId]),
          [{ usuario_id: user.owner }]);
      }
      const current = await snapshot(taskId);
      denied(await edit(actor.impostor, taskId, 'Old name does not inherit ownership'));
      assert.deepEqual(await snapshot(taskId), current);
    } finally { await fixture.query("UPDATE usuarios SET nombre='QA Wilson Shared' WHERE id=$1", [user.owner]); }
  });
});
