import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTaskFolder, DRIVE_ROOTS } from '../src/google-drive.js';
import { defaultDriveProvider } from '../src/drive-provider.js';
import { OAuth2Client } from 'google-auth-library';

const folder = (id, name = 'RENDER_UPLOADS') => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
const contexts = [
  { name: 'general', task: {}, parent: DRIVE_ROOTS.general, target: 'RENDER_UPLOADS' },
  { name: 'client design', task: { tipo_tarea: 'diseño', asignado_a: 'Mariano Meza', cliente_nombre: 'Ángel Azul' }, parent: DRIVE_ROOTS.mariano, target: 'Ángel Azul' },
];

for (const context of contexts) {
  for (const [name, result] of [
    ['duplicate exact names', { files: [folder('qa_folder_a', context.target), folder('qa_folder_b', context.target)] }],
    ['duplicate normalized names', { files: [folder('qa_folder_a', context.target), folder('qa_folder_b', context.target.toUpperCase())] }],
    ['a next page even with one visible match', { files: [folder('qa_folder_a', context.target)], nextPageToken: 'next_synthetic' }],
    ['an incomplete search', { files: [folder('qa_folder_a', context.target)], incompleteSearch: true }],
    ['missing folder ID', { files: [{ name: context.target, mimeType: 'application/vnd.google-apps.folder' }] }],
    ['not a folder', { files: [{ id: 'qa_file_a', name: context.target, mimeType: 'image/jpeg' }] }],
    ['no matches', { files: [folder('qa_folder_a', 'Different')] }],
    ['malformed listing', {}],
  ]) {
    test(`${context.name}: ${name} never selects an automatic destination`, async () => {
      const calls = [];
      const value = await resolveTaskFolder({ listChildren: async (...args) => { calls.push(args); return result; } }, context.task);
      assert.equal(value.status, 'manual');
      assert.equal(value.folder, undefined);
      assert.equal(value.root.id, context.parent);
      assert.match(value.reason, /inequívoca/);
      assert.deepEqual(calls, [[context.parent, { query: context.target, foldersOnly: true }]]);
    });
  }
  test(`${context.name}: a complete unique folder remains resolved`, async () => {
    const match = folder('qa_folder_unique', context.target);
    const value = await resolveTaskFolder({ listChildren: async () => ({ files: [folder('qa_other', 'Other'), match], incompleteSearch: false }) }, context.task);
    assert.equal(value.status, 'resolved');
    assert.deepEqual(value.folder, match);
    assert.equal(value.root.id, context.parent);
  });
}

test('provider listing failure stays an error rather than inventing a destination', async () => {
  const error = new Error('synthetic provider unavailable');
  await assert.rejects(resolveTaskFolder({ listChildren: async () => { throw error; } }, {}), value => value === error);
});

test('actual default provider requests completeness metadata and preserves it for destination resolution', async t => {
  const keys = ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET'];
  const previous = keys.map(key => process.env[key]);
  const calls = [];
  try {
    for (const key of keys) process.env[key] = 'synthetic-folder-test';
    t.mock.method(OAuth2Client.prototype, 'getRequestHeaders', async () => new Headers());
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url: new URL(url), options });
      return new Response(JSON.stringify({ files: [folder('qa_unique')], nextPageToken: 'synthetic_next', incompleteSearch: true }), { status: 200 });
    });
    const provider = await defaultDriveProvider({ signal: new AbortController().signal, credentials: { refresh_token: 'synthetic-not-a-token' } });
    const value = await resolveTaskFolder(provider, {});
    assert.equal(value.status, 'manual');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.origin, 'https://www.googleapis.com');
    assert.match(calls[0].url.searchParams.get('fields'), /nextPageToken/);
    assert.match(calls[0].url.searchParams.get('fields'), /incompleteSearch/);
    assert.match(calls[0].url.searchParams.get('q'), /mimeType = 'application\/vnd.google-apps.folder'/);
    assert.equal(calls[0].options.redirect, 'error');
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
