import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReportModuleLoader,warmInstagramReportModule} from './instagramReportModule.js';
test('code preload is limited to Instagram routes and reuses one module request',async()=>{
  let calls=0;const module={InstagramClientReportPage(){}};
  const load=createReportModuleLoader(async()=>{calls++;return module;});
  for(const path of ['/login','/sueldos','/workspace/tareas','/instagram/reporte-extra'])warmInstagramReportModule(path,load);
  assert.equal(calls,0);
  warmInstagramReportModule('/instagram',load);warmInstagramReportModule('/instagram/reporte',load);
  assert.equal(await load(),module);assert.equal(calls,1);
});
test('failed warmup does not block a later actual module load',async()=>{
  let calls=0;const load=createReportModuleLoader(async()=>{if(++calls===1)throw Error('offline');return 'loaded';});
  await assert.rejects(load(),/offline/);assert.equal(await load(),'loaded');assert.equal(calls,2);
});
test('preload fetches no data and App keeps its session gate and scoped report page',()=>{
  const source=readFileSync(new URL('./instagramReportModule.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|\/api\//);
  const app=readFileSync(new URL('../App.jsx',import.meta.url),'utf8');
  assert.match(app,/lazyNamed\(loadInstagramReportModule/);
  assert.match(app,/warmInstagramReportModule\(path\)/);
  assert.match(app,/sessionSnapshot.status === 'unknown'/);
});
