import test from "node:test";
import assert from "node:assert/strict";
import { readRouteKey, navigateWithinApp } from "./location.js";

// Self-contained protocol doubles, not a browser/jsdom or mounted App test.
class FakeEvent {
  constructor(type, { cancelable = false } = {}) { this.type = type; this.cancelable = cancelable; this.defaultPrevented = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}
class FakeCustomEvent extends FakeEvent {
  constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
}
class FakePopStateEvent extends FakeEvent {
  constructor(type, options = {}) { super(type, options); this.state = options.state; }
}
class FakeEventTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    event.target = this;
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener.call(this, event);
    return !event.defaultPrevented;
  }
}
class FakeWindow extends FakeEventTarget {
  constructor(href = "https://render.test/proyectos?proyecto=uno#detalle") {
    super();
    this.location = new URL(href);
    this.CustomEvent = FakeCustomEvent;
    this.PopStateEvent = FakePopStateEvent;
    this.trace = [];
    this.entries = [{ href: this.location.href, state: { previous: true } }];
    const win = this;
    this.history = {
      get state() { return win.entries.at(-1).state; },
      pushState(state, title, relative) {
        const next = new URL(relative, win.location.href);
        assert.equal(next.origin, win.location.origin, "Fake history cannot push cross-origin URLs");
        win.trace.push({ kind: "push", state, title, relative });
        win.entries.push({ href: next.href, state });
        win.location = next;
      },
    };
  }
  dispatchEvent(event) {
    this.trace.push({ kind: "event", event, route: readRouteKey(this) });
    return super.dispatchEvent(event);
  }
  scrollTo(options) { this.trace.push({ kind: "scroll", options }); }
}

test("readRouteKey includes pathname, query and hash without changing history or notifying", () => {
  const win = new FakeWindow();
  assert.equal(readRouteKey(win), "/proyectos?proyecto=uno#detalle");
  win.location = new URL("https://render.test/proyectos?proyecto=dos#etapas");
  assert.equal(readRouteKey(win), "/proyectos?proyecto=dos#etapas");
  assert.equal(win.trace.length, 0);
  assert.equal(win.entries.length, 1);
  assert.equal(readRouteKey(new FakeWindow("https://render.test/inicio")), "/inicio");
});

test("valid navigation orders cancellable before-event, history, popstate and scroll with the updated URL/state", () => {
  const win = new FakeWindow(), observed = [];
  const initialState = win.history.state;
  win.addEventListener("render:before-navigation", event => {
    assert.ok(event instanceof FakeCustomEvent);
    assert.equal(event.cancelable, true);
    assert.deepEqual(event.detail, { href: "/clientes?gestion=1#cuentas" });
    assert.equal(readRouteKey(win), "/proyectos?proyecto=uno#detalle");
    assert.equal(win.history.state, initialState);
    observed.push("before");
  });
  win.addEventListener("popstate", event => {
    assert.ok(event instanceof FakePopStateEvent);
    assert.equal(readRouteKey(win), "/clientes?gestion=1#cuentas");
    assert.equal(event.state, win.history.state);
    assert.deepEqual(event.state, {});
    observed.push("popstate");
  });
  assert.equal(navigateWithinApp(win, "https://render.test/clientes?gestion=1#cuentas"), true);
  assert.deepEqual(observed, ["before", "popstate"]);
  assert.deepEqual(win.trace.map(call => call.kind === "event" ? call.event.type : call.kind), ["render:before-navigation", "push", "popstate", "scroll"]);
  assert.deepEqual(win.trace[1], { kind: "push", state: {}, title: "", relative: "/clientes?gestion=1#cuentas" });
  assert.deepEqual(win.trace[3].options, { top: 0, behavior: "auto" });
  assert.deepEqual(initialState, { previous: true });
  assert.equal(win.entries.length, 2);
});

test("same-path query and hash changes each notify and update stateful history, rather than disappearing behind pathname equality", () => {
  const win = new FakeWindow("https://render.test/proyectos?proyecto=uno#detalle"), seen = [];
  win.addEventListener("popstate", () => seen.push(readRouteKey(win)));
  assert.equal(navigateWithinApp(win, "?proyecto=dos#detalle"), true);
  assert.equal(navigateWithinApp(win, "#etapas"), true);
  assert.equal(navigateWithinApp(win, "?proyecto=dos"), true);
  assert.deepEqual(seen, ["/proyectos?proyecto=dos#detalle", "/proyectos?proyecto=dos#etapas", "/proyectos?proyecto=dos"]);
  assert.equal(win.entries.length, 4);
  assert.equal(win.trace.filter(call => call.kind === "scroll").length, 3);
  assert.equal(win.location.pathname, "/proyectos");
});

test("a canceled before-event returns false without history, popstate, URL, state or scroll mutation", () => {
  const win = new FakeWindow(), before = win.location.href, initialState = win.history.state;
  const prevent = event => event.preventDefault();
  win.addEventListener("render:before-navigation", prevent);
  assert.equal(navigateWithinApp(win, "/inicio"), false);
  assert.equal(win.location.href, before);
  assert.equal(win.history.state, initialState);
  assert.equal(win.entries.length, 1);
  assert.equal(win.trace.length, 1);
  assert.equal(win.trace[0].event.type, "render:before-navigation");
  assert.equal(win.trace[0].event.defaultPrevented, true);
  assert.deepEqual(win.trace[0].event.detail, { href: "/inicio" });
  win.removeEventListener("render:before-navigation", prevent);
  assert.equal(navigateWithinApp(win, "/inicio"), true, "An explicit later attempt can succeed; helper never retries itself");
});

test("exact same normalized URL is a complete no-op, both initially and after a successful navigation", () => {
  const win = new FakeWindow();
  for (const href of [win.location.href, "/proyectos?proyecto=uno#detalle", "https://render.test:443/proyectos?proyecto=uno#detalle"]) {
    assert.equal(navigateWithinApp(win, href), false);
    assert.deepEqual(win.trace, []);
    assert.equal(win.entries.length, 1);
  }
  assert.equal(navigateWithinApp(win, "/inicio"), true);
  const traceLength = win.trace.length;
  assert.equal(navigateWithinApp(win, "/inicio"), false);
  assert.equal(win.trace.length, traceLength);
  assert.equal(win.entries.length, 2);
});

test("invalid inputs, unsupported protocols, off-origin URLs and embedded credentials reject before any event or write", () => {
  const rejected = [undefined, null, false, 1, {}, [], new String("/inicio"), "", " \t\n ",
    "http://[", "https://", "https://render.test:invalid/inicio", "javascript:alert(1)", "data:text/plain,x", "mailto:user@example.test", "file:///private/tmp/test", "ftp://render.test/inicio",
    "https://other.test/inicio", "//other.test/inicio", "http://render.test/inicio", "https://render.test:444/inicio", "https://render.test.other.test/inicio",
    "https://name:password@render.test/inicio", "https://name@render.test/inicio", "https://:password@render.test/inicio", "//name:password@render.test/inicio", "https://render.test@other.test/inicio"];
  for (const href of rejected) {
    const win = new FakeWindow(), before = win.location.href, state = win.history.state;
    assert.equal(navigateWithinApp(win, href), false, `Reject ${String(href)}`);
    assert.deepEqual(win.trace, []);
    assert.equal(win.entries.length, 1);
    assert.equal(win.location.href, before);
    assert.equal(win.history.state, state);
  }
});

test("safe root-, path-, query-, hash- and protocol-relative same-origin URLs resolve to relative history targets", () => {
  const cases = [
    ["/inicio", "/inicio"], ["../inicio", "/inicio"],
    ["./tareas?task=2#contenido", "/workspace/tareas?task=2#contenido"],
    ["?task=2", "/workspace/tareas?task=2"], ["#contenido", "/workspace/tareas?task=1#contenido"],
    ["//render.test/inicio", "/inicio"], ["https://render.test/inicio", "/inicio"],
  ];
  for (const [href, expected] of cases) {
    const win = new FakeWindow("https://render.test/workspace/tareas?task=1");
    assert.equal(navigateWithinApp(win, href), true);
    assert.equal(readRouteKey(win), expected);
    assert.equal(win.trace[1].relative, expected);
    assert.deepEqual(win.trace[0].event.detail, { href: expected });
  }
  const http = new FakeWindow("http://render.test/inicio");
  assert.equal(navigateWithinApp(http, "/proyectos"), true);
  assert.equal(http.location.protocol, "http:");
});
