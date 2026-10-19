// Only known domain constraints are public conflicts. Unexpected DB faults stay500.
export function editorialPublicationDomainConflict(error) {
  return ['23503', '23505', '23514'].includes(error?.code)
    && typeof error.constraint === 'string'
    && error.constraint.startsWith('editorial_publicacion_');
}
