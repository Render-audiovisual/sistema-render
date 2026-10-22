import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { feedbackSeenStorageKey, readFeedbackSeenAt, markFeedbackSeen } from './feedback-notifications.js';
import { createFeedbackNotesReader, normalizeFeedbackNotesSelection } from '../../../pages/feedbackNotesPagination.js';

const user = Object.freeze({ id: 91003, usuario: 'qa_feedback' });
const timestamp = '2026-10-22T12:34:56.789Z';

// Every mutation of this process-global property is awaited serially and
// restored even on failure. Never read the original getter to save its value.
async function withLocalStorage(get, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  assert.ok(!original || original.configurable, 'The test requires a replaceable localStorage descriptor');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, enumerable: original?.enumerable ?? false, get });
  try { await run(); }
  finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else assert.equal(Reflect.deleteProperty(globalThis, 'localStorage'), true);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), original, 'Restore the exact descriptor, including getter/setter/flags');
  }
}

function feedbackOnChange({ trash, setPage, setNotes, setLoading }) {
  const source = readFileSync(new URL('../../../pages/Feedback.jsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('Feedback.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(tree.parseDiagnostics.length, 0);
  const callbacks = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createFeedbackNotesReader') {
      const options = node.arguments[0];
      assert.ok(ts.isObjectLiteralExpression(options));
      const property = options.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(tree) === 'onChange');
      if (property) callbacks.push(property.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(callbacks.length, 1, 'Use the actual page reader callback, not a substitute notification handler');
  return Function('setPage', 'setNotes', 'setLoading', 'trash', 'markFeedbackSeen', 'sesion',
    `return (${callbacks[0].getText(tree)});`)(setPage, setNotes, setLoading, trash, markFeedbackSeen, { usuario: user });
}

test('optional feedback storage is fail-safe (serial global descriptor tests)', { concurrency: false }, async t => {
  await t.test('throwing localStorage getter cannot escape default read or mark', async () => {
    let accesses = 0;
    await withLocalStorage(() => { accesses++; throw new DOMException('Synthetic denied storage', 'SecurityError'); }, () => {
      assert.equal(readFeedbackSeenAt(user), null);
      assert.doesNotThrow(() => markFeedbackSeen(user, timestamp));
      assert.equal(readFeedbackSeenAt(user, undefined), null);
      assert.doesNotThrow(() => markFeedbackSeen(user, timestamp, undefined));
      assert.equal(accesses, 4, 'Default and explicit undefined both resolve storage inside the protected block');
    });
  });

  await t.test('explicit null opts out without touching even a denied global getter', async () => {
    let accesses = 0;
    await withLocalStorage(() => { accesses++; throw new Error('Global storage must not be resolved'); }, () => {
      assert.equal(readFeedbackSeenAt(user, null), null);
      assert.doesNotThrow(() => markFeedbackSeen(user, timestamp, null));
      assert.equal(accesses, 0);
    });
  });

  await t.test('valid injected storage keeps the per-user key and exact value, without consulting global storage', async () => {
    const values = new Map(), calls = [];
    const storage = {
      getItem(key) { calls.push(['get', key]); return values.get(key) ?? null; },
      setItem(key, value) { calls.push(['set', key, value]); values.set(key, value); },
    };
    await withLocalStorage(() => { assert.fail('An injected storage must bypass the global getter'); }, () => {
      const key = feedbackSeenStorageKey(user);
      assert.equal(readFeedbackSeenAt(user, storage), null);
      markFeedbackSeen(user, timestamp, storage);
      assert.equal(readFeedbackSeenAt(user, storage), timestamp);
      assert.equal(readFeedbackSeenAt({ id: 91004 }, storage), null);
      assert.deepEqual(calls, [['get', key], ['set', key, timestamp], ['get', key], ['get', feedbackSeenStorageKey({ id: 91004 })]]);
    });
  });

  await t.test('available default storage reads and marks normally rather than always returning a safe empty result', async () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    await withLocalStorage(() => storage, () => {
      markFeedbackSeen(user, timestamp);
      assert.equal(readFeedbackSeenAt(user), timestamp);
      assert.equal(values.get(feedbackSeenStorageKey(user)), timestamp);
    });
  });

  await t.test('getItem and setItem failures are contained for injected and default storage', async () => {
    let reads = 0, writes = 0;
    const storage = { getItem() { reads++; throw new Error('Synthetic getItem failure'); }, setItem() { writes++; throw new Error('Synthetic quota failure'); } };
    await withLocalStorage(() => storage, () => {
      assert.equal(readFeedbackSeenAt(user, storage), null);
      assert.doesNotThrow(() => markFeedbackSeen(user, timestamp, storage));
      assert.equal(readFeedbackSeenAt(user), null);
      assert.doesNotThrow(() => markFeedbackSeen(user, timestamp));
      assert.equal(reads, 2); assert.equal(writes, 2);
    });
  });

  await t.test('missing identity performs neither global resolution nor injected storage operations', async () => {
    const storage = { getItem() { assert.fail('No key to read'); }, setItem() { assert.fail('No key to mark'); } };
    await withLocalStorage(() => { assert.fail('No user must not resolve global storage'); }, () => {
      for (const identity of [null, undefined, {}]) {
        assert.equal(readFeedbackSeenAt(identity), null);
        assert.equal(readFeedbackSeenAt(identity, storage), null);
        markFeedbackSeen(identity, timestamp);
        markFeedbackSeen(identity, timestamp, storage);
      }
    });
  });

  await t.test('real reader plus actual Feedback onChange publishes a valid ready page despite denied storage', async () => {
    let accesses = 0;
    await withLocalStorage(() => { accesses++; throw new Error('Synthetic denied global storage'); }, async () => {
      // Inject only the parsed network DTO. The parser/reader and page callback
      // are actual source; this does not certify HTTP, mounted UI or a browser.
      const selection = normalizeFeedbackNotesSelection({ section: 'clients', limit: 2 });
      const item = { id: 73, titulo: 'Corrección', contenido: 'Texto conservado', categoria: 'general', feedback: {},
        creado_por: 'QA', modificado_por: 'QA', eliminado_at: null, created_at: timestamp, updated_at: timestamp,
        resolved_client: 'Cuenta QA', section: 'clients' };
      const data = { version: 1, limit: 2, offset: 0, total: 1, has_more: false, snapshot: 'a'.repeat(64),
        context: { section: selection.section, papelera: selection.papelera, categoria: selection.categoria, q: selection.q }, items: [item] };
      const pages = [], notes = [], loading = [], requests = [];
      const onChange = feedbackOnChange({ trash: false, setPage: value => pages.push(value), setNotes: value => notes.push(value), setLoading: value => loading.push(value) });
      const reader = createFeedbackNotesReader({ request: async (url, options) => { requests.push({ url, options }); return data; }, onChange });
      try {
        await reader.load(selection);
        assert.equal(requests.length, 1);
        assert.equal(new URL(requests[0].url, 'https://render.test').pathname, '/api/notas/pagina');
        assert.ok(requests[0].options.signal instanceof AbortSignal);
        assert.deepEqual(pages.map(value => value.status), ['loading', 'ready']);
        assert.deepEqual(loading, [true, false]);
        assert.deepEqual(notes.at(-1), [item]);
        assert.equal(pages.at(-1).data.total, 1);
        assert.equal(accesses, 1, 'The real ready callback attempted marking, safely');
      } finally { reader.dispose(); }
    });
  });
});
