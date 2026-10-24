const targets = {
  create: '.pr-page-heading .pr-primary',
  project: '.pr-detail-header .pr-actions button',
  archive: '.pr-detail-header .pr-actions button',
  order: '[aria-labelledby="pr-stages-title"] header button',
  stage: '[aria-labelledby="pr-stages-title"] header button',
  milestone: '[aria-labelledby="pr-milestones-title"] header button',
  deliverable: '[aria-labelledby="pr-deliverables-title"] header button',
  task: '[aria-labelledby="pr-tasks-title"] header button',
};

// Called after the canceled editor has left the DOM. Never borrow a newer
// session/selection, focus during unmount, or invent a sequential tab stop.
export function restoreProjectFormFocus(pending, documentTarget) {
  try {
    if (!pending?.scope?.current()) return false;
    const selector = targets[pending.kind] || targets[pending.kind?.split('-')[0]];
    if (!selector) return false;
    const node = documentTarget.querySelector(selector);
    if (!node?.isConnected || node.disabled || node.closest('[hidden],[inert]') || node.getClientRects().length === 0) return false;
    if (!pending.scope.current()) return false;
    node.focus();
    return documentTarget.activeElement === node;
  } catch { return false; }
}
