import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OWNER_ACCESS_CHOICES,ownerAccessLabel,readOwnerAccessChoice,rememberOwnerAccessChoice} from './owner-access-choice.js';
test('owner choice persists only a bounded display hint, never identity or credentials',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  assert.deepEqual(OWNER_ACCESS_CHOICES.map(o=>o.id),['franco','agustin']);
  assert.equal(readOwnerAccessChoice(storage),null);
  assert.equal(rememberOwnerAccessChoice('agustin',storage),true);
  assert.equal(readOwnerAccessChoice(storage),'agustin');
  assert.equal(ownerAccessLabel('agustin'),'Agustín');
  assert.equal(rememberOwnerAccessChoice('admin',storage),false);
  assert.equal(rememberOwnerAccessChoice({id:1,rol:'admin'},storage),false);
  assert.deepEqual([...values.values()],['agustin']);
  values.set('render.owner-access-choice','<script>');assert.equal(readOwnerAccessChoice(storage),null);
});
test('unavailable optional storage cannot grant identity or crash login',()=>{
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
  assert.equal(readOwnerAccessChoice(denied),null);
  assert.equal(rememberOwnerAccessChoice('franco',denied),false);
  assert.equal(readOwnerAccessChoice(null),null);
});
test('home uses verified runtime profiles, never legacy display hints or logout; Login remains authentication only',()=>{
  const app=readFileSync(new URL('../../App.jsx',import.meta.url),'utf8');
  const callback=app.slice(app.indexOf('const changeOwnerAccess'),app.indexOf('const changeOwnerAccess')+1300);
  assert.match(callback,/ownerProfileCapability\(sessionSnapshot.session\)/);
  assert.match(callback,/getApplicationSessionSnapshot\(\) !== sessionSnapshot/);
  assert.match(callback,/ownerProfileActions.current.change\(choice, sessionSnapshot\)/);
  assert.doesNotMatch(callback,/guardarSesion|password|qa_franco|qa_agustin|logout\(|sessionStorage/);
  const login=readFileSync(new URL('../../pages/Login.jsx',import.meta.url),'utf8');
  assert.match(login,/iniciarSesion\('password', \{ usuario, password \}\)/);
  assert.doesNotMatch(login,/login-owner-access|login-owner-hint|OWNER_ACCESS_CHOICES|ownerChoice/);
  const home=readFileSync(new URL('../../pages/QuickHome.jsx',import.meta.url),'utf8');
  assert.match(home,/Elegir perfil activo de Cuenta Render/);
  assert.match(home,/ownerProfiles.profiles.map/);
  assert.match(home,/aria-pressed=\{ownerProfiles.active === profile.key\}/);
});
