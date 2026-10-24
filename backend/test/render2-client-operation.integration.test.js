import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Fixture SQL is deliberately synthetic volume/history, not inferred production data.
test('client operation hub: shared operational cohorts, closed privacy and read-only principal HTTP', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55745 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA107 cleanup ENOENT: ${f.root}; PostgreSQL port55745`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55745,
    url: 'postgresql://render2_fixture@127.0.0.1:55745/render2_local_test', identity });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), staff = await login('qa_luciano');
  const period = '2026-10', marker = 'QA107_PRIVATE_FINANCE_CANARY', amount = 817293.46;
  const [group] = await f.query(`INSERT INTO grupos_feed(nombre,cuota_reels,cuota_carruseles)
    VALUES ('QA107 shared feed',3,2) RETURNING id`);
  const clients = await f.query(`INSERT INTO clientes(nombre,activo,grupo_feed_id,rubro)
    VALUES ('QA107 account A',true,$1,'Servicios'),('QA107 account B',true,$1,'Servicios') RETURNING id,nombre`, [group.id]);
  const [a, b] = clients;
  await f.query(`INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por)
    VALUES ($1,'2026-10-01',$2,$3),($4,'2026-10-01',$2,$3)`, [a.id, amount, marker, b.id]);
  const bag = JSON.stringify({ workspace: 'render_os', private_finance: { amount, marker } });
  const states = ['pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizada', 'publicada', 'en_revision', 'pendiente'];
  const taskIds = [];
  for (const [n, state] of states.entries()) {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
      VALUES ($1,'Fixture unassigned by ID',$2,$3,'edicion',$4::jsonb) RETURNING id`,
    [`QA107 task ${n}`, a.id, state, JSON.stringify({ ...JSON.parse(bag), ...(n === 6 ? { revision_aprobada: true } : {}) })]);
    taskIds.push(row.id);
  }
  for (const extra of [{ workspace: 'render_os', archivada_render_os: true },
    { workspace: 'render_os', papelera_render_os: 'true' }, { workspace: 'legacy' }]) {
    await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
      VALUES ('QA107 excluded task','Fixture',$1,'pendiente','edicion',$2::jsonb)`, [a.id, JSON.stringify(extra)]);
  }
  await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
    VALUES ('QA107 other account task','Fixture',$1,'pendiente','edicion',$2::jsonb)`, [b.id, bag]);

  const projectIds = [];
  for (let n = 0; n < 8; n++) {
    const project = ok(await api('/proyectos', admin, 'POST', { request_id: randomUUID(), titulo: `QA107 project ${n}`,
      cliente_id: a.id, responsable_id: 91004, tipo: 'web', descripcion: marker, miembro_ids: [],
      fecha_inicio: null, fecha_entrega: null }), 201).proyecto;
    projectIds.push(project.id);
    if (n === 7) ok(await api(`/proyectos/${project.id}`, admin, 'PATCH', { expected_revision: project.revision, archivado: true }));
  }
  // No membership for staff: project reads are genuinely shared, not member-private.
  const visits = [];
  for (let n = 0; n < 8; n++) {
    const id = randomUUID(); visits.push(id);
    await f.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,observaciones,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,$3,$4,$5,91001,91001)`, [id, a.id, n === 7 ? '2026-09-20' : `2026-10-${String(n + 1).padStart(2, '0')}`, `QA107 visit ${n}`, marker]);
  }
  const origin = randomUUID(), child = randomUUID();
  await f.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,observaciones,creado_por_id,actualizado_por_id)
    VALUES ($1,$2,'QA107 repeated origin','repetir',$3,91001,91001)`, [origin, visits[7], marker]);
  await f.query(`INSERT INTO produccion_videos(id,visita_id,video_origen_id,titulo,estado,creado_por_id,actualizado_por_id)
    VALUES ($1,$2,$3,'QA107 repeat child','pendiente',91001,91001)`, [child, visits[0], origin]);
  for (const [visit, state] of [[visits[1], 'grabado'], [visits[7], 'planificado']]) {
    await f.query(`INSERT INTO produccion_videos(id,visita_id,titulo,estado,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,'QA107 video',$3,91001,91001)`, [randomUUID(), visit, state]);
  }
  const currentPhoto = randomUUID();
  await f.query(`INSERT INTO produccion_fotos(id,visita_id,tipo,estado,observaciones,creado_por_id,actualizado_por_id)
    VALUES ($1,$2,'QA107 stills','pendiente',$3,91001,91001)`, [currentPhoto, visits[0], marker]);
  // The bank is all-period, unlike the monthly visit/photo registry counts.
  // Completed photos and a second account in the SAME feed are negative controls.
  const oldPendingPhoto = randomUUID(), oldRepeatPhoto = randomUUID(), oldCompletedPhoto = randomUUID();
  for (const [id, state] of [[oldPendingPhoto, 'pendiente'], [oldRepeatPhoto, 'repetir'], [oldCompletedPhoto, 'realizada']]) {
    await f.query(`INSERT INTO produccion_fotos(id,visita_id,tipo,estado,observaciones,creado_por_id,actualizado_por_id)
      VALUES ($1,$2,'QA222 previous-month photos',$3,$4,91001,91001)`, [id, visits[7], state, marker]);
  }
  const otherVisit = randomUUID(), otherPhoto = randomUUID();
  await f.query(`INSERT INTO produccion_visitas(id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id)
    VALUES ($1,$2,'2026-09-21','QA222 other-account history',91001,91001)`, [otherVisit, b.id]);
  await f.query(`INSERT INTO produccion_fotos(id,visita_id,tipo,estado,observaciones,creado_por_id,actualizado_por_id)
    VALUES ($1,$2,'QA222 foreign pending photos','pendiente',$3,91001,91001)`, [otherPhoto, otherVisit, marker]);

  // Both domains deliberately share integer IDs. Real confirmation is done via API below.
  for (const [domain, table] of [['historia', 'historias'], ['publicacion', 'publicaciones']]) {
    for (let n = 0; n < 4; n++) {
      await f.query(`INSERT INTO ${table}(id,cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada,idea,copy,metadata)
        VALUES ($1,$2,${domain === 'publicacion' ? "'video'," : ''}$3,'2026-10-20',$4,$5,$6::jsonb)`,
      [997100 + n, a.id, n === 1 ? 'publicada' : 'lista', `QA107 ${domain} ${n}`, marker,
        JSON.stringify({ private_finance: { marker, amount }, publicacion_evidencia: { classification: 'confirmada_manualmente' } })]);
    }
    for (const [client, date, archive] of [[b.id, '2026-10-20', false], [a.id, '2026-09-20', false], [a.id, '2026-10-20', true]]) {
      await f.query(`INSERT INTO ${table}(cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada,idea,metadata)
        VALUES ($1,${domain === 'publicacion' ? "'video'," : ''}'lista',$2,'QA107 excluded editorial',$3::jsonb)`,
      [client, date, JSON.stringify({ archivado_tablero: archive })]);
    }
    const path = `/editorial-publicacion/${domain}/997100`;
    const observed = ok(await api(path, admin));
    ok(await api(`${path}/confirmar`, admin, 'POST', { request_id: randomUUID(), expected_revision: observed.piece.revision,
      occurred_at: '2026-10-20T12:00:00Z' }), 201);
  }
  // Seven historical group keys plus the current shared feed: all eight must count,
  // even though only six appear in the preview. Stored accounts are authoritative history.
  const goalKeys = [`grupo-${group.id}`];
  for (let n = 0; n < 7; n++) {
    const key = `grupo-${998100 + n}`; goalKeys.push(key);
    await f.query(`INSERT INTO cliente_objetivos_mensuales(clave,periodo,cliente_id,nombre,cuentas,reels,carruseles,preparado_por)
      VALUES ($1,'2026-10-01',$2,$3,$4::jsonb,3,2,'QA107 fixture')`,
    [key, a.id, `QA107 historical group ${n}`, JSON.stringify(clients)]);
  }
  const tables = (await f.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const privacy = value => {
    assert.equal(JSON.stringify(value).includes(marker), false);
    assert.equal(JSON.stringify(value).includes(String(amount)), false);
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      for (const [key, childValue] of Object.entries(node)) {
        assert.equal(/^(metadata|propiedades_extra|password_hash|token|abono_mensual|importe|agreement_revision|observaciones|copy)$/i.test(key), false);
        walk(childValue);
      }
    }; walk(value);
  };
  const hub = (id = a.id, token = admin, query = `periodo=${period}`) => api(`/clientes/${id}/operacion?${query}`, token);
  const check = body => {
    keys(body, ['version', 'generated_at', 'periodo', 'cliente', 'tareas', 'proyectos', 'producciones', 'editorial', 'objetivos']);
    assert.equal(body.version, 1); assert.equal(body.periodo, period);
    keys(body.cliente, ['id', 'nombre', 'activo', 'rubro']); assert.equal(body.cliente.id, a.id);
    for (const name of ['tareas', 'proyectos', 'producciones', 'editorial', 'objetivos']) {
      keys(body[name], ['scope', 'total', 'counts', 'items', 'has_more', 'href']);
      assert.ok(body[name].items.length <= 6); assert.equal(body[name].has_more, body[name].total > body[name].items.length);
    }
    privacy(body);
  };

  await t.test('admin and nonmember staff read the same complete counts, bounded previews and closed DTO without any DML', async () => {
    const before = await snapshot();
    for (const token of [admin, staff]) {
      const body = ok(await hub(a.id, token)); check(body);
      assert.equal(body.tareas.total, 8);
      assert.deepEqual(body.tareas.counts, { pendiente: 2, en_progreso: 1, en_revision: 1, aprobada: 2, finalizada: 2, otros: 0 });
      assert.equal(body.tareas.items.length, 6);
      for (const item of body.tareas.items) { keys(item, ['id', 'titulo', 'estado', 'revision', 'fecha_vencimiento', 'href']); assert.ok(taskIds.includes(item.id)); }
      assert.equal(body.proyectos.total, 7); assert.equal(body.proyectos.items.length, 6);
      for (const item of body.proyectos.items) {
        keys(item, ['id', 'titulo', 'tipo', 'estado', 'revision', 'fecha_inicio', 'fecha_entrega', 'responsable', 'counts', 'href']);
        assert.ok(projectIds.slice(0, 7).includes(item.id));
        keys(item.responsable, ['id', 'nombre']); keys(item.counts, ['tareas', 'finalizadas', 'hitos', 'entregables']);
      }
      assert.equal(body.producciones.total, 7);
      assert.deepEqual(body.producciones.counts, { visitas: 7, videos_registrados: 2, videos_reutilizados: 1,
        registros_fotos: 1, pendientes_banco_todos_los_periodos: 2, fotos_pendientes_banco_todos_los_periodos: 3 });
      for (const item of body.producciones.items) keys(item, ['id', 'titulo', 'revision', 'fecha', 'videos_registrados', 'registros_fotos', 'href']);
      assert.equal(body.editorial.total, 8); assert.equal(body.editorial.items.length, 6);
      assert.deepEqual(body.editorial.counts, { confirmada_manualmente: 2, historica_sin_confirmacion: 2, no_publicada: 4 });
      assert.deepEqual(body.editorial.items.filter(item => item.id === 997100).map(item => item.domain), ['historia', 'publicacion']);
      for (const item of body.editorial.items) {
        keys(item, ['domain', 'id', 'titulo', 'tipo', 'estado', 'fecha_programada', 'publicacion_evidencia', 'href', 'context_href']);
        const story = item.domain === 'historia';
        assert.equal(item.href, story
          ? `/planificacion-historias?vista=planilla&cliente=${a.id}&mes=${period}`
          : `/planificacion-publicaciones?tab=planilla&cliente=${a.id}&mes=${period}`);
        // Broad context is intentionally NOT presented as a client-filtered destination.
        assert.equal(item.context_href, story
          ? `/planificacion-historias?vista=checklist&mes=${period}`
          : `/planificacion-publicaciones?tab=calendario&mes=${period}`);
        assert.equal(new URL(item.context_href, 'http://fixture.invalid').searchParams.has('cliente'), false);
        keys(item.publicacion_evidencia, ['classification', 'revision', 'confirmation']);
        if (item.id === 997100) { assert.equal(item.publicacion_evidencia.classification, 'confirmada_manualmente');
          keys(item.publicacion_evidencia.confirmation, ['id', 'actor_id', 'occurred_at', 'recorded_at', 'source']); }
        if (item.id === 997101) assert.equal(item.publicacion_evidencia.classification, 'historica_sin_confirmacion');
      }
      assert.equal(body.objetivos.total, 8); assert.equal(body.objetivos.items.length, 6);
      assert.deepEqual(body.objetivos.counts, { preparados: 7, por_preparar: 1 });
      assert.deepEqual(body.objetivos.items.map(item => item.clave), [...goalKeys].sort((x, y) => x.localeCompare(y, 'es')).slice(0, 6));
      for (const item of body.objetivos.items) {
        keys(item, ['id', 'clave', 'nombre', 'cuentas', 'preparado', 'quota', 'cuota_actual', 'cuota_desactualizada', 'progress', 'extras', 'href']);
        assert.deepEqual(item.quota, { reels: 3, carruseles: 2 });
        assert.deepEqual(item.cuentas.map(account => account.id).sort((x, y) => x - y), clients.map(client => client.id).sort((x, y) => x - y));
      }
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('second account remains isolated while shared quota keys are preserved rather than summed', async () => {
    const before = await snapshot(), body = ok(await hub(b.id, staff)); privacy(body);
    assert.equal(body.cliente.id, b.id); assert.equal(body.tareas.total, 1); assert.equal(body.proyectos.total, 0);
    assert.equal(body.producciones.total, 0); assert.equal(body.editorial.total, 2);
    assert.equal(body.producciones.counts.pendientes_banco_todos_los_periodos, 0, 'Old video count is not a combined media total');
    assert.equal(body.producciones.counts.fotos_pendientes_banco_todos_los_periodos, 1, 'Photo bank belongs to the account, not its shared feed');
    assert.equal(body.objetivos.total, 8); assert.deepEqual(body.objetivos.counts, { preparados: 7, por_preparar: 1 });
    assert.deepEqual(body.objetivos.items.map(item => item.clave), [...goalKeys].sort((x, y) => x.localeCompare(y, 'es')).slice(0, 6));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('all-period pending photo count matches the real production bank across months and excludes completed/foreign rows without DML', async () => {
    const before = await snapshot();
    const expectedPhotos = [currentPhoto, oldPendingPhoto, oldRepeatPhoto].sort();
    for (const token of [admin, staff]) {
      const bank = ok(await api(`/producciones/pendientes?cliente_id=${a.id}`, token));
      assert.ok(Array.isArray(bank.videos)); assert.ok(Array.isArray(bank.fotos));
      assert.equal(bank.videos.length, 2, 'Existing pending video semantics stay unchanged');
      assert.deepEqual(bank.fotos.map(photo => photo.id).sort(), expectedPhotos);
      assert.equal(new Set(bank.fotos.map(photo => photo.id)).size, expectedPhotos.length);
      assert.ok(bank.fotos.every(photo => photo.cliente_id === a.id && ['pendiente', 'repetir'].includes(photo.estado)));
      for (const [id, state] of [[oldPendingPhoto, 'pendiente'], [oldRepeatPhoto, 'repetir']]) {
        const photo = bank.fotos.find(item => item.id === id);
        assert.equal(photo.estado, state); assert.equal(photo.visita_id, visits[7]); assert.equal(photo.fecha, '2026-09-20');
      }
      assert.ok(!bank.fotos.some(photo => [oldCompletedPhoto, otherPhoto].includes(photo.id)));
      for (const month of ['2026-09', period, '2026-11']) {
        const body = ok(await hub(a.id, token, `periodo=${month}`)); privacy(body);
        assert.equal(body.periodo, month);
        assert.equal(body.producciones.counts.pendientes_banco_todos_los_periodos, bank.videos.length);
        assert.equal(body.producciones.counts.fotos_pendientes_banco_todos_los_periodos, bank.fotos.length,
          'Changing the hub month must not hide older pending/repeat photos');
        assert.equal(body.producciones.counts.registros_fotos, month === '2026-09' ? 3 : month === period ? 1 : 0,
          'Monthly registered photos include completed rows and remain separate from the pending bank');
      }
      const foreignBank = ok(await api(`/producciones/pendientes?cliente_id=${b.id}`, token));
      assert.ok(Array.isArray(foreignBank.videos)); assert.ok(Array.isArray(foreignBank.fotos));
      assert.deepEqual(foreignBank.videos, []);
      assert.deepEqual(foreignBank.fotos.map(photo => photo.id), [otherPhoto]);
      assert.ok(foreignBank.fotos.every(photo => photo.cliente_id === b.id));
      const foreignHub = ok(await hub(b.id, token)); privacy(foreignHub);
      assert.equal(foreignHub.producciones.counts.pendientes_banco_todos_los_periodos, foreignBank.videos.length);
      assert.equal(foreignHub.producciones.counts.fotos_pendientes_banco_todos_los_periodos, foreignBank.fotos.length);
    }
    assert.deepEqual(await snapshot(), before, 'Hub and pending-bank reads preserve every existing table');
  });

  await t.test('required real period, canonical IDs, repeated/array/unknown query and missing client fail without DML', async () => {
    const before = await snapshot();
    for (const query of ['', 'periodo=', 'periodo=0000-10', 'periodo=2026-00', 'periodo=2026-13',
      'periodo=2026-1', 'periodo=2026-10&periodo=2026-10', 'periodo[]=2026-10',
      'periodo=2026-10&limit=1', 'periodo=2026-10&cliente_id=1']) ok(await hub(a.id, admin, query), 400);
    for (const id of ['0', '-1', '01', '1.0', '2147483648', 'no-id']) ok(await hub(id), 400);
    ok(await hub(2147483647), 404);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('inactive client retains canonical task history and shared projects, not active editorial visibility', async () => {
    await f.query('UPDATE clientes SET activo=false WHERE id=$1', [a.id]);
    const before = await snapshot();
    for (const token of [admin, staff]) {
      const body = ok(await hub(a.id, token)); check(body); assert.equal(body.cliente.activo, false);
      assert.equal(body.tareas.total, 8); assert.equal(body.proyectos.total, 7); assert.equal(body.producciones.total, 7);
      assert.equal(body.editorial.total, 0); assert.deepEqual(body.editorial.items, []);
      assert.equal(body.objetivos.total, 7); assert.deepEqual(body.objetivos.counts, { preparados: 7, por_preparar: 0 });
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('anonymous, inactive and revoked identities cannot read; denial has no business effects', async () => {
    ok(await hub(a.id, null), 401);
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
    let before = await snapshot(); ok(await hub(a.id, staff), 401); assert.deepEqual(await snapshot(), before);
    const fresh = await login('qa_luciano');
    await f.query('UPDATE usuarios SET activo=false WHERE id=91003');
    before = await snapshot(); ok(await hub(a.id, fresh), 401); assert.deepEqual(await snapshot(), before);
  });
});
