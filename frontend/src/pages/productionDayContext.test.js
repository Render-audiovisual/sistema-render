import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as context from './productionRouteContext.js';

const href=query=>`https://render.test/producciones${query?'?'+query:''}`;
test('validProductionDay accepts real Gregorian days across the full four-digit year range',()=>{
 for(const day of ['0001-01-01','0004-02-29','0099-12-31','0100-03-01','1600-02-29','2000-02-29','2024-02-29','2026-10-22','9999-12-31'])
  assert.equal(context.validProductionDay(day),true,day);
 for(const day of ['0000-01-01','10000-01-01','0100-02-29','1900-02-29','2025-02-29','2026-02-30','2026-04-31','2026-00-01','2026-13-01','2026-01-00','2026-01-32','2026-1-02','2026-01-2','2026-10-22\n',' 2026-10-22','2026-10-22T00:00:00Z','2026-10-22Z','',null,undefined,123,[],{}])
  assert.equal(Boolean(context.validProductionDay(day)),false,String(day));
});
test('location carries closed day context, infers missing month and preserves unrelated URL intent',()=>{
 assert.deepEqual(context.productionLocation(href('dia=0004-02-29&cliente=7&tab=pending&unrelated=keep')),
  {id:null,month:'0004-02',day:'0004-02-29',clientId:'7',tab:'pending'});
 assert.deepEqual(context.productionLocation(href('mes=2026-10&dia=2026-10-22')),
  {id:null,month:'2026-10',day:'2026-10-22',clientId:'',tab:'calendar'});
 assert.equal(context.productionLocation(href('mes=2026-10')).day,null);
 assert.equal(context.productionLocation(href('')).day,null);
});
test('duplicate/bracket/invalid dates and month-day mismatch reject rather than broaden selection',()=>{
 for(const query of ['dia=2026-10-22&dia=2026-10-22','dia[]=2026-10-22','dia=2026-10-22&dia[x]=x','dia[x]=2026-10-22',
  'dia=','dia=2026-02-29','dia=0000-01-01','dia=2026-10-22%0A','dia=%202026-10-22','mes=2026-11&dia=2026-10-22',
  'mes=2026-10&mes=2026-10&dia=2026-10-22','mes[]=2026-10&dia=2026-10-22'])
  assert.throws(()=>context.productionLocation(href(query)),query);
});
test('calendar day priority is explicit valid day, then today within month, otherwise first of visible month',()=>{
 const today='2026-10-22';
 for(const [selection,expected] of [
  [{month:'2026-10',day:'2026-10-03'},'2026-10-03'],
  [{month:'2026-11',day:'2026-11-29'},'2026-11-29'],
  [{month:'0001-01',day:'0001-01-15'},'0001-01-15'],
  [{month:'2026-10',day:null},today],
  [{month:'2026-11',day:null},'2026-11-01'],
  [{month:'2026-10',day:'2026-11-03'},today],
  [{month:'2026-11',day:'2026-02-30'},'2026-11-01']
 ]){const before=JSON.stringify(selection);assert.equal(context.productionCalendarDay(selection,today),expected);assert.equal(JSON.stringify(selection),before);}
});
test('UI day does not become an API business filter or commercial persistence',()=>{
 const selected={month:'2026-10',day:'2026-10-22',clientId:'7',tab:'calendar'};
 assert.equal(context.productionReadUrl(selected),'/api/producciones?mes=2026-10&cliente_id=7');
 assert.equal(context.productionReadUrl({...selected,tab:'pending'}),'/api/producciones/pendientes?cliente_id=7');
 const source=readFileSync(new URL('./productionRouteContext.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|\bfetch\s*\(/);
});
