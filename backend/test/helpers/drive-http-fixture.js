import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity} from '../../scripts/render2-local-test.js';
import {requireAuthentication,requireCurrentIdentity,requireRole,issueUserToken} from '../../src/auth.js';
import {createGoogleDriveRouter,createGoogleDrivePublicRouter} from '../../src/google-drive.js';

let active=false;
// Runs only when an opted-in integration test calls it. The isolated test
// worker owns its synthetic JWT secret; no dotenv/configured DB is consulted.
export async function startDriveHttpFixture({port,driveRouterOptions={}}){
  if(!driveRouterOptions||typeof driveRouterOptions!=='object'||Array.isArray(driveRouterOptions)
    ||Object.keys(driveRouterOptions).some(key=>!['providerFactory','providerTimeoutMs'].includes(key)))throw Error('Unsafe Drive fixture dependency override');
  if(active)throw Error('Only one Drive fixture may own this test worker');
  active=true;
  let fixture,pool,server,closed=false;
  const secret=randomBytes(32).toString('hex');
  const cleanup=async()=>{
    if(closed)return;closed=true;
    try{
      if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
      if(pool)await pool.end();
    }finally{
      if(fixture){await fixture.cleanup();await assert.rejects(access(fixture.root),{code:'ENOENT'});}
      if(process.env.JWT_SECRET===secret)delete process.env.JWT_SECRET;
      active=false;
    }
  };
  try{
    fixture=await startLocalHarness({port,clusterOnly:true});
    const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
    pool=new pg.Pool({connectionString:url,statement_timeout:10000});
    const identity=(await pool.query(`SELECT current_database() database,current_user username,
      host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
    assertFixtureIdentity({root:fixture.root,cwd:fixture.root,port,url,identity});
    process.env.JWT_SECRET=secret;
    const app=express();app.disable('x-powered-by');app.use(express.json({limit:'1mb'}));
    app.use('/api/drive',createGoogleDrivePublicRouter({express,pool,jwtSecret:secret,...driveRouterOptions}));
    app.use('/api/drive',requireAuthentication,requireCurrentIdentity(pool),
      createGoogleDriveRouter({express,pool,requireRole,jwtSecret:secret,...driveRouterOptions}));
    app.use((_req,res)=>res.status(404).json({error:'Ruta de prueba no disponible.'}));
    app.use((error,_req,res,_next)=>res.status(Number.isInteger(error.status)?error.status:500).json({error:'Operación rechazada por el servidor de prueba.'}));
    server=app.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    return{root:fixture.root,base,pool,query:fixture.query,cleanup,
      async tokenFor(id){
        const user=(await pool.query('SELECT id,activo,session_version FROM usuarios WHERE id=$1',[id])).rows[0];
        return issueUserToken(user,secret);
      },
      async api(path,{token,method='GET',body,range,raw=false}={}){
        const response=await fetch(new URL(`/api/drive${path}`,base),{method,signal:AbortSignal.timeout(5000),redirect:'manual',
          headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'content-type':raw?'application/octet-stream':'application/json'}),...(range?{'content-range':range}:{})},
          ...(body===undefined?{}:{body:raw?body:JSON.stringify(body)})});
        const rawBody=await response.text();
        let result;try{result=rawBody?JSON.parse(rawBody):null;}catch{result=rawBody;}
        return{status:response.status,body:result,location:response.headers.get('location')};
      }};
  }catch(error){await cleanup();throw error;}
}
