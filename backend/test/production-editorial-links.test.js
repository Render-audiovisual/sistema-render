import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { linkGoalTask, prepareGoal } from '../src/client-goals.js';

// DDL contract checks only: real FK/trigger/concurrency behavior belongs to the
// coordinator's isolated PostgreSQL migration fixture, never ordinary tests.
const sql = readFileSync(new URL('../migrations/060_production_editorial_links.sql', import.meta.url), 'utf8');
const compact = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

test('060 is additive only and declares exactly three nullable editorial identity columns', () => {
  assert.deepEqual([...compact.matchAll(/ADD COLUMN (\w+) INTEGER/g)].map(match => match[1]),
    ['publicacion_id', 'tarea_entrega_id', 'cliente_editorial_id']);
  assert.doesNotMatch(compact, /ADD COLUMN \w+ INTEGER (?:NOT NULL|DEFAULT)/);
  const installation = sql.replace(/CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?END \$\$;/g, '').replace(/--[^\n]*/g, '');
  assert.doesNotMatch(installation, /\b(?:INSERT INTO|DELETE FROM|TRUNCATE|DROP|UPDATE (?:tareas|publicaciones|produccion_videos|cliente_objetivo_piezas) SET)\b/i);
});

test('referenced composite unique tuples include existing primary IDs, preserving historical identities', () => {
  for (const [table, tuple] of [['publicaciones', 'id, cliente_id'], ['tareas', 'id, publicacion_id, cliente_id'],
    ['produccion_visitas', 'id, cliente_id']]) {
    assert.ok(compact.includes(`ALTER TABLE ${table} ADD CONSTRAINT produccion_editorial_`));
    assert.ok(compact.includes(`UNIQUE (${tuple})`));
  }
});

test('three composite FKs preserve publication/task/visit client identity across all writers', () => {
  assert.match(compact, /FOREIGN KEY \(publicacion_id, cliente_editorial_id\) REFERENCES publicaciones \(id, cliente_id\) MATCH FULL ON UPDATE RESTRICT ON DELETE RESTRICT/);
  assert.match(compact, /FOREIGN KEY \(tarea_entrega_id, publicacion_id, cliente_editorial_id\) REFERENCES tareas \(id, publicacion_id, cliente_id\) MATCH FULL ON UPDATE RESTRICT ON DELETE RESTRICT/);
  assert.match(compact, /FOREIGN KEY \(visita_id, cliente_editorial_id\) REFERENCES produccion_visitas \(id, cliente_id\) MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT/);
});

test('editorial tuple is all-null or fully positive with unique publication/task and conditional handoff match', () => {
  assert.match(compact, /publicacion_id IS NULL AND tarea_entrega_id IS NULL AND cliente_editorial_id IS NULL/);
  for (const key of ['publicacion_id', 'tarea_entrega_id', 'cliente_editorial_id']) {
    assert.ok(compact.includes(`${key} IS NOT NULL AND ${key} > 0`));
  }
  assert.match(compact, /produccion_editorial_publicacion_unique UNIQUE \(publicacion_id\)/);
  assert.match(compact, /produccion_editorial_tarea_entrega_unique UNIQUE \(tarea_entrega_id\)/);
  assert.match(compact, /CHECK \( publicacion_id IS NULL OR tarea_edicion_id IS NULL OR tarea_edicion_id = tarea_entrega_id \)/);
});

test('goal guard fast-returns normal state/copy updates before inspecting video links, without reverse locks', () => {
  const start = sql.indexOf('CREATE FUNCTION produccion_editorial_guard_goal_tuple');
  const body = sql.slice(start, sql.indexOf('END $$;', start));
  assert.match(body, /NEW\.tarea_id IS NOT DISTINCT FROM OLD\.tarea_id[\s\S]*NEW\.publicacion_id IS NOT DISTINCT FROM OLD\.publicacion_id[\s\S]*RETURN NEW/);
  assert.match(body, /NEW\.tipo IS NOT DISTINCT FROM OLD\.tipo/);
  assert.match(body, /NEW\.objetivo_id IS NOT DISTINCT FROM OLD\.objetivo_id/);
  assert.ok(body.indexOf('RETURN NEW') < body.indexOf('SELECT 1 FROM produccion_videos'));
  assert.doesNotMatch(body, /FOR UPDATE|FOR SHARE|pg_advisory/);
  assert.match(compact, /BEFORE INSERT OR UPDATE OR DELETE ON cliente_objetivo_piezas/);
  assert.match(body, /v\.publicacion_id = OLD\.publicacion_id OR v\.tarea_entrega_id = OLD\.tarea_id/);
  assert.match(body, /NEW\.tarea_id IS DISTINCT FROM v\.tarea_entrega_id/);
  assert.match(body, /NEW\.publicacion_id IS DISTINCT FROM v\.publicacion_id/);
  assert.match(body, /NEW\.tipo IS DISTINCT FROM 'video'/);
  assert.match(body, /o.id = NEW.objetivo_id AND account->>'id' = v.cliente_editorial_id::text/);
});

test('subsequent publication format guard is scoped to linked publications and never changes state/dates', () => {
  assert.match(compact, /BEFORE UPDATE OF tipo ON publicaciones/);
  assert.match(compact, /NEW.tipo IS DISTINCT FROM OLD.tipo/);
  assert.match(compact, /NEW.tipo IS NULL OR NEW.tipo NOT IN \('reel', 'video'\)/);
  assert.match(compact, /SELECT 1 FROM produccion_videos v WHERE v.publicacion_id = OLD.id/);
  const start = sql.indexOf('CREATE FUNCTION produccion_editorial_guard_publication_format');
  const body = sql.slice(start, sql.indexOf('END $$;', start));
  assert.doesNotMatch(body, /fecha_publicación_real|completada_at|SET estado/);
});

test('one expression index prevents cross-column task claims without an additional uniqueness trigger', () => {
  assert.match(compact, /CREATE UNIQUE INDEX produccion_editorial_canonical_task_unique ON produccion_videos \(\(COALESCE\(tarea_entrega_id, tarea_edicion_id\)\)\) WHERE COALESCE\(tarea_entrega_id, tarea_edicion_id\) IS NOT NULL/);
  assert.equal([...compact.matchAll(/CREATE TRIGGER produccion_editorial_video_binding_guard/g)].length, 1);
});

test('initial video link validates format and canonical task domain under task then publication SHARE locks', () => {
  const start = sql.indexOf('CREATE FUNCTION produccion_editorial_guard_video_binding');
  const body = sql.slice(start, sql.indexOf('END $$;', start));
  assert.match(body, /NEW\.publicacion_id IS NOT DISTINCT FROM OLD\.publicacion_id/);
  assert.match(body, /NEW\.tarea_entrega_id IS NOT DISTINCT FROM OLD\.tarea_entrega_id/);
  assert.match(body, /NEW\.cliente_editorial_id IS NOT DISTINCT FROM OLD\.cliente_editorial_id/);
  assert.ok(body.indexOf('RETURN NEW') < body.indexOf('SELECT propiedades_extra'));
  assert.match(body, /WHERE id = NEW.tarea_entrega_id FOR SHARE/);
  assert.match(body, /WHERE id = NEW.publicacion_id FOR SHARE/);
  assert.ok(body.indexOf('FROM tareas') < body.indexOf('FROM publicaciones'));
  assert.match(body, /canonical_task.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'/);
  assert.match(body, /canonical_task.historia_id IS NOT NULL/);
  assert.match(body, /publication_type NOT IN \('reel', 'video'\)/);
});

test('bound task domain guard rejects workspace/history changes but skips unrelated metadata updates', () => {
  const start = sql.indexOf('CREATE FUNCTION produccion_editorial_guard_task_domain');
  const body = sql.slice(start, sql.indexOf('END $$;', start));
  assert.ok(body.indexOf('RETURN NEW') < body.indexOf('SELECT 1 FROM produccion_videos'));
  assert.match(body, /v.tarea_entrega_id = OLD.id/);
  assert.match(compact, /BEFORE UPDATE OF propiedades_extra, historia_id ON tareas/);
});

test('060 task synchronization preserves exact 058 business logic while moving publication copy ahead of goal locks', () => {
  const baseline = readFileSync(new URL('../migrations/058_task_work_states.sql', import.meta.url), 'utf8');
  const signature = 'CREATE OR REPLACE FUNCTION sincronizar_cliente_objetivo_tarea()';
  const current = sql.slice(sql.indexOf(signature));
  const old = baseline.slice(baseline.indexOf(signature));
  const publicationBlock = /IF pieza\.publicacion_id IS NOT NULL[\s\S]*?END IF;/;
  const normalize = source => source.replace(publicationBlock, '').replace(/FOR UPDATE LOOP/, 'LOOP').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(current), normalize(old));
  assert.ok(current.indexOf('UPDATE publicaciones SET copy') < current.indexOf('UPDATE cliente_objetivo_piezas SET'));
  assert.doesNotMatch(current, /FOR UPDATE|fecha_publicación_real|UPDATE publicaciones SET estado/);
  assert.match(current, /NEW.estado IN \('finalizada','publicada'\)/);
  assert.match(current, /INSERT INTO cliente_objetivo_eventos/);
});

test('goal preparation locks candidates by ID then preserves completed/publication priority in memory', async () => {
  const calls = [];
  const objective = { id: 90, nombre: 'QA', cuentas: [{ id: 1 }], reels: 1, carruseles: 1 };
  const db = { async connect() { return db; }, release() {}, async query(statement, params = []) {
    calls.push({ sql: statement, params });
    if (statement.includes('FROM clientes c')) return { rows: [{ id: 1, nombre: 'QA', cuota_reels: 1, cuota_carruseles: 1 }] };
    if (statement.includes('FROM cliente_objetivo_responsables')) return { rows: [] };
    if (statement.startsWith('SELECT id,nombre,usuario FROM usuarios')) return { rows: [{ id: 7, nombre: 'QA' }] };
    if (statement.includes('SELECT * FROM cliente_objetivos_mensuales')) return { rows: [objective] };
    if (statement.includes('SELECT t.*,p.tipo pieza_tipo')) {
      assert.match(statement, /ORDER BY t.id FOR UPDATE OF t/);
      return { rows: [{ id: 10, titulo: 'Carrusel pending', estado: 'pendiente', asignado_a: 'QA' },
        { id: 20, titulo: 'Carrusel completed', estado: 'finalizada', asignado_a: 'QA' }] };
    }
    if (statement.includes('FROM publicaciones p WHERE')) {
      assert.match(statement, /ORDER BY p.id FOR UPDATE OF p/);
      return { rows: [{ id: 30, cliente_id: 1, tipo: 'video', estado: 'pendiente', preparation_candidate:true, metadata:{} },
        { id: 40, cliente_id: 1, tipo: 'video', estado: 'publicada', preparation_candidate:true, metadata:{} }] };
    }
    if (statement.startsWith('INSERT INTO tareas(')) return { rows: [{ id: 100, titulo: params[0], estado: params[1],
      asignado_a: params[2], publicacion_id: params[4], propiedades_extra: JSON.parse(params[7]) }] };
    return { rows: [] };
  } };
  await prepareGoal(db, { period: '2026-10', key: 'cliente-1', responsibleIds: [7], actor: 'QA' });
  const task = calls.find(call => call.sql.startsWith('INSERT INTO tareas('));
  assert.equal(task.params[4], 40, 'published candidate preferred only after ID-ordered locks');
  const slots = calls.filter(call => call.sql.startsWith('INSERT INTO cliente_objetivo_piezas'));
  assert.equal(slots.find(call => call.params[1] === 'carrusel').params[3], 20);
});

test('domain errors use 23514 with explicit prefixed constraint names for safe 409 mapping', () => {
  const names = [...compact.matchAll(/ADD CONSTRAINT (\w+)/g)].map(match => match[1]);
  assert.ok(names.length >= 10);
  assert.ok(names.every(name => name.startsWith('produccion_editorial') && name.length <= 63));
  const raised = [...compact.matchAll(/RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = '(\w+)'/g)];
  assert.equal(raised.length, 6);
  assert.ok(raised.every(match => match[1].startsWith('produccion_editorial')));
});

function mockLink({ oldPublication = 10, incomingPublication = null } = {}) {
  const stamp = '2026-10-19T12:00:00Z';
  const calls = [];
  const task = { id: 2, titulo: 'Reel QA', cliente_id: 1, estado: 'pendiente', asignado_a: 'Editor',
    publicacion_id: incomingPublication, updated_at: stamp, periodo_trabajo: '2026-10',
    propiedades_extra: { workspace: 'render_os' } };
  const piece = { id: 1, objetivo_id: 1, tarea_id: 1, publicacion_id: oldPublication, tipo: 'video', numero: 1,
    periodo: '2026-10', cuentas: [{ id: 1 }], reels: 1, carruseles: 0, estado: 'pendiente', updated_at: stamp };
  const db = { async connect() { return db; }, release() { calls.push({ sql: 'RELEASE' }); },
    async query(statement, params = []) {
      calls.push({ sql: statement, params });
      if (statement.includes('SELECT p.tarea_id,p.publicacion_id,o.clave')) return { rows: [{ tarea_id: 1, publicacion_id: oldPublication, clave: 'cliente-1', periodo: '2026-10' }] };
      if (statement.includes('SELECT t.*,p.tipo pieza_tipo')) return { rows: [task] };
      if (statement.includes('SELECT p.*,to_char(o.periodo')) return { rows: [piece] };
      if (statement.startsWith('SELECT estado,metadata FROM publicaciones')) return { rows: [{ estado: 'pendiente', metadata:{} }] };
      if (statement.startsWith('SELECT t.estado,p.metadata pieza_metadata')) return { rows: [{ estado: 'pendiente', pieza_metadata:null, historia_metadata:null }] };
      if (statement.includes('SELECT count(*) FILTER')) return { rows: [{ completadas: 0, total: 1 }] };
      return { rows: [] };
    } };
  return { db, calls, body: { tarea_id: 2, expected_tarea_updated_at: stamp, expected_pieza_updated_at: stamp } };
}

for (const incomingPublication of [null, undefined, 20]) {
  test(`generic goal replacement rejects clearing/swapping existing publication (${incomingPublication}) before writes`, async () => {
    const { db, calls, body } = mockLink({ incomingPublication });
    await assert.rejects(linkGoalTask(db, 1, body, 'QA'), { status: 409 });
    assert.equal(calls.some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql)), false);
    assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
    assert.equal(calls.some(call => call.sql === 'COMMIT'), false);
    assert.equal(calls.at(-1).sql, 'RELEASE');
  });
}

test('generic unbound slot replacement remains possible without inventing a publication', async () => {
  const { db, calls, body } = mockLink({ oldPublication: null, incomingPublication: null });
  await linkGoalTask(db, 1, body, 'QA');
  const update = calls.find(call => call.sql.startsWith('UPDATE cliente_objetivo_piezas'));
  assert.equal(update.params[2], null);
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
  assert.equal(calls.some(call => /^(INSERT INTO publicaciones|UPDATE tareas)/.test(call.sql)), false);
});

test('matching existing publication is preserved rather than silently relinked', async () => {
  const { db, calls, body } = mockLink({ incomingPublication: 10 });
  await linkGoalTask(db, 1, body, 'QA');
  const update = calls.find(call => call.sql.startsWith('UPDATE cliente_objetivo_piezas'));
  assert.equal(update.params[2], 10);
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});
