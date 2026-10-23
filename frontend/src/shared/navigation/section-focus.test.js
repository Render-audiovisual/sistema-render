import test from 'node:test';
import assert from 'node:assert/strict';
import { createSectionFocusManager, sectionFocusKey } from './section-focus.js';

// Deliberately small DOM surface, using real EventTarget/Event dispatch. This
// certifies manager protocol/cleanup, not native layout, tab order or AT behavior.
class Element extends EventTarget {
  constructor(tag, doc, attrs = {}) {
    super(); this.tagName = tag; this.doc = doc; this.nodeType = 1; this.attrs = new Map(Object.entries(attrs));
    this.children = []; this.parentElement = null; this.isConnected = true; this.rects = true; this.style = {};
    this.focusCalls = []; this.scrollCalls = [];
  }
  append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } return this; }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  removeAttribute(key) { this.attrs.delete(key); }
  matches(selector) {
    return selector.split(',').some(part => {
      let s = part.trim();
      const negative = [...s.matchAll(/:not\(([^)]+)\)/g)];
      if (negative.some(match => this.matches(match[1]))) return false;
      s = s.replace(/:not\([^)]+\)/g, '');
      const tag = s.match(/^[a-z][a-z0-9-]*/i)?.[0];
      if (tag && tag !== this.tagName) return false;
      for (const match of s.matchAll(/\.([a-z0-9-]+)/gi)) if (!(this.getAttribute('class') ?? '').split(' ').includes(match[1])) return false;
      for (const match of s.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(match[1]) || (match[2] !== undefined && this.getAttribute(match[1]) !== match[2])) return false;
      }
      return true;
    });
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  contains(target) { for (let node = target; node; node = node.parentElement) if (node === this) return true; return false; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  getClientRects() { return this.rects ? [{}] : []; }
  focus(options) {
    this.focusCalls.push(options);
    if (this.failFocus) return;
    const old = this.doc.activeElement; this.doc.activeElement = this;
    if (old && old !== this) old.dispatchEvent(new Event('blur'));
    this.doc.dispatchFrom('focusin', this);
    this.afterFocus?.();
  }
  scrollIntoView(options) { this.scrollCalls.push(options); }
}
class TrackedTarget extends EventTarget {
  constructor() { super(); this.listeners = new Map(); }
  addEventListener(type, fn, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn); super.addEventListener(type, fn, options);
  }
  removeEventListener(type, fn, options) { this.listeners.get(type)?.delete(fn); super.removeEventListener(type, fn, options); }
  get listenerCount() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
  dispatchFrom(type, target) { const event = new Event(type); Object.defineProperty(event, 'target', { value: target }); this.dispatchEvent(event); }
}
function fixture({ loading = false, heading = true, observerFailure } = {}) {
  const doc = new TrackedTarget(), win = new TrackedTarget();
  doc.hidden = false; doc.visibilityState = 'visible';
  const timers = new Map(); let nextTimer = 0, live = true;
  win.getComputedStyle = node => node.style;
  win.setTimeout = (fn, delay) => { assert.equal(delay, 3000); timers.set(++nextTimer, fn); return nextTimer; };
  win.clearTimeout = id => timers.delete(id);
  const element = (tag, attrs) => new Element(tag, doc, attrs);
  const root = element('div'), nav = element('nav'), marker = element('span', { hidden: '', id: 'render-main-content' });
  const main = element('main'), title = element('h1'), fallback = element('main', { class: 'route-loading' });
  if (heading) main.append(title);
  root.append(nav, marker, loading ? fallback : main);
  doc.querySelectorAll = selector => root.querySelectorAll(selector);
  doc.activeElement = nav;
  const observers = [];
  const observerFactory = callback => {
    if (observerFailure === 'construct') throw Error('observer unavailable');
    const observer = { disconnected: false, observeCalls: [],
      observe(node, options) { this.observeCalls.push([node, options]); if (observerFailure === 'observe') throw Error('observe failed'); },
      disconnect() { this.disconnected = true; }, fire() { callback([]); } };
    observers.push(observer); return observer;
  };
  const manager = createSectionFocusManager({ documentTarget: doc, windowTarget: win,
    readMarker: () => marker, isCurrent: () => live, observerFactory });
  const load = () => { root.children[root.children.indexOf(fallback)] = main; main.parentElement = root; fallback.parentElement = null; fallback.isConnected = false; };
  const clean = () => {
    assert.equal(doc.listenerCount + win.listenerCount, 0); assert.equal(timers.size, 0);
    assert.ok(observers.every(observer => observer.disconnected));
  };
  return { doc, win, root, nav, marker, main, title, fallback, element, manager, observers, timers, load, clean,
    retire: () => { live = false; } };
}

test('section key ignores query/hash navigation except actual clientes gestion mode', () => {
  for (const path of ['/workspace/tareas', '/producciones', '/feedback', '/clientes']) {
    assert.equal(sectionFocusKey(path, '?task=3&pagina=2#x'), path);
    assert.equal(sectionFocusKey(path, '?q=hello&board_column=finalizadas'), path);
  }
  assert.equal(sectionFocusKey('/clientes', '?gestion=1&cliente=9'), '/clientes?gestion=1');
  assert.equal(sectionFocusKey('/clientes', '?gestion=0'), '/clientes');
  assert.equal(sectionFocusKey('/clientes', '?gestion=01'), '/clientes');
  assert.equal(sectionFocusKey('/clientes', '?gestion=1&gestion=0'), '/clientes?gestion=1', 'Same first-value route rule as App');
  assert.notEqual(sectionFocusKey('/proyectos'), sectionFocusKey('/producciones'));
});

test('automatic focus prefers heading after marker, excludes Sidebar and never scrolls', () => {
  const f = fixture(); const earlier = f.element('main').append(f.element('h1'));
  f.nav.append(earlier);
  assert.equal(f.manager.request(), true); assert.equal(f.doc.activeElement, f.title);
  assert.deepEqual(f.title.focusCalls, [{ preventScroll: true }]); assert.deepEqual(f.title.scrollCalls, []);
  assert.equal(f.title.getAttribute('tabindex'), '-1');
  assert.equal(f.title.getAttribute('data-render-section-focus-target'), ''); f.clean();
  f.title.dispatchEvent(new Event('blur'));
  assert.equal(f.title.hasAttribute('tabindex'), false); assert.equal(f.title.hasAttribute('data-render-section-focus-target'), false);
});

test('nested workspace role main and generic loading data main are usable without waiting', () => {
  const f = fixture({ heading: false });
  const shell = f.element('div', { class: 'render-workspace' }), nested = f.element('section', { role: 'main', class: 'ros-main' });
  f.root.children.pop(); f.root.append(shell.append(nested));
  assert.equal(f.manager.request(), true); assert.equal(f.doc.activeElement, nested); assert.equal(f.observers.length, 0);
  f.manager.dispose(); f.clean();
  const g = fixture({ heading: false });
  assert.equal(g.manager.request(), true); assert.equal(g.doc.activeElement, g.main);
  g.main.append(g.title); assert.equal(g.doc.activeElement, g.main, 'Data insertion does not move focus again');
});

test('hidden/inert/nav/dialog headings excluded; existing tabindex and JSX-owned changes preserved', () => {
  const f = fixture();
  f.main.children = [];
  for (const attrs of [{ hidden: '' }, { inert: '' }, { 'aria-hidden': 'true' }]) f.main.append(f.element('div', attrs).append(f.element('h1')));
  f.main.append(f.element('nav').append(f.element('h1')), f.element('section', { role: 'navigation' }).append(f.element('h1')),
    f.element('dialog').append(f.element('h1')), f.title);
  f.title.setAttribute('tabindex', '0'); f.title.setAttribute('data-render-section-focus-target', 'jsx');
  assert.equal(f.manager.request(), true); f.manager.dispose();
  assert.equal(f.title.getAttribute('tabindex'), '0'); assert.equal(f.title.getAttribute('data-render-section-focus-target'), 'jsx');
  const g = fixture(); g.manager.request();
  g.title.setAttribute('tabindex', '0'); g.title.setAttribute('data-render-section-focus-target', 'updated-jsx');
  g.manager.dispose();
  assert.equal(g.title.getAttribute('tabindex'), '0'); assert.equal(g.title.getAttribute('data-render-section-focus-target'), 'updated-jsx');
});

test('explicit skip may leave an interactive control, focuses before scrolling and never mutates URL/history', () => {
  const f = fixture(); const input = f.element('input'); f.main.append(input); f.doc.activeElement = input;
  for (const key of ['location', 'history']) Object.defineProperty(f.win, key, { get() { throw Error('Focus must not access URL/history'); } });
  assert.equal(f.manager.request(), false); assert.equal(f.doc.activeElement, input);
  let scrolled = false;
  f.title.scrollIntoView = options => { assert.equal(f.doc.activeElement, f.title); assert.deepEqual(options, { block: 'start', behavior: 'auto' }); scrolled = true; };
  assert.equal(f.manager.request({ explicit: true }), true); assert.equal(scrolled, true); f.clean();
});

test('global fallback waits once without a clock cutoff, then focuses real main and releases observer/listeners', () => {
  const f = fixture({ loading: true }); assert.equal(f.manager.request(), true);
  assert.equal(f.doc.activeElement, f.nav); assert.equal(f.observers.length, 1); assert.equal(f.timers.size, 0);
  f.observers[0].fire(); assert.equal(f.observers.length, 1); assert.equal(f.title.focusCalls.length, 0);
  f.load(); f.observers[0].fire(); assert.equal(f.doc.activeElement, f.title); f.clean();
  f.observers[0].fire(); assert.equal(f.title.focusCalls.length, 1, 'Late callback cannot refocus');
});

test('absent real main without global fallback never waits; inaccessible main cannot receive focus', () => {
  for (const change of [f => { f.main.isConnected = false; }, f => { f.main.setAttribute('hidden', ''); },
    f => { f.main.style.display = 'none'; }, f => { f.main.style.visibility = 'hidden'; }, f => { f.main.rects = false; }]) {
    const f = fixture(); change(f); assert.equal(f.manager.request(), false); assert.equal(f.observers.length, 0); f.clean();
  }
});

test('automatic pending intent cancels on pointer, keyboard, meaningful focus, blur and document hiding', () => {
  for (const type of ['pointerdown', 'keydown', 'focusin', 'blur', 'visibilitychange']) {
    const f = fixture({ loading: true }); f.manager.request();
    if (type === 'blur') f.win.dispatchEvent(new Event('blur'));
    else if (type === 'visibilitychange') { f.doc.hidden = true; f.doc.dispatchEvent(new Event(type)); f.doc.hidden = false; }
    else f.doc.dispatchFrom(type, type === 'focusin' ? f.element('button') : f.nav);
    f.load(); f.observers[0].fire(); assert.equal(f.title.focusCalls.length, 0); f.clean();
  }
});

test('noninteractive focus does not cancel waiting but a visible modal cancels permanently, not until close', () => {
  const f = fixture({ loading: true }); f.manager.request(); f.doc.dispatchFrom('focusin', f.element('span'));
  const modal = f.element('dialog', { open: '' }); f.root.append(modal); f.observers[0].fire();
  modal.removeAttribute('open'); f.load(); f.observers[0].fire();
  assert.equal(f.title.focusCalls.length, 0); f.clean();
  for (const attrs of [{ open: '' }, { role: 'dialog', 'aria-modal': 'true' }]) {
    const g = fixture(); g.root.append(g.element(attrs.open === '' ? 'dialog' : 'section', attrs));
    assert.equal(g.manager.request({ explicit: true }), false); assert.equal(g.title.focusCalls.length, 0); g.clean();
  }
  const g = fixture(); g.root.append(g.element('dialog', { open: '', hidden: '' }));
  assert.equal(g.manager.request(), true, 'Hidden dialog is not a visible modal');
});

test('render-time retired owner cannot focus on late mutation, explicit request, or dispose cleanup', () => {
  const f = fixture({ loading: true }); f.manager.request(); f.retire(); f.load(); f.observers[0].fire();
  assert.equal(f.title.focusCalls.length, 0); assert.equal(f.manager.request({ explicit: true }), false); f.clean();
  f.manager.dispose(); assert.equal(f.title.focusCalls.length, 0);
  const g = fixture(); g.manager.request(); g.manager.dispose();
  assert.equal(g.title.focusCalls.length, 1); assert.equal(g.title.hasAttribute('tabindex'), false);
  assert.equal(g.manager.request(), false); g.clean();
});

test('replacement request releases the previous observer; disposed StrictMode instance stays retired', () => {
  const f = fixture({ loading: true }); f.manager.request(); f.manager.request();
  assert.equal(f.observers.length, 2); assert.equal(f.observers[0].disconnected, true); assert.equal(f.timers.size, 0);
  f.load(); f.observers[1].fire(); f.clean(); assert.equal(f.title.focusCalls.length, 1);
  const old = fixture({ loading: true }); old.manager.request(); old.manager.dispose(); old.load(); old.observers[0].fire(); old.clean();
  assert.equal(old.title.focusCalls.length, 0);
  const fresh = fixture(); assert.equal(fresh.manager.request(), true, 'Fresh setup gets its own live manager');
});

test('mobile menu blocks explicit focus and permanently cancels delayed focus, while hidden desktop toggle does not', () => {
  const f = fixture({ loading: true }); f.manager.request();
  const toggle = f.element('button', { class: 'sidebar-menu-toggle', 'aria-expanded': 'true' });
  f.nav.append(toggle); f.observers[0].fire();
  toggle.setAttribute('aria-expanded', 'false'); f.load(); f.observers[0].fire();
  assert.equal(f.title.focusCalls.length, 0); f.clean();
  toggle.setAttribute('aria-expanded', 'true'); assert.equal(f.manager.request({ explicit: true }), false);
  toggle.style.display = 'none'; assert.equal(f.manager.request(), true); assert.equal(f.title.focusCalls.length, 1);
});

test('late cleanup of another manager cannot strip the new decoration on a reused heading', () => {
  const f = fixture(); f.manager.request();
  const replacement = createSectionFocusManager({ documentTarget: f.doc, windowTarget: f.win,
    readMarker: () => f.marker, isCurrent: () => true, observerFactory: () => assert.fail('no observer needed') });
  replacement.request({ explicit: true }); f.manager.dispose();
  assert.equal(f.title.getAttribute('tabindex'), '-1'); assert.equal(f.title.getAttribute('data-render-section-focus-target'), '');
  replacement.dispose(); assert.equal(f.title.hasAttribute('tabindex'), false); assert.equal(f.title.hasAttribute('data-render-section-focus-target'), false); f.clean();
});

test('observer construction/observe failure, rejected focus and owner withdrawal during focus fail closed with cleanup', () => {
  for (const observerFailure of ['construct', 'observe']) {
    const f = fixture({ loading: true, observerFailure }); assert.equal(f.manager.request(), false); f.clean();
  }
  const f = fixture(); f.title.failFocus = true;
  assert.equal(f.manager.request(), false); assert.equal(f.title.hasAttribute('tabindex'), false); f.clean();
  const g = fixture(); g.title.afterFocus = g.retire;
  assert.equal(g.manager.request({ explicit: true }), false); assert.equal(g.title.scrollCalls.length, 0); g.clean();
});
