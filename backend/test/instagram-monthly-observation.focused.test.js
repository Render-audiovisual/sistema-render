import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInstagramMonthlyObservation as validate, instagramMonthlyGroupObservation as group } from '../../shared/instagram-monthly-observation.mjs';
import { loadClientCatalogSnapshot, CLIENT_CATALOG_SQL } from '../src/client-catalog.js';

const post = {url:'https://www.instagram.com/reel/October1/',kind:'reel',publishedAt:'2026-10-01T03:00:00Z'};
const snapshot = () => ({version:1,period:'2026-10',clientId:19,handle:'public_test',totalPosts:1,checkedAt:'2026-10-29T12:00:00Z',boundaryVerified:true,posts:[post],
  boundary:[1,2,3].map(id=>({url:`https://www.instagram.com/p/Boundary${id}/`,publishedAt:'2026-10-01T02:59:59Z'}))});
test('strict public projection, real zero, ART boundary and shortcode dedupe', () => {
  const input = {...snapshot(),secret:'canary',posts:[post,{...post,url:'https://instagram.com/p/October1/?igsh=public'}]};
  const before=JSON.stringify(input), clean=validate(input,{clientId:19,period:'2026-10'});
  assert.equal(clean.posts.length,1); assert.equal(clean.secret,undefined); assert.equal(JSON.stringify(input),before);
  assert.equal(validate({...snapshot(),posts:[],totalPosts:0}).totalPosts,0);
  for (const change of [{version:2},{clientId:'19'},{totalPosts:2},{boundaryVerified:false},{boundary:[]},{checkedAt:'invalid'},
    {posts:[{...post,publishedAt:'2026-10-01T02:59:59Z'}]}, {posts:[{...post,publishedAt:'2026-11-01T03:00:00Z'}]},
    {posts:[{...post,publishedAt:'2026-02-30T15:00:00Z'}]}]) assert.equal(validate({...snapshot(),...change}),null);
  for (const url of ['http://instagram.com/p/x/','https://instagram.com.evil.test/p/x/','https://evil.test/p/x/','https://instagram.com/stories/x/','https://user@instagram.com/p/x/']) {
    assert.equal(validate({...snapshot(),posts:[{...post,url}]}),null);
  }
  assert.equal(validate(snapshot(),{period:'2026-11'}),null); assert.equal(validate(snapshot(),{clientId:20}),null);
});
test('catalog attaches only validated public evidence after DTO in same readonly query', async () => {
  for (const rol of ['admin','edicion']) for (const valid of [true,false]) {
    const raw={id:19,nombre:'Public client',abono_mensual:987654,instagram_monthly_observation:{...snapshot(),private:'canary',abono_mensual:987654,boundaryVerified:valid}};
    const before=JSON.stringify(raw), calls=[];
    const db={async query(sql,values){calls.push({sql,values});
      if(sql.startsWith('SELECT id,rol')) return {rows:[{id:7,rol,activo:true,session_version:3}]};
      return {rows:sql===CLIENT_CATALOG_SQL?[raw]:[]};},release(){}};
    const result=await loadClientCatalogSnapshot({connect:async()=>db},{id:7,rol,session_version:3},'2026-10-01');
    assert.equal(calls.length,4); assert.deepEqual(calls[2].values,['2026-10-01']);
    assert.equal(Boolean(result[0].instagram_monthly_observation),valid);
    assert.equal(result[0].instagram_monthly_observation?.private,undefined); assert.equal(JSON.stringify(raw),before);
    assert.equal(result[0].instagram_monthly_observation?.abono_mensual,undefined);
    if(rol==='edicion') assert.equal(Object.hasOwn(result[0],'abono_mensual'),false);
  }
  assert.match(CLIENT_CATALOG_SQL,/ia\.canal='web'/); assert.match(CLIENT_CATALOG_SQL,/ORDER BY ia.created_at DESC,ia.id DESC LIMIT 1/);
});
test('owner confirms Render attribution without altering observed profile posts', () => {
  const posts=Array.from({length:11},(_,i)=>({...post,url:`https://www.instagram.com/reel/Video${i}/`}));
  posts.push({...post,url:'https://www.instagram.com/p/Carousel1/',kind:'carrusel'});
  const s={...snapshot(),posts,totalPosts:12,agencyAttribution:{source:'owner_confirmation',confirmedAt:'2026-10-30T01:00:00Z',reels:3,carruseles:1,carouselUrls:['https://www.instagram.com/p/Carousel1/'],private:'canary'}};
  const before=JSON.stringify(s), clean=validate(s);
  assert.equal(clean.posts.length,12);assert.equal(clean.agencyAttribution.reels,3);assert.equal(clean.agencyAttribution.private,undefined);
  const summary=group([{id:19,instagram_monthly_observation:s}],'2026-10');
  assert.equal(summary.reels,3);assert.equal(summary.carruseles,1);assert.equal(summary.profileReels,11);assert.equal(summary.agencyConfirmed,true);
  assert.equal(JSON.stringify(s),before);
  for(const change of [{source:'instagram'}, {reels:12},{carruseles:2},{carouselUrls:['https://evil.test/p/Carousel1/']},{confirmedAt:'invalid'}])
    assert.equal(validate({...s,agencyAttribution:{...s.agencyAttribution,...change}}),null);
  assert.equal(group([{id:19,instagram_monthly_observation:s},{id:20,instagram_monthly_observation:{...s,clientId:20}}],'2026-10'),null);
});
