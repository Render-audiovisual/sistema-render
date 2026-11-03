import test from 'node:test';

test('partial platform breakdowns are not presented as complete monthly totals',()=>{
  const t=monthTotals([{tipo:'reel',vistas_total:100,vistas_instagram:80,vistas_facebook:20},
    {tipo:'reel',vistas_total:null,vistas_instagram:50,vistas_facebook:null}]);
  assert.equal(t.vistas_total,null);assert.equal(t.vistas_facebook,null);assert.equal(t.vistas_instagram,130);
});
import assert from 'node:assert/strict';
import { valueAtHours, typicalBand, baselineByType, score, heatmap, slotOf, followerSeries, followerGrowth,
  monthTotals, dailyTotals, percentile } from '../src/instagram-stats.js';

test('valueAtHours interpolates between measurements and never extrapolates past the last one', () => {
  const s = [{ horas: 2, alcance: 200 }, { horas: 6, alcance: 600 }, { horas: 24, alcance: 1500 }];
  assert.equal(valueAtHours(s, 1), 100);
  assert.equal(valueAtHours(s, 4), 400);
  assert.equal(valueAtHours(s, 24), 1500);
  assert.equal(valueAtHours(s, 48), null);
  assert.equal(valueAtHours([], 1), null);
});

test('typicalBand needs at least three comparable pieces per point', () => {
  const peer = k => [{ horas: 1, alcance: 100 * k }, { horas: 24, alcance: 1000 * k }];
  const band = typicalBand([peer(1), peer(2), peer(3), [{ horas: 1, alcance: 50 }]], [1, 24]);
  assert.deepEqual(band[0], { horas: 1, p25: 88, p50: 150, p75: 225, piezas: 4 });
  assert.deepEqual(band[1], { horas: 24, p25: 1500, p50: 2000, p75: 2500, piezas: 3 });
  assert.equal(typicalBand([peer(1), peer(2)], [1])[0].p50, null);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
});

test('baseline is per format and score compares against it', () => {
  const base = baselineByType([{ tipo: 'reel', alcance: 1000 }, { tipo: 'reel', alcance: 3000 }, { tipo: 'carrusel', alcance: 400 }, { tipo: 'reel', alcance: null }]);
  assert.equal(base.reel.alcance, 2000); assert.equal(base.reel.piezas, 2); assert.equal(base.carrusel.alcance, 400);
  assert.equal(score(6000, base.reel.alcance), 3); assert.equal(score(null, 10), null); assert.equal(score(5, 0), null);
});

test('heatmap groups by Córdoba weekday and time slot', () => {
  assert.equal(slotOf(8), 'manana'); assert.equal(slotOf(13), 'mediodia'); assert.equal(slotOf(17), 'tarde'); assert.equal(slotOf(21), 'noche'); assert.equal(slotOf(2), 'noche');
  const base = { reel: { alcance: 1000 }, carrusel: { alcance: 500 } };
  // Jueves 29/10 21:00 Córdoba = viernes 00:00 UTC
  const rows = [{ tipo: 'reel', alcance: 2000, publicado_at: '2026-10-30T00:00:00Z' }, { tipo: 'carrusel', alcance: 500, publicado_at: '2026-10-30T00:30:00Z' }];
  const map = heatmap(rows, base);
  assert.deepEqual(map.find(r => r.franja === 'noche').dias[3], { puntaje: 1.5, piezas: 2 });
  assert.equal(map.find(r => r.franja === 'noche').dias[4], null);
});

test('followers sum accounts only on complete days and growth uses the last value before the month', () => {
  const rows = [
    { ig_user_id: 'a', fecha: '2026-09-30', seguidores: 100 }, { ig_user_id: 'b', fecha: '2026-09-30', seguidores: 50 },
    { ig_user_id: 'a', fecha: '2026-10-01', seguidores: 110 }, // falta b: se omite
    { ig_user_id: 'a', fecha: '2026-10-31', seguidores: 130 }, { ig_user_id: 'b', fecha: '2026-10-31', seguidores: 60 },
  ];
  const series = followerSeries(rows, ['a', 'b']);
  assert.deepEqual(series.map(p => p.seguidores), [150, 190]);
  assert.deepEqual(followerGrowth(series, '2026-10'), { inicio: 150, fin: 190, crecimiento: 40, dias: 1, desde: '2026-09-30', hasta: '2026-10-31' });
  assert.equal(followerGrowth(series, '2026-11').crecimiento, null);
});

test('month and daily totals ignore unmeasured pieces in sums', () => {
  const rows = [{ tipo: 'reel', alcance: 100, interacciones: 10, publicado_at: '2026-10-02T15:00:00Z' },
    { tipo: 'carrusel', alcance: null, interacciones: null, publicado_at: '2026-10-02T15:00:00Z' }];
  const t = monthTotals(rows);
  assert.deepEqual([t.piezas, t.medidas, t.alcance, t.reels, t.carruseles], [2, 1, 100, 1, 1]);
  const d = dailyTotals(rows, '2026-10');
  assert.equal(d.length, 31); assert.deepEqual(d[1], { dia: 2, alcance: 100, interacciones: 10, piezas: 2 });
});

test('views are counted independently of reach, and missing measurements are never invented zeros',()=>{
  const totals=monthTotals([{tipo:'reel',alcance:null,vistas:3300000,interacciones:null}]);
  assert.equal(totals.vistas,3300000);assert.equal(totals.alcance,null);assert.equal(totals.interacciones,null);
  assert.equal(monthTotals([{tipo:'reel',alcance:10,vistas:null}]).vistas,null);
  assert.equal(monthTotals([{tipo:'reel',vistas:0}]).vistas,0);
  assert.equal(monthTotals([]).vistas,0);
});
