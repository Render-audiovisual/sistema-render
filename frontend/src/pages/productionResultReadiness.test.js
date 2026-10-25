import test from 'node:test';
import assert from 'node:assert/strict';
import { productionResultReadiness as readiness } from './productionResultReadiness.js';

test('partial result retains pending scripts without requiring every video recorded', () => {
  const input = { previstos: 6, videos: [...Array.from({length: 4}, () => ({estado: 'grabado'})),
    {estado: 'pendiente', guion: 'Idea pendiente'}, {estado: 'repetir', guion: 'Regrabar toma'}],
    fotos: [{estado: 'realizada'}, {estado: 'repetir'}] };
  const original = structuredClone(input);
  assert.deepEqual(readiness(input), {ready: true, reason: '', parcial: true});
  assert.deepEqual(input, original);
});

test('photos alone and entirely pending visits are valid explicit results', () => {
  assert.equal(readiness({previstos: 0, videos: [], fotos: [{estado: 'realizada'}]}).parcial, false);
  assert.equal(readiness({previstos: 1, videos: [{estado: 'pendiente', guion: 'Próxima visita'}], fotos: []}).ready, true);
});

test('unknown data, unclassified media, missing scripts and unaccounted planned videos block admission', () => {
  const base = {previstos: 0, videos: [], fotos: []};
  for (const input of [base, {...base, previstos: '0'}, {...base, videos: null},
    {...base, videos: [{estado: 'planificado'}]}, {...base, videos: [{estado: 'pendiente', guion: ' '}]},
    {...base, previstos: 2, videos: [{estado: 'grabado'}]}, {...base, fotos: [{estado: 'grabado'}]},
    {...base, fotos: [null]}]) {
    assert.equal(readiness(input).ready, false);
    assert.ok(readiness(input).reason);
  }
});
