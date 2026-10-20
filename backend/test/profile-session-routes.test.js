import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
function fixture({route='foto',lostRead=false,lostWrite=false,duplicate=false,uniqueConflict=false,validPassword=true}={}){
  const start=source.indexOf(`router.patch("/usuarios/${route}"`),end=source.indexOf('\nrouter.',start+1);
  const code=source.slice(start,end),calls=[];let handler;
  const user={id:7,usuario:'current',nombre:'Actual',rol:'edicion',foto_perfil:null,password_hash:'injected-hash'};
  const pool={async query(sql,args){calls.push({sql,args});
    if(sql.startsWith('SELECT id FROM usuarios'))return{rows:duplicate?[{id:8}]:[]};
    if(sql.startsWith('SELECT'))return{rows:lostRead?[]:[user]};
    if(sql.includes('UPDATE usuarios')){
      if(uniqueConflict)throw Object.assign(Error('unique'),{code:'23505'});
      return{rows:lostWrite?[]:[{id:7,usuario:route==='perfil'?'updated':'current',nombre:'Actual',rol:'edicion',foto_perfil:route==='foto'?'data:image/png;base64,QA':null}]};
    }
    throw Error('Unexpected SQL');
  }};
  new Function('router','pool','bcrypt',code)({patch(_path,fn){handler=fn;}},pool,{compare:async()=>validPassword,hash:async()=>'injected-new-hash'});
  return{calls,async run(body){const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
    await handler({auth:{id:7,usuario:'current',session_version:3},body},res,e=>{throw e;});return res;}};
}
const inputs={foto:{usuario:'current',foto_perfil:'data:image/png;base64,QA'},perfil:{usuario_actual:'current',password_actual:'qa',usuario_nuevo:'updated'},password:{usuario:'current',password_actual:'qa',password_nueva:'qa-new'}};
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
  assert.equal((await fixture({route:'perfil',duplicate:true}).run(inputs.perfil)).statusCode,409);
  assert.equal((await fixture({route:'perfil',uniqueConflict:true}).run(inputs.perfil)).statusCode,409);
});
