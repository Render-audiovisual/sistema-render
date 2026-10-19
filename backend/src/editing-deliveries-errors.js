// Only named constraints from the delivery ledger are safe public conflicts.
export function editingDeliveryDomainConflict(error) {
  return ['23503', '23505', '23514'].includes(error?.code)
    && typeof error.constraint === 'string'
    && error.constraint.startsWith('task_editing_deliveries_');
}
