import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { canRetryTaskUpdate } from '../../frontend/src/features/render-os/utils/task-state.js';
import { createProductionDraft, productionMediaDraft } from '../../frontend/src/pages/productionDraft.js';

test('actual task callbacks preserve reviewed revisions against real concurrent HTTP changes', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55717 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), { code: 'ENOENT' });
    t.diagnostic('Own observed-review PostgreSQL fixture stopped and removed');
  });
  const ok = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const api = (token, path, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const login = async usuario => ok(await api(null, '/login', 'POST', { usuario, password: fixturePassword })).token;
  const owner = await login('qa_franco'), other = await login('qa_agustin');
  const sesion = { token: owner, usuario: { id: 91001, rol: 'admin', nombre: 'QA observed reviewer' } };
  const source = readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
  const begin = source.indexOf('  const logActivity ='), end = source.indexOf('  const createTask =', begin);
  const approvalStart = source.indexOf('  const approveTask ='), approvalEnd = source.indexOf('  const bulkTaskAction =', approvalStart);
  assert.ok(begin >= 0 && end > begin && approvalStart >= 0 && approvalEnd > approvalStart);
  const callbacks = source.slice(begin, end) + source.slice(approvalStart, approvalEnd);
  const detail = async id => ok(await api(owner, `/tareas/${id}?workspace=render_os`));
  const patch = async (task, body) => ok(await api(other, `/tareas/${task.id}?workspace=render_os`, 'PATCH', { ...body, expected_revision: task.revision }));
  async function create() {
    let task = ok(await api(owner, '/tareas', 'POST', { titulo: 'QA observed design', workspace: 'render_os',
      tipo_tarea: 'diseno', asignado_a_id: 91004, colaborador_ids: [], aclaraciones: 'Original reviewed material' }), 201);
    task = await patch(task, { estado: 'en_progreso' });
    task = await patch(task, { estado: 'en_revision' });
    return detail(task.id);
  }
  function client(task, queue = null) {
    const calls = [], notices = [], tasksRef = { current: [task] };
    let rendered = [task];
    const guard = { current: () => true, assertCurrent() {}, async request(path, options = {}) {
      const result = await request(fixture.base, path, { token: owner, method: options.method || 'GET',
        body: options.body === undefined ? undefined : JSON.parse(options.body) });
      calls.push({ method: options.method || 'GET', path, status: result.status });
      if (result.status >= 400) throw Object.assign(new Error(result.body?.error || 'Synthetic principal conflict'), { status: result.status });
      return result.body;
    } };
    const deps = { sesion, tasksRef, updateQueuesRef: { current: new Map(queue ? [[task.id, queue]] : []) }, clients: [], users: [],
      setTasks: fn => { rendered = fn(rendered); }, notify: message => notices.push(message),
      canRetryTaskUpdate, isSessionFailure: error => error?.status === 401, captureRequest: () => guard };
    const actual = new Function('deps', `const {sesion,tasksRef,updateQueuesRef,clients,users,setTasks,notify,canRetryTaskUpdate,isSessionFailure,captureRequest}=deps;\n${callbacks}\nreturn {updateTask,approveTask};`)(deps);
    return { ...actual, tasksRef, calls, notices, get rendered() { return rendered; } };
  }
  await t.test('a non-editing approval never replaces its reviewed revision after content changes', async () => {
    const observed = await create(), ui = client(observed);
    const fresh = await patch(observed, { aclaraciones: 'Concurrent material not reviewed by owner' });
    await assert.rejects(ui.approveTask(observed, undefined), { status: 409 });
    assert.deepEqual(ui.calls.filter(row => row.method === 'PATCH').map(row => row.status), [409]);
    const kept = await detail(observed.id);
    assert.equal(kept.estado, 'en_revision'); assert.equal(kept.aclaraciones, fresh.aclaraciones);
    assert.equal(kept.revision, fresh.revision, 'No hidden retry or approval write');
    assert.equal(ui.tasksRef.current[0].revision, fresh.revision, 'Fresh content is available for explicit review');
    const reviewedAgain = client(kept);
    await reviewedAgain.approveTask(kept, undefined);
    assert.equal((await detail(kept.id)).estado, 'aprobada');
    assert.deepEqual(reviewedAgain.calls.filter(row => row.method === 'PATCH').map(row => row.status), [200]);
  });
  await t.test('finalization conflicts are not automatically rebased even when state stayed approved', async () => {
    let observed = await create(); observed = await patch(observed, { estado: 'aprobada' });
    const ui = client(observed), fresh = await patch(observed, { prioridad: 'alta' });
    await assert.rejects(ui.updateTask(observed.id, { estado: 'finalizada' }, null), { status: 409 });
    assert.deepEqual(ui.calls.filter(row => row.method === 'PATCH').map(row => row.status), [409]);
    const kept = await detail(observed.id);
    assert.equal(kept.estado, 'aprobada'); assert.equal(kept.prioridad, 'alta'); assert.equal(kept.revision, fresh.revision);
  });
  await t.test('ordinary disjoint edits retain their compatible CAS retry', async () => {
    const observed = await create(), ui = client(observed);
    await patch(observed, { prioridad: 'alta' });
    const updated = await ui.updateTask(observed.id, { titulo: 'QA explicitly renamed' }, null);
    assert.equal(updated.titulo, 'QA explicitly renamed'); assert.equal(updated.prioridad, 'alta');
    assert.deepEqual(ui.calls.filter(row => row.method === 'PATCH').map(row => row.status), [409, 200]);
    assert.equal((await detail(observed.id)).titulo, updated.titulo);
  });
  await t.test('a queued finalization cannot acquire a newer loaded revision while waiting', async () => {
    let observed = await create(); observed = await patch(observed, { estado: 'aprobada' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const ui = client(observed, gate);
    const pending = ui.updateTask(observed.id, { estado: 'finalizada' }, null);
    const rejection = assert.rejects(pending, { status: 409 });
    try {
      const fresh = await patch(observed, { prioridad: 'alta' });
      ui.tasksRef.current = [fresh];
    } finally { release(); }
    await rejection;
    assert.equal(ui.calls.length, 0, 'Queue advancement must not produce an unreviewed PATCH');
    assert.equal((await detail(observed.id)).estado, 'aprobada');
  });
  await t.test('an observed approval cannot adopt a newer locally loaded task either', async () => {
    const observed = await create(), ui = client(observed);
    const fresh = await patch(observed, { aclaraciones: 'A newer locally loaded version' });
    ui.tasksRef.current = [fresh];
    await assert.rejects(ui.approveTask(observed, undefined), { status: 409 });
    assert.equal(ui.calls.length, 0, 'Mismatch is rejected before HTTP');
    assert.equal((await detail(observed.id)).estado, 'en_revision');
  });
  await t.test('production refresh cannot relabel an old video draft with a newer aggregate revision', async () => {
    const [clientRow] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES('QA95 observed production',true) RETURNING id");
    let visit = ok(await api(owner, '/producciones', 'POST', { cliente_id: clientRow.id, fecha: '2026-11-03',
      titulo: 'QA95 observed recording', participante_ids: [91001, 91002], drive_url: 'https://example.invalid/qa95' }), 201).visita;
    const route = `/producciones/${visit.id}`;
    visit = ok(await api(owner, `${route}/videos`, 'POST', { expected_revision: visit.revision,
      titulo: 'QA95 planned video', guion: 'QA95 preserved script', estado: 'planificado' }), 201).visita;
    const videoId = visit.videos[0].id;
    const projection = value => productionMediaDraft(value.videos.find(row => row.id === videoId), 'videos');
    const model = createProductionDraft(visit, projection(visit));
    model.edit({ ...model.snapshot.draft, observaciones: 'QA95 local draft must survive' });
    const latest = ok(await api(other, `${route}/videos/${videoId}`, 'PATCH', { expected_revision: visit.revision,
      estado: 'grabado', material_url: 'https://example.invalid/qa95-recorded' })).visita;
    model.observe(latest, projection(latest));
    assert.equal(model.snapshot.draft.estado, 'planificado', 'Local text/state is preserved, not silently rebased');
    assert.equal(model.snapshot.draft.observaciones, 'QA95 local draft must survive');
    assert.equal(model.snapshot.visit.revision, visit.revision);
    assert.throws(() => model.begin(latest), { status: 409 });
    let saved = ok(await api(owner, route)).visita;
    assert.equal(saved.revision, latest.revision); assert.equal(saved.videos[0].estado, 'grabado');
    assert.equal(model.beginReload(() => false), false, 'Cancel keeps original draft');
    assert.equal(model.snapshot.draft.observaciones, 'QA95 local draft must survive');
    assert.equal(model.beginReload(() => true), true);
    saved = ok(await api(owner, route)).visita;
    model.complete(saved, projection(saved));
    model.edit({ ...model.snapshot.draft, observaciones: 'QA95 reviewed fresh material' });
    const intent = model.begin(saved);
    const result = ok(await api(owner, `${route}/videos/${videoId}`, 'PATCH', {
      ...intent.draft, expected_revision: intent.visit.revision,
    })).visita;
    model.complete(result, projection(result));
    const reloaded = ok(await api(await login('qa_agustin'), route)).visita;
    assert.equal(reloaded.videos.length, 1); assert.equal(reloaded.videos[0].estado, 'grabado');
    assert.equal(reloaded.videos[0].guion, 'QA95 preserved script');
    assert.equal(reloaded.videos[0].material_url, 'https://example.invalid/qa95-recorded');
    assert.equal(reloaded.videos[0].observaciones, 'QA95 reviewed fresh material');
  });
});
