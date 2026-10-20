import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSelfProfileInput } from '../src/self-profile-input.js';
import { normalizeUserCreateInput } from '../src/user-create-input.js';
import { normalizeUserAdministrationPatch } from '../src/user-admin-patch.js';

const login={usuario_actual:'old_label',password_actual:'x',usuario_nuevo:' new_label '};
const password={usuario:'old_label',password_actual:'x',password_nueva:'Synthetic-policy-87!'};
test('self profile inputs are closed, typed and never select an actor ID supplied by the caller',()=>{
  for(const [operation,body] of [['photo',{usuario:'old_label',foto_perfil:''}],['login',login],['password',password]]) {
    for(const value of [null,[],{}, {...body,id:7}, {...body,rol:'admin'}, {...body,session_version:1}, {...body,expected_revision:'ua1:7:1'}]) {
      assert.throws(()=>normalizeSelfProfileInput(value,operation),{status:400,code:'PROFILE_INPUT_INVALID'});
    }
  }
});
test('photo removal is explicit and malformed input does not become deletion',()=>{
  for(const foto_perfil of ['',null,'  ']) assert.equal(normalizeSelfProfileInput({usuario:'old_label',foto_perfil},'photo').foto_perfil,null);
  for(const foto_perfil of [undefined,{},[],0,false,'https://example.invalid/photo.png','x'.repeat(1500001)]) assert.throws(()=>normalizeSelfProfileInput({usuario:'old_label',foto_perfil},'photo'),{status:400});
  assert.equal(normalizeSelfProfileInput({usuario:'old_label',foto_perfil:'data:image/png;base64,QA'},'photo').foto_perfil,'data:image/png;base64,QA');
});
test('current labels and legacy passwords remain exact while new login labels follow creation/login limits',()=>{
  const historical=' historical label ';
  assert.equal(normalizeSelfProfileInput({...login,usuario_actual:historical},'login').usuario_actual,historical);
  assert.equal(normalizeSelfProfileInput({...login,password_actual:' x '},'login').password_actual,' x ');
  assert.equal(normalizeSelfProfileInput(login,'login').usuario_nuevo,'new_label');
  for(const usuario_nuevo of ['',null,{},'x'.repeat(129),'🔒'.repeat(81),'a\nb']) assert.throws(()=>normalizeSelfProfileInput({...login,usuario_nuevo},'login'),{status:400});
  for(const password_actual of ['',{},null,'x'.repeat(1025)]) assert.throws(()=>normalizeSelfProfileInput({...password,password_actual},'password'),{status:400});
  for(const usuario of ['🔒'.repeat(81),'x'.repeat(129)]) {
    assert.throws(()=>normalizeUserCreateInput({usuario,nombre:'QA',rol:'edicion',password:password.password_nueva}),{status:400});
    assert.throws(()=>normalizeUserAdministrationPatch({usuario,nombre:'QA',rol:'edicion',expected_revision:'ua1:7:1'},'identity',7),{status:400});
  }
});
test('account creation and self rotation use the identical public password policy, without trimming or truncation',()=>{
  for(const next of ['x'.repeat(12),'x'.repeat(72),'é'.repeat(36),'🔒'.repeat(18),'  exact spaces  ']) {
    assert.equal(normalizeSelfProfileInput({...password,password_nueva:next},'password').password_nueva,next);
    assert.equal(normalizeUserCreateInput({usuario:'qa',nombre:'QA',rol:'edicion',password:next}).password,next);
  }
  for(const next of ['x'.repeat(11),'x'.repeat(73),'é'.repeat(37),'🔒'.repeat(11),' '.repeat(12), 'x'.repeat(12)+'\0', 'x'.repeat(12)+'\ud800']) {
    assert.throws(()=>normalizeSelfProfileInput({...password,password_nueva:next},'password'),{status:400,code:'NEW_PASSWORD_INVALID'});
    assert.throws(()=>normalizeUserCreateInput({usuario:'qa',nombre:'QA',rol:'edicion',password:next}),{status:400});
  }
  for(const password_nueva of [{},null,[],false,12]) assert.throws(()=>normalizeSelfProfileInput({...password,password_nueva},'password'),{status:400,code:'PROFILE_INPUT_INVALID'});
});
