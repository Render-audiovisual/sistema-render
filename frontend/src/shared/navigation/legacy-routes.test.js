import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalLegacyRoute, replaceLegacyRoute } from './legacy-routes.js';

const dashboards = ['/agustin', '/franco', '/augusto', '/luciano', '/oriana'];
const tasks = ['/piezas', '/wilson-conversaciones'];

test('closed dashboard aliases always use current-identity home, never named scope', () => {
  for (const alias of dashboards) {
    assert.equal(canonicalLegacyRoute(alias), '/inicio');
    assert.equal(canonicalLegacyRoute(`${alias}?usuario=other&rol=admin&client_id=8&assignee=9#other`), '/inicio');
  }
  assert.equal(canonicalLegacyRoute('/equipo?task=9&rol=admin#other'), '/reportes-historias');
  for (const alias of tasks) assert.equal(canonicalLegacyRoute(alias), '/workspace/tareas');
});

test('one explicit safe task context survives dashboard/task aliases, with nothing else', () => {
  for (const alias of [...dashboards, ...tasks]) {
    for (const id of ['1', '42', String(Number.MAX_SAFE_INTEGER)]) {
      assert.equal(canonicalLegacyRoute(`${alias}?usuario=other&task=${id}&role=admin#task=99`), `/workspace/tareas?task=${id}`);
    }
  }
  assert.equal(canonicalLegacyRoute('/franco?task=%31'), '/workspace/tareas?task=1');
  assert.equal(canonicalLegacyRoute('/agustin?%74ask=2'), '/workspace/tareas?task=2');
});

test('unreplaced dashboards remain live rather than silently losing coordination or escalation workflows', () => {
  for (const path of ['/lider', '/german']) {
    assert.equal(canonicalLegacyRoute(path), null);
    assert.equal(canonicalLegacyRoute(`${path}?task=1`), null);
    assert.equal(canonicalLegacyRoute(`${path}?usuario=other&rol=admin&task=42#other`), null);
  }
});

test('retired design/editing/editorial aliases replace only safe context and preserve existing history state', () => {
  for (const alias of ['/augusto', '/luciano', '/oriana']) {
    for (const [suffix, destination] of [
      ['?usuario=other&asignado_a=Franco&rol=admin&cliente_id=9#unknown', '/inicio'],
      ['?task=42&usuario=other&role=admin&assignee=9#task=99', '/workspace/tareas?task=42'],
      ['?task=42&task=43&usuario=other', '/inicio'],
      ['?task=01&rol=admin', '/inicio'],
    ]) {
      const state = { draft: { owner: 'current-session' }, index: 3 };
      const win = fakeWindow(state, `https://render.test${alias}${suffix}`);
      assert.equal(canonicalLegacyRoute(`${alias}${suffix}`), destination);
      assert.equal(replaceLegacyRoute(win, canonicalLegacyRoute(`${alias}${suffix}`)), true);
      assert.equal(win.location.href, `https://render.test${destination}`);
      assert.deepEqual(win.effects[0], ['replace', state, '', destination]);
      assert.equal(win.effects.length, 2);
      assert.equal(win.effects[1][1].state, state);
      assert.equal(win.effects[1][1].type, 'popstate');
    }
    for (const path of [`/${alias.slice(1).toUpperCase()}`, `${alias}/`, `/x/..${alias}`,
      `https://render.test${alias}`, `//render.test${alias}`]) {
      assert.equal(canonicalLegacyRoute(path), null, 'No path guessing or external route acceptance');
    }
  }
});

test('invalid or duplicate task values fall back safely without retaining filters', () => {
  const invalid = ['', '0', '-1', '+1', '01', '1.0', '1e2', 'Infinity', 'NaN', '9007199254740992',
    '999999999999999999999999999999', '%201', '1%20', '%2B1', '١', '%00', '%ZZ', '1&task=1', '1&%74ask=2'];
  for (const alias of [...dashboards, ...tasks]) {
    const fallback = dashboards.includes(alias) ? '/inicio' : '/workspace/tareas';
    for (const value of invalid) assert.equal(canonicalLegacyRoute(`${alias}?task=${value}&name=other`), fallback, `${alias}: ${value}`);
    assert.equal(canonicalLegacyRoute(`${alias}?TASK=1#task=2`), fallback);
    assert.equal(canonicalLegacyRoute(`${alias}#task=2?task=3`), fallback);
  }
});

test('canonical, unknown, non-local and normalized/encoded path guesses are no-ops', () => {
  for (const route of [null, undefined, 42, {}, '', 'lider', '//example.test/lider', 'https://example.test/lider',
    'https://user:pass@example.test/lider', '/Lider', '/lider/', '/%6cider', '/%2Flider', '/a/../lider',
    '/./lider', '/lider\\', '/lider\n', '/lider?task=1\t', '/unknown', '/inicio', '/inicio?task=1',
    '/workspace/tareas', '/workspace/tareas?task=1', '/reportes-historias']) {
    assert.equal(canonicalLegacyRoute(route), null, String(route));
  }
});

function fakeWindow(state, href = 'https://render.test/lider?name=other#old') {
  const effects = [];
  const win = {
    location: new URL(href), effects,
    PopStateEvent: class { constructor(type, init) { this.type = type; this.state = init.state; } },
    history: {
      state,
      replaceState(nextState, title, destination) {
        effects.push(['replace', nextState, title, destination]);
        this.state = nextState;
        win.location = new URL(destination, win.location.href);
      },
    },
    dispatchEvent(event) {
      effects.push(['event', event, win.location.href]);
      return true;
    },
  };
  return win;
}

test('helper replaces once before one popstate, preserving arbitrary state exactly', () => {
  for (const state of [null, undefined, false, 0, 'draft', { draft: { id: 8 }, index: 4 }]) {
    for (const destination of ['/inicio', '/reportes-historias', '/workspace/tareas', '/workspace/tareas?task=9007199254740991']) {
      const win = fakeWindow(state);
      assert.equal(replaceLegacyRoute(win, destination), true);
      assert.equal(win.effects.length, 2);
      assert.deepEqual(win.effects[0], ['replace', state, '', destination]);
      const [, event, href] = win.effects[1];
      assert.ok(event instanceof win.PopStateEvent);
      assert.equal(event.type, 'popstate');
      assert.equal(event.state, state);
      assert.equal(win.history.state, state);
      assert.equal(href, `https://render.test${destination}`);
    }
  }
});

test('helper rejects all noncanonical destinations without history or event effects', () => {
  for (const destination of [null, undefined, {}, '/lider', '/unknown', '//evil.test/inicio', 'https://render.test/inicio',
    'https://evil.test/inicio', '/inicio#x', '/inicio?task=1', '/reportes-historias?name=other', '/workspace/tareas/',
    '/workspace/tareas?task=0', '/workspace/tareas?task=01', '/workspace/tareas?task=9007199254740992',
    '/workspace/tareas?task=1&task=2', '/workspace/tareas?task=%31', '/workspace/tareas?task=1&rol=admin',
    '/workspace/tareas?task=1#x', '/workspace/tareas?task=1\n']) {
    const win = fakeWindow({ draft: true });
    assert.equal(replaceLegacyRoute(win, destination), false, String(destination));
    assert.deepEqual(win.effects, []);
  }
});

test('same canonical URL and non-web origins do not replace or dispatch', () => {
  for (const href of ['https://render.test/inicio', 'file:///lider', 'data:text/plain,legacy']) {
    const win = fakeWindow(null, href);
    assert.equal(replaceLegacyRoute(win, '/inicio'), false);
    assert.deepEqual(win.effects, []);
  }
});

test('failed replacement never emits a misleading navigation event', () => {
  const win = fakeWindow({ draft: true });
  win.history.replaceState = () => { throw new Error('replace failed'); };
  assert.throws(() => replaceLegacyRoute(win, '/inicio'), /replace failed/);
  assert.deepEqual(win.effects, []);
});
