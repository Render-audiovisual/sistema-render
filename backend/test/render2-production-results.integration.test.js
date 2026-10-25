import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';
import { loadProductionReport } from '../src/production-reporting.js';

test('production result journal preserves partial evidence without completing tasks or consuming pending media', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 300000,
}, async t => {
  const port = 55938, f = await startLocalHarness({ port });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic('Owned production results fixture stopped and removed.');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  const tokens = new Map();
  for (const [id, usuario] of [[91001, 'qa_franco'], [91003, 'qa_luciano']]) {
    const login = await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(login.status, 200); assert.equal(login.body.usuario.id, id);
    assert.equal(typeof login.body.token, 'string'); tokens.set(id, login.body.token);
  }
  const api = (path, method = 'GET', body, actor = 91001) => request(f.base, '/api' + path, {
    method, body, token: tokens.get(actor),
  });
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA319 result journal',true) RETURNING id");
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.includes('produccion_resultados'));
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded = []) {
    const hashes = {};
    for (const table of tables.filter(name => !excluded.includes(name))) {
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table] = row.hash;
    }
    return hashes;
  }
  let serial = 0;
  async function visit(planned = null) {
    if (planned !== null) {
      const created = await api('/tareas', 'POST', { request_id: randomUUID(), workspace: 'render_os',
        titulo: `QA319 Visita origin ${++serial}`, asignado_a_id: 91001, colaborador_ids: [], cliente_id: client.id,
        tipo_tarea: 'produccion', fecha_vencimiento: '2026-10-29', produccion_videos_previstos: planned });
      assert.equal(created.status, 201);
      const [row] = await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [created.body.task.id]);
      assert.ok(row);
      const read = await api(`/producciones/${row.id}`); assert.equal(read.status, 200);
      return read.body.visita;
    }
    const created = await api('/producciones', 'POST', { cliente_id: client.id, fecha: '2026-10-29',
      titulo: `QA319 standalone ${++serial}`, participante_ids: [91001, 91003],
      observaciones: 'QA319 visit notes', drive_url: 'https://example.invalid/visit-material' });
    assert.equal(created.status, 201); return created.body.visita;
  }
  async function item(current, kind, fields) {
    const result = await api(`/producciones/${current.id}/${kind}`, 'POST', { expected_revision: current.revision, ...fields });
    assert.equal(result.status, 201); return result.body.visita;
  }
  const save = (current, requestId = randomUUID(), actor = 91001) => api(`/producciones/${current.id}/resultados`, 'POST', {
    request_id: requestId, expected_revision: current.revision,
  }, actor);
  const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
  const journalRaw = id => f.query('SELECT to_jsonb(r) AS row FROM produccion_resultados r WHERE id=$1', [id]);
  let mixed, saved, requestId, frozenRow;

  await t.test('four recorded videos, two pending scripts and three photo types produce one immutable partial snapshot only', async () => {
    mixed = await visit(6);
    const edited = await api(`/producciones/${mixed.id}`, 'PATCH', { expected_revision: mixed.revision,
      participante_ids: [91001, 91003], observaciones: 'QA319 preserved visit notes', drive_url: 'https://example.invalid/master-drive' });
    assert.equal(edited.status, 200); mixed = edited.body.visita;
    for (let index = 0; index < 6; index++) mixed = await item(mixed, 'videos', {
      titulo: `QA319 video ${index}`, guion: `QA319 original script ${index}\nSecond line`,
      estado: index < 4 ? 'grabado' : 'pendiente', material_url: `https://example.invalid/video/${index}`,
      observaciones: `QA319 video notes ${index}`,
    });
    for (const [index, estado] of ['realizada', 'pendiente', 'repetir'].entries()) mixed = await item(mixed, 'fotos', {
      tipo: `QA319 photo type ${index}`, estado, drive_url: `https://example.invalid/photo/${index}`, observaciones: `QA319 photo notes ${index}`,
    });
    const before = await snapshot(['produccion_resultados', 'produccion_visitas']);
    const beforeVisits = await f.query('SELECT to_jsonb(v) AS row FROM produccion_visitas v WHERE id=$1', [mixed.id]);
    requestId = randomUUID(); const result = await save(mixed, requestId);
    assert.equal(result.status, 201); assert.equal(result.body.created, true); saved = result.body.resultado;
    assert.equal(saved.visita_id, mixed.id); assert.equal(saved.visita_revision, mixed.revision);
    assert.equal(saved.revision_resultante, mixed.revision + 1); assert.equal(saved.registrado_por_id, 91001);
    assert.equal(saved.vigente, true); assert.ok(Number.isFinite(Date.parse(saved.registrado_at)));
    assert.deepEqual(saved.resumen, { version: 1,
      visita: pick(mixed, ['id', 'tarea_origen_id', 'cliente_id', 'fecha', 'titulo', 'participante_ids', 'drive_url', 'observaciones']),
      videos: mixed.videos.map(row => pick(row, ['id', 'video_origen_id', 'titulo', 'guion', 'estado', 'material_url', 'observaciones'])),
      fotos: mixed.fotos.map(row => pick(row, ['id', 'tipo', 'estado', 'drive_url', 'observaciones'])),
      previstos: 6, conteos: { videos_grabados: 4, videos_pendientes: 2, videos_repetir: 0,
        fotos_realizadas: 1, fotos_pendientes: 1, fotos_repetir: 1 }, parcial: true,
    });
    assert.deepEqual(await snapshot(['produccion_resultados', 'produccion_visitas']), before);
    const afterVisit = (await f.query('SELECT to_jsonb(v) AS row FROM produccion_visitas v WHERE id=$1', [mixed.id]))[0].row;
    assert.deepEqual(afterVisit, { ...beforeVisits[0].row, revision: mixed.revision + 1,
      actualizado_por_id: 91001, updated_at: afterVisit.updated_at });
    assert.equal((await f.query('SELECT id FROM produccion_resultados WHERE visita_id=$1', [mixed.id])).length, 1);
    frozenRow = await journalRaw(saved.id);
  });

  await t.test('shared visit, task, client and report projections expose only the same current result evidence', async () => {
    const before=await snapshot();
    const expected=pick(saved,['id','visita_revision','revision_resultante','registrado_at','vigente']);
    expected.parcial=true;
    const detail=await api(`/producciones/${mixed.id}`,'GET',undefined,91003);
    assert.equal(detail.status,200);assert.deepEqual(detail.body.visita.ultimo_resultado,expected);
    const task=await api(`/producciones/tareas/${mixed.tarea_origen_id}`,'GET',undefined,91003);
    assert.equal(task.status,200);assert.deepEqual(task.body.vinculo.ultimo_resultado,expected);
    const hub=await api(`/clientes/${client.id}/operacion?periodo=2026-10`,'GET',undefined,91003);
    assert.equal(hub.status,200);assert.deepEqual(hub.body.producciones.items.find(row=>row.id===mixed.id).ultimo_resultado,expected);
    const report=await loadProductionReport({query:async(sql,values)=>({rows:await f.query(sql,values)})},{desde:'2026-10-01',hasta:'2026-11-01'});
    assert.deepEqual(report.visitas.find(row=>row.id===mixed.id).ultimo_resultado,expected);
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('same UUID replays, recovery is actor-owned, stale/new UUID and changed intent do not write', async () => {
    assert.ok(saved); const before = await snapshot();
    const replay = await save(mixed, requestId); assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, { created: false, resultado: saved });
    const recovered = await api(`/producciones/${mixed.id}/resultados/intentos/${requestId}`);
    assert.equal(recovered.status, 200); assert.deepEqual(recovered.body.resultado, saved);
    const shared = await api(`/producciones/${mixed.id}/resultados`, 'GET', undefined, 91003);
    assert.equal(shared.status,200);assert.deepEqual(shared.body.resultados,[saved]);
    const foreign = await api(`/producciones/${mixed.id}/resultados/intentos/${requestId}`, 'GET', undefined, 91003);
    const absent = await api(`/producciones/${mixed.id}/resultados/intentos/${randomUUID()}`);
    assert.equal(foreign.status, 404); assert.equal(absent.status, 404); assert.deepEqual(foreign.body, absent.body);
    assert.equal((await save(mixed)).status, 409);
    assert.equal((await save({ ...mixed, revision: saved.revision_resultante }, requestId)).status, 409);
    assert.equal((await save({ ...mixed, revision: saved.revision_resultante })).status, 409);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('journal UPDATE and DELETE fail without modifying history', async () => {
    assert.ok(saved); const before = await snapshot();
    await assert.rejects(f.query("UPDATE produccion_resultados SET resumen=resumen||'{\"parcial\":false}'::jsonb WHERE id=$1", [saved.id]));
    await assert.rejects(f.query('DELETE FROM produccion_resultados WHERE id=$1', [saved.id]));
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await journalRaw(saved.id), frozenRow);
  });

  await t.test('later edits obsolete the snapshot; correction appends and original pending can still be resumed', async () => {
    assert.ok(saved);
    const pending = mixed.videos.find(row => row.estado === 'pendiente');
    const changed = await api(`/producciones/${mixed.id}/videos/${pending.id}`, 'PATCH', {
      expected_revision: saved.revision_resultante, guion: 'QA319 corrected script', estado: 'repetir',
    });
    assert.equal(changed.status, 200); const current = changed.body.visita;
    assert.equal(current.ultimo_resultado.id,saved.id);assert.equal(current.ultimo_resultado.vigente,false);
    const before = await snapshot(['produccion_resultados', 'produccion_visitas']);
    const correction = await save(current); assert.equal(correction.status, 201);
    assert.notEqual(correction.body.resultado.id, saved.id); assert.equal(correction.body.resultado.vigente, true);
    assert.equal(correction.body.resultado.resumen.conteos.videos_repetir, 1);
    assert.deepEqual(await snapshot(['produccion_resultados', 'produccion_visitas']), before);
    assert.deepEqual(await journalRaw(saved.id), frozenRow);
    const list = await api(`/producciones/${mixed.id}/resultados`);
    assert.equal(list.status, 200); assert.equal(list.body.revision, current.revision + 1);
    assert.equal(list.body.resultados.length, 2); assert.equal(list.body.next_before_revision, null);
    assert.equal(list.body.resultados[0].id, correction.body.resultado.id);
    assert.equal(list.body.resultados[1].id, saved.id); assert.equal(list.body.resultados[1].vigente, false);
    const replay = await save(mixed, requestId); assert.equal(replay.status, 200);
    assert.equal(replay.body.resultado.vigente, false); assert.deepEqual(replay.body.resultado.resumen, saved.resumen);
    const destination = await visit();
    const resumeBaseline = await snapshot(['produccion_videos', 'produccion_visitas']);
    const resumed = await item(destination, 'videos', { video_origen_id: pending.id, estado: 'pendiente' });
    const child = resumed.videos.find(row => row.video_origen_id === pending.id);
    assert.ok(child); assert.equal(child.titulo, pending.titulo); assert.equal(child.guion, 'QA319 corrected script');
    assert.deepEqual(await snapshot(['produccion_videos', 'produccion_visitas']), resumeBaseline);
    assert.deepEqual(await journalRaw(saved.id), frozenRow);
  });

  for (const [label, planned, states, status] of [
    ['empty media', null, [], 400], ['planned count exceeds registered videos', 2, ['grabado'], 400],
    ['unclassified video', null, ['planificado'], 400], ['pending without script', null, ['pendiente'], 400],
    ['repeat without script', null, ['repetir'], 400],
  ]) await t.test(`${label} rejects with all business tables unchanged`, async () => {
    let current = await visit(planned);
    for (const estado of states) current = await item(current, 'videos', { titulo: `QA319 ${label}`, estado, guion: '' });
    const before = await snapshot(); assert.equal((await save(current)).status, status);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('photos-only pending and all-pending scripts are valid failed/partial results without invented recording', async () => {
    for (const photosOnly of [true, false]) {
      let current = await visit();
      current = photosOnly ? await item(current, 'fotos', { tipo: 'QA319 pending photos', estado: 'pendiente' })
        : await item(current, 'videos', { titulo: 'QA319 failed visit', estado: 'pendiente', guion: 'QA319 retained script' });
      const before = await snapshot(['produccion_resultados', 'produccion_visitas']);
      const result = await save(current); assert.equal(result.status, 201);
      assert.equal(result.body.resultado.resumen.previstos, 0); assert.equal(result.body.resultado.resumen.parcial, true);
      assert.equal(result.body.resultado.resumen.conteos.videos_grabados, 0);
      assert.equal(result.body.resultado.resumen.conteos.fotos_realizadas, 0);
      assert.deepEqual(await snapshot(['produccion_resultados', 'produccion_visitas']), before);
    }
  });

  await t.test('closed body, stale CAS, unknown query and invalid recovery reject without writes', async () => {
    let current = await visit(); current = await item(current, 'fotos', { tipo: 'QA319 CAS photo', estado: 'realizada' });
    const before = await snapshot();
    for (const body of [{}, { request_id: randomUUID(), expected_revision: String(current.revision) },
      { request_id: randomUUID(), expected_revision: current.revision, observaciones: 'not a second notes form' },
      { request_id: 'invalid', expected_revision: current.revision }]) {
      assert.equal((await api(`/producciones/${current.id}/resultados`, 'POST', body)).status, 400);
    }
    assert.equal((await save({ ...current, revision: current.revision - 1 })).status, 409);
    assert.equal((await api(`/producciones/${current.id}/resultados?unknown=1`)).status, 400);
    assert.equal((await api(`/producciones/${current.id}/resultados/intentos/invalid`)).status, 400);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('concurrent same-actor UUID creates exactly one event and one revision bump', async () => {
    let current = await visit(); current = await item(current, 'fotos', { tipo: 'QA319 concurrent photo', estado: 'realizada' });
    const before = await snapshot(['produccion_resultados', 'produccion_visitas']);
    const id = randomUUID(), responses = await Promise.all([save(current, id), save(current, id)]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 201]);
    assert.equal(responses[0].body.resultado.id, responses[1].body.resultado.id);
    assert.equal(responses.filter(row => row.body.created === true).length, 1);
    assert.equal((await f.query('SELECT revision FROM produccion_visitas WHERE id=$1', [current.id]))[0].revision, current.revision + 1);
    assert.equal((await f.query('SELECT id FROM produccion_resultados WHERE visita_id=$1', [current.id])).length, 1);
    assert.deepEqual(await snapshot(['produccion_resultados', 'produccion_visitas']), before);
  });
  await t.test('an active editor may record a result without changing other domain tables',async()=>{
    let current=await visit();current=await item(current,'fotos',{tipo:'QA319 team record',estado:'realizada'});
    const before=await snapshot(['produccion_resultados','produccion_visitas']);
    const result=await save(current,randomUUID(),91003);
    assert.equal(result.status,201);assert.equal(result.body.resultado.registrado_por_id,91003);
    assert.deepEqual(await snapshot(['produccion_resultados','produccion_visitas']),before);
  });
  await t.test('photos cannot hide unreconciled aggregate history from a result snapshot',async()=>{
    let current=await visit();current=await item(current,'fotos',{tipo:'QA319 historical photos',estado:'realizada'});
    const [source]=await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,propiedades_extra)
      VALUES('QA319 Visita histórica','Franco QA',$1,'produccion','pendiente',$2::jsonb) RETURNING id`,
      [client.id,JSON.stringify({workspace:'render_os',produccion_registros:[{cantidad:4,fecha:'2026-10-20'}]})]);
    await f.query('UPDATE produccion_visitas SET tarea_origen_id=$2 WHERE id=$1',[current.id,source.id]);
    // Reload the historical source binding before testing its review guard.
    const refreshed=await api(`/producciones/${current.id}`);assert.equal(refreshed.status,200);current=refreshed.body.visita;
    const before=await snapshot();
    const denied=await save(current);assert.equal(denied.status,409);assert.match(denied.body.error,/histórica|revisión manual/);
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('twenty-item cursor pages retain every historical snapshot and GETs perform zero DML', async () => {
    let current = await visit(); current = await item(current, 'fotos', { tipo: 'QA319 paged photo', estado: 'realizada' });
    const events = [];
    for (let index = 0; index < 21; index++) {
      if (index) {
        const edited = await api(`/producciones/${current.id}`, 'PATCH', {
          expected_revision: current.revision, observaciones: `QA319 correction ${index}`,
        });
        assert.equal(edited.status, 200); current = edited.body.visita;
      }
      const result = await save(current); assert.equal(result.status, 201);
      events.push(result.body.resultado);
      current = { ...current, revision: result.body.resultado.revision_resultante };
    }
    const before = await snapshot();
    const first = await api(`/producciones/${current.id}/resultados`); assert.equal(first.status, 200);
    assert.equal(first.body.visita_id, current.id); assert.equal(first.body.revision, current.revision);
    assert.equal(first.body.resultados.length, 20);
    assert.deepEqual(first.body.resultados.map(row => row.id), events.slice(1).reverse().map(row => row.id));
    assert.equal(first.body.next_before_revision, events[1].visita_revision);
    assert.deepEqual(first.body.resultados.map(row => row.vigente), [true, ...Array(19).fill(false)]);
    const second = await api(`/producciones/${current.id}/resultados?antes_revision=${first.body.next_before_revision}`);
    assert.equal(second.status, 200); assert.equal(second.body.next_before_revision, null);
    assert.deepEqual(second.body.resultados, [{ ...events[0], vigente: false }]);
    for (const event of first.body.resultados) {
      assert.deepEqual(event.resumen, events.find(row => row.id === event.id).resumen);
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('failure while bumping the visit rolls back the already inserted journal event and preserves the retry',async()=>{
    let current=await visit();current=await item(current,'fotos',{tipo:'QA319 rollback',estado:'realizada'});
    const before=await snapshot(),attempt=randomUUID();
    // A fault only inside this generated database, not a product code switch.
    await f.query(`CREATE FUNCTION qa319_fail_result_bump() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id='${current.id}'::uuid THEN RAISE EXCEPTION 'QA319 synthetic bump failure'; END IF; RETURN NEW; END $$`);
    await f.query('CREATE TRIGGER qa319_fail_result_bump BEFORE UPDATE ON produccion_visitas FOR EACH ROW EXECUTE FUNCTION qa319_fail_result_bump()');
    try {
      assert.equal((await save(current,attempt)).status,500);
      assert.deepEqual(await snapshot(),before);
      assert.equal((await api(`/producciones/${current.id}/resultados/intentos/${attempt}`)).status,404);
    } finally {
      await f.query('DROP TRIGGER qa319_fail_result_bump ON produccion_visitas');
      await f.query('DROP FUNCTION qa319_fail_result_bump()');
    }
    assert.equal((await save(current,attempt)).status,201);
  });
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
});
