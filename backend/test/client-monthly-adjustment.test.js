import test from 'node:test';
import assert from 'node:assert/strict';
import {monthlyAdjustment,groupMonthlyAdjustment} from '../../shared/client-monthly-adjustment.mjs';
const manual={version:1,key:'grupo-5',period:'2026-10',memberIds:[1,2],revision:'f0fffb33-439c-402e-a914-43455e7a3ccc',checkedAt:'2026-11-02T20:00:00.000Z',mode:'manual',reels:3,carruseles:0};
test('monthly correction closes payload, retains zero, validates context and group membership',()=>{
 assert.deepEqual(monthlyAdjustment({...manual,secret:'never exposed'}),manual);
 for(const value of [-1,1.2,true,'3',10001])assert.equal(monthlyAdjustment({...manual,reels:value}),null);
 for(const options of [{key:'cliente-1'},{period:'2026-11'},{memberIds:[1]},{memberIds:[1,2,3]}])assert.equal(monthlyAdjustment(manual,options),null);
 const clients=[1,2].map(id=>({id,grupo_feed_id:5,instagram_monthly_adjustment:manual}));
 assert.equal(groupMonthlyAdjustment(clients,'2026-10').reels,3);
 assert.equal(groupMonthlyAdjustment(clients.slice(0,1),'2026-10'),null);
 assert.equal(groupMonthlyAdjustment([...clients,{id:3,grupo_feed_id:5}],'2026-10'),null);
});
test('automatic reset is a valid latest record, not an old manual fallback',()=>{
 const reset=monthlyAdjustment({...manual,mode:'automatic'});assert.equal(reset.mode,'automatic');assert.equal(reset.reels,undefined);
});
