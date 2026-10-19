import test from 'node:test';
import assert from 'node:assert/strict';
import { taskOperationalDto, editorialOperationalDto, clientOperationalDto } from '../src/operational-dto.js';

const roles = [{ rol: 'produccion' }, { rol: 'diseno' }, { rol: 'edicion' }, { rol: 'community' },
  { rol: 'lider' }, { rol: 'unknown' }, {}, null];
const finance = { abono: 'FINANCE_SENTINEL', sueldo: 900, rentabilidad: 'SECRET' };

test('only an own admin role returns the exact raw object for all resources', () => {
  const source = { id: 7, ...finance, metadata: finance };
  for (const dto of [taskOperationalDto, editorialOperationalDto, clientOperationalDto]) {
    assert.equal(dto(source, { rol: 'admin' }), source);
    for (const auth of [...roles, Object.create({ rol: 'admin' })]) {
      const result = dto(source, auth);
      assert.equal(result.id, 7);
      assert.equal(result.abono, undefined);
      assert.doesNotMatch(JSON.stringify(result), /FINANCE_SENTINEL|SECRET/);
      assert.notEqual(result, source);
    }
  }
});

test('task DTO preserves revisions, joins, canonical states, identity arrays and ISO dates', () => {
  const source = { id: 1, revision: 3, estado: 'aprobada', titulo: 'Brief', asignado_a_id: 7,
    colaborador_ids: [8, '9', 0, -2, 2.5, null, {}, 10, Infinity],
    cliente_nombre: 'Client', tarea_padre_estado: 'finalizada', historia_fecha_programada: '2026-10-19',
    publicacion_tipo: 'reel', publicacion_estado: 'lista', updated_at: new Date('2026-10-19T12:00:00Z'),
    dynamic_priority: 'Alta', dynamic_priority_label: 'Prioridad alta', priority_reasons: ['Vence hoy', finance],
    ...finance };
  const result = taskOperationalDto(source);
  assert.deepEqual(result.colaborador_ids, [8, 10]);
  assert.equal(result.revision, 3);
  assert.equal(result.estado, 'aprobada');
  assert.equal(result.publicacion_estado, 'lista');
  assert.equal(result.historia_fecha_programada, '2026-10-19');
  assert.equal(result.updated_at, '2026-10-19T12:00:00.000Z');
  assert.equal(result.dynamic_priority, 'Alta');
  assert.equal(result.dynamic_priority_label, 'Prioridad alta');
  assert.deepEqual(result.priority_reasons, ['Vence hoy']);
});

test('core text guiones and compatibility operational properties survive without arbitrary bags', () => {
  const extra = { resumen: 'User brief', guiones: 'Voice-over', copy_trabajo: 'Copy',
    etiquetas: ['a', finance], colaboradores: ['Ana', finance], material: 'link', Material: 'old link',
    feedback: 'Review', motivo_bloqueo: 'Waiting', coordinada: true, horario: '10:00', motivo: 'Weather',
    escalada_a: 'Leader', destrabada_por: 'Editor', fecha_destrabe: '2026-10-19',
    clickup_lista: 'Videos', clickup_cerrada_at: '2026-10-19', edicion_responsable: 'Editor',
    reporte_fuente: 'clickup', reporte_periodo: '2026-10', wilson_confirmado_por: 'Leader', ...finance };
  const result = taskOperationalDto({ propiedades_extra: extra }).propiedades_extra;
  for (const key of Object.keys(extra).filter(key => !Object.hasOwn(finance, key) && !['etiquetas', 'colaboradores'].includes(key))) assert.deepEqual(result[key], extra[key], key);
  assert.deepEqual(result.etiquetas, ['a']);
  assert.deepEqual(result.colaboradores, ['Ana']);
  assert.equal(result.abono, undefined);
});

test('Wilson duplicate reasons and actual priority labels retain only their declared types', () => {
  const result = taskOperationalDto({ razones: ['mismo título', finance, 42, ['nested']],
    dynamic_priority: 'alta', dynamic_priority_label: 'Prioridad alta', ...finance });
  assert.deepEqual(result, { dynamic_priority: 'alta', dynamic_priority_label: 'Prioridad alta', razones: ['mismo título'] });
  assert.deepEqual(taskOperationalDto({ razones: finance, dynamic_priority: finance, dynamic_priority_label: finance }), {});
});

test('structured scripts/scenes have a closed schema and reject object-valued scalar fields', () => {
  const result = taskOperationalDto({ propiedades_extra: { guiones: [
    { id: 's', titulo: 'Script', texto: 'Words', ...finance,
      escenas: [{ id: 1, texto: 'Shot', visual: 'Street', ...finance }, { texto: finance }] },
    'not a structured script', finance,
  ] } });
  assert.deepEqual(result.propiedades_extra.guiones, [{ id: 's', titulo: 'Script', texto: 'Words', escenas: [{ id: 1, texto: 'Shot', visual: 'Street' }] }]);
});

test('production allocations and correction/approval evidence preserve only declared scalars', () => {
  const record = { id: 'uuid', cantidad: 8, fecha: '2026-10-19', created_at: '2026-10-19T12:00:00Z',
    usuario: 'Recorder', usuario_id: 7, corregido_at: '2026-10-20', corregido_por: 'Leader',
    corregido_por_id: 8, corregido_desde: 5, periodo_objetivo: '2026-10', periodo_adelanto: '2026-11',
    cantidad_mes_actual: 7, cantidad_adelanto: 1 };
  const result = taskOperationalDto({ propiedades_extra: { produccion_registros: [{ ...record, ...finance }, { id: 22, cantidad: 1 }],
    produccion_confirmada_at: '2026-10-20', produccion_confirmada_por_id: 8,
    revision_aprobada: true, revision_aprobada_por: 'Leader', revision_aprobada_por_id: 8,
    revision_aprobada_at: '2026-10-20', finalizada_at: null } }).propiedades_extra;
  assert.deepEqual(result.produccion_registros, [record, { id: 22, cantidad: 1 }]);
  assert.equal(result.revision_aprobada_por_id, 8);
  assert.equal(result.produccion_confirmada_por_id, 8);
  assert.equal(result.finalizada_at, null);
});

test('attachment schemas apply to every declared container, never unknown nested data', () => {
  const safe = { id: 'drive', url: 'https://drive.google.com/open?id=drive', name: 'Video', uploaded_by: 'Ana' };
  const result = taskOperationalDto({ attachments: [{ ...safe, ...finance }],
    propiedades_extra: { drive_archivos: [{ ...safe, ...finance, name: finance }], uploads: [{ ...safe, ...finance }] } });
  assert.deepEqual(result.attachments, [safe]);
  assert.deepEqual(result.propiedades_extra.uploads, [safe]);
  assert.equal(result.propiedades_extra.drive_archivos[0].name, undefined);
  assert.doesNotMatch(JSON.stringify(result), /FINANCE_SENTINEL/);
});

test('Mia and supervisor nested markers have typed lists and closed fields without truncation', () => {
  const result = taskOperationalDto({ propiedades_extra: {
    mia_notificacion_pendiente: { tipo: 'correccion_grabacion', anterior: 5, nuevo: 8, creado_en: '2026-10-19',
      destinatarios: ['Leader', finance], task_ids: [1, '2', finance], ...finance },
    supervisor_bloqueo: { motivo: 'Needs material', usuario_id: 7, usuario_ids: [8, finance], ...finance },
    supervisor_ultimo_reporte: { texto: 'Working', usuario_id: 7, fecha: '2026-10-19', ...finance },
  } }).propiedades_extra;
  assert.deepEqual(result.mia_notificacion_pendiente.task_ids, [1]);
  assert.deepEqual(result.mia_notificacion_pendiente.destinatarios, ['Leader']);
  assert.deepEqual(result.supervisor_bloqueo.usuario_ids, [8]);
  assert.doesNotMatch(JSON.stringify(result), /FINANCE_SENTINEL/);
  const complete = taskOperationalDto({ propiedades_extra: { mia_notificacion_pendiente: { destinatarios: Array(100).fill('a') } } });
  assert.equal(complete.propiedades_extra.mia_notificacion_pendiente.destinatarios.length, 100);
});

test('all valid production records, files, scripts and nested scenes survive large histories', () => {
  const records = Array.from({ length: 1201 }, (_, index) => ({ id: `record-${index}`, cantidad: 1, fecha: '2026-10-19', ...finance }));
  const files = Array.from({ length: 301 }, (_, index) => ({ id: `file-${index}`, name: 'Video', url: 'https://example.com/video', ...finance }));
  const scenes = Array.from({ length: 251 }, (_, index) => ({ id: index + 1, texto: 'Shot', ...finance }));
  const scripts = Array.from({ length: 251 }, (_, index) => ({ id: `script-${index}`, texto: 'Words', ...finance }));
  scripts[250].escenas = scenes;
  const source = { colaborador_ids: Array.from({ length: 1201 }, (_, index) => index + 1),
    propiedades_extra: { produccion_registros: records, drive_archivos: files, guiones: scripts,
      mia_notificacion_pendiente: { destinatarios: Array(1201).fill('Ana') } } };
  const result = taskOperationalDto(source);
  assert.equal(result.colaborador_ids.length, 1201);
  assert.equal(result.propiedades_extra.produccion_registros.length, 1201);
  assert.equal(result.propiedades_extra.produccion_registros.at(-1).id, 'record-1200');
  assert.equal(result.propiedades_extra.drive_archivos.length, 301);
  assert.equal(result.propiedades_extra.drive_archivos.at(-1).id, 'file-300');
  assert.equal(result.propiedades_extra.guiones.length, 251);
  assert.equal(result.propiedades_extra.guiones.at(-1).escenas.length, 251);
  assert.equal(result.propiedades_extra.mia_notificacion_pendiente.destinatarios.length, 1201);
  assert.doesNotMatch(JSON.stringify(result), /FINANCE_SENTINEL|SECRET/);
  assert.equal(source.propiedades_extra.produccion_registros.at(-1).abono, 'FINANCE_SENTINEL');
});

test('editorial planning metadata and accented publication date are preserved', () => {
  const result = editorialOperationalDto({ id: 1, estado: 'publicada', fecha_publicación_real: new Date('2026-10-19T12:00:00Z'),
    responsable_diseño: 'Ana', fecha_revisión_aprobación: '2026-10-18', notas_planificacion: 'Plan',
    metadata: { hora: '12:00', tipo: 'flyer', Idea: 'Idea', Material: 'link', 'Aclaración': 'Brief',
      archivado_tablero: false, ...finance }, ...finance });
  assert.equal(result.fecha_publicación_real, '2026-10-19T12:00:00.000Z');
  assert.equal(result.responsable_diseño, 'Ana');
  assert.equal(result.metadata.Idea, 'Idea');
  assert.equal(result.metadata.abono, undefined);
});

test('client quotas, config flags and SQL numeric weekday arrays survive but abono never does', () => {
  const result = clientOperationalDto({ id: 1, nombre: 'Client', cuota_reels: 4, cuota_carruseles: 2,
    cuota_feed_compartida: 6, configuracion_vigente_desde: '2026-10-01', configuracion_completa: true,
    dias_historias: [0, 1, 6, '2', -1, 7, finance], dias_reels: [2], dias_carruseles: [3],
    metadata: { color: '#fff', ...finance }, ...finance });
  assert.equal(result.cuota_feed_compartida, 6);
  assert.equal(result.configuracion_completa, true);
  assert.deepEqual(result.dias_historias, [0, 1, 6]);
  assert.equal(result.abono, undefined);
  assert.equal(result.metadata.abono, undefined);
});

test('known SQL text projections cannot launder an object when raw source is available', () => {
  const encoded = JSON.stringify(finance);
  const task = taskOperationalDto({ resumen: encoded, copy_trabajo: encoded,
    propiedades_extra: { resumen: finance, copy_trabajo: finance } });
  assert.equal(task.resumen, undefined);
  assert.equal(task.copy_trabajo, undefined);
  const piece = editorialOperationalDto({ idea: encoded, copy: encoded, material_referencia: encoded, aclaraciones: encoded,
    metadata: { Idea: finance, Copy: finance, Material: finance, 'Aclaración': finance } });
  assert.doesNotMatch(JSON.stringify(piece), /FINANCE_SENTINEL/);
  // Real user text is not censored or parsed, even when it resembles JSON.
  assert.equal(editorialOperationalDto({ copy: encoded, metadata: { Copy: encoded } }).copy, encoded);
  assert.equal(taskOperationalDto({ resumen: encoded }).resumen, encoded);
});

test('objects under any allowed scalar are rejected, including known nested records', () => {
  for (const [dto, value] of [[taskOperationalDto, { titulo: finance, revision: finance,
    propiedades_extra: { resumen: finance, revision_aprobada_por: finance, produccion_registros: [{ cantidad: finance }] } }],
  [editorialOperationalDto, { idea: finance, metadata: { hora: finance } }],
  [clientOperationalDto, { nombre: finance, cuota_reels: finance }]]) {
    assert.doesNotMatch(JSON.stringify(dto(value)), /FINANCE_SENTINEL/);
  }
});

test('own data properties only: inherited fields, getters and hostile toJSON never run', () => {
  let invoked = 0;
  const source = Object.create({ titulo: 'Inherited', abono: 'SECRET' });
  Object.defineProperty(source, 'copy_trabajo', { get() { invoked++; return 'SECRET'; } });
  source.id = 7;
  source.propiedades_extra = Object.create({ resumen: 'Inherited' });
  source.propiedades_extra.copy_trabajo = 'Actual';
  source.toJSON = () => { invoked++; return finance; };
  const auth = Object.defineProperty({}, 'rol', { get() { invoked++; return 'admin'; } });
  const result = taskOperationalDto(source, auth);
  assert.equal(result.titulo, undefined);
  assert.deepEqual(result.propiedades_extra, { copy_trabajo: 'Actual' });
  assert.equal(result.toJSON, undefined);
  assert.equal(invoked, 0);
});

test('invalid dates/nonfinite scalars and unknown resource shapes fail closed without mutation', () => {
  for (const dto of [taskOperationalDto, editorialOperationalDto, clientOperationalDto]) {
    assert.deepEqual(dto(null), {});
    assert.deepEqual(dto([]), {});
    assert.deepEqual(dto('text'), {});
    assert.deepEqual(dto({ created_at: Object.create(Date.prototype) }), {});
    const source = Object.freeze({ id: 7, created_at: new Date('invalid'), updated_at: Infinity, revision: NaN });
    assert.deepEqual(dto(source), { id: 7 });
  }
  const source = { propiedades_extra: { colaboradores: ['Ana'], guiones: [{ titulo: 'Script', escenas: [{ texto: 'Shot' }] }] } };
  const before = structuredClone(source);
  const result = taskOperationalDto(source);
  result.propiedades_extra.guiones[0].escenas[0].texto = 'Changed';
  result.propiedades_extra.colaboradores.push('Other');
  assert.deepEqual(source, before);
});
