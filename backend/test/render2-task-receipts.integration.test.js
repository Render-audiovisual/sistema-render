import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const operations = ['crear', 'editar', 'archivar', 'eliminar'];
const fields = ['titulo', 'asignado_a', 'colaboradores', 'cliente_id', 'fecha_vencimiento', 'tipo_tarea',
  'subtipo', 'prioridad', 'aclaraciones', 'material_referencia', 'referencia', 'produccion_videos_previstos', 'asignado_a_id', 'colaborador_ids'];

test('Wilson task receipts: four confirmed operations, current ACL and atomic durable outcomes', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const users = { owner: 103001, homonym: 103002, collaborator: 103003, group: 103004, admin: 91001 };
  const actors = Object.fromEntries(Object.keys(users).map(name => [name, `qa-task-receipt-${name}`]));
  const group = 'qa-task-receipt-group';
  const fixture = await startLocalHarness({ port: 55606, deferTaskReceiptsMigration: true, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    allowedWhatsappIds: [actors.owner, actors.homonym, actors.collaborator, actors.admin].join(','),
    allowedWhatsappGroups: group,
    telegramUserBindings: JSON.stringify({ 'qa-task-tg-admin': users.admin, 'qa-task-tg-owner': users.owner }),
    allowedTelegramIds: 'qa-task-tg-admin,qa-task-tg-owner',
  } });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own task-receipts fixture stopped and removed: ${fixture.root}`);
  });
  const ok = (result, statuses = [200]) => {
    assert.ok(statuses.includes(result.status), `${result.status}: ${JSON.stringify(result.body)}`);
    return result.body;
  };
  const signed = async (route, body, { actor = 'admin', channel = 'whatsapp', method = 'POST', groupId = '', headerKey } = {}) => {
    const actorId = channel === 'telegram' ? `qa-task-tg-${actor}` : actors[actor];
    const url = new URL(`/api/integraciones/wilson${route}`, fixture.base);
    const timestamp = String(Math.floor(Date.now() / 1000)); const nonce = crypto.randomUUID();
    const message = ['v2', timestamp, nonce, channel, actorId, groupId, 'Untrusted task display name', method,
      `${url.pathname}${url.search}`, sha(body === undefined ? '' : canonical(body))].join('\n');
    const response = await fetch(url, { method, signal: AbortSignal.timeout(6000), headers: {
      'x-wilson-signature-version': '2', 'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce,
      'x-wilson-channel': channel, 'x-wilson-actor-id': actorId, 'x-wilson-actor-name': 'Untrusted task display name',
      'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64'),
      ...(groupId ? { 'x-wilson-group-id': groupId } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headerKey === undefined ? {} : { 'idempotency-key': headerKey }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  for (const [name, id] of Object.entries(users)) {
    if (name === 'admin') {
      await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=$2', [sha(actors[name]), id]);
    } else await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,whatsapp_id_hash,whatsapp_habilitado)
      SELECT $1,$2,$3,'edicion',password_hash,true,1,$4,true FROM usuarios WHERE id=91004`,
    [id, `qa_task_${name}`, ['owner', 'homonym'].includes(name) ? 'QA Task Shared Name' : `QA Task ${name}`, sha(actors[name])]);
  }
  const login = async name => ok(await request(fixture.base, '/api/login', { method: 'POST',
    body: { usuario: name, password: fixturePassword } })).token;
  const adminToken = await login('qa_franco'); const ownerToken = await login('qa_task_owner');
  const browser = (route, body, method = 'PATCH', token = adminToken) => request(fixture.base, `/api${route}`, { method, token, body });
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA task receipt client') RETURNING id");
  let serial = 0;
  const seed = async (ownerId = users.owner) => {
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,fecha_vencimiento,aclaraciones,propiedades_extra)
      VALUES ($1,'QA Task Shared Name',$2,'pendiente','edicion','video','2026-10-25','QA initial description',
        '{"workspace":"render_os","colaboradores":["QA Task collaborator"],"wilson_idempotency_key":"qa-legacy-task-key","wilson_last_update_key":"qa-legacy-edit-key"}') RETURNING *`,
    [`QA task fixture ${++serial}`, client.id]);
    await fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
      VALUES ($1,$2,'responsable'),($1,$3,'colaborador')`, [task.id, ownerId, users.collaborator]);
    return task;
  };
  const historical = await seed();
  await fixture.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,tarea_id,detalles)
    VALUES ('wilson','whatsapp',$1,'QA legacy','qa_history',$2,'{"unchanged":true}')`, [actors.owner, historical.id]);
  await fixture.query(`INSERT INTO integracion_confirmaciones(token,integracion,canal,actor_id,grupo_id,operacion,tarea_id,payload_hash,expires_at)
    VALUES ('00000000-0000-4000-8000-000000055606','wilson','whatsapp',$1,'','editar',$2,$3,'2099-01-01')`, [actors.owner, historical.id, 'a'.repeat(64)]);
  await fixture.query(`INSERT INTO mia_private_task_notifications(fingerprint,destinatario,destinatario_clave,tarea_id,motivo,mensaje,tarea_url)
    VALUES ('qa-task-historical-notification','QA Task Shared Name','qa_task_owner',$1,'creada','QA historical','https://example.invalid/qa')`, [historical.id]);
  const baseTables = ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', 'integracion_confirmaciones', 'integracion_auditoria',
    'mia_private_task_notifications', 'produccion_visitas', 'produccion_visita_participantes', 'produccion_videos', 'produccion_fotos',
    'publicaciones', 'historias', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'];
  const snapshot = async (receipts = true) => {
    const result = {};
    for (const table of [...baseTables, ...(receipts ? ['task_operation_receipts'] : [])])
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  await t.test('062 preserves populated principal history, including editable legacy replay poison', async () => {
    assert.deepEqual(await fixture.query("SELECT nombre FROM public._migrations WHERE nombre='062_task_operation_receipts.sql'"), []);
    assert.deepEqual(await fixture.query("SELECT to_regclass('public.task_operation_receipts') AS relation"), [{ relation: null }]);
    const before = await snapshot(false);
    await fixture.query(await readFile(new URL('../migrations/062_task_operation_receipts.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await snapshot(false), before);
    assert.deepEqual(await fixture.query('SELECT * FROM task_operation_receipts'), []);
    const columns = await fixture.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='task_operation_receipts' ORDER BY column_name`);
    assert.deepEqual(columns.map(row => row.column_name), ['id', 'actor_user_id', 'operation', 'idempotency_key', 'payload_hash',
      'task_id', 'task_revision', 'outcome', 'changed_fields', 'committed_at'].sort());
    await fixture.query("INSERT INTO public._migrations(nombre) VALUES ('062_task_operation_receipts.sql')");
  });
  const get = async (id, options = {}, archived = false) => ok(await signed(`/tareas/${id}${archived ? '?include_archived=true' : ''}`,
    undefined, { ...options, method: 'GET' })).task;
  const revision = async id => (await fixture.query('SELECT revision FROM tareas WHERE id=$1', [id]))[0].revision;
  const key = () => crypto.randomUUID();
  const createBody = (overrides = {}) => ({ idempotency_key: key(), titulo: `QA confirmed task ${++serial}`, cliente_id: client.id,
    asignado_a_id: users.owner, colaborador_ids: [], sector: 'edicion', subtipo: 'video', fecha_vencimiento: '2026-10-25',
    descripcion: 'QA confirmed description', permitir_duplicado: true, ...overrides });
  const body = async (operation, id, extra = {}) => {
    if (operation === 'crear') return createBody(extra);
    const observed = await get(id, {}, operation === 'eliminar');
    assert.ok(Number.isSafeInteger(observed.revision) && observed.revision > 0);
    return { idempotency_key: key(), expected_revision: observed.revision, ...extra };
  };
  const confirm = async (operation, payload, id, options = {}) => ok(await signed('/confirmaciones', {
    operacion: operation, ...(id ? { tarea_id: id } : {}), payload,
  }, { ...options, headerKey: payload.idempotency_key }), [201]).confirmacion_token;
  const send = (operation, payload, token, id, options = {}) => signed(operation === 'crear' ? '/tareas'
    : `/tareas/${id}${operation === 'archivar' ? '/archivar' : ''}`, { ...payload,
    ...(token === undefined ? {} : { confirmacion_token: token }) }, {
    ...options, method: operation === 'editar' ? 'PATCH' : operation === 'eliminar' ? 'DELETE' : 'POST',
    headerKey: Object.hasOwn(options, 'headerKey') ? options.headerKey : payload.idempotency_key,
  });
  const execute = async (operation, payload, id, options = {}) => {
    const token = await confirm(operation, payload, id, options);
    return { token, result: ok(await send(operation, payload, token, id, options), operation === 'crear' ? [201] : [200]) };
  };
  const receiptShape = (value, operation, id) => {
    assert.deepEqual(Object.keys(value).sort(), ['operation', 'task_id', 'task_revision', 'outcome', 'changed_fields', 'committed_at'].sort());
    assert.equal(value.operation, operation); assert.equal(Number(value.task_id), Number(id));
    assert.ok(Number.isSafeInteger(value.task_revision) && value.task_revision > 0);
    assert.ok(['created', 'updated', 'unchanged', 'archived', 'deleted'].includes(value.outcome));
    assert.ok(Array.isArray(value.changed_fields) && value.changed_fields.every(field => fields.includes(field)));
    assert.ok(Number.isFinite(Date.parse(value.committed_at)));
  };
  const replay = async (operation, payload, id, options = {}) => {
    const result = ok(await send(operation, payload, undefined, id, options));
    assert.equal(result.idempotent, true);
    assert.equal(result[{ crear: 'created', editar: 'updated', archivar: 'archived', eliminar: 'deleted' }[operation]], false);
    assert.equal(Number(result.task_id), Number(id)); receiptShape(result.receipt, operation, id);
    return result;
  };
  const created = async (overrides = {}, options = {}) => {
    const payload = createBody(overrides); const saved = await execute('crear', payload, null, options);
    return { ...saved, payload, id: saved.result.task.id };
  };
  const archive = async (id, options = {}) => {
    const payload = await body('archivar', id); return { payload, ...await execute('archivar', payload, id, options) };
  };

  await t.test('all four operations use exact tokens in WhatsApp and Telegram and return durable minimal outcomes', async () => {
    for (const channel of ['whatsapp', 'telegram']) {
      const options = { channel };
      const first = createBody();
      assert.equal((await send('crear', first, undefined, null, options)).status, 400);
      const creation = await execute('crear', first, null, options); const id = creation.result.task.id;
      receiptShape(creation.result.receipt, 'crear', id); assert.equal(creation.result.receipt.outcome, 'created');
      const edit = await body('editar', id, { titulo: `QA edited ${++serial}` });
      assert.equal((await send('editar', edit, undefined, id, options)).status, 400);
      const edited = await execute('editar', edit, id, options); receiptShape(edited.result.receipt, 'editar', id);
      assert.equal((await send('archivar', await body('archivar', id), undefined, id, options)).status, 400);
      const archived = await archive(id, options); receiptShape(archived.result.receipt, 'archivar', id);
      const archivedReplay = await replay('archivar', archived.payload, id, options);
      assert.equal(archivedReplay.archived, false); assert.equal(archivedReplay.task_archived, true); assert.equal(archivedReplay.task, null);
      assert.equal((await signed(`/tareas/${id}?include_archived=true`, undefined, { actor: 'owner', channel, method: 'GET' })).status, 403);
      const archivedTask = await get(id, options, true); assert.ok(archivedTask.revision > 0);
      const purge = await body('eliminar', id); const preDelete = purge.expected_revision;
      assert.equal((await send('eliminar', purge, undefined, id, options)).status, 400);
      const removed = await execute('eliminar', purge, id, options);
      receiptShape(removed.result.receipt, 'eliminar', id); assert.equal(removed.result.receipt.task_revision, preDelete);
      const before = await snapshot();
      for (const [operation, payload] of [['crear', first], ['editar', edit], ['archivar', archived.payload], ['eliminar', purge]]) {
        const retried = await replay(operation, payload, id, options);
        assert.equal(retried.task, null); assert.equal(retried.task_deleted, true);
      }
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('receipt scopes bind actor, key, operation, target and canonical hash rather than legacy JSON', async () => {
    const saved = await created({ idempotency_key: 'qa-legacy-task-key' }, { actor: 'owner' });
    assert.notEqual(Number(saved.id), Number(historical.id));
    const before = await snapshot();
    await replay('crear', saved.payload, saved.id, { actor: 'owner' });
    assert.deepEqual(await snapshot(), before);
    assert.equal((await send('crear', { ...saved.payload, titulo: 'QA changed hash' }, undefined, null, { actor: 'owner' })).status, 409);
    const other = await created({ ...saved.payload, asignado_a_id: users.homonym }, { actor: 'homonym' });
    assert.notEqual(Number(other.id), Number(saved.id));
    const edit = await body('editar', saved.id, { idempotency_key: saved.payload.idempotency_key, titulo: 'QA operation scoped' });
    await execute('editar', edit, saved.id, { actor: 'owner' });
    assert.equal((await send('editar', edit, undefined, historical.id, { actor: 'owner' })).status, 409);
    const legacyEdit = await body('editar', historical.id, { idempotency_key: 'qa-legacy-edit-key', titulo: 'QA old JSON is not receipt' });
    assert.equal((await send('editar', legacyEdit, undefined, historical.id, { actor: 'owner' })).status, 400);
  });
  await t.test('no-op consumes exact token and writes one unchanged receipt/audit without UPDATE or notification', async () => {
    const saved = await created(); const current = await get(saved.id);
    const payload = await body('editar', saved.id, { titulo: current.titulo });
    const beforeTask = await fixture.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1', [saved.id]);
    const beforeQueue = await fixture.query('SELECT to_jsonb(n) AS row FROM mia_private_task_notifications n WHERE tarea_id=$1 ORDER BY id', [saved.id]);
    const result = await execute('editar', payload, saved.id);
    assert.equal(result.result.receipt.outcome, 'unchanged'); assert.deepEqual(result.result.receipt.changed_fields, []);
    assert.equal(result.result.receipt.task_revision, current.revision);
    assert.deepEqual(await fixture.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1', [saved.id]), beforeTask);
    assert.deepEqual(await fixture.query('SELECT to_jsonb(n) AS row FROM mia_private_task_notifications n WHERE tarea_id=$1 ORDER BY id', [saved.id]), beforeQueue);
    assert.ok((await fixture.query('SELECT used_at FROM integracion_confirmaciones WHERE token=$1', [result.token]))[0].used_at);
    assert.equal((await fixture.query("SELECT id FROM integracion_auditoria WHERE tarea_id=$1 AND accion='editar_tarea'", [saved.id])).length, 1);
    const before = await snapshot(); await replay('editar', payload, saved.id); assert.deepEqual(await snapshot(), before);
  });
  await t.test('concurrent create/retry and CAS edits produce one mutation; append replays never append again', async () => {
    const payload = createBody(); const tokens = await Promise.all([confirm('crear', payload), confirm('crear', payload)]);
    const creations = await Promise.all(tokens.map(token => send('crear', payload, token)));
    assert.deepEqual(creations.map(r => r.status).sort(), [200, 201]);
    const id = creations.find(r => r.status === 201).body.task.id;
    assert.equal((await fixture.query('SELECT id FROM task_operation_receipts WHERE operation=$1 AND idempotency_key=$2', ['crear', payload.idempotency_key])).length, 1);
    assert.equal((await fixture.query('SELECT token FROM integracion_confirmaciones WHERE token=ANY($1::uuid[]) AND used_at IS NOT NULL', [tokens])).length, 1);
    assert.equal((await fixture.query("SELECT id FROM integracion_auditoria WHERE tarea_id=$1 AND accion='crear_tarea'", [id])).length, 1);
    assert.equal((await fixture.query('SELECT id FROM mia_private_task_notifications WHERE tarea_id=$1', [id])).length, 1);
    const a = await body('editar', id, { append_descripcion: 'QA append exactly once' });
    const b = { idempotency_key: key(), expected_revision: a.expected_revision, titulo: 'QA competing CAS' };
    const editTokens = await Promise.all([confirm('editar', a, id), confirm('editar', b, id)]);
    const edits = await Promise.all([send('editar', a, editTokens[0], id), send('editar', b, editTokens[1], id)]);
    assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
    assert.equal((await fixture.query('SELECT token FROM integracion_confirmaciones WHERE token=ANY($1::uuid[]) AND used_at IS NOT NULL', [editTokens])).length, 1);
    assert.equal(await revision(id), a.expected_revision + 1);
    const appendPayload = edits[0].status === 200 ? a : await body('editar', id, { append_descripcion: 'QA append exactly once' });
    if (edits[0].status !== 200) await execute('editar', appendPayload, id);
    const later = await body('editar', id, { titulo: 'QA later edit after append' }); await execute('editar', later, id);
    const before = await snapshot(); const retried = await replay('editar', appendPayload, id);
    assert.equal(retried.result_current, true); assert.equal(retried.task.titulo, later.titulo);
    assert.equal((retried.task.aclaraciones.match(/QA append exactly once/g) || []).length, 1);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('current membership, workspace, mapping, role, group and delete-admin policy precede receipt replay', async () => {
    const saved = await created({}, { actor: 'owner' });
    const beforeActorDelete = await snapshot();
    const actorDelete = await browser(`/usuarios/${users.owner}`, undefined, 'DELETE');
    assert.equal(actorDelete.status, 409); assert.match(actorDelete.body.error, /desactiv/i);
    assert.deepEqual(await snapshot(), beforeActorDelete);
    await fixture.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2', [saved.id, users.owner]);
    const deniedSnapshot = await snapshot();
    assert.equal((await send('crear', saved.payload, undefined, null, { actor: 'owner' })).status, 403);
    assert.deepEqual(await snapshot(), deniedSnapshot);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [saved.id, users.owner]);
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra || '{"workspace":"private"}'::jsonb WHERE id=$1`, [saved.id]);
    assert.equal((await send('crear', saved.payload, undefined, null, { actor: 'owner' })).status, 403);
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra || '{"workspace":"render_os"}'::jsonb WHERE id=$1`, [saved.id]);
    for (const [column, value, restored] of [['activo', false, true], ['rol', 'qa_unknown', 'edicion'], ['whatsapp_habilitado', false, true]]) {
      await fixture.query(`UPDATE usuarios SET ${column}=$1 WHERE id=$2`, [value, users.owner]);
      try { const before = await snapshot(); assert.equal((await send('crear', saved.payload, undefined, null, { actor: 'owner' })).status, 403); assert.deepEqual(await snapshot(), before); }
      finally { await fixture.query(`UPDATE usuarios SET ${column}=$1 WHERE id=$2`, [restored, users.owner]); }
    }
    const groupOptions = { actor: 'group', groupId: group };
    const groupCreate = await created({ asignado_a_id: users.group }, groupOptions);
    const groupEdit = await body('editar', groupCreate.id, { titulo: 'QA group restricted edit' });
    const beforeGroup = await snapshot();
    assert.equal((await signed('/confirmaciones', { operacion: 'editar', tarea_id: groupCreate.id, payload: groupEdit },
      { ...groupOptions, headerKey: groupEdit.idempotency_key })).status, 403);
    assert.equal((await send('editar', groupEdit, undefined, groupCreate.id, groupOptions)).status, 403);
    assert.deepEqual(await snapshot(), beforeGroup);
    const purged = await created(); await archive(purged.id); const purgeBody = await body('eliminar', purged.id); await execute('eliminar', purgeBody, purged.id);
    await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=91001");
    try { assert.equal((await send('eliminar', purgeBody, undefined, purged.id)).status, 403); }
    finally { await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91001"); }
  });
  await t.test('ID notifications distinguish homonyms, exclude actor by ID, and never regrant removed recipients', async () => {
    // Existing non-admin assignment restrictions are intentional. Temporarily
    // elevate this synthetic actor only for this notification-specific case,
    // retaining the same ID/name as the assigned owner and homonym recipient.
    await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=$1", [users.owner]);
    try {
    const saved = await created({ asignado_a_id: users.owner, colaborador_ids: [users.homonym] }, { actor: 'owner' });
    const queue = await fixture.query('SELECT destinatario_clave FROM mia_private_task_notifications WHERE tarea_id=$1 ORDER BY destinatario_clave', [saved.id]);
    assert.deepEqual(queue, [{ destinatario_clave: 'qa_task_homonym' }]);
    const edit = await body('editar', saved.id, { colaborador_ids: [users.collaborator] }); await execute('editar', edit, saved.id, { actor: 'owner' });
    const queueAfter = await fixture.query('SELECT destinatario_clave FROM mia_private_task_notifications WHERE tarea_id=$1 ORDER BY id', [saved.id]);
    assert.deepEqual(queueAfter, [{ destinatario_clave: 'qa_task_homonym' }, { destinatario_clave: 'qa_task_collaborator' }]);
    const before = await snapshot(); await replay('crear', saved.payload, saved.id, { actor: 'owner' }); await replay('editar', edit, saved.id, { actor: 'owner' });
    assert.deepEqual(await snapshot(), before);
    assert.equal((await fixture.query('SELECT usuario_id FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2', [saved.id, users.homonym])).length, 0);
    } finally {
      await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=$1", [users.owner]);
    }
  });
  await t.test('confirmation binds actor/key/intent/selection and rejects legacy tokens and stale CAS', async () => {
    const payload = createBody(); const token = await confirm('crear', payload);
    for (const [changed, options] of [[payload, { actor: 'owner' }], [{ ...payload, idempotency_key: key() }, {}], [{ ...payload, asignado_a_id: users.homonym }, {}]]) {
      const before = await snapshot(); assert.ok([400, 403, 409].includes((await send('crear', changed, token, null, options)).status)); assert.deepEqual(await snapshot(), before);
    }
    ok(await send('crear', payload, token), [201]);
    const labelPayload = createBody({ responsable: 'qa_task_owner' }); delete labelPayload.asignado_a_id;
    const labelToken = await confirm('crear', labelPayload);
    await fixture.query("UPDATE usuarios SET usuario='qa_task_owner_renamed' WHERE id=$1", [users.owner]);
    await fixture.query("UPDATE usuarios SET usuario='qa_task_owner' WHERE id=$1", [users.homonym]);
    try { const before = await snapshot(); assert.equal((await send('crear', labelPayload, labelToken)).status, 409); assert.deepEqual(await snapshot(), before); }
    finally {
      await fixture.query("UPDATE usuarios SET usuario='qa_task_homonym' WHERE id=$1", [users.homonym]);
      await fixture.query("UPDATE usuarios SET usuario='qa_task_owner' WHERE id=$1", [users.owner]);
    }
    const saved = await created();
    const stale = await body('editar', saved.id, { titulo: 'QA stale task edit' }); const staleToken = await confirm('editar', stale, saved.id);
    await fixture.query("UPDATE tareas SET titulo='QA concurrent newer title' WHERE id=$1", [saved.id]);
    const before = await snapshot(); assert.equal((await send('editar', stale, staleToken, saved.id)).status, 409); assert.deepEqual(await snapshot(), before);
    assert.ok([400, 409].includes((await send('editar', await body('editar', historical.id, { titulo: 'QA old token' }), '00000000-0000-4000-8000-000000055606', historical.id)).status));
    for (const operation of ['archivar', 'eliminar']) {
      const target = await created();
      if (operation === 'eliminar') await archive(target.id);
      const payload = await body(operation, target.id); const token = await confirm(operation, payload, target.id);
      await fixture.query('UPDATE tareas SET titulo=titulo WHERE id=$1', [target.id]);
      const beforeStale = await snapshot();
      assert.equal((await send(operation, payload, token, target.id)).status, 409); assert.deepEqual(await snapshot(), beforeStale);
    }
  });
  await t.test('production visit POST sync and restrictive source deletion remain inside receipt transaction', async () => {
    const saved = await created({ titulo: 'QA visita task receipt', sector: 'produccion', subtipo: 'visita', produccion_videos_previstos: 3 });
    const visits = await fixture.query('SELECT * FROM produccion_visitas WHERE tarea_origen_id=$1', [saved.id]);
    assert.equal(visits.length, 1);
    assert.deepEqual(await fixture.query('SELECT * FROM produccion_videos WHERE visita_id=$1', [visits[0].id]), []);
    const beforeReplay = await snapshot(); await replay('crear', saved.payload, saved.id); assert.deepEqual(await snapshot(), beforeReplay);
    const media = ok(await browser(`/producciones/${visits[0].id}/videos`, { expected_revision: visits[0].revision,
      titulo: 'QA real individual record', estado: 'grabado', guion: 'QA individual script' }, 'POST'), [201]);
    assert.equal(media.visita.videos.length, 1);
    await archive(saved.id);
    const payload = await body('eliminar', saved.id); const token = await confirm('eliminar', payload, saved.id);
    const beforeDelete = await snapshot(); assert.equal((await send('eliminar', payload, token, saved.id)).status, 409); assert.deepEqual(await snapshot(), beforeDelete);
  });
  await t.test('task token expiry is checked after task, token, linked visit and publication lock waits', async () => {
    const poll = async predicate => {
      const deadline = Date.now() + 650;
      while (Date.now() < deadline) {
        const found = await predicate(); if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.fail('Expected PostgreSQL lock barrier not observed within bound');
    };
    for (const target of ['task', 'token', 'visit', 'publication']) {
      const saved = await created(target === 'visit' ? { titulo: 'QA visita expiry source', sector: 'produccion', subtipo: 'visita', produccion_videos_previstos: 3 } : {});
      const id = Number(saved.id); assert.ok(Number.isSafeInteger(id));
      let relationId;
      if (target === 'visit') {
        const visits = await fixture.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [id]);
        assert.equal(visits.length, 1); relationId = visits[0].id; assert.match(relationId, /^[0-9a-f-]{36}$/i);
      } else if (target === 'publication') {
        const [publication] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy)
          VALUES ($1,'video','pendiente','2026-10-29','QA preserved editorial copy') RETURNING id`, [client.id]);
        relationId = Number(publication.id); assert.ok(Number.isSafeInteger(relationId));
        await fixture.query('UPDATE tareas SET publicacion_id=$1 WHERE id=$2', [relationId, id]);
      }
      const payload = await body('editar', id, { descripcion: 'QA allowed content edit expires behind related lock' });
      const token = await confirm('editar', payload, id);
      assert.match(token, /^[0-9a-f-]{36}$/i);
      await fixture.query("UPDATE integracion_confirmaciones SET expires_at=clock_timestamp()+interval '0.8 seconds' WHERE token=$1", [token]);
      const marker = `qa_task_expiry_${key().replaceAll('-', '')}`;
      const hold = target === 'task' ? `UPDATE tareas SET titulo=titulo WHERE id=${id}`
        : target === 'token' ? `SELECT token FROM integracion_confirmaciones WHERE token='${token}'::uuid FOR UPDATE`
          : target === 'visit' ? `SELECT id FROM produccion_visitas WHERE id='${relationId}'::uuid FOR UPDATE`
            : `SELECT id FROM publicaciones WHERE id=${relationId} FOR UPDATE`;
      const lockedTable = { task: 'tareas', token: 'integracion_confirmaciones', visit: 'produccion_visitas', publication: 'publicaciones' }[target];
      const blocker = fixture.query(`/* ${marker} */ BEGIN; ${hold}; SELECT pg_sleep(1.5); ROLLBACK;`)
        .then(value => ({ value }), error => ({ error }));
      let operation;
      try {
        await poll(async () => (await fixture.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND position($1 in query)>0 AND wait_event='PgSleep'`, [marker])).length > 0);
        const before = await snapshot(); operation = send('editar', payload, token, id);
        const waiting = await poll(async () => (await fixture.query(`SELECT a.xact_start<c.expires_at AS began_before_expiry,
          clock_timestamp()<c.expires_at AS observed_before_expiry FROM pg_stat_activity a CROSS JOIN integracion_confirmaciones c
          WHERE c.token=$1 AND a.datname=current_database() AND a.pid<>pg_backend_pid()
          AND a.wait_event_type='Lock' AND a.query ILIKE $2 LIMIT 1`, [token, `%${lockedTable}%`]))[0]);
        assert.equal(waiting.began_before_expiry, true); assert.equal(waiting.observed_before_expiry, true);
        assert.equal((await operation).status, 409);
        const stopped = await blocker; if (stopped.error) throw stopped.error;
        assert.deepEqual(await snapshot(), before);
        assert.equal((await fixture.query('SELECT used_at FROM integracion_confirmaciones WHERE token=$1', [token]))[0].used_at, null);
      } finally {
        const stopped = await blocker; if (operation) await operation; if (stopped.error) throw stopped.error;
      }
    }
  });
  await t.test('invalid keys, aliases, fields and missing CAS fail without mutating or consuming tokens', async () => {
    for (const invalid of ['', ' ', 'x'.repeat(201), 'has\ncontrol', 123, {}, []]) {
      const before = await snapshot(); const payload = createBody({ idempotency_key: invalid });
      // Deliberately malformed body key, not an invalid HTTP header that fetch
      // would reject locally before exercising server validation.
      assert.equal((await send('crear', payload, undefined, null, { headerKey: undefined })).status, 400); assert.deepEqual(await snapshot(), before);
    }
    for (const changes of [{ titulo: {} }, { unknown_business: true }, { sector: 'edicion', tipo_tarea: 'diseno' },
      { estado: 'finalizada' }, { propiedades_extra: { revision_aprobada: true } }]) {
      const before = await snapshot(); assert.equal((await send('crear', createBody(changes))).status, 400); assert.deepEqual(await snapshot(), before);
    }
    const beforeMismatch = await snapshot();
    assert.equal((await send('crear', createBody(), undefined, null, { headerKey: 'qa-mismatched-header' })).status, 400);
    assert.deepEqual(await snapshot(), beforeMismatch);
    const saved = await created();
    for (const operation of ['editar', 'archivar', 'eliminar']) {
      if (operation === 'eliminar') await archive(saved.id);
      const before = await snapshot();
      const withoutVersion = { idempotency_key: key(), ...(operation === 'editar' ? { titulo: 'QA missing CAS' } : {}) };
      assert.equal((await send(operation, withoutVersion, undefined, saved.id)).status, 400); assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('audit/receipt/notification faults roll back tokens, task bindings, visit sync and all side effects', async () => {
    for (const table of ['integracion_auditoria', 'task_operation_receipts', 'mia_private_task_notifications']) {
      const payload = createBody({ titulo: `QA visita rollback ${table}`, sector: 'produccion', subtipo: 'visita', produccion_videos_previstos: 3 });
      const token = await confirm('crear', payload);
      await fixture.query(`CREATE FUNCTION qa_task_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'QA task receipt injected failure' USING ERRCODE='XX000'; END $$;
        CREATE TRIGGER qa_task_receipt_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION qa_task_receipt_fail()`);
      try {
        const before = await snapshot(); assert.equal((await send('crear', payload, token)).status, 500); assert.deepEqual(await snapshot(), before);
      } finally { await fixture.query(`DROP TRIGGER qa_task_receipt_fail ON ${table}; DROP FUNCTION qa_task_receipt_fail()`); }
      const saved = ok(await send('crear', payload, token), [201]);
      assert.equal((await fixture.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [saved.task.id])).length, 1);
    }
    for (const operation of ['editar', 'archivar', 'eliminar']) {
      const tables = operation === 'editar' ? ['integracion_auditoria', 'task_operation_receipts', 'mia_private_task_notifications']
        : ['integracion_auditoria', 'task_operation_receipts'];
      for (const table of tables) {
        const saved = await created();
        if (operation === 'eliminar') await archive(saved.id);
        const payload = await body(operation, saved.id, operation === 'editar'
          ? { asignado_a_id: users.homonym, colaborador_ids: [users.collaborator] } : {});
        const token = await confirm(operation, payload, saved.id);
        await fixture.query(`CREATE FUNCTION qa_task_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'QA task mutation failure' USING ERRCODE='XX000'; END $$;
          CREATE TRIGGER qa_task_receipt_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION qa_task_receipt_fail()`);
        try {
          const before = await snapshot(); assert.equal((await send(operation, payload, token, saved.id)).status, 500);
          assert.deepEqual(await snapshot(), before);
        } finally { await fixture.query(`DROP TRIGGER qa_task_receipt_fail ON ${table}; DROP FUNCTION qa_task_receipt_fail()`); }
        ok(await send(operation, payload, token, saved.id));
        const after = await snapshot(); await replay(operation, payload, saved.id); assert.deepEqual(await snapshot(), after);
      }
    }
  });
  await t.test('browser reserved metadata cannot forge receipts; recommendation/current DTO follows ID access and privacy', async () => {
    const saved = await created();
    for (const reserved of ['wilson_idempotency_key', 'wilson_last_update_key', 'wilson_archive_key', 'wilson_future_field', 'origen_integracion']) for (const nested of [false, true]) {
      const marker = nested ? { propiedades_extra: { [reserved]: 'forged' } } : { [reserved]: 'forged' };
      const before = await snapshot();
      assert.equal((await browser(`/tareas/${saved.id}?workspace=render_os`, { expected_revision: await revision(saved.id), ...marker })).status, 400);
      assert.equal((await browser('/tareas', { titulo: 'QA forged browser task', workspace: 'render_os', asignado_a_id: users.owner,
        colaborador_ids: [], cliente_id: client.id, tipo_tarea: 'edicion', ...marker }, 'POST')).status, 400);
      assert.deepEqual(await snapshot(), before);
    }
    const poison = 'QA_TASK_RECEIPTS_PRIVATE_MONEY';
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra || $2::jsonb WHERE id=$1`, [saved.id,
      JSON.stringify({ arbitrary_finance: { importe: 917231.44, marker: poison } })]);
    const current = await get(saved.id, { actor: 'owner' });
    assert.ok(!JSON.stringify(current).includes(poison));
    assert.ok(Number.isSafeInteger(current.revision));
    const recommendations = ok(await browser('/tareas-recomendaciones', undefined, 'GET', ownerToken));
    assert.ok(recommendations.recommendations.some(task => task.id === saved.id));
    assert.ok(!JSON.stringify(recommendations).includes(poison));
    await fixture.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2', [saved.id, users.owner]);
    const revoked = ok(await browser('/tareas-recomendaciones', undefined, 'GET', ownerToken));
    assert.ok(!revoked.recommendations.some(task => task.id === saved.id));
  });
});
