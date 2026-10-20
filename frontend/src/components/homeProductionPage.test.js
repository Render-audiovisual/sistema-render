import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHomeProductionPage, createHomeProductionPageLoader } from './homeProductionPage.js';
const session = () => ({ token: 'test-token', usuario: { id: 7, rol: 'produccion', activo: true } });
const context = offset => ({ userId: 7, period: '2026-10', offset });
const dto = (offset = 0) => ({ version: 1, user: { id: 7 }, period: '2026-10', today: '2026-10-19',
  offset, limit: 20, total: 25, completed: 0, client_count: 25, has_more: offset === 0,
  clients: Array.from({ length: Math.min(20,Math.max(0,25-offset)) }, (_, n) => ({ client: { id: offset+n+1, nombre: 'Cliente' }, total: 1, completed: 0 })) });
test('parse every page, including beyond end, with exact identities and closed projection', () => {
  for (const offset of [0,20,40]) assert.deepEqual(parseHomeProductionPage(dto(offset),context(offset)),dto(offset));
  const value = dto(20); value.salary = 4; value.user.rol = 'admin'; value.clients[0].client.abono = 10;
  assert.deepEqual(parseHomeProductionPage(value,context(20)),dto(20));
});
test('reject mismatched identity/month/page, malformed ordering/counts and missing groups', () => {
  for (const patch of [{ user: { id: 8 } },{period:'2026-11'},{offset:20},{limit:50},{has_more:false},
    {client_count:19},{completed:26},{today:'2026-02-30'},{clients:[]}]) assert.throws(()=>parseHomeProductionPage({...dto(),...patch},context(0)));
  const duplicate=dto(); duplicate.clients[1].client.id=1; assert.throws(()=>parseHomeProductionPage(duplicate,context(0)));
  for(const period of ['0000-10','2026-13','bad',undefined]) assert.throws(()=>parseHomeProductionPage({...dto(),period},{...context(0),period}));
});
test('loader pins month and offset, hides old rows while loading and retries requested page', async () => {
  const states=[], calls=[]; let fail=true;
  const loader=createHomeProductionPageLoader({sesion:session(),period:'2026-10',readSession:session,
    request:async(url,opts)=>{calls.push([url,opts]);if(fail)throw new Error('offline');return dto(20);},onChange:s=>states.push(s)});
  await loader.refresh({offset:20});assert.equal(states.at(-1).status,'error');assert.equal(states.at(-1).data,null);
  fail=false;await loader.refresh();assert.equal(states.at(-1).data.offset,20);
  assert.equal(calls[1][0],'/api/inicio/produccion-mensual?period=2026-10&offset=20&limit=20');
  assert.equal(calls[1][1].method,'GET');assert.equal(states[0].data,null);loader.dispose();
});
test('late superseded or disposed replies never repaint an earlier page', async () => {
  const states=[], pending=[];
  const loader=createHomeProductionPageLoader({sesion:session(),period:'2026-10',readSession:session,
    request:()=>new Promise(resolve=>pending.push(resolve)),onChange:s=>states.push(s)});
  const first=loader.refresh(),second=loader.refresh({offset:20}); pending[1](dto(20));await second;
  const before=states.length;pending[0](dto());await first;assert.equal(states.length,before);assert.equal(states.at(-1).data.offset,20);
  const third=loader.refresh();loader.dispose();pending[2](dto(20));await third;assert.equal(states.at(-1).status,'loading');
});
test('ID/token/role/active changes cannot return another session data', async () => {
  for(const alter of [s=>s.token='new',s=>s.usuario.id=8,s=>s.usuario.rol='admin',s=>s.usuario.activo=false]) {
    let current=session(), resolve;const states=[];
    const loader=createHomeProductionPageLoader({sesion:session(),period:'2026-10',readSession:()=>current,
      request:()=>new Promise(r=>resolve=r),onChange:s=>states.push(s)});
    const task=loader.refresh();alter(current);resolve(dto());await task;
    assert.equal(states.at(-1).status,'error');assert.equal(states.at(-1).data,null);loader.dispose();
  }
});

test('principal home supplies session/request and production disclosure fences scope and cleans requests', () => {
  const home=readFileSync(new URL('../pages/QuickHome.jsx',import.meta.url),'utf8');
  const monthly=readFileSync(new URL('./HomeMonthlyProgress.jsx',import.meta.url),'utf8');
  const component=readFileSync(new URL('./HomeProductionMonthly.jsx',import.meta.url),'utf8');
  assert.match(home, /<HomeMonthlyProgress data=\{data.monthly_progress\} sesion=\{sesion\} request=\{request\}/);
  assert.match(monthly, /<HomeProductionMonthly data=\{data.production\} period=\{data.period\} sesion=\{sesion\} request=\{request\}/);
  for(const text of ['result?.scope === scope','scopeRef.current === scope','loader.dispose()',
    'readSession: getSesion','role="alert"','role="status"','Primera página','Reintentar']) assert.ok(component.includes(text),text);
  assert.doesNotMatch(component,/localStorage|dangerouslySetInnerHTML/);
});
