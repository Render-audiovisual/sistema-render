import test from 'node:test';
import assert from 'node:assert/strict';
import { startDriveHttpFixture } from './helpers/drive-http-fixture.js';

test('Drive HTTP upload plans never choose an ambiguous or partially enumerated folder', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 30000,
}, async t => {
  let listing = { files: [] };
  const calls = [];
  const f = await startDriveHttpFixture({ port: 55972, driveRouterOptions: { providerFactory: async () => ({
    listChildren: async (...args) => { calls.push(args); return listing; },
  }) } });
  t.after(() => f.cleanup());
  const token = await f.tokenFor(91001);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
  assert.ok(tables.length > 100, 'Compare the whole migrated public schema, not a selected domain subset');
  t.diagnostic(`All ${tables.length} public tables compared including physical tuple identities; provider simulated, no Google request.`);
  const snapshot = async () => {
    const value = {};
    for (const table of tables) {
      assert.match(table, /^[a-z_]+$/);
      value[table] = await f.query(`SELECT to_jsonb(r) row,r.xmin::text xmin,r.ctid::text ctid FROM "${table}" r ORDER BY r.ctid`);
    }
    return value;
  };
  const before = await snapshot();
  const folder = id => ({ id, name: 'RENDER_UPLOADS', mimeType: 'application/vnd.google-apps.folder' });
  for (const [name, result, status] of [
    ['two folders', { files: [folder('qa_a'), folder('qa_b')] }, 503],
    ['truncated result', { files: [folder('qa_a')], nextPageToken: 'qa_next' }, 503],
    ['incomplete search', { files: [folder('qa_a')], incompleteSearch: true }, 503],
    ['unique complete result', { files: [folder('qa_a')] }, 200],
  ]) {
    await t.test(name, async () => {
      listing = result;
      const count = calls.length;
      const response = await f.api('/publication-upload-plan', { token });
      assert.equal(response.status, status);
      assert.equal(calls.length, count + 1);
      if (status === 200) assert.equal(response.body.folder.id, 'qa_a');
      else assert.equal(response.body.code, 'DRIVE_FOLDER_UNAVAILABLE');
      assert.deepEqual(await snapshot(), before, 'Planning must not mutate any public table or historical tuple');
    });
  }
});
