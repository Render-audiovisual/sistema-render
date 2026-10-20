import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { createLoginAttempts, LOGIN_FAILURE_MESSAGE } from '../../frontend/src/shared/session/login-attempt.js';
import { parseCurrentSession } from '../../frontend/src/shared/session/current-session.js';
import { createAuthenticatedApiFetch } from '../../frontend/src/shared/session/api-fetch.js';

test('principal real HTTP login attempts preserve only authorized captured destinations', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  // Missing shared implementation fails before any fixture is provisioned.
  const { readLoginDestination, resolveLoginDestination, loginHrefForDestination } =
    await import('../../frontend/src/shared/navigation/login-destination.js');
  const fixture = await startLocalHarness({ port: 55714 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), { code: 'ENOENT' });
  });
  const adminLogin = await request(fixture.base, '/api/login', {
    method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword },
  });
  assert.equal(adminLogin.status, 200);
  const created = await request(fixture.base, '/api/tareas', {
    method: 'POST', token: adminLogin.body.token, body: {
      titulo: 'QA93 actual destination task', workspace: 'render_os',
      asignado_a_id: 91003, colaborador_ids: [],
    },
  });
  assert.equal(created.status, 201);
  const taskId = created.body.id;
  const transport = (relative, options) => {
    assert.equal(relative, '/api/login', 'exercise the real password endpoint only');
    return fetch(new URL(relative, fixture.base), options);
  };
  const setup = (search, requestImpl = transport) => {
    // Capture once, as at page entry; navigation must not recapture mutable URL.
    const destination = readLoginDestination(search);
    let session = null, saves = 0;
    const navigations = [], states = [];
    const attempts = createLoginAttempts({
      getRuntime: () => null, request: requestImpl, readSession: () => session,
      save(token, user) {
        const parsed = parseCurrentSession(JSON.stringify({ token, usuario: user }));
        assert.ok(parsed, 'save must parse the genuine server login DTO');
        assert.equal(parsed.usuario.id, 91003);
        assert.equal(parsed.usuario.rol, 'edicion');
        session = parsed; saves++;
      },
      navigate: user => navigations.push(resolveLoginDestination(destination, user)),
      onState: state => states.push(state),
    });
    attempts.mount();
    return { attempts, navigations, states, get saves() { return saves; }, get session() { return session; } };
  };
  const credentials = { usuario: 'qa_luciano', password: fixturePassword };
  await t.test('actual employee login preserves task ID and view and can read the assigned task', async () => {
    const destination = `/workspace/tareas?task=${taskId}&view=list`;
    const href = loginHrefForDestination(destination);
    assert.equal(new URL(href, fixture.base).pathname, '/login');
    const state = setup(new URL(href, fixture.base).search);
    try {
      assert.equal(await state.attempts.login('password', credentials), true);
      assert.equal(state.saves, 1);
      assert.equal(state.navigations.length, 1);
      const actual = new URL(state.navigations[0], fixture.base);
      assert.equal(actual.pathname, '/workspace/tareas');
      assert.equal(actual.searchParams.get('task'), String(taskId));
      assert.equal(actual.searchParams.get('view'), 'list');
      const detail = await request(fixture.base, `/api/tareas/${taskId}?workspace=render_os`, { token: state.session.token });
      assert.equal(detail.status, 200);
      assert.equal(detail.body.id, taskId);
      assert.equal(detail.body.asignado_a_id, 91003);
    } finally { state.attempts.cleanup(); }
  });
  for (const [label, destination] of [['employee finance', '/sueldos'], ['external', 'https://example.invalid/not-render']]) {
    await t.test(`${label} destination falls back after actual successful login`, async () => {
      const state = setup(`?next=${encodeURIComponent(destination)}`);
      try {
        assert.equal(await state.attempts.login('password', credentials), true);
        assert.equal(state.saves, 1);
        assert.deepEqual(state.navigations, ['/inicio']);
      } finally { state.attempts.cleanup(); }
    });
  }
  await t.test('real wrong password never saves or navigates', async () => {
    const state = setup(`?next=${encodeURIComponent(`/workspace/tareas?task=${taskId}&view=list`)}`);
    try {
      assert.equal(await state.attempts.login('password', { ...credentials, password: 'QA93 incorrect fixture password' }), false);
      assert.equal(state.saves, 0);
      assert.equal(state.session, null);
      assert.deepEqual(state.navigations, []);
      assert.equal(state.states.find(value => value.error)?.error, LOGIN_FAILURE_MESSAGE);
    } finally { state.attempts.cleanup(); }
  });
  await t.test('cleanup suppresses a held genuine successful HTTP response even when delivery ignores abort', async () => {
    let signalHeld, release;
    const held = new Promise(resolve => { signalHeld = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Held login response deadline exceeded')), 8000);
    });
    deadline.catch(() => {});
    const state = setup(`?next=${encodeURIComponent(`/workspace/tareas?task=${taskId}&view=list`)}`, async (relative, options) => {
      const response = await transport(relative, options);
      assert.equal(response.status, 200);
      // Buffer actual HTTP bytes before cleanup. Replaying those exact bytes
      // tests late delivery, not a fabricated identity or verifier bypass.
      const bytes = await response.arrayBuffer();
      signalHeld();
      await gate;
      return new Response(bytes, { status: response.status, headers: response.headers });
    });
    const pending = state.attempts.login('password', credentials);
    try {
      await Promise.race([held, deadline, pending.then(() => { throw new Error('Login completed before held-response barrier'); })]);
      state.attempts.cleanup();
      const stateCount = state.states.length;
      release();
      assert.equal(await Promise.race([pending, deadline]), false);
      assert.equal(state.saves, 0);
      assert.equal(state.session, null);
      assert.deepEqual(state.navigations, []);
      assert.equal(state.states.length, stateCount, 'late response must not publish UI state');
    } finally {
      clearTimeout(timer); state.attempts.cleanup(); release(); await pending;
    }
  });
  await t.test('actual revoked-session 401 preserves task query/hash for a fresh real login', async () => {
    const initial = await request(fixture.base, '/api/login', { method: 'POST', body: credentials });
    assert.equal(initial.status, 200);
    let raw = JSON.stringify(initial.body);
    const destinations = [], destination = `/workspace/tareas?task=${taskId}&view=responsibles#brief`;
    const scoped = createAuthenticatedApiFetch({
      apiBase: fixture.base, fetchImpl: fetch,
      storage: { getItem: () => raw, removeItem: key => { assert.equal(key, 'render_sesion'); raw = null; } },
      location: { pathname: '/workspace/tareas', search: `?task=${taskId}&view=responsibles`, hash: '#brief', replace: value => destinations.push(value) },
    });
    const logout = await request(fixture.base, '/api/logout', { token: initial.body.token, method: 'POST' });
    assert.equal(logout.status, 200);
    const denied = await scoped(`/api/tareas/${taskId}?workspace=render_os`);
    assert.equal(denied.status, 401);
    assert.equal(raw, null); assert.equal(destinations.length, 1);
    assert.equal(readLoginDestination(new URL(destinations[0], fixture.base).search), destination);
    const state = setup(new URL(destinations[0], fixture.base).search);
    try {
      assert.equal(await state.attempts.login('password', credentials), true);
      assert.deepEqual(state.navigations, [destination]);
      assert.equal(state.saves, 1);
    } finally { state.attempts.cleanup(); }
  });
});
