import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uploadFileToDrive, driveRequest } from './drive-api.js';
import { createBrowserSessionState } from '../../shared/session/browser-session-state.js';
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const file = size => { const blob = new Blob([new Uint8Array(size)]); return Object.assign(blob, { name: 'synthetic.bin' }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function actor() {
  const store = createBrowserSessionState();
  const accept = (id = 7) => { const ticket = store.beginBootstrap(); store.acceptBootstrap(ticket, {
    usuario: { id, usuario: 'synthetic', nombre: 'Synthetic', rol: 'edicion' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43),
  }); };
  accept(); return { store, accept, session: store.getSession(), readSession: store.getSession };
}
const obsolete = error => error.code === 'session_binding_obsolete';

test('upload POST, all chunks and transient retry retain one genuine intent, exact Blob/range/token and original task', async () => {
  const a = actor(), calls = [], progress = []; let chunks = 0;
  const result = await uploadFileToDrive(file(8 * 1024 * 1024 + 2), { ...a, parentId: 'folder', taskId: 42,
    onProgress: value => progress.push(value), request: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') return response({ token: 'synthetic-upload' });
      if (++chunks === 1) throw new TypeError('synthetic uncertain connection');
      return response({ id: 'actual-synthetic-file' }, chunks === 2 ? 202 : 200);
    } });
  assert.equal(result.id, 'actual-synthetic-file'); assert.equal(calls.length, 4);
  const intent = calls[0].options.sessionIntent;
  for (const call of calls) {
    assert.equal(call.options.sessionIntent, intent); assert.equal(a.store.isCurrent(intent), true);
    assert.equal(new Headers(call.options.headers).has('Authorization'), false);
  }
  assert.equal(JSON.parse(calls[0].options.body).taskId, 42);
  assert.equal(calls[1].options.body, calls[2].options.body);
  assert.equal(calls[1].url, calls[2].url);
  assert.equal(new Headers(calls[1].options.headers).get('Content-Range'), 'bytes 0-8388607/8388610');
  assert.equal(new Headers(calls[1].options.headers).get('Content-Range'), new Headers(calls[2].options.headers).get('Content-Range'));
  assert.ok(calls[1].options.body instanceof Blob); assert.equal(typeof calls[1].options.body.getReader, 'undefined');
  assert.deepEqual(progress, [100, 100]);
});

for (const stage of ['post', 'chunk', 'body']) test(`session B during ${stage} stops old upload without progress/result or B dispatch`, async () => {
  const a = actor(), calls = [], progress = [], reached = deferred(), release = deferred();
  const pending = uploadFileToDrive(file(2), { ...a, parentId: 'folder', taskId: 42, onProgress: value => progress.push(value),
    request: async (url, options) => {
      calls.push({ url, options });
      if ((stage === 'post' && options.method === 'POST') || (stage === 'chunk' && options.method === 'PUT')) {
        reached.resolve(); await release.promise;
      }
      if (stage === 'body' && options.method === 'PUT') return { ok: true, status: 200, async json() {
        reached.resolve(); await release.promise; return { id: 'must-not-escape' };
      } };
      return response(options.method === 'POST' ? { token: 'synthetic-upload' } : { id: 'must-not-escape' });
    } });
  const rejected = assert.rejects(pending, obsolete);
  await reached.promise; a.accept(8); release.resolve(); await rejected;
  assert.equal(calls.length, stage === 'post' ? 1 : 2); assert.deepEqual(progress, []);
});

for (const status of [400, 401, 403, 409, 413, 422, 429]) test(`chunk ${status} is never retried`, async () => {
  const a = actor(); let calls = 0;
  await assert.rejects(uploadFileToDrive(file(2), { ...a, request: async (_url, options) => {
    calls++; return options.method === 'POST' ? response({ token: 'synthetic-upload' }) : response({ error: 'synthetic' }, status);
  } }), error => error.status === status);
  assert.equal(calls, 2);
});

for (const kind of ['typed', 'abort', 'json']) test(`${kind} chunk body failure is propagated, never retried or converted to empty DTO`, async () => {
  const a = actor(); let calls = 0;
  const error = kind === 'typed' ? Object.assign(new Error('synthetic'), { name: 'BrowserSessionError', code: 'browser_intent_obsolete' })
    : kind === 'abort' ? new DOMException('synthetic', 'AbortError') : new SyntaxError('synthetic');
  await assert.rejects(uploadFileToDrive(file(2), { ...a, request: async (_url, options) => {
    calls++; return options.method === 'POST' ? response({ token: 'synthetic-upload' })
      : { ok: true, status: 200, json: async () => { throw error; } };
  } }), caught => caught === error);
  assert.equal(calls, 2);
  await assert.rejects(driveRequest('/api/drive/status', {}, async () => ({ json: async () => { throw error; } })), caught => caught === error);
});

test('transient chunk retries stop at three and preserve legacy captured Authorization', async () => {
  const session = { token: 'synthetic-bearer', usuario: { id: 7, rol: 'edicion' } }, calls = [];
  await assert.rejects(uploadFileToDrive(file(1), { session, readSession: () => session, request: async (_url, options) => {
    calls.push(options); return options.method === 'POST' ? response({ token: 'synthetic-upload' }) : response({}, 503);
  } }), error => error.status === 503);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(options => new Headers(options.headers).get('Authorization') === 'Bearer synthetic-bearer'));
  assert.equal(calls[1].body, calls[3].body);
});

test('abort and changed task activity fence progress/result; empty file uses a Blob and bytes */0', async () => {
  const a = actor(), controller = new AbortController(); let calls = 0;
  await assert.rejects(uploadFileToDrive(file(0), { ...a, signal: controller.signal, request: async (_url, options) => {
    calls++; assert.equal(options.signal, controller.signal);
    if (options.method === 'POST') return response({ token: 'synthetic-upload' });
    assert.equal(new Headers(options.headers).get('Content-Range'), 'bytes */0'); assert.ok(options.body instanceof Blob);
    controller.abort(); return response({ id: 'no-result' });
  } }), obsolete); assert.equal(calls, 2);
  let active = true;
  await assert.rejects(uploadFileToDrive(file(2), { ...a, isActive: () => active, request: async (_url, options) => {
    if (options.method === 'POST') return response({ token: 'synthetic-upload' });
    active = false; return response({ id: 'no-new-task-attachment' });
  } }), obsolete);
});

test('uploader source uses actual session view, keyed task/folder lifetime, abort cleanup and awaited fenced callback', () => {
  const source = readFileSync(new URL('./DriveUploader.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.match(source, /useSessionView\(getSesion\(\)\)/);
  assert.match(source, /<UploadScope key=\{context\}/);
  assert.match(source, /live\.current === context/);
  assert.match(source, /operation\.current\?\.abort\(\)/);
  assert.match(source, /await onUploaded\?\.\(uploaded, scope\);\s*scope\.assertCurrent\(\)/);
  assert.match(source, /readSession: getSesion/);
});

for (const stage of ['POST', 'PUT']) test(`late ${stage} JSON rejection from A is replaced by obsolete, not exposed after B`, async () => {
  const a = actor(), reached = deferred(), release = deferred(); let calls = 0;
  const pending = uploadFileToDrive(file(1), { ...a, request: async (_url, options) => {
    calls++;
    if (options.method === stage) return { ok: true, status: 200, async json() {
      reached.resolve(); await release.promise; throw new Error('old private A JSON failure');
    } };
    return response({ token: 'synthetic-upload' });
  } });
  const rejected = assert.rejects(pending, error => obsolete(error) && !error.message.includes('private A'));
  await reached.promise; a.accept(8); release.resolve(); await rejected;
  assert.equal(calls, stage === 'POST' ? 1 : 2);
});

test('missing or malformed upload token fails before chunk dispatch', async () => {
  for (const token of [undefined, null, '', ' ', 7]) {
    const a = actor(); let calls = 0;
    await assert.rejects(uploadFileToDrive(file(1), { ...a, request: async () => { calls++; return response({ token }); } }));
    assert.equal(calls, 1);
  }
});

test('uploader source gates same-tick upload and chooser, suppresses stale catch/finally, and hands parent original scope', () => {
  const source = readFileSync(new URL('./DriveUploader.jsx', import.meta.url), 'utf8');
  const choose = source.slice(source.indexOf('const choose ='), source.indexOf('const upload ='));
  const upload = source.slice(source.indexOf('const upload ='), source.indexOf('return <div className="drive-uploader"'));
  assert.match(choose, /if \(pending\.current \|\| !isActive\(\)\) return/);
  assert.match(upload, /if \([^\n]*pending\.current[^\n]*\) return;\s*pending\.current = true/);
  assert.ok(upload.indexOf('pending.current = true') < upload.indexOf('await uploadFileToDrive'));
  assert.match(choose, /catch \(reason\) \{ if \(scope\.current\(\)\) setError/);
  assert.match(upload, /catch \(reason\) \{\s*if \(!scope\.current\(\)\) return/);
  assert.match(upload, /finally \{ pending\.current = false; if \(scope\.current\(\)\) setUploading/);
  assert.match(upload, /await onUploaded\?\.\(uploaded, scope\)/);
  assert.match(upload, /const scope = createCapturedRequest\(\{ session, readSession: getSesion/);
});
