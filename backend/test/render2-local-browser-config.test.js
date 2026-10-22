import test from 'node:test';
import assert from 'node:assert/strict';
import {startLocalHarness} from '../scripts/render2-local-test.js';

test('native browser fixture rejects unsafe or contradictory HTTP ports before creating any cluster',async()=>{
  for(const options of [
    {browserPort:52767},
    {browserSessions:true,browserPort:0},
    {browserSessions:true,browserPort:1023},
    {browserSessions:true,browserPort:65536},
    {browserSessions:true,browserPort:'52767'},
    {browserSessions:true,browserPort:52767.5},
    {browserSessions:true,browserPort:55594},
    {browserSessions:true,browserPort:52767,clusterOnly:true},
  ])await assert.rejects(startLocalHarness(options),/Invalid browser HTTP fixture port/);
});
