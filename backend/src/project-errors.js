// Restrictive project links are deliberate domain conflicts, not an invitation
// to delete history. Never convert arbitrary SQL failures into success/conflict.
export function projectDomainConflict(error) {
  return ['23503', '23505', '23514'].includes(error?.code)
    && typeof error.constraint === 'string' && /^proyectos?_/.test(error.constraint);
}
