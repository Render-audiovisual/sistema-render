import test from 'node:test';
import assert from 'node:assert/strict';
import {readInstagramLocation,instagramPanelHref,instagramReportHref} from './instagramNavigation.js';
test('client month and tab survive direct links and browser history parsing',()=>{
  assert.deepEqual(readInstagramLocation('?periodo=2026-10&cliente=cliente-8','2026-11'),{period:'2026-10',tab:'clientes',selected:'cliente-8',error:''});
  const url=instagramPanelHref({period:'2026-10',tab:'cuentas'});assert.equal(url,'/instagram?periodo=2026-10&tab=cuentas');
  assert.equal(readInstagramLocation(url.split('?')[1],'2026-11').tab,'cuentas');
  assert.equal(instagramReportHref('grupo-2','2026-10'),'/instagram/reporte?cliente=grupo-2&periodo=2026-10');
});
test('invalid or duplicate report context is rejected rather than silently showing another month',()=>{
  for(const query of ['?periodo=2026-13','?cliente=other-1','?cliente=cliente-2147483648','?cliente=cliente-1&cliente=cliente-2','?periodo=2026-10&periodo=2026-11','?tab=clients','?tab=clientes&tab=cuentas'])assert.ok(readInstagramLocation(query,'2026-11').error);
  assert.throws(()=>instagramReportHref('https://other.example','2026-10'));assert.throws(()=>instagramReportHref('cliente-1','2026-13'));
});
