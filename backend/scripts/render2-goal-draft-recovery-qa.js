// Manual browser QA fixture only. Requires opt-in; never reads configured DB URLs.
// SIGUSR1: one peer edit. SIGUSR2: remove, then restore assignment. SIGTERM: verify/clean.
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity, request, fixturePassword } from './render2-local-test.js';
assert.equal(process.env.RENDER2_RUN_LOCAL_INTEGRATION, 'true');
let f, finish, queue = Promise.resolve(), failure, peerChanges = 0, permissionChanges = 0;
const stopped = new Promise(resolve => finish = resolve), timer = setTimeout(finish, 3600000);
process.once('SIGTERM', finish);
try {
  f = await startLocalHarness({ port: 55849, browserSessions: true, browserPort: 52812 });
  const [identity] = await f.query(`SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55849,
    url: 'postgresql://render2_fixture@127.0.0.1:55849/render2_local_test', identity });
  const login = await request(f.base, '/api/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } });
  assert.equal(login.status, 200); const token = login.body.token;
  const api = (path, body, method = 'GET') => request(f.base, path, { token, method, ...(body === undefined ? {} : { body }) });
  const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
  const [client] = await f.query("INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles,fecha_inicio) VALUES('QA191 Cliente concurrente',true,1,0,'2026-10-01') RETURNING id");
  const overview = ok(await api('/api/cliente-objetivos?periodo=2026-10'));
  const observed = overview.clientes.find(c => c.cuentas.some(a => a.id === client.id)); assert.ok(observed);
  const prepared = ok(await api('/api/cliente-objetivos/preparar', { periodo: '2026-10', clave: observed.clave,
    responsables: [91003], responsables_por_formato: { video: [91003], carrusel: [] },
    expected_preparation_revision: observed.preparacion_revision }, 'POST'));
  const [piece] = await f.query("SELECT id,tarea_id FROM cliente_objetivo_piezas WHERE objetivo_id=$1 AND tipo='video'", [prepared.objetivo_id]);
  const current = () => api(`/api/tareas/${piece.tarea_id}?workspace=render_os`).then(ok);
  const first = await current();
  ok(await api(`/api/cliente-objetivos/piezas/${piece.id}/contenido`, { titulo: first.titulo, copy: 'QA191 contenido original',
    expected_updated_at: first.updated_at, expected_revision: first.revision }, 'PATCH'));
  const tables = ['clientes', 'cliente_configuraciones', 'tareas', 'tarea_asignaciones', 'publicaciones',
    'historias', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'];
  const snapshot = async () => {
    const out = {};
    for (const table of tables) out[table] = await f.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return out;
  };
  let expected = await snapshot();
  const enqueue = run => { queue = queue.then(run).catch(error => {
    failure = error; console.log(JSON.stringify({ stage: 'failure', message: error.message })); finish();
  }); };
  const peer = () => enqueue(async () => {
    assert.equal(peerChanges, 0); assert.deepEqual(await snapshot(), expected);
    const held = await current();
    const saved = ok(await api(`/api/cliente-objetivos/piezas/${piece.id}/contenido`, { titulo: held.titulo,
      copy: 'QA191 contenido más reciente del dueño', expected_updated_at: held.updated_at,
      expected_revision: held.revision }, 'PATCH'));
    assert.ok(saved.revision > held.revision); peerChanges++; expected = await snapshot();
    console.log(JSON.stringify({ stage: 'peer_changed', revision: saved.revision }));
  });
  const permission = () => enqueue(async () => {
    assert.equal(peerChanges, 1); assert.ok(permissionChanges < 2); assert.deepEqual(await snapshot(), expected);
    const held = await current(), target = permissionChanges === 0 ? 91004 : 91003;
    const changed = ok(await api(`/api/tareas/${piece.tarea_id}?workspace=render_os`, { asignado_a_id: target,
      colaborador_ids: [], expected_updated_at: held.updated_at, expected_revision: held.revision }, 'PATCH'));
    assert.equal(changed.asignado_a_id, target); assert.ok(changed.revision > held.revision);
    permissionChanges++; expected = await snapshot();
    console.log(JSON.stringify({ stage: permissionChanges === 1 ? 'permission_removed' : 'permission_restored', revision: changed.revision, actor: target }));
  });
  process.on('SIGUSR1', peer); process.on('SIGUSR2', permission);
  console.log(JSON.stringify({ stage: 'ready', pid: process.pid, root: f.root, base: f.base,
    clientId: client.id, pieceId: piece.id, taskId: piece.tarea_id }));
  await stopped; process.off('SIGUSR1', peer); process.off('SIGUSR2', permission); await queue;
  if (failure) throw failure;
  assert.equal(peerChanges, 1); assert.equal(permissionChanges, 2); assert.deepEqual(await snapshot(), expected);
  const final = await current();
  assert.equal(final.propiedades_extra.copy_trabajo, 'QA191 contenido más reciente del dueño');
  assert.equal(final.asignado_a_id, 91003);
  console.log(JSON.stringify({ stage: 'verified', unchangedAfterIntentionalWrites: tables.length,
    peerChanges, permissionChanges, finalRevision: final.revision }));
} finally {
  clearTimeout(timer);
  if (f) {
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    console.log(JSON.stringify({ stage: 'cleanup', root: f.root, absent: true }));
  }
}
