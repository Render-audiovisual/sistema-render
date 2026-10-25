import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {taskCommentActorPerson} from './taskCommentIdentity.js';

const users=[{id:7,nombre:'Alex',foto_perfil:'/avatars/7'},{id:8,nombre:'Alex',foto_perfil:'/avatars/8'}];
test('text author, even a unique exact name, never supplies a user identity',()=>{
  for(const roster of [users,users.slice(0,1)]) {
    assert.equal(taskCommentActorPerson({autor:'Alex'},roster),undefined);
    assert.equal(taskCommentActorPerson({autor:'Mía · Supervisor'},roster),undefined);
  }
});
test('only the durable numeric actor ID selects a profile, independent of labels and rename',()=>{
  assert.equal(taskCommentActorPerson({actor_usuario_id:8,autor:'Different historical label'},users),users[1]);
  const renamed=[{...users[1],nombre:'Renamed'}];
  assert.equal(taskCommentActorPerson({actor_usuario_id:8,autor:'Alex'},renamed),renamed[0]);
});
test('unknown, malformed, inactive or ambiguous identity fails closed without name fallback',()=>{
  for(const value of [undefined,null,0,-1,1.2,'7',true,{},2147483648,Number.MAX_SAFE_INTEGER])
    assert.equal(taskCommentActorPerson({actor_usuario_id:value,autor:'Alex'},users),undefined);
  assert.equal(taskCommentActorPerson({actor_usuario_id:9,autor:'Alex'},users),undefined);
  assert.equal(taskCommentActorPerson({actor_usuario_id:7},[{...users[0],activo:false}]),undefined);
  assert.equal(taskCommentActorPerson({actor_usuario_id:7},[users[0],{...users[0]}]),undefined);
  assert.equal(taskCommentActorPerson({actor_usuario_id:7},null),undefined);
});
test('lookup does not mutate comments or user profiles',()=>{
  const comment=Object.freeze({actor_usuario_id:7,autor:'Historical label'}),roster=Object.freeze(users.map(user=>Object.freeze({...user})));
  const before=JSON.stringify({comment,roster});taskCommentActorPerson(comment,roster);
  assert.equal(JSON.stringify({comment,roster}),before);
});
test('actual comment JSX uses identity resolver and retains textual author; no name-based avatar matching remains',()=>{
  const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
  assert.match(source,/<Avatar person=\{taskCommentActorPerson\(item, users\)\} name=\{item.autor\}/);
  assert.doesNotMatch(source,/users\.find\([^\n]*user\.nombre === item\.autor/);
});
