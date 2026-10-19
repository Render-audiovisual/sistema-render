import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// DDL/source contract checks, never a PostgreSQL concurrency/FK certification.
const source = readFileSync(new URL('../migrations/063_projects.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const tables = ['proyectos', 'proyecto_miembros', 'proyecto_etapas', 'proyecto_hitos',
  'proyecto_entregables', 'proyecto_tareas', 'proyecto_actividad'];
function table(name) {
  const match = sql.match(new RegExp(`CREATE TABLE ${name} \\(([\\s\\S]*?)\\);`));
  assert.ok(match, `${name} table definition exists`);
  return match[1];
}
function body(name) {
  const match = sql.match(new RegExp(`CREATE FUNCTION ${name}\\([^]*?AS \\$\\$([^]*?)END \\$\\$;`));
  assert.ok(match, `${name} function exists`);
  return match[1];
}

test('063 adds seven project tables with only the authorized task CHECK replacement and no historical DML', () => {
  assert.deepEqual([...sql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]), tables);
  const installation = sql.replace(/CREATE FUNCTION[\s\S]*?END \$\$;/g, '');
  assert.doesNotMatch(installation, /\b(?:INSERT INTO|UPDATE \w+ SET|DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
  assert.deepEqual([...installation.matchAll(/ALTER TABLE (\w+) (DROP|ADD) CONSTRAINT (\w+)/g)].map(match => match.slice(1)),
    [['tareas', 'DROP', 'tareas_tipo_tarea_check'], ['tareas', 'ADD', 'tareas_tipo_tarea_check']]);
  assert.match(sql, /CHECK \(tipo_tarea IN \('diseno','edicion','produccion','community','administracion','desarrollo'\)\)/);
  assert.doesNotMatch(sql, /gen_random_uuid|uuid_generate|CREATE EXTENSION/i);
});

test('project metadata, manual states, dates, request identity and text bounds are explicit', () => {
  const definition = table('proyectos');
  assert.match(definition, /id UUID CONSTRAINT proyectos_pk PRIMARY KEY/);
  assert.match(definition, /tipo IN \('web','chatbot','mantenimiento','automatizacion','otro'\)/);
  assert.match(definition, /estado TEXT NOT NULL DEFAULT 'planificado'/);
  assert.match(definition, /estado IN \('planificado','en_curso','en_revision','pausado','finalizado','cancelado'\)/);
  assert.match(definition, /length\(btrim\(titulo\)\) BETWEEN 1 AND 250/);
  assert.match(definition, /descripcion TEXT NOT NULL DEFAULT '' CONSTRAINT proyectos_descripcion CHECK \(length\(descripcion\) <= 20000\)/);
  assert.match(definition, /archivado BOOLEAN NOT NULL DEFAULT false/);
  assert.match(definition, /revision INTEGER NOT NULL DEFAULT 1 CONSTRAINT proyectos_revision CHECK \(revision > 0\)/);
  assert.match(definition, /fecha_inicio IS NULL OR fecha_entrega IS NULL OR fecha_inicio <= fecha_entrega/);
  assert.match(definition, /request_id UUID NOT NULL/);
  assert.ok(definition.includes("length(request_hash) = 64 AND request_hash ~ '^[0-9a-f]{64}$'"));
  assert.match(definition, /UNIQUE \(creado_por_id, request_id\)/);
  for (const field of ['created_at', 'updated_at']) assert.ok(definition.includes(`${field} TIMESTAMPTZ NOT NULL DEFAULT now()`));
});

test('every FK is restrictive; project/client/user identities cannot be erased by cascades', () => {
  const references = [...sql.matchAll(/REFERENCES [\w]+\([^)]*\)(?: ON UPDATE RESTRICT)? ON DELETE RESTRICT/g)];
  assert.equal(references.length, (sql.match(/REFERENCES /g) || []).length);
  assert.equal(references.length, 16);
  assert.doesNotMatch(sql, /ON DELETE (?:CASCADE|SET NULL)|ON UPDATE CASCADE/);
  assert.match(table('proyecto_miembros'), /PRIMARY KEY \(proyecto_id, usuario_id\)/);
  for (const field of ['cliente_id', 'responsable_id', 'creado_por_id', 'actualizado_por_id'])
    assert.match(table('proyectos'), new RegExp(`${field} INTEGER NOT NULL CONSTRAINT proyectos_\\w+ REFERENCES`));
});

test('stage order is deferrable and both optional stage references enforce same-project tuples', () => {
  const stages = table('proyecto_etapas');
  assert.match(stages, /CHECK \(posicion >= 0\)/);
  assert.match(stages, /UNIQUE \(proyecto_id, id\)/);
  assert.match(stages, /CONSTRAINT proyecto_etapas_posicion_unique UNIQUE \(proyecto_id, posicion\) DEFERRABLE INITIALLY IMMEDIATE/);
  assert.match(stages, /estado IN \('pendiente','en_progreso','completada'\)/);
  for (const name of ['proyecto_hitos', 'proyecto_tareas']) {
    const definition = table(name);
    assert.match(definition, /etapa_id UUID,/);
    assert.match(definition, /FOREIGN KEY \(proyecto_id, etapa_id\) REFERENCES proyecto_etapas\(proyecto_id, id\) ON UPDATE RESTRICT ON DELETE RESTRICT/);
  }
  assert.match(table('proyecto_hitos'), /estado IN \('pendiente','completado','cancelado'\)/);
});

test('deliverable approval requires both ID and timestamp iff approved', () => {
  const definition = table('proyecto_entregables');
  assert.match(definition, /estado IN \('pendiente','en_revision','aprobado','correcciones'\)/);
  assert.match(definition, /estado = 'aprobado' AND aprobado_por_id IS NOT NULL AND aprobado_at IS NOT NULL/);
  assert.match(definition, /estado <> 'aprobado' AND aprobado_por_id IS NULL AND aprobado_at IS NULL/);
  assert.match(definition, /url TEXT NOT NULL DEFAULT ''/);
  assert.match(definition, /observaciones TEXT NOT NULL DEFAULT '' CONSTRAINT proyecto_entregables_observaciones CHECK \(length\(observaciones\) <= 20000\)/);
});

test('task relationships preserve unique real task IDs; activity is closed and contains no payload snapshots', () => {
  assert.match(table('proyecto_tareas'), /PRIMARY KEY \(proyecto_id, tarea_id\)/);
  assert.match(table('proyecto_tareas'), /CONSTRAINT proyecto_tareas_tarea_unique UNIQUE \(tarea_id\)/);
  const activity = table('proyecto_actividad');
  const actions = activity.match(/accion IN \((.*?)\)/)?.[1];
  assert.deepEqual([...actions.matchAll(/'([^']+)'/g)].map(match => match[1]), [
    'crear_proyecto', 'editar_proyecto', 'crear_etapa', 'editar_etapa', 'ordenar_etapas', 'crear_hito', 'editar_hito',
    'crear_entregable', 'editar_entregable', 'vincular_tarea', 'desvincular_tarea']);
  assert.doesNotMatch(activity, /JSON|nombre|titulo|payload|token|snapshot/i);
  assert.doesNotMatch(sql, /INSERT INTO tareas|UPDATE publicaciones SET|UPDATE proyectos SET estado/i);
});

test('approval history carries stable resource/actor and typed before/after states without a purge-blocking task FK', () => {
  const activity = table('proyecto_actividad');
  assert.match(activity, /actor_id INTEGER NOT NULL CONSTRAINT proyecto_actividad_actor_fk REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(activity, /recurso_id UUID,/);
  assert.match(activity, /tarea_id INTEGER CONSTRAINT proyecto_actividad_tarea_positive CHECK \(tarea_id IS NULL OR tarea_id > 0\)/);
  assert.doesNotMatch(activity, /REFERENCES tareas|FOREIGN KEY \(tarea_id\)|recurso_id UUID NOT NULL|estado_(?:anterior|nuevo) TEXT NOT NULL/);
  const allowed = ['planificado', 'en_curso', 'en_revision', 'pausado', 'finalizado', 'cancelado',
    'pendiente', 'en_progreso', 'completada', 'completado', 'aprobado', 'correcciones'];
  for (const field of ['estado_anterior', 'estado_nuevo']) {
    const values = activity.match(new RegExp(`${field} IS NULL OR ${field} IN \\((.*?)\\)`))?.[1];
    assert.ok(values);
    assert.deepEqual([...values.matchAll(/'([^']+)'/g)].map(match => match[1]), allowed);
  }
  assert.doesNotMatch(activity, /JSON|payload|snapshot|observaciones|descripcion/);
});

test('all project constraints and named trigger conflicts map to the coordinator prefix', () => {
  const names = [...sql.matchAll(/CONSTRAINT(?:\s*=)?\s*'?(\w+)/g)].map(match => match[1]);
  assert.ok(names.length > 35);
  assert.ok(names.every(name => name === 'tareas_tipo_tarea_check' || /^proyectos?_/.test(name)));
  assert.ok(names.every(name => name.length <= 63));
  assert.deepEqual([...sql.matchAll(/ERRCODE='23514', CONSTRAINT='([^']+)'/g)].map(match => match[1]),
    ['proyectos_isolation', 'proyectos_tarea_domain', 'proyectos_tarea_hidden_link', 'proyectos_cliente_linked', 'proyectos_external_task_binding']);
});

test('hidden tasks cannot gain a link, but later archive/trash preserves existing links and normal task updates', () => {
  const link = body('proyectos_guard_task_link');
  const hidden = link.indexOf("COALESCE(task_row.propiedades_extra->>'archivada_render_os','false')='true'");
  assert.ok(hidden > link.indexOf('FOR UPDATE') && hidden < link.indexOf('FROM proyectos'));
  assert.ok(link.indexOf('RETURN NEW') < hidden, 'unchanged task/project tuple skips new-link visibility checks');
  assert.match(link, /COALESCE\(task_row.propiedades_extra->>'papelera_render_os','false'\)='true'/);
  assert.match(link, /CONSTRAINT='proyectos_tarea_hidden_link'/);
  for (const name of ['proyectos_assert_task_domain', 'proyectos_guard_linked_task'])
    assert.doesNotMatch(body(name), /archivada_render_os|papelera_render_os|DELETE FROM proyecto_tareas/);
});

test('project revision trigger advances every UPDATE without inferring task/editorial states', () => {
  const fn = body('proyectos_incrementar_revision');
  assert.match(fn, /NEW.revision := OLD.revision \+ 1/);
  assert.match(fn, /NEW.updated_at := clock_timestamp\(\)/);
  assert.match(sql, /CREATE TRIGGER proyectos_revision_cambio BEFORE UPDATE ON proyectos FOR EACH ROW EXECUTE FUNCTION proyectos_incrementar_revision\(\)/);
  assert.doesNotMatch(fn, /estado|publicada|finalizada|INSERT|SELECT/);
});

test('new task links lock task before project and verify client/workspace/editorial/production domain', () => {
  const link = body('proyectos_guard_task_link'), domain = body('proyectos_assert_task_domain');
  assert.ok(link.indexOf('FOR UPDATE') < link.indexOf('FOR SHARE'));
  assert.match(link, /SELECT \* INTO task_row FROM tareas WHERE id=NEW.tarea_id FOR UPDATE/);
  assert.ok(link.indexOf('FOR SHARE') < link.indexOf('PERFORM proyectos_assert_task_domain'));
  assert.ok(link.indexOf('RETURN NEW') < link.indexOf('FROM tareas'), 'unchanged task binding fast-returns');
  assert.match(domain, /task_row.cliente_id IS DISTINCT FROM expected_client/);
  assert.match(domain, /workspace' IS DISTINCT FROM 'render_os'/);
  assert.match(domain, /task_row.historia_id IS NOT NULL OR task_row.publicacion_id IS NOT NULL/);
  for (const relation of ['cliente_objetivo_piezas', 'produccion_visitas', 'produccion_videos']) assert.ok(domain.includes(`FROM ${relation}`));
  assert.match(domain, /task_row.tipo_tarea = 'produccion' AND .*LIKE '%visita%'/);
  assert.doesNotMatch(domain, /tipo_tarea\s*(?:<>|!=|IS DISTINCT FROM)\s*'desarrollo'/);
  assert.doesNotMatch(domain, /FOR UPDATE|FOR SHARE|pg_advisory/);
});

test('task UPDATE guard keeps normal state/assignment/date writes free of reverse project locks', () => {
  const fn = body('proyectos_guard_linked_task');
  assert.ok(fn.indexOf('RETURN NEW') < fn.indexOf('SELECT p.cliente_id'));
  assert.match(fn, /NEW.cliente_id,NEW.historia_id,NEW.publicacion_id,NEW.tipo_tarea,NEW.titulo,NEW.subtipo/);
  assert.match(fn, /PERFORM proyectos_assert_task_domain\(NEW,project_client\)/);
  assert.doesNotMatch(fn, /FOR UPDATE|FOR SHARE|pg_advisory|NEW.estado|NEW.asignado_a|NEW.fecha_vencimiento/);
  assert.match(body('proyectos_guard_client_change'), /NEW.cliente_id IS NOT DISTINCT FROM OLD.cliente_id THEN RETURN NEW; END IF; PERFORM proyectos_require_read_committed\(\); IF EXISTS\(SELECT 1 FROM proyecto_tareas WHERE proyecto_id=OLD.id\)/);
});

test('changed domain bindings reject non-RC isolation before lookups without extra locks; unchanged writes fast-return', () => {
  const helper = body('proyectos_require_read_committed');
  assert.match(helper, /current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed'/);
  assert.match(helper, /ERRCODE='23514', CONSTRAINT='proyectos_isolation'/);
  assert.doesNotMatch(helper, /FOR UPDATE|FOR SHARE|pg_advisory|SET TRANSACTION/);
  for (const [name, firstLookup] of [
    ['proyectos_guard_task_link', 'SELECT * INTO task_row'],
    ['proyectos_guard_linked_task', 'SELECT p.cliente_id'],
    ['proyectos_guard_client_change', 'IF EXISTS(SELECT 1 FROM proyecto_tareas'],
    ['proyectos_guard_external_task_binding', 'PERFORM id FROM tareas'],
  ]) {
    const fn = body(name), check = fn.indexOf('PERFORM proyectos_require_read_committed();');
    assert.ok(check > fn.indexOf('RETURN NEW'), `${name} unchanged branch skips isolation check`);
    assert.ok(check < fn.indexOf(firstLookup), `${name} checks isolation before domain snapshot/lock`);
    assert.equal((fn.match(/PERFORM proyectos_require_read_committed\(\)/g) || []).length, 1);
  }
  const task = body('proyectos_guard_linked_task');
  assert.doesNotMatch(task, /NEW.estado|NEW.asignado_a|NEW.fecha_vencimiento|FOR UPDATE|FOR SHARE|pg_advisory/);
});

test('reverse registry/goal guards serialize task adoption in sorted order and skip unchanged bindings', () => {
  const fn = body('proyectos_guard_external_task_binding');
  assert.match(fn, /PERFORM id FROM tareas WHERE id=ANY\(task_ids\) ORDER BY id FOR UPDATE/);
  assert.match(fn, /EXISTS\(SELECT 1 FROM proyecto_tareas WHERE tarea_id=ANY\(task_ids\)\)/);
  assert.ok(fn.indexOf('ORDER BY id FOR UPDATE') < fn.indexOf('FROM proyecto_tareas'),
    'reverse adoption checks project links only after the same task-row serialization point');
  assert.match(fn, /task_ids := ARRAY\[NEW.tarea_origen_id\]/);
  assert.match(fn, /task_ids := ARRAY\[NEW.tarea_edicion_id,NEW.tarea_entrega_id\]/);
  assert.match(fn, /task_ids := ARRAY\[NEW.tarea_id\]/);
  assert.ok(fn.indexOf('RETURN NEW') < fn.indexOf('PERFORM id'));
  for (const [relation, columns] of [['produccion_visitas', 'tarea_origen_id'], ['produccion_videos', 'tarea_edicion_id,tarea_entrega_id'], ['cliente_objetivo_piezas', 'tarea_id']])
    assert.ok(sql.includes(`BEFORE INSERT OR UPDATE OF ${columns} ON ${relation} FOR EACH ROW EXECUTE FUNCTION proyectos_guard_external_task_binding()`));
  assert.doesNotMatch(fn, /FROM proyectos|pg_advisory|UPDATE tareas SET/);
});

test('foreign-key lookup indexes and recent activity traversal are explicit', () => {
  for (const fragment of ['ON proyectos(cliente_id)', 'ON proyectos(responsable_id)', 'ON proyectos(actualizado_por_id)',
    'ON proyecto_miembros(usuario_id)', 'ON proyecto_hitos(proyecto_id, etapa_id)', 'ON proyecto_tareas(proyecto_id, etapa_id)',
    'ON proyecto_entregables(proyecto_id)', 'ON proyecto_entregables(aprobado_por_id)', 'ON proyecto_actividad(actor_id)',
    'ON proyecto_actividad(proyecto_id, created_at DESC, id DESC)']) assert.ok(sql.includes(fragment));
});
