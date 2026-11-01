import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphClient, resolveGraphConfig, normalizeMedia, normalizeInsights, GraphError } from '../src/instagram-graph.js';

const TOKEN = 'EAAtest-token-value-1234567890';
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('config requires a plausible token and version', () => {
  assert.throws(() => resolveGraphConfig({}), { kind: 'config' });
  assert.throws(() => resolveGraphConfig({ META_SYSTEM_USER_TOKEN: 'short' }), { kind: 'config' });
  assert.throws(() => resolveGraphConfig({ META_SYSTEM_USER_TOKEN: TOKEN, META_GRAPH_VERSION: 'latest' }), { kind: 'config' });
  assert.deepEqual(resolveGraphConfig({ META_SYSTEM_USER_TOKEN: TOKEN }), { token: TOKEN, version: 'v23.0', businessId: null });
});

test('normalizeMedia maps reels, carousels and images; skips stories and bad links', () => {
  const base = { id: '1789', permalink: 'https://www.instagram.com/reel/ABC/', timestamp: '2026-10-10T00:30:00+0000' };
  assert.equal(normalizeMedia({ ...base, media_type: 'VIDEO', media_product_type: 'REELS' }).tipo, 'reel');
  assert.equal(normalizeMedia({ ...base, media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED' }).tipo, 'carrusel');
  assert.equal(normalizeMedia({ ...base, media_type: 'IMAGE', media_product_type: 'FEED' }).tipo, 'imagen');
  assert.equal(normalizeMedia({ ...base, media_type: 'IMAGE', media_product_type: 'STORY' }), null);
  assert.equal(normalizeMedia({ ...base, media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://evil.example/reel/x' }), null);
  assert.equal(normalizeMedia({ ...base, id: 'abc', media_type: 'VIDEO', media_product_type: 'REELS' }), null);
});

test('normalizeInsights accepts values and total_value shapes, ignores junk', () => {
  assert.deepEqual(normalizeInsights([
    { name: 'reach', values: [{ value: 120 }] }, { name: 'views', total_value: { value: 300 } },
    { name: 'saved', values: [{ value: -1 }] }, { name: 'unknown', values: [{ value: 5 }] },
  ]), { alcance: 120, vistas: 300, likes: null, comentarios: null, guardados: null, compartidos: null, interacciones: null });
});

test('missing, empty and boolean metrics are not invented zeros', () => {
  for (const value of [null, undefined, '', ' ', false, true, [], {}])
    assert.equal(normalizeInsights([{ name: 'reach', values: [{ value }] }]).alcance, null);
  assert.equal(normalizeInsights([{ name: 'reach', values: [{ value: 0 }] }]).alcance, 0);
});

test('Graph redirects are disabled and incomplete inventories fail closed', async () => {
  let calls = 0;
  const client = createGraphClient({ token: TOKEN, version: 'v23.0' }, { fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error'); calls++;
    return json({ data: [], paging: { next: 'https://graph.facebook.com/v23.0/me/accounts?after=more' } });
  } });
  await assert.rejects(client.listInstagramAccounts(), { kind: 'pagination' });
  assert.equal(calls, 20);
});

test('client sends token only in header, follows paging on graph host and filters since', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (url.includes('page2')) return json({ data: [
      { id: '3', media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/C/', timestamp: '2026-08-01T00:00:00+0000' },
    ] });
    return json({ data: [
      { id: '1', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/A/', timestamp: '2026-10-20T00:00:00+0000' },
    ], paging: { next: 'https://graph.facebook.com/v23.0/9/media?after=page2&access_token=leak' } });
  };
  const client = createGraphClient({ token: TOKEN, version: 'v23.0' }, { fetchImpl });
  const media = await client.listMedia('9', new Date('2026-09-01T00:00:00Z'));
  assert.deepEqual(media.map(m => m.igMediaId), ['1']);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.auth, `Bearer ${TOKEN}`);
    assert.ok(!call.url.includes(TOKEN) && !call.url.includes('access_token'));
  }
});

test('client refuses to follow paging to another host', async () => {
  const fetchImpl = async () => json({ data: [], paging: { next: 'https://attacker.example/next' } });
  const client = createGraphClient({ token: TOKEN, version: 'v23.0' }, { fetchImpl });
  await assert.rejects(client.listMedia('9', new Date(0)), GraphError);
});

test('insights fall back to smaller metric sets on code 100', async () => {
  const metrics = [];
  const fetchImpl = async url => {
    const metric = new URL(url).searchParams.get('metric');
    metrics.push(metric);
    if (metric.includes('views')) return json({ error: { code: 100, message: 'x' } }, 400);
    return json({ data: [{ name: 'reach', values: [{ value: 7 }] }] });
  };
  const client = createGraphClient({ token: TOKEN, version: 'v23.0' }, { fetchImpl });
  assert.equal((await client.mediaInsights('5')).alcance, 7);
  assert.equal(metrics.length, 2);
});

test('errors are classified without leaking messages', async () => {
  const cases = [[{ code: 190 }, 400, 'auth'], [{ code: 4 }, 400, 'rate'], [{ code: 10 }, 400, 'permission'], [{ code: 1 }, 500, 'other']];
  for (const [error, status, kind] of cases) {
    const client = createGraphClient({ token: TOKEN, version: 'v23.0' }, { fetchImpl: async () => json({ error }, status) });
    await assert.rejects(client.listInstagramAccounts(), err => err.kind === kind && !err.message.includes(TOKEN));
  }
  const offline = createGraphClient({ token: TOKEN, version: 'v23.0' }, { fetchImpl: async () => { throw new Error(TOKEN); } });
  await assert.rejects(offline.listInstagramAccounts(), err => err.kind === 'network' && !err.message.includes(TOKEN));
});

test('business discovery combines owned AND shared pages, paginates and deduplicates IG IDs', async () => {
  const seen = [];
  const account = (id, username) => ({ id: `9${id}`, instagram_business_account: { id, username, followers_count: 10 } });
  const client = createGraphClient({ token: TOKEN, version: 'v23.0', businessId: '1034453457860259' }, {
    fetchImpl: async (url, options) => {
      const u = new URL(url); seen.push(u.pathname);
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`); assert.equal(options.redirect, 'error');
      if (u.searchParams.has('after')) return json({ data: [] });
      if (u.pathname.endsWith('/me/accounts')) return json({ error: { code: 200 } }, 403);
      if (u.pathname.endsWith('/owned_pages')) return json({ data: [account('111', 'owned')],
        paging: { next: 'https://graph.facebook.com/v23.0/1034453457860259/owned_pages?after=2' } });
      return json({ data: [account('111', 'owned'), account('222', 'shared')] });
    },
  });
  assert.equal(seen.length, 0, 'Construction itself never fetches');
  assert.deepEqual((await client.listInstagramAccounts()).map(a => a.igUserId), ['111', '222']);
  assert.equal(seen.at(-1), '/v23.0/1034453457860259/client_pages');
});

test('empty me/accounts falls back; complete me/accounts remains the primary inventory', async () => {
  for (const empty of [false, true]) {
    const calls = [];
    const client = createGraphClient({ token: TOKEN, version: 'v23.0', businessId: '1034453457860259' }, { fetchImpl: async url => {
      const p = new URL(url).pathname; calls.push(p);
      return json({ data: p.endsWith('/me/accounts') && !empty ? [{ id: '1', instagram_business_account: { id: '2', username: 'test' } }] : [] });
    } });
    await client.listInstagramAccounts(); assert.equal(calls.length, empty ? 3 : 1);
  }
});

test('partial portfolio errors, token failures and rate limits never produce an authoritative partial inventory', async () => {
  for (const kind of ['permission', 'auth', 'rate', 'network']) {
    let calls = 0;
    const client = createGraphClient({ token: TOKEN, version: 'v23.0', businessId: '1034453457860259' }, { fetchImpl: async url => {
      calls++;
      if (url.includes('/me/accounts')) return json({ error: { code: 200 } }, 403);
      if (url.includes('/owned_pages')) return json({ data: [{ id: '1', instagram_business_account: { id: '2', username: 'test' } }] });
      if (kind === 'network') throw new Error(TOKEN);
      return json({ error: { code: { permission: 200, auth: 190, rate: 4 }[kind] } }, 400);
    } });
    await assert.rejects(client.listInstagramAccounts(), error => error.kind === kind && !error.message.includes(TOKEN));
    assert.equal(calls, 3);
  }
});

test('business ID is strictly validated and cannot inject a Graph path', () => {
  assert.equal(resolveGraphConfig({ META_SYSTEM_USER_TOKEN: TOKEN, META_BUSINESS_ID: '1034453457860259' }).businessId, '1034453457860259');
  for (const businessId of ['x', '../me', '0', '123/owned_pages', 123, {}, '1'.repeat(33)]) {
    assert.throws(() => resolveGraphConfig({ META_SYSTEM_USER_TOKEN: TOKEN, META_BUSINESS_ID: businessId }), { kind: 'config' });
    assert.throws(() => createGraphClient({ token: TOKEN, version: 'v23.0', businessId }), { kind: 'config' });
  }
});

const feedRow = (id, timestamp = '2026-10-20T00:00:00Z', extra = {}) => ({
  id, timestamp, media_type: 'VIDEO', media_product_type: 'REELS',
  permalink: `https://www.instagram.com/reel/${id}/`, caption: '', ...extra,
});
const feedClient = bodies => {
  let calls = 0;
  return { client: createGraphClient({ token: TOKEN, version: 'v23.0' }, {
    fetchImpl: async () => json(bodies[calls++]),
  }), calls: () => calls };
};

test('feed completes pagination past old pinned posts and deduplicates identical IDs', async () => {
  const row = feedRow('11');
  const { client, calls } = feedClient([
    { data: [feedRow('10', '2026-01-01T00:00:00Z'), row], paging: { next: 'https://graph.facebook.com/v23.0/9/media?after=2' } },
    { data: [row, feedRow('12')] },
  ]);
  assert.deepEqual((await client.listMedia('9', new Date('2026-10-01T00:00:00Z'))).map(m => m.igMediaId), ['11', '12']);
  assert.equal(calls(), 2);
});

test('feed rejects conflicting duplicate types, dates and metadata inside the window', async () => {
  for (const extra of [
    { media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED' },
    { timestamp: '2026-10-21T00:00:00Z' }, { caption: 'edited mid-read' },
  ]) {
    const { client } = feedClient([
      { data: [feedRow('11')], paging: { next: 'https://graph.facebook.com/v23.0/9/media?after=2' } },
      { data: [feedRow('11', undefined, extra)] },
    ]);
    await assert.rejects(client.listMedia('9', new Date('2026-10-01T00:00:00Z')), { kind: 'inventory' });
  }
});

test('feed skips legacy malformed items with known dates outside exact window but keeps traversing', async () => {
  const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-10-31T15:00:00Z');
  const { client, calls } = feedClient([
    { data: [{ id: 'legacy', timestamp: '2020-01-01T00:00:00Z', media_type: 'IGTV' },
      { timestamp: '2026-10-31T15:00:00.001Z', permalink: 'invalid' }],
      paging: { next: 'https://graph.facebook.com/v23.0/9/media?after=2' } },
    { data: [feedRow('11', from.toISOString()), feedRow('12', to.toISOString())] },
  ]);
  assert.deepEqual((await client.listMedia('9', from, to)).map(m => m.igMediaId), ['11', '12']);
  assert.equal(calls(), 2);
});

test('feed rejects unknown timestamps and in-window malformed legacy items instead of hiding them', async () => {
  for (const timestamp of ['invalid', null, undefined, 0, '2026-10-20T00:00:00Z']) {
    const { client } = feedClient([{ data: [{ id: 'legacy', timestamp, media_type: 'IGTV' }] }]);
    await assert.rejects(client.listMedia('9', new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z')), { kind: 'inventory' });
  }
});

test('feed rejects incomplete or malformed pages and malformed feed items instead of certifying zero', async () => {
  for (const body of [{}, { data: null }, { data: [], paging: [] }, { data: [], paging: { next: 2 } },
    { data: [], paging: { next: '' } }, { data: [feedRow('11', 'invalid')] },
    { data: [feedRow('11', undefined, { permalink: 'https://evil.example/' })] }]) {
    const { client } = feedClient([body]);
    await assert.rejects(client.listMedia('9', new Date(0)), GraphError);
  }
  const { client } = feedClient([{ data: [feedRow('11', undefined, { media_product_type: 'STORY' })] }]);
  assert.deepEqual(await client.listMedia('9', new Date(0)), []);
});

test('feed page limit rejects the entire inventory even when every page contains old posts', async () => {
  let calls = 0;
  const client = createGraphClient({ token: TOKEN, version: 'v23.0' }, { fetchImpl: async () => {
    calls++;
    return json({ data: [feedRow('11', '2026-01-01T00:00:00Z')],
      paging: { next: `https://graph.facebook.com/v23.0/9/media?after=${calls}` } });
  } });
  await assert.rejects(client.listMedia('9', new Date('2026-10-01T00:00:00Z')), { kind: 'pagination' });
  assert.equal(calls, 20);
});
