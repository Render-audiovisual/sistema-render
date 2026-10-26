import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITING_PROGRESS_SCHEMA, normalizeEditingProgressQuery, assertEditingProgressSchema, recordEditingProgressDelivery,
  projectEditingProgressTask, loadEditingProgressAudit } from '../src/editing-progress-ledger.js';

const DELIVERY = '20000000-0000-4000-8000-000000000002';
const input = { taskId: 81, deliveryId: DELIVERY, expectedTaskRevision: 5 };
function catalog() {
  return { columns: Object.entries(EDITING_PROGRESS_SCHEMA.columns).map(([name, [type, notNull]]) => ({ name, type, notNull })),
    constraints: Object.entries(EDITING_PROGRESS_SCHEMA.constraints).map(([name, definition]) => ({ name, definition, validated: true, deferred: false })) };
}
function fixture(options = {}) {
  const calls = [];
  const task = { id: 81, revision: 5, estado: 'en_revision', tipo_tarea: 'edicion', titulo: 'Entrega', cliente_id: 7,
    propiedades_extra: { workspace: 'render_os' }, ...options.task };
  const db = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (options.fault) { const error = options.fault(sql); if (error) throw error; }
    if (sql.includes('FROM pg_constraint')) return { rows: [options.schema === 0 ? {} : options.catalog ?? catalog()] };
    if (sql.includes('FROM tareas WHERE')) return { rows: options.missingTask ? [] : [task] };
    if (sql.includes('FROM task_editing_deliveries')) return { rows: options.deliveries ?? [{ id: DELIVERY, task_id: 81, task_revision: 5, recorded_at: '2026-10-01T03:00:00.000Z' }] };
    if (sql.startsWith('SELECT tarea_id,editor_user_id')) return { rows: options.previous ? [options.previous] : [] };
    if (sql.includes('FROM tarea_asignaciones')) return { rows: options.members ?? [{ usuario_id: 9, tipo: 'responsable', activo: true }] };
    if (sql.includes('LEFT JOIN clientes')) return { rows: options.rows ?? [] };
    if (sql.includes('RETURNING tarea_id')) return { rows: options.changed === false ? [] : [{ tarea_id: 81 }] };
    return { rows: [] };
  } };
  return { db, calls };
}
const writes = h => h.calls.filter(c => /^(INSERT|UPDATE)/.test(c.sql));
const row = (extra = {}) => ({ id: '1', tarea_id: '81', editor_clave: 'luciano', titulo_snapshot: 'Histórica', estado_actual: 'en_revision',
  fecha_entrega: '2026-10-01', cliente_nombre: null, editor_user_id: null, origen_registro: null, delivery_id: null, task_revision: null, ...extra });

test('query is closed and ID 9 is not a name/role binding', () => {
  assert.deepEqual(normalizeEditingProgressQuery({ periodo: '2026-10', editor_id: '9' }), { periodo: '2026-10', editorId: 9 });
  for (const query of [null, [], {}, { periodo: '0000-01' }, { periodo: '2026-13' }, { periodo: ['2026-10'] },
    { periodo: '2026-10', persona: 'Luciano' }, ...['0', '09', 9, ['9'], '2147483648', 'Franco'].map(editor_id => ({ periodo: '2026-10', editor_id }))]) {
    assert.throws(() => normalizeEditingProgressQuery(query), { status: 400 });
  }
});

test('schema absence or missing columns is unavailable, unexpected SQL errors propagate', async () => {
  await assert.rejects(assertEditingProgressSchema(fixture({ schema: 0 }).db), { status: 503 });
  for (const code of ['42P01', '42703', '08006']) {
    const h = fixture({ fault: sql => sql.includes('LIMIT 0') ? Object.assign(new Error('db failure'), { code }) : null });
    await assert.rejects(assertEditingProgressSchema(h.db), code === '08006' ? { code } : { status: 503 });
  }
});

test('same constraint names cannot hide wrong types, predicates, nullability, uniqueness or FK targets', async () => {
  const mutations = [
    c => { c.columns.find(x => x.name === 'editor_user_id').type = 'text'; },
    c => { c.columns.find(x => x.name === 'editor_user_id').notNull = true; },
    c => { c.columns = c.columns.filter(x => x.name !== 'delivery_id'); },
    c => { c.constraints.find(x => x.name === 'editing_progress_v1_source').definition = 'CHECK (true)'; },
    c => { c.constraints.find(x => x.name === 'editing_progress_v1_task_unique').definition = 'UNIQUE (tarea_id, delivery_id)'; },
    c => { c.constraints.find(x => x.name === 'editing_progress_v1_delivery_fk').definition = 'FOREIGN KEY (delivery_id) REFERENCES task_editing_deliveries(id)'; },
    c => { c.constraints[0].validated = false; },
    c => { c.constraints[0].deferred = true; },
  ];
  for (const mutate of mutations) {
    const candidate = catalog(); mutate(candidate);
    const h = fixture({ catalog: candidate });
    await assert.rejects(recordEditingProgressDelivery(h.db, input), { status: 503 });
    assert.equal(writes(h).length, 0);
    assert.equal(h.calls.some(c => c.sql.includes('FROM tareas')), false);
  }
});

test('new credit uses assignment ID and exact artifact time, never actor or name', async () => {
  const h = fixture();
  assert.deepEqual(await recordEditingProgressDelivery(h.db, input), { taskId: 81, replayed: false });
  const insert = writes(h)[0];
  assert.match(insert.sql, /^INSERT/);
  assert.deepEqual(insert.params, [81, 'user:9', 'Entrega', 7, 'en_revision', '2026-10-01T03:00:00.000Z', 9, DELIVERY, 5]);
  assert.doesNotMatch(h.calls.map(c => c.sql).join('\n'), /entregas_edicion\b|BEGIN|COMMIT|FOR UPDATE|pg_advisory|lower\(|asignado_a/);
});

test('explicit assigned collaborator ID is valid; names and editor role are irrelevant', async () => {
  const h = fixture({ task: { propiedades_extra: { workspace: 'render_os', edicion_responsable_id: 9 } },
    members: [{ usuario_id: 4, tipo: 'responsable', activo: true }, { usuario_id: 9, tipo: 'colaborador', activo: true }] });
  await recordEditingProgressDelivery(h.db, input);
  assert.equal(writes(h)[0].params[6], 9);
});

test('missing, inactive, ambiguous and inconsistent explicit assignment fail without writing', async () => {
  const cases = [{ members: [] }, { members: [{ usuario_id: 9, tipo: 'colaborador', activo: true }] },
    { members: [{ usuario_id: 9, tipo: 'responsable', activo: false }] },
    { members: [9, 10].map(usuario_id => ({ usuario_id, tipo: 'responsable', activo: true })) },
    { members: ['responsable', 'colaborador'].map(tipo => ({ usuario_id: 9, tipo, activo: true })) },
    ...[99, '9', 0].map(edicion_responsable_id => ({ task: { propiedades_extra: { workspace: 'render_os', edicion_responsable_id } } }))];
  for (const options of cases) {
    const h = fixture(options);
    await assert.rejects(recordEditingProgressDelivery(h.db, input), { status: 409, code: 'editing_progress_assignment_required' });
    assert.equal(writes(h).length, 0);
  }
});

test('historical row receives evidence but no reattribution, snapshot or date rewrite', async () => {
  const h = fixture({ previous: { tarea_id: 81, editor_user_id: null, origen_registro: null, delivery_id: null, task_revision: null }, members: [] });
  await recordEditingProgressDelivery(h.db, input);
  assert.equal(writes(h).length, 1);
  assert.doesNotMatch(writes(h)[0].sql, /editor_user_id|editor_clave|origen_registro|entregada_at|titulo_snapshot|cliente_id/);
  assert.equal(h.calls.some(c => c.sql.includes('FROM tarea_asignaciones')), false);
});

test('replay is mutation-free; later versions preserve original canonical credit', async () => {
  const previous = { tarea_id: 81, editor_user_id: 9, origen_registro: 'canonical_delivery', delivery_id: DELIVERY, task_revision: 5 };
  const replay = fixture({ previous });
  assert.equal((await recordEditingProgressDelivery(replay.db, input)).replayed, true);
  assert.equal(writes(replay).length, 0);
  const next = fixture({ previous: { ...previous, delivery_id: '30000000-0000-4000-8000-000000000003', task_revision: 4 }, members: [] });
  await recordEditingProgressDelivery(next.db, input);
  assert.doesNotMatch(writes(next)[0].sql, /editor_user_id|entregada_at/);
});

test('wrong task/version/artifact, trash, other scope and closed writer input reject', async () => {
  for (const options of [{ missingTask: true }, { task: { revision: 6 } }, { task: { estado: 'aprobada' } },
    { task: { propiedades_extra: { workspace: 'other' } } }, { task: { propiedades_extra: { workspace: 'render_os', papelera_render_os: 'true' } } },
    { deliveries: [] }, { deliveries: [{ id: DELIVERY, task_id: 82, task_revision: 5 }] },
    { deliveries: [{ id: DELIVERY, task_id: 81, task_revision: 4 }] },
    { previous: { task_revision: 6 } }]) {
    const h = fixture(options);
    await assert.rejects(recordEditingProgressDelivery(h.db, input), { status: 409 });
    assert.equal(writes(h).length, 0);
  }
  await assert.rejects(recordEditingProgressDelivery(fixture().db, { ...input, editorId: 9 }), { status: 400 });
});

test('projection keeps approval/finalization active and correction inactive without inserts or credit changes', async () => {
  for (const estado of ['en_revision', 'aprobada', 'finalizada', 'publicada', 'en_progreso', 'pendiente']) {
    const h = fixture({ task: { estado } });
    await projectEditingProgressTask(h.db, { taskId: 81, expectedTaskRevision: 5 });
    const write = writes(h)[0];
    assert.equal(write.params[3], !['pendiente', 'en_progreso'].includes(estado));
    assert.match(write.sql, /task_revision<=\$3/);
    assert.doesNotMatch(write.sql, /INSERT|editor_user_id|entregada_at|delivery_id\s*=/);
    assert.match(write.sql, /task_revision=CASE WHEN delivery_id IS NOT NULL THEN \$3 ELSE NULL END/);
  }
});

test('archive alone preserves delivery; trash or leaving editing deactivates it', async () => {
  for (const [task, expected] of [[{ propiedades_extra: { workspace: 'render_os', archivada_render_os: true } }, true],
    [{ propiedades_extra: { workspace: 'render_os', papelera_render_os: true } }, false], [{ tipo_tarea: 'diseno' }, false]]) {
    const h = fixture({ task });
    await projectEditingProgressTask(h.db, { taskId: 81, expectedTaskRevision: 5 });
    assert.equal(writes(h)[0].params[3], expected);
  }
});

test('historical GET counts one task, approval separately and legacy final as task final, closed DTO', async () => {
  const h = fixture({ rows: [row({ private: 'SECRET' }), row({ id: '2', tarea_id: '82', estado_actual: 'aprobada' }),
    row({ id: '3', tarea_id: '83', estado_actual: 'publicada' })] });
  const result = await loadEditingProgressAudit(h.db, { periodo: '2026-10' });
  assert.equal(result.total_operativo, 3);
  assert.equal(result.aprobadas_actuales, 1);
  assert.equal(result.en_revision_actuales, 1);
  assert.equal(result.finalizadas_registradas, 1);
  assert.deepEqual(result.desglose_origen, { historicas: 3, canonicas: 0 });
  assert.equal(result.entregas[2].estado_canonico, 'finalizada');
  assert.equal(result.entregas[0].editor_user_id, null);
  assert.match(result.editor, /identidad no verificada/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  assert.deepEqual(result.revisiones, [result.entregas[0]]);
});

test('canonical GET never merges historical key into user 9', async () => {
  const h = fixture({ rows: [row({ editor_clave: 'user:9', editor_user_id: 9, origen_registro: 'canonical_delivery', delivery_id: DELIVERY, task_revision: 5 })] });
  const result = await loadEditingProgressAudit(h.db, { periodo: '2026-10', editor_id: '9' });
  assert.equal(result.entregas[0].atribucion, 'asignacion_id');
  assert.deepEqual(result.desglose_origen, { historicas: 0, canonicas: 1 });
  await assert.rejects(loadEditingProgressAudit(fixture({ rows: [row()] }).db, { periodo: '2026-10', editor_id: '9' }), { status: 503 });
});

test('duplicate tasks, invalid source and out-of-period rows fail instead of inventing totals', async () => {
  for (const rows of [[row(), row()], [row({ origen_registro: 'unknown' })], [row({ editor_user_id: 9 })],
    [row({ estado_actual: 'en_progreso' })], [row({ fecha_entrega: '2026-09-30' })]]) {
    await assert.rejects(loadEditingProgressAudit(fixture({ rows }).db, { periodo: '2026-10' }), { status: 503 });
  }
});

test('month query uses indexed half-open Argentina instants including December, never deadlines/finance', async () => {
  const h = fixture();
  await loadEditingProgressAudit(h.db, { periodo: '2026-12' });
  const query = h.calls.find(c => c.sql.includes('LEFT JOIN clientes'));
  assert.deepEqual(query.params, ['2026-12-01', null]);
  assert.match(query.sql, /pe.entregada_at >=/);
  assert.match(query.sql, /pe.entregada_at </);
  assert.match(query.sql, /INTERVAL '1 month'/);
  assert.match(query.sql, /America\/Argentina\/Buenos_Aires/);
  assert.doesNotMatch(query.sql, /fecha_vencimiento|updated_at|FROM entregas_edicion/);
});
