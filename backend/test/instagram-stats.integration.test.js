// Fixture local desechable (igual que instagram-sync.integration). Nunca usa una base configurada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';

const enabled = process.env.RENDER2_RUN_LOCAL_INTEGRATION === 'true';
let url, fixture;
test.before(async () => {
  if (!enabled) return;
  fixture = await startLocalHarness({ port: 55994, clusterOnly: true });
  url = 'postgresql://render2_fixture@127.0.0.1:55994/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55994, url, identity });
});

test('Litoral-style retained eighth reel is excluded by the same proof as the report; reads preserve all source rows', {skip:!enabled},async()=>{
  const {AuthorityBoundPool}=await import('../src/database-authority-context.js');
  const {readInstagramClientStats,readInstagramClientReport,readInstagramClientPieces}=await import('../src/instagram-panel.js');
  const pool=new AuthorityBoundPool({connectionString:url,max:3});
  try{
    const auth=(await pool.query("SELECT id,rol,session_version FROM usuarios WHERE id=91001")).rows[0];
    const client=(await pool.query("INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES('Litoral QA membership',8,2) RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO instagram_cuentas(ig_user_id,username,cliente_id) VALUES('5550011','litoral_qa_membership',$1)",[client]);
    const posts=[];
    for(let i=1;i<=8;i++){
      const id=String(8000000+i),at=`2026-10-${String(i).padStart(2,'0')}T15:00:00.000Z`;
      await pool.query("INSERT INTO instagram_media(ig_media_id,ig_user_id,cliente_id,tipo,permalink,caption,publicado_at) VALUES($1,'5550011',$2,'reel',$3,'QA',$4)",[id,client,`https://www.instagram.com/reel/QA${i}/`,at]);
      for(const hour of [1,24])await pool.query('INSERT INTO instagram_media_metricas(ig_media_id,medido_at,alcance) VALUES($1,$2,100)',[id,new Date(Date.parse(at)+hour*3600000)]);
      if(i<=7)posts.push({id,kind:'reel',publishedAt:at});
    }
    const proof={version:1,source:'meta_graph_feed',clientId:client,igUserId:'5550011',username:'litoral_qa_membership',period:'2026-10',windowStart:'2026-09-01T03:00:00.000Z',checkedAt:'2026-11-01T12:00:00.000Z',posts};
    await pool.query("INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,resultado,detalles) VALUES('instagram_graph','system','render-worker','Fixture','feed_snapshot_v1','ok',$1::jsonb)",[JSON.stringify(proof)]);
    const fingerprint=async()=>Promise.all(['instagram_media','instagram_media_metricas','integracion_auditoria','tareas','publicaciones'].map(async table=>
      (await pool.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${table} t`)).rows[0]));
    const before=await fingerprint(),key=`cliente-${client}`;
    const stats=await readInstagramClientStats(pool,auth,key,{periodo:'2026-10'});
    const report=await readInstagramClientReport(pool,auth,key,{periodo:'2026-10'});
    const gallery=await readInstagramClientPieces(pool,auth,key,{periodo:'2026-10'});
    assert.equal(stats.totales.actual.reels,7);assert.equal(stats.totales.actual.alcance,700);
    assert.equal(stats.publicaciones.length,7);assert.equal(new Set(stats.publicaciones.map(p=>p.ig_media_id)).size,7);
    assert.deepEqual(stats.publicaciones.map(p=>p.ig_media_id).sort(),gallery.piezas.map(p=>p.ig_media_id).sort());
    assert.equal(report.format_counts.reels,7);
    assert.equal(stats.diario.reduce((n,d)=>n+d.piezas,0),7);assert.equal(stats.promedio.reel.piezas,7);
    assert.deepEqual(await fingerprint(),before);
    assert.equal((await pool.query("SELECT count(*)::int n FROM instagram_media WHERE ig_user_id='5550011'")).rows[0].n,8);
  }finally{await pool.end();}
});
test.after(async () => {
  await fixture?.cleanup();
  if (fixture) await assert.rejects(access(fixture.root), { code: 'ENOENT' });
});

test('client and per-publication statistics: totals, follower growth, score, curve band and team access', { skip: !enabled }, async () => {
  const { AuthorityBoundPool } = await import('../src/database-authority-context.js');
  const { readInstagramClientStats, readInstagramMediaStats } = await import('../src/instagram-panel.js');
  const pool = new AuthorityBoundPool({ connectionString: url, max: 3 });
  try {
    const user = async (usuario, rol) => (await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash) VALUES($1,$1,$2,'x') RETURNING id, session_version`, [usuario, rol])).rows[0];
    const leader = await user('stats_lider', 'admin'), designer = await user('stats_diseno', 'diseno');
    const client = (await pool.query("INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES('Stats QA',4,4) RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO instagram_cuentas(ig_user_id,username,cliente_id) VALUES('5550001','stats_qa',$1)", [client]);
    for (const [fecha, n] of [['2026-09-30', 1000], ['2026-10-10', 1040], ['2026-10-31', 1120]])
      await pool.query('INSERT INTO instagram_cuenta_seguidores(ig_user_id,fecha,seguidores,medido_at) VALUES($1,$2,$3,now())', ['5550001', fecha, n]);
    const media = async (id, tipo, at, curve) => {
      await pool.query(`INSERT INTO instagram_media(ig_media_id,ig_user_id,cliente_id,tipo,permalink,caption,publicado_at)
        VALUES($1,'5550001',$2,$3,$4,$5,$6)`, [id, client, tipo, `https://www.instagram.com/p/${id}/`, `Pieza ${id}`, at]);
      for (const [h, alcance] of curve) await pool.query(`INSERT INTO instagram_media_metricas(ig_media_id,medido_at,alcance,vistas,likes,comentarios,guardados,compartidos,interacciones)
        VALUES($1,$2,$3,$4,1,0,1,1,3)`, [id, new Date(Date.parse(at) + h * 3600000), alcance, alcance * 2]);
    };
    // Tres reels previos de referencia (septiembre) y uno de octubre que rinde 3 veces más.
    await media('7000001', 'reel', '2026-09-05T23:00:00Z', [[1, 100], [24, 1000], [72, 1200]]);
    await media('7000002', 'reel', '2026-09-12T23:00:00Z', [[1, 200], [24, 1500], [72, 1800]]);
    await media('7000003', 'reel', '2026-09-20T23:00:00Z', [[1, 150], [24, 1200], [72, 1500]]);
    await media('7000004', 'reel', '2026-10-15T23:00:00Z', [[1, 600], [24, 4000], [72, 4500]]);
    await media('7000005', 'carrusel', '2026-10-20T15:00:00Z', [[24, 300]]);

    const stats = await readInstagramClientStats(pool, leader, `cliente-${client}`, { periodo: '2026-10' });
    assert.equal(stats.nombre, 'Stats QA'); assert.deepEqual(stats.cuentas, ['stats_qa']);
    assert.equal(stats.totales.actual.piezas, 2); assert.equal(stats.totales.actual.alcance, 4800);
    assert.equal(stats.totales.anterior.piezas, 3); assert.equal(stats.totales.anterior.alcance, 4500);
    assert.equal(stats.seguidores.crecimiento, 120); assert.equal(stats.seguidores.fin, 1120);
    const reel = stats.publicaciones.find(p => p.ig_media_id === '7000004');
    assert.equal(reel.medido_at,'2026-10-18T23:00:00.000Z');
    assert.equal(stats.promedio.reel.alcance, 2250); // (1200+1800+1500+4500)/4
    assert.equal(reel.puntaje, 2);
    assert.equal(stats.horarios.length, 4);

    const detail = await readInstagramMediaStats(pool, designer, '7000004');
    assert.equal(detail.tipo, 'reel'); assert.equal(detail.metricas.alcance, 4500);
    assert.equal(detail.promedio.alcance, 1500); assert.equal(detail.puntaje, 3);
    assert.deepEqual(detail.curva.mediciones.map(m => m.horas), [1, 24, 72]);
    const at24 = detail.curva.tipica.find(p => p.horas === 24);
    assert.deepEqual([at24.p25, at24.p50, at24.p75, at24.piezas], [1100, 1200, 1350, 3]);
    assert.equal(detail.curva.tipica.find(p => p.horas === 168).p50, null);
    assert.ok(!('ig_user_id' in detail) && !('cliente_id' in detail));

    await assert.rejects(readInstagramMediaStats(pool, leader, '1'), { status: 404 });
    await assert.rejects(readInstagramMediaStats(pool, leader, 'abc'), { status: 400 });
    await assert.rejects(readInstagramClientStats(pool, leader, `cliente-${client}`, { periodo: '2026-13' }), { status: 400 });
    await pool.query("UPDATE usuarios SET activo=false WHERE id=$1", [designer.id]);
    await assert.rejects(readInstagramMediaStats(pool, designer, '7000004'), { status: 401 });
  } finally { await pool.end(); }
});
