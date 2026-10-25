import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loginProductionCookieSession, productionCookieRequest } from './helpers/production-cookie-session.js';
import { buildEmployeeReport, employeeTaskDetails, employeeFormatBreakdown } from '../../frontend/src/shared/reports/production-registry-report.js';

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

// Real PostgreSQL -> principal cookie HTTP -> real frontend report models.
// Historical stored flags are synthetic fixtures, never fabricated approvals,
// editing deliveries or publication events. No external provider/device claim.
test('report approval projection preserves strict historical booleans and stored rows for admin and editor cookies', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const port = 55965, f = await startLocalHarness({ port, browserSessions: true });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA373 owned fixture cleanup ENOENT: ${f.root}; PostgreSQL port55965`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: 'postgresql://render2_fixture@127.0.0.1:55965/render2_local_test', identity });
  const base = new URL(f.base);
  assert.equal(base.protocol, 'http:'); assert.equal(base.hostname, '127.0.0.1');
  assert.equal(base.pathname, '/'); assert.equal(base.search, ''); assert.equal(base.hash, '');

  const cases = [
    { label: 'boolean true', stored: 'en_revision', extra: { revision_aprobada: true }, effective: 'aprobada' },
    { label: 'string true', stored: 'en_revision', extra: { revision_aprobada: 'true' }, effective: 'en_revision' },
    { label: 'boolean false', stored: 'en_revision', extra: { revision_aprobada: false }, effective: 'en_revision' },
    { label: 'missing flag', stored: 'en_revision', extra: {}, effective: 'en_revision' },
    { label: 'explicit approval', stored: 'aprobada', extra: {}, effective: 'aprobada' },
    { label: 'legacy completion', stored: 'publicada', extra: {}, effective: 'finalizada' },
  ];
  for (const item of cases) {
    const [task] = await f.query(`INSERT INTO tareas
      (titulo,asignado_a,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
      VALUES($1,'QA373 label is not identity',$2,'edicion','video','2026-10-20',$3::jsonb) RETURNING id`,
    [`QA373 ${item.label}`, item.stored, JSON.stringify({ workspace: 'render_os', ...item.extra })]);
    item.id = task.id;
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [item.id]);
  }
  const actors = [
    { id: 91001, role: 'admin', username: 'qa_franco' },
    { id: 91003, role: 'edicion', username: 'qa_luciano' },
  ];
  for (const actor of actors) {
    actor.session = await loginProductionCookieSession(f.base, actor.username, fixturePassword);
    assert.equal(actor.session.user.id, actor.id); assert.equal(actor.session.user.rol, actor.role);
  }
  assert.notEqual(actors[0].session.cookie, actors[1].session.cookie, 'Independent cookie sessions');
  const ids = cases.map(item => item.id);
  // Independent SQL oracle: JSON boolean equality, never ->> text coercion.
  const oracle = await f.query(`SELECT id,estado AS stored,
    CASE WHEN estado='en_revision' AND propiedades_extra->'revision_aprobada'='true'::jsonb
      THEN 'aprobada' ELSE estado END AS effective
    FROM tareas WHERE id=ANY($1::integer[]) ORDER BY id`, [ids]);
  assert.deepEqual(oracle, cases.map(item => ({ id: item.id, stored: item.stored,
    effective: item.stored === 'publicada' ? 'publicada' : item.effective })));

  // Baseline only AFTER fixture setup and both logins. Hash ALL public tables,
  // including auth, events and deliveries; return opaque digests, not financial
  // fields or credentials. xmin/ctid also catch identical-value row UPDATEs.
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row => row.tablename);
  async function snapshot() {
    const hashes = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table] = row.hash;
    }
    return hashes;
  }
  const before = await snapshot();
  const range = Object.freeze({ desde: '2026-10-01', hasta: '2026-11-01' });
  const reportPath = '/api/reportes/datos?mes_configuracion=2026-10&desde=2026-10-01&hasta=2026-10-31';
  for (const actor of actors) await t.test(`${actor.role}: effective approval is not review, finalization or publication`, async () => {
    const response = await productionCookieRequest(f.base, reportPath, { session: actor.session });
    assert.equal(response.status, 200, 'Expected report HTTP success without printing session/body');
    const data = response.body, original = structuredClone(data);
    freezeTree(data);
    const tasks = [...data.tareas, ...data.tareasRenderOs].filter(task => ids.includes(task.id));
    assert.equal(tasks.length, cases.length);
    for (const item of cases) {
      const task = tasks.find(row => row.id === item.id);
      assert.ok(task, item.label); assert.equal(task.estado, item.stored);
      assert.equal(task.asignado_a_id, 91003);
      assert.deepEqual(task.propiedades_extra, { workspace: 'render_os', ...item.extra });
      assert.equal(task.historia_id, null); assert.equal(task.publicacion_id, null);
    }
    const report = buildEmployeeReport(data.usuarios, tasks, range, '2026-10-25');
    const editor = report.rows.find(row => row.id === 91003);
    assert.deepEqual({ total: editor.total, enRevision: editor.enRevision, aprobadas: editor.aprobadas,
      finalizadas: editor.finalizadas, pendientes: editor.pendientes },
    { total: 6, enRevision: 3, aprobadas: 2, finalizadas: 1, pendientes: 5 });
    assert.equal(report.uniqueTasks, 6); assert.equal(report.unattributed, 0);
    assert.equal(report.rows.find(row => row.id === 91001).total, 0, 'Viewer identity does not acquire editor credit');
    const details = employeeTaskDetails(tasks, 91003, range);
    assert.equal(details.length, cases.length);
    for (const item of cases) {
      const detail = details.find(row => row.id === item.id);
      assert.equal(detail.estado, item.effective, item.label);
      assert.equal(detail.estado_almacenado, item.stored, item.label);
      assert.equal(detail.formato, 'reels');
      assert.equal(detail.finalizada, '', 'Approval cannot invent a completion timestamp');
      assert.equal(detail.href, `/workspace/tareas?task=${item.id}`);
    }
    assert.deepEqual(employeeTaskDetails(tasks, 91001, range), []);
    assert.deepEqual(employeeFormatBreakdown(tasks, 91003, range), [
      { formato: 'carruseles', total: 0, finalizadas: 0, enRevision: 0, aprobadas: 0 },
      { formato: 'reels', total: 6, finalizadas: 1, enRevision: 3, aprobadas: 2 },
      { formato: 'historias', total: 0, finalizadas: 0, enRevision: 0, aprobadas: 0 },
      { formato: 'otros', total: 0, finalizadas: 0, enRevision: 0, aprobadas: 0 },
    ]);
    assert.deepEqual(data, original, 'Real report models preserve the deeply frozen HTTP DTO');
    assert.deepEqual(await snapshot(), before, 'Report HTTP/model reads preserve every stored row and physical tuple');
  });
  for(const table of ['historias','publicaciones','editorial_publicacion_eventos','task_editing_deliveries','task_editing_reviews'])
    assert.equal((await f.query(`SELECT count(*)::int n FROM ${table}`))[0].n,0,
      'Read-only approval projection cannot manufacture editorial pieces, publication evidence or artifact decisions');
});
