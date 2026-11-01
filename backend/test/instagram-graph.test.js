import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphClient, resolveGraphConfig, normalizeMedia, normalizeInsights, GraphError } from '../src/instagram-graph.js';

const TOKEN = 'EAAtest-token-value-1234567890';
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('config requires a plausible token and version', () => {
  assert.throws(() => resolveGraphConfig({}), { kind: 'config' });
  assert.throws(() => resolveGraphConfig({ META_SYSTEM_USER_TOKEN: 'short' }), { kind: 'config' });
  assert.throws(() => resolveGraphConfig({ META_SYSTEM_USER_TOKEN: TOKEN, META_GRAPH_VERSION: 'latest' }), { kind: 'config' });
  assert.deepEqual(resolveGraphConfig({ META_SYSTEM_USER_TOKEN: TOKEN }), { token: TOKEN, version: 'v23.0' });
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

test('client sends token only in header, follows paging on graph host and stops at since', async () => {
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
