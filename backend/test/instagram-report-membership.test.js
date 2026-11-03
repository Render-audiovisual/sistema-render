import test from 'node:test';
import assert from 'node:assert/strict';
import {selectReportMedia,readReportMembershipSnapshots} from '../src/instagram-report-membership.js';

const at='2026-10-16T12:00:00.000Z',checked='2026-11-01T12:00:00.000Z';
const row=(id,extra={})=>({ig_media_id:id,ig_user_id:'12345',cliente_id:9,tipo:'reel',periodo:'2026-10',publicado_at:at,...extra});
const proof={version:1,source:'meta_graph_feed',clientId:9,igUserId:'12345',username:'litoral_qa',period:'2026-10',windowStart:'2026-09-01T03:00:00.000Z',checkedAt:checked,
 posts:[{id:'7001',kind:'reel',publishedAt:at}]};
const scope={clientIds:[9],accounts:[{cliente_id:9,ig_user_id:'12345'}],snapshots:[proof],now:new Date('2026-11-03T12:00:00Z')};
test('report and stats membership exclude retained media absent from a complete feed and deduplicate IDs',()=>{
 const rows=[row('7001'),row('7002'),row('7001')];
 assert.deepEqual(selectReportMedia(rows,scope).map(r=>r.ig_media_id),['7001']);
 assert.equal(rows.length,3);assert.equal(proof.posts.length,1);
});
test('membership binds account, client, month, format and exact publication timestamp',()=>{
 const rows=[row('7001',{cliente_id:10}),row('7001',{ig_user_id:'999'}),row('7001',{tipo:'carrusel'}),row('7001',{publicado_at:'2026-10-16T12:01:00Z'}),row('7001')];
 assert.deepEqual(selectReportMedia(rows,scope),[rows.at(-1)]);
 const emptyPrevious={...proof,period:'2026-09',posts:[]};
 assert.deepEqual(selectReportMedia([row('7003',{periodo:'2026-09',publicado_at:'2026-09-12T12:00:00Z'})],{...scope,snapshots:[proof,emptyPrevious]}),[]);
});
test('no proof or future proof preserves scoped observations; later posts are not erased',()=>{
 assert.equal(selectReportMedia([row('7002')],{...scope,snapshots:[]}).length,1);
 assert.equal(selectReportMedia([row('7002')],{...scope,now:new Date('2026-10-31T12:00:00Z')}).length,1);
 const current={...proof,checkedAt:'2026-10-20T12:00:00.000Z'};
 assert.equal(selectReportMedia([row('7002',{publicado_at:'2026-10-25T12:00:00Z'})],{...scope,snapshots:[current]}).length,1);
});
test('snapshots for comparison months are fetched in one parameterized batch',async()=>{
 const calls=[];const db={query:async(sql,params)=>{calls.push({sql,params});return{rows:[{ig_user_id:'12345',cliente_id:9,detalles:proof}]};}};
 assert.deepEqual(await readReportMembershipSnapshots(db,['12345'],['2026-09','2026-10']),[proof]);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].params,[['12345'],['2026-09','2026-10']]);
 await readReportMembershipSnapshots(db,['12345'],[]);assert.equal(calls.length,1);
});
