import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUserLoginIdentifierAvailable } from '../src/user-login-namespace.js';

test('namespace check uses parameterized resolver LOWER rules and excludes only the same immutable ID',async()=>{
  let observed;
  await assertUserLoginIdentifierAvailable({async query(sql,values){observed={sql,values};return{rows:[]};}},
    {id:7,next:'NEW@example.invalid',previous:'old_login'});
  assert.deepEqual(observed.values,[7,'NEW@example.invalid','old_login']);
  assert.match(observed.sql,/id<>\$1/);assert.match(observed.sql,/lower\(usuario\)=lower\(\$2::text\)/);
  assert.match(observed.sql,/lower\(google_email\)=lower\(\$2::text\)/);
  assert.match(observed.sql,/lower\(\$2::text\) IS DISTINCT FROM lower\(\$3::text\)/);
  assert.doesNotMatch(observed.sql,/email_notificaciones|activo|btrim|unaccent|INSERT|UPDATE|DELETE/);
});
test('conflicts return a bounded unavailable result without identifying the other account',async()=>{
  await assert.rejects(assertUserLoginIdentifierAvailable({query:async()=>({rows:[{id:99,google_email:'private@example.invalid'}]})},
    {id:7,next:'alias@example.invalid',previous:'old'}),error=>{
    assert.equal(error.status,409);assert.equal(error.code,'LOGIN_IDENTIFIER_UNAVAILABLE');
    assert.ok(!error.message.includes('private@example.invalid'));assert.ok(!error.message.includes('99'));return true;
  });
});
test('explicit removal requires no namespace lookup and new account checks have no excluded ID',async()=>{
  await assertUserLoginIdentifierAvailable({query:()=>assert.fail('No new alias is acquired')},{id:7,next:null,previous:'old@example.invalid'});
  let values;
  await assertUserLoginIdentifierAvailable({async query(_sql,args){values=args;return{rows:[]};}},{next:'new_login'});
  assert.deepEqual(values,[null,'new_login',null]);
  for(const invalid of [{next:{}},{next:''},{id:0,next:'new'}]) await assert.rejects(assertUserLoginIdentifierAvailable({},invalid),{status:400});
});
