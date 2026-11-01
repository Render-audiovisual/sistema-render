import test from 'node:test';
import assert from 'node:assert/strict';
import {hasWeeklyReportCoverage} from '../../frontend/src/shared/instagram-report-coverage.js';

test('bootstrap report without observed clients cannot claim everyone published',()=>{
  assert.equal(hasWeeklyReportCoverage({hechos:{clientes:[],totales:{piezas:0},sin_publicar_en_la_semana:[]}}),false);
});
test('a measured client with zero publications is still a valid report',()=>{
  assert.equal(hasWeeklyReportCoverage({hechos:{clientes:[{cliente:'Cliente de prueba',piezas:0}],totales:{piezas:0}}}),true);
});
test('missing or malformed coverage does not become a verified report',()=>{
  for(const report of [null,{}, {hechos:{}},{hechos:{clientes:'incorrecto'}}]) assert.equal(hasWeeklyReportCoverage(report),false);
});
