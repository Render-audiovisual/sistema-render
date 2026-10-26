import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createFixtureHttpJournal, isFixtureReadyMessage, observeFixtureHttp } from '../scripts/fixture-http-observer.js';
import { startLocalHarness } from '../scripts/render2-local-test.js';

function setup(publish) {
  const server = new EventEmitter(), events = [];
  const detach = observeFixtureHttp(server, publish ?? (event => events.push(event)));
  const send = (method, url, status = 200) => {
    const res = Object.assign(new EventEmitter(), { statusCode: status });
    server.emit('request', { method, url, headers: { authorization: 'private' }, body: 'private' }, res);
    return res;
  };
  return { server, events, send, detach };
}

test('only finished allowlisted requests emit minimal status metadata once', () => {
  const f = setup();
  const post = f.send('POST', '/api/moodboards/boards/initialize');
  assert.deepEqual(f.events, []);
  post.emit('finish'); post.emit('finish');
  f.send('GET', '/api/moodboards/boards', 401).emit('finish');
  assert.deepEqual(f.events, [
    { sequence: 1, method: 'POST', path: '/api/moodboards/boards/initialize', status: 200 },
    { sequence: 2, method: 'GET', path: '/api/moodboards/boards', status: 401 },
  ]);
});

test('queries, arbitrary URLs, methods and aborted requests are not recorded', () => {
  const f = setup();
  for (const [method, url] of [
    ['GET', '/api/moodboards/boards?secret=private'], ['POST', '/api/login'],
    ['DELETE', '/api/moodboards/boards'], ['GET', 'https://private.example/api/moodboards/boards'],
  ]) f.send(method, url).emit('finish');
  f.send('GET', '/api/moodboards/boards').emit('close');
  assert.deepEqual(f.events, []);
});

test('detach removes observer and callback errors do not alter response flow', () => {
  const f = setup(() => { throw new Error('observer unavailable'); });
  assert.doesNotThrow(() => f.send('GET', '/api/moodboards/boards').emit('finish'));
  f.detach();
  assert.equal(f.server.listenerCount('request'), 0);
});

test('observer preserves real HTTP status and body, and does not record credentials', async () => {
  const events = [];
  const server = createServer((_req, res) => { res.writeHead(409); res.end('unchanged'); });
  const detach = observeFixtureHttp(server, event => events.push(event));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/moodboards/boards/initialize`, {
      method: 'POST', headers: { authorization: 'Bearer private', 'content-type': 'application/json' },
      body: '{"private":"not observed"}', signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 409);
    assert.equal(await response.text(), 'unchanged');
    assert.deepEqual(events, [{ sequence: 1, method: 'POST', path: '/api/moodboards/boards/initialize', status: 409 }]);
  } finally {
    detach(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('invalid observer options reject before allocating a fixture or touching PostgreSQL', async () => {
  for (const options of [{ observeMoodboardHttp: 'true' }, { observeMoodboardHttp: true },
    { observeMoodboardHttp: true, browserSessions: true, clusterOnly: true }]) {
    await assert.rejects(startLocalHarness(options), /HTTP observation requires a browser fixture/);
  }
});

test('journal is bounded, snapshots are defensive, and disabled collection stays empty', () => {
  const journal = createFixtureHttpJournal(true), disabled = createFixtureHttpJournal(false);
  for (let sequence = 1; sequence <= 257; sequence++) {
    const message = { type: 'render-fixture-http', event: {
      sequence, method: 'GET', path: '/api/moodboards/boards', status: 200, headers: 'private',
    } };
    journal.accept(message); disabled.accept(message);
  }
  const snapshot = journal.snapshot();
  assert.equal(snapshot.dropped, 1); assert.equal(snapshot.events.length, 256);
  assert.equal(snapshot.events[0].sequence, 2);
  assert.deepEqual(Object.keys(snapshot.events[0]), ['sequence', 'method', 'path', 'status']);
  snapshot.events[0].status = 500; snapshot.events.length = 0;
  assert.equal(journal.snapshot().events[0].status, 200);
  assert.deepEqual(disabled.snapshot(), { dropped: 0, events: [] });
});

test('observation IPC cannot be mistaken for fixture readiness', () => {
  assert.equal(isFixtureReadyMessage({ type: 'render-fixture-http', event: { status: 200 } }), false);
  for (const message of [null, undefined, {}, { base: 200 }]) assert.equal(isFixtureReadyMessage(message), false);
  assert.equal(isFixtureReadyMessage({ base: null }), true);
  assert.equal(isFixtureReadyMessage({ base: 'http://127.0.0.1:52899' }), true);
  assert.equal(isFixtureReadyMessage({ error: 'fixture failed' }), true);
});
