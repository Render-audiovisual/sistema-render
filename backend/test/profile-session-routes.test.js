import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSelfProfileInput } from '../src/self-profile-input.js';
import { assertUserLoginIdentifierAvailable } from '../src/user-login-namespace.js';
import { withSelfIdentityChange } from '../src/user-administration.js';

const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
function fixture({route='foto',lostRead=false,lostWrite=false,duplicate=false,uniqueConflict=false,validPassword=true,allowCredential=true}={}){
  const start=source.indexOf(`router.patch("/usuarios/${route}"`),end=source.indexOf('\nrouter.',start+1);
  const code=source.slice(start,end),calls=[],checks=[];let handler;
  const user={id:7,usuario:'current',nombre:'Actual',rol:'edicion',activo:true,session_version:3,google_email:null,foto_perfil:null,password_hash:'injected-hash'};
  const pool={async query(sql,args){calls.push({sql,args});
    if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('pg_advisory_xact_lock'))return{rows:[]};
    if(sql.startsWith('SELECT id FROM usuarios'))return{rows:duplicate?[{id:8}]:[]};
    if(sql.startsWith('SELECT'))return{rows:lostRead?[]:[user]};
    if(sql.includes('UPDATE usuarios')){
      if(uniqueConflict)throw Object.assign(Error('unique'),{code:'23505'});
      return{rows:lostWrite?[]:[{id:7,usuario:route==='perfil'?'updated':'current',nombre:'Actual',rol:'edicion',foto_perfil:route==='foto'?'data:image/png;base64,QA':null}]};
    }
    throw Error('Unexpected SQL');
  }};
  pool.connect=async()=>({query:pool.query,release(){calls.push({sql:'release',args:[]});}});
  new Function('router','pool','bcrypt','normalizeSelfProfileInput','assertUserLoginIdentifierAvailable','withSelfIdentityChange','allowProfileCredentialAttempt',code)({patch(_path,fn){handler=fn;}},pool,{compare:async()=>{checks.push('compare');return validPassword;},hash:async()=>{checks.push('hash');return 'injected-new-hash';}},normalizeSelfProfileInput,assertUserLoginIdentifierAvailable,withSelfIdentityChange,async(_req,res)=>{checks.push('gate');if(!allowCredential)res.status(429).json({code:'PROFILE_RATE_LIMITED'});return allowCredential;});
  return{calls,checks,async run(body){const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
    await handler({auth:{id:7,usuario:'current',session_version:3},body},res,e=>{throw e;});return res;}};
}
const inputs={foto:{usuario:'current',foto_perfil:'data:image/png;base64,QA'},perfil:{usuario_actual:'current',password_actual:'qa',usuario_nuevo:'updated'},password:{usuario:'current',password_actual:'qa',password_nueva:'Synthetic-new-password87!'}};
test('exhausted credential budget returns before bcrypt or any account write in both real handlers',async()=>{
  for(const route of ['perfil','password']){
    const f=fixture({route,allowCredential:false});assert.equal((await f.run(inputs[route])).statusCode,429);
    assert.deepEqual(f.checks,['gate']);assert.ok(f.calls.every(({sql})=>sql.startsWith('SELECT')));
  }
  const photo=fixture({route:'foto',allowCredential:false});assert.equal((await photo.run(inputs.foto)).statusCode,200);assert.deepEqual(photo.checks,[]);
});
for(const route of ['foto','perfil','password']){
  test(`${route}: actual handler selects actor by immutable ID and CAS, never chooses a write target from name`,async()=>{
    const f=fixture({route}),result=await f.run(inputs[route]);assert.equal(result.statusCode,200);
    const write=f.calls.find(({sql})=>sql.includes('UPDATE usuarios'));assert.ok(write);
    assert.match(write.sql,/WHERE id = \$2 AND session_version=\$3 AND activo IS TRUE/);
    assert.deepEqual(write.args.slice(1),[7,3]);
    if(route!=='foto')assert.match(f.calls.find(({sql})=>sql.startsWith('SELECT')&&!sql.startsWith('SELECT id FROM')).sql,/WHERE id=\$1 AND session_version=\$2 AND activo IS TRUE/);
    if(route==='foto')assert.equal(result.body.id,7);
    else assert.match(write.sql,/session_version=session_version\+1/);
  });
  test(`${route}: competing session revocation at write is not reported as success`,async()=>{
    const f=fixture({route,lostWrite:true});const response=await f.run(inputs[route]);assert.equal(response.statusCode,401);assert.equal(response.body.ok,undefined);
    if(route!=='foto')assert.equal((await fixture({route,lostRead:true}).run(inputs[route])).statusCode,401);
  });
  test(`${route}: another username in body never causes a DB write`,async()=>{
    const f=fixture({route}),field=route==='perfil'?'usuario_actual':'usuario';
    assert.equal((await f.run({...inputs[route],[field]:'another-person'})).statusCode,403);assert.equal(f.calls.length,0);
  });
}
test('wrong password, duplicate name and uniqueness race are explicit failures without identity replacement',async()=>{
  for(const route of ['perfil','password']){
    const result=await fixture({route,validPassword:false}).run(inputs[route]);
    assert.equal(result.statusCode,401);assert.equal(result.body.code,'current_password_invalid');
  }
  const collision=fixture({route:'perfil',duplicate:true});
  await assert.rejects(collision.run(inputs.perfil),error=>error.status===409&&error.code==='LOGIN_IDENTIFIER_UNAVAILABLE');
  assert.equal(collision.calls.some(({sql})=>sql.includes('UPDATE usuarios')),false);
  assert.equal((await fixture({route:'perfil',uniqueConflict:true}).run(inputs.perfil)).statusCode,409);
});

test('actual handlers invoke real normalizer before database access on unknown or missing fields',async()=>{
  for(const route of ['foto','perfil','password']){
    const extra=fixture({route});
    await assert.rejects(extra.run({...inputs[route],unexpected:true}),error=>error.status===400&&error.code==='PROFILE_INPUT_INVALID');
    assert.equal(extra.calls.length,0);
    const missing=fixture({route}),body={...inputs[route]};delete body[route==='foto'?'foto_perfil':route==='perfil'?'usuario_nuevo':'password_nueva'];
    await assert.rejects(missing.run(body),error=>error.status===400&&error.code==='PROFILE_INPUT_INVALID');
    assert.equal(missing.calls.length,0);
  }
});

test('policy-invalid new password is rejected before current-password lookup or hash/write',async()=>{
  const f=fixture({route:'password'});
  await assert.rejects(f.run({...inputs.password,password_nueva:'short'}),error=>error.status===400&&error.code==='NEW_PASSWORD_INVALID');
  assert.equal(f.calls.length,0);
});

test('photo explicit null/empty clears map to SQL null, missing photo never becomes implicit clear',async()=>{
  for(const foto_perfil of [null,'']){
    const f=fixture({route:'foto'}),result=await f.run({...inputs.foto,foto_perfil});
    assert.equal(result.statusCode,200);
    assert.equal(f.calls.find(({sql})=>sql.includes('UPDATE usuarios')).args[0],null);
  }
});

test('self rename uses actual authority/namespace helpers before unchanged ID+epoch CAS update and commit',async()=>{
  const f=fixture({route:'perfil'});assert.equal((await f.run(inputs.perfil)).statusCode,200);
  const at=pattern=>f.calls.findIndex(({sql})=>pattern.test(sql));
  const begin=at(/^BEGIN ISOLATION LEVEL READ COMMITTED/),mutex=at(/pg_advisory_xact_lock/);
  const actor=at(/SELECT id,rol,activo,session_version,usuario,google_email.*FOR UPDATE/);
  const namespace=at(/lower\(google_email\)=lower\(\$2::text\)/),write=at(/UPDATE usuarios/),commit=at(/^COMMIT$/);
  assert.ok(begin>=0&&begin<mutex&&mutex<actor&&actor<namespace&&namespace<write&&write<commit);
  assert.deepEqual(f.calls[actor].args,[7]);
  assert.deepEqual(f.calls[namespace].args,[7,'updated','current']);
  assert.equal(f.calls.at(-1).sql,'release');
});
