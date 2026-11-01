import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFeedCountSnapshots,validateFeedCountSnapshot,instagramFeedGroupCounts,feedMonthBounds} from '../../shared/instagram-feed-counts.mjs';
import {buildPanel,formatFulfillment} from '../src/instagram-panel.js';
import {computeAlerts} from '../src/instagram-alerts.js';
const now=new Date('2026-11-01T15:00:00Z'),from=new Date('2026-08-03T15:00:00Z');
const media=(id,kind='reel',at='2026-10-20T15:00:00Z')=>({igMediaId:id,tipo:kind,publishedAt:new Date(at)});
const snapshots=(items=[],extra={})=>buildFeedCountSnapshots({clientId:1,igUserId:'111',username:'test',from,to:now,media:items,...extra});
const row=s=>({id:s.clientId,instagram_account_id:s.igUserId,instagram_account_active:true,instagram_feed_snapshot:s});
test('complete inventory certifies zero, but not the first partial month or future month',()=>{
  const all=snapshots();assert.deepEqual(all.map(s=>s.period),['2026-09','2026-10','2026-11']);
  const count=instagramFeedGroupCounts([row(all[1])],'2026-10',{now});assert.equal(count.reels,0);assert.equal(count.status,'historical');
  assert.equal(instagramFeedGroupCounts([{id:1}],'2026-10',{now}).reels,null);
  assert.equal(instagramFeedGroupCounts([{...row(all[1]),instagram_account_active:false}],'2026-10',{now}).status,'unavailable');
});
test('Argentina month boundaries, repeated IDs and images do not inflate either format',()=>{
  const data=snapshots([media('1'),media('1'),media('2','carrusel'),media('3','imagen'),media('4','reel','2026-11-01T02:59:59Z'),media('5','reel','2026-11-01T03:00:00Z')]);
  const count=instagramFeedGroupCounts([row(data[1])],'2026-10',{now});assert.equal(count.reels,2);assert.equal(count.carruseles,1);assert.equal(count.imagenes,1);
  assert.equal(instagramFeedGroupCounts([row(data[2])],'2026-11',{now}).reels,1);
  assert.equal(feedMonthBounds('2026-02').end,Date.parse('2026-03-01T03:00:00Z'));
  assert.throws(()=>snapshots([media('1'),media('1','carrusel')]));
});
test('snapshots are closed projections and bound to client, account, month, exact dates',()=>{
  const s=snapshots([media('1')])[1];assert.equal(validateFeedCountSnapshot({...s,secret:'canary'}).secret,undefined);
  for(const change of [{clientId:'1'},{igUserId:'x'},{checkedAt:'bad'},{windowStart:'2026-10-02T00:00:00.000Z'},
    {posts:[...s.posts,...s.posts]},{posts:[{...s.posts[0],publishedAt:'2026-11-01T03:00:00.000Z'}]}])assert.equal(validateFeedCountSnapshot({...s,...change}),null);
  assert.equal(validateFeedCountSnapshot(s,{clientId:2}),null);assert.equal(validateFeedCountSnapshot(s,{igUserId:'222'}),null);
  assert.equal(validateFeedCountSnapshot(s,{period:'2026-11'}),null);
});
test('shared feeds deduplicate the same post, unknown member never becomes zero',()=>{
  const a=snapshots([media('1')])[1],b=snapshots([media('1')],{clientId:2,igUserId:'222'})[1];
  assert.equal(instagramFeedGroupCounts([row(a),row(b)],'2026-10',{now}).reels,1);
  assert.equal(instagramFeedGroupCounts([row(a),{id:2}],'2026-10',{now}).reels,null);
  const open=snapshots([media('9','reel','2026-11-01T04:00:00Z')])[2];
  const stale=instagramFeedGroupCounts([row(open)],'2026-11',{now:new Date(+now+4*3600000)});assert.equal(stale.status,'stale');assert.equal(stale.reels,1);
  assert.equal(instagramFeedGroupCounts([row(a)],'2026-10',{now:new Date(+now-1)}).status,'unavailable');
});
test('last-hour observation cannot certify a closed month, complete closure does not expire',()=>{
  const beforeClose=buildFeedCountSnapshots({clientId:1,igUserId:'111',username:'test',from:new Date('2026-09-01T03:00:00Z'),to:new Date('2026-11-01T02:00:00Z'),media:[]}).find(s=>s.period==='2026-10');
  const count=instagramFeedGroupCounts([row(beforeClose)],'2026-10',{now:new Date('2026-11-01T04:00:00Z')});assert.equal(count.status,'unavailable');assert.equal(count.reason,'month_incomplete');assert.equal(count.reels,null);
  const afterClose=snapshots()[1];const historical=instagramFeedGroupCounts([row(afterClose)],'2026-10',{now:new Date('2026-12-20T15:00:00Z')});assert.equal(historical.status,'historical');assert.equal(historical.reels,0);
});
test('extra reels never compensate for missing carousels, and zero quota differs from unknown',()=>{
  const f=formatFulfillment({status:'current',reels:4,carruseles:0},{reels:2,carruseles:2});assert.equal(f.porcentaje,50);assert.equal(f.completo,false);assert.equal(f.carruseles.pendientes,2);
  assert.equal(formatFulfillment({status:'stale',reels:2,carruseles:2},{reels:2,carruseles:2}).completo,false);
  assert.equal(formatFulfillment({status:'unavailable',reels:null,carruseles:null},{reels:2,carruseles:2}).porcentaje,null);
  assert.equal(formatFulfillment({status:'current',reels:2,carruseles:0},{reels:2,carruseles:0}).carruseles.incluido,false);
  assert.equal(formatFulfillment({status:'current',reels:2,carruseles:0},null).carruseles.incluido,null);
  assert.equal(formatFulfillment({status:'current',reels:199,carruseles:0},{reels:200,carruseles:0}).porcentaje,99,'rounding must not announce completion');
});
test('panel uses complete Meta snapshot for count, current quota and no task attribution requirement',()=>{
  const panel=buildPanel({period:'2026-10',clients:[{id:1,nombre:'Test',clave:'cliente-1'},{id:2,nombre:'Missing',clave:'cliente-2'}],
    accounts:[{ig_user_id:'111',cliente_id:1,activa:true,username:'test',sincronizada_at:now}],media:[],followers:[],pieces:[],
    objectives:[{clave:'cliente-1',reels:4,carruseles:4}],effectiveQuotas:[{clave:'cliente-1',reels:1,carruseles:1},{clave:'cliente-2',reels:2,carruseles:2}],
    snapshots:snapshots([media('1')]),now});
  const client=panel.clientes.find(c=>c.clave==='cliente-1');assert.equal(client.format_counts.reels,1);assert.equal(client.objetivo_desactualizado,true);
  assert.equal(client.cumplimiento,50);assert.equal(panel.equipo.length,0);assert.equal(panel.format_totals.reels,1);
  assert.deepEqual([panel.format_totals.current,panel.format_totals.total],[1,2]);
  const missing=panel.clientes.find(c=>c.clave==='cliente-2');assert.equal(missing.format_counts.reels,null);
});
test('format-specific shortfall creates an alert, stale and unavailable inventory do not claim shortfall',()=>{
  const client={clave:'cliente-1',nombre:'Test',cupo:{reels:2,carruseles:2},actual:{reels:4,carruseles:0,medidas:0,alcance:0},instagram:[{username:'test',sincronizada_at:now}],sin_vincular:0,
    format_counts:{status:'current',reels:4,carruseles:0}};
  const alerts=computeAlerts({periodo:'2026-10',clientes:[client]},{now});assert.equal(alerts.filter(a=>a.tipo==='cupo_atrasado').length,1);
  for(const status of ['stale','unavailable'])assert.equal(computeAlerts({periodo:'2026-10',clientes:[{...client,format_counts:{...client.format_counts,status}}]},{now}).filter(a=>a.tipo==='cupo_atrasado').length,0);
});
test('shared feed does not silently replace explicit owner attribution with profile totals',()=>{
  const a=snapshots([media('1')])[1],b=snapshots([media('2')],{clientId:2,igUserId:'222'})[1];
  const panel=buildPanel({period:'2026-10',clients:[{id:1,nombre:'One',clave:'grupo-1'},{id:2,nombre:'Two',clave:'grupo-1'}],accounts:[{ig_user_id:'111',cliente_id:1,activa:true},{ig_user_id:'222',cliente_id:2,activa:true}],
    media:[],followers:[],pieces:[],objectives:[],snapshots:[a,b],manualObservations:[{clientId:1,period:'2026-10',agencyAttribution:{reels:0,carruseles:0,confirmedAt:'2026-10-31T15:00:00Z'}}],now});
  assert.equal(panel.clientes[0].format_counts.reels,null);assert.equal(panel.clientes[0].format_counts.reason,'owner_group_ambiguous');assert.equal(panel.format_totals.reels,0);
});
test('manual owner numbers are preserved as records, not certified as complete month coverage',()=>{
  const panel=buildPanel({period:'2026-10',clients:[{id:1,nombre:'Estudiantil',clave:'cliente-1'}],accounts:[],media:[],followers:[],pieces:[],objectives:[{clave:'cliente-1',reels:4,carruseles:2}],
    manualObservations:[{clientId:1,period:'2026-10',agencyAttribution:{reels:3,carruseles:1,confirmedAt:'2026-10-30T15:00:00Z'}}],now});
  assert.equal(panel.clientes[0].format_counts.reels,3);assert.equal(panel.clientes[0].format_counts.status,'owner_record');
  assert.equal(panel.clientes[0].cumplimiento,null);assert.equal(panel.clientes[0].fulfillment.completo,false);assert.equal(panel.format_totals.current,0);
});
