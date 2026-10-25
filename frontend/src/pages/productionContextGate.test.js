import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionContextGate} from './productionContextGate.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function fixture({dirty = true, activate = true} = {}) {
  const gate = createProductionContextGate(), decision = deferred(), events = [];
  const actor = {current: true};
  const state = {busy: false, dirty, observation: {}, epoch: 1, version: 1,
    visitObservation: {}, location: '/producciones?dia=2026-10-25'};
  let prompt, prompts = 0, captures = 0;
  const scope = {current: () => actor.current};
  const options = {
    capture: () => { captures++; return scope; },
    readState: () => ({...state}),
    confirm: value => { prompt = value; prompts++; return decision.promise; },
    onDiscard: () => events.push('discard'),
  };
  const lease = activate ? gate.activate() : null;
  const action = () => { events.push('action'); return 'action-result'; };
  return {gate, decision, state, actor, events, options, lease, action,
    get prompt() { return prompt; }, get prompts() { return prompts; },
    get captures() { return captures; }};
}

test('clean admission is synchronous, returns the exact action result and never asks to discard', () => {
  const f = fixture({dirty: false});
  const result = f.gate.run(f.action, f.options);
  assert.equal(result, 'action-result');
  assert.deepEqual(f.events, ['action']); assert.equal(f.prompts, 0);
  const sentinel = Promise.resolve('transport-owned');
  assert.equal(f.gate.run(() => sentinel, f.options), sentinel);
});

test('inactive, busy and retired actors cannot dispatch or request confirmation', async () => {
  for (const kind of ['inactive', 'busy', 'retired']) {
    const f = fixture({activate: kind !== 'inactive'});
    if (kind === 'busy') f.state.busy = true;
    if (kind === 'retired') f.actor.current = false;
    assert.equal(await f.gate.run(f.action, f.options), false, kind);
    assert.equal(f.prompts, 0, kind); assert.deepEqual(f.events, [], kind);
  }
});

test('dirty admission captures one scope and waits for explicit true before discard then action', async () => {
  const f = fixture(), pending = f.gate.run(f.action, f.options);
  assert.equal(f.captures, 1); assert.equal(f.prompts, 1);
  assert.deepEqual(f.events, []); assert.equal(f.prompt.signal.aborted, false);
  assert.equal(f.prompt.isCurrent(), true);
  f.decision.resolve(true);
  assert.equal(await pending, 'action-result');
  assert.equal(f.captures, 1); assert.deepEqual(f.events, ['discard', 'action']);
});

test('only one dirty decision is pending and rejected duplicates never replace its action', async () => {
  const f = fixture(), pending = f.gate.run(f.action, f.options);
  assert.equal(await f.gate.run(() => f.events.push('duplicate'), f.options), false);
  assert.equal(f.prompts, 1); assert.deepEqual(f.events, []);
  f.decision.resolve(true); await pending;
  assert.deepEqual(f.events, ['discard', 'action']);
});

test('pending is synchronous and clears for every decision exit without self-denying approval', async () => {
  for (const outcome of ['approve', 'cancel', 'reject', 'throw', 'invalidate', 'deactivate', 'retired', 'changed']) {
    const f = fixture(); assert.equal(f.gate.pending, false);
    if (outcome === 'throw') f.options.confirm = () => { throw new Error('dialog failed'); };
    const pending = f.gate.run(f.action, f.options);
    assert.equal(f.gate.pending, outcome !== 'throw', outcome);
    if (outcome === 'invalidate') f.gate.invalidate();
    if (outcome === 'deactivate') f.gate.deactivate(f.lease);
    if (outcome === 'retired') f.actor.current = false;
    if (outcome === 'changed') f.state.version++;
    if (['invalidate', 'deactivate'].includes(outcome)) assert.equal(f.gate.pending, false, 'synchronous release');
    if (outcome === 'reject') f.decision.reject(new Error('dialog failed'));
    else f.decision.resolve(outcome === 'approve' || outcome === 'retired' || outcome === 'changed');
    assert.equal(await pending, outcome === 'approve' ? 'action-result' : false, outcome);
    assert.equal(f.gate.pending, false, outcome);
    assert.deepEqual(f.events, outcome === 'approve' ? ['discard', 'action'] : [], outcome);
  }
  const clean = fixture({dirty: false});
  assert.equal(clean.gate.run(clean.action, clean.options), 'action-result');
  assert.equal(clean.gate.pending, false);
});

test('every state signature field is checked with Object.is after confirmation', async () => {
  for (const [field, changed] of [
    ['busy', true], ['dirty', false], ['observation', {}], ['epoch', 2],
    ['version', 2], ['visitObservation', {}], ['location', '/producciones?dia=2026-10-26'],
  ]) {
    const f = fixture(), pending = f.gate.run(f.action, f.options);
    f.state[field] = changed;
    assert.equal(f.prompt.isCurrent(), false, field);
    f.decision.resolve(true); assert.equal(await pending, false, field);
    assert.deepEqual(f.events, [], field);
  }
  // Object identity, not JSON equality; Object.is also distinguishes -0/0.
  const f = fixture(); f.state.version = 0;
  const pending = f.gate.run(f.action, f.options); f.state.version = -0;
  f.decision.resolve(true); assert.equal(await pending, false);
  assert.deepEqual(f.events, []);
});

test('actor retirement while a decision is open rejects its eventual approval', async () => {
  const f = fixture(), pending = f.gate.run(f.action, f.options);
  f.actor.current = false; assert.equal(f.prompt.isCurrent(), false);
  f.decision.resolve(true); assert.equal(await pending, false);
  assert.deepEqual(f.events, []);
});

test('obsolete scope releases its own pending latch without aborting a replacement decision', async () => {
  const f = fixture(), pending = f.gate.run(f.action, f.options), oldPrompt = f.prompt;
  assert.equal(f.gate.pending, true);
  f.actor.current = false; f.decision.resolve(true);
  assert.equal(await pending, false); assert.equal(oldPrompt.signal.aborted, true);
  assert.equal(f.gate.pending, false);
  assert.deepEqual(f.events, []);
  f.actor.current = true;
  const replacement = deferred();
  let replacementPrompt;
  const next = f.gate.run(f.action, {...f.options, confirm: prompt => {
    replacementPrompt = prompt; return replacement.promise;
  }});
  assert.equal(replacementPrompt.isCurrent(), true);
  assert.equal(f.gate.pending, true);
  assert.equal(replacementPrompt.signal.aborted, false);
  replacement.resolve(true); assert.equal(await next, 'action-result');
  assert.equal(f.gate.pending, false);
  assert.deepEqual(f.events, ['discard', 'action']);

  const g = fixture(), stale = g.gate.run(g.action, g.options);
  g.gate.invalidate();
  const newer = deferred(); let newerPrompt;
  const current = g.gate.run(g.action, {...g.options, confirm: prompt => {
    newerPrompt = prompt; return newer.promise;
  }});
  g.decision.resolve(true); assert.equal(await stale, false);
  assert.equal(g.gate.pending, true, 'settling an obsolete decision cannot clear the replacement latch');
  assert.equal(newerPrompt.signal.aborted, false); assert.equal(newerPrompt.isCurrent(), true);
  newer.resolve(true); assert.equal(await current, 'action-result');
  assert.equal(g.gate.pending, false);
  assert.deepEqual(g.events, ['discard', 'action']);
});

test('invalidate aborts consent and an edit ABA cannot revive it', async () => {
  const f = fixture(), original = f.state.observation;
  const pending = f.gate.run(f.action, f.options);
  f.state.observation = {}; f.gate.invalidate(); f.state.observation = original;
  assert.equal(f.prompt.signal.aborted, true); assert.equal(f.prompt.isCurrent(), false);
  f.decision.resolve(true); assert.equal(await pending, false);
  assert.deepEqual(f.events, []);
});

test('route ABA with a newer version rejects the old consent even at the original URL', async () => {
  const f = fixture(), original = f.state.location;
  const pending = f.gate.run(f.action, f.options);
  f.state.location = '/producciones?tab=pending'; f.state.version++;
  f.state.location = original; f.state.version++;
  f.decision.resolve(true); assert.equal(await pending, false);
  assert.deepEqual(f.events, []);
});

test('deactivate and activate use distinct leases; stale cleanup cannot retire the new owner', async () => {
  const f = fixture(), pending = f.gate.run(f.action, f.options), oldPrompt = f.prompt;
  f.gate.deactivate(f.lease);
  assert.equal(oldPrompt.signal.aborted, true);
  const freshLease = f.gate.activate(); assert.notEqual(freshLease, f.lease);
  f.gate.deactivate(f.lease);
  f.decision.resolve(true); assert.equal(await pending, false);
  assert.deepEqual(f.events, []);
  f.state.dirty = false;
  assert.equal(f.gate.run(f.action, f.options), 'action-result');
  f.gate.deactivate(freshLease);
  assert.equal(await f.gate.run(f.action, f.options), false);
});

test('cancellation, non-boolean approval and confirmation errors preserve the draft', async () => {
  for (const value of [false, undefined, null, 1, 'true', {}]) {
    const f = fixture(), pending = f.gate.run(f.action, f.options);
    f.decision.resolve(value); assert.equal(await pending, false);
    assert.deepEqual(f.events, []);
    f.state.dirty = false;
    assert.equal(f.gate.run(f.action, f.options), 'action-result', 'pending latch released');
  }
  for (const mode of ['throw', 'reject']) {
    const f = fixture();
    f.options.confirm = () => mode === 'throw'
      ? (() => { throw new Error('dialog failed'); })()
      : Promise.reject(new Error('dialog failed'));
    assert.equal(await f.gate.run(f.action, f.options), false);
    assert.deepEqual(f.events, []);
    f.state.dirty = false; assert.equal(f.gate.run(f.action, f.options), 'action-result');
  }
});

test('capture and state-read errors fail closed without invoking discard or action', async () => {
  for (const field of ['capture', 'readState']) {
    const f = fixture(); f.options[field] = () => { throw new Error('retired'); };
    assert.equal(await f.gate.run(f.action, f.options), false);
    assert.deepEqual(f.events, []); assert.equal(f.prompts, 0);
  }
});

test('retirement during discard prevents an action from using the retired scope', async () => {
  const f = fixture();
  f.options.onDiscard = () => { f.events.push('discard'); f.actor.current = false; };
  const pending = f.gate.run(f.action, f.options); f.decision.resolve(true);
  assert.equal(await pending, false); assert.deepEqual(f.events, ['discard']);
});
