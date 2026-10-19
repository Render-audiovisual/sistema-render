import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const marker = 'QA_PRIVATE_FINANCE_SENTINEL_55600';
const amount = 876543.21;
const roles = ['diseno', 'edicion', 'produccion', 'community', 'programacion', 'qa_unknown'];
const attachment = { id: 'qa-file', name: 'QA legitimate attachment', url: 'https://example.invalid/qa-file',
  mimeType: 'video/mp4', uploaded_by: 'QA uploader', future_finance: { marker }, importe: amount };
const poison = {
  importe: amount, finance_sentinel: marker, future_unknown_bag: { harmless_name: [{ wrapped: { marker, total: amount } }] },
};
const properties = {
  workspace: 'render_os', resumen: 'QA legitimate summary', copy_trabajo: 'QA legitimate task copy',
  guiones: 'QA legitimate script', referencia: 'https://example.invalid/qa-reference',
  etiquetas: ['QA legitimate tag', { marker, importe: amount }, [{ marker }]],
  drive_archivos: [attachment, { id: { marker }, name: { importe: amount }, url: [{ marker }] }, [{ marker }]],
  produccion_registros: [{ id: 'qa-existing-record', cantidad: 1, fecha: '2026-10-25', usuario: 'QA recorder', usuario_id: 97001,
    created_at: '2026-10-01T12:00:00Z', periodo_objetivo: '2026-10', ...poison }, [{ marker }]],
  ...poison,
};
const metadata = { hora: '10:30', tipo: 'reel', Copy: 'QA legitimate metadata copy',
  guiones: 'QA legitimate editorial script', drive_archivos: [attachment], ...poison };

test('operational HTTP DTOs remove structured financial data for every non-admin role', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55600 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own privacy fixture stopped and removed: ${fixture.root}`);
  });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const result = await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.token;
  };
  const users = [];
  for (const [index, rol] of roles.entries()) {
    const id = 97001 + index;
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,true,1 FROM usuarios WHERE id=91004`,
    [id, `qa_privacy_${rol}`, `QA Privacy ${rol}`, rol]);
    users.push({ id, rol, token: await login(`qa_privacy_${rol}`) });
  }
  const admin = await login('qa_franco');
  const noFinance = value => {
    const serialized = JSON.stringify(value);
    assert.ok(!serialized.includes(marker), 'Private structured marker leaked');
    assert.ok(!serialized.includes(String(amount)), 'Private structured amount leaked');
    const inspect = item => {
      if (!item || typeof item !== 'object') return;
      for (const [key, nested] of Object.entries(item)) {
        assert.ok(!['importe', 'abono_mensual', 'sueldo_base', 'tarifa_facil', 'tarifa_intermedia', 'finance_sentinel',
          'future_unknown_bag', 'future_finance'].includes(key), `Private/default-unknown key leaked: ${key}`);
        inspect(nested);
      }
    };
    inspect(value);
  };
  const safe = (result, expected = 200) => { assert.equal(result.status, expected, JSON.stringify(result.body)); noFinance(result.body); return result.body; };
  const [client] = await fixture.query("INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles,rubro) VALUES ('QA Privacy client',3,4,'QA rubro') RETURNING id");
  await fixture.query(`INSERT INTO cliente_configuraciones(cliente_id,vigente_desde,cuota_reels,cuota_carruseles,dias_historias,disenador_responsable,abono_mensual)
    VALUES ($1,'2026-01-01',3,4,'{1,3}','QA Privacy diseno',$2)`, [client.id, amount]);
  await fixture.query("INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por) VALUES ($1,'2026-01-01',$2,'QA fixture')", [client.id, amount]);
  const pieces = [];
  for (const table of ['publicaciones', 'historias']) {
    const extra = table === 'publicaciones' ? ",tipo" : '';
    const value = table === 'publicaciones' ? ",'video'" : '';
    const [piece] = await fixture.query(`INSERT INTO ${table}(cliente_id,estado,fecha_programada,idea,copy,metadata${extra})
      VALUES ($1,'pendiente','2026-10-25','QA legitimate idea','QA legitimate editorial copy',$2::jsonb${value}) RETURNING id`, [client.id, JSON.stringify(metadata)]);
    pieces.push({ table, id: piece.id });
    await fixture.query(`INSERT INTO ${table}(cliente_id,estado,fecha_programada,idea,copy,metadata${extra})
      VALUES ($1,'pendiente','2026-10-25','QA poisoned scalar piece','QA second copy',$2::jsonb${value})`, [client.id,
      JSON.stringify({ ...metadata, Idea: { marker, importe: amount }, hora: [{ marker }], resumen: { importe: amount } })]);
  }
  const insertTask = async (title, props, parent = null) => {
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,tarea_padre_id,estado,tipo_tarea,subtipo,
      material_referencia,fecha_vencimiento,propiedades_extra)
      VALUES ($1,'QA Privacy diseno',$2,$3,$4,'pendiente','diseno','carrusel','https://example.invalid/qa-material','2026-10-25',$5::jsonb) RETURNING id`,
    [title, client.id, pieces[0].id, parent, JSON.stringify(props)]);
    for (const [index, user] of users.entries()) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,$3)",
      [task.id, user.id, index === 0 ? 'responsable' : 'colaborador']);
    return task.id;
  };
  const root = await insertTask('QA privacy operational root', properties);
  const child = await insertTask('QA privacy operational child', { ...properties, resumen: { marker, importe: amount },
    copy_trabajo: [{ marker }], guiones: [{ id: 'qa-script', texto: 'QA legitimate nested script', future_finance: { marker },
      escenas: [{ id: 'qa-scene', texto: 'QA legitimate scene', ...poison }] }, [{ marker }]] }, root);
  const preserved = task => {
    assert.equal(task.id, root);
    assert.ok(Number.isSafeInteger(task.revision) && task.revision > 0);
    assert.equal(task.asignado_a_id, users[0].id);
    assert.deepEqual([...task.colaborador_ids].sort(), users.slice(1).map(user => user.id).sort());
    assert.equal(task.propiedades_extra.copy_trabajo, properties.copy_trabajo);
    assert.equal(task.propiedades_extra.guiones, properties.guiones);
    assert.equal(task.propiedades_extra.drive_archivos[0].id, attachment.id);
    assert.equal(task.propiedades_extra.drive_archivos[0].url, attachment.url);
    assert.equal(task.propiedades_extra.drive_archivos[0].name, attachment.name);
    assert.equal(task.propiedades_extra.produccion_registros[0].cantidad, 1);
  };
  const revision = async id => (await api(`/tareas/${id}?workspace=render_os`, { token: admin })).body.revision;

  await t.test('nonempty admin raw DTO and authorized finance response retain synthetic financial values', async () => {
    const task = await api(`/tareas/${root}?workspace=render_os`, { token: admin });
    assert.equal(task.status, 200);
    assert.equal(task.body.propiedades_extra.finance_sentinel, marker);
    assert.equal(task.body.propiedades_extra.importe, amount);
    const editorial = await api('/publicaciones', { token: admin });
    assert.equal(editorial.status, 200);
    assert.equal(editorial.body.find(row => row.id === pieces[0].id).metadata.finance_sentinel, marker);
    const clients = await api('/clientes?periodo=2026-10', { token: admin });
    assert.equal(clients.status, 200);
    assert.equal(Number(clients.body.find(row => row.id === client.id).abono_mensual), amount);
    assert.equal((await api('/sueldos?periodo=2026-10', { token: admin })).status, 200);
  });
  for (const user of users) await t.test(`${user.rol}: list/detail/subtasks/recommendations and editorial/client reads filter every shape`, async () => {
    const token = user.token;
    const list = safe(await api('/tareas?workspace=render_os&limit=500', { token }));
    preserved(list.find(row => row.id === root));
    preserved(safe(await api(`/tareas/${root}?workspace=render_os`, { token })));
    const children = safe(await api(`/tareas/${root}/subtareas?workspace=render_os`, { token }));
    const nested = children.find(row => row.id === child);
    assert.ok(nested);
    assert.equal(nested.propiedades_extra.resumen, undefined, 'Object under scalar summary must be omitted');
    assert.equal(nested.propiedades_extra.copy_trabajo, undefined, 'Array under scalar copy must be omitted');
    assert.equal(nested.propiedades_extra.guiones[0].texto, 'QA legitimate nested script');
    assert.equal(nested.propiedades_extra.guiones[0].escenas[0].texto, 'QA legitimate scene');
    const recommendations = safe(await api('/tareas-recomendaciones', { token }));
    assert.ok(recommendations.recommendations.some(row => row.id === root), 'Recommendation fixture must be nonempty');
    const linked = safe(await api(`/publicaciones/${pieces[0].id}/tareas`, { token }));
    assert.ok(linked.some(row => row.id === root));
    for (const route of ['/publicaciones', '/historias', '/piezas', `/piezas/${pieces[0].id}`])
      safe(await api(route, { token }));
    const editorial = safe(await api('/publicaciones', { token })).find(row => row.id === pieces[0].id);
    assert.equal(editorial.copy, 'QA legitimate editorial copy');
    assert.equal(editorial.metadata.Copy, 'QA legitimate metadata copy');
    assert.equal(editorial.metadata.drive_archivos[0].name, attachment.name);
    const clients = safe(await api('/clientes?periodo=2026-10', { token }));
    const visible = clients.find(row => row.id === client.id);
    assert.equal(visible.nombre, 'QA Privacy client');
    assert.equal(visible.cuota_reels, 3);
    assert.deepEqual(visible.dias_historias, [1, 3]);
    assert.equal((await api('/sueldos?periodo=2026-10', { token })).status, 403);
    for (const route of [`/publicaciones/${pieces[0].id}`, `/historias/${pieces[1].id}`])
      assert.equal((await api(route, { token, method: 'PATCH', body: { copy: 'Unauthorized editorial write' } })).status, 403);
  });
  await t.test('every non-admin PATCH and production add/correction response uses the same role-aware DTO', async () => {
    for (const user of users) {
      preserved(safe(await api(`/tareas/${root}?workspace=render_os`, { token: user.token, method: 'PATCH',
        body: { titulo: `QA privacy edited by ${user.rol}`, expected_revision: await revision(root) } })));
      const visit = safe(await api('/tareas', { token: user.token, method: 'POST', body: {
        titulo: `QA privacy visita ${user.rol}`, asignado_a_id: user.id, colaborador_ids: [], workspace: 'render_os',
        cliente_id: client.id, tipo_tarea: 'produccion', subtipo: 'visita', produccion_videos_previstos: 20,
        resumen: 'QA legitimate create summary', material_referencia: attachment.url,
      } }), 201);
      assert.equal(visit.asignado_a_id, user.id);
      await fixture.query('UPDATE tareas SET propiedades_extra=propiedades_extra || $2::jsonb WHERE id=$1',
        [visit.id, JSON.stringify({ ...properties, produccion_videos_previstos: 20,
          produccion_registros: [properties.produccion_registros[0]] })]);
      const added = safe(await api(`/tareas/${visit.id}/produccion/registros`, { token: user.token, method: 'POST',
        body: { cantidad: 1, fecha: '2026-10-25', expected_revision: await revision(visit.id) } }), 201);
      assert.equal(added.asignado_a_id, user.id);
      assert.ok(Number.isSafeInteger(added.revision));
      assert.equal(added.propiedades_extra.produccion_registros.length, 2);
      assert.equal(added.propiedades_extra.copy_trabajo, properties.copy_trabajo);
      assert.equal(added.propiedades_extra.drive_archivos[0].url, attachment.url);
      const corrected = safe(await api(`/tareas/${visit.id}/produccion/registros/qa-existing-record?workspace=render_os`, {
        token: user.token, method: 'PATCH', body: { cantidad: 2, expected_revision: added.revision },
      }));
      assert.equal(corrected.propiedades_extra.produccion_registros[0].cantidad, 2);
    }
  });
  await t.test('create responses omit DB-injected future fields for every employee/unknown role', async () => {
    await fixture.query(`CREATE FUNCTION qa_privacy_create_poison() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.titulo LIKE 'QA privacy create%' THEN NEW.propiedades_extra := NEW.propiedades_extra ||
        jsonb_build_object('importe',876543.21,'future_unknown_bag',jsonb_build_object('marker','QA_PRIVATE_FINANCE_SENTINEL_55600'));
        END IF; RETURN NEW; END $$`);
    try {
      await fixture.query('CREATE TRIGGER qa_privacy_create_poison BEFORE INSERT ON tareas FOR EACH ROW EXECUTE FUNCTION qa_privacy_create_poison()');
      try {
        for (const user of users) {
          const created = safe(await api('/tareas', { token: user.token, method: 'POST', body: {
            titulo: `QA privacy create ${user.rol}`, asignado_a_id: user.id, workspace: 'render_os', resumen: 'QA normal create text',
          } }), 201);
          assert.equal(created.propiedades_extra.resumen, 'QA normal create text');
          assert.equal(created.asignado_a_id, user.id);
          const raw = await api(`/tareas/${created.id}?workspace=render_os`, { token: admin });
          assert.equal(raw.body.propiedades_extra.importe, amount, 'Creation poison must actually persist in the disposable DB');
        }
      } finally { await fixture.query('DROP TRIGGER qa_privacy_create_poison ON tareas'); }
    } finally { await fixture.query('DROP FUNCTION qa_privacy_create_poison()'); }
  });
});
