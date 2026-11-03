import test from 'node:test';
import assert from 'node:assert/strict';
import {startLocalHarness,fixturePassword,assertFixtureIdentity} from '../scripts/render2-local-test.js';

test('real HTTP sessions: team reads Instagram, only Leader administers, anonymous and revoked sessions are rejected',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:120000,
},async t=>{
  const fixture=await startLocalHarness({browserSessions:true,port:55994});
  t.after(()=>fixture.cleanup());
  const [identity]=await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:fixture.root,cwd:fixture.root,port:55994,
    url:'postgresql://render2_fixture@127.0.0.1:55994/render2_local_test',identity});
  const [client]=await fixture.query("INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles) VALUES('IG HTTP Fixture',2,2) RETURNING id");
  const origin='http://127.0.0.1:5195';
  const http=async(path,{method='GET',headers={},body}={})=>{
    const response=await fetch(new URL('/api'+path,fixture.base),{method,redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{origin,'sec-fetch-site':'same-origin',...headers,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const login=async usuario=>{
    const challenge=await http('/sesion/desafio');assert.equal(challenge.status,200);
    const result=await http('/login/browser',{method:'POST',headers:{cookie:challenge.cookie,'x-render-csrf':challenge.data.csrf_token},
      body:{usuario,password:fixturePassword}});assert.equal(result.status,200);
    return {cookie:result.cookie,'x-render-session-context':result.data.session_context,'x-render-csrf':result.data.csrf_token};
  };
  const panel='/instagram/panel?periodo=2026-10',report=`/instagram/clientes/cliente-${client.id}/reporte?periodo=2026-10`;
  assert.equal((await http(panel)).status,401);assert.equal((await http(report)).status,401);
  assert.equal((await http('/instagram/conexion/estado')).status,401);
  const businessFingerprint=()=>fixture.query(`SELECT count(*)::int AS n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) AS fingerprint FROM tareas t`);
  const before=await businessFingerprint();
  let last;
  for(const role of ['diseno','edicion','produccion','community','programacion']){
    const username='ig_http_'+role;
    await fixture.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash) SELECT $1,$1,$2,password_hash FROM usuarios WHERE usuario='qa_designer'`,[username,role]);
    const headers=await login(username);last={username,headers};
    assert.equal((await http(panel,{headers})).status,200,`${role}: panel`);
    const result=await http(report,{headers});assert.equal(result.status,200,`${role}: report`);
    assert.equal(result.data.clave,`cliente-${client.id}`);
    assert.equal((await http('/instagram/reportes',{headers})).status,200);
    assert.equal((await http('/instagram/cuentas',{headers})).status,403);
    assert.equal((await http('/instagram/conexion/estado',{headers})).status,403);
    assert.equal((await http('/instagram/cuentas/111',{method:'PUT',headers,body:{cliente_id:client.id}})).status,403);
    assert.equal((await http('/instagram/media/111/vinculo',{method:'PUT',headers,body:{publicacion_id:null}})).status,403);
    assert.equal((await http('/contratos',{headers})).status,403,'financial access unchanged');
  }
  const leader=await login('qa_franco');
  assert.equal((await http('/instagram/cuentas',{headers:leader})).status,200);
  const connection=await http('/instagram/conexion/estado',{headers:leader});assert.equal(connection.status,200);
  assert.equal(connection.data.configurado,false,'fixture must not load any real token');
  assert.equal((await http('/instagram/conexion/estado?token=not-accepted',{headers:leader})).status,400);
  await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE usuario=$1',[last.username]);
  assert.equal((await http(panel,{headers:last.headers})).status,401);
  assert.deepEqual(await businessFingerprint(),before,'requests cannot change tasks');
});
