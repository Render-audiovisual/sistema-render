import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { createMoodboardBoardLoader } from '../../frontend/src/shared/session/moodboard-board-loader.js';
import { createCapturedRequest } from '../../frontend/src/shared/session/captured-request.js';
import { apiRequest } from '../../frontend/src/features/render-os/services/render-os-api.js';

test('coherent moodboard reads use actual authenticated HTTP and retain PostgreSQL records', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55709 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), { code: 'ENOENT' });
    t.diagnostic('Own moodboard fixture stopped and removed. No external files or services used.');
  });
  const login = await request(fixture.base, '/api/login', { method: 'POST', body: { usuario: 'qa_designer', password: fixturePassword } });
  assert.equal(login.status, 200);
  let session = login.body;
  const boards = [];
  for (const label of ['A', 'B']) {
    const [client] = await fixture.query('INSERT INTO clientes(nombre) VALUES($1) RETURNING id', [`QA89 client ${label}`]);
    const [board] = await fixture.query('INSERT INTO moodboard_boards(nombre) VALUES($1) RETURNING id', [`QA89 board ${label}`]);
    await fixture.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES($1,$2)', [board.id, client.id]);
    const [category] = await fixture.query('INSERT INTO moodboard_categories(board_id,nombre,orden) VALUES($1,$2,1) RETURNING id', [board.id, `QA89 category ${label}`]);
    const saved = await request(fixture.base, `/api/moodboards/boards/${board.id}/references`, {
      token: session.token, method: 'POST', body: { title: `QA89 reference ${label}`, note: 'Synthetic visual direction', category_id: category.id, external_url: 'https://example.invalid/reference' },
    });
    assert.equal(saved.status, 201); boards.push({ ...board, category, reference: saved.body });
  }
  const snapshot = () => fixture.query(`SELECT id,md5(to_jsonb(r)::text) AS fingerprint FROM moodboard_references r ORDER BY id`);
  const before = await snapshot();
  const originalFetch = globalThis.fetch;
  // Resolve relative browser URLs only to this verified disposable fixture.
  globalThis.fetch = (url, options) => originalFetch(new URL(url, fixture.base), options);
  t.after(() => { globalThis.fetch = originalFetch; });
  const scope = createCapturedRequest({ session, readSession: () => session, request: apiRequest });
  const loader = createMoodboardBoardLoader({ request: scope.request, isCurrent: scope.current });
  t.after(() => loader.cancel());
  await t.test('both real board collections remain separate across reloads', async () => {
    for (const board of [...boards, boards[0]]) {
      const result = await loader.load(board.id);
      assert.equal(result.references.length, 1);
      assert.equal(result.references[0].id, board.reference.id);
      assert.equal(result.references[0].board_id, board.id);
      assert.deepEqual(result.categories.map(row => row.id), [board.category.id]);
      assert.deepEqual(result.tasks, []);
    }
  });
  await t.test('late actual HTTP response cannot replace the next selected board', async () => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let observed;
    const started = new Promise(resolve => { observed = resolve; });
    const delayed = createMoodboardBoardLoader({ isCurrent: scope.current, request: async (url, options) => {
      const data = await scope.request(url, options);
      if (url === `/api/moodboards/boards/${boards[0].id}/references`) { observed(); await held; }
      return data;
    } });
    const old = delayed.load(boards[0].id);
    await started;
    const current = await delayed.load(boards[1].id);
    release();
    assert.equal(await old, null);
    assert.equal(current.references[0].id, boards[1].reference.id);
    delayed.cancel();
  });
  await t.test('new session context prevents further old-scope requests', async () => {
    session = null;
    assert.equal(await loader.load(boards[0].id), null);
  });
  assert.deepEqual(await snapshot(), before);
});
