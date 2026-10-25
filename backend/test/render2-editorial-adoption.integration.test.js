import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const domains = { historia: 'historias', publicacion: 'publicaciones' };
const sentinel = 'QA_ADOPTION_PRIVATE_FINANCE_55613';
test('editorial adoption: ordinary principal DTOs/reporting use current immutable confirmation only', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55613 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own editorial-adoption fixture stopped and removed: ${fixture.root}`);
  });
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, JSON.stringify(response.body)); return response.body;
  };
  const api = (route, token = admin, method = 'GET', body) => request(fixture.base, `/api${route}`, { token, method, body });
  const login = async usuario => checked(await request(fixture.base, '/api/login', {
    method: 'POST', body: { usuario, password: fixturePassword },
  })).token;
  const admin = await login('qa_franco');
  for (const id of [107001, 107002]) await fixture.query(`INSERT INTO usuarios
    (id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,$2,'QA adoption homonym','edicion',password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa_adoption_${id}`]);
  const staff = await login('qa_adoption_107001'); const impostor = await login('qa_adoption_107002');
  const [feed] = await fixture.query("INSERT INTO grupos_feed(nombre,cuota_reels,cuota_carruseles) VALUES ('QA adoption feed',4,2) RETURNING id");
  const clients = await fixture.query(`INSERT INTO clientes(nombre,grupo_feed_id,cuota_reels,cuota_carruseles)
    VALUES ('QA adoption client A',$1,4,2),('QA adoption client B',$1,4,2) RETURNING id,nombre`, [feed.id]);
  let serial = 0;
  const pieces = [];
  const seed = async (domain, { state = 'lista', actual = null, planned = '2026-07-15', clientId = clients[0].id, forged = false } = {}) => {
    const fake = { classification: 'confirmada_manualmente', revision: 18, confirmation: {
      id: randomUUID(), actor_id: 91001, occurred_at: '2026-08-01T03:00:00.000Z', recorded_at: '2026-08-01T03:00:00.000Z', source: 'manual',
      future_finance: { amount: 783456.91, marker: sentinel },
    } };
    const [row] = await fixture.query(`INSERT INTO ${domains[domain]}
      (cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada,"fecha_publicación_real",copy,metadata)
      VALUES ($1,${domain === 'publicacion' ? "'video'," : ''}$2,$3,$4,'QA normal editorial copy',$5::jsonb) RETURNING id`,
    [clientId, state, planned, actual, JSON.stringify({ importe: 783456.91, arbitrary_money: { marker: sentinel },
      ...(forged ? { publicacion_evidencia: fake, revision_aprobada: true, publicada: true, confirmation: fake.confirmation } : {}) })]);
    const piece = { domain, id: row.id, clientId };
    // Membership grants task writes/personal home; Reportes independently grants team reads by role.
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,historia_id,publicacion_id,tipo_tarea,subtipo,estado,propiedades_extra)
      VALUES ($1,'QA adoption homonym',$2,$3,$4,'edicion','video','pendiente','{"workspace":"render_os"}') RETURNING id`,
    [`QA adoption task ${++serial}`, clientId, domain === 'historia' ? row.id : null, domain === 'publicacion' ? row.id : null]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,107001,'responsable')", [task.id]);
    piece.taskId = task.id; pieces.push(piece); return piece;
  };
  const status = async piece => checked(await api(`/editorial-publicacion/${piece.domain}/${piece.id}`));
  const confirm = async (piece, occurred_at) => {
    const input = { request_id: randomUUID(), expected_revision: (await status(piece)).piece.revision, occurred_at };
    return { input, result: checked(await api(`/editorial-publicacion/${piece.domain}/${piece.id}/confirmar`, admin, 'POST', input), 201) };
  };
  const report = async (token = admin) => checked(await api('/reportes/datos?mes_configuracion=2026-07&desde=2026-07-01&hasta=2026-09-01', token));
  const list = async (domain, token = admin) => checked(await api(`/${domains[domain]}`, token));
  const snapshot = async () => {
    const result = {};
    for (const table of ['historias', 'publicaciones', 'editorial_publicacion_eventos', 'editorial_publicacion_versiones',
      'tareas', 'tarea_asignaciones', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'])
      result[table] = await fixture.query(`SELECT to_jsonb(r) AS row FROM ${table} r ORDER BY to_jsonb(r)::text`);
    return result;
  };
  // Independent SQL, not the application annotation or frontend predicate.
  const expected = async piece => {
    const [row] = await fixture.query(`SELECT p.estado,p."fecha_publicación_real" AS actual,
      COALESCE(v.revision,0)::text AS revision,
      CASE WHEN c.activo IS DISTINCT FROM FALSE AND p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
        AND e.dominio=$1 AND e.pieza_id=p.id AND e.cliente_id=p.cliente_id AND e.action='confirmar'
        AND e.source='manual' AND p.estado='publicada' AND e.occurred_at=p."fecha_publicación_real"
        THEN jsonb_build_object('id',e.id,'actor_id',e.actor_id,'occurred_at',e.occurred_at,'recorded_at',e.recorded_at,'source',e.source)
        ELSE NULL END AS confirmation
      FROM ${domains[piece.domain]} p JOIN clientes c ON c.id=p.cliente_id
      LEFT JOIN editorial_publicacion_versiones v ON v.dominio=$1 AND v.pieza_id=p.id
      LEFT JOIN editorial_publicacion_eventos e ON e.id=v.current_event_id
      WHERE p.id=$2`, [piece.domain, piece.id]);
    const confirmation = row.confirmation && { ...row.confirmation,
      occurred_at: new Date(row.confirmation.occurred_at).toISOString(), recorded_at: new Date(row.confirmation.recorded_at).toISOString() };
    return { classification: confirmation ? 'confirmada_manualmente' : row.estado === 'publicada' || row.actual ? 'historica_sin_confirmacion' : 'no_publicada',
      revision: Number(row.revision), confirmation };
  };
  const validate = async (row, piece) => {
    assert.ok(row, `${piece.domain}/${piece.id} missing`);
    assert.deepEqual(Object.keys(row.publicacion_evidencia).sort(), ['classification', 'confirmation', 'revision']);
    assert.deepEqual(row.publicacion_evidencia, await expected(piece));
    const proof = row.publicacion_evidencia.confirmation;
    if (proof) {
      assert.deepEqual(Object.keys(proof).sort(), ['actor_id', 'id', 'occurred_at', 'recorded_at', 'source']);
      assert.equal(row.estado, 'publicada');
      assert.equal(row['fecha_publicación_real'], proof.occurred_at);
    }
    if (row['fecha_publicación_real'] !== null) assert.equal(new Date(row['fecha_publicación_real']).toISOString(), row['fecha_publicación_real']);
    assert.ok(!JSON.stringify(row.publicacion_evidencia).includes(sentinel));
    assert.ok(!JSON.stringify(row.publicacion_evidencia).includes('783456.91'));
  };
  const reads = async (piece, token = admin) => {
    const row = (await list(piece.domain, token)).find(row => row.id === piece.id);
    const reportRow = (await report(token))[domains[piece.domain]].find(row => row.id === piece.id);
    await validate(row, piece); await validate(reportRow, piece);
    assert.equal(JSON.stringify(reportRow).includes(sentinel), false, 'Reports omit financial metadata even for admins');
    assert.equal(JSON.stringify(reportRow).includes('783456.91'), false);
    assert.equal(Object.hasOwn(reportRow, 'metadata'), false, 'Report editorial DTO is closed');
    if (token !== admin) for (const item of [row, reportRow]) {
      assert.ok(!JSON.stringify(item).includes(sentinel), 'Employee editorial DTO must omit arbitrary financial metadata');
      assert.ok(!JSON.stringify(item).includes('783456.91'));
    }
    return { row, reportRow };
  };
  const history = [];
  for (const domain of Object.keys(domains)) for (const [state, actual] of [
    ['publicada', '2026-07-31T23:00:00Z'], ['publicada', null], ['lista', '2026-07-31T23:00:00Z'], ['lista', null],
  ]) history.push(await seed(domain, { state, actual, forged: true }));

  await t.test('historical state/date and forged metadata never earn evidence; ordinary/report GET are read-only', async () => {
    const before = await snapshot();
    for (const piece of history) for (const token of [admin, staff]) {
      const { row } = await reads(piece, token);
      assert.notEqual(row.publicacion_evidencia.classification, 'confirmada_manualmente');
      assert.equal(row.publicacion_evidencia.confirmation, null);
    }
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await fixture.query('SELECT * FROM editorial_publicacion_eventos'), []);
  });
  const confirmed = [];
  for (const domain of Object.keys(domains)) await t.test(`${domain}: explicit confirmation flows to list/report, reload and withdrawal without task changes`, async () => {
    const piece = await seed(domain); const taskBefore = await fixture.query('SELECT * FROM tareas WHERE id=$1', [piece.taskId]);
    const operation = await confirm(piece, '2026-08-01T02:30:00Z');
    confirmed.push(piece);
    for (const token of [admin, staff, await login('qa_adoption_107001')]) {
      const { row } = await reads(piece, token);
      assert.equal(row.publicacion_evidencia.confirmation.id, operation.result.operation.id);
      assert.equal(row.fecha_programada, '2026-07-15');
    }
    const before = await snapshot();
    const replay = checked(await api(`/editorial-publicacion/${domain}/${piece.id}/confirmar`, admin, 'POST', operation.input));
    assert.equal(replay.replayed, true); assert.deepEqual(await snapshot(), before);
    const input = { request_id: randomUUID(), expected_revision: (await status(piece)).piece.revision };
    checked(await api(`/editorial-publicacion/${domain}/${piece.id}/retirar`, admin, 'POST', input));
    for (const token of [admin, staff]) assert.equal((await reads(piece, token)).row.publicacion_evidencia.classification, 'no_publicada');
    assert.deepEqual(await fixture.query('SELECT * FROM tareas WHERE id=$1', [piece.taskId]), taskBefore);
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM editorial_publicacion_eventos WHERE dominio=$1 AND pieza_id=$2', [domain, piece.id]))[0].n, 2);
  });
  await t.test('same-name nonmember reads team reports by role without gaining personal scope or editorial write authority', async () => {
    const before = await snapshot();
    const data = await report(impostor);
    const home = checked(await api('/inicio', impostor));
    assert.equal(home.user.id, 107002);
    assert.equal(home.review.scope, 'personal');
    for (const domain of Object.keys(domains)) for (const piece of pieces.filter(p => p.domain === domain)) {
      const row = data[domains[domain]].find(row => row.id === piece.id);
      await validate(row, piece);
      assert.equal(JSON.stringify(row).includes(sentinel), false);
      assert.equal(JSON.stringify(row).includes('783456.91'), false);
      for (const rows of [home.tasks, home.review.items, home.activity])
        assert.equal(rows.some(row => (row.task_id ?? row.id) === piece.taskId), false);
      checked(await api(`/editorial-publicacion/${domain}/${piece.id}/confirmar`, impostor, 'POST', {
        request_id: randomUUID(), expected_revision: (await status(piece)).piece.revision,
        occurred_at: '2026-08-01T02:30:00Z',
      }), 403);
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('Córdoba actual-month counts differ from planned cohort and remain independently SQL-verifiable', async () => {
    const edge = [];
    for (const domain of Object.keys(domains)) {
      const july = await seed(domain); const august = await seed(domain, { clientId: clients[1].id });
      await confirm(july, '2026-08-01T02:59:59Z'); await confirm(august, '2026-08-01T03:00:00Z');
      edge.push(july, august);
    }
    const counts = await fixture.query(`SELECT to_char(e.occurred_at AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS month,count(*)::int AS n
      FROM editorial_publicacion_eventos e JOIN editorial_publicacion_versiones v
        ON v.current_event_id=e.id AND v.dominio=e.dominio AND v.pieza_id=e.pieza_id
      WHERE e.action='confirmar' AND e.source='manual' GROUP BY 1 ORDER BY 1`);
    assert.deepEqual(counts, [{ month: '2026-07', n: 2 }, { month: '2026-08', n: 2 }]);
    const lists = { historias: await list('historia'), publicaciones: await list('publicacion') };
    for (const piece of edge) await validate(lists[domains[piece.domain]].find(row => row.id === piece.id), piece);
    const { getResumenClientes, getTotalesCartera } = await import('../../frontend/src/clientesStats.js');
    const clientRows = checked(await api('/clientes')).filter(row => clients.some(client => client.id === row.id));
    const rows = getResumenClientes(clientRows, lists.historias, lists.publicaciones, { mes: '2026-07', avanceDelMes: 1 });
    const totals = getTotalesCartera(rows);
    assert.equal(totals.historiasPublicadas, 2); assert.equal(totals.reelsPublicados, 2);
    assert.equal(totals.piezasPublicadas, 4, 'Shared feed and stable piece IDs must not duplicate confirmed credit');
    assert.equal(totals.cuotaReels, 4, 'Existing shared-feed quota counted once');
    const duplicated = getTotalesCartera(getResumenClientes(clientRows, [...lists.historias, ...lists.historias], [...lists.publicaciones, ...lists.publicaciones], { mes: '2026-07', avanceDelMes: 1 }));
    assert.equal(duplicated.piezasPublicadas, 4, 'Repeated DTO IDs must not inflate confirmed counts');
    for (const invalidate of [
      row => { delete row.publicacion_evidencia; },
      row => { if (row.publicacion_evidencia?.confirmation) row.publicacion_evidencia.confirmation.source = 'external'; },
      row => { if (row.publicacion_evidencia?.confirmation) row.publicacion_evidencia.confirmation.actor_id = 0; },
      row => { if (row.publicacion_evidencia?.confirmation) row['fecha_publicación_real'] = '2026-08-02T03:00:00.000Z'; },
    ]) {
      const changed = structuredClone(lists);
      for (const row of [...changed.historias, ...changed.publicaciones]) invalidate(row);
      const invalidTotals = getTotalesCartera(getResumenClientes(clientRows, changed.historias, changed.publicaciones, { mes: '2026-07', avanceDelMes: 1 }));
      assert.equal(invalidTotals.piezasPublicadas, 0, 'Absent/malformed/inconsistent evidence earns no confirmed credit despite old state/date');
    }
  });
  await t.test('copy preserves current evidence; client/state/date/type/archive changes invalidate without restoration', async () => {
    for (const domain of Object.keys(domains)) {
      const piece = await seed(domain); const initial = await confirm(piece, '2026-08-01T03:00:00Z');
      await fixture.query(`UPDATE ${domains[domain]} SET copy='QA revised copy' WHERE id=$1`, [piece.id]);
      assert.equal((await reads(piece, staff)).row.publicacion_evidencia.confirmation.id, initial.result.operation.id);
      for (const [change, restore] of [
        ["estado='lista'", "estado='publicada'"],
        ['cliente_id=' + clients[1].id, 'cliente_id=' + clients[0].id],
        ['"fecha_publicación_real"=\'2026-08-02T03:00:00Z\'', '"fecha_publicación_real"=\'2026-08-01T03:00:00Z\''],
        ...(domain === 'publicacion' ? [["tipo='carrusel'", "tipo='video'"]] : []),
      ]) {
        await fixture.query(`UPDATE ${domains[domain]} SET ${change} WHERE id=$1`, [piece.id]);
        await fixture.query(`UPDATE ${domains[domain]} SET ${restore} WHERE id=$1`, [piece.id]);
        assert.equal((await reads(piece)).row.publicacion_evidencia.confirmation, null);
        await confirm(piece, '2026-08-01T03:00:00Z');
      }
      await fixture.query(`UPDATE ${domains[domain]} SET metadata=metadata||'{"archivado_tablero":true}' WHERE id=$1`, [piece.id]);
      assert.equal((await list(domain)).some(row => row.id === piece.id), false);
      assert.equal((await report())[domains[domain]].some(row => row.id === piece.id), false);
      await fixture.query(`UPDATE ${domains[domain]} SET metadata=metadata-'archivado_tablero' WHERE id=$1`, [piece.id]);
      assert.equal((await reads(piece)).row.publicacion_evidencia.confirmation, null);
    }
  });
  await t.test('inactive client cannot retain attached confirmation in ordinary/report rows', async () => {
    const piece = await seed('publicacion'); await confirm(piece, '2026-08-01T03:00:00Z');
    await fixture.query('UPDATE clientes SET activo=false WHERE id=$1', [clients[0].id]);
    try {
      for (const token of [admin, staff]) for (const rows of [await list('publicacion', token), (await report(token)).publicaciones]) {
        const row = rows.find(row => row.id === piece.id);
        if (row) { await validate(row, piece); assert.equal(row.publicacion_evidencia.confirmation, null); }
      }
    } finally { await fixture.query('UPDATE clientes SET activo=true WHERE id=$1', [clients[0].id]); }
  });
  await t.test('real task completion and checklist metadata are never confirmation evidence', async () => {
    for (const domain of Object.keys(domains)) {
      const piece = await seed(domain, { forged: true });
      for (const estado of ['en_progreso', 'en_revision', 'aprobada', 'finalizada']) {
        const task = checked(await api(`/tareas/${piece.taskId}?workspace=render_os`));
        checked(await api(`/tareas/${piece.taskId}?workspace=render_os`, estado === 'aprobada' || estado === 'finalizada' ? admin : staff, 'PATCH',
          { estado, expected_revision: task.revision }));
      }
      for (const token of [admin, staff]) assert.equal((await reads(piece, token)).row.publicacion_evidencia.confirmation, null);
      assert.deepEqual(await fixture.query('SELECT * FROM editorial_publicacion_eventos WHERE dominio=$1 AND pieza_id=$2', [domain, piece.id]), []);
    }
  });
});
