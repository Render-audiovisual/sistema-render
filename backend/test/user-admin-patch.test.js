import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { userAdministrationId, expectedUserAdministrationVersion, normalizeUserAdministrationPatch } from '../src/user-admin-patch.js';

const revision = 'ua1:19:4';
const parse = (operation,body) => normalizeUserAdministrationPatch(body,operation,19);
test('account IDs and observations are canonical, bounded and resource-specific',()=>{
  assert.equal(userAdministrationId('19'),19); assert.equal(expectedUserAdministrationVersion(revision,19),4);
  for (const id of [19,'0','01','19\n','-1','2147483648','1e2',{},null]) assert.throws(()=>userAdministrationId(id),{status:400});
  assert.throws(()=>expectedUserAdministrationVersion(undefined,19),{status:428});
  for (const value of [null,{},19,'ua1:19:0','ua1:0:1','ua1:19:2147483648','ua1:19:4\n','ua1:019:4']) assert.throws(()=>expectedUserAdministrationVersion(value,19),{status:400});
  assert.throws(()=>expectedUserAdministrationVersion('ua1:20:4',19),{status:409,code:'USER_ADMIN_REVISION_CONFLICT'});
});
test('contact removal requires an explicit empty or null typed value; missing or malformed values never become removal',()=>{
  for (const [operation,key] of [['notices','email_notificaciones'],['google','google_email'],['whatsapp','whatsapp']]) {
    for (const value of [null,'','  ']) assert.equal(parse(operation,{expected_revision:revision,[key]:value})[key],null);
    for (const value of [undefined,1,false,{},[],['']]) assert.throws(()=>parse(operation,{expected_revision:revision,[key]:value}),{status:400});
    assert.throws(()=>parse(operation,{expected_revision:revision}),{status:400});
    for (const body of [null,[],{}, {[key]:'',expected_revision:revision,activo:false}, {[key]:'',expected_revision:revision,session_version:1}]) {
      assert.throws(()=>parse(operation,body));
    }
  }
});
test('closed patches preserve normalized contact intent without accepting controls or malformed addresses/numbers',()=>{
  assert.equal(parse('notices',{expected_revision:revision,email_notificaciones:' QA@example.invalid '}).email_notificaciones,'qa@example.invalid');
  assert.equal(parse('google',{expected_revision:revision,google_email:' QA@example.invalid '}).google_email,'qa@example.invalid');
  assert.equal(parse('whatsapp',{expected_revision:revision,whatsapp:'+54 (9) 3794-000086'}).whatsapp,'5493794000086');
  for (const operation of ['notices','google']) {
    const key=operation==='notices'?'email_notificaciones':'google_email';
    for(const value of ['not-an-email','a@b','a\n@b.test','a@b.test\0','x'.repeat(255)+'@example.test']) assert.throws(()=>parse(operation,{expected_revision:revision,[key]:value}),{status:400});
  }
  for(const whatsapp of ['letters5493794000086','123','1'.repeat(16),'++','549\n3794000086', '1'.repeat(101)]) assert.throws(()=>parse('whatsapp',{expected_revision:revision,whatsapp}),{status:400});
});
test('access is boolean and identity remains explicitly chosen with validated labels and custom roles',()=>{
  for(const activo of [true,false]) assert.equal(parse('access',{expected_revision:revision,activo}).activo,activo);
  for(const activo of ['false',0,null,{},undefined]) assert.throws(()=>parse('access',{expected_revision:revision,activo}),{status:400});
  const result=parse('identity',{expected_revision:revision,nombre:' Persona QA ',usuario:' cuenta_qa ',rol:'Fotografía'});
  assert.equal(result.nombre,'Persona QA');assert.equal(result.usuario,'cuenta_qa');assert.equal(result.rol,'fotografia');assert.equal(result.expected_version,4);
  for(const patch of [{nombre:[]},{usuario:'x'.repeat(129)},{rol:{}},{nombre:'a\nb'},{rol:'x'},{id:19}]) assert.throws(()=>parse('identity',{expected_revision:revision,nombre:'QA',usuario:'qa',rol:'edicion',...patch}),{status:400});
});
test('version migration adds observations only and monotonically advances on every update',()=>{
  const sql=readFileSync(new URL('../migrations/074_user_administration_versions.sql',import.meta.url),'utf8');
  assert.match(sql,/ADD COLUMN user_admin_version INTEGER NOT NULL DEFAULT 1 CHECK \(user_admin_version > 0\)/);
  assert.match(sql,/NEW.user_admin_version := OLD.user_admin_version \+ 1/);
  assert.match(sql,/BEFORE UPDATE ON usuarios\s+FOR EACH ROW/);
  assert.doesNotMatch(sql,/\b(DELETE|TRUNCATE|UPDATE usuarios SET)\b/i);
});
