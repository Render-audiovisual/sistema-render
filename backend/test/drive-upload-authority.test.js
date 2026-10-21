import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { readFileSync } from 'node:fs';
import { createGoogleDriveRouter, createGoogleDrivePublicRouter } from '../src/google-drive.js';
import { boundedDriveProvider, validDriveUploadUrl } from '../src/drive-upload-authority.js';
import { bindDriveOAuthTransport } from '../src/drive-provider.js';

const secret = 'unit-only-drive-secret-not-production';
const auth = { id: 3, session_version: 1, rol: 'edicion' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ role = 'edicion', assigned = true, bag, commitError = false } = {}) {
  const trace = [], routes = new Map(); let providerCalls = 0, writes = 0, commits = 0;
  const intents = new Map(), nonces = new Map(); let snapshot;
  const actor = { ...auth, rol: role, activo: true, nombre: 'Synthetic actor' };
  const task = { id: 7, propiedades_extra: bag ?? { workspace: 'render_os' } };
  const db = {
    query: async (sql, args) => {
      trace.push(sql);
      if (sql === 'BEGIN') snapshot = structuredClone({ task, intents, nonces });
      if (sql === 'ROLLBACK' && snapshot) {
        Object.assign(task, snapshot.task); intents.clear(); nonces.clear();
        for (const entry of snapshot.intents) intents.set(...entry);
        for (const entry of snapshot.nonces) nonces.set(...entry);
      }
      if (sql === 'COMMIT') { commits++; if (commitError) throw Error('private commit failure'); return { rows: [] }; }
      if (sql.includes('FROM usuarios')) return { rows: [actor] };
      if (sql.includes('FOR UPDATE OF t')) return { rows: [task] };
      if (sql.startsWith('SELECT t.id FROM tareas')) return { rows: assigned || actor.rol === 'admin' ? [{ id: 7 }] : [] };
      if (sql.startsWith('INSERT INTO drive_upload_intents')) {
        const [id,actor_id,session_version,task_id,name,mime_type,size,parent_id,replace_id,phase_id,replacement_state] = args;
        intents.set(id, { id,actor_id,session_version,task_id,name,mime_type,size,parent_id,replace_id,phase_id,replacement_state,state: 'starting',next_offset: 0 });
      }
      if (sql.startsWith('SELECT * FROM drive_upload_intents')) return { rows: intents.has(args[0]) ? [structuredClone(intents.get(args[0]))] : [] };
      if (sql.startsWith('UPDATE drive_upload_intents')) {
        const row = intents.get(args[0]); assert.ok(row);
        if (sql.includes("state='ready',upload_url")) Object.assign(row, { state: 'ready', upload_url: args[1] });
        else if (sql.includes("state='in_flight',phase_id") && !sql.includes('replacement_state')) Object.assign(row, { state: 'in_flight',phase_id: args[1],last_range: args[2],last_chunk_hash: args[3] });
        else if (sql.includes('state=$2,next_offset')) {
          assert.equal(row.phase_id, args[5]); assert.equal(row.state, 'in_flight');
          Object.assign(row, { state: args[1],next_offset: args[2],last_status: args[3],last_ack: JSON.parse(args[4]) });
        } else if (sql.includes("replacement_state='in_flight'")) Object.assign(row, { replacement_state: 'in_flight',phase_id: args[1] });
        else if (sql.includes("replacement_state='completed'")) row.replacement_state = 'completed';
        else assert.fail('Unhandled ledger write');
      }
      if (sql.startsWith('INSERT INTO drive_oauth_nonces')) {
        nonces.set(args[0], { id: args[0], actor_id: args[1], session_version: args[2], consumed_at: null, claim_id: null, completed_at: null, expires_at: args[3]*1000 });
      }
      if (sql.startsWith('UPDATE drive_oauth_nonces SET consumed_at')) {
        const row = nonces.get(args[0]);
        if (!row || row.consumed_at || row.actor_id !== args[1] || row.session_version !== args[2]) return { rows: [] };
        Object.assign(row, { consumed_at: 'synthetic-time', claim_id: args[3] }); return { rows: [{ id: row.id }] };
      }
      if (sql.startsWith('SELECT * FROM drive_oauth_nonces')) return { rows: nonces.has(args[0]) ? [structuredClone(nonces.get(args[0]))] : [] };
      if (sql.startsWith('SELECT expires_at>clock_timestamp()')) return { rows: nonces.has(args[0]) ? [{ unexpired: nonces.get(args[0]).expires_at > db.now() }] : [] };
      if (sql.startsWith('UPDATE drive_oauth_nonces SET completed_at')) nonces.get(args[0]).completed_at = 'synthetic-time';
      if (sql.startsWith('UPDATE tareas')) { writes++; task.propiedades_extra.drive_archivos = [...(task.propiedades_extra.drive_archivos || []), ...JSON.parse(args[2])]; }
      return { rows: [] };
    }, release: error => trace.push(error ? 'DISCARD' : 'RELEASE'), now: () => Date.now(),
  };
  let lease = Promise.resolve();
  const pool = { connect: async () => { const previous = lease; let release; lease = new Promise(resolve => { release = resolve; }); await previous;
    db.release = error => { trace.push(error ? 'DISCARD' : 'RELEASE'); release(); }; return db; } };
  const express = { Router: () => {
    const router = {};
    for (const method of ['get','post','put','delete']) router[method] = (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1));
    router.use = handler => { router.errorHandler = handler; }; return router;
  }, raw: () => (_req, _res, next) => next() };
  const file = { id: 'synthetic-file', name: 'file.bin', mimeType: 'application/octet-stream', size: '1', parents: ['synthetic-folder'] };
  const provider = { listChildren: async () => ({ files: [] }), startUpload: async () => ({ uploadUrl: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic' }), uploadChunk: async () => ({ status: 200, file }), trashFile: async () => {}, generateAuthUrl: async state => state, exchangeCode: async () => ({ refresh_token: 'synthetic-only' }) };
  const providerFactory = async () => { providerCalls++; trace.push('PROVIDER'); return provider; };
  const input = { express, pool, requireRole: () => (_req, _res, next) => next(), jwtSecret: secret, providerFactory, providerTimeoutMs: 1000 };
  const router = createGoogleDriveRouter(input);
  const call = async (method, path, additions = {}, selectedRouter = router) => {
    const req = { auth: { ...auth }, body: {}, query: {}, params: {}, get: () => 'bytes 0-0/1', ...additions };
    let status = 200, body;
    const res = { status: n => { status = n; return res; }, json: value => { body = JSON.parse(JSON.stringify(value)); return res; }, redirect: value => { status = 302; body = value; } };
    await routes.get(`${method} ${path}`)(req, res, error => selectedRouter.errorHandler(error, req, res, () => assert.fail('unhandled')));
    return { status, body };
  };
  const start = () => call('post', '/uploads', { body: { name: file.name, mimeType: file.mimeType, size: 1, parentId: file.parents[0], taskId: 7 } });
  const chunk = token => call('put', '/uploads/:token', { body: Buffer.from([1]), params: { token } });
  return { trace, actor, task, provider, db, input, routes, call, start, chunk, file, intents, nonces, get providerCalls() { return providerCalls; }, get writes() { return writes; }, get commits() { return commits; } };
}

test('denied actor, assignment and malformed historical bag never instantiate provider', async () => {
  for (const scenario of ['epoch','inactive','assignment','bag']) {
    const f = fixture({ assigned: scenario !== 'assignment', bag: scenario === 'bag' ? { workspace: 'render_os', drive_archivos: {} } : undefined });
    if (scenario === 'epoch') f.actor.session_version++;
    if (scenario === 'inactive') f.actor.activo = false;
    assert.equal((await f.start()).status, ['epoch','inactive'].includes(scenario) ? 401 : scenario === 'assignment' ? 403 : 409);
    assert.equal(f.providerCalls, 0); assert.ok(f.trace.includes('ROLLBACK')); assert.equal(f.trace.at(-1), 'RELEASE');
  }
});
test('one chunk locks actor, task, assignment before provider, attaches before commit and retries append idempotently', async () => {
  const f = fixture(), start = await f.start(); assert.equal(start.status, 201);
  const intent = jwt.verify(start.body.token, secret, { audience: 'render-drive-upload-v2' });
  assert.equal(intent.name, f.file.name); assert.equal(intent.mimeType, f.file.mimeType); assert.equal(intent.jti.length, 36);
  f.trace.length = 0;
  assert.equal((await f.chunk(start.body.token)).status, 200);
  const index = fragment => f.trace.findIndex(sql => sql.includes(fragment));
  assert.ok(index('FROM usuarios') < index('FOR UPDATE OF t'));
  assert.ok(index('FOR UPDATE OF t') < index('FROM tarea_asignaciones'));
  assert.ok(index('FROM tarea_asignaciones') < index('PROVIDER'));
  assert.ok(index('PROVIDER') < index('UPDATE tareas')); assert.ok(index('UPDATE tareas') < f.trace.lastIndexOf('COMMIT'));
  const calls = f.providerCalls;
  assert.equal((await f.chunk(start.body.token)).status, 200); assert.equal(f.writes, 1); assert.equal(f.providerCalls, calls);
});
test('legacy, wrong actor, missing audience, expired and wrong purpose capabilities reject before provider', async () => {
  const f = fixture(), start = await f.start(), good = jwt.verify(start.body.token, secret);
  for (const alter of [{ version: 1 }, { actorId: 99 }, { aud: 'other' }, { exp: 1 }, { purpose: 'google_drive' }]) {
    const token = jwt.sign({ ...good, ...alter }, secret);
    const before = f.providerCalls; assert.equal((await f.chunk(token)).status, 401); assert.equal(f.providerCalls, before);
  }
});
test('provider metadata mismatch never attaches; errors are nonretryable and do not echo provider detail', async () => {
  for (const mutation of [f => { f.name = 'wrong'; }, f => { f.mimeType = 'text/plain'; }, f => { f.size = '2'; }, f => { f.size = '1\n'; }, f => { f.parents = ['other']; }, f => { f.id = 'bad/id'; }]) {
    const f = fixture(), start = await f.start(); mutation(f.file);
    const result = await f.chunk(start.body.token);
    assert.equal(result.status, 409); assert.equal(result.body.code, 'DRIVE_UPLOAD_UNCERTAIN'); assert.equal(result.body.retryable, false); assert.equal(f.writes, 0);
  }
  const f = fixture(), start = await f.start(); f.provider.uploadChunk = async () => { throw Error('private-token-and-provider-body'); };
  assert.doesNotMatch(JSON.stringify((await f.chunk(start.body.token)).body), /private-token/);
});
test('failed commit after external start or chunk is typed uncertain and rolls back', async () => {
  const f = fixture(), start = await f.start();
  const query = f.db.query; let commits = 0;
  f.db.query = async (sql, args) => { if (sql === 'COMMIT' && ++commits === 2) throw Error('secret SQL'); return query(sql, args); };
  const result = await f.chunk(start.body.token); assert.equal(result.status, 409); assert.equal(result.body.code, 'DRIVE_UPLOAD_UNCERTAIN'); assert.ok(f.trace.includes('ROLLBACK'));
  assert.equal(f.task.propiedades_extra.drive_archivos, undefined);
  assert.equal([...f.intents.values()][0].state, 'in_flight');
  const calls = f.providerCalls; assert.equal((await f.chunk(start.body.token)).status, 409); assert.equal(f.providerCalls, calls);
});
test('replacement rechecks current role only after attachment commit; revoked role never trashes', async () => {
  const f = fixture({ role: 'admin' });
  f.provider.listChildren = async () => ({ files: [{ ...f.file, id: 'old-file' }] });
  const start = await f.call('post', '/uploads', { body: { name: f.file.name, mimeType: f.file.mimeType, size: 1, parentId: f.file.parents[0], taskId: 7, duplicateAction: 'replace' } });
  let trashed = false; f.provider.trashFile = async () => { trashed = true; };
  const query = f.db.query; let commits = 0;
  f.db.query = async (sql, args) => { const result = await query(sql, args); if (sql === 'COMMIT' && ++commits === 2) f.actor.rol = 'edicion'; return result; };
  const result = await f.chunk(start.body.token);
  assert.equal(f.writes, 1); assert.equal(trashed, false); assert.equal(result.status, 409); assert.equal(result.body.code, 'DRIVE_REPLACEMENT_UNCERTAIN');
});
test('OAuth connect state is v2 actor/epoch bound; callback revocation denies exchange; valid exchange saves before commit', async () => {
  const f = fixture({ role: 'admin' }), connect = await f.call('post', '/connect');
  const state = jwt.verify(connect.body.url, secret, { audience: 'render-drive-oauth-v2' });
  assert.equal(state.actorId, 3); assert.equal(state.sessionVersion, 1); assert.equal(state.version, 2);
  const publicRouter = createGoogleDrivePublicRouter(f.input);
  f.actor.session_version++;
  const before = f.providerCalls;
  assert.equal((await f.call('get', '/oauth/callback', { query: { state: connect.body.url, code: 'synthetic' } }, publicRouter)).status, 401);
  assert.equal(f.providerCalls, before);
  f.actor.session_version = 1; f.trace.length = 0;
  assert.equal((await f.call('get', '/oauth/callback', { query: { state: connect.body.url, code: 'synthetic' } }, publicRouter)).status, 302);
  assert.ok(f.trace.findIndex(s => s.includes('INSERT INTO integraciones_sistema')) < f.trace.lastIndexOf('COMMIT'));
  assert.ok(f.trace.indexOf('COMMIT') < f.trace.indexOf('PROVIDER'));
  const calls = f.providerCalls;
  assert.equal((await f.call('get', '/oauth/callback', { query: { state: connect.body.url, code: 'synthetic' } }, publicRouter)).body.code, 'DRIVE_OAUTH_STATE_CONSUMED');
  assert.equal(f.providerCalls, calls);
});
test('provider deadline aborts and late factory SQL cannot use released lease', async () => {
  const late = deferred(), entered = deferred(); let scoped, sql = 0, signal;
  const operation = boundedDriveProvider(async context => { scoped = context.db; signal = context.signal; entered.resolve(); await late.promise; await scoped.query('late'); return {}; }, { query: async () => { sql++; } }, 5, () => assert.fail('late operation'));
  await entered.promise; await assert.rejects(operation, { code: 'DRIVE_UPLOAD_UNCERTAIN' });
  assert.equal(signal.aborted, true); late.resolve(); assert.throws(() => scoped.query('late'), { name: 'AbortError' }); assert.equal(sql, 0);
});
test('default OAuth transporter and raw fetch both carry cancellation with no retry/redirect', () => {
  const source = readFileSync(new URL('../src/drive-provider.js', import.meta.url), 'utf8');
  assert.match(source, /transporterOptions: \{ signal, timeout: 15000, retry: false, maxRedirects: 0 \}/);
  assert.match(source, /signal, redirect: 'error'/); assert.doesNotMatch(source, /db\.query/);
  for (const url of ['http://www.googleapis.com/upload/drive/v3/files','https://www.googleapis.com.evil/upload/drive/v3/files','https://x@www.googleapis.com/upload/drive/v3/files','https://www.googleapis.com/upload/drive/v3/files/evil']) assert.equal(validDriveUploadUrl(url), false);
  assert.equal(validDriveUploadUrl('https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic'), true);
});

test('actual OAuth getToken and refresh override RETRY_CONFIG at the instance request boundary', async () => {
  const controller = new AbortController(), calls = [];
  const client = new OAuth2Client({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret', redirectUri: 'https://example.invalid/callback' });
  const other = new OAuth2Client({ clientId: 'another-synthetic-client' });
  const otherRequest = other.transporter.request;
  // Replace only this test instance's transport. Real SDK methods still build
  // their normal opts (including retry:true); no provider/network is contacted.
  client.transporter.request = async opts => {
    calls.push(opts);
    return { data: { access_token: 'synthetic-access', token_type: 'Bearer', expires_in: 3600, refresh_token: 'synthetic-refresh' } };
  };
  bindDriveOAuthTransport(client, controller.signal);
  await client.getToken('synthetic-code');
  client.setCredentials({ refresh_token: 'synthetic-refresh' });
  await client.getRequestHeaders();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.get('grant_type'), 'authorization_code');
  assert.equal(calls[1].data.get('grant_type'), 'refresh_token');
  for (const opts of calls) {
    assert.equal(opts.retry, false); assert.equal(opts.maxRedirects, 0); assert.equal(opts.timeout, 15000); assert.equal(opts.signal, controller.signal);
    assert.equal(opts.retryConfig.retry,0); assert.equal(opts.retryConfig.noResponseRetries,0); assert.equal(opts.retryConfig.shouldRetry(),false);
    assert.equal(typeof opts.fetchImplementation, 'function');
  }
  assert.equal(other.transporter.request, otherRequest);
  controller.abort();
  await assert.rejects(client.getToken('another-synthetic-code'), { name: 'AbortError' });
  assert.equal(calls.length, 2);
  assert.throws(() => calls[0].fetchImplementation('https://oauth2.googleapis.com/token', {}), { name: 'AbortError' });
});

test('installed OAuth and Gaxios dispatch once on HTTP 503 and network loss despite retryConfig defaults', async () => {
  for (const method of ['code','refresh']) for (const failure of ['503','network']) {
    const controller = new AbortController(); let dispatches = 0;
    const client = new OAuth2Client({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret', redirectUri: 'https://example.invalid/callback' });
    client.transporter.defaults.retryConfig = { retry: 10, noResponseRetries: 10, shouldRetry: () => true, httpMethodsToRetry: ['POST'] };
    bindDriveOAuthTransport(client,controller.signal,{ fetchImpl: async (url,init) => {
      dispatches++;
      assert.equal(String(url),'https://oauth2.googleapis.com/token');
      assert.equal(init.retryConfig.retry,0); assert.equal(init.retryConfig.noResponseRetries,0); assert.equal(init.retryConfig.shouldRetry(),false);
      assert.equal(init.signal,controller.signal); assert.equal(init.redirect,'error');
      if (failure === 'network') throw new TypeError('synthetic network loss; no actual network');
      return new Response(JSON.stringify({ error: 'temporarily_unavailable' }),{ status: 503,headers: { 'content-type': 'application/json' } });
    } });
    if (method === 'refresh') client.setCredentials({ refresh_token: 'synthetic-refresh' });
    await assert.rejects(method === 'code' ? client.getToken('synthetic-code') : client.getRequestHeaders());
    assert.equal(dispatches,1,`${method}/${failure} must not automatically dispatch twice`);
  }
});

test('OAuth expiry is observed after the second-phase nonce lock wait and prevents any exchange', { timeout: 2000 }, async () => {
  const f = fixture({ role: 'admin' }), connect = await f.call('post','/connect'), router = createGoogleDrivePublicRouter(f.input);
  const locked = deferred(), release = deferred(), query = f.db.query; let exchanges = 0;
  f.provider.exchangeCode = async () => { exchanges++; assert.fail('Expired nonce must never reach exchange'); };
  f.db.query = async (sql,args) => {
    const result = await query(sql,args);
    if (sql.startsWith('SELECT * FROM drive_oauth_nonces')) { locked.resolve(); await release.promise; }
    return result;
  };
  const before = f.providerCalls;
  const pending = f.call('get','/oauth/callback',{ query: { state: connect.body.url,code:'synthetic' } },router);
  try {
    await locked.promise;
    // Advance only the simulated database clock while the lock is waiting;
    // the row snapshot and JWT remain valid observations from before the wait.
    f.db.now = () => [...f.nonces.values()][0].expires_at+1;
    release.resolve();
    const result = await pending;
    assert.equal(result.status,409); assert.equal(result.body.code,'DRIVE_OAUTH_STATE_CONSUMED');
    assert.equal(exchanges,0); assert.equal(f.providerCalls,before);
    assert.ok(f.trace.findIndex(sql=>sql.startsWith('SELECT expires_at>clock_timestamp()')) > f.trace.findIndex(sql=>sql.startsWith('SELECT * FROM drive_oauth_nonces')));
    assert.ok([...f.nonces.values()][0].consumed_at);
  } finally { release.resolve(); await pending; }
});

test('initial duplicate is a typed pre-start rejection permitting an explicit choice only', async () => {
  const f = fixture(); f.provider.listChildren = async () => ({ files: [f.file] });
  let starts = 0; f.provider.startUpload = async () => { starts++; assert.fail('No automatic choice'); };
  const response = await f.start();
  assert.equal(response.status, 409); assert.equal(response.body.code, 'DRIVE_DUPLICATE_REJECTED'); assert.equal(response.body.retryable, false);
  assert.equal(starts, 0); assert.equal(f.intents.size, 0);
});

test('308 ACK caches exact chunk and advances offset; final ACK is terminal without second provider call', async () => {
  const f = fixture(); f.file.size = '2';
  const start = await f.call('post', '/uploads', { body: { name: f.file.name, mimeType: f.file.mimeType, size: 2, parentId: f.file.parents[0], taskId: 7 } });
  const token = start.body.token;
  const send = (range, value) => f.call('put', '/uploads/:token', { params: { token }, body: Buffer.from([value]), get: () => range });
  let uploads = 0;
  f.provider.uploadChunk = async () => { uploads++; return uploads === 1 ? { status: 308, received: 'bytes=0-0' } : { status: 200, file: f.file }; };
  const first = await send('bytes 0-0/2', 1); assert.equal(first.status, 202);
  assert.deepEqual(await send('bytes 0-0/2', 1), first); assert.equal(uploads, 1);
  assert.equal((await send('bytes 0-0/2', 2)).status, 409); assert.equal(uploads, 1);
  const final = await send('bytes 1-1/2', 2); assert.equal(final.status, 200);
  assert.deepEqual(await send('bytes 1-1/2', 2), final); assert.equal(uploads, 2); assert.equal(f.writes, 1);
  assert.equal((await send('bytes 0-0/2', 1)).status, 409); assert.equal(uploads, 2);
});

test('zero-byte intent completes once with an exact cached ACK', async () => {
  for (const size of ['0',0]) {
    const f = fixture(); f.file.size = size;
    const start = await f.call('post', '/uploads', { body: { name: f.file.name, mimeType: f.file.mimeType, size: 0, parentId: f.file.parents[0], taskId: 7 } });
    let uploads = 0; f.provider.uploadChunk = async () => { uploads++; return { status: 201, file: f.file }; };
    const send = () => f.call('put', '/uploads/:token', { params: { token: start.body.token }, body: Buffer.alloc(0), get: () => 'bytes */0' });
    const first = await send(); assert.equal(first.status, 200); assert.equal(first.body.size, 0);
    assert.deepEqual(await send(), first); assert.equal(uploads, 1);
  }
});

test('unknown provider completion remains fail closed after restart with the same pool and JWT', async () => {
  const f = fixture(), start = await f.start(); let uploads = 0;
  f.provider.uploadChunk = async () => { uploads++; throw Error('simulated transport loss after external commit'); };
  assert.equal((await f.chunk(start.body.token)).status, 409);
  createGoogleDriveRouter(f.input); // No process-local upload receipt is consulted.
  assert.equal((await f.chunk(start.body.token)).status, 409); assert.equal(uploads, 1);
  assert.equal([...f.intents.values()][0].state, 'in_flight'); assert.equal(f.writes, 0);
});

test('confirmed ACK is still protected by current authority and never instantiates a provider on replay', async () => {
  const f = fixture(), start = await f.start(); assert.equal((await f.chunk(start.body.token)).status, 200);
  const calls = f.providerCalls; f.actor.session_version++;
  assert.equal((await f.chunk(start.body.token)).status, 401); assert.equal(f.providerCalls, calls);
});

test('committed chunk reservation followed by actor revocation cannot reach provider', async () => {
  const f = fixture(), start = await f.start(), query = f.db.query; let commits = 0;
  f.db.query = async (sql, args) => { const value = await query(sql,args); if (sql === 'COMMIT' && ++commits === 1) f.actor.session_version++; return value; };
  const calls = f.providerCalls;
  assert.equal((await f.chunk(start.body.token)).status, 401); assert.equal(f.providerCalls, calls);
  assert.equal([...f.intents.values()][0].state, 'in_flight'); assert.equal(f.writes, 0);
});

test('replacement is claimed and committed before trash; terminal replay never repeats either effect', async () => {
  const f = fixture({ role: 'admin' }); f.provider.listChildren = async () => ({ files: [{ ...f.file, id: 'old-file' }] });
  const start = await f.call('post', '/uploads', { body: { name: f.file.name, mimeType: f.file.mimeType, size: 1, parentId: f.file.parents[0], taskId: 7, duplicateAction: 'replace' } });
  let uploads = 0, trash = 0;
  f.provider.uploadChunk = async () => { uploads++; return { status: 200, file: f.file }; };
  f.provider.trashFile = async () => {
    trash++;
    const row = [...f.intents.values()][0]; assert.equal(row.state, 'completed'); assert.equal(row.replacement_state, 'in_flight');
    assert.ok(f.trace.lastIndexOf('COMMIT') > f.trace.findLastIndex(sql => sql.includes("replacement_state='in_flight'")));
  };
  const first = await f.chunk(start.body.token); assert.equal(first.status, 200);
  assert.deepEqual(await f.chunk(start.body.token), first); assert.equal(uploads, 1); assert.equal(trash, 1);
});

test('unknown trash or failed trash commit never causes another upload or replacement', async () => {
  for (const failure of ['provider','commit']) {
    const f = fixture({ role: 'admin' }); f.provider.listChildren = async () => ({ files: [{ ...f.file, id: 'old-file' }] });
    const start = await f.call('post', '/uploads', { body: { name: f.file.name, mimeType: f.file.mimeType, size: 1, parentId: f.file.parents[0], taskId: 7, duplicateAction: 'replace' } });
    let uploads = 0, trash = 0, afterTrash = false;
    f.provider.uploadChunk = async () => { uploads++; return { status: 200, file: f.file }; };
    f.provider.trashFile = async () => { trash++; afterTrash = true; if (failure === 'provider') throw Error('private provider failure'); };
    const query = f.db.query; f.db.query = async (sql,args) => { if (sql === 'COMMIT' && afterTrash && failure === 'commit') throw Error('private SQL failure'); return query(sql,args); };
    const result = await f.chunk(start.body.token); assert.equal(result.status, 409); assert.equal(result.body.code, 'DRIVE_REPLACEMENT_UNCERTAIN');
    afterTrash = false;
    assert.equal((await f.chunk(start.body.token)).body.code, 'DRIVE_REPLACEMENT_UNCERTAIN'); assert.equal(uploads, 1); assert.equal(trash, 1);
    assert.equal([...f.intents.values()][0].replacement_state, 'in_flight'); assert.equal(f.task.propiedades_extra.drive_archivos.length, 1);
  }
});

test('OAuth unknown exchange or credential commit consumes nonce durably with no reexchange', async () => {
  for (const failure of ['provider','commit']) {
    const f = fixture({ role: 'admin' }), connect = await f.call('post','/connect'), router = createGoogleDrivePublicRouter(f.input);
    let exchanges = 0, afterExchange = false;
    f.provider.exchangeCode = async () => { exchanges++; afterExchange = true; if (failure === 'provider') throw Error('private exchange'); return { refresh_token: 'synthetic-only' }; };
    const query = f.db.query; f.db.query = async (sql,args) => { if (sql === 'COMMIT' && afterExchange && failure === 'commit') throw Error('private SQL'); return query(sql,args); };
    const send = () => f.call('get','/oauth/callback',{ query: { state: connect.body.url, code: 'synthetic' } },router);
    const first = await send(); assert.equal(first.body.code,'DRIVE_OAUTH_UNCERTAIN'); afterExchange = false;
    assert.equal((await send()).body.code,'DRIVE_OAUTH_STATE_CONSUMED'); assert.equal(exchanges,1);
    assert.ok([...f.nonces.values()][0].consumed_at); assert.equal([...f.nonces.values()][0].completed_at,null);
  }
});

test('concurrent callers of one final chunk cannot both dispatch an external PUT', async () => {
  const f = fixture(), start = await f.start(), entered = deferred(), finish = deferred(); let uploads = 0;
  f.provider.uploadChunk = async () => { uploads++; entered.resolve(); await finish.promise; return { status: 200, file: f.file }; };
  const first = f.chunk(start.body.token); await entered.promise;
  const second = f.chunk(start.body.token); finish.resolve();
  const [a,b] = await Promise.all([first,second]);
  assert.equal(a.status,200); assert.equal(b.status,200); assert.deepEqual(a.body,b.body); assert.equal(uploads,1); assert.equal(f.writes,1);
});

test('concurrent OAuth callbacks consume one nonce and dispatch only one exchange', async () => {
  const f = fixture({ role: 'admin' }), connect = await f.call('post','/connect'), router = createGoogleDrivePublicRouter(f.input);
  let exchanges = 0; f.provider.exchangeCode = async () => { exchanges++; return { refresh_token: 'synthetic-only' }; };
  const send = () => f.call('get','/oauth/callback',{ query: { state: connect.body.url, code: 'synthetic' } },router);
  const results = await Promise.all([send(),send()]);
  assert.deepEqual(results.map(r=>r.status).sort(),[302,409]); assert.equal(exchanges,1);
});

test('reservation commit failure dispatches no external request', async () => {
  const f = fixture(), start = await f.start(), query = f.db.query;
  let uploads = 0; f.provider.uploadChunk = async () => { uploads++; return { status: 200, file: f.file }; };
  f.db.query = async (sql,args) => { if (sql === 'COMMIT') throw Error('reservation commit failure'); return query(sql,args); };
  const result = await f.chunk(start.body.token);
  assert.equal(result.status,503); assert.equal(result.body.retryable,false); assert.equal(uploads,0); assert.equal([...f.intents.values()][0].state,'ready');
});

test('malformed 308 acknowledgement cannot advance a durable offset or retry Google', async () => {
  const f = fixture(); f.file.size = '2';
  const start = await f.call('post', '/uploads', { body: { name: f.file.name, mimeType: f.file.mimeType, size: 2, parentId: f.file.parents[0], taskId: 7 } });
  let uploads = 0; f.provider.uploadChunk = async () => { uploads++; return { status: 308, received: 'bytes=0-1' }; };
  const send = () => f.call('put','/uploads/:token',{ params: { token:start.body.token },body:Buffer.from([1]),get:()=> 'bytes 0-0/2' });
  assert.equal((await send()).status,409); assert.equal((await send()).status,409); assert.equal(uploads,1);
  assert.equal([...f.intents.values()][0].next_offset,0);
});

test('080 adds only new indexed receipts/nonces without rewriting operational history', () => {
  const sql = readFileSync(new URL('../migrations/080_drive_upload_intents.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE drive_upload_intents/); assert.match(sql,/CREATE TABLE drive_oauth_nonces/);
  assert.match(sql,/drive_upload_intents_task_idx/); assert.match(sql,/drive_oauth_nonces_actor_idx/);
  assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE FROM|INSERT INTO|ALTER TABLE)\s+(?:tareas|usuarios|integraciones_sistema)\b/i);
  assert.doesNotMatch(sql,/refresh_token|access_token|chunk_bytes/);
});
