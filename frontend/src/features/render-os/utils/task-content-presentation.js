import { isTaskEditorialContext } from './task-editorial-context.js';
import { isLinkedProductionEditorialTask } from './task-content.js';

const templates = values => Object.freeze(values.map(value => Object.freeze(value)));
const editorialTemplates = templates([
  { label: '+ Video', value: 'VIDEO\nIdea:\nGuion:\nReferencia:' },
  { label: '+ Escena', value: 'ESCENA\nVisual:\nTexto / diálogo:' },
  { label: '+ Placa', value: 'PLACA\nTexto:\nVisual:' },
  { label: '+ Cierre / CTA', value: 'CIERRE / CTA\nAcción esperada:' },
  { label: '+ Objetivo', value: 'OBJETIVO\n' },
  { label: '+ Requisito', value: '• ' },
]);
const editorial = Object.freeze({
  description: 'Guion, copy e indicaciones en un solo lugar',
  placeholder: 'Escribí el guion, copy o las indicaciones acá…',
  empty: 'Agregá el guion, copy o las indicaciones en un solo lugar.',
  templates: editorialTemplates,
});
const production = Object.freeze({
  description: 'Guion e indicaciones. El copy editorial se gestiona por separado.',
  placeholder: 'Escribí el guion o las indicaciones acá…',
  empty: 'Agregá el guion o las indicaciones de trabajo.',
  templates: Object.freeze([editorialTemplates[0], editorialTemplates[1], editorialTemplates[4], editorialTemplates[5]]),
});
const nonEditorial = Object.freeze({
  description: 'Requisitos, criterios de aceptación y entregables de la tarea.',
  placeholder: 'Describí qué hay que resolver, cómo comprobarlo y qué se entrega…',
  empty: 'Agregá los requisitos y el resultado esperado.',
  templates: templates([
    { label: '+ Requisito', value: 'REQUISITO\nQué hay que resolver:\nAlcance:' },
    { label: '+ Criterios de aceptación', value: 'CRITERIOS DE ACEPTACIÓN\nCondiciones que debe cumplir:\nCómo comprobarlas:' },
    { label: '+ Entregable', value: 'ENTREGABLE\nResultado esperado:\nFormato y ubicación:' },
  ]),
});

// Text and insertion suggestions only. Never reads/rewrites task content, and
// retains the separate-copy protocol of linked production editorial tasks.
export function getTaskContentPresentation(task) {
  const current = task ?? {};
  if (isLinkedProductionEditorialTask(current)) return production;
  return isTaskEditorialContext(current) ? editorial : nonEditorial;
}
