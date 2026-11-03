import test from 'node:test';import assert from 'node:assert/strict';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
const enabled=process.env.RENDER2_RUN_LOCAL_INTEGRATION==='true';let fixture,pool;
test.before(async()=>{
 if(!enabled)return;
 fixture=await startLocalHarness({port:55983,clusterOnly:true});
 const url='postgresql://render2_fixture@127.0.0.1:55983/render2_local_test';
 const [identity]=await fixture.query("SELECT current_database() database,current_user username,host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory");
 assertFixtureIdentity({root:fixture.root,cwd:fixture.root,port:55983,url,identity});
 const {AuthorityBoundPool}=await import('../src/database-authority-context.js');pool=new AuthorityBoundPool({connectionString:url,max:3});
});
test.after(async()=>{await pool?.end();await fixture?.cleanup();});
test('verified Facebook fallback persists, refreshes, respects native data and never alters tasks',{skip:!enabled},async()=>{
 const {runInstagramSync}=await import('../src/instagram-sync.js');
 const {readInstagramClientStats}=await import('../src/instagram-panel.js');
 const client=(await pool.query("INSERT INTO clientes(nombre) VALUES('FB fallback fixture') RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO instagram_cuentas(ig_user_id,username,cliente_id,page_id) VALUES('551001','fb_fixture',$1,'551002')",[client]);
 const now=new Date('2026-11-03T23:00:00Z');
 const link={version:1,active:true,verifiedBy:'visual_content',verifiedAt:now.toISOString(),igMediaId:'551003',igUserId:'551001',clientId:client,
  pageId:'551002',facebookVideoId:'551004',instagramPermalink:'https://www.instagram.com/reel/FixtureFB/',facebookPermalink:'https://www.facebook.com/reel/551004/'};
 await pool.query("INSERT INTO instagram_media(ig_media_id,ig_user_id,cliente_id,tipo,permalink,caption,publicado_at) VALUES('551003','551001',$1,'reel',$2,'Fixture','2026-10-01T15:00:00Z')",[client,link.instagramPermalink]);
 const {registerVerifiedFacebookLinks}=await import('../src/instagram-facebook-links.js');
 assert.equal(await registerVerifiedFacebookLinks(pool,[link],now),1);
 assert.equal(await registerVerifiedFacebookLinks(pool,[link],now),0);
 await assert.rejects(registerVerifiedFacebookLinks(pool,[{...link,facebookVideoId:'991',facebookPermalink:'https://www.facebook.com/reel/991/'}],now));
 const fingerprint=async()=>(await pool.query("SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) hash FROM tareas t")).rows[0];
 const before=await fingerprint();let fbReads=0,native=false;
 const graph={listInstagramAccounts:async()=>[{igUserId:'551001',username:'fb_fixture',pageId:'551002',followers:null}],
  listMedia:async()=>[{igMediaId:'551003',tipo:'reel',permalink:link.instagramPermalink,caption:'Fixture',publishedAt:new Date('2026-10-01T15:00:00Z')}],
  mediaInsights:async()=>({vistas:100,vistas_instagram:100,vistas_facebook:native?7:null,vistas_total:native?107:null}),
  facebookVideoViews:async(page,video)=>{assert.equal(page,'551002');assert.equal(video,'551004');fbReads++;return 25+fbReads;}};
 await runInstagramSync(pool,{now,graph,env:{},refreshMetrics:true});
 assert.equal(fbReads,1);
 const read=async()=>{
  const auth=(await pool.query('SELECT id,rol,session_version FROM usuarios WHERE id=91001')).rows[0];
  return readInstagramClientStats(pool,auth,`cliente-${client}`,{periodo:'2026-10'});
 };
 let stats=await read();assert.equal(stats.totales.actual.vistas_disponibles,126);assert.equal(stats.totales.actual.publicaciones_sin_facebook,0);
 await runInstagramSync(pool,{now:new Date(+now+4*3600000),graph,env:{},refreshMetrics:true});
 stats=await read();assert.equal(stats.totales.actual.vistas_disponibles,127);assert.equal(stats.publicaciones.length,1);
 native=true;await runInstagramSync(pool,{now:new Date(+now+8*3600000),graph,env:{},refreshMetrics:true});
 stats=await read();assert.equal(stats.totales.actual.vistas_disponibles,107);assert.equal(fbReads,2);
 assert.deepEqual(await fingerprint(),before);
});
