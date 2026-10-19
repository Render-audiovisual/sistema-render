import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildProjectMutation, createProjectsTransport, observedProjectTask, parseProject, parseProjectsPage, projectHref, projectLocation, projectLocationUrl, projectsListUrl, projectError, safeProjectUrl } from '../../frontend/src/pages/projectsModel.js';

const source = readFileSync(new URL('../../frontend/src/pages/Projects.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../frontend/src/pages/Projects.css', import.meta.url), 'utf8');
const id = '00000000-0000-4000-8000-000000000001';
const stage = '00000000-0000-4000-8000-000000000002';
const secondStage = '00000000-0000-4000-8000-000000000003';
const deliverable = '00000000-0000-4000-8000-000000000004';
const requestId = '00000000-0000-4000-8000-000000000005';
const secret = 'PRIVATE_PROJECT_SENTINEL';
function fixture() {
  return { id, revision: 5, titulo: 'Sitio web', cliente: { id: 11, nombre: 'Cliente' }, responsable: { id: 21, nombre: 'Mismo nombre' }, tipo: 'web', estado: 'en_curso', fecha_inicio: null, fecha_entrega: '2026-11-20', archivado: false,
    counts: { tareas: 2, finalizadas: 0, hitos: 1, entregables: 1 }, href: projectHref(id), descripcion: 'Alcance real', miembro_ids: [22],
    etapas: [{ id: stage, titulo: 'Diseño', posicion: 0, estado: 'en_progreso' }, { id: secondStage, titulo: 'Entrega', posicion: 1, estado: 'pendiente' }],
    hitos: [{ id: secondStage, etapa_id: stage, titulo: 'Revisión', fecha: null, estado: 'pendiente' }],
    entregables: [{ id: deliverable, titulo: 'Prototipo', url: 'https://example.test/prototipo', observaciones: '', estado: 'correcciones', aprobado_por_id: null, aprobado_at: null }],
    tareas: [{ id: 101, titulo: 'Implementación', estado: 'en_progreso', prioridad: 'alta', revision: 7, fecha_vencimiento: null, etapa_id: stage, href: '/workspace/tareas?task=101' }], tareas_no_disponibles: 1,
    actividad: [{ id: '9223372036854775806', actor_id: 21, accion: 'editar_entregable', created_at: '2026-10-19T12:00:00Z', recurso_id: deliverable, tarea_id: null, estado_anterior: 'aprobado', estado_nuevo: 'correcciones' }], permissions: { administrar: false, editar: true } };
}
const projectDraft = () => ({ titulo: 'Sitio web', tipo: 'web', descripcion: 'Alcance', estado: 'en_curso', cliente_id: '11', responsable_id: '21', miembro_ids: [22], fecha_inicio: '', fecha_entrega: '2026-11-20' });
const form = (kind, draft, extra = {}) => ({ kind, draft, projectId: id, baseRevision: 5, ...extra });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('project detail projects operational fields only and preserves BIGSERIAL string approval history after revocation', () => {
  const input = fixture();
  input.importe = secret; input.cliente.abono = secret; input.responsable.hash = secret;
  input.entregables[0].metadata = { salary: secret }; input.tareas[0].aclaraciones = secret; input.actividad[0].payload = secret;
  const before = structuredClone(input), result = parseProject(input, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(input, before);
  assert.equal(result.actividad[0].id, '9223372036854775806');
  assert.equal(result.actividad[0].recurso_id, deliverable);
  assert.equal(result.actividad[0].actor_id, 21);
  assert.equal(result.actividad[0].estado_anterior, 'aprobado');
  assert.equal(result.actividad[0].estado_nuevo, 'correcciones');
  assert.equal(result.entregables[0].aprobado_por_id, null);
  assert.equal(result.entregables[0].aprobado_at, null);
  assert.equal(result.tareas_no_disponibles, 1);
});

test('canonical project URL supports direct reload/back, safe UUID normalization and preserves other query context', () => {
  assert.deepEqual(projectLocation(`https://app.test/proyectos?proyecto=${id}`), { id, invalid: false });
  assert.equal(projectLocation('https://app.test/proyectos').id, null);
  assert.equal(projectLocation('https://app.test/proyectos?proyecto=not-an-id').invalid, true);
  assert.equal(projectLocation('https://app.test/proyectos?proyecto=AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA').id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(projectLocationUrl('https://app.test/proyectos?estado=en_curso#detalle', id), `/proyectos?estado=en_curso&proyecto=${id}#detalle`);
  assert.equal(projectLocationUrl(`https://app.test/proyectos?proyecto=${id}`, null), '/proyectos');
  assert.throws(() => projectHref('../secret'));
  assert.equal(projectsListUrl({ offset: 50, estado: 'en_curso', archivados: true }), '/api/proyectos?limit=50&offset=50&estado=en_curso&archivados=true');
  assert.throws(() => projectsListUrl({ estado: 'anything' }));
});

test('list and detail bounds/permissions/types fail closed; no implicit name-derived grants', () => {
  const result = parseProjectsPage({ proyectos: [fixture()], total: 51, offset: 0, limit: 50 });
  assert.equal(result.total, 51); assert.equal(result.proyectos.length, 1);
  assert.equal(result.proyectos[0].descripcion, undefined);
  for (const mutate of [
    value => { value.revision = '5'; },
    value => { value.permissions.editar = 'true'; },
    value => { value.actividad[0].estado_nuevo = 'free payload'; },
    value => { value.actividad[0].id = '1.2'; },
    value => { value.actividad[0].tarea_id = '101'; },
    value => { value.actividad[0].recurso_id = 'not-uuid'; },
    value => { value.etapas = Array.from({ length: 101 }, () => value.etapas[0]); },
    value => { value.tareas[0].href = 'https://example.test'; },
  ]) { const data = fixture(); mutate(data); assert.throws(() => parseProject(data, true)); }
});

test('create carries one persistent request ID, active selection IDs and no CAS/state/server approval fields', () => {
  const draft = { ...projectDraft(), aprobado_por_id: 99, importe: secret };
  const input = { kind: 'create', requestId, draft };
  const first = buildProjectMutation(input), retry = buildProjectMutation(input);
  assert.deepEqual(first, retry);
  assert.deepEqual(first, { method: 'POST', path: '/api/proyectos', body: { request_id: requestId, titulo: 'Sitio web', tipo: 'web', descripcion: 'Alcance', fecha_inicio: null, fecha_entrega: '2026-11-20', cliente_id: 11, responsable_id: 21, miembro_ids: [22] } });
  assert.equal(first.body.expected_revision, undefined); assert.equal(first.body.estado, undefined);
  assert.equal(first.body.aprobado_por_id, undefined);
});

test('ordinary project edits send only explicit differences; admin membership changes use IDs', () => {
  const initial = projectDraft(), draft = { ...initial, descripcion: 'Nuevo alcance', responsable_id: '99', miembro_ids: [99] };
  const ordinary = buildProjectMutation(form('project', draft, { initial, admin: false }));
  assert.deepEqual(ordinary.body, { expected_revision: 5, descripcion: 'Nuevo alcance' });
  const admin = buildProjectMutation(form('project', draft, { initial, admin: true }));
  assert.deepEqual(admin.body, { expected_revision: 5, descripcion: 'Nuevo alcance', responsable_id: 99, miembro_ids: [99] });
  assert.throws(() => buildProjectMutation(form('project', initial, { initial, admin: false })), /No hay cambios/);
  assert.throws(() => buildProjectMutation({ kind: 'create', requestId, draft: { ...initial, fecha_inicio: '2026-12-01' } }), /anterior/);
});

test('stage, milestone, deliverable and archive mutations use parent revision only and typed closed business fields', () => {
  const cases = [
    [form('stage-create', { titulo: 'Nueva' }), 'POST', '/etapas', { titulo: 'Nueva' }],
    [form('stage-edit', { titulo: 'Lista', estado: 'completada' }, { childId: stage }), 'PATCH', `/etapas/${stage}`, { titulo: 'Lista', estado: 'completada' }],
    [form('milestone-create', { titulo: 'Revisión', fecha: '', estado: 'pendiente', etapa_id: stage }), 'POST', '/hitos', { titulo: 'Revisión', fecha: null, estado: 'pendiente', etapa_id: stage }],
    [form('milestone-edit', { titulo: 'Revisión', fecha: '2026-11-10', estado: 'completado', etapa_id: '' }, { childId: secondStage }), 'PATCH', `/hitos/${secondStage}`, { titulo: 'Revisión', fecha: '2026-11-10', estado: 'completado', etapa_id: null }],
    [form('deliverable-create', { titulo: 'Entrega', url: '', observaciones: '', estado: 'pendiente' }), 'POST', '/entregables', { titulo: 'Entrega', url: '', observaciones: '', estado: 'pendiente' }],
    [form('deliverable-edit', { titulo: 'Entrega', url: 'https://example.test', observaciones: 'Corrección', estado: 'aprobado', aprobado_por_id: 99, aprobado_at: 'fake' }, { childId: deliverable }), 'PATCH', `/entregables/${deliverable}`, { titulo: 'Entrega', url: 'https://example.test', observaciones: 'Corrección', estado: 'aprobado' }],
    [form('archive', { archivado: true }), 'PATCH', '', { archivado: true }],
    [form('archive', { archivado: false }), 'PATCH', '', { archivado: false }],
  ];
  for (const [input, method, suffix, business] of cases) assert.deepEqual(buildProjectMutation(input), { method, path: `/api/proyectos/${id}${suffix}`, body: { expected_revision: 5, ...business } });
});

test('reorder requires exactly the observed unique stage set; all positions remain manual', () => {
  const originalStageIds = [stage, secondStage];
  const input = form('order', { etapa_ids: [secondStage, stage] }, { originalStageIds });
  assert.deepEqual(buildProjectMutation(input), { method: 'PUT', path: `/api/proyectos/${id}/etapas/orden`, body: { expected_revision: 5, etapa_ids: [secondStage, stage] } });
  for (const ids of [[stage], [stage, stage], [stage, deliverable]]) assert.throws(() => buildProjectMutation({ ...input, draft: { etapa_ids: ids } }));
});

test('task linking requires explicitly observed same-client task ID/revision; parent or task snapshots never silently rebase', () => {
  const observedTask = observedProjectTask({ id: 101, revision: 7, titulo: 'Implementación', estado: 'pendiente', cliente_id: 11 }, 101, 11);
  const input = form('task-link', { tarea_id: '101', etapa_id: stage }, { observedTask });
  const latestProject = { revision: 8 }, latestTask = { ...observedTask, revision: 9 };
  assert.equal(latestProject.revision, 8); assert.equal(latestTask.revision, 9);
  assert.deepEqual(buildProjectMutation(input).body, { expected_revision: 5, tarea_id: 101, expected_tarea_revision: 7, etapa_id: stage });
  assert.throws(() => buildProjectMutation({ ...input, observedTask: null }), /Consultá/);
  assert.throws(() => buildProjectMutation({ ...input, draft: { tarea_id: '102' } }), /Consultá/);
  assert.throws(() => observedProjectTask({ id: 101, revision: 7, titulo: 'Otra', cliente_id: 12 }, 101, 11));
  assert.deepEqual(buildProjectMutation(form('task-unlink', {}, { childId: 101 })), { method: 'DELETE', path: `/api/proyectos/${id}/tareas/101`, body: { expected_revision: 5 } });
});

test('unsafe material URLs never become links or mutation input', () => {
  for (const url of ['javascript:alert(1)', 'data:text/plain,x', 'https://user:password@example.test', 'https://example.test/a b', 'not-url']) {
    assert.equal(safeProjectUrl(url), null);
    assert.throws(() => buildProjectMutation(form('deliverable-create', { titulo: 'Entrega', url, observaciones: '', estado: 'pendiente' })));
  }
  assert.equal(safeProjectUrl(''), ''); assert.equal(safeProjectUrl('https://example.test'), 'https://example.test');
});

test('transport cancels late reads, isolates session disposal, and never retries mutations or silently adopts a new CAS', async () => {
  const pending = [deferred(), deferred()], calls = []; let index = 0;
  const client = createProjectsTransport((url, options) => { calls.push({ url, options }); return pending[index++].promise; });
  const first = client.read('detail', `/api/proyectos/${id}`), second = client.read('detail', `/api/proyectos/${requestId}`);
  assert.equal(calls[0].options.signal.aborted, true);
  pending[0].resolve({ proyecto: fixture() }); assert.equal(await first, undefined);
  client.dispose(); assert.equal(calls[1].options.signal.aborted, true);
  pending[1].resolve({ proyecto: fixture() }); assert.equal(await second, undefined);
  assert.equal(await client.read('detail', '/api/proyectos'), undefined);
  let attempts = 0;
  const conflict = createProjectsTransport(async (_url, options) => { attempts++; assert.equal(JSON.parse(options.body).expected_revision, 5); throw Object.assign(new Error('stale'), { status: 409 }); });
  const draft = { titulo: 'Nueva' }, input = form('stage-create', draft), before = structuredClone(input);
  await assert.rejects(conflict.write(buildProjectMutation(input)), { status: 409 });
  assert.equal(attempts, 1); assert.deepEqual(input, before);
  assert.match(projectError({ status: 409 }), /Conservamos tus datos/);
  conflict.dispose();
});

test('write double-submit gate and logout disposal do not issue additional HTTP', async () => {
  const pending = deferred(); let attempts = 0, signal;
  const client = createProjectsTransport((_url, options) => { attempts++; signal = options.signal; return pending.promise; });
  const mutation = buildProjectMutation(form('stage-create', { titulo: 'Nueva' }));
  const first = client.write(mutation);
  await assert.rejects(client.write(mutation), /operación en curso/);
  assert.equal(attempts, 1); client.dispose(); assert.equal(signal.aborted, true);
  pending.resolve({ proyecto: fixture() }); assert.equal(await first, undefined);
});

test('JSX syntax parses in memory without bundling, build, API or artifacts', () => {
  const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
  const { transformSync } = require('esbuild');
  assert.doesNotThrow(() => transformSync(source, { loader: 'jsx', jsx: 'automatic' }));
});

test('principal UI uses server permissions, visible CAS, progressive forms, stable links and typed approval transitions', () => {
  assert.match(source, /export function ProjectsPage\(/);
  assert.match(source, /request = apiRequest/);
  assert.match(source, /key=\{JSON\.stringify\(\[user\.id, user\.rol, user\.activo, sesion\.token\]\)\}/);
  assert.match(source, /client\.dispose\(\)/);
  assert.match(source, /project\.permissions\.editar && !project\.archivado/);
  assert.match(source, /project\.permissions\.administrar/);
  assert.match(source, /baseRevision: project\?\.revision/);
  assert.match(source, /baseRevision: project\.revision, conflict: false/);
  assert.match(source, /form\.conflict && structural/);
  assert.match(source, /Actualizar proyecto y revisar/);
  assert.match(source, /Usar revisión \{project\.revision\}/);
  assert.match(source, /mutationBusy\.current/);
  assert.match(source, /window\.addEventListener\("popstate", navigate\)/);
  assert.match(source, /window\.removeEventListener\("popstate", navigate\)/);
  assert.match(source, /event\.metaKey && !event\.ctrlKey/);
  assert.match(source, /api\/tareas\/\$\{id\}\?workspace=render_os/);
  assert.match(source, /item\.estado_anterior/); assert.match(source, /item\.estado_nuevo/);
  assert.match(source, /item\.recurso_id/); assert.match(source, /item\.actor_id/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|\/api\/tareas["'].*,.*POST|dangerouslySetInnerHTML|\.nombre === ["'](?:Franco|Agustín)/);
  assert.match(css, /min-height:44px/); assert.match(css, /focus-visible/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media\(max-width:420px\)/); assert.match(css, /max-width:1600px/);
});
