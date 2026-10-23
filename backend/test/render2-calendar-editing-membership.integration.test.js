import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Principal HTTP plus an explicitly generated physical PostgreSQL fixture.
// No service imports, providers, browser claims or configured database access.
test('Home and Calendar.mine agree on ID-linked video editors without duplicating visits', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55792 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA140 own fixture cleaned ENOENT: ${fixture.root}; port55792`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55792,
    url: 'postgresql://render2_fixture@127.0.0.1:55792/render2_local_test', identity });
  const checked = (result, status = 200) => {
    assert.equal(result.status, status, 'Unexpected principal HTTP status; do not print authentication payloads');
    return result.body;
  };
  const api = (path, token, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const login = async usuario => checked(await api('/login', undefined, 'POST', { usuario, password: fixturePassword })).token;
  const owner = { id: 91001, token: await login('qa_franco') };
  const editor = { id: 91003, token: await login('qa_luciano') };
  const outsider = { id: 91004, token: await login('qa_designer') };
  const [clock] = await fixture.query(`SELECT
    to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today,
    to_char((clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date+1,'YYYY-MM-DD') AS tomorrow,
    to_char((clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date+8,'YYYY-MM-DD') AS until`);
  const client = checked(await api('/clientes', owner.token, 'POST', { nombre: 'QA140 linked-video calendar client' }), 201);
  const otherClient = checked(await api('/clientes', owner.token, 'POST', { nombre: 'QA140 other calendar client' }), 201);
  let visit = checked(await api('/producciones', owner.token, 'POST', {
    request_id: randomUUID(), cliente_id: client.id, fecha: clock.tomorrow, titulo: 'QA140 one visit two editing memberships',
    participante_ids: [owner.id], drive_url: 'https://example.invalid/qa140/raw-material', observaciones: 'Synthetic ordinary visit, no historical source',
  }), 201).visita;
  const visitId = visit.id;
  assert.equal(visit.tarea_origen_id, null);
  assert.deepEqual(visit.participante_ids, [owner.id]);
  const links = [];
  for (let index = 0; index < 2; index++) {
    const title = `QA140 recorded video ${index + 1}`;
    visit = checked(await api(`/producciones/${visitId}/videos`, owner.token, 'POST', {
      expected_revision: visit.revision, titulo: title, guion: `QA explicit script ${index + 1}`,
      estado: 'grabado', material_url: `https://example.invalid/qa140/video-${index + 1}`,
    }), 201).visita;
    const video = visit.videos.find(row => row.titulo === title); assert.ok(video);
    const handed = checked(await api(`/producciones/${visitId}/videos/${video.id}/enviar-edicion`, owner.token, 'POST', {
      expected_revision: visit.revision, editor_id: editor.id, fecha_entrega: clock.tomorrow,
    }), 201);
    assert.equal(handed.created, true); assert.equal(handed.task.asignado_a_id, editor.id);
    links.push({ videoId: video.id, taskId: handed.task.id }); visit = handed.visita;
  }
  assert.equal(new Set(links.map(row => row.taskId)).size, 2);
  assert.deepEqual(await fixture.query(`SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones
    WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id,usuario_id,tipo`, [links.map(row => row.taskId)]),
  links.map(row => ({ tarea_id: row.taskId, usuario_id: editor.id, tipo: 'responsable' })).sort((a, b) => a.tarea_id - b.tarea_id));

  const tables = ['clientes', 'usuarios', 'tareas', 'tarea_asignaciones', 'tarea_comentarios', 'produccion_visitas',
    'produccion_visita_participantes', 'produccion_videos', 'produccion_fotos', 'historias', 'publicaciones',
    'editorial_publicacion_eventos', 'editorial_publicacion_versiones', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'];
  const snapshot = async () => {
    const rows = {};
    for (const table of tables) rows[table] = await fixture.query(`SELECT * FROM ${table} r ORDER BY to_jsonb(r)::text`);
    return rows;
  };
  const calendar = async (actor, scope = 'mine', clientId = client.id) => checked(await api(`/calendario?${new URLSearchParams({
    desde: clock.today, hasta: clock.until, scope, kind: 'visita', cliente_id: String(clientId),
  })}`, actor.token));
  const home = async actor => checked(await api('/inicio', actor.token));
  const visitRows = body => body.events.filter(row => row.source === 'visita' && row.source_id === visitId);
  const assertMembership = async (actor, included, responsibleIds) => {
    const principal = await home(actor), agenda = await calendar(actor);
    assert.equal(principal.user.id, actor.id);
    assert.equal(principal.visits.filter(row => row.id === visitId).length, Number(included), 'Home upcoming visit is unique and current-ID scoped');
    const events = visitRows(agenda);
    assert.equal(events.length, Number(included), 'Calendar.mine agrees with Home membership');
    assert.equal(agenda.truncated, false);
    if (included) {
      const event = events[0];
      assert.equal(event.key, `visita:visita:${visitId}`); assert.equal(event.date, clock.tomorrow);
      assert.equal(event.cliente_id, client.id); assert.equal(event.evidence, null);
      assert.deepEqual(event.responsable_ids, responsibleIds, 'Unique sorted participant/editor IDs, not two copies from two videos');
      assert.equal(new URL(event.href, 'https://render.test').searchParams.get('visita'), visitId);
    }
  };
  const archive = async taskId => {
    const current = checked(await api(`/tareas/${taskId}?workspace=render_os`, owner.token));
    checked(await api(`/tareas/${taskId}?workspace=render_os`, owner.token, 'PATCH', {
      expected_revision: current.revision, propiedades_extra: { archivada_render_os: true },
    }));
    const [stored] = await fixture.query('SELECT propiedades_extra FROM tareas WHERE id=$1', [taskId]);
    assert.equal(stored.propiedades_extra.archivada_render_os, true);
  };

  await t.test('two distinct video tasks give their editor one upcoming visit in both Home and mine', async () => {
    const before = await snapshot();
    await assertMembership(editor, true, [owner.id, editor.id]);
    await assertMembership(owner, true, [owner.id, editor.id]);
    assert.deepEqual(await snapshot(), before, 'Both GET projections are read-only');
  });

  await t.test('outsider mine excludes the visit, shared team includes it, and client filters intersect scope', async () => {
    const before = await snapshot();
    await assertMembership(outsider, false);
    const team = await calendar(outsider, 'team');
    assert.equal(visitRows(team).length, 1);
    assert.deepEqual(visitRows(team)[0].responsable_ids, [owner.id, editor.id]);
    for (const actor of [owner, editor, outsider]) for (const scope of ['mine', 'team']) {
      const other = await calendar(actor, scope, otherClient.id);
      assert.deepEqual(other.events, [], 'Other-client filter must not leak the target visit');
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('archiving one of two linked tasks keeps the remaining editor membership without duplicates', async () => {
    await archive(links[0].taskId);
    const before = await snapshot();
    await assertMembership(editor, true, [owner.id, editor.id]);
    await assertMembership(owner, true, [owner.id, editor.id]);
    await assertMembership(outsider, false);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('archiving the last visible linked task removes only editor membership, not the participant or visit', async () => {
    await archive(links[1].taskId);
    const before = await snapshot();
    await assertMembership(editor, false);
    await assertMembership(owner, true, [owner.id]);
    await assertMembership(outsider, false);
    const team = await calendar(editor, 'team');
    assert.equal(visitRows(team).length, 1); assert.deepEqual(visitRows(team)[0].responsable_ids, [owner.id]);
    assert.deepEqual(await fixture.query('SELECT usuario_id FROM produccion_visita_participantes WHERE visita_id=$1 ORDER BY usuario_id', [visitId]), [{ usuario_id: owner.id }]);
    assert.deepEqual(await fixture.query('SELECT id,tarea_edicion_id FROM produccion_videos WHERE visita_id=$1 ORDER BY id', [visitId]),
      links.map(row => ({ id: row.videoId, tarea_edicion_id: row.taskId })).sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(await snapshot(), before, 'Reads never unlink tasks, remove participants or rewrite production history');
  });
  // This bounded regression intentionally does not fabricate conflicting
  // tarea_entrega_id/tarea_edicion_id tuples forbidden by migration060.
});
