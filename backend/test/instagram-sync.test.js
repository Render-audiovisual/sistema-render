import test from 'node:test';
import assert from 'node:assert/strict';
import { needsMetrics, metricsRefreshInterval, cordobaDate } from '../src/instagram-sync.js';

const H = 3600000, D = 24 * H;
const now = new Date('2026-10-31T15:00:00Z');

test('refresh cadence slows down as pieces age and stops after the sync window', () => {
  assert.equal(metricsRefreshInterval(H), H);
  assert.equal(metricsRefreshInterval(3 * D), 6 * H);
  assert.equal(metricsRefreshInterval(20 * D), D);
  assert.equal(metricsRefreshInterval(40 * D), null);
});

test('needsMetrics measures new pieces and respects the interval', () => {
  const at = ms => new Date(now - ms);
  assert.equal(needsMetrics({ publishedAt: at(40 * D), lastMeasuredAt: null }, now), true);
  assert.equal(needsMetrics({ publishedAt: at(40 * D), lastMeasuredAt: at(30 * D) }, now), false);
  assert.equal(needsMetrics({ publishedAt: at(3 * D), lastMeasuredAt: at(2 * H) }, now), false);
  assert.equal(needsMetrics({ publishedAt: at(3 * D), lastMeasuredAt: at(6 * H) }, now), true);
  assert.equal(needsMetrics({ publishedAt: at(5 * H), lastMeasuredAt: at(58 * 60000) }, now), true);
});

test('cordobaDate uses Argentina calendar day', () => {
  assert.equal(cordobaDate(new Date('2026-11-01T01:30:00Z')), '2026-10-31');
  assert.equal(cordobaDate(new Date('2026-11-01T03:30:00Z')), '2026-11-01');
});
