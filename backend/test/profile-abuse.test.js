import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileCredentialBucketKey,reserveProfileCredentialAttempt,loginAbuseBucketKey} from '../src/login-abuse.js';
const secret='synthetic-profile-rate-secret';
test('profile budget uses stable actor identity and distinct HMAC domain',()=>{
  const key=profileCredentialBucketKey(7,secret);assert.match(key,/^[a-f0-9]{64}$/);
  assert.notEqual(key,profileCredentialBucketKey(8,secret));assert.notEqual(key,loginAbuseBucketKey('identifier','7',secret));
  for(const id of [0,-1,'7',7.1,null,NaN,Infinity,2147483648])assert.throws(()=>profileCredentialBucketKey(id,secret),{status:503});
  for(const id of [1,2147483647])assert.match(profileCredentialBucketKey(id,secret),/^[a-f0-9]{64}$/);
});
test('exhausted profile budget commits read-only denial before cleanup/reservation',async()=>{
  const calls=[];let released=false;
  const client={async query({text,values}){calls.push({text,values});return {rows:text.includes('SELECT attempts,')?[{attempts:10,retry_after:31}]:[]};},release(){released=true;}};
  assert.deepEqual(await reserveProfileCredentialAttempt({connect:async()=>client},7,secret),{allowed:false,retryAfter:31});
  assert.ok(released);assert.ok(calls.some(x=>x.text==='COMMIT'));
  assert.ok(!calls.some(x=>/INSERT|UPDATE|DELETE/.test(x.text)));
});
test('storage failure denies with sanitized unavailable error',async()=>{
  await assert.rejects(reserveProfileCredentialAttempt({connect:async()=>{throw Error('private diagnostic');}},7,secret),e=>e.status===503&&!e.message.includes('private'));
});
for(const failure of ['SELECT attempts,','COMMIT'])test(`profile denial ${failure} failure rolls back and discards connection`,async()=>{
  const calls=[];let discarded;
  const client={async query({text}){calls.push(text);if(text.startsWith(failure))throw Error('private rate storage failure');return {rows:text.includes('SELECT attempts,')?[{attempts:10,retry_after:20}]:[]};},release(value){discarded=value;}};
  await assert.rejects(reserveProfileCredentialAttempt({connect:async()=>client},7,secret),e=>e.status===503&&!e.message.includes('private'));
  assert.ok(calls.includes('ROLLBACK'));assert.equal(discarded,true);assert.ok(!calls.some(sql=>/INSERT|UPDATE|DELETE/.test(sql)));
});
test('both actual credential routes gate compare; photo route stays outside budget',()=>{
  const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  for(const route of ['perfil','password']){
    const start=source.indexOf(`router.patch("/usuarios/${route}"`),end=source.indexOf('\nrouter.',start+1),body=source.slice(start,end);
    assert.ok(body.indexOf('allowProfileCredentialAttempt(req, res)')>body.indexOf('found.rows.length'));
    assert.ok(body.indexOf('allowProfileCredentialAttempt(req, res)')<body.indexOf('bcrypt.compare'));
  }
});
