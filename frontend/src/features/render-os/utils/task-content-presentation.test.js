import test from 'node:test';
import assert from 'node:assert/strict';
import { getTaskContentPresentation } from './task-content-presentation.js';
import { getUnifiedTaskContent, isLinkedProductionEditorialTask } from './task-content.js';

const videoId = '11111111-1111-4111-8111-111111111111';
const traditionalTemplates = [
  { label: '+ Video', value: 'VIDEO\nIdea:\nGuion:\nReferencia:' },
  { label: '+ Escena', value: 'ESCENA\nVisual:\nTexto / diálogo:' },
  { label: '+ Placa', value: 'PLACA\nTexto:\nVisual:' },
  { label: '+ Cierre / CTA', value: 'CIERRE / CTA\nAcción esperada:' },
  { label: '+ Objetivo', value: 'OBJETIVO\n' },
  { label: '+ Requisito', value: '• ' },
];
const traditional = {
  description: 'Guion, copy e indicaciones en un solo lugar',
  placeholder: 'Escribí el guion, copy o las indicaciones acá…',
  empty: 'Agregá el guion, copy o las indicaciones en un solo lugar.',
  templates: traditionalTemplates,
};

test('explicit non-editorial type/subtype matrix uses requirements and acceptance presentation', () => {
  const rows = ['desarrollo', 'administracion', 'Administración'].map(tipo_tarea => ({ tipo_tarea }));
  for (const subtipo of ['web', 'página web', 'pagina_web', 'landing', 'landing-page', 'chatbot', 'mantenimiento', 'automatización']) rows.push({ tipo_tarea: 'diseno', subtipo });
  for (const row of rows) {
    const result = getTaskContentPresentation(row);
    assert.equal(result.description, 'Requisitos, criterios de aceptación y entregables de la tarea.');
    assert.equal(result.placeholder, 'Describí qué hay que resolver, cómo comprobarlo y qué se entrega…');
    assert.equal(result.empty, 'Agregá los requisitos y el resultado esperado.');
    assert.deepEqual(result.templates, [
      { label: '+ Requisito', value: 'REQUISITO\nQué hay que resolver:\nAlcance:' },
      { label: '+ Criterios de aceptación', value: 'CRITERIOS DE ACEPTACIÓN\nCondiciones que debe cumplir:\nCómo comprobarlas:' },
      { label: '+ Entregable', value: 'ENTREGABLE\nResultado esperado:\nFormato y ubicación:' },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /guion|copy|placa|cta|publica/i);
  }
});
test('traditional editorial and legacy unknown cases preserve all exact text and six ordered templates', () => {
  for (const row of [undefined, null, {}, { tipo_tarea: 'unknown', subtipo: 'legacy' },
    { tipo_tarea: 'edicion', subtipo: 'reel' }, { tipo_tarea: 'diseno', subtipo: 'carrusel' },
    { tipo_tarea: 'diseno', subtipo: 'historia' }, { tipo_tarea: 'diseno', subtipo: 'flyer' }]) {
    assert.deepEqual(getTaskContentPresentation(row), traditional);
  }
});
test('explicit editorial links prevail over contradictory historical development classification', () => {
  const base = { tipo_tarea: 'desarrollo', subtipo: 'chatbot' };
  for (const key of ['publicacion_id', 'historia_id', 'objetivo_id', 'objetivo_pieza_id']) {
    assert.deepEqual(getTaskContentPresentation({ ...base, [key]: 23 }), traditional);
  }
  for (const key of ['objetivo_id', 'objetivo_pieza_id']) {
    assert.deepEqual(getTaskContentPresentation({ ...base, propiedades_extra: { [key]: 23 } }), traditional);
  }
  for (const publicacion_id of [0, -1, '23', true, 1.5]) {
    assert.equal(getTaskContentPresentation({ ...base, publicacion_id }).templates.length, 3);
  }
});
test('linked production keeps exact separate-copy texts and four templates in original order', () => {
  for (const tipo_tarea of ['edicion', 'desarrollo', 'unknown']) {
    const row = { tipo_tarea, publicacion_id: 23, propiedades_extra: { origen_produccion_video_id: videoId } };
    assert.equal(isLinkedProductionEditorialTask(row), true);
    assert.deepEqual(getTaskContentPresentation(row), {
      description: 'Guion e indicaciones. El copy editorial se gestiona por separado.',
      placeholder: 'Escribí el guion o las indicaciones acá…',
      empty: 'Agregá el guion o las indicaciones de trabajo.',
      templates: [traditionalTemplates[0], traditionalTemplates[1], traditionalTemplates[4], traditionalTemplates[5]],
    });
    assert.ok(!getTaskContentPresentation(row).templates.some(item => ['+ Placa', '+ Cierre / CTA'].includes(item.label)));
  }
  assert.deepEqual(getTaskContentPresentation({ publicacion_id: 23, propiedades_extra: { origen_produccion_video_id: 'invalid' } }), traditional);
});
test('names, title, copy and monthly labels do not infer editorial context or authority', () => {
  const base = { tipo_tarea: 'desarrollo', subtipo: 'web' };
  assert.deepEqual(getTaskContentPresentation({ ...base, titulo: 'Reel para publicar', asignado_a: 'Community',
    propiedades_extra: { objetivo_periodo: '2026-10', responsable_publicacion: 'Admin', copy_trabajo: 'Publicar', guiones: 'VIDEO' } }), getTaskContentPresentation(base));
});
test('presentation cannot mutate tasks or rewrite existing unified content/separate editorial copy', () => {
  for (const linked of [false, true]) {
    const task = { id: 7, tipo_tarea: linked ? 'edicion' : 'desarrollo', publicacion_id: linked ? 23 : null,
      aclaraciones: '  Requisito original\nSin cambios  ', propiedades_extra: { guiones: 'Guion histórico', copy_trabajo: 'Copy editorial intacto', ...(linked ? { origen_produccion_video_id: videoId } : {}) } };
    const before = structuredClone(task), content = getUnifiedTaskContent(task);
    Object.freeze(task.propiedades_extra); Object.freeze(task);
    getTaskContentPresentation(task);
    assert.deepEqual(task, before); assert.equal(getUnifiedTaskContent(task), content);
    assert.equal(task.propiedades_extra.copy_trabajo, 'Copy editorial intacto');
    assert.equal(content.includes('Copy editorial intacto'), !linked);
  }
});
test('returned objects, arrays and template objects are frozen, without cross-call mutation', () => {
  for (const task of [{ tipo_tarea: 'desarrollo' }, {}, { publicacion_id: 23, propiedades_extra: { origen_produccion_video_id: videoId } }]) {
    const result = getTaskContentPresentation(task), before = structuredClone(result);
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.templates), true);
    for (const item of result.templates) assert.equal(Object.isFrozen(item), true);
    assert.throws(() => { result.description = 'Changed'; }, TypeError);
    assert.throws(() => result.templates.push({ label: 'Extra', value: '' }), TypeError);
    assert.throws(() => { result.templates[0].value = 'Changed'; }, TypeError);
    assert.deepEqual(getTaskContentPresentation(task), before);
  }
});
