import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity, request, fixturePassword } from '../scripts/render2-local-test.js';
import { buildWilsonSignatureMessage } from '../src/wilson-integration.js';

const MIGRATION = '20261027144706_editing_progress_unified_ledger.sql';
const PORT = 55991;
const OWNER = 119001, HOMONYM = 119002;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const checked = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body)); return response.body;
};

// Actual application mount, migration runner, signature-v2 and persistent PG.
// No synthetic DDL, direct writer invocation, local router mount or provider.
test('editing audit: signed mounted GET and canonical delivery lifecycle on owned PG55991', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  await access(new URL(`../migrations/${MIGRATION}`, import.meta.url));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const actor = 'qa-editing-audit-admin', editorActor = 'qa-editing-audit-editor', group = 'qa-editing-audit-group';
  const f = await startLocalHarness({ port: PORT, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    allowedWhatsappIds: `${actor},${editorActor}`, allowedWhatsappGroups: group,
  } });
  t.after(async () => {
    await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' });
    t.diagnostic('Owned audit PG55991/HTTP stopped and removed ENOENT; no production/provider.');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: PORT,
    url: `postgresql://render2_fixture@127.0.0.1:${PORT}/render2_local_test`, identity });
  assert.deepEqual(await f.query('SELECT nombre FROM _migrations WHERE nombre=$1', [MIGRATION]), [{ nombre: MIGRATION }]);
  assert.deepEqual(await f.query('SELECT * FROM public.progreso_edicion_entregas'), [], 'Runner must not infer deliveries');
  const triggerNames = await f.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='tareas'::regclass
    AND NOT tgisinternal AND tgname IN ('editing_progress_v1_task_projection','progreso_edicion_tarea_cambio') ORDER BY tgname`);
  assert.deepEqual(triggerNames, [{ tgname: 'editing_progress_v1_task_projection' }]);

  for (const id of [OWNER, HOMONYM]) await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,$2,'QA identical editor label','edicion',password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa_audit_${id}`]);
  await f.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=91001', [hash(actor)]);
  await f.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=$2', [hash(editorActor), OWNER]);
  const signed = async (query, { who = actor, groupId = '', signedQuery = query, signatureVersion = '2' } = {}) => {
    const url = new URL(`/api/integraciones/wilson/auditoria-edicion?${query}`, f.base);
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID();
    const message = buildWilsonSignatureMessage({ timestamp, nonce, channel: 'whatsapp', actorId: who,
      groupId, actorName: 'Untrusted leader claim', method: 'GET',
      path: `${url.pathname}?${signedQuery}`, body: undefined });
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: {
      'x-wilson-channel': 'whatsapp', 'x-wilson-actor-id': who, 'x-wilson-group-id': groupId,
      'x-wilson-actor-name': 'Untrusted leader claim', 'x-wilson-signature-version': signatureVersion,
      'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce,
      'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64'),
    } });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  const login = async usuario => checked(await request(f.base, '/api/login', {
    method: 'POST', body: { usuario, password: fixturePassword },
  })).token;
  const admin = await login('qa_franco'), owner = await login(`qa_audit_${OWNER}`), homonym = await login(`qa_audit_${HOMONYM}`);
  const api = (path, token = admin, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const [period] = await f.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires','YYYY-MM') AS month`);
  const query = `periodo=${period.month}&editor_id=${OWNER}`;
  const historyQuery = `periodo=${period.month}`;
  const audit = async (selector = query) => checked(await signed(selector));
  const row = async id => (await f.query('SELECT * FROM tareas WHERE id=$1', [id]))[0];
  const ledger = async id => (await f.query('SELECT * FROM progreso_edicion_entregas WHERE tarea_id=$1', [id]))[0];
  const physicalLedger = () => f.query('SELECT to_jsonb(p) AS row,xmin::text AS xmin,ctid::text AS ctid FROM progreso_edicion_entregas p ORDER BY id');
  const [client] = await f.query("INSERT INTO clientes(nombre) VALUES('QA audit lifecycle') RETURNING id");
  const secret = 'QA_AUDIT_PRIVATE_FINANCE_55991';
  const [piece] = await f.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,copy,metadata)
    VALUES($1,'video','lista',CURRENT_DATE,'QA editorial unchanged',$2::jsonb) RETURNING id`, [client.id, JSON.stringify({ marker: secret })]);
  const piecePhysical = () => f.query('SELECT to_jsonb(p) AS row,xmin::text AS xmin,ctid::text AS ctid FROM publicaciones p WHERE id=$1', [piece.id]);
  const pieceBefore = await piecePhysical();
  const task = checked(await api('/tareas', admin, 'POST', { titulo: 'QA owner credited, admin delivers', workspace: 'render_os',
    tipo_tarea: 'edicion', subtipo: 'video', cliente_id: client.id, publicacion_id: piece.id,
    asignado_a_id: OWNER, colaborador_ids: [], material_referencia: 'https://example.invalid/raw-audit',
    fecha_vencimiento: `${period.month}-15`, aclaraciones: 'QA preserve script',
  }), 201);
  await f.query('UPDATE tareas SET propiedades_extra=propiedades_extra||$2::jsonb WHERE id=$1', [task.id,
    JSON.stringify({ private_finance: { marker: secret, amount: 827456.39 } })]);
  const deliveryInput = async id => ({ request_id: crypto.randomUUID(), expected_revision: (await row(id)).revision,
    url: 'https://example.invalid/edited-audit', notes: 'QA canonical artifact, not report data' });
  const deliver = (id, body, token = admin) => api(`/tareas-edicion/${id}/entregas`, token, 'POST', body);
  const patch = async (id, estado, deliveryId) => api(`/tareas/${id}?workspace=render_os`, admin, 'PATCH', {
    estado, expected_revision: (await row(id)).revision, ...(deliveryId ? { expected_entrega_id: deliveryId } : {}),
  });
  const counts = (dto, expected) => {
    assert.deepEqual([dto.en_revision_actuales, dto.aprobadas_actuales, dto.finalizadas_registradas, dto.total_operativo], expected);
    assert.equal(dto.total_operativo, dto.en_revision_actuales + dto.aprobadas_actuales + dto.finalizadas_registradas);
    assert.equal(dto.entregas.length, dto.total_operativo);
    assert.equal(new Set(dto.entregas.map(d => d.tarea_id)).size, dto.total_operativo);
    assert.deepEqual(dto.revisiones, dto.entregas.filter(d => d.estado_canonico === 'en_revision'));
    assert.doesNotMatch(JSON.stringify(dto), new RegExp(`${secret}|827456\\.39|private_finance|payload_hash|password_hash`));
  };

  await t.test('signed actual GET succeeds; pre-delivery task is not counted; source/schema is installed by runner', async () => {
    const response = await signed(query), dto = checked(response);
    assert.equal(response.cache, 'no-store'); assert.equal(dto.contrato, 'editing-progress-v1');
    assert.deepEqual(dto.alcance, { tipo: 'usuario_id', editor_clave: null, editor_id: OWNER });
    counts(dto, [0, 0, 0, 0]);
    assert.equal(await ledger(task.id), undefined);
  });
  let firstInput, firstId, firstLedger;
  await t.test('admin records artifact, assigned owner ID gets credit; homonymous user gets none', async () => {
    firstInput = await deliveryInput(task.id);
    assert.equal((await deliver(task.id, firstInput, homonym)).status, 403);
    const result = checked(await deliver(task.id, firstInput), 201); firstId = result.delivery_id;
    firstLedger = await ledger(task.id);
    assert.equal(firstLedger.editor_user_id, OWNER); assert.equal(firstLedger.origen_registro, 'canonical_delivery');
    assert.equal(firstLedger.delivery_id, firstId);
    assert.equal((await f.query('SELECT actor_id FROM task_editing_deliveries WHERE id=$1', [firstId]))[0].actor_id, 91001);
    const dto = await audit(); counts(dto, [1, 0, 0, 1]);
    assert.equal(dto.entregas[0].tarea_id, String(task.id)); assert.equal(dto.entregas[0].editor_user_id, OWNER);
    counts(await audit(`periodo=${period.month}&editor_id=${HOMONYM}`), [0, 0, 0, 0]);
  });
  await t.test('receipt replay and new artifact version keep one task, first timestamp and credited ID', async () => {
    const before = await physicalLedger();
    const replay = checked(await deliver(task.id, firstInput)); assert.equal(replay.replayed, true); assert.equal(replay.delivery_id, firstId);
    assert.deepEqual(await physicalLedger(), before);
    const replacement = checked(await deliver(task.id, await deliveryInput(task.id), owner), 201);
    const current = await ledger(task.id);
    assert.equal(current.id, firstLedger.id); assert.equal(current.entregada_at, firstLedger.entregada_at);
    assert.equal(current.editor_user_id, OWNER); assert.equal(current.delivery_id, replacement.delivery_id);
    assert.notEqual(current.delivery_id, firstId); firstId = replacement.delivery_id;
    assert.equal((await f.query('SELECT count(*)::int n FROM task_editing_deliveries WHERE task_id=$1', [task.id]))[0].n, 2);
    counts(await audit(), [1, 0, 0, 1]);
  });
  await t.test('correction deactivates work count; re-delivery reactivates without a third task credit', async () => {
    checked(await api(`/tareas-edicion/${task.id}/correcciones`, admin, 'POST', {
      request_id: crypto.randomUUID(), expected_revision: (await row(task.id)).revision,
      expected_entrega_id: firstId, notes: 'QA explicit correction',
    }), 201);
    assert.equal((await ledger(task.id)).activa, false); counts(await audit(), [0, 0, 0, 0]);
    const replacement = checked(await deliver(task.id, await deliveryInput(task.id), owner), 201); firstId = replacement.delivery_id;
    assert.equal((await ledger(task.id)).entregada_at, firstLedger.entregada_at); counts(await audit(), [1, 0, 0, 1]);
  });
  await t.test('approval and finalization remain counted, but never publish the linked piece', async () => {
    assert.equal((await patch(task.id, 'finalizada')).status, 409, 'Cannot bypass approval');
    checked(await patch(task.id, 'aprobada', firstId)); counts(await audit(), [0, 1, 0, 1]);
    checked(await patch(task.id, 'finalizada')); counts(await audit(), [0, 0, 1, 1]);
    assert.equal((await ledger(task.id)).activa, true);
    assert.deepEqual(await piecePhysical(), pieceBefore, 'Finalized task is not editorial publication');
    assert.equal((await row(task.id)).estado, 'finalizada');
  });
  let historical;
  await t.test('historical NULL identity remains separate, supports purged tasks and Argentine month boundaries', async () => {
    historical = checked(await api('/tareas', admin, 'POST', { titulo: 'QA real task with historical ledger evidence', workspace: 'render_os',
      tipo_tarea: 'edicion', cliente_id: client.id, asignado_a_id: OWNER, colaborador_ids: [],
      material_referencia: 'https://example.invalid/history-raw', fecha_vencimiento: `${period.month}-15`,
    }), 201);
    await f.query(`INSERT INTO progreso_edicion_entregas(tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,entregada_at,activa)
      VALUES($1,'luciano','QA explicit historical fixture',$2,'en_revision',
        $3::date::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires',true),
      (7000000001,'luciano','QA purged task at month end',$2,'publicada',
        (($3::date+interval '1 month') AT TIME ZONE 'America/Argentina/Buenos_Aires')-interval '1 microsecond',true),
      (7000000002,'luciano','QA previous month excluded',$2,'publicada',
        ($3::date::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')-interval '1 microsecond',true),
      (7000000003,'luciano','QA next month excluded',$2,'publicada',
        ($3::date+interval '1 month') AT TIME ZONE 'America/Argentina/Buenos_Aires',true)`,
    [historical.id, client.id, `${period.month}-01`]);
    const before = await ledger(historical.id);
    const artifact = checked(await deliver(historical.id, await deliveryInput(historical.id), owner), 201);
    const after = await ledger(historical.id);
    for (const key of ['editor_user_id', 'origen_registro']) assert.equal(after[key], null);
    for (const key of ['editor_clave', 'titulo_snapshot', 'cliente_id', 'entregada_at']) assert.equal(after[key], before[key]);
    assert.equal(after.delivery_id, artifact.delivery_id); assert.ok(Number.isSafeInteger(after.task_revision));
    const history = await audit(historyQuery); counts(history, [1, 0, 1, 2]);
    assert.deepEqual(history.desglose_origen, { historicas: 2, canonicas: 0 });
    assert.match(history.editor, /identidad no verificada/);
    assert.ok(history.entregas.every(d => d.editor_user_id === null && d.atribucion === 'historica_no_verificada'));
    assert.equal(history.entregas.find(d => d.tarea_id === '7000000001').estado_canonico, 'finalizada');
    counts(await audit(), [0, 0, 1, 1]);
  });
  await t.test('signature binds the full target; private current admin authority and closed query remain mandatory', async () => {
    assert.equal((await signed(query, { signedQuery: `periodo=${period.month}&editor_id=${HOMONYM}` })).status, 401);
    assert.equal((await signed(query, { signatureVersion: '1' })).status, 401);
    assert.equal((await signed(query, { groupId: group })).status, 403);
    assert.equal((await signed(query, { who: editorActor })).status, 403);
    for (const bad of [`periodo=${period.month}&editor_id=0`, `periodo=${period.month}&editor_id=2147483648`,
      `periodo=${period.month}&periodo=${period.month}`, `periodo=${period.month}&persona=Luciano`]) {
      assert.equal((await signed(bad)).status, 400);
    }
    await f.query("UPDATE usuarios SET rol='edicion' WHERE id=91001");
    try { assert.equal((await signed(query)).status, 403); }
    finally { await f.query("UPDATE usuarios SET rol='admin' WHERE id=91001"); }
    await f.query('UPDATE usuarios SET whatsapp_habilitado=false WHERE id=91001');
    try { assert.equal((await signed(query)).status, 403); }
    finally { await f.query('UPDATE usuarios SET whatsapp_habilitado=true WHERE id=91001'); }
  });
  await t.test('fresh signed reloads are durable/read-only and execute no payroll SQL', async () => {
    // Only this identity-verified disposable cluster is reconfigured. New and
    // existing app sessions receive logging through reload, not a mock SQL tap.
    await f.query("ALTER SYSTEM SET log_statement='all'"); await f.query('SELECT pg_reload_conf()');
    const deadline = Date.now() + 4000;
    while ((await f.query('SHOW log_statement'))[0].log_statement !== 'all') {
      assert.ok(Date.now() < deadline, 'Fixture logging reload timeout');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const before = await physicalLedger(), expected = await audit(), expectedHistory = await audit(historyQuery);
    const offset = (await readFile(`${f.root}/postgres.log`, 'utf8')).length;
    assert.deepEqual(await audit(), expected); assert.deepEqual(await audit(), expected);
    assert.deepEqual(await audit(historyQuery), expectedHistory);
    assert.deepEqual(await physicalLedger(), before); assert.deepEqual(await piecePhysical(), pieceBefore);
    const log = (await readFile(`${f.root}/postgres.log`, 'utf8')).slice(offset);
    assert.match(log, /BEGIN(?: TRANSACTION)? ISOLATION LEVEL REPEATABLE READ READ ONLY/i);
    assert.match(log, /FROM public\.progreso_edicion_entregas pe/i, 'Observe actual source query, not empty logs');
    assert.doesNotMatch(log, /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:public\.)?"?(?:entregas_edicion|cliente_abonos|team_payment_ledger|sueldos)\b/i);
    assert.doesNotMatch(log, /(?:statement:|execute [^:]*:)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  });
  await t.test('missing source fails 503 rather than promising an empty month', async () => {
    await f.query('ALTER TABLE public.progreso_edicion_entregas RENAME TO qa_audit_temporarily_unavailable');
    try {
      const response = await signed(query); checked(response, 503);
      assert.equal(response.body.code, 'editing_progress_schema_unavailable');
      assert.equal(response.body.total_operativo, undefined); assert.equal(response.body.entregas, undefined);
    } finally { await f.query('ALTER TABLE public.qa_audit_temporarily_unavailable RENAME TO progreso_edicion_entregas'); }
    counts(await audit(), [0, 0, 1, 1]);
  });
});
