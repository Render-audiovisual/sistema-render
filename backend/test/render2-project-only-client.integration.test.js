import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('project-only client: clean identity creation without monthly content/finance scaffolding', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55740 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA105 fixture cleanup verified ENOENT: ${f.root}; PostgreSQL port 55740`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55740,
    url: 'postgresql://render2_fixture@127.0.0.1:55740/render2_local_test', identity });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => {
    assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body;
  };
  const login = async usuario => {
    const result = ok(await api('/login', null, 'POST', { usuario, password: fixturePassword }));
    assert.equal(typeof result.token, 'string'); return result.token;
  };
  const admin = await login('qa_franco'), employee = await login('qa_luciano');
  const [clock] = await f.query("SELECT to_char((now() AT TIME ZONE 'America/Argentina/Cordoba')::date,'YYYY-MM') AS period");
  const tables = ['clientes', 'cliente_configuraciones', 'cliente_abonos', 'grupos_feed', 'tareas', 'tarea_asignaciones',
    'historias', 'publicaciones', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos',
    'proyectos', 'proyecto_miembros', 'proyecto_etapas', 'proyecto_hitos', 'proyecto_entregables', 'proyecto_tareas',
    'proyecto_actividad', 'editorial_publicacion_eventos', 'produccion_visitas', 'produccion_videos'];
  const snapshot = async () => {
    const result = {};
    for (const table of tables) result[table] = await f.query(`SELECT * FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const clients = async token => {
    const result = ok(await api(`/clientes?periodo=${clock.period}`, token)); assert.ok(Array.isArray(result)); return result;
  };
  const simple = (row, name) => {
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
    assert.equal(row.nombre, name); assert.equal(row.activo, true);
    assert.equal(row.cuota_reels, 0); assert.equal(row.cuota_carruseles, 0);
    assert.equal(row.rubro, null); assert.equal(row.fecha_inicio, null);
    assert.equal(row.configuracion_completa, false); assert.equal(row.configuracion_vigente_desde, null);
    assert.equal(row.grupo_feed_id, null);
  };
  let name = 'QA105 project-only canonical client';
  let minimal, webProject;

  await t.test('admin name-only POST commits only the client row, zero quotas and no commercial defaults', async () => {
    const before = await snapshot();
    minimal = ok(await api('/clientes', admin, 'POST', { nombre: name }), 201);
    simple(minimal, name);
    assert.match(minimal.agreement_revision, new RegExp(`^a1:${minimal.id}:[1-9][0-9]*:0:0$`));
    const after = await snapshot();
    assert.equal(after.clientes.length, before.clientes.length + 1);
    assert.deepEqual(after.clientes.filter(row => row.id !== minimal.id), before.clientes);
    const stored = after.clientes.find(row => row.id === minimal.id);
    assert.equal(stored.nombre, name); assert.equal(stored.cuota_reels, 0); assert.equal(stored.cuota_carruseles, 0);
    assert.equal(stored.rubro, null); assert.equal(stored.fecha_inicio, null); assert.equal(stored.activo, true);
    for (const table of tables.filter(table => table !== 'clientes')) assert.deepEqual(after[table], before[table], table);
  });

  await t.test('fresh catalogue reads preserve the same active client ID without creating configuration/fees/goals/tasks', async () => {
    const before = await snapshot(), freshAdmin = await login('qa_agustin');
    for (const token of [admin, freshAdmin, employee]) {
      const rows = await clients(token), matches = rows.filter(row => row.id === minimal.id);
      assert.equal(matches.length, 1);
      // This is the same catalogue consumed by the canonical project form.
      simple(matches[0], name);
      if (token !== employee) assert.equal(matches[0].abono_mensual, null);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('same name-only client can host a real web project; reload/new login preserves IDs and creates no content work', async () => {
    const before = await snapshot();
    const created = ok(await api('/proyectos', admin, 'POST', { request_id: randomUUID(), titulo: 'QA105 web project',
      cliente_id: minimal.id, responsable_id: 91003, tipo: 'web', descripcion: 'Project without monthly content agreement',
      fecha_inicio: null, fecha_entrega: null, miembro_ids: [91004] }), 201);
    webProject = created.proyecto;
    assert.equal(webProject.cliente.id, minimal.id); assert.equal(webProject.cliente.nombre, name);
    assert.equal(webProject.tipo, 'web'); assert.equal(webProject.estado, 'planificado');
    assert.deepEqual(webProject.counts, { tareas: 0, finalizadas: 0, hitos: 0, entregables: 0 });
    assert.deepEqual(webProject.tareas, []); assert.deepEqual(webProject.entregables, []);
    const reloaded = ok(await api(`/proyectos/${webProject.id}`, await login('qa_luciano'))).proyecto;
    assert.equal(reloaded.id, webProject.id); assert.equal(reloaded.cliente.id, minimal.id);
    assert.equal(reloaded.tipo, 'web'); assert.deepEqual(reloaded.counts, webProject.counts);
    const list = ok(await api(`/proyectos?cliente_id=${minimal.id}`, employee));
    assert.equal(list.total, 1); assert.equal(list.proyectos[0].id, webProject.id);
    const after = await snapshot();
    assert.equal(after.proyectos.length, before.proyectos.length + 1);
    for (const table of tables.filter(table => !['proyectos', 'proyecto_miembros', 'proyecto_actividad'].includes(table)))
      assert.deepEqual(after[table], before[table], table);
  });

  const complete = { nombre: 'QA105 full commercial client', rubro: 'Servicios', vigente_desde: clock.period,
    cuota_reels: 2, cuota_carruseles: 1, dias_historias: [1, 3], dias_reels: [2], dias_carruseles: [4],
    disenador_responsable: 'Augusto', abono_mensual: 817293.46 };
  await t.test('employee cannot create minimal or complete client; rejection leaves all business rows unchanged', async () => {
    const before = await snapshot();
    for (const body of [{ nombre: 'QA105 employee forbidden identity' }, complete]) ok(await api('/clientes', employee, 'POST', body), 403);
    ok(await api('/clientes', null, 'POST', { nombre: 'QA105 anonymous forbidden identity' }), 401);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('malformed names/bodies and out-of-range quotas return400 without any business changes', async () => {
    const invalid = [{ nombre: 42 }, { nombre: { text: 'Not a name' } }, {}, { nombre: null }, [], null];
    for (const field of ['cuota_reels', 'cuota_carruseles']) for (const value of [2147483648, 2 ** 53])
      invalid.push({ nombre: 'QA105 invalid numeric quota', [field]: value });
    for (const body of invalid) {
      const before = await snapshot();
      const rejected = ok(await api('/clientes', admin, 'POST', body), 400);
      // Strict JSON rejects null before the route. It must remain generic:
      // only handler-classified validation is a known-safe correction signal.
      if (body === null) assert.equal(rejected.code, undefined);
      else assert.equal(rejected.code, 'CLIENT_CREATE_INPUT_INVALID');
      assert.deepEqual(await snapshot(), before, 'Invalid creation must not add clients/configurations/fees or other business rows');
    }
  });

  await t.test('duplicate minimal client returns409, not a creation ACK, and never adds configuration or fees', async () => {
    const before = await snapshot();
    const response = await api('/clientes', admin, 'POST', { nombre: name });
    const rejected = ok(response, 409);
    assert.equal(rejected.code, 'CLIENT_NAME_EXISTS');
    assert.equal(Object.hasOwn(rejected, 'id'), false);
    assert.equal(Object.hasOwn(rejected, 'agreement_revision'), false);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('minimal client rename/deactivation uses held revision and preserves project identity without commercial scaffolding', async () => {
    const loaded = (await clients(admin)).find(row => row.id === minimal.id); simple(loaded, name);
    const before = await snapshot(), renamed = 'QA105 renamed project-only client';
    const saved = ok(await api(`/clientes/${minimal.id}`, admin, 'PATCH', {
      nombre: renamed, activo: false, expected_revision: loaded.agreement_revision,
    }));
    assert.equal(saved.id, minimal.id); assert.equal(saved.nombre, renamed); assert.equal(saved.activo, false);
    assert.notEqual(saved.agreement_revision, loaded.agreement_revision);
    assert.equal(saved.cuota_reels, 0); assert.equal(saved.cuota_carruseles, 0);
    const reloaded = (await clients(await login('qa_agustin'))).find(row => row.id === minimal.id);
    assert.ok(reloaded); assert.equal(reloaded.activo, false); assert.equal(reloaded.nombre, renamed);
    assert.equal(reloaded.agreement_revision, saved.agreement_revision);
    assert.equal(reloaded.configuracion_completa, false); assert.equal(reloaded.configuracion_vigente_desde, null);
    assert.equal(reloaded.rubro, null); assert.equal(reloaded.fecha_inicio, null); assert.equal(reloaded.abono_mensual, null);
    const projectReload = ok(await api(`/proyectos/${webProject.id}`, employee)).proyecto;
    assert.equal(projectReload.id, webProject.id); assert.equal(projectReload.cliente.id, minimal.id);
    assert.equal(projectReload.cliente.nombre, renamed);
    const after = await snapshot();
    for (const table of tables.filter(table => table !== 'clientes')) assert.deepEqual(after[table], before[table], table);
    assert.deepEqual(after.clientes.filter(row => row.id !== minimal.id), before.clientes.filter(row => row.id !== minimal.id));
    name = renamed;
  });

  await t.test('explicit reactivation with fresh revision restores catalogue availability, not monthly configuration', async () => {
    const current = (await clients(admin)).find(row => row.id === minimal.id);
    assert.equal(current.activo, false);
    const before = await snapshot();
    const saved = ok(await api(`/clientes/${minimal.id}`, admin, 'PATCH', {
      activo: true, expected_revision: current.agreement_revision,
    }));
    assert.equal(saved.id, minimal.id); assert.equal(saved.nombre, name); assert.equal(saved.activo, true);
    assert.equal(saved.fecha_fin, null); assert.notEqual(saved.agreement_revision, current.agreement_revision);
    const reloaded = (await clients(admin)).find(row => row.id === minimal.id); simple(reloaded, name);
    assert.equal(reloaded.agreement_revision, saved.agreement_revision); assert.equal(reloaded.abono_mensual, null);
    const projectReload = ok(await api(`/proyectos/${webProject.id}`, employee)).proyecto;
    assert.equal(projectReload.cliente.id, minimal.id); assert.equal(projectReload.cliente.nombre, name);
    const after = await snapshot();
    for (const table of tables.filter(table => table !== 'clientes')) assert.deepEqual(after[table], before[table], table);
    ok(await api(`/clientes/${minimal.id}`, admin, 'PATCH', { nombre: 'QA105 obsolete overwrite', expected_revision: current.agreement_revision }), 409);
    assert.deepEqual(await snapshot(), after);
  });

  await t.test('existing complete agreement POST still persists exact configuration/fee without generating tasks or goals', async () => {
    const before = await snapshot(), created = ok(await api('/clientes', admin, 'POST', complete), 201);
    assert.notEqual(created.id, minimal.id); assert.equal(created.configuracion_completa, true);
    assert.equal(created.rubro, complete.rubro); assert.equal(created.fecha_inicio, `${clock.period}-01`);
    const after = await snapshot();
    assert.equal(after.clientes.length, before.clientes.length + 1);
    assert.equal(after.cliente_configuraciones.length, before.cliente_configuraciones.length + 1);
    assert.equal(after.cliente_abonos.length, before.cliente_abonos.length + 1);
    const cfg = after.cliente_configuraciones.find(row => row.cliente_id === created.id);
    assert.ok(cfg); assert.equal(cfg.cuota_reels, 2); assert.equal(cfg.cuota_carruseles, 1);
    assert.deepEqual(cfg.dias_historias, complete.dias_historias); assert.deepEqual(cfg.dias_reels, complete.dias_reels);
    assert.deepEqual(cfg.dias_carruseles, complete.dias_carruseles); assert.equal(cfg.disenador_responsable, complete.disenador_responsable);
    assert.equal(Number(cfg.abono_mensual), complete.abono_mensual);
    const fees = after.cliente_abonos.filter(row => row.cliente_id === created.id);
    assert.equal(fees.length, 1); assert.equal(Number(fees[0].importe), complete.abono_mensual);
    for (const table of tables.filter(table => !['clientes', 'cliente_configuraciones', 'cliente_abonos'].includes(table)))
      assert.deepEqual(after[table], before[table], table);
    const loaded = (await clients(await login('qa_franco'))).find(row => row.id === created.id);
    assert.equal(loaded.configuracion_completa, true); assert.equal(loaded.cuota_reels, 2); assert.equal(loaded.cuota_carruseles, 1);
    assert.equal(Number(loaded.abono_mensual), complete.abono_mensual);
    simple((await clients(admin)).find(row => row.id === minimal.id), name);
    assert.equal(ok(await api(`/proyectos/${webProject.id}`, employee)).proyecto.cliente.id, minimal.id);
    assert.deepEqual(await snapshot(), after, 'Final reloads must not scaffold any additional business records');
  });
});
