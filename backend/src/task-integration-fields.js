export const isReservedTaskIntegrationField = key => /^wilson_/i.test(key) || key.toLowerCase() === 'origen_integracion';

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
}
