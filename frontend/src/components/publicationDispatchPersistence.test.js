import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest } from '../shared/session/captured-request.js';

const source = readFileSync(new URL('./PublicationComposer.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('PublicationComposer.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function find(predicate) { let match; function visit(node) { if (predicate(node)) match = node; else ts.forEachChild(node, visit); } visit(file); return match; }
function run(node, deps) { return new Function(...Object.keys(deps), `return (${node.getText(file)});`)(...Object.values(deps)); }
const loader = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadDispatchQueue');
const save = find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'simulate').initializer;
const session = { token: 'synthetic-only', usuario: { id: 91001, rol: 'admin', activo: true } };
const scope = request => ({ ...createCapturedRequest({ session, readSession: () => session, request }), release() {} });

test('dispatch queue uses only the API and rejects invalid envelopes', async () => {
  const rows = [{ id: 12, status: 'borrador' }];
  assert.equal(await run(loader, {})(scope(async () => rows)), rows);
  await assert.rejects(run(loader, {})(scope(async () => ({ rows }))), /no es válida/);
  for (const status of [404, 503]) {
    const failure = Object.assign(new Error('API unavailable'), { status });
    await assert.rejects(run(loader, {})(scope(async () => { throw failure; })), error => error === failure);
  }
});

for (const status of [404, 503]) test(`save HTTP ${status} cannot fabricate an ACK, event or browser record`, async () => {
  const notices = [], busy = [], events = [], ids = [];
  let refreshes = 0;
  const callback = run(save, {
    canPublish: true, validation: '', uploads: [], uploadedAssets: [], draftId: null,
    pending: { current: false }, draftsGeneration: { current: 0 }, dispatchOperation: { current: null },
    captureRequest: () => scope(async () => { throw Object.assign(new Error('No se confirmó el guardado.'), { status }); }),
    draft: { material: 'https://drive.google.com/file/test', date: '2026-10-20', time: '09:00', clientId: 1, type: 'reel', caption: 'QA', platforms: { instagram: true } },
    setNotice: value => notices.push(value), setSaving: value => busy.push(value), setDraftId: value => ids.push(value),
    refreshDrafts: async () => { refreshes += 1; },
    apiRequest: async () => { throw Object.assign(new Error('No se confirmó el guardado.'), { status }); },
    window: { crypto: { randomUUID: () => 'fixture-operation-key' }, dispatchEvent: event => events.push(event),
      get localStorage() { throw new Error('browser persistence forbidden'); } },
    CustomEvent: class { constructor(type) { this.type = type; } },
  });
  await callback('draft');
  assert.deepEqual(busy, [true, false]);
  assert.equal(notices.at(-1), 'No se confirmó el guardado.');
  assert.equal(refreshes, 0); assert.deepEqual(ids, []); assert.deepEqual(events, []);
});

test('legacy browser copies are preserved but never read, written or advertised as shared data', () => {
  assert.doesNotMatch(source, /localStorage|readPreviewQueue|savePreviewQueue|addEventListener\("storage"/);
  assert.match(source, /Preparar un envío no confirma su publicación en Meta/);
});
