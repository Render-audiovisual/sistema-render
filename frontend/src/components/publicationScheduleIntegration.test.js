import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DISPATCH_TIME_ZONE, dispatchScheduleFields, dispatchScheduleInstant, dispatchToday } from './publicationSchedule.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';

// Real source callbacks + actual schedule/session helpers, injected transport.
// No browser clock/env mutation, providers, listeners, storage or server.
const source = readFileSync(new URL('./PublicationComposer.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PublicationComposer.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) { const out = []; const visit = n => { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); }; visit(root); return out; }
const fn = name => { const n = nodes(ast, ts.isFunctionDeclaration).find(n => n.name?.text === name); assert.ok(n, name); return n; };
const callback = name => { const n = nodes(ast, ts.isVariableDeclaration).find(n => n.name.getText(ast) === name); assert.ok(n, name); return n.initializer; };
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(ast)});`)(...Object.values(deps));
const helpers = { DISPATCH_TIME_ZONE, dispatchScheduleFields, dispatchScheduleInstant, dispatchToday };
const emptyDraft = evaluate(fn('emptyDraft'), helpers);
const savedDraft = evaluate(fn('savedDraft'), { ...helpers, emptyDraft });
const validDispatchRevision = evaluate(fn('validDispatchRevision'), {});
const validDispatchAck = evaluate(fn('validDispatchAck'), { validDispatchRevision });
const revision = '2026-10-20T12:00:00.123456Z';
const observed = '2026-10-21T01:30:00.654321Z';
const client = { id: 31, nombre: 'QA client' };
const saved = (scheduledAt = observed) => ({ id: '9007199254740993', revision, status: 'borrador', previewOnly: true,
  clientId: client.id, publicationId: 19, type: 'reel', caption: 'Keep caption', firstComment: '', scheduledAt,
  assets: [{ url: 'https://drive.google.com/file/d/qa' }], targets: [{ platform: 'instagram' }], options: {} });

function fixture(draft, { id = null, heldRevision = null, failFirst = false } = {}) {
  const session = { token: 'synthetic-schedule-only', usuario: { id: 7, rol: 'community', activo: true } };
  const requests = [], changes = [], events = []; let keys = 0;
  const context = { ...helpers, validDispatchRevision, validDispatchAck, draft,
    draftId: id, draftRevision: heldRevision, dispatchConflict: false,
    pending: { current: false }, dispatchOperation: { current: null }, draftEdited: { current: true },
    draftsGeneration: { current: 0 }, uploadRecoveryModel: { current: null },
    canPublish: true, validation: '', uploads: [], uploadedAssets: [],
    window: { crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}` }, dispatchEvent: event => events.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type; } },
    captureRequest() {
      const guard = createCapturedRequest({ session, readSession: () => session, request: async (url, options) => {
        requests.push({ url, options });
        if (failFirst && requests.length === 1) throw new TypeError('Synthetic uncertain transport');
        const body = JSON.parse(options.body);
        return { id: id || '41', revision: '2026-10-20T12:00:00.123457Z', previewOnly: true,
          status: body.mode === 'draft' ? 'borrador' : body.mode === 'schedule' ? 'programada' : 'lista_para_publicar' };
      } });
      return { ...guard, signal: new AbortController().signal, release() {} };
    },
    async refreshDrafts(guard) { guard.assertCurrent(); return { ok: true }; },
  };
  for (const [setter, field] of [['setDraftId', 'draftId'], ['setDraftRevision', 'draftRevision'], ['setDispatchConflict', 'dispatchConflict'],
    ['setSaving', 'saving'], ['setNotice', 'notice'], ['setSourceSelection', 'sourceSelection']]) {
    context[setter] = value => { context[field] = value; changes.push([field, value]); };
  }
  return { context, requests, changes, events, get keys() { return keys; }, run: mode => evaluate(callback('simulate'), context)(mode) };
}

test('actual savedDraft opens 22:30 Córdoba on previous civil day and unchanged PATCH preserves exact observed instant and CAS', async () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const row = saved(), draft = savedDraft(row, [client]);
  assert.equal(draft.date, '2026-10-20'); assert.equal(draft.time, '22:30'); assert.equal(draft.observedScheduledAt, observed);
  const h = fixture(draft, { id: row.id, heldRevision: row.revision }); await h.run('draft');
  assert.equal(h.requests.length, 1); const request = h.requests[0], body = JSON.parse(request.options.body);
  assert.equal(request.url, `/api/publicacion-envios/${row.id}`); assert.equal(request.options.method, 'PATCH');
  assert.equal(body.scheduledAt, observed, 'Preserve seconds/microseconds: no Date roundtrip of unchanged observation');
  assert.equal(body.expectedRevision, revision); assert.equal(body.caption, row.caption); assert.equal(body.publicationId, row.publicationId);
  assert.equal(h.context.dispatchOperation.current, null); assert.deepEqual(h.events, ['render:publication-preview-updated']);
});

test('actual emptyDraft uses Córdoba helper, while a stored null schedule restores blank fields and can POST null', async () => {
  let todayCalls = 0;
  const initial = evaluate(fn('emptyDraft'), { dispatchToday: () => { todayCalls++; return '2026-10-20'; } })(null, [client]);
  assert.equal(todayCalls, 1); assert.equal(initial.date, '2026-10-20'); assert.equal(initial.time, '09:00');
  const publication = evaluate(fn('emptyDraft'), { dispatchToday: () => assert.fail('Existing publication date must win') })({ fecha_programada: '2026-10-19' }, [client]);
  assert.equal(publication.date, '2026-10-19');
  const restored = savedDraft(saved(null), [client]);
  assert.equal(restored.date, ''); assert.equal(restored.time, ''); assert.equal(restored.observedScheduledAt, null);
  const h = fixture(restored); await h.run('draft');
  const body = JSON.parse(h.requests[0].options.body);
  assert.equal(h.requests[0].url, '/api/publicacion-envios'); assert.equal(h.requests[0].options.method, 'POST');
  assert.equal(body.scheduledAt, null); assert.equal(Object.hasOwn(body, 'expectedRevision'), false);
});

test('explicitly changed civil date/time serializes Córdoba instead of preserving stale observed instant', async () => {
  const draft = { ...savedDraft(saved(), [client]), time: '23:15' };
  const h = fixture(draft, { id: saved().id, heldRevision: revision }); await h.run('draft');
  assert.equal(JSON.parse(h.requests[0].options.body).scheduledAt, '2026-10-21T02:15:00.000Z');
  assert.equal(JSON.parse(h.requests[0].options.body).expectedRevision, revision);
});

test('null and partially specified schedules cannot silently become a programmed instant', async () => {
  for (const mode of ['schedule', 'now']) for (const fields of [{ date: '', time: '' }, { date: '2026-10-20', time: '' }, { date: '', time: '22:30' }]) {
    const h = fixture({ ...savedDraft(saved(null), [client]), ...fields }); await h.run(mode);
    assert.equal(h.requests.length, 0); assert.equal(h.keys, 0); assert.equal(h.context.pending.current, false);
    assert.match(h.context.notice, /fecha y hora válidas/i);
  }
});

test('malformed stored schedule is rejected by actual openSavedDraft before any input/upload/receipt mutation', () => {
  for (const bad of ['not-a-date', '2026-02-30T01:00:00Z', '2026-10-20T25:00:00Z', '2026-10-20', 123, {}, []]) {
    const local = { caption: 'Unsaved local text', date: '2026-10-20', time: '22:30' }, effects = [];
    const uploads = [{ previewUrl: 'blob:own-synthetic' }], uploadsRef = { current: uploads }, fileInputRef = { current: { value: 'own selection' } };
    const operation = Object.freeze({ requestKey: 'keep-recovery' }), dispatchOperation = { current: operation }, draftEdited = { current: true };
    const deps = { validDispatchAck, savedDraft, clients: [client], uploadRecoveryModel: { current: null },
      uploadsRef, fileInputRef, dispatchOperation, draftEdited,
      URL: { revokeObjectURL: value => effects.push(['revoke', value]) } };
    for (const name of ['Uploads', 'UploadedAssets', 'UploadProgress', 'FileError', 'DraftId', 'DraftRevision', 'Draft', 'SourceSelection', 'ShowDriveField', 'DispatchConflict']) {
      deps[`set${name}`] = value => effects.push([name, value]);
    }
    const open = evaluate(callback('openSavedDraft'), deps);
    assert.throws(() => open(saved(bad)));
    assert.deepEqual(effects, []); assert.equal(uploadsRef.current, uploads); assert.equal(fileInputRef.current.value, 'own selection');
    assert.equal(dispatchOperation.current, operation); assert.equal(draftEdited.current, true); assert.equal(local.caption, 'Unsaved local text');
  }
});

test('uncertain retry keeps the same requestKey/body including exact schedule and observed CAS; changed intent gets a new key', async () => {
  const h = fixture(savedDraft(saved(), [client]), { id: saved().id, heldRevision: revision, failFirst: true });
  await h.run('draft'); assert.equal(h.requests.length, 1); assert.ok(h.context.dispatchOperation.current);
  const first = h.requests[0].options.body; await h.run('draft');
  assert.equal(h.requests[1].options.body, first); assert.equal(h.keys, 1);
  assert.equal(JSON.parse(first).expectedRevision, revision); assert.equal(JSON.parse(first).scheduledAt, observed);
  h.context.draft = { ...h.context.draft, time: '23:00' }; await h.run('draft');
  assert.equal(h.keys, 2); assert.notEqual(JSON.parse(h.requests[2].options.body).requestKey, JSON.parse(first).requestKey);
  assert.equal(JSON.parse(h.requests[2].options.body).scheduledAt, '2026-10-21T02:00:00.000Z');
});

test('actual preview and queue formatters explicitly use Córdoba regardless of the supplied browser default timezone', () => {
  const expected = new Intl.DateTimeFormat('es-AR', { timeZone: DISPATCH_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(observed));
  for (const browserZone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    const optionsSeen = [];
    const intl = { DateTimeFormat: function(locale, options) { optionsSeen.push(options); return new Intl.DateTimeFormat(locale, { timeZone: browserZone, ...options }); } };
    const label = evaluate(fn('dateTimeLabel'), { ...helpers, Intl: intl });
    const queue = evaluate(fn('dispatchDateTimeLabel'), { ...helpers, Intl: intl, dateTimeLabel: label });
    assert.equal(label('2026-10-20', '22:30'), expected);
    assert.equal(queue(saved()), expected); assert.equal(queue({ scheduledAt: null, date: '', time: '' }), 'Sin fecha');
    for(const scheduledAt of ['malformed',0,false,[],{}])assert.equal(queue({scheduledAt}), 'Fecha guardada no válida');
    assert.ok(optionsSeen.every(options => options.timeZone === 'America/Argentina/Cordoba'));
  }
});

test('actual composer and queue JSX render the reviewed formatters, not a second browser-local date path', () => {
  const calls = nodes(ast, ts.isCallExpression);
  assert.ok(calls.some(n => n.expression.getText(ast) === 'dateTimeLabel' && n.arguments.map(n => n.getText(ast)).join(',') === 'draft.date,draft.time'));
  assert.ok(calls.some(n => n.expression.getText(ast) === 'dispatchDateTimeLabel' && n.arguments[0]?.getText(ast) === 'item'));
  assert.ok(nodes(fn('savedDraft'), ts.isCallExpression).some(n => n.expression.getText(ast) === 'dispatchScheduleFields'));
  assert.ok(nodes(callback('simulate'), ts.isCallExpression).some(n => n.expression.getText(ast) === 'dispatchScheduleInstant'));
});
