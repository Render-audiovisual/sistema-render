/** Domain conflicts are expected coordination failures, not raw SQL responses. */
export function productionEditorialConflict(error) {
  return ['23503', '23505', '23514'].includes(error?.code)
    && typeof error?.constraint === 'string' && error.constraint.startsWith('produccion_editorial');
}
