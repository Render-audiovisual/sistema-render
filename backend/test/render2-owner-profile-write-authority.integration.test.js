import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { configuredOwnerProfiles, rememberOwnerProfileSession } from '../src/owner-profile-authority.js';
import { AuthorityBoundPool } from '../src/database-authority-context.js';
import { withProductionAuthority } from '../src/production-authority.js';
import { withFinanceWrite } from '../src/finance-write-authority.js';
import { captureTaskWriteActor, assertCurrentTaskWriteActor } from '../src/task-state-authority.js';
import { captureFinanceActor } from '../src/finance-snapshot.js';
import { withUserAdministration } from '../src/user-administration.js';
import { captureClientCreator, lockCurrentClientCreator } from '../src/client-create-authority.js';
import { withPersonalListWrite } from '../src/personal-list-write-authority.js';

test('delegated production/finance writes hold the shared principal through actual PostgreSQL commits', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port=55629, f=await startLocalHarness({port,clusterOnly:true});
  let pool;
  t.after(async()=>{
    try { if(pool)await pool.end(); } finally { await f.cleanup(); }
    await assert.rejects(access(f.root),{code:'ENOENT'});
  });
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  pool=new AuthorityBoundPool({connectionString:url,max:8,statement_timeout:12000,connectionTimeoutMillis:5000});
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:(await pool.query(`SELECT
    current_database() AS database,current_user AS username,host(inet_server_addr()) AS address,
    inet_server_port() AS port,current_setting('data_directory') AS directory`)).rows[0]});
  await pool.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    VALUES (91005,'qa_owner_write_franco','QA Franco','admin','!NO_LOGIN',true,1),
      (91006,'qa_owner_write_agustin','QA Agustin','admin','!NO_LOGIN',true,1)`);
  await pool.query('CREATE TABLE qa_owner_write_evidence(id integer PRIMARY KEY)');
  const policy=configuredOwnerProfiles({NODE_ENV:'test',RENDER_DB_ENVIRONMENT:'test',DATABASE_URL:url,
    RENDER_OWNER_PROFILES:JSON.stringify({accountId:91001,francoUserId:91005,agustinUserId:91006})},pool).policy;
  const auth=async()=>{
    const root=(await pool.query('SELECT session_version FROM usuarios WHERE id=91001')).rows[0];
    const claims={id:91005,rol:'admin',session_version:1,root_id:91001,
      root_session_version:root.session_version,owner_profile:'franco',
      exp:Math.floor(Date.now()/1000)+300,root_exp:Math.floor(Date.now()/1000)+300};
    rememberOwnerProfileSession(claims,claims,policy);return claims;
  };
  const observe=async(blocker,queryPattern)=>{
    const deadline=Date.now()+7000;
    while(Date.now()<deadline){
      const rows=(await pool.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND state='active' AND wait_event_type='Lock' AND query ~* $2
        AND $1::int=ANY(pg_blocking_pids(pid))`,[blocker,queryPattern])).rows;
      if(rows.length)return rows[0].pid;
    }
    assert.fail('Required PostgreSQL blocking relationship was not observed');
  };
  let sequence=0;
  for(const [name,write] of [
    ['production',(a,fn)=>withProductionAuthority(pool,a,false,fn)],
    ['finance',(a,fn)=>withFinanceWrite(pool,a,fn)],
    ['finance-recaptured',(a,fn)=>withFinanceWrite(pool,captureFinanceActor(captureFinanceActor(a)),fn)],
    ['accounts',(a,fn)=>withUserAdministration(pool,a,fn)],
    ['personal-list',(a,fn)=>withPersonalListWrite(pool,a,{},db=>fn(db))],
    ['clients',async(a,fn)=>{
      const captured=captureClientCreator(captureClientCreator(a)),db=await pool.connect();
      try {
        await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await db.query('SELECT pg_advisory_xact_lock(8142,1)');
        await lockCurrentClientCreator(db,captured);
        const result=await fn(db);await db.query('COMMIT');return result;
      } catch(error) {await db.query('ROLLBACK');throw error;}
      finally {db.release();}
    }],
    ['task',async(a,fn)=>{
      const captured=captureTaskWriteActor(captureTaskWriteActor(a));
      const db=await pool.connect();
      try {
        await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await assertCurrentTaskWriteActor(db,captured);
        const result=await fn(db);await db.query('COMMIT');return result;
      } catch(error) {await db.query('ROLLBACK');throw error;}
      finally {db.release();}
    }],
  ]){
    await t.test(`${name}: revocation commits first, pending write rejects without domain mutation`,async()=>{
      const a=await auth(),locker=await pool.connect();let pending;
      try {
        await locker.query('BEGIN');
        const pid=(await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await locker.query('SELECT id FROM usuarios WHERE id=91001 FOR UPDATE');
        let mutations=0;
        pending=write(a,async db=>{mutations++;await db.query('INSERT INTO qa_owner_write_evidence VALUES($1)',[++sequence]);});
        // Attach rejection immediately; the observed lock establishes ordering.
        const rejected=assert.rejects(pending,{status:401});
        await observe(pid,'ORDER BY id.*FOR (SHARE|UPDATE)');
        await locker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91001');
        await locker.query('COMMIT');
        await rejected;assert.equal(mutations,0);
      } finally {await locker.query('ROLLBACK');locker.release();if(pending)await pending.catch(()=>{});}
    });
    await t.test(`${name}: authorized writer holds root until commit, concurrent revocation waits`,async()=>{
      const a=await auth(),domain=await pool.connect(),revoker=await pool.connect();
      let pending,revoke;
      try {
        await domain.query('BEGIN');
        const domainPid=(await domain.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await domain.query('SELECT pg_advisory_xact_lock(20261028, 991)');
        const id=++sequence;
        pending=write(a,async db=>{
          await db.query('SELECT pg_advisory_xact_lock(20261028, 991)');
          await db.query('INSERT INTO qa_owner_write_evidence VALUES($1)',[id]);return id;
        });
        const writerPid=await observe(domainPid,'pg_advisory_xact_lock');
        revoke=revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91001');
        await observe(writerPid,'UPDATE usuarios SET session_version');
        await domain.query('COMMIT');
        assert.equal(await pending,id);await revoke;
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM qa_owner_write_evidence WHERE id=$1',[id])).rows[0].n,1);
        await assert.rejects(write(a,async()=>assert.fail('Revoked session reached domain')),{status:401});
      } finally {
        await domain.query('ROLLBACK');domain.release();
        if(pending)await pending.catch(()=>{});if(revoke)await revoke.catch(()=>{});revoker.release();
      }
    });
  }
});
