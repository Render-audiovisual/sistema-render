import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { driveRequest, uploadFileToDrive } from '../features/drive/drive-api.js';

const source = readFileSync(new URL('./PublicationComposer.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('PublicationComposer.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) { const result = []; function visit(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); } visit(root); return result; }
const declaration = name => nodes(file, ts.isVariableDeclaration).find(n => n.name.getText(file) === name);
const fn = name => nodes(file, ts.isFunctionDeclaration).find(n => n.name?.text === name);
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(file)});`)(...Object.values(deps));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 36; i++) await Promise.resolve(); };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const revisionA = '2026-10-20T12:00:00.123456Z', revisionB = '2026-10-20T12:00:00.123457Z';
const ack = (mode = 'draft', id = '31', revision = revisionA) => ({ id, revision, status: mode === 'draft' ? 'borrador' : mode === 'now' ? 'lista_para_publicar' : 'programada', previewOnly: true });
function fixture(mode = 'cookie') {
  const store = createBrowserSessionState(), calls = [], effects = [], events = [], state = {}, cleanups = [];
  let session, key = 0;
  const accept = (id = 7) => {
    if (mode === 'bearer') session = { token: `synthetic-${id}`, usuario: { id, rol: 'community', activo: true } };
    else { const ticket = store.beginBootstrap(); store.acceptBootstrap(ticket, { usuario: { id, usuario: 'synthetic', nombre: 'Synthetic', rol: 'community' },
      session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) }); session = store.getSession(); }
  };
  accept(); const original = session, view = {}, currentView = { current: view };
  const rawFetch = (url, options) => { const d = deferred(); calls.push({ url, options, ...d }); return d.promise; };
  const apiRequest = (url, options) => driveRequest(url, options, rawFetch);
  const useEffect = setup => { cleanups.push(setup()); };
  const captureRequest = evaluate(fn('usePublicationCapture'), { useRef: value => ({ current: value }), useEffect, useCallback: callback => callback,
    apiRequest, createCapturedRequest, getSesion: () => session })(original, view, currentView);
  const context = { captureRequest, session: original, getSesion: () => session, fetch: rawFetch, pending: { current: false },
    draftsGeneration: { current: 0 }, dispatchOperation: { current: null }, draftEdited: { current: false }, draftRevision: revisionA,
    dispatchConflict: false, canPublish: true, validation: '', uploads: [], uploadedAssets: [], draftId: null,
    uploadingMaterial: false, clients: [], savedDrafts: [], candidates: [], sourceSelection: '', uploadsRef: { current: [] }, fileInputRef: { current: null },
    draft: { clientId: 1, publicationId: 9, type: 'reel', material: 'https://drive.google.com/synthetic', caption: 'Exact caption', firstComment: '',
      collaborators: '', location: '', tags: '', date: '2026-10-20', time: '09:00', platforms: { instagram: true, facebook: false } },
    window: { crypto: { randomUUID: () => `synthetic-request-${++key}` }, dispatchEvent: event => events.push(event.type), confirm: () => true },
    CustomEvent: class { constructor(type) { this.type = type; } },
    publicationUploadPlan: options => driveRequest('/api/drive/publication-upload-plan', options, rawFetch), uploadFileToDrive,
  };
  for (const name of ['Saving', 'Notice', 'SavedDrafts', 'DraftId', 'DraftRevision', 'DispatchConflict', 'UploadingMaterial', 'FileError', 'DriveReconnectRequired', 'UploadProgress', 'UploadedAssets', 'Draft', 'ShowDriveField', 'Uploads', 'SourceSelection']) {
    state[name] = name === 'Draft' ? structuredClone(context.draft) : null;
    context[`set${name}`] = value => { state[name] = typeof value === 'function' ? value(state[name]) : value; effects.push(name); };
  }
  context.validDispatchRevision = evaluate(fn('validDispatchRevision'), {});
  context.validDispatchAck = evaluate(fn('validDispatchAck'), context);
  context.savedDraft = evaluate(fn('savedDraft'), { emptyDraft: evaluate(fn('emptyDraft'), {}) });
  context.openSavedDraft = evaluate(declaration('openSavedDraft').initializer, context);
  context.refreshDrafts = evaluate(declaration('refreshDrafts').initializer, context);
  const run = name => evaluate(declaration(name).initializer, context);
  return { context, calls, effects, state, events, store, accept, run, captureRequest,
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

test('actual save and refresh retain one original cookie intent, full payload and real draft ID', async () => {
  const h = fixture(), pending = h.run('simulate')('draft');
  const sent = h.calls[0]; assert.equal(sent.url, '/api/publicacion-envios'); assert.equal(sent.options.method, 'POST');
  const body = JSON.parse(sent.options.body);
  assert.equal(body.caption, 'Exact caption'); assert.equal(body.publicationId, 9); assert.equal(body.clientId, 1);
  assert.equal(body.mode, 'draft'); assert.equal(body.scheduledAt, '2026-10-20T12:00:00.000Z');
  assert.equal(Object.hasOwn(body, 'expectedRevision'), false);
  assert.deepEqual(body.materials, ['https://drive.google.com/synthetic']);
  assert.equal(h.store.isCurrent(sent.options.sessionIntent), true); assert.equal(new Headers(sent.options.headers).has('Authorization'), false);
  sent.resolve(response(ack())); await settle();
  assert.equal(h.calls[1].url, '/api/publicacion-envios?estado=borrador'); assert.equal(h.calls[1].options.sessionIntent, sent.options.sessionIntent);
  h.calls[1].resolve(response([{ ...ack(), caption: 'Exact caption' }])); await pending;
  assert.equal(h.state.DraftId, '31'); assert.equal(h.state.Saving, false); assert.equal(h.context.dispatchOperation.current, null);
  assert.equal(h.state.DraftRevision, revisionA);
  assert.deepEqual(h.events, ['render:publication-preview-updated']); assert.match(h.state.Notice, /Borrador guardado/);
});

for (const stage of ['save', 'refresh']) for (const replacement of ['B', 'unmount']) test(`${replacement} during ${stage} suppresses all late UI/event effects without recapturing`, async () => {
  const h = fixture(), pending = h.run('simulate')('draft');
  if (stage === 'refresh') { h.calls[0].resolve(response(ack())); await settle(); }
  const count = h.effects.length;
  if (replacement === 'B') h.accept(8); else h.unmount();
  h.calls.at(-1).resolve(response(stage === 'save' ? ack() : [])); await pending;
  assert.equal(h.effects.length, count); assert.deepEqual(h.events, []); assert.equal(h.calls.length, stage === 'save' ? 1 : 2);
});

test('confirmed save with failed refresh retains ACK and warns honestly, never says rollback/unconfirmed', async () => {
  const h = fixture(), pending = h.run('simulate')('draft'); h.calls[0].resolve(response(ack())); await settle();
  h.calls[1].reject(new TypeError('Synthetic list unavailable')); await pending;
  assert.equal(h.state.DraftId, '31'); assert.equal(h.context.dispatchOperation.current, null);
  assert.match(h.state.Notice, /Borrador guardado.*No se pudo actualizar la lista/);
  assert.doesNotMatch(h.state.Notice, /No se confirmó|rollback/); assert.equal(h.events.length, 1);
});

for (const value of [{}, { id: 0, status: 'borrador', previewOnly: true }, { id: '01', status: 'borrador', previewOnly: true },
  { id: '31', status: 'publicada', previewOnly: true }, { id: '31', status: 'borrador', previewOnly: false }])
test(`malformed ACK ${JSON.stringify(value)} cannot fabricate ID, refresh or event`, async () => {
  const h = fixture(), pending = h.run('simulate')('draft'); h.calls[0].resolve(response(value)); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.state.DraftId, null); assert.equal(h.events.length, 0);
  assert.ok(h.context.dispatchOperation.current); assert.match(h.state.Notice, /no confirmó/);
});

for (const uncertain of ['network', 'malformed']) test(`explicit retry after ${uncertain} reuses exact frozen operation; edited intent gets new key`, async () => {
  const h = fixture(), save = h.run('simulate');
  const first = save('draft');
  if (uncertain === 'network') h.calls[0].reject(new TypeError('Uncertain commit')); else h.calls[0].resolve(response({}));
  await first; assert.equal(h.calls.length, 1);
  const original = h.calls[0].options.body;
  const second = save('draft'); assert.equal(h.calls[1].options.body, original);
  h.calls[1].reject(new TypeError('Still uncertain')); await second;
  h.context.draft.caption = 'Explicit new intent';
  const third = save('draft');
  assert.notEqual(JSON.parse(h.calls[2].options.body).requestKey, JSON.parse(original).requestKey);
  h.calls[2].resolve(response(ack())); await settle(); h.calls[3].resolve(response([])); await third;
});

test('same-account draft editing and material/source changes are imperatively blocked while save is pending', async () => {
  const h = fixture(), simulate = h.run('simulate'), pending = simulate('draft');
  const count = h.effects.length;
  await simulate('now'); h.run('setField')('caption', 'must not replace'); h.run('setPlatform')('facebook', true);
  h.run('chooseFiles')([]); h.run('selectPublication')('draft:99'); h.run('clearUploads')();
  assert.equal(h.calls.length, 1); assert.equal(h.effects.length, count); assert.equal(h.state.Draft.caption, 'Exact caption');
  h.calls[0].resolve(response(ack())); await settle(); h.calls[1].resolve(response([])); await pending;
  h.run('setField')('caption', 'intentional next edit'); assert.equal(h.state.Draft.caption, 'intentional next edit');
});

test('upload plan, every real Drive chunk and progress use original scope; replacement blocks second file and late progress', async () => {
  const h = fixture();
  const makeFile = name => Object.assign(new Blob(['synthetic']), { name });
  h.context.uploads = [{ name: 'one.mp4', file: makeFile('one.mp4') }, { name: 'two.mp4', file: makeFile('two.mp4') }];
  const pending = h.run('uploadMaterial')();
  assert.equal(h.calls[0].url, '/api/drive/publication-upload-plan');
  const intent = h.calls[0].options.sessionIntent;
  h.calls[0].resolve(response({ status: 'resolved', folder: { id: 'private-folder' } })); await settle();
  assert.equal(h.calls[1].url, '/api/drive/uploads'); assert.equal(h.calls[1].options.sessionIntent, intent);
  h.calls[1].resolve(response({ token: 'synthetic-upload' })); await settle();
  assert.ok(h.calls[2].options.body instanceof Blob); assert.equal(h.calls[2].options.sessionIntent, intent);
  const count = h.effects.length; h.accept(8);
  h.calls[2].resolve(response({ webViewLink: 'https://drive.google.com/synthetic' })); await pending;
  assert.equal(h.calls.length, 3); assert.equal(h.effects.length, count); assert.equal(h.state.UploadedAssets, null);
});

test('late plan failure is suppressed and no upload starts after replacement', async () => {
  const h = fixture(); h.context.uploads = [{ name: 'one.mp4', file: new Blob(['synthetic']) }];
  const pending = h.run('uploadMaterial')(), count = h.effects.length; h.accept(8);
  h.calls[0].reject(new Error('Private A failure')); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.effects.length, count);
});

test('two-file upload completes under the same original scope and progress cannot edit the pending draft', async () => {
  const h = fixture();
  h.context.uploads = ['one.mp4', 'two.mp4'].map(name => ({ name, file: Object.assign(new Blob(['synthetic']), { name }) }));
  const pending = h.run('uploadMaterial')();
  const initialIntent = h.calls[0].options.sessionIntent;
  await h.run('uploadMaterial')(); await h.run('simulate')('draft'); assert.equal(h.calls.length, 1);
  h.calls[0].resolve(response({ status: 'resolved', folder: { id: 'private-folder' } })); await settle();
  h.calls[1].resolve(response({ token: 'upload-one' })); await settle();
  h.calls[2].resolve(response({ webViewLink: 'https://drive.google.com/one' })); await settle();
  assert.equal(h.state.UploadProgress, 50);
  h.run('setField')('caption', 'blocked during second file'); assert.equal(h.state.Draft.caption, 'Exact caption');
  h.calls[3].resolve(response({ token: 'upload-two' })); await settle();
  h.calls[4].resolve(response({ webViewLink: 'https://drive.google.com/two' })); await pending;
  assert.equal(h.calls.length, 5);
  assert.ok(h.calls.every(call => call.options.sessionIntent === initialIntent));
  assert.equal(h.state.Draft.material, 'https://drive.google.com/one\nhttps://drive.google.com/two');
  assert.equal(h.state.UploadProgress, 100); assert.equal(h.state.UploadingMaterial, false); assert.equal(h.context.pending.current, false);
});

test('PATCH ACK must match exact existing BIGSERIAL draft ID; validation never converts adjacent IDs to Number', async () => {
  const h = fixture(); h.context.draftId = '9223372036854775807';
  const pending = h.run('simulate')('draft');
  assert.equal(h.calls[0].url, '/api/publicacion-envios/9223372036854775807'); assert.equal(h.calls[0].options.method, 'PATCH');
  h.calls[0].resolve(response(ack('draft', '9223372036854775806'))); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.events.length, 0); assert.equal(h.state.DraftId, null);
});

test('same-account ready draft GET stays current and old initial list cannot overwrite the post-save list', async () => {
  const h = fixture('bearer'), initial = h.context.refreshDrafts();
  const pending = h.run('simulate')('draft');
  assert.equal(new Headers(h.calls[1].options.headers).get('Authorization'), 'Bearer synthetic-7');
  h.calls[1].resolve(response(ack())); await settle();
  h.calls[2].resolve(response([{ ...ack(), caption: 'Saved current draft' }])); await pending;
  h.calls[0].resolve(response([{ id: '1', caption: 'Old initial list' }])); await initial;
  assert.equal(h.state.SavedDrafts[0].id, '31'); assert.equal(h.state.SavedDrafts[0].caption, 'Saved current draft');
});

test('typed session errors never trigger a retry or refresh/dispatch fallback', async () => {
  const h = fixture(), pending = h.run('simulate')('draft');
  h.calls[0].reject(Object.assign(new Error('Synthetic session boundary'), { name: 'BrowserSessionError', code: 'browser_response_unverified' }));
  await pending; assert.equal(h.calls.length, 1); assert.equal(h.events.length, 0); assert.equal(h.state.DraftId, null);
});

test('queue real refresh callback rejects older responses, retains IDs and cannot publish after unmount', async () => {
  const h = fixture(); const listeners = new Map();
  const component = fn('PreviewQueueSession');
  const effect = nodes(component, ts.isCallExpression).find(n => n.expression.getText() === 'useEffect').arguments[0];
  h.context.loadDispatchQueue = evaluate(fn('loadDispatchQueue'), {});
  for (const name of ['Items', 'Error', 'Loading']) h.context[`set${name}`] = value => { h.state[name] = value; h.effects.push(name); };
  const window = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const cleanup = evaluate(effect, { ...h.context, window })();
  listeners.get('render:publication-preview-updated')(); assert.equal(h.calls[0].options.signal.aborted, true);
  h.calls[1].resolve(response([{ id: '9223372036854775807', status: 'programada' }])); await settle();
  h.calls[0].resolve(response([{ id: '1', status: 'programada' }])); await settle();
  assert.equal(h.state.Items[0].id, '9223372036854775807');
  listeners.get('render:publication-preview-updated')(); const count = h.effects.length; cleanup();
  h.calls[2].resolve(response([])); await settle(); assert.equal(h.effects.length, count); assert.equal(listeners.size, 0);
});

test('all editable controls disable while pending, scoped state is keyed by session and copy stays simulation-only', () => {
  const component = fn('ComposerSession');
  const controls = nodes(component, ts.isJsxSelfClosingElement).concat(nodes(component, ts.isJsxOpeningElement))
    .filter(n => ['input', 'select', 'textarea'].includes(n.tagName.getText(file)));
  assert.ok(controls.length >= 12);
  for (const control of controls) assert.ok(control.attributes.properties.some(p => p.name?.getText(file) === 'disabled'
    && p.initializer.expression.getText(file) === 'operationBusy'));
  assert.match(source, /key=\{view.key\}/); assert.doesNotMatch(source, /localStorage|sessionStorage|\.token\s*\|\|/);
  assert.match(source, /Simulación lista\. No se envió nada a Meta/);
  assert.match(source, /Programación simulada\. El calendario editorial no fue modificado/);
});

const storedDraft = (id = '31', revision = revisionA, caption = 'Server copy') => ({ ...ack('draft', id, revision),
  clientId: 1, type: 'reel', caption, assets: [{ url: 'https://drive.google.com/stored' }],
  scheduledAt: '2026-10-20T12:00:00Z', targets: [{ platform: 'instagram' }] });
function renderState(h) {
  for (const [key, state] of [['draft', 'Draft'], ['draftId', 'DraftId'], ['draftRevision', 'DraftRevision'],
    ['dispatchConflict', 'DispatchConflict'], ['sourceSelection', 'SourceSelection'], ['savedDrafts', 'SavedDrafts']]) {
    if (h.state[state] !== null) h.context[key] = h.state[state];
  }
}
function open(h, row = storedDraft()) { h.context.openSavedDraft(row); renderState(h); }

test('two editor callbacks send exact observed microseconds: stale conflict retains text/token, explicit recovery permits fresh save', async () => {
  const first = fixture(), second = fixture(); open(first); open(second);
  first.context.draft.caption = 'Editor A change'; second.context.draft.caption = 'Editor B unsaved change';
  const savingFirst = first.run('simulate')('draft');
  assert.equal(JSON.parse(first.calls[0].options.body).expectedRevision, revisionA);
  first.calls[0].resolve(response(ack('draft', '31', revisionB))); await settle(); first.calls[1].resolve(response([storedDraft('31', revisionB)])); await savingFirst;
  assert.equal(first.state.DraftRevision, revisionB);
  const savingSecond = second.run('simulate')('draft');
  assert.equal(JSON.parse(second.calls[0].options.body).expectedRevision, revisionA);
  second.calls[0].resolve(response({ code: 'DISPATCH_REVISION_CONFLICT', error: 'Actual revision conflict' }, 409)); await savingSecond;
  renderState(second);
  assert.equal(second.context.draft.caption, 'Editor B unsaved change'); assert.equal(second.state.DraftRevision, revisionA);
  assert.equal(second.state.DispatchConflict, true); assert.equal(second.calls.length, 1); assert.equal(second.events.length, 0);
  await second.run('simulate')('draft'); assert.equal(second.calls.length, 1, 'Conflict cannot silently retry/rebase');
  const recovering = second.run('discardAndReloadDraft')(); assert.equal(second.calls[1].options.method, undefined);
  second.calls[1].resolve(response([storedDraft('31', revisionB, 'Editor A change')])); await recovering; renderState(second);
  assert.equal(second.context.draft.caption, 'Editor A change'); assert.equal(second.context.draftRevision, revisionB);
  assert.equal(second.context.dispatchConflict, false); assert.equal(second.context.dispatchOperation.current, null);
  second.run('setField')('caption', 'Editor B intentional edit after reload'); renderState(second);
  const fresh = second.run('simulate')('draft');
  assert.equal(JSON.parse(second.calls[2].options.body).expectedRevision, revisionB);
  assert.equal(JSON.parse(second.calls[2].options.body).caption, 'Editor B intentional edit after reload');
  second.calls[2].resolve(response(ack('draft', '31', '2026-10-20T12:00:00.123458Z'))); await settle(); second.calls[3].resolve(response([])); await fresh;
});

for (const failure of ['network', 'missing', 'invalidRevision', 'notEditable']) test(`explicit discard/reload ${failure} preserves entire local draft, opaque token and pending request key`, async () => {
  const h = fixture(); open(h);
  h.context.draft.caption = 'Precious unsaved text'; h.context.dispatchConflict = true; h.context.draftEdited.current = true;
  h.context.dispatchOperation.current = Object.freeze({ fingerprint: 'old', requestKey: 'do-not-lose', body: 'old serialized body' });
  const draft = structuredClone(h.context.draft), operation = h.context.dispatchOperation.current;
  const pending = h.run('discardAndReloadDraft')();
  if (failure === 'network') h.calls[0].reject(new TypeError('Synthetic GET unavailable'));
  else h.calls[0].resolve(response(failure === 'missing' ? [] : [{ ...storedDraft(),
    ...(failure === 'invalidRevision' ? { revision: '2026-10-20T12:00:00.123Z' } : { status: 'programada' }) }]));
  await pending;
  assert.deepEqual(h.context.draft, draft); assert.deepEqual(h.state.Draft, draft);
  assert.equal(h.state.DraftRevision, revisionA); assert.equal(h.context.dispatchOperation.current, operation);
  assert.equal(h.context.draftEdited.current, true); assert.equal(h.state.SavedDrafts, null);
  assert.match(h.state.Notice, /unavailable|Conservamos tus cambios/); assert.equal(h.calls.length, 1);
});

for (const replacement of ['B', 'unmount']) test(`explicit recovery after ${replacement} cannot clear draft/uploads or adopt fresh server revision`, async () => {
  const h = fixture(); open(h); const before = h.effects.length;
  const pending = h.run('discardAndReloadDraft')(), count = h.effects.length;
  if (replacement === 'B') h.accept(8); else h.unmount();
  h.calls[0].resolve(response([storedDraft('31', revisionB, 'Must not adopt')])); await pending;
  assert.equal(h.effects.length, count); assert.equal(h.state.DraftRevision, revisionA);
  assert.ok(count > before); assert.notEqual(h.state.Draft.caption, 'Must not adopt');
});

test('explicit recovery distinguishes adjacent BIGSERIAL IDs and opens only the requested row with original token text', async () => {
  const h = fixture(), id = '9223372036854775807'; open(h, storedDraft(id));
  const pending = h.run('discardAndReloadDraft')();
  h.calls[0].resolve(response([storedDraft('9223372036854775806', revisionB, 'Wrong adjacent row'),
    storedDraft(id, revisionB, 'Exact requested row')])); await pending;
  assert.equal(h.state.DraftId, id); assert.equal(h.state.DraftRevision, revisionB); assert.equal(h.state.Draft.caption, 'Exact requested row');
});

for (const code of ['DISPATCH_REPLAY_CHANGED', 'DISPATCH_NOT_EDITABLE']) test(`${code} retains local data and never refreshes or retries automatically`, async () => {
  const h = fixture(); if (code === 'DISPATCH_NOT_EDITABLE') open(h);
  const before = structuredClone(h.context.draft), pending = h.run('simulate')('draft');
  h.calls[0].resolve(response({ code, error: 'Conflict' }, 409)); await pending;
  assert.deepEqual(h.context.draft, before); assert.equal(h.state.DispatchConflict, true); assert.equal(h.calls.length, 1);
  assert.equal(h.events.length, 0); assert.ok(h.context.dispatchOperation.current);
});

test('POST replay conflict with unknown ID loads list without discarding local text, then explicit selection validates revision', async () => {
  const h = fixture(); const pending = h.run('simulate')('draft');
  h.calls[0].resolve(response({ code: 'DISPATCH_REPLAY_CHANGED' }, 409)); await pending; renderState(h);
  const draft = structuredClone(h.context.draft), recovery = h.run('discardAndReloadDraft')();
  h.calls[1].resolve(response([storedDraft()])); await recovery; renderState(h);
  assert.deepEqual(h.context.draft, draft); assert.equal(h.context.draftId, null); assert.equal(h.context.dispatchConflict, true);
  assert.match(h.state.Notice, /siguen intactos/);
  let confirms = 0; h.context.window.confirm = () => { confirms++; return true; };
  h.run('selectPublication')('draft:31');
  assert.equal(confirms, 1); assert.equal(h.state.DraftId, '31'); assert.equal(h.state.DraftRevision, revisionA);
});

test('changing origin while dirty requires explicit confirmation and invalid saved revision cannot replace local data', () => {
  const h = fixture(); open(h); h.context.draftEdited.current = true;
  h.context.savedDrafts = [storedDraft('32', revisionB)]; const before = h.effects.length;
  h.context.window.confirm = () => false; h.run('selectPublication')('draft:32'); assert.equal(h.effects.length, before);
  h.context.window.confirm = () => true; h.context.savedDrafts = [storedDraft('32', 'rounded-token')];
  h.run('selectPublication')('draft:32'); assert.equal(h.state.DraftId, '31'); assert.equal(h.state.DraftRevision, revisionA);
});

test('missing revision blocks PATCH locally and revision shape must retain all six fractional digits in ACK', async () => {
  for (const revision of [null, undefined, '', revisionA.replace('123456', '123'), revisionA.replace('123456', '1234567'), revisionA.replace('Z', '+00:00')]) {
    const h = fixture(); h.context.draftId = '31'; h.context.draftRevision = revision;
    await h.run('simulate')('draft'); assert.equal(h.calls.length, 0); assert.equal(h.state.DispatchConflict, true);
    const post = fixture(), pending = post.run('simulate')('draft'); post.calls[0].resolve(response({ ...ack(), revision })); await pending;
    assert.equal(post.calls.length, 1); assert.equal(post.state.DraftId, null); assert.equal(post.events.length, 0);
  }
  assert.match(source, /Descartar mis cambios y cargar versión guardada/);
  assert.equal(nodes(fn('validDispatchRevision'), n => ts.isCallExpression(n) || ts.isNewExpression(n))
    .some(n => /Date|parse/.test(n.expression.getText(file))), false);
});
