import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

test('real result/media writers serialize both queue orders without mixing the observed visit snapshot', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port = 55944, f = await startLocalHarness({ port });
  const connections = new Set(), operations = new Set();
  t.after(async () => {
    try {
      // Release our blockers before draining HTTP; never stop foreign handles.
      await Promise.all([...connections].map(db => db.query('ROLLBACK').catch(() => {})));
      await Promise.allSettled([...operations]);
      await Promise.all([...connections].map(db => db.end()));
    } finally {
      await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
      t.diagnostic('Owned result/edit race fixture stopped and removed.');
    }
  });
  const identitySql = `SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard = identity => assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  guard((await f.query(identitySql))[0]);
  async function auxiliary() {
    const db = new pg.Client({ host: '127.0.0.1', port, user: 'render2_fixture', password: '',
      database: 'render2_local_test', ssl: false, application_name: 'render2_qa327_result_edit',
      statement_timeout: 20000, lock_timeout: 18000, connectionTimeoutMillis: 5000 });
    await db.connect(); connections.add(db); guard((await db.query(identitySql)).rows[0]);
    db.pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid; return db;
  }
  const monitor = await auxiliary(), blocker = await auxiliary();
  const tokens = new Map();
  for (const [id, usuario] of [[91001, 'qa_franco'], [91003, 'qa_luciano']]) {
    const login = await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(login.status, 200); assert.equal(login.body.usuario.id, id);
    assert.equal(typeof login.body.token, 'string'); tokens.set(id, login.body.token);
  }
  async function api(path, method = 'GET', body, actor = 91001) {
    const response = await fetch(new URL('/api' + path, f.base), { method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${tokens.get(actor)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  function observe(promise) {
    operations.add(promise); const state = { promise, settled: false };
    promise.then(() => { state.settled = true; }, () => { state.settled = true; }); return state;
  }
  async function waitEdge(blockingPid, pending, stage) {
    const deadline = Date.now() + 7000;
    do {
      assert.equal(pending.settled, false, 'HTTP must still be waiting before release of the owned barrier');
      const { rows } = await monitor.query(`SELECT pid,
        query LIKE '%FROM produccion_visitas v JOIN clientes c%' AND query LIKE '%FOR UPDATE OF v%' AS visit_lock,
        query LIKE '%pg_advisory_xact_lock%' AND query LIKE '%vinculo-objetivo-mensual%' AS lineage_lock
        FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
          AND $1::int=ANY(pg_blocking_pids(pid)) AND pid<>ALL($2::int[])`,
      [blockingPid, [...connections].map(db => db.pid)]);
      if (rows.length) {
        assert.equal(rows.length, 1, 'Exactly the intended HTTP writer must wait on this blocker');
        assert.equal(rows[0][stage], true, 'The blocking edge must match the actual expected lock stage');
        return rows[0].pid;
      }
      await new Promise(resolve => setTimeout(resolve, 15));
    } while (Date.now() < deadline);
    assert.fail('Required PostgreSQL writer-to-blocker edge was not observed within seven seconds');
  }
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA327 result/edit serialization',true) RETURNING id");
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded = []) {
    const hashes = {};
    for (const table of tables.filter(name => !excluded.includes(name))) {
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table] = row.hash;
    }
    return hashes;
  }
  const rawVisit = async id => (await f.query('SELECT to_jsonb(v) AS row FROM produccion_visitas v WHERE id=$1', [id]))[0].row;
  const rawVideo = async id => (await f.query('SELECT to_jsonb(v) AS row FROM produccion_videos v WHERE id=$1', [id]))[0].row;
  const otherVisitsHash = async id => (await f.query(`SELECT md5(coalesce(jsonb_agg(
    jsonb_build_array(to_jsonb(v),v.xmin::text,v.ctid::text) ORDER BY v.id)::text,'[]')) AS hash
    FROM produccion_visitas v WHERE id<>$1`, [id]))[0].hash;
  const otherVideosHash = async id => (await f.query(`SELECT md5(coalesce(jsonb_agg(
    jsonb_build_array(to_jsonb(v),v.xmin::text,v.ctid::text) ORDER BY v.id)::text,'[]')) AS hash
    FROM produccion_videos v WHERE id<>$1`, [id]))[0].hash;
  const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
  async function setup(label) {
    const created = await api('/producciones', 'POST', { cliente_id: client.id, fecha: '2026-10-29', titulo: `QA327 ${label}`,
      participante_ids: [91001, 91003], observaciones: 'Original visit notes', drive_url: 'https://example.invalid/visit-drive' });
    assert.equal(created.status, 201); let visit = created.body.visita;
    const video = await api(`/producciones/${visit.id}/videos`, 'POST', { expected_revision: visit.revision,
      titulo: 'Original recorded video', guion: 'Original immutable script\nSecond line', estado: 'grabado',
      material_url: 'https://example.invalid/video', observaciones: 'Original video notes' });
    assert.equal(video.status, 201); visit = video.body.visita;
    const photo = await api(`/producciones/${visit.id}/fotos`, 'POST', { expected_revision: visit.revision,
      tipo: 'Original photo type', estado: 'realizada', drive_url: 'https://example.invalid/photo', observaciones: 'Original photo notes' });
    assert.equal(photo.status, 201); visit = photo.body.visita;
    assert.equal(visit.tarea_origen_id, null); assert.equal(visit.videos.length, 1); assert.equal(visit.fotos.length, 1);
    return visit;
  }

  for (const first of ['edit', 'result']) await t.test(`${first} first: observed lock chain determines the only committed writer`, async () => {
    const visit = await setup(first), video = visit.videos[0], requestId = randomUUID();
    const exclusions = first === 'edit' ? ['produccion_visitas', 'produccion_videos'] : ['produccion_visitas', 'produccion_resultados'];
    const before = await snapshot(exclusions), beforeVisit = await rawVisit(visit.id), beforeVideo = await rawVideo(video.id);
    const visitsHash = await otherVisitsHash(visit.id), videosHash = await otherVideosHash(video.id);
    const journalBefore = await f.query(`SELECT id,md5(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)::text) AS hash
      FROM produccion_resultados r ORDER BY id`);
    const editBody = Object.freeze({ expected_revision: visit.revision, guion: 'Changed after observed revision', observaciones: 'Changed edit notes' });
    const resultBody = Object.freeze({ request_id: requestId, expected_revision: visit.revision });
    const startEdit = () => observe(api(`/producciones/${visit.id}/videos/${video.id}`, 'PATCH', editBody, 91001));
    const startResult = () => observe(api(`/producciones/${visit.id}/resultados`, 'POST', resultBody, 91003));
    let leading, trailing;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM produccion_visitas WHERE id=$1 FOR UPDATE', [visit.id]);
      leading = first === 'edit' ? startEdit() : startResult();
      const leadingPid = await waitEdge(blocker.pid, leading, 'visit_lock');
      trailing = first === 'edit' ? startResult() : startEdit();
      // lockVisit's shared lineage mutex is acquired before the row lock:
      // the second real HTTP writer waits on the first, not on a timer.
      const trailingPid = await waitEdge(leadingPid, trailing, 'lineage_lock');
      assert.notEqual(leadingPid, trailingPid);
      assert.equal(leading.settled, false); assert.equal(trailing.settled, false);
      await blocker.query('COMMIT');
      const [winner, loser] = await Promise.all([leading.promise, trailing.promise]);
      assert.equal(winner.status, first === 'edit' ? 200 : 201); assert.equal(loser.status, 409);
      assert.deepEqual(Object.keys(loser.body), ['error']);
      const afterVisit = await rawVisit(visit.id), afterVideo = await rawVideo(video.id);
      assert.deepEqual(afterVisit, { ...beforeVisit, revision: visit.revision + 1,
        actualizado_por_id: first === 'edit' ? 91001 : 91003, updated_at: afterVisit.updated_at });
      assert.deepEqual(await snapshot(exclusions), before);
      assert.equal(await otherVisitsHash(visit.id), visitsHash); assert.equal(await otherVideosHash(video.id), videosHash);
      if (first === 'edit') {
        assert.equal(winner.body.visita.revision, visit.revision + 1);
        assert.deepEqual(afterVideo, { ...beforeVideo, guion: editBody.guion, observaciones: editBody.observaciones,
          actualizado_por_id: 91001, updated_at: afterVideo.updated_at });
        assert.deepEqual(await f.query('SELECT id FROM produccion_resultados WHERE visita_id=$1', [visit.id]), []);
      } else {
        assert.deepEqual(afterVideo, beforeVideo); assert.equal(winner.body.created, true);
        const event = winner.body.resultado;
        assert.equal(event.visita_id, visit.id); assert.equal(event.visita_revision, visit.revision);
        assert.equal(event.revision_resultante, visit.revision + 1); assert.equal(event.registrado_por_id, 91003); assert.equal(event.vigente, true);
        assert.deepEqual(event.resumen, { version: 1,
          visita: pick(visit, ['id', 'tarea_origen_id', 'cliente_id', 'fecha', 'titulo', 'participante_ids', 'drive_url', 'observaciones']),
          videos: visit.videos.map(row => pick(row, ['id', 'video_origen_id', 'titulo', 'guion', 'estado', 'material_url', 'observaciones'])),
          fotos: visit.fotos.map(row => pick(row, ['id', 'tipo', 'estado', 'drive_url', 'observaciones'])),
          previstos: 0, conteos: { videos_grabados: 1, videos_pendientes: 0, videos_repetir: 0,
            fotos_realizadas: 1, fotos_pendientes: 0, fotos_repetir: 0 }, parcial: false });
        const rows = await f.query('SELECT id,request_id,visita_revision,revision_resultante,resumen FROM produccion_resultados WHERE visita_id=$1', [visit.id]);
        assert.deepEqual(rows, [{ id: event.id, request_id: requestId, visita_revision: visit.revision,
          revision_resultante: visit.revision + 1, resumen: event.resumen }]);
        assert.deepEqual(await f.query(`SELECT id,md5(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)::text) AS hash
          FROM produccion_resultados r WHERE id<>$1 ORDER BY id`, [event.id]), journalBefore);
      }
      const read = await api(`/producciones/${visit.id}`);
      assert.equal(read.status, 200); assert.equal(read.body.visita.revision, visit.revision + 1);
      if (first === 'result') assert.equal(read.body.visita.ultimo_resultado.id, winner.body.resultado.id);
      else assert.equal(read.body.visita.ultimo_resultado, null);
      t.diagnostic(`Observed ${first}→owned visit blocker and trailing writer→${first} lineage-lock edges; exactly one revision committed.`);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([leading?.promise, trailing?.promise].filter(Boolean));
    }
  });
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
});
