import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { createTaskManualOrder } from '../../frontend/src/features/render-os/utils/task-manual-order.js';
import { createCapturedRequest } from '../../frontend/src/shared/session/captured-request.js';

test('manual order upgrade preserves populated history; actual client recovers old receipt without restoring stale order', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55725, deferTaskBoardOrderMigration: true });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' }); });
  const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
  const login = async usuario => ok(await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const admin = await login('qa_franco'), editor = await login('qa_luciano');
  const api = (path, method = 'GET', body, token = admin) => request(f.base, `/api${path}`, { token, method, body });
  const tasks = [];
  for (let i = 0; i < 3; i++) tasks.push(ok(await api('/tareas', 'POST', { titulo: `QA98 upgrade task ${i}`,
    asignado_a_id: 91003, colaborador_ids: [], tipo_tarea: 'diseno', workspace: 'render_os', fecha_vencimiento: '2026-11-03' }), 201));
  const history = async () => {
    const rows = {};
    for (const name of ['usuarios','clientes','tareas','tarea_asignaciones','publicaciones','historias','cliente_objetivos_mensuales',
      'cliente_objetivo_piezas','cliente_objetivo_eventos','produccion_visitas','produccion_videos','production_create_receipts'])
      rows[name] = await f.query(`SELECT * FROM ${name} r ORDER BY to_jsonb(r)::text`);
    return rows;
  };
  await t.test('076 creates only empty shared presentation metadata and no inferred task order', async () => {
    const before = await history();
    assert.equal((await f.query("SELECT nombre FROM _migrations WHERE nombre='076_task_board_order.sql'")).length, 0);
    await f.query(await readFile(new URL('../migrations/076_task_board_order.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await history(), before);
    assert.deepEqual(await f.query('SELECT scope,revision::text AS revision,task_ids FROM task_board_order'),
      [{ scope: 'render_os', revision: '1', task_ids: [] }]);
    assert.deepEqual(await f.query('SELECT * FROM task_board_order_receipts'), []);
    await f.query("INSERT INTO _migrations(nombre) VALUES('076_task_board_order.sql')");
  });
  const page = async (token = editor) => {
    const r = await fetch(new URL('/api/tareas?workspace=render_os&sort=manual', f.base), { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    return { items: await r.json(), revision: r.headers.get('x-task-order-revision'), snapshot: r.headers.get('x-task-order-snapshot') };
  };
  const body = (task, before, revision) => ({ request_id: randomUUID(), task_id: task.id, expected_revision: task.revision,
    before_id: before?.id ?? null, expected_before_revision: before?.revision ?? null, expected_order_revision: revision });
  await t.test('a genuine committed response is lost; explicit same-body verification returns proof, then fresh read retains newer order', async () => {
    const before = await history(), first = await page();
    assert.deepEqual(first.items.map(row => row.id), tasks.map(row => row.id).reverse());
    const session = { token: editor, usuario: { id: 91003, rol: 'edicion', activo: true } }, calls = [];
    let lose = true;
    const model = createTaskManualOrder({ capture: () => createCapturedRequest({ session, readSession: () => session,
      request: async (path, options) => {
        assert.equal(options.headers.Authorization, `Bearer ${editor}`);
        const r = await request(f.base, path, { token: editor, method: options.method, body: JSON.parse(options.body) });
        calls.push({ body: options.body, status: r.status });
        if (r.status >= 400) throw Object.assign(new Error('Principal order rejected'), { status: r.status });
        if (lose) { lose = false; throw new TypeError('Synthetic lost committed order response'); }
        return r.body;
      } }) });
    await assert.rejects(model.move({ task: tasks[0], before: tasks[2], orderRevision: first.revision }));
    assert.equal(model.snapshot.status, 'uncertain'); assert.equal(calls.length, 1);
    const afterFirst = await page();
    assert.deepEqual(afterFirst.items.map(row => row.id), [tasks[0].id,tasks[2].id,tasks[1].id]);
    const newer = ok(await api('/tareas/orden', 'POST', body(tasks[2], tasks[0], afterFirst.revision)));
    const proof = await model.verify();
    assert.equal(calls[0].body, calls[1].body); assert.equal(proof.replayed, true);
    assert.equal(proof.order_revision, afterFirst.revision); assert.notEqual(proof.order_revision, newer.order_revision);
    const fresh = await page(await login('qa_designer'));
    assert.equal(fresh.revision, newer.order_revision);
    assert.deepEqual(fresh.items.map(row => row.id), [tasks[2].id,tasks[0].id,tasks[1].id]);
    assert.deepEqual(await history(), before, 'Ordering does not alter task revisions, assignment, quotas or publication history');
    assert.equal(model.snapshot.locked, false);
  });
  await t.test('BIGINT order versions remain literal strings beyond JavaScript safe integers', async () => {
    await f.query("UPDATE task_board_order SET revision=9007199254740993 WHERE scope='render_os'");
    const current = await page(); assert.equal(current.revision, '9007199254740993');
    const model = createTaskManualOrder({ capture: () => ({ current: () => true, assertCurrent() {},
      request: async (path, options) => ok(await request(f.base, path, { token: editor, method: options.method, body: JSON.parse(options.body) })) }) });
    const result = await model.move({ task: tasks[1], before: tasks[2], orderRevision: current.revision });
    assert.equal(result.order_revision, '9007199254740994');
    const noOp = await model.move({ task: tasks[1], before: tasks[2], orderRevision: result.order_revision });
    assert.equal(noOp.changed, false); assert.equal(noOp.order_revision, result.order_revision);
    assert.equal((await page()).revision, result.order_revision);
  });
  await t.test('more than100k globally eligible tasks reject normalization without truncating stored order', async () => {
    const meta = await f.query('SELECT scope,revision::text AS revision,task_ids FROM task_board_order');
    const receipts = await f.query('SELECT * FROM task_board_order_receipts ORDER BY actor_user_id,request_id');
    await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,propiedades_extra)
      SELECT 'QA98 bounded global scope','QA98 display only','pendiente','{"workspace":"render_os"}'::jsonb
      FROM generate_series(1,100001)`);
    const r = await api('/tareas/orden', 'POST', body(tasks[0], tasks[2], meta[0].revision), editor);
    assert.equal(r.status, 413);
    assert.deepEqual(await f.query('SELECT scope,revision::text AS revision,task_ids FROM task_board_order'), meta);
    assert.deepEqual(await f.query('SELECT * FROM task_board_order_receipts ORDER BY actor_user_id,request_id'), receipts);
    assert.equal((await f.query('SELECT count(*)::int AS count FROM tareas WHERE propiedades_extra->>\'workspace\'=\'render_os\''))[0].count, 100004);
  });
});
