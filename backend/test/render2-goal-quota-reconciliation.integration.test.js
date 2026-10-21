import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('monthly quota review: explicit 2→3→1→3 preserves canonical work and excludes extras from quota/link targets', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55727 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55727,
    url: 'postgresql://render2_fixture@127.0.0.1:55727/render2_local_test', identity });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => {
    const result = ok(await api('/login', null, 'POST', { usuario, password: fixturePassword }));
    assert.equal(typeof result.token, 'string'); return result.token;
  };
  const admin = await login('qa_franco'), employee = await login('qa_luciano');
  let reviewer = await login('qa_agustin');
  const period = '2026-10';
  const client = ok(await api('/clientes', admin, 'POST', { nombre: 'QA100 reconciled quota', rubro: 'Servicios',
    vigente_desde: period, cuota_reels: 2, cuota_carruseles: 0, dias_historias: [1], dias_reels: [2],
    dias_carruseles: [3], disenador_responsable: 'Augusto', abono_mensual: 817293.46 }), 201);
  assert.ok(Number.isSafeInteger(client.id));
  const prepare = { periodo: period, clave: `cliente-${client.id}`, responsables: [91003],
    responsables_por_formato: { video: [91003], carrusel: [91003] } };
  const readClient = async () => {
    const rows = ok(await api(`/clientes?periodo=${period}`, admin));
    const row = rows.find(item => item.id === client.id); assert.ok(row); return row;
  };
  const configure = async count => {
    const current = await readClient();
    const saved = ok(await api(`/clientes/${client.id}/configuraciones`, admin, 'POST', {
      nombre: current.nombre, rubro: 'Servicios', vigente_desde: period, cuota_reels: count, cuota_carruseles: 0,
      dias_historias: [1], dias_reels: [2], dias_carruseles: [3], disenador_responsable: 'Augusto',
      abono_mensual: 817293.46, expected_revision: current.agreement_revision,
    }));
    assert.equal(typeof saved.agreement_revision, 'string');
    assert.equal((await readClient()).cuota_reels, count);
  };
  const privacy = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(/abono|importe|password|token|financial|agreement_revision/i.test(key), false, 'Goal DTO must not include private agreement fields');
      privacy(child);
    }
  };
  const goal = async (token = admin) => {
    const data = ok(await api(`/cliente-objetivos?periodo=${period}`, token)); privacy(data);
    assert.equal(JSON.stringify(data).includes('817293.46'), false);
    const row = data.clientes.find(item => item.clave === prepare.clave); assert.ok(row);
    assert.match(row.preparacion_revision, /^[0-9a-f]{64}$/);
    assert.match(row.cuota_revision, /^[0-9a-f]{64}$/);
    assert.equal(typeof row.cuota_desactualizada, 'boolean');
    for (const piece of row.piezas) assert.equal(typeof piece.en_cuota, 'boolean');
    return row;
  };
  const observedPreparation = async (token = admin) => {
    const data = ok(await api(`/cliente-objetivos?periodo=${period}`, token)); privacy(data);
    assert.equal(data.periodo, period);
    const row = data.clientes.find(item => item.clave === prepare.clave); assert.ok(row);
    assert.match(row.preparacion_revision, /^[0-9a-f]{64}$/);
    return { ...prepare, expected_preparation_revision: row.preparacion_revision };
  };
  // Reconciliation has its own closed observation contract, never the
  // preparation token returned by observedPreparation.
  const review = (observed, token = admin) => api('/cliente-objetivos/reconciliar', token, 'POST', {
    ...prepare, expected_quota_revision: observed.cuota_revision,
  });
  const tables = ['clientes', 'cliente_configuraciones', 'cliente_abonos', 'grupos_feed', 'tareas', 'tarea_asignaciones',
    'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'cliente_objetivo_vinculos',
    'cliente_objetivo_responsables', 'cliente_objetivo_cuota_revisiones', 'publicaciones', 'historias',
    'task_editing_deliveries', 'task_editing_reviews', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos',
    'produccion_visitas', 'produccion_videos'];
  const snapshot = async () => {
    const result = {};
    for (const name of tables) result[name] = await f.query(`SELECT * FROM ${name} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const pieceIds = row => row.piezas.map(piece => [piece.numero, piece.id, piece.tarea_id]).sort((a, b) => a[0] - b[0]);
  const task = id => api(`/tareas/${id}?workspace=render_os`, admin).then(response => ok(response));
  let initial, expanded, videoVisit, videoId, thirdSelection, standalone;

  await t.test('prepare two through API, then new configuration reports drift; GET and ordinary prepare cannot accept it', async () => {
    ok(await api('/cliente-objetivos/preparar', admin, 'POST', await observedPreparation()));
    initial = await goal(); assert.equal(initial.reels, 2); assert.equal(initial.piezas.length, 2);
    assert.equal(initial.piezas.every(piece => piece.en_cuota), true);
    await configure(3);
    const before = await snapshot(), observed = await goal(employee);
    assert.equal(observed.reels, 2); assert.deepEqual(observed.cuota_actual, { reels: 3, carruseles: 0 });
    assert.equal(observed.cuota_desactualizada, true);
    ok(await api('/cliente-objetivos/preparar', admin, 'POST', await observedPreparation()), 409);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('admin explicit review adds only missing slot/task; nonadmin is denied without writes', async () => {
    const observed = await goal(), before = await snapshot();
    ok(await review(observed, employee), 403); assert.deepEqual(await snapshot(), before);
    ok(await review(observed));
    expanded = await goal();
    assert.equal(expanded.reels, 3); assert.equal(expanded.cuota_desactualizada, false);
    assert.equal(expanded.piezas.length, 3);
    assert.deepEqual(pieceIds(expanded).slice(0, 2), pieceIds(initial));
    const after = await snapshot();
    assert.equal(after.tareas.length, before.tareas.length + 1);
    assert.equal(after.cliente_objetivo_cuota_revisiones.length, before.cliente_objetivo_cuota_revisiones.length + 1);
    for (const name of ['publicaciones', 'historias', 'editorial_publicacion_eventos']) assert.deepEqual(after[name], before[name]);
    const repeated = await review(observed);
    assert.ok([200, 409].includes(repeated.status));
    assert.deepEqual(await snapshot(), after, 'Duplicate confirmation must not add tasks or audit history');
  });

  await t.test('real artifact approval/finalization completes slot2 only; cache candidates for pending slot3', async () => {
    const second = expanded.piezas.find(piece => piece.numero === 2);
    let current = await task(second.tarea_id);
    ok(await api(`/tareas/${current.id}?workspace=render_os`, employee, 'PATCH', { estado: 'en_progreso', expected_revision: current.revision }));
    current = await task(current.id);
    const delivery = ok(await api(`/tareas-edicion/${current.id}/entregas`, employee, 'POST', {
      request_id: randomUUID(), expected_revision: current.revision, url: 'https://example.invalid/qa100-delivery', notes: 'QA100 exact artifact',
    }), 201);
    current = await task(current.id);
    ok(await api(`/tareas/${current.id}?workspace=render_os`, admin, 'PATCH', {
      estado: 'aprobada', expected_revision: current.revision, expected_entrega_id: delivery.delivery_id,
    }));
    current = await task(current.id);
    ok(await api(`/tareas/${current.id}?workspace=render_os`, admin, 'PATCH', { estado: 'finalizada', expected_revision: current.revision }));
    assert.ok((await goal()).piezas.find(piece => piece.id === second.id).completada_at);
    standalone = ok(await api('/tareas', admin, 'POST', { titulo: 'QA100 standalone reel', tipo_tarea: 'edicion', subtipo: 'video',
      workspace: 'render_os', cliente_id: client.id, fecha_vencimiento: '2026-10-29', asignado_a_id: 91003 }), 201);
    videoVisit = ok(await api('/producciones', admin, 'POST', { request_id: randomUUID(), cliente_id: client.id,
      fecha: '2026-10-25', titulo: 'QA100 candidate inspection', participante_ids: [91003] }), 201).visita;
    videoVisit = ok(await api(`/producciones/${videoVisit.id}/videos`, admin, 'POST', { expected_revision: videoVisit.revision,
      titulo: 'QA100 explicit video', guion: '', estado: 'grabado', material_url: 'https://example.invalid/qa100', observaciones: '' }), 201).visita;
    videoId = videoVisit.videos[0].id;
    const candidates = ok(await api(`/producciones/${videoVisit.id}/videos/${videoId}/vinculo?periodo=${period}`, admin));
    thirdSelection = candidates.casilleros.find(row => row.objetivo_pieza_id === expanded.piezas.find(piece => piece.numero === 3).id);
    assert.ok(thirdSelection, 'slot3 must be a genuine pre-decrease candidate');
  });

  await t.test('configuration/version changes while review is open reject stale confirmation atomically', async () => {
    await configure(1);
    const observed = await goal();
    await configure(1); // Same numeric quota, new source version: still a new observation.
    let before = await snapshot();
    ok(await review(observed), 409); assert.deepEqual(await snapshot(), before);
    const newer = await goal(), first = newer.piezas.find(piece => piece.numero === 1), current = await task(first.tarea_id);
    ok(await api(`/tareas/${current.id}?workspace=render_os`, admin, 'PATCH', { titulo: 'QA100 independently edited', expected_revision: current.revision }));
    before = await snapshot();
    ok(await review(newer), 409); assert.deepEqual(await snapshot(), before);
  });

  await t.test('decrease retains every piece/task/artifact/event byte-for-byte while only slot1 counts', async () => {
    const before = await snapshot(); ok(await review(await goal()));
    const reduced = await goal(employee);
    assert.equal(reduced.reels, 1); assert.equal(reduced.cuota_desactualizada, false);
    assert.deepEqual(pieceIds(reduced), pieceIds(expanded));
    assert.deepEqual(reduced.piezas.map(row => [row.numero, row.en_cuota]).sort((a, b) => a[0] - b[0]), [[1, true], [2, false], [3, false]]);
    assert.equal(reduced.piezas.filter(row => row.en_cuota && ['finalizada', 'publicada'].includes(row.estado)).length, 0);
    assert.equal(reduced.piezas.filter(row => ['finalizada', 'publicada'].includes(row.estado)).length, 1);
    const after = await snapshot();
    for (const name of tables.filter(name => !['cliente_objetivos_mensuales', 'cliente_objetivo_cuota_revisiones', 'cliente_objetivo_responsables'].includes(name)))
      assert.deepEqual(after[name], before[name], name);
    assert.equal(after.cliente_objetivo_cuota_revisiones.length, before.cliente_objetivo_cuota_revisiones.length + 1);
  });

  await t.test('both candidate readers exclude extras; forged stale selection cannot relink or create publication', async () => {
    const reduced = await goal(), extraIds = reduced.piezas.filter(row => !row.en_cuota).map(row => row.id);
    const options = ok(await api(`/cliente-objetivos/tareas/${standalone.id}/vinculo?periodo=${period}`, admin));
    assert.equal(options.casilleros.some(row => extraIds.includes(row.id)), false);
    const candidates = ok(await api(`/producciones/${videoVisit.id}/videos/${videoId}/vinculo?periodo=${period}`, admin));
    assert.equal([...candidates.casilleros, ...candidates.publicaciones].some(row => extraIds.includes(row.objetivo_pieza_id)), false);
    const third = reduced.piezas.find(row => row.numero === 3), current = await task(standalone.id), before = await snapshot();
    ok(await api(`/cliente-objetivos/piezas/${third.id}/vincular`, admin, 'POST', { tarea_id: standalone.id,
      expected_tarea_updated_at: current.updated_at, expected_pieza_updated_at: third.updated_at }), 409);
    ok(await api(`/producciones/${videoVisit.id}/videos/${videoId}/vincular-objetivo`, admin, 'POST', {
      expected_revision: videoVisit.revision, tarea_id: thirdSelection.tarea_id,
      expected_tarea_revision: thirdSelection.tarea_revision, objetivo_pieza_id: thirdSelection.objetivo_pieza_id,
      expected_objetivo_updated_at: thirdSelection.objetivo_updated_at, fecha_programada: '2026-10-29',
    }), 409);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('increase restores existing IDs/history without generating work again; fresh login sees result', async () => {
    await configure(3); const before = await snapshot(); ok(await review(await goal()));
    const after = await snapshot();
    for (const name of ['tareas', 'tarea_asignaciones', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
      'task_editing_deliveries', 'task_editing_reviews', 'publicaciones', 'editorial_publicacion_eventos']) assert.deepEqual(after[name], before[name], name);
    const fresh = await goal(await login('qa_luciano'));
    assert.deepEqual(pieceIds(fresh), pieceIds(expanded)); assert.equal(fresh.piezas.every(row => row.en_cuota), true);
  });

  await t.test('current DB role and revoked session reject review with no side effects', async () => {
    await configure(1); const observed = await goal();
    await f.query("UPDATE usuarios SET rol='edicion' WHERE id=91002");
    try { const before = await snapshot(); ok(await review(observed, reviewer), 403); assert.deepEqual(await snapshot(), before); }
    finally { await f.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    reviewer = await login('qa_agustin'); await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    const before = await snapshot(); ok(await review(observed, reviewer), 401); assert.deepEqual(await snapshot(), before);
  });
});
