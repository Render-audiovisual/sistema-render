// Render 2.0's first successful production deployment (Hostinger 17:46:32 ART).
// Hide only older completions, not the Finalizadas column or later work.
export const TASK_WORKSPACE_HISTORY_CUTOFF = '2026-10-29T20:46:32.000Z';
export const TASK_COMPLETION_ISO_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$';
export function hasCurrentWorkspaceCompletion(task) {
  const stamp = task?.propiedades_extra?.finalizada_at;
  return typeof stamp === 'string' && new RegExp(TASK_COMPLETION_ISO_PATTERN).test(stamp)
    && stamp >= TASK_WORKSPACE_HISTORY_CUTOFF;
}
