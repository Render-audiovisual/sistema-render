import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAlerts, monthProgress } from '../src/instagram-alerts.js';

const now = new Date('2026-10-20T15:00:00Z'); // día 20 de 31 en Córdoba
const totals = (reels, carruseles, alcance, medidas = reels + carruseles) => ({ reels, carruseles, alcance, medidas });
const client = changes => ({ clave: 'cliente-1', nombre: 'Bohle', cupo: { reels: 4, carruseles: 4 },
  instagram: [{ username: 'bohle', sincronizada_at: new Date(now - 3600000) }], actual: totals(4, 2, 6000),
  base: { medidas: 20, alcance: 20000 }, ultima_publicacion: new Date(now - 2 * 86400000), sin_vincular: 0, ...changes });
const kinds = alerts => alerts.map(a => a.tipo).sort();

test('monthProgress uses the Córdoba calendar', () => {
  assert.deepEqual(monthProgress('2026-10', now), { day: 20, days: 31, fraction: 20 / 31, current: true });
  assert.equal(monthProgress('2026-09', now).fraction, 1);
  assert.equal(monthProgress('2026-11', new Date('2026-11-01T02:00:00Z')).current, false, 'todavía 31/10 en Córdoba');
});

test('a healthy client has no alerts', () => {
  assert.deepEqual(computeAlerts({ periodo: '2026-10', clientes: [client()] }, { now }), []);
});

test('each rule fires with its reason', () => {
  const alerts = computeAlerts({ periodo: '2026-10', clientes: [client({
    actual: totals(1, 1, 1000), ultima_publicacion: new Date(now - 9 * 86400000), sin_vincular: 2,
    instagram: [{ username: 'bohle', sincronizada_at: new Date(now - 30 * 3600000) }] })] }, { now });
  assert.deepEqual(kinds(alerts), ['caida_alcance', 'cupo_atrasado', 'sin_publicar', 'sin_sincronizar', 'sin_vincular']);
  assert.match(alerts.find(a => a.tipo === 'cupo_atrasado').detalle, /2 de 8 piezas al día 20.*deberían ser 5/);
  assert.match(alerts.find(a => a.tipo === 'caida_alcance').detalle, /50 % menos/);
  assert.equal(alerts[0].nivel, 'alta');
});

test('rules respect minimums: early month, small samples, no account', () => {
  const early = new Date('2026-10-05T15:00:00Z');
  assert.deepEqual(computeAlerts({ periodo: '2026-10', clientes: [client({ actual: totals(0, 0, 0),
    ultima_publicacion: new Date(early - 86400000), instagram: [{ username: 'b', sincronizada_at: early }] })] }, { now: early }), []);
  assert.deepEqual(computeAlerts({ periodo: '2026-10', clientes: [client({ actual: totals(4, 1, 100, 1) })] }, { now }), []);
  assert.deepEqual(computeAlerts({ periodo: '2026-10', clientes: [client({ instagram: [], actual: totals(0, 0, 0) })] }, { now }), []);
});

test('past months report unmet quota without pace or recency alerts', () => {
  const alerts = computeAlerts({ periodo: '2026-09', clientes: [client({ actual: totals(2, 2, 4000), ultima_publicacion: null })] }, { now });
  assert.deepEqual(kinds(alerts), ['cupo_atrasado']);
  assert.match(alerts[0].detalle, /Reels: 2 de 4; carruseles: 2 de 4/);
});
