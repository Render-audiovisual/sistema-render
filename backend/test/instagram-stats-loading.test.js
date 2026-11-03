import test from 'node:test';
import assert from 'node:assert/strict';
import {readInstagramClientStats} from '../src/instagram-panel.js';

function fixture({coverClient=1,kind='reel',active=true}={}) {
  const queries=[], now=new Date().toISOString();
  const db={release(){},async query(sql){
    queries.push(sql);
    if(sql.includes('FROM usuarios'))return {rows:[{id:2,rol:'empleado',activo:active,session_version:1}]};
    if(sql.includes('FROM clientes c'))return {rows:[{id:1,clave:'cliente-1',nombre:'Prueba'}]};
    if(sql.startsWith('SELECT ig_user_id, username, cliente_id'))return {rows:[{ig_user_id:'10',cliente_id:1,username:'prueba'}]};
    if(sql.includes('AS cover_details'))return {rows:[{ig_user_id:'10',cliente_id:1,cover_details:{version:1,clientId:coverClient,igUserId:'10',checkedAt:now,
      items:[{id:'20',kind,url:'https://scontent.cdninstagram.com/cover.jpg',checkedAt:now}]}}]};
    if(sql.includes('FROM instagram_media m'))return {rows:[{ig_media_id:'20',ig_user_id:'10',cliente_id:1,tipo:'reel',periodo:'2026-10',
      caption:'Copy',permalink:'https://www.instagram.com/reel/test/',publicado_at:'2026-10-15T15:00:00Z',vistas:100,alcance:80}]};
    return {rows:[]};
  }};
  return {queries,pool:{async connect(){return db;}}};
}

test('stats reads media and identities once, preserving covers and totals in read-only transaction',async()=>{
  const f=fixture();
  const data=await readInstagramClientStats(f.pool,{id:2,session_version:1},'cliente-1',{periodo:'2026-10'});
  assert.equal(data.publicaciones.length,1);
  assert.equal(data.publicaciones[0].portada_url,'https://scontent.cdninstagram.com/cover.jpg');
  assert.equal(data.totales.actual.vistas_disponibles,100);
  assert.equal(f.queries.filter(q=>q.includes('FROM instagram_media m')).length,1);
  assert.equal(f.queries.filter(q=>q.includes('FROM clientes c')).length,1);
  assert.ok(!f.queries.some(q=>/JOIN publicaciones|cliente_objetivo|UPDATE |INSERT |DELETE /.test(q)));
  assert.match(f.queries[0],/READ ONLY/);
});

for(const options of [{coverClient:3},{kind:'carrusel'}])test(`stats rejects mismatched cover ${JSON.stringify(options)}`,async()=>{
  const f=fixture(options);
  const data=await readInstagramClientStats(f.pool,{id:2,session_version:1},'cliente-1',{periodo:'2026-10'});
  assert.equal(data.publicaciones[0].portada_url,null);
});

test('stats still revalidates revoked employee sessions',async()=>{
  const f=fixture({active:false});
  await assert.rejects(readInstagramClientStats(f.pool,{id:2,session_version:1},'cliente-1',{periodo:'2026-10'}),{status:401});
  assert.ok(!f.queries.some(q=>q.includes('FROM clientes')));
});
