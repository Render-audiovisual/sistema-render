import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureProductionMediaFocus } from './productionMediaFocus.js';

// Simulated DOM only, with real helper; no browser focus/scroll claim.
function fixture(kind = 'video') {
  const calls = [], members = new Set(); let lifetime = {}, currentLifetime = lifetime;
  const style = { display: 'block', visibility: 'visible' };
  const registered = new Set();
  const trackedTarget = () => {
    const node = new EventTarget(), add = node.addEventListener.bind(node), remove = node.removeEventListener.bind(node);
    node.addEventListener = (type, listener, capture) => { registered.add({ node, type, listener, capture }); add(type, listener, capture); };
    node.removeEventListener = (type, listener, capture) => { for (const record of registered) if (record.node === node && record.type === type && record.listener === listener && record.capture === capture) registered.delete(record); remove(type, listener, capture); };
    return node;
  };
  const doc = trackedTarget(), win = trackedTarget();
  Object.assign(doc, { hidden: false, visibilityState: 'visible', defaultView: win, hasFocus: () => true, querySelectorAll: () => [] });
  win.getComputedStyle = node => node.style || style;
  const node = tagName => ({ nodeType: 1, tagName, ownerDocument: doc, isConnected: true, parentElement: null, style: { ...style } });
  doc.body = node('BODY');
  const form = { ...node('FORM'), contains: element => members.has(element) };
  const submit = { ...node('BUTTON'), disabled: false }; members.add(form); members.add(submit);
  const target = { ...node('BUTTON'), kind, disabled: false, matches: () => false, closest: () => null, getClientRects: () => [{}],
    focus(options) { calls.push(options); doc.activeElement = target; } };
  doc.activeElement = submit;
  const options = { form, target, documentTarget: doc, isCurrent: () => currentLifetime === lifetime };
  return { options, doc, win, form, submit, target, calls, members, node, registered,
    send(type, target = doc.body, destination = doc) { const event = new Event(type); Object.defineProperty(event, 'target', { value: target }); destination.dispatchEvent(event); },
    capture: () => captureProductionMediaFocus(options),
    removeForm() { form.isConnected = false; submit.isConnected = false; },
    replaceOwner() { currentLifetime = {}; },
    returnSameIdentityWithNewObservation() { lifetime = {}; currentLifetime = {}; } };
}

test('video/photo confirmed ACK handoff focuses original add button exactly once with preventScroll', () => {
  for (const kind of ['video', 'photo']) {
    const f = fixture(kind), intent = f.capture(); assert.deepEqual(Object.keys(intent).sort(), ['confirm', 'dispose', 'restore']);
    assert.deepEqual(f.calls, []); assert.equal(intent.confirm(), true); f.removeForm(); f.doc.activeElement = f.doc.body;
    assert.equal(intent.restore(), true); assert.deepEqual(f.calls, [{ preventScroll: true }]); assert.equal(f.doc.activeElement, f.target);
    assert.equal(intent.confirm(), false); assert.equal(intent.restore(), false); intent.dispose(); assert.deepEqual(f.calls, [{ preventScroll: true }]);
  }
});
test('capture requires active inside real connected form, never initial body/outside or missing authority', () => {
  for (const mode of ['body', 'outside', 'null-active', 'missing-current', 'false-current', 'throw-current', 'detached', 'wrong-form', 'wrong-document']) {
    const f = fixture();
    if (mode === 'body') f.doc.activeElement = f.doc.body;
    if (mode === 'outside') f.doc.activeElement = f.node('INPUT');
    if (mode === 'null-active') f.doc.activeElement = null;
    if (mode === 'missing-current') f.options.isCurrent = undefined;
    if (mode === 'false-current') f.options.isCurrent = () => false;
    if (mode === 'throw-current') f.options.isCurrent = () => { throw Error('retired'); };
    if (mode === 'detached') f.form.isConnected = false;
    if (mode === 'wrong-form') f.form.tagName = 'DIV';
    if (mode === 'wrong-document') f.form.ownerDocument = {};
    const intent = f.capture(); assert.equal(intent.confirm(), false, mode); f.removeForm(); f.doc.activeElement = f.doc.body; assert.equal(intent.restore(), false, mode); assert.deepEqual(f.calls, []);
  }
  const absent = captureProductionMediaFocus(); assert.equal(absent.confirm(), false); assert.equal(absent.restore(), false); assert.doesNotThrow(absent.dispose);
});
test('body after disabled submit is permitted only after a valid capture; disconnected original input may also restore', () => {
  for (const active of ['body', 'submit', 'form']) {
    const f = fixture(), intent = f.capture(); f.submit.disabled = true; f.doc.activeElement = f.doc.body;
    assert.equal(intent.confirm(), true); f.removeForm(); f.doc.activeElement = active === 'body' ? f.doc.body : f[active];
    assert.equal(intent.restore(), true, active); assert.equal(f.calls.length, 1);
  }
});
test('ACK confirmation tolerates busy-disabled add button until commit, but restoration still requires enabled target', () => {
  for (const disabledVia of ['property', 'fieldset']) for (const enabledAtRestore of [true, false]) {
    const f = fixture(), intent = f.capture();
    if (disabledVia === 'property') f.target.disabled = true;
    else f.target.matches = () => true;
    f.doc.activeElement = f.doc.body;
    assert.equal(intent.confirm(), true, `Transient ${disabledVia} cannot cancel validated ACK handoff`);
    f.removeForm();
    if (enabledAtRestore) { f.target.disabled = false; f.target.matches = () => false; }
    assert.equal(intent.restore(), enabledAtRestore);
    assert.deepEqual(f.calls, enabledAtRestore ? [{ preventScroll: true }] : []);
    assert.equal(intent.restore(), false);
  }
});
test('user move outside original form before confirm cancels permanently, even if focus later returns to body', () => {
  const f = fixture(), intent = f.capture(), outside = f.node('INPUT'); f.doc.activeElement = outside;
  assert.equal(intent.confirm(), false); f.doc.activeElement = f.doc.body; assert.equal(intent.confirm(), false);
  f.removeForm(); assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
});
test('newly focused outside control after confirm is never stolen; a reparented original input is outside too', () => {
  for (const reparent of [false, true]) {
    const f = fixture(), intent = f.capture(); assert.equal(intent.confirm(), true); f.removeForm();
    if (reparent) { f.members.delete(f.submit); f.submit.isConnected = true; f.doc.activeElement = f.submit; }
    else f.doc.activeElement = f.node('INPUT');
    assert.equal(intent.restore(), false); f.doc.activeElement = f.doc.body; assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
  }
});
test('restore before form disconnect fails closed and cannot retry later; no confirm means no focus', () => {
  const f = fixture(), intent = f.capture(); assert.equal(intent.restore(), false); assert.equal(intent.confirm(), true);
  assert.equal(intent.restore(), false); f.removeForm(); f.doc.activeElement = f.doc.body; assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
  const g = fixture(), unconfirmed = g.capture(); g.removeForm(); g.doc.activeElement = g.doc.body; assert.equal(unconfirmed.restore(), false); assert.equal(unconfirmed.confirm(), false); assert.deepEqual(g.calls, []);
});
test('owner change/ABA at confirmation or restoration cannot focus a new detail', () => {
  for (const stage of ['confirm', 'restore']) for (const aba of [false, true]) {
    const f = fixture(), intent = f.capture(); if (stage === 'restore') assert.equal(intent.confirm(), true);
    if (aba) f.returnSameIdentityWithNewObservation(); else f.replaceOwner();
    if (stage === 'confirm') assert.equal(intent.confirm(), false);
    f.removeForm(); f.doc.activeElement = f.doc.body; assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
  }
});
const invalidateTarget = (f, mode) => {
  if (mode === 'removed') f.target.isConnected = false;
  if (mode === 'disabled') f.target.disabled = true;
  if (mode === 'fieldset') f.target.matches = () => true;
  if (mode === 'hidden' || mode === 'inert' || mode === 'aria-hidden') f.target.closest = () => ({});
  if (mode === 'display') f.target.style.display = 'none';
  if (mode === 'visibility') f.target.style.visibility = 'hidden';
  if (mode === 'ancestor') f.target.parentElement = { ...f.node('DIV'), style: { display: 'none', visibility: 'visible' } };
  if (mode === 'no-rect') f.target.getClientRects = () => [];
  if (mode === 'wrong-document') f.target.ownerDocument = {};
  if (mode === 'not-button') f.target.tagName = 'DIV';
  if (mode === 'unsupported') f.doc.defaultView = null;
};
test('target removed/hidden/inert/disabled or unsupported DOM prevents capture and restore without focus', () => {
  for (const mode of ['removed', 'disabled', 'fieldset', 'hidden', 'inert', 'aria-hidden', 'display', 'visibility', 'ancestor', 'no-rect', 'wrong-document', 'not-button', 'unsupported']) for (const stage of ['capture', 'restore']) {
    const f = fixture(); if (stage === 'capture') invalidateTarget(f, mode);
    const intent = f.capture(), confirmed = intent.confirm(); assert.equal(confirmed, stage !== 'capture', `${stage}/${mode}`);
    if (stage === 'restore') invalidateTarget(f, mode);
    f.removeForm(); f.doc.activeElement = f.doc.body; assert.equal(intent.restore(), false, `${stage}/${mode}`); assert.deepEqual(f.calls, []);
  }
});
test('hidden document cancels capture/confirm/restore and visibility recovery cannot revive consumed intent', () => {
  for (const stage of ['capture', 'confirm', 'restore']) for (const property of ['hidden', 'visibilityState']) {
    const f = fixture(); const hide = () => { f.doc[property] = property === 'hidden' ? true : 'hidden'; };
    if (stage === 'capture') hide(); const intent = f.capture();
    if (stage === 'confirm') hide(); assert.equal(intent.confirm(), stage === 'restore');
    if (stage === 'restore') hide(); f.removeForm(); f.doc.activeElement = f.doc.body; assert.equal(intent.restore(), false);
    f.doc.hidden = false; f.doc.visibilityState = 'visible'; assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
  }
});
test('dispose never focuses, duplicate confirmation does not invalidate confirmed intent and reentrant restore is one-shot', () => {
  for (const confirmed of [false, true]) {
    const f = fixture(), intent = f.capture(); if (confirmed) intent.confirm(); intent.dispose(); intent.dispose(); f.removeForm(); f.doc.activeElement = f.doc.body;
    assert.equal(intent.confirm(), false); assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
  }
  const f = fixture(), intent = f.capture(); assert.equal(intent.confirm(), true); assert.equal(intent.confirm(), false);
  f.removeForm(); f.doc.activeElement = f.doc.body;
  f.target.focus = options => { f.calls.push(options); assert.equal(intent.restore(), false); f.doc.activeElement = f.target; };
  assert.equal(intent.restore(), true); assert.equal(f.calls.length, 1);
});
test('focus throw/no activeElement change fails once, without tabindex edits or scrolling side effects', () => {
  for (const throws of [false, true]) {
    const f = fixture(), attributes = { tabindex: '0' }, intent = f.capture(); f.target.attributes = attributes;
    f.target.setAttribute = f.target.removeAttribute = f.target.scrollIntoView = () => assert.fail('No decoration or scroll mutation');
    f.target.focus = options => { f.calls.push(options); if (throws) throw Error('cannot focus'); };
    assert.equal(intent.confirm(), true); f.removeForm(); f.doc.activeElement = f.doc.body;
    assert.doesNotThrow(() => assert.equal(intent.restore(), false)); assert.equal(intent.restore(), false); assert.deepEqual(f.calls, [{ preventScroll: true }]); assert.deepEqual(attributes, { tabindex: '0' });
  }
  const source = readFileSync(new URL('./productionMediaFocus.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setTimeout|setInterval|MutationObserver|localStorage|sessionStorage|fetch\(|setAttribute|removeAttribute/);
});
test('outside focus then body cannot revive intent; body-only fallback and inside-form focus remain allowed', () => {
  for (const confirmed of [false, true]) {
    const f = fixture(), intent = f.capture(); assert.equal(f.registered.size, 5);
    if (confirmed) assert.equal(intent.confirm(), true);
    const outside = f.node('INPUT'); f.doc.activeElement = outside; f.send('focusin', outside);
    assert.equal(f.registered.size, 0); f.doc.activeElement = f.doc.body; f.send('focusin');
    assert.equal(intent.confirm(), false); f.removeForm(); assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
  }
  const f = fixture(), intent = f.capture(); f.send('focusin', f.submit); f.doc.activeElement = f.doc.body; f.send('focusin');
  assert.equal(f.registered.size, 5); assert.equal(intent.confirm(), true); f.removeForm(); assert.equal(intent.restore(), true); assert.equal(f.registered.size, 0);
});
test('subsequent pointer/key activity, window blur and temporary hidden document cancel permanently with exact cleanup', () => {
  for (const kind of ['pointerdown', 'keydown', 'blur', 'hidden', 'visibility']) for (const confirmed of [false, true]) {
    const f = fixture(), intent = f.capture(); if (confirmed) assert.equal(intent.confirm(), true);
    if (kind === 'blur') f.send('blur', f.win, f.win);
    else if (kind === 'hidden' || kind === 'visibility') {
      if (kind === 'hidden') f.doc.hidden = true; else f.doc.visibilityState = 'hidden';
      f.send('visibilitychange'); f.doc.hidden = false; f.doc.visibilityState = 'visible';
    } else f.send(kind, f.submit);
    assert.equal(f.registered.size, 0, kind); f.doc.activeElement = f.doc.body;
    assert.equal(intent.confirm(), false); f.removeForm(); assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
  }
});
test('window capture listener ignores descendant submit blur from disabling; actual window blur still cancels', () => {
  for (const confirmed of [false, true]) {
    const f = fixture(), intent = f.capture();
    if (confirmed) assert.equal(intent.confirm(), true);
    f.submit.disabled = true; f.doc.activeElement = f.doc.body;
    f.send('blur', f.submit, f.win);
    assert.equal(f.registered.size, 5, 'Captured descendant blur is not loss of window focus');
    if (!confirmed) assert.equal(intent.confirm(), true);
    f.removeForm(); assert.equal(intent.restore(), true); assert.deepEqual(f.calls, [{ preventScroll: true }]); assert.equal(f.registered.size, 0);
  }
  const f = fixture(), intent = f.capture(); f.send('blur', f.win, f.win);
  assert.equal(f.registered.size, 0); f.doc.activeElement = f.doc.body;
  assert.equal(intent.confirm(), false); f.removeForm(); assert.equal(intent.restore(), false); assert.deepEqual(f.calls, []);
});
test('visible modal and document hasFocus false deny handoff, while hidden modal is not an overlay', () => {
  for (const mode of ['modal', 'unfocused']) for (const stage of ['capture', 'confirm', 'restore']) {
    const f = fixture(), modal = { ...f.node('DIALOG'), closest: () => null, getClientRects: () => [{}] };
    const block = () => { if (mode === 'modal') f.doc.querySelectorAll = () => [modal]; else f.doc.hasFocus = () => false; };
    if (stage === 'capture') block(); const intent = f.capture();
    if (stage === 'confirm') block(); assert.equal(intent.confirm(), stage === 'restore');
    if (stage === 'restore') block(); f.removeForm(); f.doc.activeElement = f.doc.body;
    assert.equal(intent.restore(), false); assert.equal(f.registered.size, 0); assert.deepEqual(f.calls, []);
  }
  const f = fixture(), modal = { ...f.node('DIV'), closest: () => null, getClientRects: () => [], style: { display: 'none', visibility: 'visible' } };
  f.doc.querySelectorAll = () => [modal]; const intent = f.capture(); assert.equal(intent.confirm(), true); f.removeForm(); f.doc.activeElement = f.doc.body; assert.equal(intent.restore(), true);
});
test('listeners stop on success, failure and dispose before own focusin, including reentrant cleanup', () => {
  for (const mode of ['success', 'focus-throw', 'dispose', 'confirm-reject', 'restore-reject']) {
    const f = fixture(), intent = f.capture(); assert.equal(f.registered.size, 5);
    if (mode === 'dispose') intent.dispose();
    else if (mode === 'confirm-reject') { f.doc.activeElement = f.node('INPUT'); assert.equal(intent.confirm(), false); }
    else {
      assert.equal(intent.confirm(), true); f.removeForm(); f.doc.activeElement = f.doc.body;
      if (mode === 'restore-reject') f.target.disabled = true;
      f.target.focus = options => { assert.equal(f.registered.size, 0); f.calls.push(options); f.doc.activeElement = f.target; f.send('focusin', f.target); if (mode === 'focus-throw') throw Error('focus'); };
      assert.equal(intent.restore(), mode === 'success');
    }
    assert.equal(f.registered.size, 0, mode); intent.dispose(); assert.equal(intent.restore(), false);
  }
});
