import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, apiTaskPage } from './render-os-api.js';
import { BrowserSessionError } from '../../../shared/session/browser-api-fetch.js';

test('late body session failures are never converted into successful empty objects or task pages', async () => {
  const original = globalThis.fetch;
  try {
    for (const error of [new BrowserSessionError('browser_intent_obsolete'),
      Object.assign(new Error('binding changed'), { code: 'session_binding_obsolete' }),
      Object.assign(new Error('disposed'), { name: 'ApplicationSessionError' })]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => { throw error; }, headers: new Headers() });
      await assert.rejects(apiRequest('/api/inicio'), value => value === error);
      await assert.rejects(apiTaskPage(), value => value === error);
    }
  } finally { globalThis.fetch = original; }
});
test('task pagination forwards original transport options without changing filter or totals semantics', async () => {
  const original = globalThis.fetch;
  const options = { signal: new AbortController().signal, headers: { Authorization: 'Bearer synthetic' } };
  try {
    globalThis.fetch = async (url, passed) => {
      assert.equal(passed, options);
      assert.match(url, /workspace=render_os/); assert.match(url, /asignado_a_id=7/);
      return { ok: true, json: async () => [{ id: 1 }], headers: new Headers({ 'X-Total-Count': '4' }) };
    };
    assert.deepEqual(await apiTaskPage({ responsible: 'id:7', offset: 0 }, options), { items: [{ id: 1 }], total: 4 });
  } finally { globalThis.fetch = original; }
});
test('ordinary legacy malformed JSON fallback remains unchanged without swallowing typed session errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('fixture JSON'); }, headers: new Headers() });
    assert.deepEqual(await apiRequest('/api/inicio'), {});
    assert.deepEqual(await apiTaskPage(), { items: [], total: 0 });
  } finally { globalThis.fetch = original; }
});
