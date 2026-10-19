export const isReservedTaskIntegrationField = key => /^wilson_/i.test(key) || ['origen_integracion', 'revision_aprobada_entrega_id'].includes(key.toLowerCase());

// Verified server workflows emit integration evidence; browser users do not.
export function assertTaskBusinessInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Los datos de la tarea no son válidos.'), { status: 400 });
  }
  for (const object of [input, input.propiedades_extra]) {
    if (object === undefined) continue;
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      throw Object.assign(new Error('La información de la tarea debe ser un objeto.'), { status: 400 });
    }
    if (Object.keys(object).some(isReservedTaskIntegrationField)) {
      throw Object.assign(new Error('El origen y las confirmaciones de integración los registra el servidor.'), { status: 400 });
    }
  }
  const metadata = input.propiedades_extra || {};
  if (Object.hasOwn(metadata, 'horario') && (typeof metadata.horario !== 'string' || metadata.horario.length > 2000)) {
    throw Object.assign(new Error('El horario debe ser un texto de hasta 2000 caracteres.'), { status: 400 });
  }
  if (Object.hasOwn(metadata, 'coordinada') && typeof metadata.coordinada !== 'boolean') {
    throw Object.assign(new Error('La coordinación debe ser verdadero o falso.'), { status: 400 });
  }
}

// Existing free-text coordination is not a visit date or proof of completion.
// Every edit, including an administrator's, must observe a task revision.
export function assertTaskCoordinationPatch(input) {
  const metadata = input?.propiedades_extra || {};
  if (['horario', 'coordinada'].some(key => Object.hasOwn(metadata, key))
    && (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 1)) {
    throw Object.assign(new Error('Recargá la tarea antes de guardar la coordinación: falta su revisión actual.'), { status: 400 });
  }
}
