import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, apiTaskPage } from './render-os-api.js';
import { BrowserSessionError } from '../../../shared/session/browser-api-fetch.js';

test('late body session failures are never converted into successful empty objects or task pages', async () => {
  const original = globalThis.fetch;
  try {
    for (const error of [new BrowserSessionError('browser_intent_obsolete'),
      Object.assign(new Error('binding changed'), { code: 'session_binding_obsolete' })]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => { throw error; }, headers: new Headers() });
      await assert.rejects(apiRequest('/api/inicio'), value => value === error);
      await assert.rejects(apiTaskPage(), value => value === error);
    }
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
