import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshEditingTask } from './editingTaskRefresh.js';
function fakeTimer() {
  let tick, cleared = false;
  return { timers: { setTimeout(callback, ms) { assert.equal(ms, 15000); tick = callback; return 1; }, clearTimeout(id) { assert.equal(id, 1); cleared = true; } },
    expire() { tick(); }, get cleared() { return cleared; } };
}
test('accepted review parent read refreshes only the same current task and clears its deadline', async () => {
  const clock = fakeTimer(), events = [], row = { id: 7, revision: 9 };
  await refreshEditingTask({ taskId: 7, timers: clock.timers, request: async (id, options) => {
    assert.equal(id, 7); assert.ok(options.signal instanceof AbortSignal); return row;
  }, onRefreshed: value => events.push(value) }, () => true);
  assert.deepEqual(events, [row]); assert.equal(clock.cleared, true);
});
test('parent deadline rejects even an uncooperative read, aborts and ignores its late result', async () => {
  const clock = fakeTimer(), events = []; let resolveRead, signal;
  const result = refreshEditingTask({ taskId: 7, timers: clock.timers, request: (_id, options) => {
    signal = options.signal; return new Promise(resolve => { resolveRead = resolve; });
  }, onRefreshed: value => events.push(value) }, () => true);
  const rejected = assert.rejects(result, /a tiempo/); clock.expire(); await rejected;
  assert.equal(signal.aborted, true); assert.equal(clock.cleared, true);
  resolveRead({ id: 7 }); await Promise.resolve(); assert.deepEqual(events, []);
});
test('obsolete sessions never start a read or publish a late parent task', async () => {
  let current = false, resolveRead; const events = [], clock = fakeTimer();
  await refreshEditingTask({ taskId: 7, request: () => assert.fail('Obsolete session'), onRefreshed: () => assert.fail() }, () => current);
  current = true;
  const result = refreshEditingTask({ taskId: 7, timers: clock.timers, request: () => new Promise(resolve => { resolveRead = resolve; }), onRefreshed: value => events.push(value) }, () => current);
  current = false; resolveRead({ id: 7 }); await result;
  assert.deepEqual(events, []); assert.equal(clock.cleared, true);
});
test('failed parent read propagates for accepted-mutation recovery and clears the timer', async () => {
  const clock = fakeTimer();
  await assert.rejects(refreshEditingTask({ taskId: 7, timers: clock.timers, request: async () => { throw new Error('offline'); }, onRefreshed: () => assert.fail() }, () => true), /offline/);
  assert.equal(clock.cleared, true);
});
