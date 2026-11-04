import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribePersonalHomeRefresh } from './personalHome.js';

test('visible home polls server data and removes timer on leaving, hidden home does not poll', () => {
  const win = new EventTarget(), doc = new EventTarget(); let timer, removed, calls = 0;
  win.setInterval = (callback, delay) => { assert.equal(delay, 30000); timer = callback; return 42; };
  win.clearInterval = id => { removed = id; };
  doc.visibilityState = 'visible';
  const stop = subscribePersonalHomeRefresh({ refresh: () => { calls++; } }, win, doc);
  timer(); assert.equal(calls, 1);
  doc.visibilityState = 'hidden'; timer(); assert.equal(calls, 1);
  stop(); assert.equal(removed, 42);
});
