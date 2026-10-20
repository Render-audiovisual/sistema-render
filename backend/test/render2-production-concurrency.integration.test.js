import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const ids = { owner: 96001, impostor: 96002, collaborator: 96003 };

test('production HTTP CAS, stable membership and confirmation without implicit aggregate editing', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wilsonActor = 'qa-production-admin';
  const fixture = await startLocalHarness({ port: 55599, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }), allowedWhatsappIds: wilsonActor,
  } });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production fixture stopped and removed: ${fixture.root}`);
  });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.token;
  };
  for (const [key, id] of Object.entries(ids))
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,'produccion',password_hash,true,1 FROM usuarios WHERE id=91004`,
    [id, `qa_production_${key}`, key === 'collaborator' ? 'QA Production Collaborator' : 'QA Production Shared']);
  const admin = await login('qa_franco');
  const owner = await login('qa_production_owner');
  const impostor = await login('qa_production_impostor');
  const collaborator = await login('qa_production_collaborator');
  const designer = await login('qa_designer');
  await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=91001',
    [crypto.createHash('sha256').update(wilsonActor).digest('hex')]);
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  const signed = async (route, body) => {
    const url = new URL(`/api/integraciones/wilson${route}`, fixture.base);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    const message = ['v2', timestamp, nonce, 'whatsapp', wilsonActor, '', 'QA Production Admin', 'POST',
      `${url.pathname}${url.search}`, crypto.createHash('sha256').update(canonical(body)).digest('hex')].join('\n');
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000), headers: {
      'content-type': 'application/json', 'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce,
      'x-wilson-signature-version': '2', 'x-wilson-channel': 'whatsapp', 'x-wilson-actor-id': wilsonActor,
      'x-wilson-actor-name': 'QA Production Admin',
      'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64'),
    }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA production CAS') RETURNING id");
  const detail = async id => {
    const result = await api(`/tareas/${id}?workspace=render_os`, { token: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const visit = async (planned = 20) => {
    const result = await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'QA visita production CAS', asignado_a_id: ids.owner, colaborador_ids: [ids.collaborator],
      cliente_id: client.id, tipo_tarea: 'produccion', subtipo: 'visita', workspace: 'render_os',
      produccion_videos_previstos: planned, material_referencia: 'https://example.invalid/qa-production-material',
      fecha_vencimiento: '2026-10-25',
    } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    // Fixture-only explicit editor selection: no name inference or real account.
    await fixture.query(`UPDATE tareas SET propiedades_extra=propiedades_extra ||
      '{"edicion_responsable_id":91003}'::jsonb WHERE id=$1`, [result.body.id]);
    return result.body.id;
  };
  const add = (id, token, revision, cantidad = 1) => api(`/tareas/${id}/produccion/registros`, {
    token, method: 'POST', body: { cantidad, fecha: '2026-10-25', expected_revision: revision },
  });
  const correct = (id, recordId, token, revision, cantidad) => api(`/tareas/${id}/produccion/registros/${encodeURIComponent(recordId)}?workspace=render_os`, {
    token, method: 'PATCH', body: { cantidad, expected_revision: revision },
  });
  const confirm = (id, revision, token = admin) => api(`/tareas/${id}/produccion/confirmar?workspace=render_os`, {
    token, method: 'POST', body: { expected_revision: revision },
  });
  const editing = id => fixture.query("SELECT * FROM tareas WHERE propiedades_extra->>'origen_visita_id'=$1 ORDER BY id", [String(id)]);
  const snapshot = async () => ({ tasks: await fixture.query('SELECT * FROM tareas ORDER BY id'),
    bindings: await fixture.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id') });
  const confirmationOnly = async (id, before, result) => {
    assert.equal(result.editing_task, null);
    assert.equal(result.created, false);
    assert.deepEqual(Object.keys(result).sort(), ['task', 'editing_task', 'created'].sort());
    const after = await snapshot();
    assert.deepEqual(after.bindings, before.bindings, 'Confirmation never creates or changes assignment bindings');
    assert.equal(after.tasks.length, before.tasks.length, 'Confirmation never creates any task');
    const previous = before.tasks.find(task => task.id === id), current = after.tasks.find(task => task.id === id);
    assert.ok(previous && current);
    assert.equal(current.revision, previous.revision + 1);
    assert.equal(current.estado, 'en_revision');
    const props = current.propiedades_extra;
    assert.equal(props.produccion_esperando_confirmacion, false);
    assert.ok(typeof props.produccion_confirmada_por === 'string' && props.produccion_confirmada_por.length > 0);
    assert.equal(props.produccion_confirmada_por_id, 91001);
    assert.ok(Number.isFinite(Date.parse(props.produccion_confirmada_at)));
    assert.deepEqual(current, { ...previous, revision: previous.revision + 1, updated_at: current.updated_at,
      estado: 'en_revision', propiedades_extra: { ...previous.propiedades_extra,
        produccion_esperando_confirmacion: false, produccion_confirmada_por: props.produccion_confirmada_por,
        produccion_confirmada_por_id: 91001, produccion_confirmada_at: props.produccion_confirmada_at,
        mia_notificacion_pendiente: null, workspace: 'render_os' } }, 'Only source confirmation fields may change');
    assert.deepEqual(after.tasks.map(task => task.id === id ? previous : task), before.tasks,
      'Every other task, including existing aggregate children, remains byte-for-byte unchanged');
    return after;
  };
  const responseTask = (result, ownerId = ids.owner) => {
    assert.ok(Number.isSafeInteger(result.revision) && result.revision > 0, 'Response needs integer revision');
    assert.equal(result.asignado_a_id, ownerId);
    assert.ok(Array.isArray(result.colaborador_ids), 'Response needs collaborator IDs');
  };
  const denied = result => assert.ok([403, 404].includes(result.status), JSON.stringify(result));
  const complete = async () => {
    const id = await visit(3);
    const added = await add(id, owner, (await detail(id)).revision, 3);
    assert.equal(added.status, 201, JSON.stringify(added.body));
    return id;
  };

  await t.test('two adds sharing one revision yield one 201 and one 409, preserving prior JSON', async () => {
    const id = await visit();
    const first = await add(id, owner, (await detail(id)).revision, 1);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const prior = first.body.propiedades_extra.produccion_registros[0];
    const current = await detail(id);
    const results = await Promise.all([add(id, owner, current.revision, 2), add(id, collaborator, current.revision, 3)]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    const winner = results.find(result => result.status === 201).body;
    responseTask(winner);
    assert.equal(winner.revision, current.revision + 1);
    const stored = await detail(id);
    assert.deepEqual(stored.propiedades_extra.produccion_registros, winner.propiedades_extra.produccion_registros);
    assert.equal(stored.propiedades_extra.produccion_registros.length, 2);
    assert.deepEqual(stored.propiedades_extra.produccion_registros[0], prior);
  });
  await t.test('two corrections sharing one revision yield one 200 and one 409 without losing other records', async () => {
    const id = await visit();
    assert.equal((await add(id, owner, (await detail(id)).revision, 1)).status, 201);
    assert.equal((await add(id, owner, (await detail(id)).revision, 2)).status, 201);
    const current = await detail(id);
    const records = current.propiedades_extra.produccion_registros;
    const results = await Promise.all([
      correct(id, records[0].id, owner, current.revision, 4),
      correct(id, records[0].id, collaborator, current.revision, 5),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.find(result => result.status === 200).body;
    responseTask(winner);
    assert.equal(winner.revision, current.revision + 1);
    const stored = await detail(id);
    assert.deepEqual(stored.propiedades_extra.produccion_registros, winner.propiedades_extra.produccion_registros);
    const preserved = stored.propiedades_extra.produccion_registros[1];
    for (const [key, value] of Object.entries(records[1]))
      assert.deepEqual(preserved[key], value, `Uncorrected record lost original ${key}`);
    // The shared correction helper intentionally recomputes derived allocation
    // for every record; this is not a change to its original quantity/identity.
    assert.equal(preserved.cantidad_mes_actual, records[1].cantidad);
    assert.equal(preserved.cantidad_adelanto, 0);
    assert.equal(preserved.periodo_adelanto, null);
  });
  await t.test('homonym and revoked collaborator cannot add/correct despite retained legacy labels', async () => {
    const id = await visit();
    const added = await add(id, collaborator, (await detail(id)).revision, 1);
    assert.equal(added.status, 201, JSON.stringify(added.body));
    const recordId = added.body.propiedades_extra.produccion_registros[0].id;
    await fixture.query("DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=$2 AND tipo='colaborador'", [id, ids.collaborator]);
    const current = await detail(id);
    assert.ok(current.propiedades_extra.colaboradores.includes('QA Production Collaborator'));
    const before = await snapshot();
    for (const token of [impostor, collaborator]) {
      denied(await add(id, token, current.revision));
      denied(await correct(id, recordId, token, current.revision, 2));
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('missing or malformed revision is 400 on add, correction and confirmation with no writes', async () => {
    const id = await complete();
    const record = (await detail(id)).propiedades_extra.produccion_registros[0];
    const before = await snapshot();
    for (const revision of [undefined, null, 0, -1, 1.5, '1', {}, Number.MAX_SAFE_INTEGER + 1]) {
      for (const result of [await add(id, owner, revision), await correct(id, record.id, owner, revision, 2), await confirm(id, revision)])
        assert.equal(result.status, 400, JSON.stringify(result));
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('stale confirmation creates nothing; success updates only source without aggregate editing; retries do not duplicate', async () => {
    const id = await complete();
    const current = await detail(id);
    const before = await snapshot();
    assert.equal((await confirm(id, current.revision - 1)).status, 409);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await editing(id), []);
    const result = await confirm(id, current.revision);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    responseTask(result.body.task);
    assert.equal(result.body.task.revision, current.revision + 1);
    assert.ok(result.body.task.propiedades_extra.produccion_confirmada_at);
    const confirmed = await confirmationOnly(id, before, result.body);
    assert.deepEqual(await editing(id), []);
    assert.equal((await confirm(id, current.revision)).status, 409);
    assert.equal((await confirm(id, (await detail(id)).revision)).status, 409);
    assert.deepEqual(await snapshot(), confirmed);
  });
  await t.test('confirmation preserves an existing historical aggregate child and its assignments untouched', async () => {
    const id = await complete();
    const [child] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,propiedades_extra)
      VALUES ('QA preserved historical aggregate child','Luciano QA',$1,'en_progreso','edicion','video',$2::jsonb) RETURNING id`,
    [client.id, JSON.stringify({ workspace: 'render_os', origen_visita_id: String(id), historical_marker: { preserve: true } })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [child.id]);
    const current = await detail(id), before = await snapshot();
    const result = await confirm(id, current.revision);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    await confirmationOnly(id, before, result.body);
    assert.deepEqual(await editing(id), before.tasks.filter(task => task.id === child.id));
  });
  await t.test('correction of completed visit resets completion/confirmation and requires fresh completion before reconfirmation', async () => {
    const id = await complete();
    assert.equal((await confirm(id, (await detail(id)).revision)).status, 200);
    const current = await detail(id);
    const recordId = current.propiedades_extra.produccion_registros[0].id;
    const corrected = await correct(id, recordId, owner, current.revision, 1);
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    responseTask(corrected.body);
    assert.equal(corrected.body.estado, 'en_progreso');
    assert.ok(!corrected.body.propiedades_extra.produccion_confirmada_at);
    assert.ok(!corrected.body.propiedades_extra.produccion_finalizada_at, 'Partial correction must not retain stale finished marker');
    const before = await snapshot();
    assert.equal((await confirm(id, corrected.body.revision)).status, 400);
    assert.deepEqual(await snapshot(), before);
    const finished = await add(id, owner, (await detail(id)).revision, 2);
    assert.equal(finished.status, 201, JSON.stringify(finished.body));
    const beforeConfirmation = await snapshot();
    const confirmed = await confirm(id, finished.body.revision);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    await confirmationOnly(id, beforeConfirmation, confirmed.body);
    assert.deepEqual(await editing(id), [], 'Reconfirmation must not generate aggregate editing');
  });
  await t.test('finalized visit correction requires finalizer authority and clears approval including legacy review flags', async () => {
    const id = await complete();
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91004,'colaborador')", [id]);
    const completed = await detail(id);
    const finalized = await api(`/tareas/${id}?workspace=render_os`, { token: admin, method: 'PATCH',
      body: { estado: 'finalizada', expected_revision: completed.revision } });
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
    assert.equal(finalized.body.estado, 'finalizada');
    const current = await detail(id);
    const recordId = current.propiedades_extra.produccion_registros[0].id;
    const before = await snapshot();
    assert.equal((await correct(id, recordId, designer, current.revision, 1)).status, 403);
    assert.deepEqual(await snapshot(), before, 'Assigned designer cannot reopen finalized visit through correction');
    const corrected = await correct(id, recordId, owner, current.revision, 1);
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    assert.equal(corrected.body.estado, 'en_progreso');
    const cleared = task => {
      assert.equal(task.propiedades_extra.revision_aprobada, false);
      for (const key of ['revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at', 'finalizada_at'])
        assert.ok(task.propiedades_extra[key] == null, `${key} must be cleared on production correction`);
    };
    cleared(corrected.body);
    // Simulate an existing legacy review row by INSERT, not by disabling the
    // common UPDATE approval guard. Its record IDs/audit data stay authentic.
    const [legacy] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,
      material_referencia,propiedades_extra)
      SELECT 'QA legacy review approval visit',asignado_a,cliente_id,'en_revision',tipo_tarea,subtipo,
        material_referencia,propiedades_extra || $2::jsonb FROM tareas WHERE id=$1 RETURNING id`,
    [id, JSON.stringify({ revision_aprobada: true, revision_aprobada_por: 'Historical QA', revision_aprobada_por_id: 91001,
      revision_aprobada_at: '2026-10-01T12:00:00Z', finalizada_at: '2026-10-01T12:00:00Z' })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [legacy.id, ids.owner]);
    const old = await detail(legacy.id);
    assert.equal(old.propiedades_extra.revision_aprobada, true);
    const fixed = await correct(legacy.id, old.propiedades_extra.produccion_registros[0].id, admin, old.revision, 2);
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    cleared(fixed.body);
  });
  await t.test('confirmation succeeds with aggregate task INSERT forbidden, proving the retired creation path is not used', async () => {
    const id = await complete();
    const current = await detail(id);
    const before = await snapshot();
    await fixture.query(`CREATE FUNCTION qa_production_edit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.propiedades_extra->>'origen_visita_id'=TG_ARGV[0] THEN
        RAISE EXCEPTION 'QA aggregate editing insert failure'; END IF; RETURN NEW; END $$`);
    try {
      await fixture.query(`CREATE TRIGGER qa_production_edit_failure BEFORE INSERT ON tareas
        FOR EACH ROW EXECUTE FUNCTION qa_production_edit_failure('${id}')`);
      try {
        const result = await confirm(id, current.revision);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        await confirmationOnly(id, before, result.body);
        assert.deepEqual(await editing(id), []);
      } finally { await fixture.query('DROP TRIGGER qa_production_edit_failure ON tareas'); }
    } finally { await fixture.query('DROP FUNCTION qa_production_edit_failure()'); }
    const committed = await snapshot();
    assert.equal((await confirm(id, current.revision)).status, 409);
    assert.deepEqual(await snapshot(), committed);
  });
  await t.test('signed Wilson audit failure rolls back token and callback writes; same token/revision retries exactly once', async () => {
    const id = await complete();
    const current = await detail(id);
    const issued = await signed('/confirmaciones', { operacion: 'confirmar_grabacion', tarea_id: id,
      payload: { expected_revision: current.revision } });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    const token = issued.body.confirmacion_token;
    assert.ok(token);
    const tokenRows = () => fixture.query('SELECT * FROM integracion_confirmaciones WHERE token=$1', [token]);
    const beforeToken = await tokenRows();
    assert.equal(beforeToken[0].used_at, null);
    const before = await snapshot();
    const auditRows = () => fixture.query("SELECT * FROM integracion_auditoria WHERE tarea_id=$1 AND accion='confirmar_grabacion' ORDER BY id", [id]);
    const beforeAudit = await auditRows();
    const invoke = () => signed(`/tareas/${id}/confirmar-grabacion`, {
      expected_revision: current.revision, confirmacion_token: token,
    });
    await fixture.query(`CREATE FUNCTION qa_production_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.accion='confirmar_grabacion' AND NEW.tarea_id::text=TG_ARGV[0] THEN
        RAISE EXCEPTION 'QA Wilson post-callback audit failure'; END IF; RETURN NEW; END $$`);
    try {
      await fixture.query(`CREATE TRIGGER qa_production_audit_failure BEFORE INSERT ON integracion_auditoria
        FOR EACH ROW EXECUTE FUNCTION qa_production_audit_failure('${id}')`);
      try {
        const failed = await invoke();
        assert.equal(failed.status, 500, JSON.stringify(failed.body));
        assert.deepEqual(await tokenRows(), beforeToken, 'Consumed token must roll back after callback/audit failure');
        assert.deepEqual(await snapshot(), before, 'Source revision/confirmation must share the token transaction; no tasks or assignments may be added');
        assert.deepEqual(await editing(id), []);
        assert.deepEqual(await auditRows(), beforeAudit);
      } finally { await fixture.query('DROP TRIGGER qa_production_audit_failure ON integracion_auditoria'); }
    } finally { await fixture.query('DROP FUNCTION qa_production_audit_failure()'); }
    const retried = await invoke();
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    responseTask(retried.body.task);
    assert.equal(retried.body.task.revision, current.revision + 1);
    assert.ok(retried.body.task.propiedades_extra.produccion_confirmada_at);
    await confirmationOnly(id, before, retried.body);
    assert.deepEqual(await editing(id), []);
    assert.ok((await tokenRows())[0].used_at);
    assert.equal((await auditRows()).length, beforeAudit.length + 1);
    const committed = await snapshot();
    assert.equal((await invoke()).status, 409, 'Same token cannot commit twice');
    assert.deepEqual(await snapshot(), committed);
  });
});
