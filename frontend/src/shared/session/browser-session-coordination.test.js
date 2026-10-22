import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionCoordination, BROWSER_SESSION_CHANNEL } from './browser-session-coordination.js';

function bus() {
  const channels = [];
  const createChannel = name => {
    assert.equal(name, BROWSER_SESSION_CHANNEL);
    const listeners = new Set();
    const channel = { closed: false, sent: [],
      addEventListener(type, fn) { assert.equal(type, 'message'); listeners.add(fn); },
      removeEventListener(type, fn) { listeners.delete(fn); },
      close() { this.closed = true; },
      emit(data) { for (const fn of [...listeners]) fn({ data }); },
      postMessage(data) {
        this.sent.push(data);
        for (const other of channels) if (other !== this && !other.closed) other.emit(data);
      },
      listeners,
    };
    channels.push(channel); return channel;
  };
  return { channels, createChannel };
}

test('lazy document transport exchanges only finite reasons, without local echo or automatic response', () => {
  const b = bus(), a = createBrowserSessionCoordination(b), c = createBrowserSessionCoordination(b);
  assert.equal(b.channels.length, 0);
  const received = [], local = [];
  a.subscribe(h => local.push(h)); c.subscribe(h => received.push(h));
  a.notifyChange({ reason: 'login' }); a.notifyChange({ reason: 'logout' });
  assert.deepEqual(received, [{ reason: 'login' }, { reason: 'logout' }]);
  assert.ok(received.every(Object.isFrozen)); assert.deepEqual(local, []);
  assert.equal(b.channels[1].sent.length, 0);
  assert.deepEqual(b.channels[0].sent, received);
  a.dispose(); c.dispose();
});

test('closed payload rejects identities, credentials, extra keys, arrays and unsupported reasons', () => {
  const b = bus(), model = createBrowserSessionCoordination(b), received = [];
  model.subscribe(h => received.push(h));
  const invalid = [null, [], 'login', {}, { reason: 'refresh' }, { reason: 'LOGIN' },
    { reason: 'login', session: {} }, { reason: 'logout', token: 'secret' },
    { reason: 'login', [Symbol('hidden')]: true }];
  for (const value of invalid) {
    b.channels[0].emit(value);
    assert.throws(() => model.notifyChange(value), TypeError);
  }
  assert.deepEqual(received, []); assert.deepEqual(b.channels[0].sent, []); model.dispose();
});

test('unsubscribe, terminal disposal and held callbacks cannot publish to former owners', () => {
  const b = bus(), model = createBrowserSessionCoordination(b); let calls = 0;
  const remove = model.subscribe(() => calls++), held = [...b.channels[0].listeners][0];
  remove(); held({ data: { reason: 'login' } }); assert.equal(calls, 0);
  model.subscribe(() => calls++); model.dispose(); model.dispose();
  held({ data: { reason: 'logout' } }); model.notifyChange({ reason: 'login' });
  model.subscribe(() => calls++);
  assert.equal(calls, 0); assert.equal(b.channels.length, 1);
  assert.equal(b.channels[0].closed, true); assert.equal(b.channels[0].listeners.size, 0);
});

test('unavailable or throwing channel never retries or falls back to identity transport', () => {
  for (const failure of [() => null, () => { throw new Error('unavailable'); }]) {
    let attempts = 0;
    const model = createBrowserSessionCoordination({ createChannel: () => { attempts++; return failure(); } });
    model.subscribe(() => assert.fail('no hint')); model.notifyChange({ reason: 'login' });
    model.notifyChange({ reason: 'logout' }); assert.equal(attempts, 1); model.dispose();
  }
});

test('observer and post failures do not change transport authority or interrupt other observers', () => {
  const b = bus(), model = createBrowserSessionCoordination(b); let calls = 0;
  model.subscribe(() => { throw new Error('observer'); }); model.subscribe(() => calls++);
  b.channels[0].emit({ reason: 'logout' }); assert.equal(calls, 1);
  b.channels[0].postMessage = () => { throw new Error('closed'); };
  assert.doesNotThrow(() => model.notifyChange({ reason: 'login' })); model.dispose();
});
