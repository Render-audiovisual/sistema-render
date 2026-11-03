// Only a freshly generated local fixture is allowed. Never consume a configured
// database URL: these tests deliberately truncate Instagram test records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { runInstagramSync, cordobaDate } from '../src/instagram-sync.js';
import { linkInstagramAccount } from '../src/instagram-accounts.js';
import { GraphError, MEDIA_COVERS_ACTION } from '../src/instagram-graph.js';
import { FEED_SNAPSHOT_ACTION, validateFeedCountSnapshot } from '../../shared/instagram-feed-counts.mjs';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';

const enabled = process.env.RENDER2_RUN_LOCAL_INTEGRATION === 'true';
let url, fixture;
test.before(async () => {
  if (!enabled) return;
  fixture = await startLocalHarness({ port: 55993, clusterOnly: true });
  url = 'postgresql://render2_fixture@127.0.0.1:55993/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55993, url, identity });
});
test.after(async () => {
  await fixture?.cleanup();
  if (fixture) await assert.rejects(access(fixture.root), { code: 'ENOENT' });
});
const H = 3600000;

test('dedicated scheduled Instagram worker renews inventory, captions and covers without operational writes or duplicate hourly runs', { skip: !enabled }, async () => {
  const {AuthorityBoundPool}=await import('../src/database-authority-context.js');
  const {runInstagramScheduled}=await import('../src/instagram-scheduled-worker.js');
    const {runInstagramWeeklyReport}=await import('../src/instagram-weekly-report.js');
  const pool=new AuthorityBoundPool({connectionString:url,max:4});
  try{
    const client=(await pool.query("INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES('IG Dedicated Worker',4,2) RETURNING id")).rows[0];
    await pool.query("INSERT INTO instagram_cuentas(ig_user_id,username,cliente_id) VALUES('987654321','dedicated_qa',$1)",[client.id]);
    const accounts=(await pool.query('SELECT ig_user_id,username FROM instagram_cuentas')).rows;
    let revision=1,reads=0;
    const stamp=new Date('2026-11-03T10:05:00Z');
    const graph={
      async listInstagramAccounts(){reads++;return accounts.map(a=>({igUserId:a.ig_user_id,username:a.username,pageId:null,followers:null}));},
      async listMedia(id){return id==='987654321'?[
        {igMediaId:'987654322',tipo:'reel',permalink:'https://www.instagram.com/reel/DedicatedQA/',caption:`Copy ${revision}`,publishedAt:new Date('2026-11-02T15:00:00Z')},
        ...(revision===2?[{igMediaId:'987654323',tipo:'carrusel',permalink:'https://www.instagram.com/p/DedicatedCarousel/',caption:'Carrusel nuevo',publishedAt:new Date('2026-11-03T14:00:00Z')}]:[]),
      ]:[];},
      async mediaInsights(){return {alcance:100,vistas:200};},
      async mediaCover(){return `https://scontent.cdninstagram.com/cover-${revision}.jpg`;},
    };
    const fingerprints=async()=>Promise.all(['tareas','publicaciones','cliente_objetivos_mensuales'].map(async name=>
      (await pool.query(`SELECT count(*)::int AS n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS hash FROM ${name} t`)).rows[0]));
    const before=await fingerprints();
    const env={RENDER_DB_ENVIRONMENT:'test',DATABASE_URL:url,RENDER_AUTOMATIONS_MODE:'scheduled-v1',
      RENDER_AUTOMATION_CONNECTION_MODE:'direct',RENDER_AUTOMATION_JOBS:'editorial,instagram,wilson,instagram_reporte'};
    const sequence=[];
    const execute=()=>runInstagramScheduled({env,now:()=>stamp,
      createPool:()=>new AuthorityBoundPool({connectionString:url,max:4}),
      sync:(owned,{now})=>{sequence.push('sync');return runInstagramSync(owned,{now,env:{},graph});},
      report:(owned,{now,env})=>{sequence.push('report');return runInstagramWeeklyReport(owned,{now,env});}});
    assert.deepEqual(await execute(),{state:'COMPLETED',jobs:['instagram','instagram_reporte']});
    assert.deepEqual(sequence,['sync','report']);
    const firstReads=reads;assert.deepEqual(await execute(),{state:'COMPLETED',jobs:[]});assert.equal(reads,firstReads);
    revision=2;stamp.setUTCHours(stamp.getUTCHours()+7);
    assert.deepEqual(await execute(),{state:'COMPLETED',jobs:['instagram','instagram_reporte']});
    assert.deepEqual(sequence,['sync','report','sync','report']);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM instagram_reportes WHERE tipo='semanal' AND desde='2026-10-24'")).rows[0].n,1);
    const media=(await pool.query("SELECT caption FROM instagram_media WHERE ig_media_id='987654322'")).rows[0];
    assert.equal(media.caption,'Copy 2');
    const cover=(await pool.query(`SELECT detalles FROM integracion_auditoria WHERE accion=$1 AND detalles->>'clientId'=$2 ORDER BY id DESC LIMIT 1`,[MEDIA_COVERS_ACTION,String(client.id)])).rows[0].detalles;
    assert.equal(cover.items.find(i=>i.id==='987654322').url,'https://scontent.cdninstagram.com/cover-2.jpg');
    assert.equal(cover.items.find(i=>i.id==='987654323').kind,'carrusel');
    assert.deepEqual(await fingerprints(),before);
  }finally{await pool.end();}
});

function fakeGraph(state) {
  return {
    async listInstagramAccounts() { if (state.authError) throw new GraphError('auth'); return state.accounts; },
    async listMedia(igUserId) { return state.media[igUserId] ?? []; },
    async mediaInsights(id) { state.insightCalls.push(id); return { alcance: 100, vistas: 250, likes: 10, comentarios: 2, guardados: 3, compartidos: 1, interacciones: 16 }; },
  };
}

test('instagram sync stores accounts, media, metrics and links pieces conservatively', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await pool.query(`TRUNCATE instagram_media_metricas, instagram_media, instagram_cuenta_seguidores, instagram_cuentas`);
    const ids = {};
    for (const name of ['IG Test Bohle', 'IG Test Lavalle H', 'IG Test Lavalle M']) {
      ids[name] = (await pool.query(`INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES($1,4,4)
        ON CONFLICT (nombre) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id`, [name])).rows[0].id;
    }
    const group = (await pool.query(`INSERT INTO grupos_feed(nombre,cuota_mensual) VALUES('IG Test Grupo',8)
      ON CONFLICT (nombre) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id`)).rows[0].id;
    await pool.query('UPDATE clientes SET grupo_feed_id=$1 WHERE id = ANY($2)', [group, [ids['IG Test Lavalle H'], ids['IG Test Lavalle M']]]);
    await pool.query('DELETE FROM publicaciones WHERE cliente_id = ANY($1)', [Object.values(ids)]);
    const pub = async (cliente, tipo, fecha) => (await pool.query(
      `INSERT INTO publicaciones(cliente_id,tipo,fecha_programada) VALUES($1,$2,$3) RETURNING id`, [cliente, tipo, fecha])).rows[0].id;
    const reelBohle = await pub(ids['IG Test Bohle'], 'reel', '2026-10-20');
    await pub(ids['IG Test Bohle'], 'carrusel', '2026-10-21');
    await pub(ids['IG Test Bohle'], 'carrusel', '2026-10-21');
    const carruselLavalle = await pub(ids['IG Test Lavalle M'], 'carrusel', '2026-10-22');

    const now = new Date('2026-10-31T15:00:00Z');
    const state = {
      insightCalls: [],
      accounts: [
        { igUserId: '111', username: 'bohle_test', pageId: '900', followers: 5000 },
        { igUserId: '222', username: 'lavalle_h_test', pageId: '901', followers: 800 },
        { igUserId: '333', username: 'sin_cliente', pageId: null, followers: null },
      ],
      media: {
        111: [
          // 21:00 Córdoba del 20/10 = 00:00Z del 21/10: debe usar la fecha de Córdoba.
          { igMediaId: '5001', tipo: 'reel', permalink: 'https://www.instagram.com/reel/A/', caption: 'a', publishedAt: new Date('2026-10-21T00:00:00Z') },
          { igMediaId: '5002', tipo: 'carrusel', permalink: 'https://www.instagram.com/p/B/', caption: '', publishedAt: new Date('2026-10-21T15:00:00Z') },
          { igMediaId: '5003', tipo: 'reel', permalink: 'https://www.instagram.com/reel/C/', caption: '', publishedAt: new Date('2026-10-25T15:00:00Z') },
        ],
        222: [
          { igMediaId: '6001', tipo: 'carrusel', permalink: 'https://www.instagram.com/p/D/', caption: '', publishedAt: new Date('2026-10-22T15:00:00Z') },
        ],
      },
    };
    const graph = fakeGraph(state);
    graph.mediaCover = async id => `https://scontent.cdninstagram.com/${id}.jpg?sig=fixture`;

    // Antes de vincular: solo descubre cuentas, no sincroniza piezas.
    let summary = await runInstagramSync(pool, { now, graph });
    assert.equal(summary.cuentas, 0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM instagram_cuentas')).rows[0].n, 3);
    assert.equal((await pool.query('SELECT count(*)::int n FROM instagram_media')).rows[0].n, 0);

    await linkInstagramAccount(pool, '111', ids['IG Test Bohle']);
    await linkInstagramAccount(pool, '222', ids['IG Test Lavalle H']);
    await assert.rejects(linkInstagramAccount(pool, '333', ids['IG Test Bohle']), { status: 409 });

    summary = await runInstagramSync(pool, { now, graph });
    assert.deepEqual([summary.ok, summary.errores, summary.media, summary.metricas], [2, 0, 4, 4]);
    const coverSnapshots = (await pool.query(`SELECT detalles FROM integracion_auditoria
      WHERE integracion='instagram_graph' AND accion='media_covers_v1' AND resultado='ok'
        AND detalles->>'igUserId'=ANY($1::text[]) ORDER BY id DESC LIMIT 2`, [['111', '222']])).rows;
    assert.equal(coverSnapshots.length, 2);
    assert.equal(coverSnapshots.flatMap(row => row.detalles.items).length, 4);
    assert.ok(coverSnapshots.every(row => row.detalles.items.every(item => /^https:\/\/scontent\.cdninstagram\.com\/[0-9]+\.jpg/.test(item.url))));
    const links = Object.fromEntries((await pool.query('SELECT ig_media_id,vinculo,publicacion_id FROM instagram_media')).rows
      .map(r => [r.ig_media_id, [r.vinculo, r.publicacion_id]]));
    assert.deepEqual(links['5001'], ['automatico', reelBohle]);
    assert.deepEqual(links['5002'], ['ambiguo', null]);
    assert.deepEqual(links['5003'], ['sin_pieza', null]);
    assert.deepEqual(links['6001'], ['automatico', carruselLavalle], 'feed compartido del grupo');
    assert.equal((await pool.query(`SELECT seguidores FROM instagram_cuenta_seguidores WHERE ig_user_id='111'`)).rows[0].seguidores, 5000);

    // 30 minutos después: las piezas de >2 días no se vuelven a medir.
    state.insightCalls.length = 0;
    summary = await runInstagramSync(pool, { now: new Date(now.getTime() + H / 2), graph });
    assert.equal(summary.metricas, 0);
    assert.equal(state.insightCalls.length, 0);

    // Un vínculo manual se respeta; re-vincular la cuenta reinicia los vínculos.
    await pool.query(`UPDATE instagram_media SET vinculo='manual', publicacion_id=$1 WHERE ig_media_id='5003'`,
      [await pub(ids['IG Test Bohle'], 'reel', '2026-10-26')]);
    await runInstagramSync(pool, { now: new Date(now.getTime() + 2 * H), graph });
    assert.equal((await pool.query(`SELECT vinculo FROM instagram_media WHERE ig_media_id='5003'`)).rows[0].vinculo, 'manual');

    // Métricas append-only.
    await assert.rejects(pool.query('UPDATE instagram_media_metricas SET likes=0'));

    // Lista vacía de Meta no desactiva cuentas; token inválido corta y queda auditado.
    state.accounts = [];
    await runInstagramSync(pool, { now: new Date(now.getTime() + 3 * H), graph });
    assert.equal((await pool.query('SELECT count(*)::int n FROM instagram_cuentas WHERE activa')).rows[0].n, 3);
    state.authError = true;
    await assert.rejects(runInstagramSync(pool, { now: new Date(now.getTime() + 4 * H), graph }), { kind: 'auth' });
  } finally {
    await pool.end();
  }
});

// Continúa sobre los datos que dejó la prueba anterior (mismo archivo, en orden).
test('instagram panel is shared with active team members; only Leader can change bindings', { skip: !enabled }, async () => {
  const { AuthorityBoundPool } = await import('../src/database-authority-context.js');
  const { readInstagramPanel, readInstagramClientPieces, writeInstagramMediaLink, writeInstagramAccountLink } = await import('../src/instagram-panel.js');
  const pool = new AuthorityBoundPool({ connectionString: url, max: 3 });
  try {
    const user = async (usuario, rol) => (await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash) VALUES($1,$1,$2,'x')
      ON CONFLICT (usuario) DO UPDATE SET rol=EXCLUDED.rol RETURNING id, session_version`, [usuario, rol])).rows[0];
    const leader = await user('ig_test_lider', 'admin');
    const designer = await user('ig_test_diseno', 'diseno');
    await pool.query(`UPDATE publicaciones SET "responsable_diseño"='Augusto' WHERE id=(SELECT publicacion_id FROM instagram_media WHERE ig_media_id='5001')`);

    assert.equal((await readInstagramPanel(pool, designer, { periodo: '2026-10' })).periodo,'2026-10');
    await assert.rejects(readInstagramPanel(pool, leader, { periodo: '2026-13' }), { status: 400 });
    await assert.rejects(readInstagramPanel(pool, leader, { periodo: '2026-10', extra: '1' }), { status: 400 });

    const panel = await readInstagramPanel(pool, leader, { periodo: '2026-10' });
    const bohle = panel.clientes.find(c => c.nombre === 'IG Test Bohle');
    assert.equal(bohle.actual.piezas, 3);
    assert.equal(bohle.actual.alcance, 300);
    assert.equal(bohle.seguidores, 5000);
    assert.equal(bohle.sin_vincular, 1, '5002 ambiguo (5003 quedó manual)');
    const lavalle = panel.clientes.find(c => c.nombre === 'IG Test Grupo');
    assert.equal(lavalle.cuentas.length, 2, 'grupo de feed agrupa ambas cuentas');
    assert.equal(lavalle.actual.carruseles, 1);
    assert.equal(panel.equipo.find(p => p.nombre === 'Augusto').totales.piezas, 1);
    assert.equal(panel.cuentas_sin_cliente, 1);

    const detail = await readInstagramClientPieces(pool, leader, bohle.clave, { periodo: '2026-10' });
    assert.equal(detail.piezas.length, 3);
    assert.ok(detail.candidatas.length >= 2, 'los dos carruseles del 21/10 siguen libres');

    // Vínculo manual y validaciones.
    const target = detail.candidatas.find(c => c.tipo === 'carrusel').id;
    assert.deepEqual(await writeInstagramMediaLink(pool, leader, '5002', { publicacion_id: target }), { vinculo: 'manual', publicacion_id: target });
    await assert.rejects(writeInstagramMediaLink(pool, leader, '6001', { publicacion_id: target }), { status: 404 }, 'otro cliente');
    await assert.rejects(writeInstagramMediaLink(pool, leader, '5001', { publicacion_id: target }), { status: 409 });
    await assert.rejects(writeInstagramMediaLink(pool, designer, '5002', { publicacion_id: null }), { status: 403 });
    await assert.rejects(writeInstagramMediaLink(pool, leader, '5002', { publicacion_id: 'x' }), { status: 400 });
    assert.equal((await writeInstagramMediaLink(pool, leader, '5002', { publicacion_id: null })).vinculo, 'pendiente');
    await assert.rejects(writeInstagramAccountLink(pool, designer, '333', { cliente_id: null }), { status: 403 });
    assert.deepEqual(await writeInstagramAccountLink(pool, leader, '333', { cliente_id: null }), { changed: false });
  } finally {
    await pool.end();
  }
});

test('weekly report stores facts, optional AI conclusions and retries AI errors; client report hides internals', { skip: !enabled }, async () => {
  const { runInstagramWeeklyReport, lastCompleteWeek } = await import('../src/instagram-weekly-report.js');
  const { AuthorityBoundPool } = await import('../src/database-authority-context.js');
  const { readInstagramReports, readInstagramReport, readInstagramClientReport, readInstagramPanel } = await import('../src/instagram-panel.js');
  const pool = new AuthorityBoundPool({ connectionString: url, max: 3 });
  try {
    await pool.query('TRUNCATE instagram_reportes');
    // Sábado 24/10 12h Córdoba → semana del sábado 17 al viernes 23/10: 5001 (20/10 21h), 5002 (21/10), 6001 (22/10).
    const now = new Date('2026-10-24T15:00:00Z');
    assert.deepEqual(lastCompleteWeek(now), { desde: '2026-10-17', hasta: '2026-10-23' });

    let calls = 0;
    const okFetch = async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-api-key'], 'sk-ant-test-key-0123456789');
      assert.match(body.messages[0].content, /IG Test Bohle/);
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'RESUMEN: buena semana.' }] }) };
    };
    const failFetch = async () => ({ ok: false, status: 529, json: async () => ({}) });
    const ai = { INSTAGRAM_AI_REPORTS_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789', INSTAGRAM_AI_MODEL: 'test-model' };

    assert.deepEqual(await runInstagramWeeklyReport(pool, { now, env: ai, fetchImpl: failFetch }), { estado: 'ia_error', creado: true });
    assert.deepEqual(await runInstagramWeeklyReport(pool, { now: new Date(now.getTime() + 3600000), env: ai, fetchImpl: okFetch }), { estado: 'ia_error', creado: false }, 'espera 6 h');
    assert.equal(calls, 0);
    assert.deepEqual(await runInstagramWeeklyReport(pool, { now: new Date(now.getTime() + 7 * 3600000), env: ai, fetchImpl: okFetch }), { estado: 'ia', creado: false });
    assert.equal(calls, 1);
    assert.deepEqual(await runInstagramWeeklyReport(pool, { now: new Date(now.getTime() + 8 * 3600000), env: ai, fetchImpl: okFetch }), { estado: 'ia', creado: false });
    assert.equal(calls, 1, 'no repite');
    await assert.rejects(runInstagramWeeklyReport(pool, { now, env: { INSTAGRAM_AI_REPORTS_ENABLED: 'true' } }), /IA inválida/);

    const leader = (await pool.query(`SELECT id, session_version FROM usuarios WHERE usuario='ig_test_lider'`)).rows[0];
    const list = await readInstagramReports(pool, leader);
    assert.equal(list.reportes.length, 1);
    const report = await readInstagramReport(pool, leader, String(list.reportes[0].id));
    assert.equal(report.conclusiones, 'RESUMEN: buena semana.');
    assert.equal(report.hechos.totales.piezas, 3);
    const bohle = report.hechos.clientes.find(c => c.cliente === 'IG Test Bohle');
    assert.equal(bohle.piezas, 2);
    assert.equal(bohle.mejor_pieza.alcance, 100);
    assert.ok(report.hechos.equipo.some(p => p.nombre === 'Augusto'));

    // Sin IA habilitada: solo datos.
    await pool.query('TRUNCATE instagram_reportes');
    assert.deepEqual(await runInstagramWeeklyReport(pool, { now, env: {} }), { estado: 'solo_datos', creado: true });

    const panel = await readInstagramPanel(pool, leader, { periodo: '2026-10' });
    assert.ok(Array.isArray(panel.alertas));
    const clave = panel.clientes.find(c => c.nombre === 'IG Test Bohle').clave;
    const clientReport = await readInstagramClientReport(pool, leader, clave, { periodo: '2026-10' });
    assert.equal(clientReport.piezas.length, 3);
    assert.equal(clientReport.destacadas.length, 3);
    for (const piece of [...clientReport.piezas, ...clientReport.destacadas]) {
      assert.ok(!('responsables' in piece) && !('vinculo' in piece) && !('publicacion_id' in piece));
    }
    const designer = (await pool.query(`SELECT id, session_version FROM usuarios WHERE usuario='ig_test_diseno'`)).rows[0];
    assert.equal((await readInstagramClientReport(pool, designer, clave, { periodo: '2026-10' })).clave,clave);
    assert.ok(Array.isArray((await readInstagramReports(pool, designer)).reportes));
  } finally {
    await pool.end();
  }
});

test('account reassignment during a Graph read cannot restore the previous client', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    const next = (await pool.query(`INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles)
      VALUES('IG Test Reassigned',4,2) RETURNING id`)).rows[0].id;
    const old = (await pool.query("SELECT cliente_id FROM instagram_cuentas WHERE ig_user_id='111'")).rows[0].cliente_id;
    const taskCount = (await pool.query('SELECT count(*)::int AS n FROM tareas')).rows[0].n;
    const proofCount = (await pool.query('SELECT count(*)::int AS n FROM integracion_auditoria WHERE integracion=$1 AND accion=$2',
      ['instagram_graph', FEED_SNAPSHOT_ACTION])).rows[0].n;
    let changed = false;
    const graph = {
      async listInstagramAccounts() { return [{ igUserId: '111', username: 'bohle_test', pageId: '900', followers: 5000 }]; },
      async listMedia() {
        await linkInstagramAccount(pool, '111', next); changed = true;
        return [{ igMediaId: '7001', tipo: 'reel', permalink: 'https://www.instagram.com/reel/E/', caption: '',
          publishedAt: new Date('2026-10-31T12:00:00Z') }];
      },
      async mediaInsights() { return { alcance: 100 }; },
    };
    await assert.rejects(runInstagramSync(pool, { graph, now: new Date('2026-11-01T12:00:00Z') }), /Ninguna cuenta/);
    assert.equal(changed, true); assert.notEqual(next, old);
    assert.equal((await pool.query("SELECT cliente_id FROM instagram_cuentas WHERE ig_user_id='111'")).rows[0].cliente_id, next);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM instagram_media WHERE ig_user_id=$1 AND cliente_id<>$2', ['111', next])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM instagram_media WHERE ig_media_id='7001'")).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM tareas')).rows[0].n, taskCount);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM integracion_auditoria WHERE integracion=$1 AND accion=$2',
      ['instagram_graph', FEED_SNAPSHOT_ACTION])).rows[0].n, proofCount, 'reassignment cannot publish coverage');
  } finally { await pool.end(); }
});

test('complete 90-day snapshots reconcile counts without deleting history; partial sync rejects with durable successful accounts', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    // The gated harness above creates a disposable database and verifies its
    // identity. Never use environment/database URLs for this fixture.
    const clients = [];
    for (const name of ['IG Coverage Complete', 'IG Coverage Partial']) {
      clients.push((await pool.query('INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES($1,4,4) RETURNING id', [name])).rows[0].id);
    }
    for (const [i, id] of ['88111', '88222'].entries()) {
      await pool.query('INSERT INTO instagram_cuentas(ig_user_id,username,cliente_id) VALUES($1,$2,$3)', [id, `coverage${i}`, clients[i]]);
    }
    const account = id => ({ igUserId: id, username: id === '88111' ? 'coverage0' : 'coverage1', pageId: null, followers: null });
    const at = new Date('2026-11-01T12:00:00Z'), reads = [];
    const media = { igMediaId: '88501', tipo: 'reel', permalink: 'https://www.instagram.com/reel/coverage/',
      caption: 'observed', publishedAt: new Date('2026-10-20T12:00:00Z') };
    let listed = [media], partial = false;
    const graph = {
      async listInstagramAccounts() { return [account('88111'), account('88222')]; },
      async listMedia(id, from) { reads.push({ id, from }); if (partial && id === '88222') throw new GraphError('pagination'); return id === '88111' ? listed : []; },
      async mediaInsights() { throw new GraphError('permission'); },
    };
    const latestProof = async () => (await pool.query(`SELECT detalles FROM integracion_auditoria
      WHERE integracion='instagram_graph' AND canal='system' AND actor_id='render-worker'
        AND actor_nombre='Render · Instagram' AND resultado='ok' AND accion=$1 AND detalles->>'igUserId'='88111'
        AND detalles->>'clientId'=$2
        AND detalles->>'period'='2026-10' ORDER BY id DESC LIMIT 1`, [FEED_SNAPSHOT_ACTION, String(clients[0])])).rows[0].detalles;
    const taskCount = (await pool.query('SELECT count(*)::int AS n FROM tareas')).rows[0].n;
    await runInstagramSync(pool, { now: at, env: {}, graph });
    const initial = await latestProof();
    assert.ok(validateFeedCountSnapshot(initial));
    assert.equal(initial.posts.length, 1);
    assert.equal(initial.checkedAt, at.toISOString());
    listed = [{ ...media, tipo: 'carrusel', caption: 'edited' }];
    await runInstagramSync(pool, { now: new Date(+at + 3600000), env: {}, graph });
    assert.equal((await latestProof()).posts[0].kind, 'carrusel');
    listed = []; partial = true;
    await assert.rejects(runInstagramSync(pool, { now: new Date(+at + 7200000), env: {}, graph }), /parcial/);
    assert.deepEqual((await latestProof()).posts, [], 'fresh complete inventory replaces count evidence, not stored media');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM instagram_media WHERE ig_media_id='88501'")).rows[0].n, 1);
    assert.ok(reads.every(r => +r.from === +at - 90 * 86400000 || +r.from === +at + 3600000 - 90 * 86400000 || +r.from === +at + 7200000 - 90 * 86400000));
    const summary = (await pool.query(`SELECT resultado,detalles FROM integracion_auditoria
      WHERE integracion='instagram_graph' AND accion='sync_resumen' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(summary.resultado, 'parcial');
    assert.equal(summary.detalles.ok, 1);
    assert.equal(summary.detalles.errores, 1);
    // Exercise the real catalog reader's SQL contract without changing its
    // owner files: actor, client/account/month and canonical proof all match.
    const { CLIENT_CATALOG_SQL } = await import('../src/client-catalog.js');
    const catalog = (await pool.query(CLIENT_CATALOG_SQL, ['2026-10-01'])).rows.find(c => c.id === clients[0]);
    assert.equal(catalog.instagram_account_id, '88111');
    assert.ok(validateFeedCountSnapshot(catalog.instagram_feed_snapshot, {
      clientId: clients[0], igUserId: '88111', period: '2026-10',
    }));
    assert.deepEqual(catalog.instagram_feed_snapshot.posts, []);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM tareas')).rows[0].n, taskCount);
  } finally { await pool.end(); }
});

test('client report reads one authorized RR with closed counts, current quotas and no cross-client detail', { skip: !enabled }, async () => {
  const { AuthorityBoundPool } = await import('../src/database-authority-context.js');
  const { readInstagramClientReport,readInstagramPanel } = await import('../src/instagram-panel.js');
  const pool = new AuthorityBoundPool({ connectionString: url, max: 3 });
  try {
    const clients = [];
    for (const name of ['IG Report Scoped A', 'IG Report Scoped B']) {
      clients.push((await pool.query('INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES($1,2,1) RETURNING id', [name])).rows[0].id);
    }
    const at = '2026-10-20T15:00:00.000Z', checkedAt = '2026-11-01T04:00:00.000Z';
    for (const [i, id] of ['99111', '99222'].entries()) {
      await pool.query('INSERT INTO instagram_cuentas(ig_user_id,username,cliente_id) VALUES($1,$2,$3)', [id, `report_scope_${i}`, clients[i]]);
    }
    await pool.query(`INSERT INTO instagram_cuenta_seguidores(ig_user_id,fecha,seguidores,medido_at)
      VALUES('99111','2026-09-30',100,$1),('99111','2026-10-31',120,$1),('99111','2026-11-02',140,$1)`,[checkedAt]);
    for (const [id, account, client] of [['99501', '99111', clients[0]], ['99502', '99111', clients[0]], ['99503', '99222', clients[1]]]) {
      await pool.query(`INSERT INTO instagram_media(ig_media_id,ig_user_id,cliente_id,tipo,permalink,caption,publicado_at)
        VALUES($1,$2,$3,'reel',$4,'profile observation',$5)`, [id, account, client, `https://www.instagram.com/reel/Public${id}/`, at]);
      await pool.query('INSERT INTO instagram_media_metricas(ig_media_id,medido_at,alcance) VALUES($1,$2,100)', [id, checkedAt]);
    }
    const snapshot = { version: 1, source: 'meta_graph_feed', clientId: clients[0], igUserId: '99111', username: 'report_scope_0',
      period: '2026-10', windowStart: '2026-08-03T15:00:00.000Z', checkedAt,
      posts: [{ id: '99501', kind: 'reel', publishedAt: at }], secret: 'NOT PUBLIC' };
    await pool.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,resultado,detalles)
      VALUES('instagram_graph','system','render-worker','Render · Instagram',$1,'ok',$2::jsonb)`, [FEED_SNAPSHOT_ACTION, JSON.stringify(snapshot)]);
    await pool.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,resultado,detalles)
      VALUES('client_branding','web','fixture','Fixture','logo_updated','ok',$1::jsonb)`,
    [JSON.stringify({ clientId: clients[0], logo: 'https://example.test/report-logo.png' })]);
    const leader = (await pool.query("SELECT id,session_version FROM usuarios WHERE usuario='ig_test_lider'")).rows[0];
    const designer = (await pool.query("SELECT id,session_version FROM usuarios WHERE usuario='ig_test_diseno'")).rows[0];
    const calls = []; let connects = 0;
    const observedPool = { async connect() {
      connects++; const db = await pool.connect();
      return { async query(sql, params) { calls.push(sql); return db.query(sql, params); }, release(error) { db.release(error); } };
    } };
    const report = await readInstagramClientReport(observedPool, leader, `cliente-${clients[0]}`, { periodo: '2026-10' });
    assert.equal(connects, 1);
    assert.equal(calls.filter(sql => sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY').length, 1);
    assert.equal(calls.filter(sql => sql === 'COMMIT').length, 1);
    assert.equal(calls.length,6,'one authorized snapshot with three batched reads including combined views');
    assert.deepEqual(report.format_counts, { status: 'historical', reels: 1, carruseles: 0, checkedAt });
    assert.deepEqual(report.cupo, { reels: 2, carruseles: 1 });
    assert.equal(report.fulfillment.reels.pendientes, 1);
    assert.equal(report.fulfillment.carruseles.pendientes, 1);
    assert.equal(report.actual.piezas, 2, 'secondary observations retain deleted media history');
    assert.equal(report.piezas.length, 1); assert.equal(report.destacadas.length, 1);
    assert.equal(report.piezas[0].permalink, 'https://www.instagram.com/reel/Public99501/');
    assert.equal(report.logo, 'https://example.test/report-logo.png');
    assert.equal(report.dataFecha, checkedAt);
    assert.equal(report.seguidores,120,'month-end followers, not previous month or current day');
    assert.equal(report.crecimiento_seguidores,20);
    const baseline=(await readInstagramPanel(pool,leader,{periodo:'2026-10'})).clientes.find(c=>c.clave===report.clave);
    for(const field of ['actual','anterior','cupo','seguidores','crecimiento_seguidores'])
      assert.deepEqual(report[field],baseline[field],`optimized report preserves ${field}`);
    assert.doesNotMatch(JSON.stringify(report), /Scoped B|report_scope_1|Public99502|Public99503|NOT PUBLIC|ig_media_id|publicacion_id|responsables|vinculo|abono_mensual|"posts"/);
    assert.equal((await readInstagramClientReport(pool, designer, `cliente-${clients[0]}`, { periodo: '2026-10' })).clave,report.clave);
    const group=(await pool.query("INSERT INTO grupos_feed(nombre,cuota_mensual) VALUES('IG Report Shared',6) RETURNING id")).rows[0].id;
    await pool.query('UPDATE clientes SET grupo_feed_id=$1 WHERE id=ANY($2::int[])',[group,clients]);
    const groupReport=await readInstagramClientReport(pool,leader,`grupo-${group}`,{periodo:'2026-10'});
    const groupBaseline=(await readInstagramPanel(pool,leader,{periodo:'2026-10'})).clientes.find(c=>c.clave===groupReport.clave);
    assert.equal(groupReport.cuentas.length,2);
    for(const field of ['actual','anterior','cupo','seguidores','crecimiento_seguidores'])
      assert.deepEqual(groupReport[field],groupBaseline[field],`shared report preserves ${field}`);
  } finally { await pool.end(); }
});

test('optional real cover pipeline persists in existing audit and reaches client gallery without changing feed proofs', { skip: !enabled }, async () => {
  const { readInstagramClientReport } = await import('../src/instagram-panel.js');
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    const clientId = (await pool.query("INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES('IG Cover Pipeline',2,2) RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO instagram_cuentas(ig_user_id,username,cliente_id) VALUES('66111','cover_pipeline',$1)", [clientId]);
    const now = new Date(), first = new Date(+now - 7 * 3600000), publishedAt = new Date(+now - 8 * 3600000);
    const period = cordobaDate(publishedAt).slice(0, 7), image = 'https://scontent.cdninstagram.com/real-cover.jpg?oh=signed';
    let failCover = false, coverCalls = 0;
    const media = ['66501', '66502'].map((igMediaId, i) => ({ igMediaId, tipo: i ? 'carrusel' : 'reel',
      permalink: `https://www.instagram.com/p/Cover${igMediaId}/`, caption: `Public caption ${igMediaId}`, publishedAt }));
    const graph = {
      async listInstagramAccounts() { return [{ igUserId: '66111', username: 'cover_pipeline', pageId: null, followers: null }]; },
      async listMedia() { return media; },
      async mediaInsights() { return { alcance: 120, vistas: 300, likes: 10 }; },
      async mediaCover() { coverCalls++; if (failCover) throw new GraphError('network'); return image; },
    };
    await runInstagramSync(pool, { now: first, env: {}, graph });
    failCover = true;
    await runInstagramSync(pool, { now, env: {}, graph });
    assert.equal(coverCalls, 4, 'refresh is independent and retries after six hours');
    const stored = (await pool.query(`SELECT detalles FROM integracion_auditoria
      WHERE integracion='instagram_graph' AND canal='system' AND actor_id='render-worker' AND accion=$1
        AND detalles->>'igUserId'='66111' ORDER BY id DESC LIMIT 1`, [MEDIA_COVERS_ACTION])).rows[0].detalles;
    assert.ok(stored.items.every(item => item.url === image && item.checkedAt === first.toISOString()), 'network failure retains original URL age');
    const leader = (await pool.query("SELECT id,session_version FROM usuarios WHERE usuario='ig_test_lider'")).rows[0];
    const report = await readInstagramClientReport(pool, leader, `cliente-${clientId}`, { periodo: period });
    assert.equal(coverCalls, 4, 'report performs no request-side Graph call');
    assert.equal(report.piezas.length, 2);
    assert.equal(report.format_counts.reels, 1); assert.equal(report.format_counts.carruseles, 1);
    for (const piece of report.piezas) {
      assert.equal(piece.portada_url, image); assert.match(piece.caption, /^Public caption/);
      assert.equal(piece.metricas.vistas, 300); assert.equal('ig_media_id' in piece, false);
    }
    const proof = (await pool.query(`SELECT detalles FROM integracion_auditoria WHERE accion=$1
      AND detalles->>'igUserId'='66111' AND detalles->>'period'=$2 ORDER BY id DESC LIMIT 1`, [FEED_SNAPSHOT_ACTION, period])).rows[0].detalles;
    assert.equal(proof.posts.length, 2);
    for (const post of proof.posts) assert.deepEqual(Object.keys(post).sort(), ['id', 'kind', 'publishedAt']);
    assert.doesNotMatch(JSON.stringify(proof), /"portada_url"|"url"|cdninstagram/);
  } finally { await pool.end(); }
});
