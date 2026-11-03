import test from 'node:test';
import assert from 'node:assert/strict';
import {readInstagramClientDirectory} from '../src/instagram-panel.js';

function fixture(active=true) {
  const queries=[];
  const db={release(){},async query(sql){
    queries.push(sql);
    if(sql.includes('FROM usuarios'))return {rows:[{id:2,rol:'empleado',activo:active,session_version:1}]};
    if(sql.includes('FROM clientes c'))return {rows:[
      {id:1,clave:'grupo-1',nombre:'Uno',grupo_nombre:'Grupo'},
      {id:3,clave:'grupo-1',nombre:'Dos',grupo_nombre:'Grupo'},
    ]};
    if(sql.includes('FROM instagram_cuentas'))return {rows:[{ig_user_id:'10',username:'cuenta',cliente_id:1}]};
    return {rows:[]};
  }};
  return {queries,pool:{async connect(){return db;}}};
}

test('directory reads identities only, shares feeds and retains employee authorization',async()=>{
  const f=fixture();
  const result=await readInstagramClientDirectory(f.pool,{id:2,session_version:1},{periodo:'2026-10'});
  assert.equal(result.clientes.length,1);
  assert.equal(result.clientes[0].instagram[0].username,'cuenta');
  assert.equal(f.queries.filter(q=>q.startsWith('SELECT')).length,3);
  assert.ok(!f.queries.some(q=>/instagram_media|objetivos|publicaciones|seguidores/.test(q)));
  assert.match(f.queries[0],/READ ONLY/);
  assert.ok(!JSON.stringify(result).includes('abono'));
});

test('directory rejects revoked users before reading clients',async()=>{
  const f=fixture(false);
  await assert.rejects(readInstagramClientDirectory(f.pool,{id:2,session_version:1},{periodo:'2026-10'}),{status:401});
  assert.ok(!f.queries.some(q=>q.includes('FROM clientes')));
  assert.equal(f.queries.at(-1),'ROLLBACK');
});
