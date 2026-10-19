import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixtureAccounts, fixturePassword } from '../scripts/render2-local-test.js';

// Deliberately opt-in: normal node --test must never provision PostgreSQL.
test('principal Phase 1 HTTP sessions, DTO privacy and publication boundary', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  // Read before provisioning: missing 055 fails without starting a cluster.
  const goalMigration = await readFile(new URL('../migrations/055_decouple_goal_publication.sql', import.meta.url), 'utf8');
  const fixture = await startLocalHarness({ deferGoalMigration: true });
  t.after(() => fixture.cleanup());
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.ok(result.body.token);
    return result.body.token;
  };
  const [franco, agustin, luciano, designer] = await Promise.all(fixtureAccounts.map(a => login(a.usuario)));
  const claims = jwt.verify(franco, fixture.secret, { issuer: 'render', audience: 'render-api' });
  assert.equal(claims.exp - claims.iat, 8 * 3600);
  assert.equal(claims.rol, undefined);
  assert.equal(claims.session_version, 1);
  for (const token of [franco, agustin, luciano, designer]) assert.equal((await api('/sesion', { token })).status, 200);
  assert.equal((await api('/sesion', { token: franco })).body.usuario.id, 91001);
  assert.equal((await api('/sesion', { token: agustin })).body.usuario.id, 91002);
  const legacy = jwt.sign({ id: 91001, rol: 'admin' }, fixture.secret, { expiresIn: '8h' });
  assert.equal((await api('/sesion', { token: legacy })).status, 401);

  // Separate leaders, not a shared Google identity. A current-role downgrade
  // must affect an already-issued real login session immediately.
  await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=91002");
  assert.equal((await api('/sesion', { token: agustin })).body.usuario.rol, 'diseno');
  assert.equal((await api('/sueldos', { token: agustin })).status, 403);
  const [owners] = await fixture.query("SELECT count(*)::int AS count FROM usuarios WHERE rol='admin' AND activo=TRUE");
  assert.equal(owners.count, 1, 'Franco must be the only active fixture administrator after downgrade');
  assert.equal((await api('/usuarios/91001', { token: franco, method: 'PATCH',
    body: { nombre: 'Franco QA', usuario: 'qa_franco', rol: 'diseno' } })).status, 409);
  assert.equal((await api('/usuarios/91001', { token: franco, method: 'DELETE' })).status, 409);
  assert.equal((await api('/usuarios/91001/acceso', { token: franco, method: 'PATCH', body: { activo: false } })).status, 409);
  assert.equal((await api('/sesion', { token: franco })).body.usuario.rol, 'admin');
  await fixture.query(`INSERT INTO entregas_edicion
    (editor_clave,fecha_entrega,cliente_etiqueta,categoria,importe,fuente,fuente_item,confirmado_por)
    VALUES ('Luciano QA','2026-10-19','QA sentinel','A',987654.32,'render2-fixture',91003,'Franco QA')`);
  const [privateTask] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
    VALUES ('QA nonempty ID report','Luciano QA','edicion','pendiente',
      '{"workspace":"render_os","importe":987654.32}') RETURNING id`);
  await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [privateTask.id]);
  const leaderReport = await api('/reportes/datos', { token: franco });
  assert.equal(leaderReport.status, 200);
  assert.ok(leaderReport.body.entregasEdicion.some(row => Number(row.importe) === 987654.32));
  const report = await api('/reportes/datos', { token: luciano });
  assert.equal(report.status, 200);
  const assertNoMoney = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/^(importe|sueldo_base|tarifa_facil|tarifa_intermedia|monto|salario|cuota_mensual)$/.test(key), `Money field leaked: ${key}`);
      assertNoMoney(child);
    }
  };
  assertNoMoney(report.body);
  assert.deepEqual(report.body.entregasEdicion, [], 'Name-only historical deliveries must not infer an employee identity');
  assert.ok(report.body.tareasRenderOs.some(row => row.id === privateTask.id && row.asignado_a_id === 91003), 'Employee must see a real nonempty ID-bound DTO without its stored amount');
  const designerReport = await api('/reportes/datos', { token: designer });
  assert.equal(designerReport.status, 200);
  assertNoMoney(designerReport.body);
  assert.equal((await api('/sueldos', { token: luciano })).status, 403);

  assert.equal((await api('/usuarios/91003/acceso', { token: franco, method: 'PATCH', body: { activo: false } })).status, 200);
  assert.equal((await api('/sesion', { token: luciano })).status, 401);
  assert.equal((await api('/login', { method: 'POST', body: { usuario: 'qa_luciano', password: fixturePassword } })).status, 401);
  const second = await login('qa_franco');
  assert.equal((await api('/logout', { token: franco, method: 'POST' })).status, 200);
  assert.equal((await api('/sesion', { token: second })).status, 401);
  assert.equal((await api('/sesion', { token: franco })).status, 401);
  const fresh = await login('qa_franco');

  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA publication boundary') RETURNING id");
  const [piece] = await fixture.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada) VALUES ($1,'video','lista','2026-10-19') RETURNING id", [client.id]);
  const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,publicacion_id,propiedades_extra)
    VALUES ('QA completion','Franco QA','en_revision',$1,'{"workspace":"render_os","origen_pieza":true,"revision_aprobada":true}') RETURNING id`, [piece.id]);
  const [goal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales
    (clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
    VALUES ('qa-goal','2026-10-01',$1,'QA linked goal',2,0,'Franco QA') RETURNING id`, [client.id]);
  const [slot] = await fixture.query(`INSERT INTO cliente_objetivo_piezas
    (objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,estado)
    VALUES ($1,'video',1,$2,$3,'QA completion','en_revision') RETURNING id`, [goal.id, task.id, piece.id]);
  const [published] = await fixture.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,fecha_publicación_real)
    VALUES ($1,'video','publicada','2026-09-19','2026-09-19T15:12:00Z') RETURNING id`, [client.id]);
  const [publishedTask] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,publicacion_id,propiedades_extra)
    VALUES ('QA published history','Franco QA','en_revision',$1,'{"workspace":"render_os","revision_aprobada":true}') RETURNING id`, [published.id]);
  const [publishedSlot] = await fixture.query(`INSERT INTO cliente_objetivo_piezas
    (objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,estado)
    VALUES ($1,'video',2,$2,$3,'QA published history','en_revision') RETURNING id`, [goal.id, publishedTask.id, published.id]);
  const [historicalEvent] = await fixture.query(`INSERT INTO cliente_objetivo_eventos
    (pieza_id,estado_anterior,estado_nuevo,tarea_id,created_at)
    VALUES ($1,'pendiente','en_revision',$2,'2026-09-19T15:00:00Z') RETURNING id`, [publishedSlot.id, publishedTask.id]);
  // Snapshots include all baseline rows, historical dates, metadata and audit
  // events, not just the new fixture. 055 must be forward DDL, never a backfill.
  const history = async () => {
    const snapshots = {};
    for (const table of ['publicaciones', 'historias', 'tareas', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'])
      snapshots[table] = await fixture.query(`SELECT * FROM ${table} ORDER BY id`);
    return snapshots;
  };
  const before = await history();
  assert.equal((await fixture.query("SELECT nombre FROM _migrations WHERE nombre='055_decouple_goal_publication.sql'")).length, 0);
  await fixture.query(goalMigration);
  assert.deepEqual(await history(), before, 'Installing 055 must preserve all existing editorial/task/goal history');
  await fixture.query("INSERT INTO _migrations(nombre) VALUES ('055_decouple_goal_publication.sql')");
  await fixture.query(await readFile(new URL('../migrations/058_task_work_states.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await history(), before, 'Installing 058 also preserves all historical rows');
  await fixture.query("INSERT INTO _migrations(nombre) VALUES ('058_task_work_states.sql')");
  const changeState = async (id, estado) => {
    const detail = await api(`/tareas/${id}?workspace=render_os`, { token: fresh });
    const changed = await api(`/tareas/${id}?workspace=render_os`, { token: fresh, method: 'PATCH',
      body: { estado, expected_revision: detail.body.revision } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    return changed;
  };
  await t.test('installed goal trigger: API and direct SQL completion/reopen preserve editorial state/date', async () => {
    for (const linked of [{ task, piece, slot }, { task: publishedTask, piece: published, slot: publishedSlot }]) {
      const [editorialBefore] = await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [linked.piece.id]);
      for (const channel of ['API', 'SQL']) {
        for (const estado of channel === 'API' ? ['aprobada', 'finalizada', 'en_revision'] : ['publicada', 'en_revision']) {
          if (channel === 'API') {
            await changeState(linked.task.id, estado);
          } else await fixture.query('UPDATE tareas SET estado=$1 WHERE id=$2', [estado, linked.task.id]);
          const [tracked] = await fixture.query('SELECT estado,completada_at FROM cliente_objetivo_piezas WHERE id=$1', [linked.slot.id]);
          assert.equal(tracked.estado, estado, `${channel} must track goal status`);
          assert.equal(tracked.completada_at !== null, ['publicada', 'finalizada'].includes(estado), `${channel} must track completion/reopening`);
          const [editorialAfter] = await fixture.query('SELECT * FROM publicaciones WHERE id=$1', [linked.piece.id]);
          assert.deepEqual(editorialAfter, editorialBefore, `${channel} ${estado} must not change editorial row/date`);
        }
      }
      const events = await fixture.query('SELECT estado_anterior,estado_nuevo,tarea_id FROM cliente_objetivo_eventos WHERE pieza_id=$1 AND id>$2 ORDER BY id', [linked.slot.id, historicalEvent.id]);
      const states = ['en_revision','aprobada','finalizada','en_revision','publicada','en_revision'];
      assert.deepEqual(events, states.slice(1).map((estado_nuevo, index) => ({
        estado_anterior: states[index], estado_nuevo, tarea_id: linked.task.id,
      })), 'Both paths must keep distinct approval/finalization goal event history');
    }
  });
  await changeState(task.id, 'aprobada');
  const completed = await changeState(task.id, 'publicada'); // Legacy input is canonicalized, not editorial publication.
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.estado, 'finalizada');
  const [unchanged] = await fixture.query('SELECT estado, fecha_publicación_real FROM publicaciones WHERE id=$1', [piece.id]);
  assert.equal(unchanged.estado, 'lista');
  assert.equal(unchanged.fecha_publicación_real, null);
});
