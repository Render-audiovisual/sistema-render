import test from 'node:test';
import assert from 'node:assert/strict';
import { needsMetrics, metricsRefreshInterval, cordobaDate, runInstagramSync, BACKFILL_DAYS } from '../src/instagram-sync.js';
import { GraphError } from '../src/instagram-graph.js';
import { FEED_SNAPSHOT_ACTION, validateFeedCountSnapshot } from '../../shared/instagram-feed-counts.mjs';

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

// In-memory SQL double: no DB, environment credentials, filesystem or network.
function harness({ accounts = [{ ig_user_id: '111', username: 'test', cliente_id: 1 }],
  existing = [], current, failWrite = false } = {}) {
  const calls = [], committed = []; let pending = null;
  const query = async (sql, params = []) => {
    calls.push({ sql, params, transaction: pending !== null });
    if (sql.startsWith('BEGIN')) { assert.equal(pending, null); pending = []; }
    if (sql === 'COMMIT') { committed.push(...pending); pending = null; }
    if (sql === 'ROLLBACK') pending = null;
    if (sql.includes('INSERT INTO integracion_auditoria')) {
      const record = { action: params[0], result: params[1], details: JSON.parse(params[2]) };
      (pending ?? committed).push(record);
    }
    if (sql.includes('SELECT a.ig_user_id')) return { rows: accounts };
    if (sql.includes('SELECT m.ig_media_id')) return { rows: existing };
    if (sql.includes('SELECT cliente_id,activa')) return { rows: current ? current(params[0]) : [{ cliente_id: accounts.find(a => a.ig_user_id === params[0]).cliente_id, activa: true }] };
    if (failWrite && sql.includes('INSERT INTO instagram_media\n')) throw new Error('write failure');
    return { rows: [], rowCount: 1 };
  };
  return { calls, committed, pool: { query, async connect() { return { query, release() {} }; } } };
}
const piece = (id = '501', extra = {}) => ({ igMediaId: id, tipo: 'reel',
  publishedAt: new Date('2026-10-20T15:00:00Z'), permalink: `https://www.instagram.com/reel/${id}/`, caption: '', ...extra });
function graphDouble({ media = [], listMedia, mediaInsights } = {}) {
  return { async listInstagramAccounts() { return []; },
    listMedia: listMedia ?? (async () => media), mediaInsights: mediaInsights ?? (async () => ({ alcance: 100 })) };
}
const proofs = h => h.committed.filter(a => a.action === FEED_SNAPSHOT_ACTION);

test('every sync reads exact 90 days despite existing media; snapshots share boundaries and account transaction', async () => {
  const h = harness({ existing: [{ ig_media_id: '501', publicado_at: piece().publishedAt, ultima: now }] });
  let readFrom;
  const result = await runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({
    listMedia: async (_id, from) => { readFrom = from; return [piece()]; },
    mediaInsights: async () => { throw new Error('recent metrics should not be fetched'); },
  }) });
  assert.equal(+readFrom, +now - BACKFILL_DAYS * D);
  assert.equal(+h.calls.find(c => c.sql.includes('SELECT m.ig_media_id')).params[1], +readFrom);
  assert.equal(result.metricas, 0);
  assert.equal(proofs(h).length, 2); // August is partial; September/October are covered.
  for (const proof of proofs(h)) {
    assert.ok(validateFeedCountSnapshot(proof.details, {
      clientId: 1, igUserId: '111', period: proof.details.period,
    }));
    assert.equal(proof.details.windowStart, readFrom.toISOString());
    assert.equal(proof.details.checkedAt, now.toISOString());
  }
  const october = proofs(h).find(p => p.details.period === '2026-10').details;
  assert.deepEqual(october.posts, [{ id: '501', kind: 'reel', publishedAt: piece().publishedAt.toISOString() }]);
  const lock = h.calls.findIndex(c => c.sql.includes('FOR UPDATE'));
  for (const [i, call] of h.calls.entries()) if (call.params[0] === FEED_SNAPSHOT_ACTION) {
    assert.ok(i > lock); assert.equal(call.transaction, true);
    assert.match(call.sql, /VALUES\('instagram_graph','system','render-worker','Render · Instagram',\$1,\$2,\$3::jsonb\)/);
    assert.equal(call.params[1], 'ok');
    const snapshot = JSON.parse(call.params[2]);
    assert.equal(new Date(snapshot.windowStart).toISOString(), snapshot.windowStart);
    assert.equal(new Date(snapshot.checkedAt).toISOString(), snapshot.checkedAt);
    assert.deepEqual(Object.keys(snapshot).sort(), ['version', 'source', 'clientId', 'igUserId', 'username',
      'period', 'windowStart', 'checkedAt', 'posts'].sort());
  }
  assert.equal(h.calls.some(c => /(?:INSERT INTO|UPDATE|DELETE FROM) (?:tareas|publicaciones|cliente_objetivos)/i.test(c.sql)), false);
});

test('empty complete feed certifies zero without deleting previously stored media', async () => {
  const h = harness({ existing: [{ ig_media_id: '501', publicado_at: piece().publishedAt, ultima: now }] });
  await runInstagramSync(h.pool, { now, env: {}, graph: graphDouble() });
  assert.equal(proofs(h).length, 2);
  assert.ok(proofs(h).every(p => p.details.posts.length === 0));
  assert.equal(h.calls.some(c => /DELETE/i.test(c.sql)), false);
});

test('metric permission failures do not erase complete feed coverage or claim metric availability', async () => {
  const h = harness();
  const result = await runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({ media: [piece()],
    mediaInsights: async () => { throw new GraphError('permission'); } }) });
  assert.equal(result.metricas, 0);
  assert.equal(proofs(h).find(p => p.details.period === '2026-10').details.posts.length, 1);
});

test('listing/pagination errors produce no coverage and audit summary before rejecting', async () => {
  for (const kind of ['pagination', 'network', 'inventory']) {
    const h = harness();
    await assert.rejects(runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({
      listMedia: async () => { throw new GraphError(kind); },
    }) }), /Ninguna cuenta/);
    assert.equal(proofs(h).length, 0);
    assert.equal(h.committed.at(-1).action, 'sync_resumen');
    assert.equal(h.committed.at(-1).result, 'parcial');
  }
});

test('reassigned/inactive/missing accounts and rolled-back writes cannot publish coverage', async () => {
  for (const current of [() => [{ cliente_id: 2, activa: true }], () => [{ cliente_id: 1, activa: false }], () => []]) {
    const h = harness({ current });
    await assert.rejects(runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({ media: [piece()] }) }), /Ninguna cuenta/);
    assert.equal(proofs(h).length, 0);
    assert.ok(h.calls.some(c => c.sql === 'ROLLBACK'));
  }
  const h = harness({ failWrite: true });
  await assert.rejects(runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({ media: [piece()] }) }), /Ninguna cuenta/);
  assert.ok(h.calls.some(c => c.params[0] === FEED_SNAPSHOT_ACTION));
  assert.equal(proofs(h).length, 0, 'proof INSERT was rolled back with the media write');
});

test('partial account failure continues remaining accounts but rejects after audited summary', async () => {
  const accounts = ['111', '222', '333'].map((id, i) => ({ ig_user_id: id, username: `test${i}`, cliente_id: i + 1 }));
  const h = harness({ accounts }), seen = [];
  await assert.rejects(runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({ listMedia: async id => {
    seen.push(id); if (id === '222') throw new GraphError('pagination'); return [];
  } }) }), /parcial/);
  assert.deepEqual(seen, ['111', '222', '333']);
  assert.deepEqual([...new Set(proofs(h).map(p => p.details.igUserId))], ['111', '333']);
  assert.equal(h.committed.at(-1).action, 'sync_resumen');
  assert.deepEqual(h.committed.at(-1).details, { version: 1, cuentas: 3, ok: 2, errores: 1, media: 0, metricas: 0 });
});

test('contradictory or out-of-window inventory from an adapter cannot certify coverage', async () => {
  for (const media of [[piece(), piece('501', { tipo: 'carrusel' })],
    [piece('501', { publishedAt: new Date(now - 91 * D) })], [piece('501', { publishedAt: new Date('invalid') })]]) {
    const h = harness();
    await assert.rejects(runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({ media }) }), /Ninguna cuenta/);
    assert.equal(proofs(h).length, 0);
  }
});

test('posts appearing after captured now are excluded before metrics, persistence and proof without shifting window', async () => {
  const h = harness(), measured = [];
  const boundary = piece('502', { publishedAt: new Date(+now) });
  const future = piece('503', { publishedAt: new Date(+now + 1) });
  const result = await runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({
    listMedia: async (_id, from, to) => {
      assert.equal(+from, +now - 90 * D); assert.equal(+to, +now);
      return [piece(), boundary, future];
    },
    mediaInsights: async id => { measured.push(id); return { alcance: 100 }; },
  }) });
  assert.equal(result.media, 2);
  assert.deepEqual(measured, ['501', '502']);
  const snapshot = proofs(h).find(p => p.details.period === '2026-10').details;
  assert.equal(snapshot.checkedAt, now.toISOString());
  assert.deepEqual(snapshot.posts.map(p => p.id), ['501', '502']);
  assert.equal(h.calls.some(c => c.sql.includes('INSERT INTO instagram_media\n') && c.params[0] === '503'), false);
});

test('auth/rate stops further requests, audits partial summary and preserves only earlier successful proofs', async () => {
  for (const kind of ['auth', 'rate']) {
    const accounts = ['111', '222', '333'].map((id, i) => ({ ig_user_id: id, username: `test${i}`, cliente_id: i + 1 }));
    const h = harness({ accounts }), seen = [];
    await assert.rejects(runInstagramSync(h.pool, { now, env: {}, graph: graphDouble({ listMedia: async id => {
      seen.push(id); if (id === '222') throw new GraphError(kind); return [];
    } }) }), { kind });
    assert.deepEqual(seen, ['111', '222']);
    assert.deepEqual([...new Set(proofs(h).map(p => p.details.igUserId))], ['111']);
    assert.equal(h.committed.at(-1).action, 'sync_resumen');
    assert.equal(h.committed.at(-1).details.errores, 1);
  }
});
