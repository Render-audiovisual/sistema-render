import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProjectsRouter, normalizeProjectInput, normalizeProjectChild, projectRequestHash,
  projectPermissions, projectSummaryDto, lockProjectLinks } from '../src/projects.js';

const P = '10000000-0000-4000-8000-000000000001';
const C = '20000000-0000-4000-8000-000000000001';
const BASE = { request_id: P, titulo: 'Proyecto', cliente_id: 1, responsable_id: 2, tipo: 'web' };
const admin = { id: 1, rol: 'admin', activo: true, session_version: 1 };
const owner = { id: 2, rol: 'diseno', activo: true, session_version: 1 };

test('canonical create hash excludes request ID, key ordering and explicit defaults', () => {
  const hash = projectRequestHash(BASE);
  assert.equal(hash, projectRequestHash({ miembro_ids: [], fecha_inicio: null, descripcion: '', ...BASE, fecha_entrega: null, request_id: C }));
  assert.equal(projectRequestHash({ ...BASE, miembro_ids: [4, 3] }), projectRequestHash({ ...BASE, miembro_ids: [3, 4] }));
  assert.notEqual(hash, projectRequestHash({ ...BASE, titulo: 'Otro' }));
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('closed project fields reject financial bags, identity claims, invalid dates and IDs', () => {
  for (const patch of [{ salario: 99 }, { propiedades_extra: { secreto: 1 } }, { actor_id: 1 }, { actividad: [] }, { estado: 'publicada' }]) {
    assert.throws(() => normalizeProjectInput({ ...BASE, ...patch }, { create: true }), { status: 400 });
  }
  for (const fecha_inicio of ['0000-01-01', '2026-02-30', '2026-2-01', '2026-01-01T00:00:00Z', false]) {
    assert.throws(() => normalizeProjectInput({ ...BASE, fecha_inicio }, { create: true }), { status: 400 });
  }
  for (const responsable_id of ['2', 0, -1, 1.1, null, 2147483648]) {
    assert.throws(() => normalizeProjectInput({ ...BASE, responsable_id }, { create: true }), { status: 400 });
  }
  assert.throws(() => normalizeProjectInput({ ...BASE, miembro_ids: [2, 2] }, { create: true }), { status: 400 });
  assert.throws(() => normalizeProjectInput({ ...BASE, fecha_inicio: '2026-04-02', fecha_entrega: '2026-04-01' }, { create: true }), { status: 400 });
  assert.equal(normalizeProjectInput({ ...BASE, fecha_inicio: '2024-02-29' }, { create: true }).fecha_inicio, '2024-02-29');
  assert.deepEqual(normalizeProjectInput({ expected_revision: 1, descripcion: '' }), { expected_revision: 1, descripcion: '' });
});

test('permissions use current supported IDs, never names or membership', () => {
  const project = { responsable_id: 2, archivado: false };
  for (const rol of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion', 'unknown']) {
    const user = { id: 3, rol, activo: true, nombre: 'Administrador', miembro_ids: [3] };
    assert.equal(projectPermissions(project, user).editar, rol === 'admin');
    assert.equal(projectPermissions(project, { ...user, id: 2, nombre: 'Renombrado' }).editar, rol !== 'unknown');
    assert.equal(projectPermissions(project, { ...user, activo: false }).editar, false);
  }
  assert.equal(projectPermissions({ ...project, archivado: true }, admin).editar, false);
  assert.equal(projectPermissions({ ...project, archivado: true }, admin).administrar, true);
});

test('child validation scopes fields, approvals and safe URLs', () => {
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com/', 'file:///tmp/a', 'https://example.com/ a']) {
    assert.throws(() => normalizeProjectChild('entregables', { expected_revision: 1, url }), { status: 400 });
  }
  assert.equal(normalizeProjectChild('entregables', { expected_revision: 1, url: 'https://example.com/a' }).url, 'https://example.com/a');
  assert.throws(() => normalizeProjectChild('entregables', { expected_revision: 1, aprobado_por_id: 1 }), { status: 400 });
  assert.throws(() => normalizeProjectChild('etapas', { expected_revision: 1, titulo: 'Etapa', estado: 'completada' }, { create: true }), { status: 400 });
  assert.deepEqual(normalizeProjectChild('hitos', { expected_revision: 1, etapa_id: null, fecha: null }), { expected_revision: 1, fecha: null, etapa_id: null });
});

test('summary never includes arbitrary fields, even for administrators', () => {
  const dto = projectSummaryDto({ id: P, titulo: 'Proyecto', cliente_id: 1, cliente_nombre: 'Cliente', responsable_id: 2, responsable_nombre: 'Persona', tareas: 2, finalizadas: 1, hitos: 0, entregables: 0, salario: 999, metadata: { token: 'SECRET' }, revision: 1 });
  assert.doesNotMatch(JSON.stringify(dto), /salario|SECRET|metadata/);
  assert.deepEqual(dto.counts, { tareas: 2, finalizadas: 1, hitos: 0, entregables: 0 });
  assert.equal(dto.href, `/proyectos?proyecto=${P}`);
});

function harness({ user = owner, project = {}, childState = 'pendiente', fault, task = {}, hidden = false } = {}) {
  const routes = new Map(), calls = [], events = [];
  let released = false;
  const row = { id: P, titulo: 'Proyecto', cliente_id: 1, cliente_nombre: 'Cliente', responsable_id: 2, responsable_nombre: 'Persona', tipo: 'web', estado: 'en_curso', archivado: false, revision: 1, descripcion: '', fecha_inicio: null, fecha_entrega: null, tareas: 0, tareas_visibles: 0, finalizadas: 0, hitos: 0, entregables: 1, ...project };
  const db = { release() { released = true; }, async query(sql, params = []) {
    calls.push({ sql, params });
    if (fault?.(sql)) throw Object.assign(new Error('private driver failure'), { code: 'P0001' });
    if (sql.startsWith('SELECT id,nombre,rol,activo,session_version FROM usuarios')) return { rows: [user] };
    if (sql.includes('FROM proyectos WHERE id=$1 FOR UPDATE')) return { rows: [row] };
    if (sql.startsWith('SELECT p.id,p.titulo')) return { rows: [row] };
    if (sql.startsWith('SELECT id,estado FROM proyecto_')) return { rows: [{ id: C, estado: childState }] };
    if (sql.startsWith('SELECT count(*)::int AS total')) return { rows: [{ total: 0 }] };
    if (sql.startsWith('SELECT id,revision,cliente_id FROM tareas')) return { rows: [{ id: 8, revision: 3, cliente_id: 1, ...task }] };
    if (sql.startsWith('SELECT t.id FROM tareas')) return { rows: hidden ? [] : [{ id: 8 }] };
    if (sql.startsWith('DELETE FROM proyecto_tareas')) return { rows: [{ tarea_id: 8 }] };
    if (sql.startsWith('UPDATE proyectos')) { row.revision += 1; return { rows: [{ revision: row.revision }] }; }
    if (sql.startsWith('INSERT INTO proyecto_actividad')) {
      const [, actor_id, accion, recurso_id, tarea_id, estado_anterior, estado_nuevo] = params;
      events.push({ id: events.length + 1, actor_id, accion, recurso_id, tarea_id, estado_anterior, estado_nuevo, created_at: '2026-10-19T12:00:00Z' });
    }
    if (sql.startsWith('SELECT id,actor_id,accion')) return { rows: events.toReversed ? events.toReversed() : [...events].reverse() };
    return { rows: [] };
  } };
  const router = { use(fn) { routes.set('middleware', fn); } };
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) router[method] = (path, fn) => routes.set(`${method} ${path}`, fn);
  createProjectsRouter({ express: { Router: () => router }, pool: { connect: async () => db } });
  const run = async (method, path, body, overrides = {}) => {
    let status, payload, error;
    const res = { status(n) { status = n; return this; }, json(v) { payload = v; } };
    await routes.get(`${method} ${path}`)({ body, params: { id: P, child: C, task: '8' }, auth: { ...user }, ...overrides }, res, e => { error = e; });
    return { status, payload, error };
  };
  return { run, calls, events, routes, released: () => released };
}

test('approval then corrections retain actor/resource and historical approved state', async () => {
  const first = harness();
  const approved = await first.run('patch', '/:id/entregables/:child', { expected_revision: 1, estado: 'aprobado' });
  assert.equal(approved.status, 200);
  assert.match(first.calls.find(c => c.sql.startsWith('UPDATE proyecto_entregables')).sql, /aprobado_por_id=\$4,aprobado_at=clock_timestamp\(\)/);
  assert.deepEqual(first.events[0], { id: 1, actor_id: 2, accion: 'editar_entregable', recurso_id: C, tarea_id: null, estado_anterior: 'pendiente', estado_nuevo: 'aprobado', created_at: '2026-10-19T12:00:00Z' });
  assert.equal(approved.payload.proyecto.actividad[0].estado_nuevo, 'aprobado');
  const second = harness({ childState: 'aprobado' });
  const revoked = await second.run('patch', '/:id/entregables/:child', { expected_revision: 1, estado: 'correcciones' });
  assert.equal(revoked.status, 200);
  assert.match(second.calls.find(c => c.sql.startsWith('UPDATE proyecto_entregables')).sql, /aprobado_por_id=NULL,aprobado_at=NULL/);
  assert.equal(second.events[0].estado_anterior, 'aprobado');
  assert.equal(second.events[0].estado_nuevo, 'correcciones');
  assert.equal(first.calls.filter(c => c.sql.startsWith('UPDATE proyectos')).length, 1);
});

test('stale CAS, wrong owner, inactive and changed roles deny without child writes', async () => {
  for (const options of [{ project: { revision: 2 } }, { user: { ...owner, id: 3, nombre: 'Admin' } }, { user: { ...owner, activo: false } }, { user: { ...owner, rol: 'unknown' } }]) {
    const h = harness(options);
    const result = await h.run('patch', '/:id/entregables/:child', { expected_revision: 1, estado: 'aprobado' });
    assert.ok([401, 403, 409].includes(result.status));
    assert.equal(h.calls.some(c => c.sql.startsWith('UPDATE proyecto_')), false);
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(h.released(), true);
  }
  const h = harness();
  assert.equal((await h.run('patch', '/:id/entregables/:child', { expected_revision: 1, estado: 'aprobado' }, { auth: { ...owner, rol: 'admin' } })).status, 401);
  const unsupported = harness({ user: { ...owner, rol: 'unknown' } });
  assert.equal((await unsupported.run('patch', '/:id/entregables/:child', { expected_revision: 1, estado: 'aprobado' })).status, 403);
});

test('unknown SQL fault rolls back, reaches global 500 handler and never commits', async () => {
  const h = harness({ fault: sql => sql.startsWith('INSERT INTO proyecto_actividad') });
  const result = await h.run('patch', '/:id/entregables/:child', { expected_revision: 1, estado: 'aprobado' });
  assert.equal(result.error?.code, 'P0001');
  assert.equal(result.status, undefined);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(h.calls.some(c => c.sql === 'COMMIT'), false);
});

test('link locks objective then project advisory then task then project; no task mutation', async () => {
  const h = harness();
  const result = await h.run('post', '/:id/tareas', { expected_revision: 1, tarea_id: 8, expected_tarea_revision: 3 });
  assert.equal(result.status, 201);
  assert.equal(h.calls[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
  const sql = h.calls.map(c => c.sql);
  const objective = sql.findIndex(s => s.includes("hashtext('vinculo-objetivo-mensual')"));
  const advisory = sql.findIndex(s => s.includes("hashtext('proyecto-vinculos')"));
  const task = sql.findIndex(s => s.startsWith('SELECT id,revision,cliente_id FROM tareas'));
  const project = sql.findIndex(s => s.includes('FROM proyectos WHERE id=$1 FOR UPDATE'));
  assert.ok(objective < advisory && advisory < task && task < project);
  assert.ok(sql.some(s => s.includes('proyectos_assert_task_domain')));
  assert.equal(sql.some(s => /^(INSERT INTO|UPDATE|DELETE FROM) tareas\b/.test(s)), false);
  assert.equal(h.events[0].tarea_id, 8);
  const removed = harness();
  assert.equal((await removed.run('delete', '/:id/tareas/:task', { expected_revision: 1 })).status, 200);
  assert.equal(removed.events[0].accion, 'desvincular_tarea');
  for (const options of [{ task: { revision: 4 } }, { task: { cliente_id: 5 } }, { hidden: true }]) {
    const denied = harness(options);
    const outcome = await denied.run('post', '/:id/tareas', { expected_revision: 1, tarea_id: 8, expected_tarea_revision: 3 });
    assert.ok([404, 409].includes(outcome.status));
    assert.equal(denied.calls.some(c => c.sql.startsWith('INSERT INTO proyecto_tareas')), false);
  }
});

test('structural lock takes no objective/task locks and responses disable caching', async () => {
  const calls = [];
  await lockProjectLinks({ query: async sql => { calls.push(sql); } });
  assert.deepEqual(calls, ["SELECT pg_advisory_xact_lock(hashtext('proyecto-vinculos'))"]);
  const h = harness();
  let header, advanced = false;
  h.routes.get('middleware')({}, { set: (...args) => { header = args; } }, () => { advanced = true; });
  assert.deepEqual(header, ['Cache-Control', 'no-store']);
  assert.equal(advanced, true);
});

test('detail SQL projects explicit safe columns, filters both hidden task states and bounds collections', () => {
  const source = readFileSync(new URL('../src/projects.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /SELECT\s+(?:t\.)?\*|row_to_json|to_jsonb\(t\)/i);
  assert.match(source, /archivada_render_os/);
  assert.match(source, /papelera_render_os/);
  assert.match(source, /estado IN \('finalizada','publicada'\)/);
  assert.match(source, /recurso_id,tarea_id,estado_anterior,estado_nuevo FROM proyecto_actividad/);
  assert.match(source, /ORDER BY id DESC LIMIT 20/);
  assert.match(source, /LIMIT 100/);
  assert.match(source, /LIMIT 200/);
});
