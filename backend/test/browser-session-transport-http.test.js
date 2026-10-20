import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

// Real loopback HTTP/Express; account queries below are explicitly SYNTHETIC.
// No principal server import, database connection, password verification,
// provider, automatic cookie jar or runtime route activation is involved.
test('browser transport over isolated Express HTTP: cookie/challenge/context/CSRF and current synthetic account boundaries', {
  skip: process.env.RENDER2_RUN_LOCAL_BROWSER_TRANSPORT !== 'true', timeout: 30000,
}, async t => {
  const [{ default: express }, { createBrowserSessionTransport }] = await Promise.all([
    import('express'), import('../src/browser-session-transport.js'),
  ]);
  const accounts = new Map([
    [17, { id: 17, usuario: 'synthetic_a', nombre: 'Synthetic A', rol: 'admin', activo: true, session_version: 1 }],
    [18, { id: 18, usuario: 'synthetic_b', nombre: 'Synthetic B', rol: 'edicion', activo: true, session_version: 1 }],
  ]);
  const counters = { queries: 0, login: 0, writes: 0, multipart: 0, logout: 0 };
  let queryFails = false, holdLogout = null;
  const pool = { async query(sql, values) {
    counters.queries += 1;
    assert.equal(sql, 'SELECT id, usuario, nombre, rol, activo, session_version FROM usuarios WHERE id=$1');
    assert.ok(Number.isSafeInteger(values?.[0]), 'Synthetic lookup requires a numeric actor ID');
    if (queryFails) throw new Error('Synthetic account fixture unavailable');
    const row = accounts.get(values[0]); return { rows: row ? [{ ...row }] : [] };
  } };
  const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '2kb' }));
  const sockets = new Set(), server = createServer(app);
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(async () => {
    holdLogout?.release.resolve();
    const closed = Promise.all([...sockets].map(socket => new Promise(resolve => socket.once('close', resolve))));
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(() => resolve()));
    await closed;
    assert.equal(server.listening, false); assert.equal(sockets.size, 0);
    t.diagnostic('Own numeric-loopback Express listener and sockets closed; no DB/provider was accessed.');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.equal(address.address, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const transport = createBrowserSessionTransport({ origin, secret: randomBytes(48).toString('hex'), development: true, pool });
  app.get('/challenge', transport.issueLoginChallenge);
  app.post('/login', transport.requireLoginChallenge, (req, res) => {
    // This selection substitutes ONLY an already-verified synthetic account.
    // It is not a real password/Google login implementation or principal route.
    const account = accounts.get(req.body?.account_id);
    if (!account || account.activo !== true) return res.status(401).json({ code: 'synthetic_account_denied' });
    counters.login += 1;
    res.json({ user: { id: account.id }, ...transport.establishSession({ ...account }, res) });
  });
  app.get('/bootstrap', transport.authenticate, (req, res) => res.json({
    user: { id: req.auth.id, rol: req.auth.rol }, ...req.browserSession,
  }));
  for (const method of ['post', 'patch', 'delete']) app[method]('/write', transport.authenticate, (req, res) => {
    counters.writes += 1; res.json({ written: true, actor_id: req.auth.id, method: req.method });
  });
  app.post('/multipart', transport.authenticate, express.raw({ type: 'multipart/form-data', limit: '2kb' }), (req, res) => {
    counters.writes += 1; counters.multipart += 1;
    res.json({ written: true, actor_id: req.auth.id, received_bytes: Buffer.isBuffer(req.body) ? req.body.length : 0 });
  });
  app.post('/logout', transport.authenticate, async (req, res) => {
    counters.logout += 1; accounts.get(req.auth.id).session_version += 1;
    const hold = holdLogout;
    if (hold) { hold.entered.resolve(); await hold.release.promise; }
    // Deliberately do not expire/refresh cookies, matching the frozen boundary.
    res.json({ ok: true });
  });
  app.use((_error, _req, res, _next) => res.status(500).json({ code: 'synthetic_fixture_error' }));
  const http = async (route, { method = 'GET', headers = {}, body, raw } = {}) => {
    const response = await fetch(`${origin}${route}`, { method, redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(raw === undefined ? body === undefined ? {} : { body: JSON.stringify(body) } : { body: raw }),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'),
      cache: response.headers.get('cache-control') };
  };
  const checked = (response, status = 200, code) => {
    // Never attach a request, response body, cookie or context token to errors.
    assert.equal(response.status, status, 'HTTP status');
    if (code) assert.equal(response.body.code, code);
    return response;
  };
  const noCookie = response => assert.equal(response.cookie, null, 'Response must not overwrite a newer browser cookie');
  const cookiePair = response => {
    assert.ok(typeof response.cookie === 'string', 'Expected a cookie without logging its value');
    return response.cookie.split(';')[0];
  };
  const cookieAttributes = (response, name, sameSite, age) => {
    assert.ok(response.cookie?.startsWith(`${name}=`), 'Expected cookie name');
    for (const attribute of ['Path=/', 'HttpOnly', `SameSite=${sameSite}`, `Max-Age=${age}`])
      assert.ok(response.cookie.split(';').map(part => part.trim()).includes(attribute), `Expected ${attribute}`);
    assert.ok(!response.cookie.split(';').map(part => part.trim()).includes('Secure'), 'Explicit HTTP numeric-loopback development cookie only');
    assert.ok(!/;\s*Domain=/i.test(response.cookie), 'Cookie is host-only');
    assert.equal(response.cache, 'no-store');
  };
  const challenge = async () => checked(await http('/challenge', { headers: { 'sec-fetch-site': 'same-origin' } }));
  const signIn = async id => {
    const first = await challenge();
    const response = checked(await http('/login', { method: 'POST', headers: {
      origin, cookie: cookiePair(first), 'x-render-csrf': first.body.csrf_token, 'sec-fetch-site': 'same-origin',
    }, body: { account_id: id } }));
    cookieAttributes(response, transport.sessionName, 'Lax', 28800);
    assert.deepEqual(Object.keys(response.body).sort(), ['user', 'session_context', 'csrf_token'].sort());
    assert.ok(!JSON.stringify(response.body).includes(cookiePair(response).slice(transport.sessionName.length + 1)), 'JWT never enters JSON');
    return { cookie: cookiePair(response), context: response.body.session_context, csrf: response.body.csrf_token, id };
  };
  const headersFor = session => ({ origin, cookie: session.cookie, 'x-render-session-context': session.context,
    'x-render-csrf': session.csrf, 'sec-fetch-site': 'same-origin' });
  const rejectWithoutLookup = async (operation, status, code) => {
    const before = { ...counters }; const response = checked(await operation(), status, code);
    assert.deepEqual(counters, before, 'Rejected transport must not reach synthetic account query or mutation'); noCookie(response);
  };
  let a, b;

  await t.test('challenge and established dev cookies are HttpOnly/host-only, JSON exposes only bound context/CSRF, bootstrap is no-store', async () => {
    const first = await challenge(); cookieAttributes(first, transport.challengeName, 'Strict', 600);
    assert.deepEqual(Object.keys(first.body), ['csrf_token']);
    assert.ok(!/;\s*Domain=/i.test(first.cookie), 'Challenge is host-only');
    a = await signIn(17); b = await signIn(18);
    assert.ok(a.context !== b.context && a.csrf !== b.csrf, 'Distinct cookie sessions have distinct bound contexts');
    assert.ok(a.context !== a.csrf, 'CSRF and context remain purpose-separated');
    const response = checked(await http('/bootstrap', { headers: { cookie: a.cookie } }));
    assert.deepEqual(response.body.user, { id: 17, rol: 'admin' });
    assert.ok(response.body.session_context === a.context && response.body.csrf_token === a.csrf, 'Bootstrap restores same cookie context');
    assert.equal(response.cache, 'no-store'); noCookie(response);
  });

  await t.test('hostile/missing Origin, cross-site metadata and login CSRF mismatch reject before synthetic verified-login callback', async () => {
    const first = await challenge(), second = await challenge();
    const valid = { origin, cookie: cookiePair(first), 'x-render-csrf': first.body.csrf_token };
    for (const headers of [
      { ...valid, origin: 'https://hostile.invalid' }, { ...valid, origin: 'null' },
      { cookie: valid.cookie, 'x-render-csrf': valid['x-render-csrf'] }, { ...valid, 'sec-fetch-site': 'cross-site' },
      { ...valid, 'sec-fetch-site': 'same-site' }, { ...valid, authorization: 'Bearer synthetic-ambiguous' },
      { ...valid, 'x-render-csrf': second.body.csrf_token }, { origin, cookie: valid.cookie },
      { origin, 'x-render-csrf': first.body.csrf_token },
      { ...valid, cookie: `${valid.cookie}; ${valid.cookie}` }, { ...valid, cookie: `${valid.cookie}; malformed` },
    ]) await rejectWithoutLookup(() => http('/login', { method: 'POST', headers, body: { account_id: 17 } }), 403);
    for (const headers of [{ origin: 'https://hostile.invalid' }, { 'sec-fetch-site': 'cross-site' }, { authorization: 'Basic synthetic' }])
      await rejectWithoutLookup(() => http('/challenge', { headers }), 403, 'browser_origin_invalid');
  });

  await t.test('POST/PATCH/DELETE and multipart authenticate the bound actor exactly once before synthetic writes', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const before = { ...counters };
      const response = checked(await http('/write', { method, headers: headersFor(a), body: { synthetic: true } }));
      assert.deepEqual(response.body, { written: true, actor_id: 17, method }); noCookie(response);
      assert.equal(counters.queries, before.queries + 1); assert.equal(counters.writes, before.writes + 1);
    }
    const boundary = 'render2-synthetic-boundary';
    const raw = `--${boundary}\r\nContent-Disposition: form-data; name="fixture"\r\n\r\nsynthetic only\r\n--${boundary}--\r\n`;
    const before = { ...counters };
    const response = checked(await http('/multipart', { method: 'POST', headers: {
      ...headersFor(b), 'content-type': `multipart/form-data; boundary=${boundary}`,
    }, raw }));
    assert.equal(response.body.actor_id, 18); assert.equal(response.body.received_bytes, Buffer.byteLength(raw));
    assert.equal(counters.multipart, before.multipart + 1); assert.equal(counters.writes, before.writes + 1);
    assert.equal(counters.queries, before.queries + 1); noCookie(response);
  });

  await t.test('cookie B with context/CSRF A rejects 409 before lookup/write for every mutation including multipart/logout', async () => {
    const crossed = { ...headersFor(a), cookie: b.cookie };
    for (const [route, method] of [['/write', 'POST'], ['/write', 'PATCH'], ['/write', 'DELETE'], ['/multipart', 'POST'], ['/logout', 'POST']])
      await rejectWithoutLookup(() => http(route, { method, headers: crossed, body: { synthetic: true } }), 409, 'browser_session_changed');
    const sameUserSecondLogin = await signIn(17);
    assert.ok(sameUserSecondLogin.context !== a.context, 'Unique issuance binds even two sessions of the same account');
    await rejectWithoutLookup(() => http('/write', { method: 'PATCH', headers: { ...headersFor(a), cookie: sameUserSecondLogin.cookie } }),
      409, 'browser_session_changed');
  });

  await t.test('missing/wrong CSRF or context, hostile write origin and ambiguous bearer+cookie cannot reach lookup', async () => {
    const base = headersFor(a);
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const noCSRF = { ...base }; delete noCSRF['x-render-csrf'];
      await rejectWithoutLookup(() => http('/write', { method, headers: noCSRF }), 403, 'browser_csrf_invalid');
      await rejectWithoutLookup(() => http('/write', { method, headers: { ...base, 'x-render-csrf': b.csrf } }), 403, 'browser_csrf_invalid');
      const noContext = { ...base }; delete noContext['x-render-session-context'];
      await rejectWithoutLookup(() => http('/write', { method, headers: noContext }), 409, 'browser_session_changed');
    }
    for (const headers of [{ ...base, origin: 'https://hostile.invalid' }, { ...base, 'sec-fetch-site': 'same-site' },
      { ...base, 'sec-fetch-site': 'cross-site' }])
      await rejectWithoutLookup(() => http('/write', { method: 'POST', headers }), 403, 'browser_origin_invalid');
    const noOrigin = { ...base }; delete noOrigin.origin;
    await rejectWithoutLookup(() => http('/write', { method: 'POST', headers: noOrigin }), 403, 'browser_origin_invalid');
    for (const authorization of ['Bearer synthetic-ambiguous', 'Basic synthetic', ''])
      await rejectWithoutLookup(() => http('/bootstrap', { headers: { cookie: a.cookie, authorization } }), 400, 'browser_credentials_ambiguous');
  });

  await t.test('missing/malformed/duplicate cookies and hostile safe reads fail before lookup without Set-Cookie', async () => {
    for (const cookie of [undefined, '', `${transport.sessionName}=invalid`, `${a.cookie}; ${a.cookie}`,
      `${a.cookie}; malformed`, `${a.cookie};`, `${transport.sessionName}=bad%value`, `${transport.sessionName}=${'a'.repeat(4097)}`])
      await rejectWithoutLookup(() => http('/bootstrap', { headers: cookie === undefined ? {} : { cookie } }), 401, 'browser_session_invalid');
    await rejectWithoutLookup(() => http('/bootstrap', { headers: { cookie: a.cookie, origin: 'https://hostile.invalid' } }), 403, 'browser_origin_invalid');
  });

  await t.test('live account role is authoritative; revocation/inactivity/missing actor and query failure never write or refresh cookies', async () => {
    const account = accounts.get(18), beforeRole = account.rol;
    account.rol = 'diseno';
    const role = checked(await http('/bootstrap', { headers: { cookie: b.cookie } }));
    assert.equal(role.body.user.rol, 'diseno'); noCookie(role); account.rol = beforeRole;
    const failures = [
      { set: () => { account.session_version += 1; }, restore: () => { account.session_version -= 1; } },
      { set: () => { account.activo = false; }, restore: () => { account.activo = true; } },
      { set: () => { accounts.delete(18); }, restore: () => { accounts.set(18, account); } },
    ];
    for (const change of failures) {
      change.set();
      try {
        const before = { ...counters };
        const response = checked(await http('/write', { method: 'POST', headers: headersFor(b) }), 401);
        assert.equal(counters.queries, before.queries + 1); assert.equal(counters.writes, before.writes); noCookie(response);
      } finally { change.restore(); }
    }
    queryFails = true;
    try {
      const before = counters.writes;
      const response = checked(await http('/write', { method: 'DELETE', headers: headersFor(b) }), 500, 'synthetic_fixture_error');
      assert.equal(counters.writes, before); noCookie(response);
    } finally { queryFails = false; }
  });

  await t.test('delayed old logout response cannot clear/refresh the cookie of a newer login of the same account', async () => {
    holdLogout = { entered: deferred(), release: deferred() };
    let pending, barrierTimer;
    try {
      pending = http('/logout', { method: 'POST', headers: headersFor(a), body: {} });
      await Promise.race([holdLogout.entered.promise, new Promise((_resolve, reject) => {
        barrierTimer = setTimeout(() => reject(new Error('Synthetic logout did not reach barrier')), 3000);
      })]);
      clearTimeout(barrierTimer);
      const newer = await signIn(17); assert.ok(newer.context !== a.context, 'New login has a new bound session');
      const current = checked(await http('/bootstrap', { headers: { cookie: newer.cookie } })); noCookie(current);
      holdLogout.release.resolve();
      const oldResponse = checked(await pending); noCookie(oldResponse);
      checked(await http('/write', { method: 'PATCH', headers: headersFor(newer) }));
      const old = checked(await http('/bootstrap', { headers: { cookie: a.cookie } }), 401); noCookie(old);
      const stillNew = checked(await http('/bootstrap', { headers: { cookie: newer.cookie } })); noCookie(stillNew);
      assert.ok(stillNew.body.session_context === newer.context, 'Old logout cannot replace the newer bootstrap context');
    } finally { clearTimeout(barrierTimer); holdLogout.release.resolve(); if (pending) await pending.catch(() => {}); holdLogout = null; }
  });
});
